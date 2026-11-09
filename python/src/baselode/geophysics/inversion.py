# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded small-system inversion with explicit priors and supplied errors."""
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
except ImportError:
    _optimize=None

import baselode.geophysics.block_forward
import baselode.geophysics.corrections
import baselode.geophysics.forward_common
import baselode.geophysics.gravity_prisms
import baselode.geophysics.misfit
import baselode.geophysics.magnetic_prisms

_DESCRIPTORS={kind:json.loads((pathlib.Path(__file__).parent/('geophysics_'+kind+'_inversion.json')).read_text()) for kind in ('density','susceptibility','magnetic_vector')}
_J=('magnetization_x_A_m','magnetization_y_A_m','magnetization_z_up_A_m')


def describe_density_inversion():
    """Return shared explicit density inversion schemas, objective and budgets.

    Returns
    -------
    dict
        Independent core contract; Python numerical execution needs inversion extra.
    """
    return copy.deepcopy(_DESCRIPTORS['density'])


def _raise_validation(report):
    if report['state']=='ok':return
    issue=report['issues'][0]
    if issue['code']=='context':raise baselode.geophysics.corrections._NeedsInput(issue['message'])
    if issue['code']=='resource':raise baselode.geophysics.corrections._ResourceError(issue['message'])
    raise ValueError(issue['message'])


def _misfit_request(observed,predicted):
    return {'schema':'baselode.geophysics.misfit_request','version':1,'observed':observed,'predicted':predicted,'options':{'coverage_policy':'complete','weighting':'standard_deviation','coordinate_tolerance_m':0,'residual_convention':'observed_minus_predicted'}}


def _configuration(kind):
    if kind=='density':return {'physics':'gravity','parameters':('density_contrast_kg_m3',),'properties':('density_contrast_kg_m3',),'bounds':(-100000,100000),'scale':(1e-6,100000),'quantities':('gravity_g_down',),'data_units':'mGal','parameter_units':'kg/m^3'}
    if kind=='susceptibility':return {'physics':'magnetic','parameters':('susceptibility_SI',),'properties':_J,'bounds':(-.1,.1),'scale':(1e-8,.1),'quantities':('magnetic_tmi_anomaly',),'data_units':'nT','parameter_units':'dimensionless'}
    return {'physics':'magnetic','parameters':_J,'properties':_J,'bounds':(-1000,1000),'scale':(1e-6,1000),'quantities':('magnetic_tmi_anomaly','magnetic_bx','magnetic_by','magnetic_bz_up','magnetic_b_down'),'data_units':'nT','parameter_units':'A/m'}


def _component(quantity):
    return {'gravity_g_down':'g_down','magnetic_tmi_anomaly':'tmi_linear','magnetic_bx':'bx','magnetic_by':'by','magnetic_bz_up':'bz_up','magnetic_b_down':'b_down'}[quantity]


def _datasets(p,kind):
    if kind!='magnetic_vector':return [p['observed']]
    datasets=p['observed']
    if type(datasets) is not list:raise ValueError('MVI observed must be an array of datasets')
    if not datasets:raise baselode.geophysics.corrections._NeedsInput('supply at least one observed channel')
    if len(datasets)>3:raise baselode.geophysics.corrections._ResourceError('at most3 nonredundant observed datasets')
    return datasets


def _background(p):
    vector=p['forward_request']['background_nT']
    if vector is None:raise baselode.geophysics.corrections._NeedsInput('linear-TMI inversion requires a fixed nonnull background field')
    values=[vector[k] for k in ('x','y','z_up')]
    return values,math.sqrt(baselode.geophysics.magnetic_prisms._squared_norm3(values))


