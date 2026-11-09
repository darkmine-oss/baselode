# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""External uniformly magnetised prism responses and portable validation."""
import copy
import importlib.metadata
import json
import math
import pathlib
import warnings

import numpy as np

import baselode.geophysics.corrections
import baselode.geophysics.forward_common
import baselode.geophysics.gravity_prisms
import baselode.geophysics.magnetic_forward
import baselode.geophysics.prism_geometry

try:
    import harmonica as _harmonica
    import choclo as _choclo
except ImportError:
    _harmonica = None
    _choclo = None

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent/'geophysics_magnetic_prisms.json').read_text())
_LIMITS = _DESCRIPTOR['resources']
_COORDS = ('x_m','y_m','z_m')
_PARAMETERS = ('magnetization_x_A_m','magnetization_y_A_m','magnetization_z_up_A_m')


class _BackendError(RuntimeError):
    pass


def describe_magnetic_prisms():
    """Return independent magnetic-prism schemas, conventions and capabilities.

    Returns
    -------
    dict
        Core validation and optional Python execution contracts, external-only
        geometry domain, permeability normalization and sensitivity units.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _prepare(request):
    p,geometries,diagnostics = baselode.geophysics.prism_geometry._prepare(
        request,'baselode.geophysics.magnetic_prisms_request',
        {k:(-1000,1000) for k in _PARAMETERS},_LIMITS,('min_distance_m','background_nT'))
    if p.get('min_distance_m') is None or 'background_nT' not in p:
        raise baselode.geophysics.corrections._NeedsInput('supply min_distance_m and explicit background_nT vector or null')
    baselode.geophysics.forward_common._number(p['min_distance_m'],.001,100000)
    background = p['background_nT']
    if background is not None:
        baselode.geophysics.forward_common._keys(background,('x','y','z_up'))
        for value in background.values():
            baselode.geophysics.forward_common._number(value,-1e6,1e6)
        if not 1 <= math.hypot(*(background[k] for k in ('x','y','z_up'))) <= 1e6:
            raise ValueError('background magnitude must be between 1 and 1000000 nT')
    minimum_distance = math.inf
    for dimensions,origins in geometries:
        for point in p['points']:
            offsets = [point[k]-origins[i] for i,k in enumerate(_COORDS)]
            distance = math.hypot(*(max(-x,x-d,0) for x,d in zip(offsets,dimensions)))
            minimum_distance = min(minimum_distance,distance)
            if distance < p['min_distance_m']:
                raise baselode.geophysics.corrections._NeedsInput('every point must be external to every closed prism by min_distance_m; interiors/boundaries and zero-source geometry are excluded')
    diagnostics['min_point_to_prism_distance_m'] = minimum_distance
    return p,geometries,diagnostics


def validate_magnetic_prisms(request):
    """Validate and copy a magnetic-prism request without optional dependencies.

    Parameters
    ----------
    request : dict
        Strict v1 request with explicit local metre/up frame, signed A/m
        magnetisation vectors, bounds, points, boolean include_sensitivities,
        minimum external distance and background_nT vector or explicit null.

    Returns
    -------
    dict
        State/issues, independent request on success and work/geometry
        diagnostics. Input is unchanged; no numerical field is calculated.
    """
    report = {'schema':'baselode.geophysics.magnetic_prisms_validation','version':1,'state':'ok','issues':[],'request':None,'diagnostics':{},'producer':baselode.geophysics.corrections._producer()}
    try:
        p,_,diagnostics = _prepare(request)
        report.update(request=p,diagnostics=diagnostics)
    except (ValueError,TypeError,RecursionError,ArithmeticError,RuntimeError) as error:
        baselode.geophysics.gravity_prisms._error(report,error)
    return report


def _require_backend():
    if _harmonica is None or _choclo is None:
        raise ImportError("Magnetic prisms require pip install 'baselode[potential-fields]'")


def _backend_basis(points,dimensions,origins):
    coordinates = tuple(np.array([p[k]-origins[i] for p in points],dtype='float64') for i,k in enumerate(_COORDS))
    bounds = [[v for d in dimensions for v in (0.,d)]]
    columns = []
    for j in range(3):
        magnetization = tuple(np.array([1. if i==j else 0.]) for i in range(3))
        with warnings.catch_warnings():
            warnings.simplefilter('error')
            result = _harmonica.prism_magnetic(coordinates,bounds,magnetization,field='b',parallel=False,dtype='float64')
        if type(result) not in (tuple,list) or len(result)!=3:
            raise _BackendError('backend must return three magnetic component arrays')
        vectors = []
        for value in result:
            values = np.asarray(value)
            if values.shape!=(len(points),) or values.dtype!=np.dtype('float64') or not np.all(np.isfinite(values)) or np.any(np.abs(values)>1e100):
                raise _BackendError('backend returned malformed/nonfinite/out-of-range magnetic component')
            vectors.append(values*_DESCRIPTOR['model']['backend_to_target_scale'])
        columns.append(np.stack(vectors,axis=1))
    return np.stack(columns,axis=2)


def calculate_magnetic_prisms(request):
    """Calculate external magnetic fields of uniformly magnetised prisms.

    Parameters
    ----------
    request : dict
        Versioned portable request matching describe_magnetic_prisms().
        Every point must be outside every closed prism by min_distance_m,
        even when the source magnetisation is zero. All independent signed
        magnetisation components are A/m, positions/bounds local metres/up,
        and background is explicitly nT x/y/z_up or null for vectors only.
        Geometry/conditioning/work limits are checked before backend calls.

    Returns
    -------
    dict
        Synthetic B vectors and linear/exact total-field responses in nT,
        approximation diagnostics, independent model/request and optional
        three-column per-source magnetisation sensitivities in nT/(A/m).
        Derivatives cover vectors and LINEAR TMI only, with fixed geometry/
        background. No interior fields, induced-only assumption, inversion or
        propagated uncertainty. All failures withhold fields/sensitivities.

    Raises
    ------
    ImportError
        Install baselode[potential-fields] for supported Harmonica/Choclo.
    """
    _require_backend()
    report = {'schema':'baselode.geophysics.magnetic_prisms_result','version':1,'state':'ok','issues':[],'request':None,'fields':[],'sensitivities':[],'model':copy.deepcopy(_DESCRIPTOR['model']),'field_units':copy.deepcopy(_DESCRIPTOR['field_units']),'diagnostics':{},'producer':baselode.geophysics.corrections._producer(),'assumptions':copy.deepcopy(_DESCRIPTOR['assumptions'])}
    try:
        p,geometries,diagnostics = _prepare(request)
        for package,expected in (('harmonica','0.7.0'),('choclo','0.3.2')):
            try:
                installed_version = importlib.metadata.version(package)
            except importlib.metadata.PackageNotFoundError as error:
                raise _BackendError('missing '+package+' distribution metadata; install the declared potential-fields extra') from error
            if installed_version!=expected:
                raise _BackendError('unsupported '+package+' version; install the declared potential-fields extra')
        if _choclo.constants.VACUUM_MAGNETIC_PERMEABILITY!=report['model']['backend_vacuum_magnetic_permeability']:
            raise _BackendError('changed backend magnetic permeability')
        background = None if p['background_nT'] is None else [p['background_nT'][k] for k in ('x','y','z_up')]
        totals = [[0.]*3 for _ in p['points']]; corrections = [[0.]*3 for _ in p['points']]
        for source,(dimensions,origins) in zip(p['sources'],geometries):
            try:
                basis = _backend_basis(p['points'],dimensions,origins)
            except (ValueError,TypeError,ArithmeticError,RuntimeError,Warning) as error:
                raise _BackendError('backend magnetic evaluation failed: '+str(error)) from error
            for index,matrix in enumerate(basis):
                for i,row in enumerate(matrix):
                    contribution = math.fsum(float(row[j])*source[k] for j,k in enumerate(_PARAMETERS))
                    baselode.geophysics.forward_common._add(totals[index],corrections[index],i,contribution)
            if p['include_sensitivities']:
                for j,parameter in enumerate(_PARAMETERS):
                    fields = [baselode.geophysics.magnetic_forward._field(point['id'],[float(matrix[i,j]) for i in range(3)],background) for point,matrix in zip(p['points'],basis)]
                    report['sensitivities'].append({'source_id':source['id'],'parameter':parameter,'parameter_units':'A/m','field_units':copy.deepcopy(_DESCRIPTOR['sensitivity_field_units']),'fields':fields})
        ratios = []
        for point,total,correction in zip(p['points'],totals,corrections):
            vector = [a+b for a,b in zip(total,correction)]
            field = baselode.geophysics.magnetic_forward._field(point['id'],vector,background)
            exact = None if background is None else baselode.geophysics.magnetic_forward._total_field(vector,background)
            field.update(tmi_exact=exact,linearization_difference=None if exact is None else baselode.geophysics.magnetic_forward._zero(exact-field['tmi_linear']))
            if not all(v is None or math.isfinite(v) for k,v in field.items() if k!='id'):
                raise _BackendError('nonfinite magnetic prism response')
            report['fields'].append(field)
            if background is not None:ratios.append(math.hypot(*vector)/math.hypot(*background))
        report['request'] = p
        report['diagnostics'] = {**diagnostics,'synthetic':True,'uncertainty_propagated':False,'numpy_version':np.__version__,'max_response_to_background_ratio':max(ratios) if ratios else None}
        baselode.geophysics.forward_common._bounded_json(report,_LIMITS['max_result_bytes'],result=True)
    except (ValueError,TypeError,RecursionError,ArithmeticError,RuntimeError) as error:
        baselode.geophysics.gravity_prisms._error(report,error)
    return report
