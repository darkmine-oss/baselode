# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Native magnetic point dipoles, total-field responses and moment Jacobians."""
import copy
import json
import math
import pathlib

import baselode.geophysics.corrections
import baselode.geophysics.forward_common

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent / 'geophysics_magnetic_forward.json').read_text())
_LIMITS = _DESCRIPTOR['resources']
_COORDS = ('x_m', 'y_m', 'z_m')
_MOMENTS = ('moment_x_A_m2', 'moment_y_A_m2', 'moment_z_up_A_m2')
_FACTOR = _DESCRIPTOR['model']['vacuum_magnetic_permeability'] / (4 * math.pi) * 1e9


def describe_magnetic_forward():
    """Return independent request/result schemas, units, model and resource bounds.

    Returns
    -------
    dict
        Versioned native dipole contract. Background is explicitly nullable;
        sensitivities cover only vector and linear-TMI moment derivatives.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _prepare(request):
    p = baselode.geophysics.forward_common._bounded_json(request, _LIMITS['max_input_bytes'])
    baselode.geophysics.forward_common._keys(p, ('schema', 'version', 'coordinate_frame', 'sources', 'points', 'include_sensitivities', 'min_distance_m'), ('background_nT', 'metadata'))
    if 'background_nT' not in p:
        raise baselode.geophysics.corrections._NeedsInput('supply background_nT vector or explicit null for vectors only')
    if p['schema'] != 'baselode.geophysics.magnetic_forward_request' or type(p['version']) not in (int, float) or p['version'] != 1:
        raise ValueError('unsupported magnetic forward schema/version')
    if type(p['include_sensitivities']) is not bool:
        raise ValueError('include_sensitivities must be boolean')
    frame = p['coordinate_frame']
    baselode.geophysics.forward_common._keys(frame, ('id', 'kind', 'axes', 'units', 'height_datum'))
    baselode.geophysics.forward_common._label(frame['id']); baselode.geophysics.forward_common._label(frame['height_datum'])
    if (frame['kind'], frame['axes'], frame['units']) != ('local_cartesian', 'x_y_up', 'm'):
        raise ValueError('declare local_cartesian, x_y_up axes and metre units; transform upstream')
    baselode.geophysics.forward_common._number(p['min_distance_m'], .001, 100000)
    background = p['background_nT']
    if background is not None:
        baselode.geophysics.forward_common._keys(background, ('x', 'y', 'z_up'))
        for value in background.values():
            baselode.geophysics.forward_common._number(value, -1e6, 1e6)
        if not 1 <= math.hypot(*(background[k] for k in ('x', 'y', 'z_up'))) <= 1e6:
            raise ValueError('background magnitude must be between 1 and 1000000 nT')
    for key, maximum in (('sources', _LIMITS['max_sources']), ('points', _LIMITS['max_points'])):
        if type(p[key]) is not list or not p[key]:
            raise ValueError(key + ' must be a nonempty array')
        if len(p[key]) > maximum:
            raise baselode.geophysics.corrections._ResourceError(key + ' count exceeds budget')
    pairs = len(p['sources']) * len(p['points'])
    if pairs > _LIMITS['max_pairs'] or (p['include_sensitivities'] and pairs > _LIMITS['max_sensitivity_pairs']):
        raise baselode.geophysics.corrections._ResourceError('source-point pair budget exceeded')
    if 'metadata' in p:
        if type(p['metadata']) is not dict:
            raise ValueError('metadata must be an object')
        baselode.geophysics.forward_common._bounded_json(p['metadata'], _LIMITS['max_metadata_bytes'])
    low = [math.inf] * 3; high = [-math.inf] * 3
    for collection in ('sources', 'points'):
        ids = set()
        for row in p[collection]:
            extra = ('kind', *_MOMENTS) if collection == 'sources' else ()
            baselode.geophysics.forward_common._keys(row, ('id', *_COORDS, *extra))
            baselode.geophysics.forward_common._label(row['id'])
            if row['id'] in ids:
                raise ValueError('source/point IDs must be unique within their collection')
            ids.add(row['id'])
            if collection == 'sources':
                if row['kind'] != 'dipole':
                    raise ValueError('source kind must be dipole')
                for key in _MOMENTS:
                    baselode.geophysics.forward_common._number(row[key], -1e15, 1e15)
            for axis, key in enumerate(_COORDS):
                value = row[key]; baselode.geophysics.forward_common._number(value, -1e12, 1e12)
                low[axis] = min(low[axis], value); high[axis] = max(high[axis], value)
    if any(b-a > _LIMITS['max_axis_span_m'] for a, b in zip(low, high)):
        raise baselode.geophysics.corrections._ResourceError('local frame span exceeds 200 km per axis')
    for source in p['sources']:
        for point in p['points']:
            if math.hypot(*(point[k]-source[k] for k in _COORDS)) < p['min_distance_m']:
                raise baselode.geophysics.corrections._NeedsInput('dipole exclusion distance violated; change geometry or use a finite-body model')
    return p


def _kernel(source, point):
    """Symmetric moment-to-B matrix, nT per A*m^2; no moment direction assumed."""
    delta = [point[k]-source[k] for k in _COORDS]
    distance = math.hypot(*delta)
    direction = [value/distance for value in delta]
    factor = _FACTOR / distance**3
    return [[factor * (3*direction[i]*direction[j] - (1 if i == j else 0)) for j in range(3)] for i in range(3)]


def _zero(value):
    return 0 if value == 0 else value


def _field(identity, vector, background):
    values = {'id': identity, 'bx': _zero(vector[0]), 'by': _zero(vector[1]), 'bz_up': _zero(vector[2]), 'b_down': _zero(-vector[2]), 'tmi_linear': None}
    if background is not None:
        magnitude = math.hypot(*background)
        values['tmi_linear'] = _zero(math.fsum(a*(b/magnitude) for a, b in zip(vector, background)))
    return values


def _total_field(vector, background):
    """Rationalised norm difference retains tiny transverse anomalies."""
    total = math.hypot(*(a+b for a, b in zip(background, vector)))
    reference = math.hypot(*background)
    # Factoring each squared-norm difference also avoids cancellation
    # between O(B0^2) products when the response nearly reverses B0.
    numerator = math.fsum(v * (2*b + v) for b, v in zip(background, vector))
    return _zero(numerator / (total+reference))


def calculate_magnetic_forward(request):
    """Calculate synthetic dipole magnetic vectors and optional total-field data.

    Parameters
    ----------
    request : dict
        Strict v1 request matching ``describe_magnetic_forward()['request_schema']``.
        All source positions, points, independent moment vectors (A*m^2) and
        background (nT) share the declared local Cartesian metre/up frame.
        Explicit min_distance_m guards every dipole, including zero moments.
        background_nT is required: x/y/z_up vector, or null for vectors only.
        include_sensitivities is a required boolean. Inputs are unchanged.

    Returns
    -------
    dict
        Synthetic nT vectors, linear and exact total-field anomalies (null
        without background), approximation difference/ratio diagnostics,
        model/units and independent replay request. Sensitivities, if enabled,
        cover each fixed-geometry moment component for vector and linear TMI
        only. Exact TMI is computed after vector superposition, not per source.
        All failures withhold fields/sensitivities/request. No induced-only
        direction, observation correction, inversion or uncertainty is inferred.
    """
    report = {'schema': 'baselode.geophysics.magnetic_forward_result', 'version': 1, 'state': 'ok', 'issues': [],
              'model': copy.deepcopy(_DESCRIPTOR['model']), 'request': None, 'fields': [], 'sensitivities': [],
              'field_units': copy.deepcopy(_DESCRIPTOR['field_units']), 'diagnostics': {},
              'producer': baselode.geophysics.corrections._producer(), 'assumptions': copy.deepcopy(_DESCRIPTOR['assumptions'])}
    try:
        p = _prepare(request)
        background = None if p['background_nT'] is None else [p['background_nT'][k] for k in ('x', 'y', 'z_up')]
        totals = [[0.] * 3 for _ in p['points']]; corrections = [[0.] * 3 for _ in p['points']]
        for source in p['sources']:
            derivatives = [[] for _ in range(3)]
            for index, point in enumerate(p['points']):
                matrix = _kernel(source, point)
                for i, row in enumerate(matrix):
                    contribution = math.fsum(row[j]*source[key] for j, key in enumerate(_MOMENTS))
                    baselode.geophysics.forward_common._add(totals[index], corrections[index], i, contribution)
                if p['include_sensitivities']:
                    for j in range(3):
                        derivatives[j].append(_field(point['id'], [matrix[i][j] for i in range(3)], background))
            if p['include_sensitivities']:
                for parameter, fields in zip(_MOMENTS, derivatives):
                    report['sensitivities'].append({'source_id': source['id'], 'parameter': parameter, 'parameter_units': 'A*m^2', 'field_units': copy.deepcopy(_DESCRIPTOR['sensitivity_field_units']), 'fields': fields})
        ratios = []
        for point, total, correction in zip(p['points'], totals, corrections):
            vector = [a+b for a, b in zip(total, correction)]
            field = _field(point['id'], vector, background)
            exact = None if background is None else _total_field(vector, background)
            field.update(tmi_exact=exact, linearization_difference=None if exact is None else _zero(exact-field['tmi_linear']))
            if not all(value is None or math.isfinite(value) for key, value in field.items() if key != 'id'):
                raise ArithmeticError('nonfinite magnetic response')
            report['fields'].append(field)
            if background is not None:
                ratios.append(math.hypot(*vector) / math.hypot(*background))
        report['request'] = p
        report['diagnostics'] = {'source_count': len(p['sources']), 'point_count': len(p['points']), 'pair_count': len(p['sources'])*len(p['points']), 'synthetic': True, 'uncertainty_propagated': False, 'max_response_to_background_ratio': max(ratios) if ratios else None}
        baselode.geophysics.forward_common._bounded_json(report, _LIMITS['max_result_bytes'], result=True)
    except (ValueError, TypeError, RecursionError, ArithmeticError, RuntimeError) as error:
        context = isinstance(error, baselode.geophysics.corrections._NeedsInput)
        resource = isinstance(error, baselode.geophysics.corrections._ResourceError)
        failed = isinstance(error, (ArithmeticError, RuntimeError)) and not (context or resource)
        report.update(state='needs_input' if context else ('failed' if failed else 'rejected'), fields=[], sensitivities=[], request=None, diagnostics={})
        report['issues'] = [{'code': 'context' if context else ('resource' if resource else ('backend' if failed else 'contract')), 'message': str(error)}]
    return report