def _magnetic_context(p,datasets,kind):
    assumptions=p['magnetic_assumptions'];vector=kind=='magnetic_vector'
    required=('model','objective','background_reference_id')+(('error_model',) if vector else ('max_response_to_background_ratio',))
    baselode.geophysics.forward_common._keys(assumptions,required,('max_response_to_background_ratio',) if vector else ())
    model='uniform_cartesian_magnetization' if vector else 'induced_only_no_demagnetization'
    if assumptions['model']!=model or assumptions['objective'] not in (('linear_tmi','vector_components') if vector else ('linear_tmi',)):raise ValueError('declare supported magnetisation model and objective')
    baselode.geophysics.forward_common._label(assumptions['background_reference_id'])
    if any(observed['context']['reference_id']!=assumptions['background_reference_id'] for observed in datasets):raise baselode.geophysics.corrections._NeedsInput('observation reference must match the declared fixed background')
    if vector:
        if assumptions['error_model']!='independent_standard_deviations':raise ValueError('declare independent supplied standard deviations; correlated errors require another model')
        if 'max_response_to_background_ratio' not in assumptions:raise baselode.geophysics.corrections._NeedsInput('declare weak-response cap or explicit null for vector objective')
    quantities=[observed['context']['quantity'] for observed in datasets]
    if assumptions['objective']=='vector_components':
        canonical=['magnetic_bz_up' if q=='magnetic_b_down' else q for q in quantities]
        if any(q not in ('magnetic_bx','magnetic_by','magnetic_bz_up','magnetic_b_down') for q in quantities) or len(set(canonical))!=len(canonical):raise ValueError('vector objective requires distinct nonredundant Cartesian component channels')
        if assumptions['max_response_to_background_ratio'] is not None:raise ValueError('vector objective requires explicit null weak-response cap; no TMI linearisation is used')
        return
    if quantities!=['magnetic_tmi_anomaly']:raise ValueError('linear TMI requires exactly one TMI anomaly channel')
    baselode.geophysics.forward_common._number(assumptions['max_response_to_background_ratio'],1e-12,.05)
    _,magnitude=_background(p)
    if any(abs(float(row['value']))/magnitude>assumptions['max_response_to_background_ratio'] for observed in datasets for row in observed['records']):raise baselode.geophysics.corrections._NeedsInput('observed anomaly exceeds declared weak-response/background policy')


