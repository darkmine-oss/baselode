# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Explicit regular-grid, terrain-mask and matrix-free potential-field operators."""
import copy
import importlib.metadata
import json
import math
import pathlib
import sys
import warnings

import numpy as np
try:
    import scipy.optimize as _optimize
    import scipy.sparse as _sparse
    import scipy.sparse.linalg as _spla
except ImportError:
    _optimize=_sparse=_spla=None
if sys.version_info>=(3,12):
    try:
        import simpeg as _simpeg
        import simpeg.potential_fields.gravity as _gravity
        import simpeg.potential_fields.magnetics as _magnetics
        import discretize as _discretize
    except ImportError:
        _simpeg=_gravity=_magnetics=_discretize=None
else:
    _simpeg=_gravity=_magnetics=_discretize=None


import baselode.geophysics.corrections
import baselode.geophysics.forward_common
import baselode.geophysics.gravity_prisms
import baselode.geophysics.inversion
import baselode.geophysics.misfit

_DESCRIPTORS={kind:json.loads((pathlib.Path(__file__).parent/('geophysics_'+kind+'.json')).read_text()) for kind in ('potential_field_operator','potential_field_grid_inversion')}
_J=('magnetization_x_A_m','magnetization_y_A_m','magnetization_z_up_A_m')
_COORDS=('x_m','y_m','z_m')
_MU0=1.25663706127e-6
_VERSIONS={'simpeg':'0.26.0','discretize':'0.13.0','geoana':'0.9.0','choclo':'0.3.2','scipy':'1.17.1'}


def _keys(value,required,optional=(),nullable=()):
    if type(value) is not dict or value.keys()-set(required)-set(optional):raise ValueError('unknown fields or invalid object')
    if set(required)-value.keys() or any(value[k] is None for k in required if k not in nullable):raise baselode.geophysics.corrections._NeedsInput('supply every required operator field')


def _config(kind):
    if kind=='density':return ('density_contrast_kg_m3',),(-100000,100000),(1e-6,100000),'kg/m^3'
    if kind=='susceptibility':return ('susceptibility_SI',),(-.1,.1),(1e-8,.1),'dimensionless'
    if kind=='magnetic_vector':return _J,(-1000,1000),(1e-6,1000),'A/m'
    raise ValueError('unsupported model_kind')


def _norm(values):
    x,y,z=values
    return math.sqrt((x*x+y*y)+z*z)


