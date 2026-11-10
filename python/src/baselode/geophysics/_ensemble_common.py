# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Finite shared manifest guards and empirical (not posterior) statistics."""
import collections
import json
import math
import baselode.geophysics.corrections
import baselode.geophysics.forward_common
import baselode.geophysics.gravity_prisms
import baselode.geophysics.potential_field_operator


def _json(value, result=False, max_nodes=None, max_depth=None):
    return baselode.geophysics.forward_common._bounded_json(value, 67108864 if result else 16777216, result=result, max_nodes=max_nodes if max_nodes is not None else (3000000 if result else 1000000), max_depth=max_depth)


def _keys(value, required, optional=(), nullable=()):
    baselode.geophysics.potential_field_operator._keys(value, required, optional, nullable)


def _metadata(value, maximum):
    # Deterministic cross-language units: UTF-8 JSON text for strings/keys,
    # punctuation, booleans/null; fixed 32 units per numeric scalar. This is a
    # structural budget, not the host serializer's spelling of a float.
    def cost(item):
        if type(item) is dict:return 2+max(0, len(item)-1)+sum(cost(key)+1+cost(child) for key, child in item.items())
        if type(item) is list:return 2+max(0, len(item)-1)+sum(cost(child) for child in item)
        if type(item) in (int, float):return 32
        return len(json.dumps(item, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
    total = 0
    def walk(item):
        nonlocal total
        if type(item) is dict:
            for key, child in item.items():
                if key == 'metadata':
                    if type(child) is not dict:raise ValueError('metadata fields must be objects')
                    total += cost(child)
                else:walk(child)
        elif type(item) is list:
            for child in item:walk(child)
    walk(value)
    if total > maximum:raise baselode.geophysics.corrections._ResourceError('aggregate metadata structural budget exceeded')
    return total


def _integer(value, lower, upper):
    baselode.geophysics.forward_common._number(value, lower, upper)
    if int(value) != value:raise ValueError('integer required')
    return int(value)


def _noise(value):
    _keys(value, ('kind', 'seed'), nullable=('seed',))
    if value['kind'] == 'none':
        if value['seed'] is not None:raise ValueError('none noise requires explicit null seed')
    elif value['kind'] == 'independent_gaussian':
        if value['seed'] is None:raise baselode.geophysics.corrections._NeedsInput('supply an explicit Gaussian seed')
        _integer(value['seed'], 0, 9007199254740991)
    else:raise ValueError('unsupported noise kind')


def _quantiles(values):
    if type(values) is not list or not 1 <= len(values) <= 9:raise ValueError('declare one to nine quantiles')
    for q in values:baselode.geophysics.forward_common._number(q, 0, 1)
    if any(a >= b for a, b in zip(values, values[1:])):raise ValueError('quantiles must be strictly increasing')


def _failure_options(options, members):
    if options['failure_policy'] not in ('abort', 'collect'):raise ValueError('declare abort or collect failure_policy')
    _integer(options['minimum_successful_members'], 1, members)
    _quantiles(options['quantiles'])


def _threshold(value, quantity, units):
    _keys(value, ('quantity', 'units', 'direction', 'threshold'))
    if (value['quantity'], value['units']) != (quantity, units):raise baselode.geophysics.corrections._NeedsInput('threshold quantity/units must match the compared field')
    if value['direction'] not in ('absolute', 'positive', 'negative'):raise ValueError('unsupported anomaly direction')
    baselode.geophysics.forward_common._number(value['threshold'], 1e-12, 1e8)


def _hit(value, threshold):
    if threshold['direction'] == 'absolute':return abs(value) >= threshold['threshold']
    if threshold['direction'] == 'positive':return value >= threshold['threshold']
    return value <= -threshold['threshold']


def _stats(values, quantiles):
    n = len(values)
    if not n:return {'count': 0, 'mean': None, 'sample_standard_deviation': None, 'minimum': None, 'maximum': None, 'quantiles': [{'fraction': q, 'value': None} for q in quantiles]}
    values = sorted(float(value) for value in values)
    mean = math.fsum(values)/n
    deviation = math.sqrt(math.fsum((value-mean)**2 for value in values)/(n-1)) if n > 1 else None
    result = []
    for q in quantiles:
        position = q*(n-1);lo = int(math.floor(position));hi = int(math.ceil(position))
        result.append({'fraction': q, 'value': values[lo]+(values[hi]-values[lo])*(position-lo)})
    return {'count': n, 'mean': mean, 'sample_standard_deviation': deviation, 'minimum': values[0], 'maximum': values[-1], 'quantiles': result}


def _raise(report):
    if report['state'] == 'ok':return
    message = report.get('issues', [{}])[0].get('message', 'member validation failed')
    if report['state'] == 'needs_input':raise baselode.geophysics.corrections._NeedsInput(message)
    if report.get('issues') and report['issues'][0].get('code') == 'resource':raise baselode.geophysics.corrections._ResourceError(message)
    raise ValueError(message)


def _reused_seeds(members):
    counts = collections.Counter(int(row['noise']['seed']) for row in members if row['noise']['kind'] == 'independent_gaussian')
    return sorted(seed for seed, count in counts.items() if count > 1)


def _completion(members, options):
    successful = [row['id'] for row in members if row['state'] == 'ok']
    incomplete = len(successful) != len(members)
    if len(successful) < options['minimum_successful_members'] or (incomplete and options['failure_policy'] == 'abort'):state = 'failed'
    else:state = 'partial' if incomplete else 'ok'
    return state, {'requested_members': len(members), 'successful_members': len(successful), 'failed_members': sum(row['state'] not in ('ok', 'not_run') for row in members), 'not_run_members': sum(row['state'] == 'not_run' for row in members), 'coverage_fraction': len(successful)/len(members), 'successful_member_ids': successful}