def _prepare(request,kind):
    cfg=_configuration(kind)
    p=baselode.geophysics.forward_common._bounded_json(request,2097152)
    baselode.geophysics.forward_common._keys(p,('schema','version','forward_request','observed','parameters','regularization','solver')+(() if kind=='density' else ('magnetic_assumptions',)),('metadata',))
    if p['schema']!='baselode.geophysics.'+kind+'_inversion_request' or type(p['version']) not in (int,float) or p['version']!=1:raise ValueError('unsupported inversion schema/version')
    if 'metadata' in p:
        if type(p['metadata']) is not dict:raise ValueError('metadata must be object')
        baselode.geophysics.forward_common._bounded_json(p['metadata'],131072)
    forward=p['forward_request'];prepared=baselode.geophysics.block_forward.prepare_block_forward(forward);_raise_validation(prepared)
    if forward['physics']!=cfg['physics'] or forward['include_sensitivities'] is not True:raise ValueError('inversion requires the matching physics template and include_sensitivities=true')
    columns=[forward['properties'][parameter]['column'] for parameter in cfg['properties']]
    if len(set(columns))!=len(columns):raise ValueError('fitted Cartesian property columns must be distinct')
    if any(column in ('i','j','k','ni','nj','nk','x','y','z','dx','dy','dz','fill_fraction',forward['cell_id_column'],forward['active_column']) for column in columns):raise ValueError('fitted property column must not overwrite geometry, ID or active policy')
    ids=prepared['cell_ids'];n=len(ids);m=len(forward['points'])
    if n>16 or m>128:raise baselode.geophysics.corrections._ResourceError('inversion limit16 active cells and128 observations')
    for batch in prepared['batches']:
        for source in batch['sources']:
            if any(source[parameter]!=0 for parameter in cfg['properties']):raise ValueError('all active template properties must be zero; declare reference in parameters')
    datasets=_datasets(p,kind);total=0
    for observed in datasets:
        if type(observed) is not dict or type(observed.get('context')) is not dict:raise ValueError('observed dataset/context required')
        context=observed['context']
        if context.get('quantity') not in cfg['quantities']:raise ValueError('declare a supported inversion quantity')
        predicted={'context':{**context,'coordinate_frame':forward['coordinate_frame']},'records':[{**point,'value':0.} for point in forward['points']]}
        _raise_validation(baselode.geophysics.misfit.calculate_misfit(_misfit_request(observed,predicted)))
        total+=len(observed['records'])
        for row in observed['records']:
            baselode.geophysics.forward_common._number(row['value'],-1e8,1e8);baselode.geophysics.forward_common._number(row['standard_deviation'],1e-8,1e8)
    if total>128:raise baselode.geophysics.corrections._ResourceError('at most128 total observations across channels')
    if kind!='density':_magnetic_context(p,datasets,kind)
    parameters=p['parameters'];expected=[(identity,parameter) for identity in ids for parameter in cfg['parameters']]
    if type(parameters) is not list or len(parameters)!=len(expected):raise ValueError('one ordered parameter per active cell/component required')
    for (identity,parameter),param in zip(expected,parameters):
        baselode.geophysics.forward_common._keys(param,('cell_id','parameter','lower','upper','reference','scale'))
        if param['cell_id']!=identity or param['parameter']!=parameter:raise ValueError('parameters must follow active cell then component order')
        for key in ('lower','upper','reference'):baselode.geophysics.forward_common._number(param[key],*cfg['bounds'])
        baselode.geophysics.forward_common._number(param['scale'],*cfg['scale'])
        if not param['lower']<param['upper'] or not param['lower']<=param['reference']<=param['upper']:raise ValueError('strict lower<upper and reference inside bounds required')
        baselode.geophysics.forward_common._number((float(param['upper'])-float(param['lower']))/param['scale'],1e-8,1e8)
    regularization=p['regularization'];baselode.geophysics.forward_common._keys(regularization,('reference_weight','smoothness_weight','edges'))
    for key in ('reference_weight','smoothness_weight'):baselode.geophysics.forward_common._number(regularization[key],0,1e12)
    edges=regularization['edges']
    if type(edges) is not list:raise ValueError('edges must be an array')
    if len(edges)>128:raise baselode.geophysics.corrections._ResourceError('at most128 explicit smoothing edges')
    seen=set();positive=False
    for edge in edges:
        baselode.geophysics.forward_common._keys(edge,('cell_a','cell_b','weight'))
        if edge['cell_a'] not in ids or edge['cell_b'] not in ids or edge['cell_a']==edge['cell_b']:raise ValueError('edges require distinct known active cells')
        pair=tuple(sorted((ids.index(edge['cell_a']),ids.index(edge['cell_b']))))
        if pair in seen:raise ValueError('duplicate undirected edge')
        seen.add(pair);baselode.geophysics.forward_common._number(edge['weight'],0,1e6);positive=positive or edge['weight']>0
    if regularization['smoothness_weight']>0 and not positive:raise baselode.geophysics.corrections._NeedsInput('positive smoothness requires positive explicit edges')
    solver=p['solver'];baselode.geophysics.forward_common._keys(solver,('method','tolerance','max_iterations','condition_limit'))
    if solver['method']!='bvls':raise ValueError('only bounded dense bvls supported')
    baselode.geophysics.forward_common._number(solver['tolerance'],1e-12,1e-6);baselode.geophysics.forward_common._number(solver['max_iterations'],1,1000);baselode.geophysics.forward_common._number(solver['condition_limit'],100,1e12)
    if int(solver['max_iterations'])!=solver['max_iterations']:raise ValueError('max_iterations must be integer')
    diagnostics={'active_cells':n,'observations':total,'parameters':len(expected),'pair_count':n*m,'edge_count':len(edges)}
    if kind=='magnetic_vector':diagnostics.update(dataset_count=len(datasets),prediction_points=m)
    return p,prepared,diagnostics


def _report(kind,phase):
    return {'schema':'baselode.geophysics.'+kind+'_inversion_'+phase,'version':1,'state':'ok','issues':[],'request':None,'diagnostics':{},'producer':baselode.geophysics.corrections._producer()}


def _error(report,error):
    baselode.geophysics.gravity_prisms._error(report,error)
    if 'parameters' in report:report.update(parameters=[],fitted_forward_request=None,predicted=None,misfit=None,operator=None,objective=None,convergence=None,forward_result=None)
    if 'magnetic_model' in report:report.update(magnetic_model=None,exact_tmi_misfit=None)
    if 'magnetization' in report:report['magnetization']=[]


