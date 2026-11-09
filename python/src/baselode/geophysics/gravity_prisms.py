# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Pinned prism-gravity adapter and core-only portable request validation."""
import copy
import importlib.metadata
import json
import math
import pathlib
import warnings

import numpy as np

import baselode.geophysics.corrections
import baselode.geophysics.forward_common

try:
    import harmonica as _harmonica
    import choclo as _choclo
except ImportError:
    _harmonica = None
    _choclo = None

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent/'geophysics_gravity_prisms.json').read_text())
_LIMITS = _DESCRIPTOR['resources']
_COORDS = ('x_m', 'y_m', 'z_m')
_COMPONENTS = ('gx', 'gy', 'gz_up', 'g_down', 'potential')


class _BackendError(RuntimeError):
    pass


def describe_gravity_prisms():
    """Return independent prism request/result schemas and execution capabilities.

    Returns
    -------
    dict
        Core-only native validation, pinned optional Python numerical backend,
        sign/unit/frame conventions and explicit numerical/resource domains.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _prepare(request):
    p = baselode.geophysics.forward_common._bounded_json(request, _LIMITS['max_input_bytes'])
    baselode.geophysics.forward_common._keys(p, ('schema','version','coordinate_frame','sources','points','include_sensitivities'), ('metadata',))
    if p['schema'] != 'baselode.geophysics.gravity_prisms_request' or type(p['version']) not in (int,float) or p['version'] != 1:
        raise ValueError('unsupported prism request schema/version')
    if type(p['include_sensitivities']) is not bool:
        raise ValueError('include_sensitivities must be boolean')
    frame = p['coordinate_frame']
    baselode.geophysics.forward_common._keys(frame, ('id','kind','axes','units','height_datum'))
    baselode.geophysics.forward_common._label(frame['id']); baselode.geophysics.forward_common._label(frame['height_datum'])
    if (frame['kind'],frame['axes'],frame['units']) != ('local_cartesian','x_y_up','m'):
        raise ValueError('declare local_cartesian, x_y_up and metres; transform upstream')
    for key, maximum in (('sources',64),('points',1024)):
        if type(p[key]) is not list or not p[key]:
            raise ValueError(key+' must be a nonempty array')
        if len(p[key]) > maximum:
            raise baselode.geophysics.corrections._ResourceError(key+' count exceeds budget')
    pairs = len(p['sources'])*len(p['points'])
    if pairs > _LIMITS['max_pairs'] or (p['include_sensitivities'] and pairs > _LIMITS['max_sensitivity_pairs']):
        raise baselode.geophysics.corrections._ResourceError('source-point pair budget exceeded')
    if 'metadata' in p:
        if type(p['metadata']) is not dict:
            raise ValueError('metadata must be an object')
        baselode.geophysics.forward_common._bounded_json(p['metadata'],_LIMITS['max_metadata_bytes'])
    low = [math.inf]*3; high = [-math.inf]*3
    ids = set(); geometries = []; max_aspect = 0; max_offset = 0
    for row in p['sources']:
        baselode.geophysics.forward_common._keys(row, ('id','kind','bounds_m','density_contrast_kg_m3'))
        baselode.geophysics.forward_common._label(row['id'])
        if row['id'] in ids or row['kind'] != 'prism':
            raise ValueError('sources require unique IDs and kind=prism')
        ids.add(row['id'])
        baselode.geophysics.forward_common._number(row['density_contrast_kg_m3'],-100000,100000)
        bounds = row['bounds_m']
        if type(bounds) is not list or len(bounds) != 6:
            raise ValueError('bounds_m requires six xmin,xmax,ymin,ymax,zmin,zmax scalars')
        for v in bounds:
            baselode.geophysics.forward_common._number(v,-1e12,1e12)
        dimensions = [bounds[2*i+1]-bounds[2*i] for i in range(3)]
        for v in dimensions:
            baselode.geophysics.forward_common._number(v,.001,100000)
        minimum = min(dimensions); aspect = max(dimensions)/minimum
        if aspect > _LIMITS['max_aspect_ratio']:
            raise baselode.geophysics.corrections._NeedsInput('prism aspect exceeds supported conditioning domain; use a different discretisation or point/sphere model')
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
    if any(b-a > _LIMITS['max_axis_span_m'] for a,b in zip(low,high)):
        raise baselode.geophysics.corrections._ResourceError('combined geometry span exceeds 200 km per axis')
    for dimensions,origins in geometries:
        for point in p['points']:
            ratio = max(abs((point[k]-origins[i])-dimensions[i]/2) for i,k in enumerate(_COORDS))/min(dimensions)
            max_offset = max(max_offset,ratio)
            if ratio > _LIMITS['max_point_offset_to_min_dimension']:
                raise baselode.geophysics.corrections._NeedsInput('point offset exceeds supported prism conditioning domain; use a point/sphere model or different discretisation')
    diagnostics = {'source_count':len(p['sources']),'point_count':len(p['points']),'pair_count':pairs,'max_aspect_ratio':max_aspect,'max_point_offset_to_min_dimension':max_offset}
    return p,geometries,diagnostics


def _error(report,error):
    context = isinstance(error,baselode.geophysics.corrections._NeedsInput)
    resource = isinstance(error,baselode.geophysics.corrections._ResourceError)
    failed = isinstance(error,(ArithmeticError,RuntimeError)) and not (context or resource)
    report.update(state='needs_input' if context else ('failed' if failed else 'rejected'),request=None,diagnostics={})
    report['issues'] = [{'code':'context' if context else ('resource' if resource else ('backend' if failed else 'contract')),'message':str(error)}]
    if 'fields' in report:
        report.update(fields=[],sensitivities=[])


def validate_gravity_prisms(request):
    """Validate and copy a bounded prism request without the optional backend.

    Parameters
    ----------
    request : dict
        V1 portable request with explicit frame, source bounds/densities,
        evaluation points and boolean include_sensitivities. See descriptor.

    Returns
    -------
    dict
        Structured state/issues, work/conditioning diagnostics and independent
        request snapshot on success. No numerical response or input mutation.
    """
    report = {'schema':'baselode.geophysics.gravity_prisms_validation','version':1,'state':'ok','issues':[],'request':None,'diagnostics':{},'producer':baselode.geophysics.corrections._producer()}
    try:
        p,_,diagnostics = _prepare(request)
        report.update(request=p,diagnostics=diagnostics)
    except (ValueError,TypeError,RecursionError,ArithmeticError,RuntimeError) as error:
        _error(report,error)
    return report


def _require_backend():
    if _harmonica is None or _choclo is None:
        raise ImportError("Prism gravity requires pip install 'baselode[potential-fields]'")


def _backend_fields(points,dimensions,origins):
    coordinates = tuple(np.array([p[k]-origins[i] for p in points],dtype='float64') for i,k in enumerate(_COORDS))
    bounds = [[v for d in dimensions for v in (0.,d)]]
    result = []
    for field,sign in (('g_e',1),('g_n',1),('g_z',-1),('potential',-1)):
        with warnings.catch_warnings():
            warnings.simplefilter('error')
            values = np.asarray(_harmonica.prism_gravity(coordinates,bounds,[1.],field=field,parallel=False,dtype='float64'))
        if values.shape != (len(points),) or values.dtype != np.dtype('float64') or not np.all(np.isfinite(values)) or np.any(np.abs(values)>1e100):
            raise _BackendError('backend returned malformed/nonfinite/out-of-range '+field)
        result.append(sign*values)
    return np.stack(result,axis=1)


def _field(identity,values):
    v = (values[0],values[1],values[2],-values[2],values[3])
    return {'id':identity,**{k:(0 if value==0 else float(value)) for k,value in zip(_COMPONENTS,v)}}


def calculate_gravity_prisms(request):
    """Calculate uniform rectangular-prism gravity with the pinned Python backend.

    Parameters
    ----------
    request : dict
        Strict v1 gravity_prisms_request. bounds_m order is xmin,xmax,ymin,ymax,
        zmin,zmax in declared local metres/up; signed density contrasts kg/m^3.
        Centres/interiors/faces/edges/corners supported for potential and
        acceleration, subject to explicit size/aspect/distance conditioning
        and resource bounds. No default density/frame or data correction.

    Returns
    -------
    dict
        Synthetic gx/gy/gz_up/g_down in mGal and negative potential in m^2/s^2,
        optional fixed-geometry density derivatives, backend identity and
        independent replay request. All failures withhold all fields and
        sensitivities. No tensor, uncertainty propagation or inversion claim.

    Raises
    ------
    ImportError
        Install baselode[potential-fields] for supported Harmonica/Choclo.
    """
    _require_backend()
    report = {'schema':'baselode.geophysics.gravity_prisms_result','version':1,'state':'ok','issues':[],'request':None,'fields':[],'sensitivities':[],'model':copy.deepcopy(_DESCRIPTOR['model']),'field_units':copy.deepcopy(_DESCRIPTOR['field_units']),'diagnostics':{},'producer':baselode.geophysics.corrections._producer(),'assumptions':copy.deepcopy(_DESCRIPTOR['assumptions'])}
    try:
        p,geometries,diagnostics = _prepare(request)
        for package,expected in (('harmonica','0.7.0'),('choclo','0.3.2')):
            if importlib.metadata.version(package) != expected:
                raise _BackendError('unsupported '+package+' version; install the declared potential-fields extra')
        if _choclo.constants.GRAVITATIONAL_CONST != report['model']['gravitational_constant']:
            raise _BackendError('changed backend gravitational constant')
        totals = [[0.]*4 for _ in p['points']]; corrections = [[0.]*4 for _ in p['points']]
        for source,(dimensions,origins) in zip(p['sources'],geometries):
            try:
                basis = _backend_fields(p['points'],dimensions,origins)
            except (ValueError,TypeError,ArithmeticError,RuntimeError,Warning) as error:
                raise _BackendError('backend prism evaluation failed: '+str(error)) from error
            for i,row in enumerate(basis):
                for j,value in enumerate(row):
                    baselode.geophysics.forward_common._add(totals[i],corrections[i],j,float(value)*source['density_contrast_kg_m3'])
            if p['include_sensitivities']:
                report['sensitivities'].append({'source_id':source['id'],'parameter':'density_contrast_kg_m3','parameter_units':'kg/m^3','field_units':{k:f'({v})/(kg/m^3)' for k,v in report['field_units'].items()},'fields':[_field(point['id'],row) for point,row in zip(p['points'],basis)]})
        report['fields'] = [_field(point['id'],[a+b for a,b in zip(total,correction)]) for point,total,correction in zip(p['points'],totals,corrections)]
        report['request'] = p
        report['diagnostics'] = {**diagnostics,'synthetic':True,'uncertainty_propagated':False,'numpy_version':np.__version__}
        baselode.geophysics.forward_common._bounded_json(report,_LIMITS['max_result_bytes'],result=True)
    except (ValueError,TypeError,RecursionError,ArithmeticError,RuntimeError,UserWarning) as error:
        if isinstance(error,UserWarning):
            error = _BackendError('backend warning: '+str(error))
        _error(report,error)
    return report
