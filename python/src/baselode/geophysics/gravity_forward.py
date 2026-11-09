# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded analytical Newtonian point-mass and uniform solid-sphere contrasts."""
import copy
import json
import math
import pathlib

import baselode.geophysics.corrections
import baselode.geophysics.observations

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent / 'geophysics_gravity_forward.json').read_text())
_LIMITS = _DESCRIPTOR['resources']
_COORDS = ('x_m', 'y_m', 'z_m')
_COMPONENTS = ('gx', 'gy', 'gz_up', 'g_down', 'potential')
_G = _DESCRIPTOR['model']['gravitational_constant']


def describe_gravity_forward():
    """Return independent request/result schemas, conventions and resource bounds.

    Returns
    -------
    dict
        Versioned JSON contract for local Cartesian synthetic gravity and
        optional fixed-geometry mass/density sensitivities. No backend extra.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _bounded_json(value, limit, result=False):
    """Validate scalar JSON before serialization, including cycles and huge ints."""
    active = set()
    count = 0
    text_bytes = 0

    def visit(item, depth):
        nonlocal count, text_bytes
        count += 1
        if count > (_LIMITS['max_result_json_nodes'] if result else _LIMITS['max_json_nodes']) or depth > (_LIMITS['max_result_json_depth'] if result else _LIMITS['max_json_depth']):
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


def _prepare(request):
    p = _bounded_json(request, _LIMITS['max_input_bytes'])
    _keys(p, ('schema', 'version', 'coordinate_frame', 'sources', 'points', 'include_sensitivities'), ('point_mass_min_distance_m', 'metadata'))
    if p['schema'] != 'baselode.geophysics.gravity_forward_request' or type(p['version']) not in (int, float) or p['version'] != 1:
        raise ValueError('unsupported gravity forward request schema/version')
    if type(p['include_sensitivities']) is not bool:
        raise ValueError('include_sensitivities must be boolean')
    frame = p['coordinate_frame']
    _keys(frame, ('id', 'kind', 'axes', 'units', 'height_datum'))
    _label(frame['id']); _label(frame['height_datum'])
    if (frame['kind'], frame['axes'], frame['units']) != ('local_cartesian', 'x_y_up', 'm'):
        raise ValueError('declare local_cartesian, x_y_up axes and metre units; transform upstream')
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
        _bounded_json(p['metadata'], _LIMITS['max_metadata_bytes'])
    low = [math.inf] * 3; high = [-math.inf] * 3
    has_point = False
    for collection in ('sources', 'points'):
        ids = set()
        for row in p[collection]:
            extra = ()
            if collection == 'sources':
                if type(row) is not dict:
                    raise ValueError('source must be a plain JSON object')
                if row.get('kind') is None:
                    raise baselode.geophysics.corrections._NeedsInput('declare source kind')
                if row['kind'] not in ('sphere', 'point_mass'):
                    raise ValueError('source kind must be sphere or point_mass')
                extra = ('kind', 'radius_m', 'density_contrast_kg_m3') if row['kind'] == 'sphere' else ('kind', 'mass_contrast_kg')
            _keys(row, ('id', *_COORDS, *extra))
            _label(row['id'])
            if row['id'] in ids:
                raise ValueError('source/point IDs must be unique within their collection')
            ids.add(row['id'])
            radius = 0
            if collection == 'sources':
                if row['kind'] == 'sphere':
                    radius = row['radius_m']
                    _number(radius, .001, 100000)
                    _number(row['density_contrast_kg_m3'], -100000, 100000)
                else:
                    has_point = True
                    _number(row['mass_contrast_kg'], -1e21, 1e21)
            for axis, key in enumerate(_COORDS):
                v = row[key]; _number(v, -1e12, 1e12)
                low[axis] = min(low[axis], v - radius)
                high[axis] = max(high[axis], v + radius)
    if any(b - a > _LIMITS['max_axis_span_m'] for a, b in zip(low, high)):
        raise baselode.geophysics.corrections._ResourceError('local frame span including sphere extents exceeds 200 km per axis')
    if has_point:
        if p.get('point_mass_min_distance_m') is None:
            raise baselode.geophysics.corrections._NeedsInput('point masses require explicit point_mass_min_distance_m')
        _number(p['point_mass_min_distance_m'], .001, 100000)
        # Geometry validation is amplitude-independent, including zero masses.
        for source in p['sources']:
            if source['kind'] == 'point_mass':
                for point in p['points']:
                    if math.hypot(*(source[k] - point[k] for k in _COORDS)) < p['point_mass_min_distance_m']:
                        raise baselode.geophysics.corrections._NeedsInput('point-mass exclusion distance violated; change geometry or use a physical solid sphere')
    elif 'point_mass_min_distance_m' in p:
        raise ValueError('point_mass_min_distance_m is forbidden without point masses')
    return p


def _kernel(source, point):
    """Unit-amplitude acceleration (mGal) and negative potential (SI)."""
    delta = [source[k] - point[k] for k in _COORDS]
    distance = math.hypot(*delta)
    sphere = source['kind'] == 'sphere'
    if sphere and distance <= source['radius_m']:
        radius = source['radius_m']
        factor = 4 * math.pi * _G / 3
        potential = -2 * math.pi * _G / 3 * (3 * radius * radius - distance * distance)
    else:
        gm = _G * (4 * math.pi * source['radius_m']**3 / 3 if sphere else 1)
        factor = gm / distance**3
        potential = -gm / distance
    return [factor * v * 1e5 for v in delta] + [potential]


def _add(total, correction, index, value):
    next_value = total[index] + value
    correction[index] += ((total[index] - next_value) + value) if abs(total[index]) >= abs(value) else ((value - next_value) + total[index])
    total[index] = next_value


def _field(identity, values):
    components = [values[0], values[1], values[2], -values[2], values[3]]
    return {'id': identity, **{key: (0 if value == 0 else value) for key, value in zip(_COMPONENTS, components)}}


def calculate_gravity_forward(request):
    """Calculate synthetic Cartesian gravity from signed mass/density contrasts.

    Parameters
    ----------
    request : dict
        Strict v1 JSON matching ``describe_gravity_forward()['request_schema']``.
        Explicit local Cartesian metre frame/height datum, source and point IDs
        and coordinates, and boolean include_sensitivities. Sources are point
        masses (mass_contrast_kg) or solid spheres (radius_m and uniform
        density_contrast_kg_m3). Any point mass requires an explicit minimum
        distance (no softening). Signed and zero amplitudes are permitted.
        All geometry is in one frame; transform survey coordinates upstream.

    Returns
    -------
    dict
        Versioned synthetic report with independent request/model snapshots,
        gx/gy/gz_up/g_down in mGal and negative potential in m^2/s^2. Optional
        per-source linear-amplitude derivatives carry their own field_units;
        positions/radii are fixed. Input is unchanged. On needs_input, rejected
        or failed state, fields/sensitivities are empty and request is null.
        No observed data, inversion, reference field or uncertainty is implied.
    """
    report = {'schema': 'baselode.geophysics.gravity_forward_result', 'version': 1, 'state': 'ok', 'issues': [],
              'model': copy.deepcopy(_DESCRIPTOR['model']), 'request': None, 'fields': [], 'sensitivities': [],
              'field_units': copy.deepcopy(_DESCRIPTOR['field_units']), 'diagnostics': {},
              'producer': baselode.geophysics.corrections._producer(), 'assumptions': copy.deepcopy(_DESCRIPTOR['assumptions'])}
    try:
        p = _prepare(request)
        totals = [[0.] * 4 for _ in p['points']]
        corrections = [[0.] * 4 for _ in p['points']]
        for source in p['sources']:
            parameter = 'mass_contrast_kg' if source['kind'] == 'point_mass' else 'density_contrast_kg_m3'
            unit = 'kg' if source['kind'] == 'point_mass' else 'kg/m^3'
            fields = []
            for index, point in enumerate(p['points']):
                basis = _kernel(source, point)
                for k, value in enumerate(basis):
                    _add(totals[index], corrections[index], k, value * source[parameter])
                if p['include_sensitivities']:
                    fields.append(_field(point['id'], basis))
            if p['include_sensitivities']:
                report['sensitivities'].append({'source_id': source['id'], 'parameter': parameter, 'parameter_units': unit,
                    'field_units': {k: f"({v})/({unit})" for k, v in report['field_units'].items()}, 'fields': fields})
        for point, total, correction in zip(p['points'], totals, corrections):
            values = [a + b for a, b in zip(total, correction)]
            if not all(math.isfinite(v) for v in values):
                raise ArithmeticError('nonfinite gravity response')
            report['fields'].append(_field(point['id'], values))
        report['request'] = p
        report['diagnostics'] = {'source_count': len(p['sources']), 'point_count': len(p['points']), 'pair_count': len(p['sources']) * len(p['points']), 'synthetic': True, 'uncertainty_propagated': False}
        _bounded_json(report, _LIMITS['max_result_bytes'], result=True)
    except (ValueError, TypeError, RecursionError, ArithmeticError, RuntimeError) as error:
        context = isinstance(error, baselode.geophysics.corrections._NeedsInput)
        resource = isinstance(error, baselode.geophysics.corrections._ResourceError)
        failed = isinstance(error, (ArithmeticError, RuntimeError)) and not (context or resource)
        report.update(state='needs_input' if context else ('failed' if failed else 'rejected'), fields=[], sensitivities=[], request=None, diagnostics={})
        report['issues'] = [{'code': 'context' if context else ('resource' if resource else ('backend' if failed else 'contract')), 'message': str(error)}]
    return report