def _validate(request,kind):
    report=_report(kind,'validation')
    try:
        p,_,diagnostics=_prepare(request,kind);report.update(request=p,diagnostics=diagnostics)
        baselode.geophysics.forward_common._bounded_json(report,8388608,result=True)
    except (ValueError,TypeError,RecursionError,ArithmeticError,RuntimeError) as error:_error(report,error)
    return report


def validate_density_inversion(request):
    """Validate fixed-geometry density inversion without optional numerical code.

    Parameters
    ----------
    request : dict
        Strict v1 density_inversion_request; zero-density block template,
        matched supplied-sigma gravity observations, ordered parameters,
        explicit scaled-deviation L2 regularisation and bounded solver controls.

    Returns
    -------
    dict
        Atomic structured state/issues and independent replay request. Core
        validation does not assemble an operator or guarantee full numerical rank.
    """
    return _validate(request,'density')


def _require_backend():
    if _optimize is None or baselode.geophysics.gravity_prisms._harmonica is None or baselode.geophysics.gravity_prisms._choclo is None:raise ImportError("Inversion requires pip install 'baselode[inversion]'")
    try:version=importlib.metadata.version('scipy')
    except importlib.metadata.PackageNotFoundError as error:raise ImportError("Inversion requires supported solver metadata; pip install 'baselode[inversion]'") from error
    if version!=('1.15.3' if sys.version_info<(3,11) else '1.17.1'):raise ImportError("Inversion requires the supported SciPy pin; pip install 'baselode[inversion]'")


def _spectrum(matrix):
    try:singular=np.linalg.svd(matrix,compute_uv=False)
    except np.linalg.LinAlgError as error:raise RuntimeError('operator SVD did not converge') from error
    if not np.all(np.isfinite(singular)):raise RuntimeError('nonfinite singular values')
    maximum=float(singular[0]) if len(singular) else 0.
    threshold=np.finfo(float).eps*max(matrix.shape)*maximum;rank=int(np.sum(singular>threshold))
    condition=float(singular[0]/singular[-1]) if rank==matrix.shape[1] else None
    return rank,condition,singular.tolist()


