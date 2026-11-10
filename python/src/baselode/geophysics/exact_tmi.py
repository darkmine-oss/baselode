# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Exact total-field magnitude forward modelling and bounded nonlinear fits."""
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
import baselode.geophysics.magnetic_forward
import baselode.geophysics.misfit
import baselode.geophysics.potential_field_operator

_DESCRIPTORS = {kind: json.loads((pathlib.Path(__file__).parent/('geophysics_'+kind+'.json')).read_text()) for kind in ('exact_tmi_operator', 'exact_tmi_inversion')}


def _prepare(request, inverse=False):
    p = baselode.geophysics.forward_common._bounded_json(request, 8388608, max_nodes=300000)
    required = ['schema', 'version', 'operator_request', 'field_norm_floor_nT']
    if inverse:
        required += ['observed', 'parameters', 'regularization', 'solver', 'initial_values']
    baselode.geophysics.potential_field_operator._keys(p, required, ('metadata',))
    kind = 'exact_tmi_inversion' if inverse else 'exact_tmi_operator'
    if p['schema'] != 'baselode.geophysics.'+kind+'_request' or type(p['version']) not in (int, float) or p['version'] != 1:
        raise ValueError('unsupported exact-TMI schema/version')
    baselode.geophysics.forward_common._number(p['field_norm_floor_nT'], 1e-8, 1e6)
    if inverse:
        solver = p['solver']
        baselode.geophysics.potential_field_operator._keys(solver, ('method', 'tolerance', 'max_function_evaluations', 'lsmr_tolerance', 'max_inner_iterations', 'condition_limit'))
        if solver['method'] != 'trf_lsmr_exact_tmi':
            raise ValueError('exact TMI requires bounded trf_lsmr_exact_tmi')
        base = {key: value for key, value in p.items() if key not in ('field_norm_floor_nT', 'initial_values')}
        base['schema'] = 'baselode.geophysics.potential_field_grid_inversion_request'
        base['solver'] = {key: value for key, value in solver.items() if key not in ('method', 'max_function_evaluations')}
        base['solver'].update(method='trf_lsmr', max_iterations=solver['max_function_evaluations'])
        _, template, indices, excluded, diag = baselode.geophysics.potential_field_operator._prepare_inverse(base, exact_tmi=True)
        if type(p['initial_values']) is not list or len(p['initial_values']) != len(p['parameters']):
            raise ValueError('initial_values must follow every effective parameter')
        for value, parameter in zip(p['initial_values'], p['parameters']):
            baselode.geophysics.forward_common._number(value, parameter['lower'], parameter['upper'])
    else:
        template, indices, excluded, diag = baselode.geophysics.potential_field_operator._prepare(p['operator_request'], exact_tmi=True)
    if template['model_kind'] not in ('susceptibility', 'magnetic_vector') or template['channels'] != ['magnetic_tmi_anomaly']:
        raise ValueError('exact TMI requires susceptibility or Cartesian-J and one TMI channel')
    if 'metadata' in p:
        if type(p['metadata']) is not dict:
            raise ValueError('metadata must be object')
        baselode.geophysics.forward_common._bounded_json(p['metadata'], 131072)
    return p, template, indices, excluded, diag


def _report(kind, phase):
    result = baselode.geophysics.potential_field_operator._report(phase)
    result.update(schema='baselode.geophysics.'+kind+'_'+phase, linear_predicted=None, vector_fields=None, total_field_norms_nT=None)
    if kind == 'exact_tmi_inversion':
        result.update(parameters=[], fitted_forward_request=None, misfit=None, linear_misfit=None, objective=None, convergence=None, initial_predicted=None)
    return result


def _error(report, error):
    baselode.geophysics.potential_field_operator._error(report, error)
    report.update(linear_predicted=None, vector_fields=None, total_field_norms_nT=None)
    if 'parameters' in report:
        report.pop('fitted_operator_request', None)
        report.update(fitted_forward_request=None, linear_misfit=None, initial_predicted=None)


def describe_exact_tmi_operator():
    """Return copied exact-magnitude forward schemas and numerical assumptions.

    Returns
    -------
    dict
        Fixed-background exact TMI, field-zero guard and matrix-free resources.
    """
    return copy.deepcopy(_DESCRIPTORS['exact_tmi_operator'])


def describe_exact_tmi_inversion():
    """Return copied bounded nonlinear exact-TMI inversion contracts.

    Returns
    -------
    dict
        Explicit initial model, L2 priors, local stationarity and work policies.
    """
    return copy.deepcopy(_DESCRIPTORS['exact_tmi_inversion'])


