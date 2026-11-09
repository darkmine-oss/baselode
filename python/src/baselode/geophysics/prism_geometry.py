# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Shared bounded Cartesian prism geometry and scalar-amplitude validation."""
import math

import baselode.geophysics.corrections
import baselode.geophysics.forward_common

_COORDS = ('x_m', 'y_m', 'z_m')


def _prepare(request, schema, amplitudes, limits, extra_fields=()):
    p = baselode.geophysics.forward_common._bounded_json(request, limits['max_input_bytes'])
    baselode.geophysics.forward_common._keys(p, ('schema','version','coordinate_frame','sources','points','include_sensitivities'), ('metadata', *extra_fields))
    if p['schema'] != schema or type(p['version']) not in (int,float) or p['version'] != 1:
        raise ValueError('unsupported prism request schema/version')
    if type(p['include_sensitivities']) is not bool:
        raise ValueError('include_sensitivities must be boolean')
    frame = p['coordinate_frame']
    baselode.geophysics.forward_common._keys(frame, ('id','kind','axes','units','height_datum'))
    baselode.geophysics.forward_common._label(frame['id']); baselode.geophysics.forward_common._label(frame['height_datum'])
    if (frame['kind'],frame['axes'],frame['units']) != ('local_cartesian','x_y_up','m'):
        raise ValueError('declare local_cartesian, x_y_up and metres; transform upstream')
    for key, maximum in (('sources',limits['max_sources']),('points',limits['max_points'])):
        if type(p[key]) is not list or not p[key]:
            raise ValueError(key+' must be a nonempty array')
        if len(p[key]) > maximum:
            raise baselode.geophysics.corrections._ResourceError(key+' count exceeds budget')
    pairs = len(p['sources'])*len(p['points'])
    if pairs > limits['max_pairs'] or (p['include_sensitivities'] and pairs > limits['max_sensitivity_pairs']):
        raise baselode.geophysics.corrections._ResourceError('source-point pair budget exceeded')
    if 'metadata' in p:
        if type(p['metadata']) is not dict:
            raise ValueError('metadata must be an object')
        baselode.geophysics.forward_common._bounded_json(p['metadata'],limits['max_metadata_bytes'])
    low = [math.inf]*3; high = [-math.inf]*3
    ids = set(); geometries = []; max_aspect = 0; max_offset = 0
    for row in p['sources']:
        baselode.geophysics.forward_common._keys(row, ('id','kind','bounds_m',*amplitudes))
        baselode.geophysics.forward_common._label(row['id'])
        if row['id'] in ids or row['kind'] != 'prism':
            raise ValueError('sources require unique IDs and kind=prism')
        ids.add(row['id'])
        for key,(minimum,maximum) in amplitudes.items():
            baselode.geophysics.forward_common._number(row[key],minimum,maximum)
        bounds = row['bounds_m']
        if type(bounds) is not list or len(bounds) != 6:
            raise ValueError('bounds_m requires six xmin,xmax,ymin,ymax,zmin,zmax scalars')
        for v in bounds:
            baselode.geophysics.forward_common._number(v,-1e12,1e12)
        dimensions = [bounds[2*i+1]-bounds[2*i] for i in range(3)]
        for v in dimensions:
            baselode.geophysics.forward_common._number(v,.001,100000)
        minimum = min(dimensions); aspect = max(dimensions)/minimum
        if aspect > limits['max_aspect_ratio']:
            raise baselode.geophysics.corrections._NeedsInput('prism aspect exceeds supported conditioning domain; use a different discretisation or compatible point-source model')
        max_aspect = max(max_aspect,aspect)
        origins = [bounds[2*i] for i in range(3)]
        geometries.append((dimensions,origins))
        for i in range(3):
            low[i] = min(low[i],bounds[2*i]); high[i] = max(high[i],bounds[2*i+1])
    ids = set()
    for point in p['points']:
        baselode.geophysics.forward_common._keys(point, ('id',*_COORDS))
        baselode.geophysics.forward_common._label(point['id'])
        if point['id'] in ids:
            raise ValueError('point IDs must be unique')
        ids.add(point['id'])
        for i,k in enumerate(_COORDS):
            baselode.geophysics.forward_common._number(point[k],-1e12,1e12)
            low[i] = min(low[i],point[k]); high[i] = max(high[i],point[k])
    if any(b-a > limits['max_axis_span_m'] for a,b in zip(low,high)):
        raise baselode.geophysics.corrections._ResourceError('combined geometry span exceeds 200 km per axis')
    for dimensions,origins in geometries:
        for point in p['points']:
            ratio = max(abs((point[k]-origins[i])-dimensions[i]/2) for i,k in enumerate(_COORDS))/min(dimensions)
            max_offset = max(max_offset,ratio)
            if ratio > limits['max_point_offset_to_min_dimension']:
                raise baselode.geophysics.corrections._NeedsInput('point offset exceeds supported prism conditioning domain; use a compatible point-source model or different discretisation')
    diagnostics = {'source_count':len(p['sources']),'point_count':len(p['points']),'pair_count':pairs,'max_aspect_ratio':max_aspect,'max_point_offset_to_min_dimension':max_offset}
    return p,geometries,diagnostics