def _solve(matrix,data,sigma,parameters,regularization,solver,ids):
    reference=np.array([p['reference'] for p in parameters],dtype=float);scale=np.array([p['scale'] for p in parameters],dtype=float)
    lower=(np.array([p['lower'] for p in parameters],dtype=float)-reference)/scale;upper=(np.array([p['upper'] for p in parameters],dtype=float)-reference)/scale
    weighted=matrix/sigma[:,None];design=weighted*scale;target=(data-matrix@reference)/sigma
    n=len(parameters);rows=[design];targets=[target]
    if regularization['reference_weight']>0:rows.append(math.sqrt(regularization['reference_weight'])*np.eye(n));targets.append(np.zeros(n))
    differences=[];parameter_names=list(dict.fromkeys(p['parameter'] for p in parameters));parameter_indices={(p['cell_id'],p['parameter']):i for i,p in enumerate(parameters)}
    for edge in regularization['edges']:
        for parameter in parameter_names:
            row=np.zeros(n);row[parameter_indices[(edge['cell_a'],parameter)]]=math.sqrt(edge['weight']);row[parameter_indices[(edge['cell_b'],parameter)]]=-math.sqrt(edge['weight']);differences.append(row)
    differences=np.array(differences,dtype=float).reshape((-1,n))
    if regularization['smoothness_weight']>0:rows.append(math.sqrt(regularization['smoothness_weight'])*differences);targets.append(np.zeros(len(differences)))
    augmented=np.vstack(rows);rhs=np.concatenate(targets)
    if not np.all(np.isfinite(augmented)) or not np.all(np.isfinite(rhs)):raise RuntimeError('nonfinite augmented operator')
    data_rank,data_condition,data_singular=_spectrum(design);rank,condition,singular=_spectrum(augmented)
    if rank<n or condition>solver['condition_limit']:raise baselode.geophysics.corrections._NeedsInput('augmented operator rank/condition outside declared domain; supply independent data or explicit regularisation')
    factor=float(np.max(np.abs(augmented)));a=augmented/factor;b=rhs/factor
    if not np.all(np.isfinite(b)) or np.max(np.abs(b))>1e40:raise baselode.geophysics.corrections._NeedsInput('normalised target exceeds supported conditioning domain; revise scales/errors/regularisation')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error')
            solution=_optimize.lsq_linear(a,b,bounds=(lower,upper),method='bvls',lsq_solver='exact',tol=solver['tolerance'],max_iter=int(solver['max_iterations']))
    except (ValueError,TypeError,ArithmeticError,RuntimeError,Warning) as error:raise RuntimeError('bounded solver execution failed: '+str(error)) from error
    if not all(hasattr(solution,k) for k in ('x','success','status','active_mask','nit','optimality','message')):raise RuntimeError('incomplete bounded solver result')
    if not math.isfinite(solution.optimality):raise RuntimeError('nonfinite solver optimality')
    z=np.asarray(solution.x)
    if not solution.success or solution.status<=0 or z.shape!=(n,) or z.dtype!=np.dtype('float64') or not np.all(np.isfinite(z)) or np.any(z<lower) or np.any(z>upper):raise RuntimeError('bounded solver failed convergence/shape/finiteness/bounds checks')
    active=np.asarray(solution.active_mask)
    if active.shape!=(n,) or not np.all(np.isin(active,[-1,0,1])):raise RuntimeError('malformed active bound flags')
    bound_tolerance=2e-12*(1+np.maximum(np.abs(lower),np.abs(upper)))
    if np.any((active==-1)&(np.abs(z-lower)>bound_tolerance)) or np.any((active==1)&(np.abs(z-upper)>bound_tolerance)):raise RuntimeError('active flags disagree with fitted bounds')
    physical_lower=np.array([p['lower'] for p in parameters],dtype=float);physical_upper=np.array([p['upper'] for p in parameters],dtype=float)
    values=np.clip(reference+scale*z,physical_lower,physical_upper)
    z=(values-reference)/scale
    gradient=a.T@(a@z-b);projected=gradient.copy();projected[(active==-1)&(gradient>0)]=0;projected[(active==1)&(gradient<0)]=0
    kkt=float(np.max(np.abs(projected)));threshold=10*solver['tolerance']*(1+float(np.max(np.abs(a.T@b))))
    if not math.isfinite(kkt) or kkt>threshold:raise RuntimeError('solver did not satisfy projected-gradient convergence gate')
    if not np.all(np.isfinite(values)):raise RuntimeError('nonfinite fitted model')
    diagnostics={'data_rank':data_rank,'data_nullity':n-data_rank,'data_condition':data_condition,'data_singular_values':data_singular,'augmented_rank':rank,'augmented_condition':condition,'augmented_singular_values':singular,'data_nonunique':data_rank<n,'numpy_version':np.__version__,'scipy_version':importlib.metadata.version('scipy')}
    convergence={'success':True,'status':int(solution.status),'message':str(solution.message),'iterations':int(solution.nit),'optimality':float(solution.optimality),'projected_gradient':kkt,'projected_gradient_threshold':threshold,'matrix_normalization':factor}
    penalties={'reference':float(regularization['reference_weight']*np.dot(z,z)),'smoothness':float(regularization['smoothness_weight']*np.dot(differences@z,differences@z))}
    return values,active,np.linalg.norm(weighted,axis=0),diagnostics,convergence,penalties


def _predicted(observed,result,field):
    values={row['id']:row[field] for row in result['fields']}
    return {'context':copy.deepcopy(observed['context']),'records':[{k:row[k] for k in ('id','x_m','y_m','z_m')}|{'value':values[row['id']]} for row in observed['records']]}