def _validate(request, inverse):
    report = _report('exact_tmi_inversion' if inverse else 'exact_tmi_operator', 'validation')
    try:
        p, template, indices, excluded, diag = _prepare(request, inverse)
        report.update(request=p, active_cell_ids=[template['grid']['cell_ids'][i] for i in indices], excluded=excluded, diagnostics=diag)
        baselode.geophysics.forward_common._bounded_json(report, 16777216, result=True, max_nodes=1000000)
    except (ValueError, TypeError, RecursionError, ArithmeticError, RuntimeError) as error:
        _error(report, error)
    return report


def validate_exact_tmi_operator(request):
    """Validate fixed-background exact-magnitude requests without optional code.

    Parameters
    ----------
    request : dict
        V1 wrapper with operator_request and positive field_norm_floor_nT.
        Susceptibility or J, one TMI channel and explicit null weak cap required.

    Returns
    -------
    dict
        Atomic copied request and terrain/resource evidence. Actual total-field
        norms are checked during numerical execution, including every trial fit.
    """
    return _validate(request, False)


def validate_exact_tmi_inversion(request):
    """Validate a bounded nonlinear fit without running the optional backend.

    Parameters
    ----------
    request : dict
        V1 exact_tmi_inversion_request with initial_values in parameter order,
        supplied-sigma observations, explicit positive L2 reference/edges and
        bounded TRF/LSMR controls. Consult the descriptor for physical limits.

    Returns
    -------
    dict
        Atomic request/terrain/resource report; no convergence guarantee.
    """
    return _validate(request, True)


def _vector_operator(template, indices, diag):
    vector_request = {**template, 'channels': ['magnetic_bx', 'magnetic_by', 'magnetic_bz_up']}
    return baselode.geophysics.potential_field_operator._build(vector_request, indices, {**diag, 'observations': 3*diag['points']})


def _evaluate(operator, values, background, floor):
    vectors = np.asarray(operator@values).reshape((3, -1)).T
    total = vectors+background
    norms = np.hypot(np.hypot(total[:, 0], total[:, 1]), total[:, 2])
    if not np.all(np.isfinite(norms)) or np.any(norms < floor):
        raise baselode.geophysics.corrections._NeedsInput('total field falls below declared norm floor; exact TMI is nondifferentiable at zero')
    exact = np.array([baselode.geophysics.magnetic_forward._total_field(row, background) for row in vectors])
    linear = vectors@(background/np.linalg.norm(background))
    return exact, linear, vectors, norms, total/norms[:, None]


def _products(template, evaluated):
    exact, linear, vectors, norms, _ = evaluated
    return {'predicted': baselode.geophysics.potential_field_operator._prediction(template, exact),
            'linear_predicted': baselode.geophysics.potential_field_operator._prediction(template, linear),
            'vector_fields': [{'id': point['id'], 'bx_nT': float(row[0]), 'by_nT': float(row[1]), 'bz_up_nT': float(row[2])} for point, row in zip(template['points'], vectors)],
            'total_field_norms_nT': [float(value) for value in norms]}


def calculate_exact_tmi_operator(request):
    """Evaluate exact |B0+B(m)|-|B0| through the pinned matrix-free backend.

    Parameters
    ----------
    request : dict
        Same contract as validate_exact_tmi_operator. B0 is fixed in the known
        local frame; no weak-field approximation, demagnetisation or remanence
        decomposition is added. The full vector is superposed before magnitude.

    Returns
    -------
    dict
        Exact and separately labelled linear predictions, component fields,
        total norms, backend/work/adjoint evidence and replayable request.

    Raises
    ------
    ImportError
        Requires Python3.12+ and baselode[scalable].
    """
    baselode.geophysics.potential_field_operator._require_backend()
    report = _report('exact_tmi_operator', 'result')
    try:
        p, template, indices, excluded, diag = _prepare(request)
        with warnings.catch_warnings():
            warnings.simplefilter('error')
            operator, _, counter, adjoint = _vector_operator(template, indices, diag)
            background = np.array([template['background_nT'][key] for key in ('x', 'y', 'z_up')], dtype=float)
            evaluated = _evaluate(operator, baselode.geophysics.potential_field_operator._model(template, indices), background, p['field_norm_floor_nT'])
        report.update(request=p, active_cell_ids=[template['grid']['cell_ids'][i] for i in indices], excluded=excluded,
                      diagnostics={**diag, 'adjoint_relative_error': adjoint, 'operator_calls': counter.calls, 'kernel_evaluations': counter.terms},
                      backend=baselode.geophysics.potential_field_operator._backend(), **_products(template, evaluated))
        baselode.geophysics.forward_common._bounded_json(report, 16777216, result=True, max_nodes=1000000)
    except (ValueError, TypeError, RecursionError, ArithmeticError, RuntimeError, Warning) as error:
        _error(report, RuntimeError(str(error)) if isinstance(error, Warning) else error)
    return report


