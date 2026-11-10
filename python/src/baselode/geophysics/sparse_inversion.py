# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded componentwise smoothed-Lp/compact IRLS on matrix-free grid fields."""
import copy
import json
import math
import pathlib
import warnings
import numpy as np
try:
    import scipy.optimize as _optimize
    import scipy.sparse.linalg as _spla
except ImportError:
    _optimize = _spla = None
import baselode.geophysics._grid_inverse
import baselode.geophysics.corrections
import baselode.geophysics.forward_common
import baselode.geophysics.inversion
import baselode.geophysics.misfit
import baselode.geophysics.potential_field_operator

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent/'geophysics_sparse_potential_field_inversion.json').read_text())


def _prepare(request):
    p = baselode.geophysics.forward_common._bounded_json(request, 8388608, max_nodes=300000)
    baselode.geophysics.potential_field_operator._keys(p, ('schema', 'version', 'operator_request', 'observed', 'parameters', 'regularization', 'solver', 'initial_values', 'penalty', 'execution'), ('metadata',))
    if p['schema'] != 'baselode.geophysics.sparse_potential_field_inversion_request' or type(p['version']) not in (int, float) or p['version'] != 1:
        raise ValueError('unsupported sparse inversion schema/version')
    execution = p['execution']
    baselode.geophysics.potential_field_operator._keys(execution, ('max_operator_calls', 'max_kernel_evaluations'))
    for key, upper_limit in [('max_operator_calls', 16384), ('max_kernel_evaluations', 1000000000)]:
        baselode.geophysics.forward_common._number(execution[key], 4 if key == 'max_operator_calls' else 1, upper_limit)
        if int(execution[key]) != execution[key]:raise ValueError('total execution budgets must be integers')
    controls = p['solver']
    baselode.geophysics.potential_field_operator._keys(controls, ('method', 'tolerance', 'max_iterations', 'lsmr_tolerance', 'max_inner_iterations', 'condition_limit', 'outer_tolerance', 'max_outer_iterations', 'max_polish_iterations', 'max_backtracking_steps'))
    if controls['method'] != 'irls_trf_lsmr':
        raise ValueError('sparse inversion requires irls_trf_lsmr')
    baselode.geophysics.forward_common._number(controls['outer_tolerance'], 1e-8, 1e-3)
    baselode.geophysics.forward_common._number(controls['max_outer_iterations'], 1, 100)
    if int(controls['max_outer_iterations']) != controls['max_outer_iterations']:
        raise ValueError('outer iteration budget must be integer')
    baselode.geophysics.forward_common._number(controls['max_polish_iterations'], 0, 64)
    if int(controls['max_polish_iterations']) != controls['max_polish_iterations']:
        raise ValueError('polish iteration budget must be integer')
    baselode.geophysics.forward_common._number(controls['max_backtracking_steps'], 0, 16)
    if int(controls['max_backtracking_steps']) != controls['max_backtracking_steps']:
        raise ValueError('backtracking budget must be integer')
    base = {key: value for key, value in p.items() if key not in ('initial_values', 'penalty', 'execution')}
    base['schema'] = 'baselode.geophysics.potential_field_grid_inversion_request'
    base['solver'] = {key: value for key, value in controls.items() if key not in ('outer_tolerance', 'max_outer_iterations', 'max_polish_iterations', 'max_backtracking_steps')}
    base['solver']['method'] = 'trf_lsmr'
    _, template, indices, excluded, diag = baselode.geophysics.potential_field_operator._prepare_inverse(base)
    dimension = len(baselode.geophysics.potential_field_operator._config(template['model_kind'])[0])
    replay_calls = 6 if 'magnetic_tmi_anomaly' in template['channels'] else 3
    replay_terms = 3*diag['active_cells']*diag['observations']*dimension
    if replay_calls == 6:replay_terms += 9*diag['active_cells']*diag['points']*dimension
    if template['execution']['max_operator_calls'] < replay_calls or template['execution']['max_kernel_evaluations'] < replay_terms:
        raise baselode.geophysics.corrections._ResourceError('nested operator budget must cover its standalone fitted forward replay')
    if type(p['initial_values']) is not list or len(p['initial_values']) != len(p['parameters']):
        raise ValueError('initial_values must follow every effective parameter')
    for value, param in zip(p['initial_values'], p['parameters']):
        baselode.geophysics.forward_common._number(value, param['lower'], param['upper'])
    penalty = p['penalty']
    baselode.geophysics.potential_field_operator._keys(penalty, ('model_p', 'gradient_p', 'stages'))
    for key in ('model_p', 'gradient_p'):
        baselode.geophysics.forward_common._number(penalty[key], 0, 2)
    stages = penalty['stages']
    if type(stages) is not list or not 1 <= len(stages) <= 8:
        raise ValueError('declare one to eight explicit epsilon stages')
    previous = None
    for stage in stages:
        baselode.geophysics.potential_field_operator._keys(stage, ('model_epsilon', 'gradient_epsilon'))
        for value in stage.values():
            baselode.geophysics.forward_common._number(value, 1e-6, 10)
        current = [stage[key] for key in ('model_epsilon', 'gradient_epsilon')]
        if previous is not None and (any(a > b for a, b in zip(current, previous)) or current == previous):
            raise ValueError('epsilon stages must be nonincreasing, with at least one strict decrease')
        previous = current
    return p, template, indices, excluded, diag