def _invert(request,kind):
    _require_backend();report=_report(kind,'result');report.update(parameters=[],fitted_forward_request=None,predicted=None,misfit=None,operator=None,objective=None,convergence=None,forward_result=None,assumptions=copy.deepcopy(_DESCRIPTORS[kind]['assumptions']))
    if kind!='density':report.update(magnetic_model=None,exact_tmi_misfit=None)
    if kind=='magnetic_vector':report['magnetization']=[]
    try:
        cfg=_configuration(kind);p,prepared,diagnostics=_prepare(request,kind);datasets=_datasets(p,kind)
        try:version=importlib.metadata.version('scipy')
        except importlib.metadata.PackageNotFoundError as error:raise RuntimeError('missing scipy metadata; install inversion extra') from error
        if version!=('1.15.3' if sys.version_info<(3,11) else '1.17.1'):raise RuntimeError('unsupported scipy version; install baselode[inversion]')
        forward=baselode.geophysics.block_forward.calculate_block_forward(p['forward_request'])
        if forward['state']!='ok':raise RuntimeError('forward operator failed: '+forward['issues'][0]['message'])
        expected=[(identity,parameter) for identity in prepared['cell_ids'] for parameter in cfg['properties']]
        if [(column.get('source_id'),column.get('parameter')) for column in forward['sensitivities']]!=expected:raise RuntimeError('forward columns disagree with ordered parameters')
        point_indices={point['id']:i for i,point in enumerate(p['forward_request']['points'])}
        records=[row for observed in datasets for row in observed['records']]
        operator_rows=[{'id':row['id'],'quantity':observed['context']['quantity']} for observed in datasets for row in observed['records']]
        basis=np.array([[column['fields'][point_indices[row['id']]][_component(row['quantity'])] for column in forward['sensitivities']] for row in operator_rows],dtype=float)
        magnetic_model=None;h0=None;magnitude=None
        if kind=='susceptibility':
            background,magnitude=_background(p);mu0=baselode.geophysics.magnetic_prisms.describe_magnetic_prisms()['model']['vacuum_magnetic_permeability'];h0=[v*1e-9/mu0 for v in background]
            matrix=np.array([[math.fsum(float(row[3*c+j])*h0[j] for j in range(3)) for c in range(len(prepared['cell_ids']))] for row in basis],dtype=float)
            magnetic_model={'background_nT':copy.deepcopy(p['forward_request']['background_nT']),'inducing_field_H_A_m':dict(zip(('x','y','z_up'),h0)),'vacuum_magnetic_permeability':mu0,'assumptions':copy.deepcopy(p['magnetic_assumptions']),'max_fitted_response_to_background_ratio':None}
        else:
            matrix=basis
            if kind=='magnetic_vector':
                if p['forward_request']['background_nT'] is not None:_,magnitude=_background(p)
                magnetic_model={'background_nT':copy.deepcopy(p['forward_request']['background_nT']),'vacuum_magnetic_permeability':baselode.geophysics.magnetic_prisms.describe_magnetic_prisms()['model']['vacuum_magnetic_permeability'],'assumptions':copy.deepcopy(p['magnetic_assumptions']),'max_fitted_response_to_background_ratio':None}
        if matrix.shape!=(len(records),len(p['parameters'])) or not np.all(np.isfinite(matrix)):raise RuntimeError('malformed forward sensitivity operator')
        data=np.array([row['value'] for row in records],dtype=float);sigma=np.array([row['standard_deviation'] for row in records],dtype=float)
        values,active,norms,spectral,convergence,penalties=_solve(matrix,data,sigma,p['parameters'],p['regularization'],p['solver'],prepared['cell_ids'])
        fitted=copy.deepcopy(p['forward_request']);fitted['include_sensitivities']=False;lookup={(param['cell_id'],param['parameter']):float(value) for param,value in zip(p['parameters'],values)}
        for row in fitted['model']['blocks']:
            identity=row[fitted['cell_id_column']]
            if identity not in prepared['cell_ids']:continue
            for j,parameter in enumerate(cfg['properties']):row[fitted['properties'][parameter]['column']]=lookup[(identity,parameter)] if kind!='susceptibility' else lookup[(identity,'susceptibility_SI')]*h0[j]
        result=baselode.geophysics.block_forward.calculate_block_forward(fitted)
        if result['state']!='ok':raise RuntimeError('fitted forward evaluation failed: '+result['issues'][0]['message'])
        predictions=[_predicted(observed,result,_component(observed['context']['quantity'])) for observed in datasets]
        qcs=[baselode.geophysics.misfit.calculate_misfit(_misfit_request(observed,predicted)) for observed,predicted in zip(datasets,predictions)]
        if any(qc['state']!='ok' for qc in qcs):raise RuntimeError('fitted residual QC failed')
        if not np.allclose(matrix@values,np.array([row['value'] for predicted in predictions for row in predicted['records']]),rtol=1e-10,atol=1e-10):raise RuntimeError('fitted forward does not replay assembled operator')
        if kind!='density':
            if magnitude is not None:
                ratio=max(math.sqrt(baselode.geophysics.magnetic_prisms._squared_norm3([row[k] for k in ('bx','by','bz_up')]))/magnitude for row in result['fields']);magnetic_model['max_fitted_response_to_background_ratio']=ratio
                if p['magnetic_assumptions']['objective']=='linear_tmi' and ratio>p['magnetic_assumptions']['max_response_to_background_ratio']:raise baselode.geophysics.corrections._NeedsInput('fitted full magnetic vector exceeds declared weak-response/background policy')
            exact_qcs=[]
            for observed in datasets:
                if observed['context']['quantity']!='magnetic_tmi_anomaly':continue
                exact=baselode.geophysics.misfit.calculate_misfit(_misfit_request(observed,_predicted(observed,result,'tmi_exact')))
                if exact['state']!='ok':raise RuntimeError('exact-TMI residual QC failed')
                exact_qcs.append(exact)
            report.update(magnetic_model=magnetic_model,exact_tmi_misfit=(exact_qcs if kind=='magnetic_vector' else exact_qcs[0]) if exact_qcs else None)
        objective={'weighted_data':math.fsum(qc['summary']['statistics']['chi_squared'] for qc in qcs),'reference':penalties['reference'],'smoothness':penalties['smoothness']};objective['total']=math.fsum(objective.values())
        operator={'columns':[{'cell_id':param['cell_id'],'parameter':param['parameter']} for param in p['parameters']],'matrix':matrix.tolist(),'data_units':cfg['data_units'],'parameter_units':cfg['parameter_units']}
        if kind=='magnetic_vector':operator['rows']=operator_rows
        else:operator['row_ids']=[row['id'] for row in records]
        report.update(request=p,parameters=[{**param,'units':cfg['parameter_units'],'value':float(value),'active_bound':int(bound),'weighted_column_norm':float(norm)} for param,value,bound,norm in zip(p['parameters'],values,active,norms)],fitted_forward_request=copy.deepcopy(fitted),predicted=predictions if kind=='magnetic_vector' else predictions[0],misfit=qcs if kind=='magnetic_vector' else qcs[0],operator=operator,objective=objective,convergence=convergence,forward_result=result,diagnostics={**diagnostics,**spectral})
        if kind=='magnetic_vector':
            for identity in prepared['cell_ids']:
                vector=[lookup[(identity,parameter)] for parameter in _J];amplitude=math.hypot(*vector);direction=None if amplitude==0 else dict(zip(('x','y','z_up'),[v/amplitude for v in vector]))
                report['magnetization'].append({'cell_id':identity,'x_A_m':vector[0],'y_A_m':vector[1],'z_up_A_m':vector[2],'amplitude_A_m':amplitude,'unit_direction':direction})
        baselode.geophysics.forward_common._bounded_json(report,8388608,result=True)
    except (ValueError,TypeError,RecursionError,ArithmeticError,RuntimeError,Warning) as error:
        if isinstance(error,Warning):error=RuntimeError('numerical backend warning: '+str(error))
        _error(report,error)
    return report