def _problem(p, template, indices, diag):
    arrays = baselode.geophysics._grid_inverse._arrays(p, template, diag)
    operator, norms, counter, adjoint = _vector_operator(template, indices, diag)
    background = np.array([template['background_nT'][key] for key in ('x', 'y', 'z_up')], dtype=float)
    sigma, order, inverse_order = (arrays[key] for key in ('sigma', 'order', 'inverse_order'))
    reference, scale, difference = (arrays[key] for key in ('reference', 'scale', 'difference'))
    weight, smooth = (p['regularization'][key] for key in ('reference_weight', 'smoothness_weight'))
    column_bounds = norms(np.tile((1/sigma)[inverse_order], 3))
    factor = math.sqrt(float(np.dot(column_bounds*scale, column_bounds*scale))+weight*len(scale)+smooth*float(np.dot(difference.data, difference.data)))
    condition = factor/math.sqrt(weight)
    if not math.isfinite(condition) or condition > p['solver']['condition_limit']:
        raise baselode.geophysics.corrections._NeedsInput('conservative augmented GaussNewton condition upper bound exceeds limit')
    cached = {}
    def evaluate(z):
        z = np.asarray(z).reshape(-1)
        if 'z' not in cached or not np.array_equal(z, cached['z']):
            cached['evaluated'] = _evaluate(operator, reference+scale*z, background, p['field_norm_floor_nT'])
            cached['z'] = z.copy()
        return cached['evaluated']
    def fun(z):
        exact = evaluate(z)[0]
        return np.concatenate([(exact[order]-arrays['data'])/sigma, math.sqrt(weight)*z, math.sqrt(smooth)*(difference@z)])/factor
    def jac(z):
        direction = evaluate(z)[4].copy()
        n, m, edges = len(scale), len(sigma), difference.shape[0]
        def matvec(v):
            v = np.asarray(v).reshape(-1)
            fields = np.asarray(operator@(scale*v)).reshape((3, -1)).T
            return np.concatenate([np.sum(direction*fields, axis=1)[order]/sigma, math.sqrt(weight)*v, math.sqrt(smooth)*(difference@v)])/factor
        def rmatvec(v):
            v = np.asarray(v).reshape(-1)
            field_weights = direction*((v[:m]/sigma)[inverse_order])[:, None]
            return (scale*operator.rmatvec(field_weights.T.ravel())+math.sqrt(weight)*v[m:m+n]+math.sqrt(smooth)*(difference.T@v[m+n:]))/factor
        return _spla.LinearOperator((m+n+edges, n), matvec=matvec, rmatvec=rmatvec, dtype=float)
    return arrays, fun, jac, evaluate, operator, column_bounds, counter, adjoint, factor, condition