def _report(phase):
    r = baselode.geophysics.potential_field_operator._report(phase)
    r.update(schema='baselode.geophysics.sparse_potential_field_inversion_'+phase, parameters=[], fitted_operator_request=None,
             misfit=None, objective=None, convergence=None, penalty_weights=None, history=[], path=[], initial_predicted=None)
    return r


def _error(report, error):
    baselode.geophysics.potential_field_operator._error(report, error)
    report.update(penalty_weights=None, history=[], path=[], initial_predicted=None)


def describe_sparse_potential_field_inversion():
    """Return copied smoothed-Lp IRLS contracts, objective and finite resources.

    Returns
    -------
    dict
        Penalty definitions, epsilon stages, inner/outer gates and limitations.
    """
    return copy.deepcopy(_DESCRIPTOR)


def validate_sparse_potential_field_inversion(request):
    """Validate portable sparse/compact inversion without optional execution.

    Parameters
    ----------
    request : dict
        V1 sparse_potential_field_inversion_request: linear grid inverse fields,
        explicit initial_values, componentwise model/gradient p in[0,2], positive
        epsilon stages and bounded inner/outer controls. Exact-TMI composition
        is unsupported; linear TMI retains its declared weak-response policy.

    Returns
    -------
    dict
        Atomic copied request and terrain/work evidence; convergence not inferred.
    """
    report = _report('validation')
    try:
        p, template, indices, excluded, diag = _prepare(request)
        report.update(request=p, active_cell_ids=[template['grid']['cell_ids'][i] for i in indices], excluded=excluded, diagnostics=diag)
        baselode.geophysics.forward_common._bounded_json(report, 16777216, result=True, max_nodes=1000000)
    except (ValueError, TypeError, RecursionError, ArithmeticError, RuntimeError) as error:
        _error(report, error)
    return report


def _phi(residual, p, epsilon):
    residual = np.asarray(residual, dtype=float)
    if p == 2:
        return residual*residual
    logarithm = np.log1p((residual/epsilon)**2)
    a = .5*p*logarithm
    ratio = np.divide(np.expm1(a), a, out=np.ones_like(a), where=a != 0)
    return epsilon**p*logarithm*ratio


def _weights(residual, p, epsilon):
    return np.exp((.5*p-1)*np.log(np.asarray(residual)**2+epsilon**2))