def _prepare(request, exact_tmi=False):
    p=baselode.geophysics.forward_common._bounded_json(request,8388608,max_nodes=300000)
    _keys(p,('schema','version','model_kind','parameter_units','field_type','coordinate_frame','reference_id','grid','values','points','channels','background_nT','min_distance_m','max_response_to_background_ratio','execution'),('metadata',),('background_nT','min_distance_m','max_response_to_background_ratio'))
    if p['schema']!='baselode.geophysics.potential_field_operator_request' or type(p['version']) not in (int,float) or p['version']!=1:raise ValueError('unsupported operator schema/version')
    names,bounds,_,units=_config(p['model_kind'])
    if p['field_type'] not in (('gravity_anomaly','gravity_disturbance') if p['model_kind']=='density' else ('magnetic_anomaly',)):raise ValueError('declare compatible anomaly/disturbance field_type')
    if p['parameter_units']!=units:raise ValueError('declare explicit parameter units')
    frame=p['coordinate_frame'];_keys(frame,('id','kind','axes','units','height_datum'));baselode.geophysics.forward_common._label(frame['id']);baselode.geophysics.forward_common._label(frame['height_datum']);baselode.geophysics.forward_common._label(p['reference_id'])
    if (frame['kind'],frame['axes'],frame['units'])!=('local_cartesian','x_y_up','m'):raise ValueError('known local Cartesian metre/up frame required')
    g=p['grid'];_keys(g,('origin_m','cell_size_m','shape','order','cell_ids','active','terrain_z_m','terrain_policy'),nullable=('terrain_z_m',))
    if g['order']!='i_fastest':raise ValueError('grid order must be i_fastest')
    for key,lo,hi in [('origin_m',-1e9,1e9),('cell_size_m',1,100000),('shape',1,4096)]:
        if type(g[key]) is not list or len(g[key])!=3:raise ValueError(key+' requires three scalars')
        for value in g[key]:
            baselode.geophysics.forward_common._number(value,lo,hi)
            if key=='shape' and int(value)!=value:raise ValueError('shape must contain integers')
    shape=[int(v) for v in g['shape']];nx,ny,nz=shape;size=g['cell_size_m'];origin=g['origin_m'];total=nx*ny*nz
    if total>4096:raise baselode.geophysics.corrections._ResourceError('at most4096 total grid cells')
    if max(size)/min(size)>20:raise baselode.geophysics.corrections._NeedsInput('cell aspect ratio exceeds20')
    if any(size[i]*shape[i]>200000 for i in range(3)):raise baselode.geophysics.corrections._ResourceError('grid extent exceeds200km')
    for key in ('cell_ids','active'):
        if type(g[key]) is not list or len(g[key])!=total:raise ValueError(key+' must cover every grid cell')
    ids=set()
    for identity,active in zip(g['cell_ids'],g['active']):
        baselode.geophysics.forward_common._label(identity)
        if identity in ids or type(active) is not bool:raise ValueError('unique cell IDs and explicit boolean active flags required')
        ids.add(identity)
    terrain=g['terrain_z_m']
    if g['terrain_policy']=='none':
        if terrain is not None:raise ValueError('terrain_policy none requires explicit null terrain')
    elif g['terrain_policy']=='exclude_intersecting':
        if type(terrain) is not list or len(terrain)!=(nx+1)*(ny+1):raise ValueError('terrain requires complete i-fastest grid-node heights')
        for value in terrain:baselode.geophysics.forward_common._number(value,-1e9,1e9)
    else:raise ValueError('unsupported explicit terrain policy')
    indices=[];excluded={'masked_ids':[],'above_ids':[],'intersecting_ids':[]};centres=[]
    for index,(identity,active) in enumerate(zip(g['cell_ids'],g['active'])):
        if not active:excluded['masked_ids'].append(identity);continue
        i=index%nx;j=(index//nx)%ny;k=index//(nx*ny)
        if terrain is not None:
            heights=[float(terrain[ii+(nx+1)*jj])-float(origin[2]) for ii,jj in ((i,j),(i+1,j),(i,j+1),(i+1,j+1))];bottom=k*float(size[2]);top=(k+1)*float(size[2])
            if top>min(heights):
                excluded['above_ids' if bottom>=max(heights) else 'intersecting_ids'].append(identity);continue
        indices.append(index);centres.append([(v*float(d),(v+1)*float(d)) for v,d in zip((i,j,k),size)])
    if not indices:raise baselode.geophysics.corrections._NeedsInput('no full active cells remain below the declared terrain')
    if len(indices)>2048:raise baselode.geophysics.corrections._ResourceError('at most2048 effective active cells')
    if type(p['values']) is not list or len(p['values'])!=total*len(names):raise ValueError('values must cover all cells/components in cell-major order')
    active_set=set(indices)
    for i in range(total):
        for j in range(len(names)):
            value=p['values'][i*len(names)+j]
            if value is None and i not in active_set:continue
            if value is None:raise baselode.geophysics.corrections._NeedsInput('supply every effective active property')
            baselode.geophysics.forward_common._number(value,*bounds)
    channels=p['channels'];allowed=('gravity_g_down',) if p['model_kind']=='density' else ('magnetic_bx','magnetic_by','magnetic_bz_up','magnetic_b_down','magnetic_tmi_anomaly')
    if type(channels) is not list or not 1<=len(channels)<=3 or any(q not in allowed for q in channels):raise ValueError('declare supported channel array')
    canonical=['magnetic_bz_up' if q=='magnetic_b_down' else q for q in channels]
    if len(set(canonical))!=len(channels) or ('magnetic_tmi_anomaly' in channels and len(channels)!=1):raise ValueError('channels must be distinct and nonredundant; TMI is separate')
    if p['model_kind']=='density':
        if any(p[k] is not None for k in ('background_nT','min_distance_m','max_response_to_background_ratio')):raise ValueError('gravity requires explicit null magnetic settings')
    else:
        baselode.geophysics.forward_common._number(p['min_distance_m'],.001,100000)
        bg=p['background_nT']
        if bg is not None:
            _keys(bg,('x','y','z_up'))
            for value in bg.values():baselode.geophysics.forward_common._number(value,-1e6,1e6)
            if not 1<=_norm([bg[k] for k in ('x','y','z_up')])<=1e6:raise ValueError('background magnitude must be1..1000000nT')
        if (p['model_kind']=='susceptibility' or 'magnetic_tmi_anomaly' in channels) and bg is None:raise baselode.geophysics.corrections._NeedsInput('declared inducing/TMI background required')
        if 'magnetic_tmi_anomaly' in channels:
            if exact_tmi:
                if p['max_response_to_background_ratio'] is not None:raise ValueError('exact TMI requires explicit null weak-response cap')
            else:baselode.geophysics.forward_common._number(p['max_response_to_background_ratio'],1e-12,.05)
        elif p['max_response_to_background_ratio'] is not None:raise ValueError('component objectives require explicit null weak-response cap')
    points=p['points']
    if type(points) is not list or not points:raise ValueError('points must be nonempty array')
    rows=len(points)*len(channels)
    if rows>2048:raise baselode.geophysics.corrections._ResourceError('at most2048 total channel data')
    point_ids=set();local=[]
    for point in points:
        _keys(point,('id',*_COORDS));baselode.geophysics.forward_common._label(point['id'])
        if point['id'] in point_ids:raise ValueError('point IDs must be unique')
        point_ids.add(point['id'])
        for key in _COORDS:baselode.geophysics.forward_common._number(point[key],-1e9,1e9)
        local.append([float(point[key])-float(origin[i]) for i,key in enumerate(_COORDS)])
    for i in range(3):
        if max([size[i]*shape[i]]+[point[i] for point in local])-min([0.]+[point[i] for point in local])>200000:raise baselode.geophysics.corrections._ResourceError('combined geometry span exceeds200km')
    maximum=0.
    for centre in centres:
        for point in local:
            ratio=max(abs(point[i]-(centre[i][0]+centre[i][1])/2) for i in range(3))/min(b-a for a,b in centre);maximum=max(maximum,ratio)
            if ratio>1000:raise baselode.geophysics.corrections._NeedsInput('point offset/minimum cell dimension exceeds verified domain1000')
            if p['model_kind']!='density':
                distance=_norm([max(centre[i][0]-point[i],point[i]-centre[i][1],0.) for i in range(3)])
                if distance<p['min_distance_m']:raise baselode.geophysics.corrections._NeedsInput('magnetic points must be external to every effective cell by min_distance_m')
    e=p['execution'];_keys(e,('max_operator_calls','max_kernel_evaluations','workspace_budget_mib'))
    for key,lo,hi in [('max_operator_calls',4,1024),('max_kernel_evaluations',1,1000000000),('workspace_budget_mib',16,512)]:
        baselode.geophysics.forward_common._number(e[key],lo,hi)
        if int(e[key])!=e[key]:raise ValueError('execution budgets must be integers')
    parameters=len(indices)*len(names);workspace_rows=max(rows,3*len(points) if p['model_kind']!='density' else rows);estimate=16+8*(64*parameters+64*workspace_rows+32*total+24*(nx+1)*(ny+1)*(nz+1))/1048576
    if estimate>e['workspace_budget_mib']:raise baselode.geophysics.corrections._ResourceError('estimated numeric workspace exceeds budget (runtime/JIT excluded)')
    if 'metadata' in p:
        if type(p['metadata']) is not dict:raise ValueError('metadata must be object')
        baselode.geophysics.forward_common._bounded_json(p['metadata'],131072)
    volume=float(size[0])*float(size[1])*float(size[2]);diag={'total_cells':total,'active_cells':len(indices),'points':len(points),'observations':rows,'parameters':parameters,'numeric_workspace_estimate_mib':estimate,'dense_matrix_mib':8*parameters*rows/1048576,'active_volume_m3':volume*len(indices),'excluded_volume_m3':volume*(total-len(indices)),'max_point_offset_to_min_dimension':maximum,'matrix_free':True}
    return p,indices,excluded,diag


def _report(phase):
    return {'schema':'baselode.geophysics.potential_field_operator_'+phase,'version':1,'state':'ok','issues':[],'request':None,'active_cell_ids':[],'excluded':{},'diagnostics':{},'predicted':None,'backend':None,'producer':baselode.geophysics.corrections._producer()}


def _error(report,error):
    baselode.geophysics.gravity_prisms._error(report,error);report.update(active_cell_ids=[],excluded={},predicted=None,backend=None)
    if 'parameters' in report:report.update(parameters=[],fitted_operator_request=None,misfit=None,objective=None,convergence=None)


def describe_potential_field_operator():
    """Return independent regular-grid operator schemas and verified budgets.

    Returns
    -------
    dict
        Core/native contracts and Python3.12+ pinned matrix-free capabilities.
    """
    return copy.deepcopy(_DESCRIPTORS['potential_field_operator'])


def validate_potential_field_operator(request):
    """Validate and select full terrain-bounded cells without optional execution.

    Parameters
    ----------
    request : dict
        V1 potential_field_operator_request: explicit i-fastest regular grid,
        IDs/mask/optional node heights, cell-major values, frame/reference,
        channels/points/physical assumptions and numeric workspace/work budgets.

    Returns
    -------
    dict
        Atomic copied request, effective IDs, excluded IDs/volumes and estimates.
        Intersecting cells are excluded, never assigned guessed partial volumes.
    """
    report=_report('validation')
    try:
        p,indices,excluded,diag=_prepare(request);report.update(request=p,active_cell_ids=[p['grid']['cell_ids'][i] for i in indices],excluded=excluded,diagnostics=diag)
        baselode.geophysics.forward_common._bounded_json(report,16777216,result=True,max_nodes=1000000)
    except (ValueError,TypeError,RecursionError,ArithmeticError,RuntimeError) as error:_error(report,error)
    return report


def _require_backend():
    if sys.version_info<(3,12) or _simpeg is None or _discretize is None or _spla is None:raise ImportError("Matrix-free operators require Python>=3.12 and pip install 'baselode[scalable]'")
    for package,expected in _VERSIONS.items():
        try:version=importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError as error:raise ImportError("Install supported baselode[scalable] metadata") from error
        if version!=expected:raise ImportError("Unsupported "+package+"; install baselode[scalable]")


class _Counter:
    def __init__(self,p,diag):
        self.calls=0;self.terms=0;self.execution=p['execution'];self.cost=diag['active_cells']*diag['observations']*len(_config(p['model_kind'])[0])
    def charge(self,cost=None):
        self.calls+=1;self.terms+=self.cost if cost is None else cost
        if self.calls>self.execution['max_operator_calls'] or self.terms>self.execution['max_kernel_evaluations']:raise RuntimeError('operator-call/kernel-evaluation budget exhausted')


def _build(p,indices,diag,counter=None):
    grid=p['grid'];mask=np.zeros(diag['total_cells'],dtype=bool);mask[indices]=True
    mesh=_discretize.TensorMesh([np.diff(np.arange(int(n)+1,dtype=float)*float(d)) for n,d in zip(grid['shape'],grid['cell_size_m'])],origin=[0.,0.,0.])
    locations=np.array([[point[k]-grid['origin_m'][i] for i,k in enumerate(_COORDS)] for point in p['points']],dtype=float)
    magnetic=p['model_kind']!='density';vector=p['model_kind']=='magnetic_vector';channels=p['channels'];count=diag['parameters'];rows=diag['observations'];npoints=diag['points'];identity=_simpeg.maps.IdentityMap(nP=count);simulations=[];raw=[]
    if magnetic:
        bg=p['background_nT'];b=[0.,1.,0.] if bg is None else [float(bg[k]) for k in ('x','y','z_up')];magnitude=_norm(b);inclination=-math.degrees(math.asin(max(-1.,min(1.,b[2]/magnitude))));declination=math.degrees(math.atan2(b[0],b[1]));amplitude=_MU0*1e9 if vector else magnitude
    for channel in channels:
        component={'gravity_g_down':'gz','magnetic_bx':'bx','magnetic_by':'by','magnetic_bz_up':'bz','magnetic_b_down':'bz','magnetic_tmi_anomaly':'tmi'}[channel]
        if not magnetic:
            receiver=_gravity.receivers.Point(locations,components=[component]);source=_gravity.sources.SourceField([receiver]);simulation=_gravity.Simulation3DIntegral(mesh,survey=_gravity.Survey(source),rhoMap=identity,active_cells=mask,engine='choclo',store_sensitivities='forward_only',numba_parallel=False,sensitivity_dtype=np.float64)
        else:
            receiver=_magnetics.receivers.Point(locations,components=[component]);source=_magnetics.sources.UniformBackgroundField([receiver],amplitude=amplitude,inclination=inclination,declination=declination);simulation=_magnetics.Simulation3DIntegral(mesh,survey=_magnetics.Survey(source),chiMap=identity,model_type='vector' if vector else 'scalar',active_cells=mask,engine='choclo',store_sensitivities='forward_only',numba_parallel=False,sensitivity_dtype=np.float64)
        operator=simulation.getJ(np.zeros(count))
        if not isinstance(operator,_spla.LinearOperator) or not isinstance(simulation.G,_spla.LinearOperator):raise RuntimeError('backend attempted dense sensitivity allocation')
        simulations.append(simulation);raw.append(operator)
    factor=.001 if not magnetic else 1.;signs=[-1. if q in ('gravity_g_down','magnetic_b_down') else 1. for q in channels];counter=_Counter(p,diag) if counter is None else counter;cost=diag['active_cells']*rows*len(_config(p['model_kind'])[0])
    def to_raw(x):return (np.asarray(x).reshape((-1,3)).T.ravel() if vector else np.asarray(x))*factor
    def from_raw(x):return (np.asarray(x).reshape((3,-1)).T.ravel() if vector else np.asarray(x))*factor
    def check(x,shape):
        x=np.asarray(x)
        if x.shape!=shape or not np.all(np.isfinite(x)):raise RuntimeError('nonfinite/malformed operator product')
        return x
    def matvec(x):
        counter.charge(cost);x=check(x,(count,));return check(np.concatenate([sign*np.asarray(operator@to_raw(x)) for operator,sign in zip(raw,signs)]),(rows,))
    def rmatvec(x):
        counter.charge(cost);x=check(x,(rows,));values=np.zeros(count)
        for j,(operator,sign) in enumerate(zip(raw,signs)):values+=operator.T@(sign*x[j*npoints:(j+1)*npoints])
        return check(from_raw(values),(count,))
    operator=_spla.LinearOperator((rows,count),matvec=matvec,rmatvec=rmatvec,dtype=np.float64)
    def column_norms(weights):
        counter.charge(cost);diagonal=np.zeros(count)
        for j,simulation in enumerate(simulations):diagonal+=simulation.getJtJdiag(np.zeros(count),W=_sparse.diags(weights[j*npoints:(j+1)*npoints]))
        diagonal=from_raw(diagonal)*factor
        if not np.all(np.isfinite(diagonal)) or np.any(diagonal<0):raise RuntimeError('invalid weighted sensitivity diagonal')
        return np.sqrt(diagonal)
    x=np.sin(np.arange(count)+1.);y=np.cos(np.arange(rows)+1.);ax=operator@x;aty=operator.rmatvec(y);left=float(np.dot(ax,y));right=float(np.dot(x,aty));denominator=float(np.linalg.norm(ax)*np.linalg.norm(y)+np.linalg.norm(x)*np.linalg.norm(aty));relative=abs(left-right)/max(np.finfo(float).tiny,denominator)
    if relative>1e-10:raise RuntimeError('operator transpose failed adjoint consistency check')
    return operator,column_norms,counter,relative


def _check_tmi(p,indices,diag,model,counter):
    if 'magnetic_tmi_anomaly' not in p['channels']:return None
    vector_request={**p,'channels':['magnetic_bx','magnetic_by','magnetic_bz_up']};vector_diag={**diag,'observations':3*diag['points']}
    operator,_,_,_=_build(vector_request,indices,vector_diag,counter);values=(operator@model).reshape((3,-1));magnitude=_norm([p['background_nT'][k] for k in ('x','y','z_up')]);ratio=max(_norm(row)/magnitude for row in values.T)
    if ratio>p['max_response_to_background_ratio']:raise baselode.geophysics.corrections._NeedsInput('full predicted vector exceeds declared weak-response/background policy')
    return ratio


def _context(p,quantity):
    return {'quantity':quantity,'units':'mGal' if p['model_kind']=='density' else 'nT','field_type':p['field_type'],'reference_id':p['reference_id'],'coordinate_frame':copy.deepcopy(p['coordinate_frame'])}


def _prediction(p,values):
    n=len(p['points'])
    return [{'context':_context(p,quantity),'records':[{**point,'value':float(value)} for point,value in zip(p['points'],values[j*n:(j+1)*n])]} for j,quantity in enumerate(p['channels'])]


def _model(p,indices):
    size=len(_config(p['model_kind'])[0]);return np.array([p['values'][i*size+j] for i in indices for j in range(size)],dtype=float)


def _backend():return {**_VERSIONS,'numpy':np.__version__,'engine':'choclo','storage':'matrix_free','mu0_N_A2':_MU0,'density_backend_units':'g/cm^3','density_to_backend_scale':.001,'coordinate_evaluation':'subtract_grid_origin; nodes=index_times_spacing'}


def calculate_potential_field_operator(request):
    """Evaluate bounded terrain-aware fields with a pinned matrix-free backend.

    Parameters
    ----------
    request : dict
        Same contract as validate_potential_field_operator. No dense sensitivity
        allocation. Parameter order is cell-major; output datasets channel-major.

    Returns
    -------
    dict
        Predictions, effective/excluded cell evidence, adjoint/workspace/work
        diagnostics, backend conventions and independent request. Linear TMI is
        explicitly an approximation; no demagnetisation or geological inference.

    Raises
    ------
    ImportError
        Requires Python3.12+ and baselode[scalable].
    """
    _require_backend();report=_report('result')
    try:
        p,indices,excluded,diag=_prepare(request)
        with warnings.catch_warnings():
            warnings.simplefilter('error');operator,_,counter,adjoint=_build(p,indices,diag);values=operator@_model(p,indices)
            ratio=_check_tmi(p,indices,diag,_model(p,indices),counter)
        report.update(request=p,active_cell_ids=[p['grid']['cell_ids'][i] for i in indices],excluded=excluded,predicted=_prediction(p,values),diagnostics={**diag,'adjoint_relative_error':adjoint,'operator_calls':counter.calls,'kernel_evaluations':counter.terms,'max_fitted_response_to_background_ratio':ratio},backend=_backend())
        baselode.geophysics.forward_common._bounded_json(report,16777216,result=True,max_nodes=1000000)
    except (ValueError,TypeError,RecursionError,ArithmeticError,RuntimeError,Warning) as error:
        if isinstance(error,Warning):error=RuntimeError('operator backend warning: '+str(error))
        _error(report,error)
    return report


def _prepare_inverse(request, exact_tmi=False):
    p=baselode.geophysics.forward_common._bounded_json(request,8388608,max_nodes=300000);_keys(p,('schema','version','operator_request','observed','parameters','regularization','solver'),('metadata',))
    if p['schema']!='baselode.geophysics.potential_field_grid_inversion_request' or type(p['version']) not in (int,float) or p['version']!=1:raise ValueError('unsupported grid inversion schema/version')
    operator,indices,excluded,diag=_prepare(p['operator_request'],exact_tmi=exact_tmi);names,bounds,scales,units=_config(operator['model_kind']);ids=[operator['grid']['cell_ids'][i] for i in indices];expected=[(identity,name) for identity in ids for name in names]
    if any(v!=0 for v in _model(operator,indices)):raise ValueError('effective active template values must be zero')
    observed=p['observed']
    if type(observed) is not list or len(observed)!=len(operator['channels']):raise ValueError('one ordered observed dataset per channel required')
    for quantity,dataset in zip(operator['channels'],observed):
        prediction={'context':_context(operator,quantity),'records':[{**point,'value':0.} for point in operator['points']]};baselode.geophysics.inversion._raise_validation(baselode.geophysics.misfit.calculate_misfit(baselode.geophysics.inversion._misfit_request(dataset,prediction)))
        for row in dataset['records']:
            baselode.geophysics.forward_common._number(row['value'],-1e8,1e8);baselode.geophysics.forward_common._number(row['standard_deviation'],1e-8,1e8)
        if quantity=='magnetic_tmi_anomaly' and not exact_tmi:
            magnitude=_norm([operator['background_nT'][k] for k in ('x','y','z_up')])
            if any(abs(row['value'])/magnitude>operator['max_response_to_background_ratio'] for row in dataset['records']):raise baselode.geophysics.corrections._NeedsInput('observed TMI exceeds selected weak-response policy')
    if type(p['parameters']) is not list or len(p['parameters'])!=len(expected):raise ValueError('declare every effective parameter in cell/component order')
    for param,(identity,name) in zip(p['parameters'],expected):
        _keys(param,('cell_id','parameter','lower','upper','reference','scale'))
        if (param['cell_id'],param['parameter'])!=(identity,name):raise ValueError('parameter cell/component order mismatch')
        for key in ('lower','upper','reference'):baselode.geophysics.forward_common._number(param[key],*bounds)
        baselode.geophysics.forward_common._number(param['scale'],*scales)
        if not param['lower']<param['upper'] or not param['lower']<=param['reference']<=param['upper']:raise ValueError('strict bounds and in-bound reference required')
        baselode.geophysics.forward_common._number((float(param['upper'])-float(param['lower']))/param['scale'],1e-8,1e8)
    regularization=p['regularization'];_keys(regularization,('reference_weight','smoothness_weight','edges'));baselode.geophysics.forward_common._number(regularization['reference_weight'],1e-12,1e12);baselode.geophysics.forward_common._number(regularization['smoothness_weight'],0,1e12)
    edges=regularization['edges']
    if type(edges) is not list:raise ValueError('edges must be array')
    if len(edges)>4096:raise baselode.geophysics.corrections._ResourceError('at most4096 explicit edges')
    seen=set()
    for edge in edges:
        _keys(edge,('cell_a','cell_b','weight'))
        if edge['cell_a'] not in ids or edge['cell_b'] not in ids or edge['cell_a']==edge['cell_b']:raise ValueError('edges require distinct effective cells')
        pair=tuple(sorted((ids.index(edge['cell_a']),ids.index(edge['cell_b']))))
        if pair in seen:raise ValueError('duplicate undirected edge')
        seen.add(pair);baselode.geophysics.forward_common._number(edge['weight'],0,1e6)
    if regularization['smoothness_weight']>0 and not any(edge['weight']>0 for edge in edges):raise baselode.geophysics.corrections._NeedsInput('positive smoothing needs explicit positive edges')
    solver=p['solver'];_keys(solver,('method','tolerance','max_iterations','lsmr_tolerance','max_inner_iterations','condition_limit'))
    if solver['method']!='trf_lsmr':raise ValueError('matrix-free inversion requires trf_lsmr')
    for key,lo,hi in [('tolerance',1e-10,1e-5),('lsmr_tolerance',1e-12,1e-6),('max_iterations',1,200),('max_inner_iterations',1,1000),('condition_limit',100,1e12)]:
        baselode.geophysics.forward_common._number(solver[key],lo,hi)
        if 'iterations' in key and int(solver[key])!=solver[key]:raise ValueError('iteration budgets must be integer')
    if 'metadata' in p:
        if type(p['metadata']) is not dict:raise ValueError('metadata must be object')
        baselode.geophysics.forward_common._bounded_json(p['metadata'],131072)
    return p,operator,indices,excluded,diag


def describe_potential_field_grid_inversion():
    """Return independent matrix-free bounded inversion contracts and objective.

    Returns
    -------
    dict
        Positive-reference L2/TRF/LSMR, terrain and resource policies; condition
        evidence is a conservative bound, not a dense SVD or data-rank claim.
    """
    return copy.deepcopy(_DESCRIPTORS['potential_field_grid_inversion'])


def validate_potential_field_grid_inversion(request):
    """Validate portable larger-tile inversion without the optional backend.

    Parameters
    ----------
    request : dict
        V1 grid inversion request with zero-valued operator, complete supplied-
        sigma observations, effective parameter bounds/scales/reference/edges,
        positive reference weight and bounded iterative solver controls.

    Returns
    -------
    dict
        Atomic copied request, effective/excluded IDs and work estimates. This
        does not establish numerical conditioning or convergence.
    """
    report=_report('validation');report['schema']='baselode.geophysics.potential_field_grid_inversion_validation'
    try:
        p,operator,indices,excluded,diag=_prepare_inverse(request);report.update(request=p,active_cell_ids=[operator['grid']['cell_ids'][i] for i in indices],excluded=excluded,diagnostics=diag)
        baselode.geophysics.forward_common._bounded_json(report,16777216,result=True,max_nodes=1000000)
    except (ValueError,TypeError,RecursionError,ArithmeticError,RuntimeError) as error:_error(report,error)
    return report


def invert_potential_field_grid(request):
    """Fit larger terrain-aware tiles with matrix-free bounded L2 least squares.

    Parameters
    ----------
    request : dict
        Same contract as validate_potential_field_grid_inversion. z=(m-ref)/scale,
        supplied-sigma data SSE + reference_weight*sum(z**2) + componentwise
        edge smoothness. Positive reference weight makes the augmented system
        full column rank mathematically; data rank is not estimated or asserted.

    Returns
    -------
    dict
        Fitted model/request, predicted/QC/objective, weighted sensitivity norms,
        conservative Frobenius/reference condition upper bound, independent
        projected-gradient convergence and work evidence. No dense G allocation,
        inferred covariance, geological uniqueness or posterior uncertainty.

    Raises
    ------
    ImportError
        Python3.12+ and baselode[scalable] are required.
    """
    _require_backend();report=_report('result');report.update(schema='baselode.geophysics.potential_field_grid_inversion_result',parameters=[],fitted_operator_request=None,misfit=None,objective=None,convergence=None)
    try:
        p,template,indices,excluded,diag=_prepare_inverse(request);params=p['parameters'];n=len(params);reference=np.array([r['reference'] for r in params],dtype=float);scale=np.array([r['scale'] for r in params],dtype=float);lower=(np.array([r['lower'] for r in params])-reference)/scale;upper=(np.array([r['upper'] for r in params])-reference)/scale
        with warnings.catch_warnings():
            warnings.simplefilter('error');operator,norms,counter,adjoint=_build(template,indices,diag)
            point_index={point['id']:i for i,point in enumerate(template['points'])};ordered=[];observed=[];sigma=[]
            for j,dataset in enumerate(p['observed']):
                for row in dataset['records']:ordered.append(j*diag['points']+point_index[row['id']]);observed.append(float(row['value']));sigma.append(float(row['standard_deviation']))
            order=np.array(ordered);inverse_order=np.argsort(order);data=np.array(observed);sigma=np.array(sigma);regularization=p['regularization'];weight=regularization['reference_weight'];smooth=regularization['smoothness_weight'];lookup={(r['cell_id'],r['parameter']):i for i,r in enumerate(params)};names=_config(template['model_kind'])[0];ri=[];ci=[];vv=[];edge_count=0
            for edge in regularization['edges']:
                for name in names:
                    ri.extend([edge_count,edge_count]);ci.extend([lookup[(edge['cell_a'],name)],lookup[(edge['cell_b'],name)]]);vv.extend([math.sqrt(edge['weight']),-math.sqrt(edge['weight'])]);edge_count+=1
            difference=_sparse.csr_matrix((vv,(ri,ci)),shape=(edge_count,n));column_norms=norms((1/sigma)[inverse_order]);frob_squared=float(np.dot(column_norms*scale,column_norms*scale))+weight*n+smooth*float(np.dot(difference.data,difference.data));factor=math.sqrt(frob_squared);condition_bound=factor/math.sqrt(weight)
            if not math.isfinite(condition_bound) or condition_bound>p['solver']['condition_limit']:raise baselode.geophysics.corrections._NeedsInput('conservative augmented condition upper bound exceeds selected limit; revise scales/errors/regularisation')
            root_weight=math.sqrt(weight);root_smooth=math.sqrt(smooth)
            def matvec(z):return np.concatenate([(operator@(scale*z))[order]/sigma,root_weight*z,root_smooth*(difference@z)])/factor
            def rmatvec(v):return (scale*operator.rmatvec((v[:len(data)]/sigma)[inverse_order])+root_weight*v[len(data):len(data)+n]+root_smooth*(difference.T@v[len(data)+n:]))/factor
            augmented=_spla.LinearOperator((len(data)+n+edge_count,n),matvec=matvec,rmatvec=rmatvec,dtype=np.float64);target=np.concatenate([(data-(operator@reference)[order])/sigma,np.zeros(n+edge_count)])/factor
            if not np.all(np.isfinite(target)) or np.max(np.abs(target))>1e40:raise baselode.geophysics.corrections._NeedsInput('normalised target exceeds supported domain')
            solver=p['solver']
            try:solution=_optimize.lsq_linear(augmented,target,bounds=(lower,upper),method='trf',lsq_solver='lsmr',tol=solver['tolerance'],lsmr_tol=solver['lsmr_tolerance'],max_iter=int(solver['max_iterations']),lsmr_maxiter=int(solver['max_inner_iterations']))
            except (ValueError,TypeError,ArithmeticError,RuntimeError,Warning) as error:raise RuntimeError('iterative solver execution failed: '+str(error)) from error
            if not all(hasattr(solution,key) for key in ('x','success','status','active_mask','nit','optimality')):raise RuntimeError('incomplete iterative solver result')
            if not math.isfinite(solution.optimality) or np.asarray(solution.active_mask).shape!=(n,) or not np.all(np.isin(solution.active_mask,[-1,0,1])):raise RuntimeError('malformed iterative convergence/bound flags')
            z=np.asarray(solution.x)
            if not solution.success or solution.status<=0 or z.shape!=(n,) or not np.all(np.isfinite(z)) or np.any(z<lower) or np.any(z>upper):raise RuntimeError('iterative bounded solver failed convergence/bounds/finiteness')
            values=np.clip(reference+scale*z,[r['lower'] for r in params],[r['upper'] for r in params]);z=(values-reference)/scale;gradient=augmented.rmatvec(augmented@z-target);projected=z-np.clip(z-gradient,lower,upper);pg=float(np.max(np.abs(projected)));threshold=10*solver['tolerance']*(1+float(np.max(np.abs(augmented.rmatvec(target)))))
            if not math.isfinite(pg) or pg>threshold:raise RuntimeError('iterative solver failed independent projected-gradient gate')
            predicted_values=operator@values;ratio=_check_tmi(template,indices,diag,values,counter)
        predictions=_prediction(template,predicted_values);qcs=[baselode.geophysics.misfit.calculate_misfit(baselode.geophysics.inversion._misfit_request(o,d)) for o,d in zip(p['observed'],predictions)]
        if any(qc['state']!='ok' for qc in qcs):raise RuntimeError('fitted data residual QC failed')
        fitted=copy.deepcopy(template);components=len(names)
        for position,index in enumerate(indices):
            for j in range(components):fitted['values'][index*components+j]=float(values[position*components+j])
        objective={'weighted_data':math.fsum(qc['summary']['statistics']['chi_squared'] for qc in qcs),'reference':weight*float(np.dot(z,z)),'smoothness':smooth*float(np.dot(difference@z,difference@z))};objective['total']=math.fsum(objective.values())
        report.update(request=p,active_cell_ids=[template['grid']['cell_ids'][i] for i in indices],excluded=excluded,parameters=[{**param,'units':template['parameter_units'],'value':float(value),'active_bound':int(bound),'weighted_column_norm':float(norm)} for param,value,bound,norm in zip(params,values,solution.active_mask,column_norms)],fitted_operator_request=fitted,predicted=predictions,misfit=qcs,objective=objective,convergence={'success':True,'status':int(solution.status),'iterations':int(solution.nit),'optimality':float(solution.optimality),'projected_gradient':pg,'projected_gradient_threshold':threshold},diagnostics={**diag,'adjoint_relative_error':adjoint,'operator_calls':counter.calls,'kernel_evaluations':counter.terms,'augmented_condition_upper_bound':condition_bound,'condition_evidence':'Frobenius_norm_over_sqrt_reference_weight','data_rank':None,'max_fitted_response_to_background_ratio':ratio},backend=_backend())
        baselode.geophysics.forward_common._bounded_json(report,16777216,result=True,max_nodes=1000000)
    except (ValueError,TypeError,RecursionError,ArithmeticError,RuntimeError,Warning) as error:
        if isinstance(error,Warning):error=RuntimeError('matrix-free backend warning: '+str(error))
        _error(report,error)
    return report