def invert_exact_tmi(request):
    """Fit exact total-field magnitude using bounded matrix-free TRF/LSMR.

    Parameters
    ----------
    request : dict
        Same contract as validate_exact_tmi_inversion. The objective is supplied-
        sigma exact-TMI SSE plus explicit L2 scaled-reference and edge terms.
        Initial values are required. Every evaluated total field must exceed
        field_norm_floor_nT. Finite call/kernel and solver budgets apply jointly.

    Returns
    -------
    dict
        Fitted physical parameters and exact-forward replay, exact/linear QC,
        initial prediction, objective and independent projected-gradient evidence.
        Condition evidence bounds local augmented GaussNewton conditioning, not
        the exact Hessian. Stationarity establishes neither a local/global
        minimum nor unique geology; inspect residuals and alternative starts.

    Raises
    ------
    ImportError
        Requires Python3.12+ and baselode[scalable].
    """
    baselode.geophysics.potential_field_operator._require_backend()
    report = _report('exact_tmi_inversion', 'result')
    try:
        p, template, indices, excluded, diag = _prepare(request, True)
        with warnings.catch_warnings():
            warnings.simplefilter('error')
            arrays, fun, jac, evaluate, operator, column_bounds, counter, adjoint, factor, condition = _problem(p, template, indices, diag)
            reference, scale, lower, upper, difference = (arrays[key] for key in ('reference', 'scale', 'lower', 'upper', 'difference'))
            z0 = np.clip((np.array(p['initial_values'])-reference)/scale, lower, upper)
            initial = baselode.geophysics.potential_field_operator._prediction(template, evaluate(z0)[0])
            controls = p['solver']
            # SciPy's LSMR trust-region subspace assumes two model dimensions.
            # A one-parameter fit uses one explicit Jacobian column (not dense G).
            single = len(reference) == 1
            solver_jac = (lambda z: np.asarray(jac(z)@np.ones(1)).reshape((-1, 1))) if single else jac
            try:
                solution = _optimize.least_squares(fun, z0, jac=solver_jac, bounds=(lower, upper), method='trf', tr_solver='exact' if single else 'lsmr',
                    ftol=controls['tolerance'], xtol=controls['tolerance'], gtol=controls['tolerance'],
                    max_nfev=int(controls['max_function_evaluations']), x_scale=1.,
                    tr_options={} if single else {'atol': controls['lsmr_tolerance'], 'btol': controls['lsmr_tolerance'], 'maxiter': int(controls['max_inner_iterations'])})
            except (ValueError, TypeError, ArithmeticError, RuntimeError, IndexError, Warning) as error:
                raise RuntimeError('exact-TMI solver execution failed: '+str(error)) from error
            if not all(hasattr(solution, key) for key in ('x', 'success', 'status', 'active_mask', 'nfev', 'njev', 'optimality')):
                raise RuntimeError('incomplete exact-TMI solver result')
            z = np.asarray(solution.x)
            if not solution.success or solution.status <= 0 or z.shape != reference.shape or not np.all(np.isfinite(z)) or np.any(z < lower) or np.any(z > upper):
                raise RuntimeError('exact-TMI solver failed convergence/bounds/finiteness')
            if not math.isfinite(solution.optimality) or np.asarray(solution.active_mask).shape != z.shape or not np.all(np.isin(solution.active_mask, [-1, 0, 1])):
                raise RuntimeError('malformed nonlinear convergence/bound flags')
            values = np.clip(reference+scale*z, [row['lower'] for row in p['parameters']], [row['upper'] for row in p['parameters']])
            z = (values-reference)/scale
            residual = fun(z)
            gradient = jac(z).rmatvec(residual)
            projected = float(np.max(np.abs(z-np.clip(z-gradient, lower, upper))))
            threshold = 10*controls['tolerance']*(1+float(np.linalg.norm(residual)))
            if not math.isfinite(projected) or projected > threshold:
                raise RuntimeError('exact-TMI solver failed independent projected-gradient gate')
            evaluated = evaluate(z)
        products = _products(template, evaluated)
        misfit = [baselode.geophysics.misfit.calculate_misfit(baselode.geophysics.inversion._misfit_request(observed, predicted)) for observed, predicted in zip(p['observed'], products['predicted'])]
        linear_misfit = [baselode.geophysics.misfit.calculate_misfit(baselode.geophysics.inversion._misfit_request(observed, predicted)) for observed, predicted in zip(p['observed'], products['linear_predicted'])]
        if any(qc['state'] != 'ok' for qc in misfit+linear_misfit):
            raise RuntimeError('exact/linear residual QC failed')
        fitted = baselode.geophysics._grid_inverse._fitted(template, indices, values)
        objective = {'weighted_data': math.fsum(qc['summary']['statistics']['chi_squared'] for qc in misfit),
                     'reference': p['regularization']['reference_weight']*float(np.dot(z, z)),
                     'smoothness': p['regularization']['smoothness_weight']*float(np.dot(difference@z, difference@z))}
        objective['total'] = math.fsum(objective.values())
        report.update(request=p, active_cell_ids=[template['grid']['cell_ids'][i] for i in indices], excluded=excluded,
            parameters=[{**param, 'units': template['parameter_units'], 'value': float(value), 'active_bound': int(bound), 'weighted_column_norm_upper_bound': float(norm)} for param, value, bound, norm in zip(p['parameters'], values, solution.active_mask, column_bounds)],
            fitted_forward_request={'schema': 'baselode.geophysics.exact_tmi_operator_request', 'version': 1, 'operator_request': fitted, 'field_norm_floor_nT': p['field_norm_floor_nT']},
            misfit=misfit, linear_misfit=linear_misfit, initial_predicted=initial, objective=objective,
            convergence={'success': True, 'status': int(solution.status), 'function_evaluations': int(solution.nfev), 'jacobian_evaluations': int(solution.njev), 'optimality': float(solution.optimality), 'projected_gradient': projected, 'projected_gradient_threshold': threshold, 'matrix_normalization': factor, 'solver_backend': 'trf_exact_single_column' if single else 'trf_lsmr', 'local_minimum_guaranteed': False, 'global_optimum_guaranteed': False},
            diagnostics={**diag, 'adjoint_relative_error': adjoint, 'operator_calls': counter.calls, 'kernel_evaluations': counter.terms, 'augmented_gauss_newton_condition_upper_bound': condition, 'condition_evidence': 'vector_Frobenius_upper_bound_over_sqrt_reference_weight', 'data_rank': None},
            backend=baselode.geophysics.potential_field_operator._backend(), **products)
        baselode.geophysics.forward_common._bounded_json(report, 16777216, result=True, max_nodes=1000000)
    except (ValueError, TypeError, RecursionError, ArithmeticError, RuntimeError, Warning) as error:
        _error(report, RuntimeError(str(error)) if isinstance(error, Warning) else error)
    return report