def _evaluate(operator, z, arrays, regularization, penalty, stage):
    values = np.clip(arrays['reference']+arrays['scale']*z, arrays['physical_lower'], arrays['physical_upper'])
    predicted = operator@values
    residual = (predicted[arrays['order']]-arrays['data'])/arrays['sigma']
    edges = arrays['difference']@z
    objective = {'weighted_data': math.fsum(float(value)*float(value) for value in residual),
        'reference': regularization['reference_weight']*math.fsum(float(value) for value in _phi(z, penalty['model_p'], stage['model_epsilon'])),
        'smoothness': regularization['smoothness_weight']*math.fsum(float(value) for value in _phi(edges, penalty['gradient_p'], stage['gradient_epsilon']))}
    objective['total'] = math.fsum(objective.values())
    return predicted, residual, edges, objective


def _quadratic(arrays, operator, model_weights, edge_weights, data_frob_squared, condition_limit):
    difference = arrays['difference'];scale = arrays['scale'];order = arrays['order'];inverse_order = arrays['inverse_order'];sigma = arrays['sigma']
    n, m, edges = len(scale), len(sigma), len(edge_weights)
    row_norms = np.asarray(difference.multiply(difference).sum(axis=1)).ravel()
    factor = math.sqrt(data_frob_squared+float(np.sum(model_weights))+float(np.dot(edge_weights, row_norms)))
    condition = factor/math.sqrt(float(np.min(model_weights)))
    if not math.isfinite(condition) or condition > condition_limit:
        raise baselode.geophysics.corrections._NeedsInput('IRLS augmented quadratic condition upper bound exceeds limit')
    root_model, root_edges = np.sqrt(model_weights), np.sqrt(edge_weights)
    def matvec(v):
        v = np.asarray(v).reshape(-1)
        return np.concatenate([(operator@(scale*v))[order]/sigma, root_model*v, root_edges*(difference@v)])/factor
    def rmatvec(v):
        v = np.asarray(v).reshape(-1)
        return (scale*operator.rmatvec((v[:m]/sigma)[inverse_order])+root_model*v[m:m+n]+difference.T@(root_edges*v[m+n:]))/factor
    augmented = _spla.LinearOperator((m+n+edges, n), matvec=matvec, rmatvec=rmatvec, dtype=float)
    return augmented, factor, condition


def _solve(augmented, target, arrays, controls):
    try:
        result = _optimize.lsq_linear(augmented, target, bounds=(arrays['lower'], arrays['upper']), method='trf', lsq_solver='lsmr',
            tol=controls['tolerance'], lsmr_tol=controls['lsmr_tolerance'], max_iter=int(controls['max_iterations']), lsmr_maxiter=int(controls['max_inner_iterations']))
    except (ValueError, TypeError, ArithmeticError, RuntimeError, IndexError, Warning) as error:
        raise RuntimeError('IRLS inner solver execution failed: '+str(error)) from error
    if not all(hasattr(result, key) for key in ('x', 'success', 'status', 'nit', 'optimality', 'active_mask')):
        raise RuntimeError('incomplete IRLS inner solver result')
    z = np.asarray(result.x)
    if not result.success or result.status <= 0 or z.shape != arrays['reference'].shape or not np.all(np.isfinite(z)) or np.any(z < arrays['lower']) or np.any(z > arrays['upper']):
        raise RuntimeError('IRLS inner solver failed convergence/bounds/finiteness')
    if not math.isfinite(result.optimality) or np.asarray(result.active_mask).shape != z.shape or not np.all(np.isin(result.active_mask, [-1, 0, 1])):
        raise RuntimeError('malformed IRLS convergence/bound evidence')
    return result


def _projected(z, gradient, arrays):
    return float(np.max(np.abs(z-np.clip(z-gradient, arrays['lower'], arrays['upper']))))