def invert_density(request):
    """Fit bounded uniform-cell density contrasts with explicit L2 regularisation.

    Parameters
    ----------
    request : dict
        Validated v1 density_inversion_request. z=(density-reference)/scale;
        objective is supplied-sigma data SSE + reference_weight*sum(z**2) +
        smoothness_weight*sum(edge.weight*(z_a-z_b)**2). No inferred adjacency,
        depth weights, reference field, datum conversion or error estimates.

    Returns
    -------
    dict
        Fitted parameters/forward request, replayed predictions/residual QC,
        operator, objective terms, active bounds, rank/conditioning and solver
        convergence evidence. A regularised answer does not establish unique
        geology or posterior uncertainty. All failures withhold numerical output.

    Raises
    ------
    ImportError
        Install baselode[inversion] for pinned SciPy and potential-field kernels.
    """
    return _invert(request,'density')


def describe_susceptibility_inversion():
    """Return independent induced-only scalar susceptibility inversion contracts.

    Returns
    -------
    dict
        Shared core schema, SI conversion, explicit weak-response policy, linear
        objective/exact diagnostic distinction and bounded solver capabilities.
    """
    return copy.deepcopy(_DESCRIPTORS['susceptibility'])


def validate_susceptibility_inversion(request):
    """Validate scalar susceptibility inputs without optional numerical execution.

    Parameters
    ----------
    request : dict
        V1 susceptibility_inversion_request. Fixed zero-J block template,
        supplied-sigma TMI anomalies, SI bounds/reference/scales and explicit
        induced_only_no_demagnetization/linear_tmi/known-background policies.

    Returns
    -------
    dict
        Atomic copied request/state/issues. Operator rank and fitted full-vector
        weak-response applicability are established only during execution.
    """
    return _validate(request,'susceptibility')


