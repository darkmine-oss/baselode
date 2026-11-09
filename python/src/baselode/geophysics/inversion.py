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

_DESCRIPTORS={'density':json.loads((pathlib.Path(__file__).parent/'geophysics_density_inversion.json').read_text())}


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


def _prepare(request,kind):
    p=baselode.geophysics.forward_common._bounded_json(request,2097152)
    baselode.geophysics.forward_common._keys(p,('schema','version','forward_request','observed','parameters','regularization','solver'),('metadata',))
    if p['schema']!='baselode.geophysics.'+kind+'_inversion_request' or type(p['version']) not in (int,float) or p['version']!=1:raise ValueError('unsupported inversion schema/version')
    if 'metadata' in p:
        if type(p['metadata']) is not dict:raise ValueError('metadata must be object')
        baselode.geophysics.forward_common._bounded_json(p['metadata'],131072)
    forward=p['forward_request'];prepared=baselode.geophysics.block_forward.prepare_block_forward(forward);_raise_validation(prepared)
    if forward['physics']!='gravity' or forward['include_sensitivities'] is not True:raise ValueError('density inversion requires gravity template with include_sensitivities=true')
    property_column=forward['properties']['density_contrast_kg_m3']['column']
    if property_column in ('i','j','k','ni','nj','nk','x','y','z','dx','dy','dz','fill_fraction',forward['cell_id_column'],forward['active_column']):raise ValueError('fitted property column must not overwrite geometry, ID or active policy')
    ids=prepared['cell_ids'];n=len(ids);m=len(forward['points'])
    if n>16 or m>128:raise baselode.geophysics.corrections._ResourceError('inversion limit16 active cells and128 observations')
    for batch in prepared['batches']:
        for source in batch['sources']:
            if source['density_contrast_kg_m3']!=0:raise ValueError('all active template densities must be zero; declare reference in parameters')
    observed=p['observed']
    # Existing QC validates labels, sigma presence, exact-ID coverage/coordinates,
    # compatible quantity/units/field type and explicit frame/reference context.
    if type(observed) is not dict or type(observed.get('context')) is not dict:raise ValueError('observed dataset/context required')
    context=observed['context']
    if context.get('quantity')!='gravity_g_down':raise ValueError('density objective requires gravity_g_down')
    predicted={'context':{**context,'coordinate_frame':forward['coordinate_frame']},'records':[{**point,'value':0.} for point in forward['points']]}
    _raise_validation(baselode.geophysics.misfit.calculate_misfit(_misfit_request(observed,predicted)))
    for row in observed['records']:
        baselode.geophysics.forward_common._number(row['value'],-1e8,1e8);baselode.geophysics.forward_common._number(row['standard_deviation'],1e-8,1e8)
    parameters=p['parameters']
    if type(parameters) is not list or len(parameters)!=n:raise ValueError('one ordered density parameter per active cell required')
    for identity,param in zip(ids,parameters):
        baselode.geophysics.forward_common._keys(param,('cell_id','parameter','lower','upper','reference','scale'))
        if param['cell_id']!=identity or param['parameter']!='density_contrast_kg_m3':raise ValueError('parameters must follow active cell order and density_contrast_kg_m3')
        for key in ('lower','upper','reference'):baselode.geophysics.forward_common._number(param[key],-100000,100000)
        baselode.geophysics.forward_common._number(param['scale'],1e-6,100000)
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
    return p,prepared,{'active_cells':n,'observations':m,'parameters':n,'pair_count':n*m,'edge_count':len(edges)}


def _report(kind,phase):
    return {'schema':'baselode.geophysics.'+kind+'_inversion_'+phase,'version':1,'state':'ok','issues':[],'request':None,'diagnostics':{},'producer':baselode.geophysics.corrections._producer()}


def _error(report,error):
    baselode.geophysics.gravity_prisms._error(report,error)
    if 'parameters' in report:report.update(parameters=[],fitted_forward_request=None,predicted=None,misfit=None,operator=None,objective=None,convergence=None,forward_result=None)


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
    differences=[]
    for edge in regularization['edges']:
        row=np.zeros(n);row[ids.index(edge['cell_a'])]=math.sqrt(edge['weight']);row[ids.index(edge['cell_b'])]=-math.sqrt(edge['weight']);differences.append(row)
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


