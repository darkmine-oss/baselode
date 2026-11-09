# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Pinned prism-gravity adapter and core-only portable request validation."""
import copy
import importlib.metadata
import json
import pathlib
import warnings

import numpy as np

import baselode.geophysics.corrections
import baselode.geophysics.forward_common
import baselode.geophysics.prism_geometry

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
    return baselode.geophysics.prism_geometry._prepare(
        request, 'baselode.geophysics.gravity_prisms_request',
        {'density_contrast_kg_m3': (-100000,100000)}, _LIMITS)


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
            try:
                installed_version = importlib.metadata.version(package)
            except importlib.metadata.PackageNotFoundError as error:
                raise _BackendError('missing '+package+' distribution metadata; install the declared potential-fields extra') from error
            if installed_version != expected:
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