def invert_susceptibility(request):
    """Fit bounded induced SI susceptibility using a declared constant field.

    Parameters
    ----------
    request : dict
        V1 contract. J=chi*B0_nT*1e-9/mu0 in A/m with released CODATA2022 mu0.
        Linear TMI objective and L2 scaled-reference deviations only. No
        demagnetisation, remanence, varying inducing field or inferred properties.

    Returns
    -------
    dict
        SI susceptibility, reusable fitted J forward model, physical operator,
        linear objective QC and separate exact-TMI QC, field/conversion provenance,
        full-vector weak-response check and shared bounds/rank/KKT evidence.
        A small response ratio does not guarantee error below arbitrary sigma;
        inspect the exact diagnostic. No unique geology or uncertainty estimate.

    Raises
    ------
    ImportError
        Requires the supported baselode[inversion] solver and prism backends.
    """
    return _invert(request,'susceptibility')


def describe_magnetic_vector_inversion():
    """Return independent Cartesian magnetisation inversion schemas and policies.

    Returns
    -------
    dict
        Native contracts, supported component/TMI objectives, units, independent
        error assumptions, explicit regularisation and bounded work limits.
    """
    return copy.deepcopy(_DESCRIPTORS['magnetic_vector'])


def validate_magnetic_vector_inversion(request):
    """Validate portable MVI inputs without optional numerical execution.

    Parameters
    ----------
    request : dict
        V1 magnetic_vector_inversion_request. Zero-J fixed block template;
        observed array of one linear-TMI channel or distinct vector components;
        independent supplied sigma, ordered Jx/Jy/Jz bounds/reference/scales and
        explicit uniform_cartesian_magnetization/objective/background policies.

    Returns
    -------
    dict
        Atomic state/issues and independent request snapshot. Numerical rank and
        postfit linear-TMI weak-response applicability require execution.
    """
    return _validate(request,'magnetic_vector')


def invert_magnetic_vector(request):
    """Fit independently bounded Cartesian magnetisation direction and strength.

    Parameters
    ----------
    request : dict
        V1 contract with A/m J components, fixed geometry and declared reference.
        Vector-component objective is linear in J and needs no weak-field
        approximation. Linear TMI requires a fixed nonnull background and explicit
        weak-response cap. Edges penalise each component's scaled deviation from
        its supplied reference; bounds/scales/priors can favour directions.

    Returns
    -------
    dict
        Fitted J, amplitude and frame unit direction (null exactly at zero),
        reusable forward request, per-channel residual QC, physical operator,
        separate exact-TMI QC when fitting linear TMI, objectives/nullity/
        sensitivities/bounds/KKT evidence. No induced/remanent decomposition,
        geographic angles, nonlinear exact objective, geological uniqueness or
        posterior uncertainty is inferred.

    Raises
    ------
    ImportError
        Install baselode[inversion] for supported solver and prism backends.
    """
    return _invert(request,'magnetic_vector')