def _invert(request,kind):
    _require_backend();report=_report(kind,'result');report.update(parameters=[],fitted_forward_request=None,predicted=None,misfit=None,operator=None,objective=None,convergence=None,forward_result=None,assumptions=copy.deepcopy(_DESCRIPTORS[kind]['assumptions']))
    try:
        p,prepared,diagnostics=_prepare(request,kind)
        try:version=importlib.metadata.version('scipy')
        except importlib.metadata.PackageNotFoundError as error:raise RuntimeError('missing scipy metadata; install inversion extra') from error
        if version!=('1.15.3' if sys.version_info<(3,11) else '1.17.1'):raise RuntimeError('unsupported scipy version; install baselode[inversion]')
        forward=baselode.geophysics.block_forward.calculate_block_forward(p['forward_request'])
        if forward['state']!='ok':raise RuntimeError('forward operator failed: '+forward['issues'][0]['message'])
        if [(column.get('source_id'),column.get('parameter')) for column in forward['sensitivities']]!=[(param['cell_id'],param['parameter']) for param in p['parameters']]:raise RuntimeError('forward columns disagree with ordered parameters')
        observed=p['observed'];point_indices={point['id']:i for i,point in enumerate(p['forward_request']['points'])};indices=[point_indices[r['id']] for r in observed['records']]
        matrix=np.array([[column['fields'][i]['g_down'] for column in forward['sensitivities']] for i in indices],dtype=float)
        if matrix.shape!=(len(indices),len(p['parameters'])) or not np.all(np.isfinite(matrix)):raise RuntimeError('malformed forward sensitivity operator')
        data=np.array([r['value'] for r in observed['records']],dtype=float);sigma=np.array([r['standard_deviation'] for r in observed['records']],dtype=float)
        values,active,norms,spectral,convergence,penalties=_solve(matrix,data,sigma,p['parameters'],p['regularization'],p['solver'],prepared['cell_ids'])
        fitted=copy.deepcopy(p['forward_request']);fitted['include_sensitivities']=False;lookup=dict(zip(prepared['cell_ids'],values));column=fitted['properties']['density_contrast_kg_m3']['column']
        for row in fitted['model']['blocks']:
            if row[fitted['cell_id_column']] in lookup:row[column]=float(lookup[row[fitted['cell_id_column']]])
        result=baselode.geophysics.block_forward.calculate_block_forward(fitted)
        if result['state']!='ok':raise RuntimeError('fitted forward evaluation failed: '+result['issues'][0]['message'])
        predicted_values={r['id']:r['g_down'] for r in result['fields']}
        predicted={'context':copy.deepcopy(observed['context']),'records':[{k:r[k] for k in ('id','x_m','y_m','z_m')}|{'value':predicted_values[r['id']]} for r in observed['records']]}
        qc=baselode.geophysics.misfit.calculate_misfit(_misfit_request(observed,predicted))
        if qc['state']!='ok':raise RuntimeError('fitted residual QC failed: '+qc['issues'][0]['message'])
        if not np.allclose(matrix@values,np.array([r['value'] for r in predicted['records']]),rtol=1e-10,atol=1e-10):raise RuntimeError('fitted forward does not replay assembled operator')
        objective={'weighted_data':qc['summary']['statistics']['chi_squared'],'reference':penalties['reference'],'smoothness':penalties['smoothness']};objective['total']=math.fsum(objective.values())
        report.update(request=p,parameters=[{**param,'units':'kg/m^3','value':float(value),'active_bound':int(bound),'weighted_column_norm':float(norm)} for param,value,bound,norm in zip(p['parameters'],values,active,norms)],fitted_forward_request=copy.deepcopy(fitted),predicted=predicted,misfit=qc,operator={'row_ids':[r['id'] for r in observed['records']],'columns':[{'cell_id':param['cell_id'],'parameter':param['parameter']} for param in p['parameters']],'matrix':matrix.tolist(),'data_units':'mGal','parameter_units':'kg/m^3'},objective=objective,convergence=convergence,forward_result=result,diagnostics={**diagnostics,**spectral})
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
