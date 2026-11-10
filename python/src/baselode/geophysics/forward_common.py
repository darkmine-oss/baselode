# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Shared scalar-JSON guards and compensated sums for native forward models."""
import copy
import json
import math

import baselode.geophysics.corrections
import baselode.geophysics.observations

_LIMITS = {'max_json_nodes': 100000, 'max_result_json_nodes': 500000,
           'max_json_depth': 32, 'max_result_json_depth': 33}


def _bounded_json(value, limit, result=False, max_nodes=None, max_depth=None):
    """Validate scalar JSON before serialization, including cycles and huge ints."""
    active = set()
    count = 0
    text_bytes = 0

    def visit(item, depth):
        nonlocal count, text_bytes
        count += 1
        if count > (max_nodes if max_nodes is not None else (_LIMITS['max_result_json_nodes'] if result else _LIMITS['max_json_nodes'])) or depth > (max_depth if max_depth is not None else (_LIMITS['max_result_json_depth'] if result else _LIMITS['max_json_depth'])):
            raise baselode.geophysics.corrections._ResourceError('JSON node/depth budget exceeded')
        if item is None or type(item) is bool:
            return
        if type(item) in (int, float):
            if abs(item) > 1e100 or not math.isfinite(item) or (type(item) is int and int(float(item)) != item):
                raise ValueError('require finite exactly portable binary64 JSON numbers within +/-1e100')
            return
        if type(item) is str:
            text_bytes += len(item.encode('utf-8'))
            if text_bytes > limit:
                raise baselode.geophysics.corrections._ResourceError('JSON string byte budget exceeded')
            return
        if type(item) not in (dict, list):
            raise ValueError('require plain scalar JSON objects/arrays')
        identity = id(item)
        if identity in active:
            raise ValueError('cyclic JSON is invalid')
        active.add(identity)
        if type(item) is dict:
            for key, child in item.items():
                if type(key) is not str:
                    raise ValueError('JSON object keys must be strings')
                visit(key, depth + 1)
                visit(child, depth + 1)
        else:
            for child in item:
                visit(child, depth + 1)
        active.remove(identity)
    visit(value, 0)
    encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
    if len(encoded) > limit:
        raise baselode.geophysics.corrections._ResourceError('JSON byte budget exceeded')
    return copy.deepcopy(value)


def _keys(value, required, optional=()):
    if type(value) is not dict or value.keys() - set(required) - set(optional):
        raise ValueError('unknown fields or invalid object')
    if set(required) - value.keys() or any(value[k] is None for k in required):
        raise baselode.geophysics.corrections._NeedsInput('supply every required request/frame/source/point field')


def _number(value, low, high):
    if type(value) not in (int, float) or not low <= value <= high or not math.isfinite(value):
        raise ValueError('numeric value violates explicit finite range')


def _label(value):
    if not baselode.geophysics.observations._label(value) or baselode.geophysics.observations._trim(value).lower() in ('unknown', 'unspecified'):
        raise ValueError('IDs and height datum must be known nonblank labels of <=128 characters')


def _add(total, correction, index, value):
    next_value = total[index] + value
    correction[index] += ((total[index] - next_value) + value) if abs(total[index]) >= abs(value) else ((value - next_value) + total[index])
    total[index] = next_value