def invert_sparse_potential_field(request):
    """Fit bounded sparse/compact models with explicit smoothed-Lp IRLS stages.

    Parameters
    ----------
    request : dict
        Same contract as validate_sparse_potential_field_inversion. z=(m-ref)/scale
        and q=Dz, where D embeds sqrt(edge.weight). For p>0,
        phi=(2/p)*((r*r+epsilon*epsilon)**(p/2)-epsilon**p); phi0=log1p((r/epsilon)**2)
        and phi2=r*r. Objective is supplied-sigma data SSE plus declared reference
        and smoothing weights times componentwise phi(z) and phi(q). Epsilon is
        fixed within each explicit stage. No automatic sparsity/depth prior.

    Returns
    -------
    dict
        Fitted replay/physical model/QC, actual objectives and fixed-epsilon
        monotonicity, true-penalty projected gradients, local quadratic weights,
        per-stage model path and work/convergence evidence. p<1 is nonconvex;
        componentwise J penalties can favour axes. Stationarity/compactness do
        not establish a local/global optimum, unique geology or uncertainty.
        Exhaustion or failed gates withhold all fitted products atomically.

    Raises
    ------
    ImportError
        Requires Python3.12+ and baselode[scalable].
    """
    baselode.geophysics.potential_field_operator._require_backend()
    report = _report('result')
    try:
        p, template, indices, excluded, diag = _prepare(request)
        arrays = baselode.geophysics._grid_inverse._arrays(p, template, diag)
        reference, scale, lower, upper, difference, order, inverse_order, sigma = (arrays[key] for key in ('reference', 'scale', 'lower', 'upper', 'difference', 'order', 'inverse_order', 'sigma'))
        regularization, penalty, controls = (p[key] for key in ('regularization', 'penalty', 'solver'))
        with warnings.catch_warnings():
            warnings.simplefilter('error')
            budget_template = {**template, 'execution': {**template['execution'], **p['execution']}}
            operator, norms, counter, adjoint = baselode.geophysics.potential_field_operator._build(budget_template, indices, diag)
            column_norms = norms((1/sigma)[inverse_order]);data_frob_squared = float(np.dot(column_norms*scale, column_norms*scale))
            reference_prediction = operator@reference
            data_target = (arrays['data']-reference_prediction[order])/sigma
            target_gradient = scale*operator.rmatvec((data_target/sigma)[inverse_order])
            z = np.clip((np.array(p['initial_values'])-reference)/scale, lower, upper)
            history, path = [], []
            initial_predicted = None
            quadratic = penalty['model_p'] == 2 and (regularization['smoothness_weight'] == 0 or penalty['gradient_p'] == 2)
            monotonicity_tolerance = 64*math.ulp(1.)
            for stage_index, stage in enumerate(penalty['stages']):
                predicted, residual, edges, objective = _evaluate(operator, z, arrays, regularization, penalty, stage)
                if initial_predicted is None:
                    initial_predicted = baselode.geophysics.potential_field_operator._prediction(template, predicted)
                history.append({'stage': stage_index, 'iteration': 0, **stage, 'objective': objective.copy(), 'scaled_step_max': None, 'projected_gradient': None, 'projected_gradient_threshold': None, 'inner_projected_gradient': None, 'inner_projected_gradient_threshold': None, 'augmented_condition_upper_bound': None, 'matrix_normalization': None, 'inner_iterations': None, 'inner_polish_iterations': None, 'backtracking_steps': None, 'accepted_fraction': None, 'operator_calls': counter.calls})
                converged = False
                for iteration in range(1, int(controls['max_outer_iterations'])+1):
                    model_weights = regularization['reference_weight']*_weights(z, penalty['model_p'], stage['model_epsilon'])
                    edge_weights = regularization['smoothness_weight']*_weights(edges, penalty['gradient_p'], stage['gradient_epsilon'])
                    augmented, factor, condition = _quadratic(arrays, operator, model_weights, edge_weights, data_frob_squared, controls['condition_limit'])
                    target = np.concatenate([data_target, np.zeros(len(z)+len(edges))])/factor
                    solution = _solve(augmented, target, arrays, controls)
                    values = np.clip(reference+scale*solution.x, [row['lower'] for row in p['parameters']], [row['upper'] for row in p['parameters']])
                    new_z = (values-reference)/scale
                    new_predicted, new_residual, new_edges, new_objective = _evaluate(operator, new_z, arrays, regularization, penalty, stage)
                    data_gradient = scale*operator.rmatvec((new_residual/sigma)[inverse_order])
                    inner_gradient = (data_gradient+model_weights*new_z+difference.T@(edge_weights*new_edges))/factor**2
                    inner_projected = _projected(new_z, inner_gradient, arrays)
                    inner_threshold = min(math.sqrt(controls['tolerance']), .1*controls['outer_tolerance'])*(1+float(np.max(np.abs(target_gradient/factor**2))))
                    polish_iterations = 0
                    # Frobenius normalization bounds ||A.T A|| by one. A clipped
                    # unit gradient step therefore decreases this quadratic.
                    while inner_projected > inner_threshold and polish_iterations < controls['max_polish_iterations']:
                        polished = np.clip(new_z-inner_gradient, lower, upper)
                        values = np.clip(reference+scale*polished, arrays['physical_lower'], arrays['physical_upper'])
                        new_z = (values-reference)/scale
                        new_predicted, new_residual, new_edges, new_objective = _evaluate(operator, new_z, arrays, regularization, penalty, stage)
                        data_gradient = scale*operator.rmatvec((new_residual/sigma)[inverse_order])
                        inner_gradient = (data_gradient+model_weights*new_z+difference.T@(edge_weights*new_edges))/factor**2
                        inner_projected = _projected(new_z, inner_gradient, arrays)
                        polish_iterations += 1
                    if not math.isfinite(inner_projected) or inner_projected > inner_threshold:
                        raise RuntimeError('IRLS quadratic projected gradient '+str(inner_projected)+' exceeds '+str(inner_threshold)+'; solver optimality='+str(solution.optimality))
                    proposal = new_z.copy()
                    accepted_fraction, backtracking_steps = 1., 0
                    while new_objective['total'] > objective['total']+monotonicity_tolerance*max(1., abs(objective['total']), abs(new_objective['total'])):
                        if backtracking_steps >= controls['max_backtracking_steps']:
                            raise RuntimeError('IRLS actual fixed-epsilon objective increased; backtracking exhausted')
                        accepted_fraction *= .5
                        blended = np.clip(z+accepted_fraction*(proposal-z), lower, upper)
                        values = np.clip(reference+scale*blended, arrays['physical_lower'], arrays['physical_upper'])
                        new_z = (values-reference)/scale
                        new_predicted, new_residual, new_edges, new_objective = _evaluate(operator, new_z, arrays, regularization, penalty, stage)
                        backtracking_steps += 1
                    if backtracking_steps:
                        data_gradient = scale*operator.rmatvec((new_residual/sigma)[inverse_order])
                    true_model_weights = regularization['reference_weight']*_weights(new_z, penalty['model_p'], stage['model_epsilon'])
                    true_edge_weights = regularization['smoothness_weight']*_weights(new_edges, penalty['gradient_p'], stage['gradient_epsilon'])
                    true_gradient = (data_gradient+true_model_weights*new_z+difference.T@(true_edge_weights*new_edges))/factor**2
                    projected = _projected(new_z, true_gradient, arrays)
                    threshold = controls['outer_tolerance']*(1+float(np.max(np.abs(target_gradient/factor**2))))
                    step = float(np.max(np.abs(new_z-z)));step_threshold = controls['outer_tolerance']*(1+float(np.max(np.abs(new_z))))
                    history.append({'stage': stage_index, 'iteration': iteration, **stage, 'objective': new_objective.copy(), 'scaled_step_max': step, 'projected_gradient': projected, 'projected_gradient_threshold': threshold, 'inner_projected_gradient': inner_projected, 'inner_projected_gradient_threshold': inner_threshold, 'augmented_condition_upper_bound': condition, 'matrix_normalization': factor, 'inner_iterations': int(solution.nit), 'inner_polish_iterations': polish_iterations, 'backtracking_steps': backtracking_steps, 'accepted_fraction': accepted_fraction, 'operator_calls': counter.calls})
                    z, predicted, residual, edges, objective = new_z, new_predicted, new_residual, new_edges, new_objective
                    if math.isfinite(projected) and projected <= threshold and (step <= step_threshold or quadratic):
                        converged = True
                        break
                if not converged:
                    raise RuntimeError('IRLS stage exhausted outer iterations without true-penalty/step convergence')
                path.append({'stage': stage_index, **stage, 'values': [float(value) for value in np.clip(reference+scale*z, arrays['physical_lower'], arrays['physical_upper'])], 'objective': objective.copy(), 'iterations': iteration})
            values = np.clip(reference+scale*z, [row['lower'] for row in p['parameters']], [row['upper'] for row in p['parameters']])
            ratio = baselode.geophysics.potential_field_operator._check_tmi(template, indices, diag, values, counter)
        predictions = baselode.geophysics.potential_field_operator._prediction(template, predicted)
        misfit = [baselode.geophysics.misfit.calculate_misfit(baselode.geophysics.inversion._misfit_request(observed, prediction)) for observed, prediction in zip(p['observed'], predictions)]
        if any(qc['state'] != 'ok' for qc in misfit):
            raise RuntimeError('IRLS fitted residual QC failed')
        report.update(request=p, active_cell_ids=[template['grid']['cell_ids'][i] for i in indices], excluded=excluded,
            parameters=[{**param, 'units': template['parameter_units'], 'value': float(value), 'active_bound': -1 if value == param['lower'] else (1 if value == param['upper'] else 0), 'weighted_column_norm': float(norm)} for param, value, norm in zip(p['parameters'], values, column_norms)],
            fitted_operator_request=baselode.geophysics._grid_inverse._fitted(template, indices, values), predicted=predictions, misfit=misfit,
            objective=objective, initial_predicted=initial_predicted, history=history, path=path,
            penalty_weights={'model': [float(value) for value in true_model_weights], 'gradient': [float(value) for value in true_edge_weights]},
            convergence={'success': True, 'stages': len(path), 'outer_iterations': sum(row['iterations'] for row in path), 'projected_gradient_polish_iterations': sum(row['inner_polish_iterations'] or 0 for row in history), 'backtracking_steps': sum(row['backtracking_steps'] or 0 for row in history), 'projected_gradient': projected, 'projected_gradient_threshold': threshold, 'matrix_normalization': factor, 'local_minimum_guaranteed': False, 'global_optimum_guaranteed': False, 'convex_objective': penalty['model_p'] >= 1 and (regularization['smoothness_weight'] == 0 or penalty['gradient_p'] >= 1)},
            diagnostics={**diag, 'adjoint_relative_error': adjoint, 'operator_calls': counter.calls, 'kernel_evaluations': counter.terms, 'augmented_condition_upper_bound': condition, 'condition_evidence': 'local_quadratic_Frobenius_over_min_sqrt_model_weight', 'data_rank': None, 'gradient_certificate': 'half_actual_objective_over_local_quadratic_Frobenius_squared', 'monotonicity_rounding_tolerance': monotonicity_tolerance, 'max_fitted_response_to_background_ratio': ratio},
            backend=baselode.geophysics.potential_field_operator._backend())
        baselode.geophysics.forward_common._bounded_json(report, 16777216, result=True, max_nodes=1000000)
    except (ValueError, TypeError, RecursionError, ArithmeticError, RuntimeError, Warning) as error:
        _error(report, RuntimeError(str(error)) if isinstance(error, Warning) else error)
    return report
