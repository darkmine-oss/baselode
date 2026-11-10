# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Registered bounded model/prediction sensitivity ensembles with saved noise."""
import copy
import json
import math
import pathlib
import numpy as np
import baselode.geophysics._ensemble_common
import baselode.geophysics.corrections
import baselode.geophysics.forward_common
import baselode.geophysics.gravity_prisms
import baselode.geophysics.potential_field_operator

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent/'geophysics_potential_field_ensemble.json').read_text())
_REGISTRY = {
    'potential_field_grid_inversion': {'validate': 'validate_potential_field_grid_inversion', 'run': 'invert_potential_field_grid', 'forward': 'calculate_potential_field_operator', 'forward_validate': 'validate_potential_field_operator', 'fitted': 'fitted_operator_request'},
    'exact_tmi_inversion': {'validate': 'validate_exact_tmi_inversion', 'run': 'invert_exact_tmi', 'forward': 'calculate_exact_tmi_operator', 'forward_validate': 'validate_exact_tmi_operator', 'fitted': 'fitted_forward_request'},
    'sparse_potential_field_inversion': {'validate': 'validate_sparse_potential_field_inversion', 'run': 'invert_sparse_potential_field', 'forward': 'calculate_potential_field_operator', 'forward_validate': 'validate_potential_field_operator', 'fitted': 'fitted_operator_request'},
}
_GEOMETRY = ('model_kind', 'parameter_units', 'field_type', 'coordinate_frame', 'reference_id', 'grid', 'points', 'channels', 'background_nT', 'min_distance_m')


def _budget(request, operation):
    return request['execution'] if operation == 'sparse_potential_field_inversion' else request['operator_request']['execution']


def _prepare(request):
    p = baselode.geophysics._ensemble_common._json(request)
    baselode.geophysics._ensemble_common._keys(p, ('schema', 'version', 'operation', 'members', 'options', 'execution'), ('metadata',))
    if p['schema'] != 'baselode.geophysics.potential_field_ensemble_request' or type(p['version']) not in (int, float) or p['version'] != 1:raise ValueError('unsupported model ensemble schema/version')
    if p['operation'] not in _REGISTRY:raise ValueError('unregistered ensemble operation')
    members = p['members']
    if type(members) is not list or not 1 <= len(members) <= 16:raise ValueError('declare one to sixteen members')
    execution = p['execution'];baselode.geophysics._ensemble_common._keys(execution, ('allocation_policy', 'max_operator_calls', 'max_kernel_evaluations'))
    if execution['allocation_policy'] != 'equal_reservations':raise ValueError('declare equal_reservations allocation')
    total_calls = baselode.geophysics._ensemble_common._integer(execution['max_operator_calls'], 1, 262144)
    total_terms = baselode.geophysics._ensemble_common._integer(execution['max_kernel_evaluations'], 1, 1000000000)
    share_calls, share_terms = total_calls//len(members), total_terms//len(members)
    options = p['options'];baselode.geophysics._ensemble_common._keys(options, ('failure_policy', 'minimum_successful_members', 'quantiles', 'model_sign_threshold', 'magnetization_direction_min_amplitude_A_m', 'anomaly_thresholds'), nullable=('magnetization_direction_min_amplitude_A_m',))
    baselode.geophysics._ensemble_common._failure_options(options, len(members))
    seen, plans, geometry, template = set(), [], None, None
    totals = {'parameters': 0, 'observations': 0, 'edges': 0, 'total_cells': 0}
    validator = getattr(baselode.geophysics, _REGISTRY[p['operation']]['validate'])
    for member in members:
        baselode.geophysics._ensemble_common._keys(member, ('id', 'request', 'noise'))
        baselode.geophysics.forward_common._label(member['id'])
        if member['id'] in seen:raise ValueError('duplicate member ID')
        seen.add(member['id']);baselode.geophysics._ensemble_common._noise(member['noise'])
        validation = validator(member['request']);baselode.geophysics._ensemble_common._raise(validation)
        operator = member['request']['operator_request'];current = {key: operator[key] for key in _GEOMETRY}
        if geometry is not None and current != geometry:raise baselode.geophysics.corrections._NeedsInput('members require identical fixed grid, points, channels, background, frame and reference')
        geometry, template = current, operator
        diag = validation['diagnostics']
        for key in ('parameters', 'observations', 'total_cells'):totals[key] += diag[key]
        totals['edges'] += len(member['request']['regularization']['edges'])
        effective = copy.deepcopy(member['request']);budget = _budget(effective, p['operation'])
        budget['max_operator_calls'] = min(int(budget['max_operator_calls']), share_calls)
        budget['max_kernel_evaluations'] = min(int(budget['max_kernel_evaluations']), share_terms)
        # All three pinned families have known nonzero fixed execution work.
        if p['operation'] == 'exact_tmi_inversion':minimum_calls, minimum_terms = 6, 18*diag['active_cells']*diag['points']*len(baselode.geophysics.potential_field_operator._config(operator['model_kind'])[0])
        else:
            minimum_calls = (5+5*len(effective['penalty']['stages'])) if p['operation'] == 'sparse_potential_field_inversion' else 10
            extra = 'magnetic_tmi_anomaly' in operator['channels'];minimum_terms = (minimum_calls+(9 if extra else 0))*diag['active_cells']*diag['observations']*len(baselode.geophysics.potential_field_operator._config(operator['model_kind'])[0]);minimum_calls += 3 if extra else 0
        if budget['max_operator_calls'] < minimum_calls or budget['max_kernel_evaluations'] < minimum_terms:raise baselode.geophysics.corrections._ResourceError('equal member reservation cannot cover known minimum work')
        baselode.geophysics._ensemble_common._raise(validator(effective))
        plans.append({'id': member['id'], 'request': effective, 'max_operator_calls': int(budget['max_operator_calls']), 'max_kernel_evaluations': int(budget['max_kernel_evaluations'])})
    for key, maximum in [('parameters', 12288), ('observations', 8192), ('edges', 8192), ('total_cells', 8192)]:
        if totals[key] > maximum:raise baselode.geophysics.corrections._ResourceError('ensemble aggregate '+key+' budget exceeded')
    baselode.geophysics._ensemble_common._metadata(p, 65536)
    sign = options['model_sign_threshold'];baselode.geophysics._ensemble_common._keys(sign, ('units', 'value'))
    if sign['units'] != template['parameter_units']:raise baselode.geophysics.corrections._NeedsInput('model threshold units must match physical parameters')
    baselode.geophysics.forward_common._number(sign['value'], 0, max(abs(x) for x in baselode.geophysics.potential_field_operator._config(template['model_kind'])[1]))
    direction = options['magnetization_direction_min_amplitude_A_m']
    if template['model_kind'] == 'magnetic_vector':baselode.geophysics.forward_common._number(direction, 0, 2000)
    elif direction is not None:raise ValueError('non-vector models require explicit null direction floor')
    if type(options['anomaly_thresholds']) is not list or len(options['anomaly_thresholds']) != len(template['channels']):raise ValueError('declare one threshold per channel')
    for value, channel in zip(options['anomaly_thresholds'], template['channels']):baselode.geophysics._ensemble_common._threshold(value, channel, 'mGal' if template['model_kind'] == 'density' else 'nT')
    return p, plans, template, totals


def _report(phase):
    return {'schema': 'baselode.geophysics.potential_field_ensemble_'+phase, 'version': 1, 'state': 'ok', 'issues': [], 'request': None, 'members': [], 'statistics': None, 'coverage': None, 'budget': None, 'diagnostics': {}, 'producer': baselode.geophysics.corrections._producer()}


def _error(report, error):
    baselode.geophysics.gravity_prisms._error(report, error)
    report.update(members=[], statistics=None, coverage=None, budget=None)


def describe_potential_field_ensemble():
    """Return copied registered model-ensemble contracts and coverage semantics.

    Returns
    -------
    dict
        Explicit operations/noise/quotas/empirical statistics and finite limits.
    """
    return copy.deepcopy(_DESCRIPTOR)


def validate_potential_field_ensemble(request):
    """Preflight all comparable members and reservations without numerical work.

    Parameters
    ----------
    request : dict
        V1 potential_field_ensemble_request, one registered operation, fixed
        geometry/context and explicit complete member requests/noise/options.

    Returns
    -------
    dict
        Atomic manifest and equal reservations; no convergence/uncertainty inferred.
    """
    report = _report('validation')
    try:
        p, plans, _, totals = _prepare(request)
        report.update(request=p, budget={'allocations': [{key: value for key, value in plan.items() if key != 'request'} for plan in plans]}, diagnostics=totals)
        baselode.geophysics._ensemble_common._json(report, True)
    except (ValueError, TypeError, RecursionError, ArithmeticError, RuntimeError) as error:_error(report, error)
    return report


def _noise(request, spec):
    result = copy.deepcopy(request);draws = [];lost = 0
    if spec['kind'] == 'independent_gaussian':
        rng = np.random.Generator(np.random.PCG64(int(spec['seed'])))
        for quantity, dataset in zip(result['operator_request']['channels'], result['observed']):
            lookup = {row['id']: row for row in dataset['records']}
            for point in result['operator_request']['points']:
                row = lookup[point['id']];standard = float(rng.standard_normal());delta = standard*float(row['standard_deviation']);old = float(row['value']);row['value'] = old+delta;realized = row['value']-old
                lost += int(delta != 0 and realized == 0)
                draws.append({'quantity': quantity, 'id': point['id'], 'standard_normal': standard, 'intended_delta': delta, 'realized_delta': realized})
    return result, {'kind': spec['kind'], 'seed': spec['seed'], 'algorithm': 'numpy.PCG64.standard_normal' if spec['kind'] != 'none' else None, 'numpy_version': np.__version__, 'draws': draws, 'rounding_lost_perturbations': lost}


def _extract(result, request, plan, operation):
    if type(result) is not dict or result.get('state') != 'ok':raise RuntimeError('malformed successful member result')
    if not all(key in result for key in ('diagnostics','objective','convergence','backend','producer',_REGISTRY[operation]['fitted'])):raise RuntimeError('incomplete successful member result')
    diag = result.get('diagnostics', {})
    if any(type(result[key]) is not dict for key in ('diagnostics','objective','convergence','backend','producer')) or result['convergence'].get('success') is not True:raise RuntimeError('malformed member convergence/usage evidence')
    calls = baselode.geophysics._ensemble_common._integer(diag.get('operator_calls'), 0, plan['max_operator_calls'])
    terms = baselode.geophysics._ensemble_common._integer(diag.get('kernel_evaluations'), 0, plan['max_kernel_evaluations'])
    if type(result.get('parameters')) is not list or len(result['parameters']) != len(request['parameters']):raise RuntimeError('member model shape mismatch')
    parameters = []
    for row, expected in zip(result['parameters'], request['parameters']):
        if type(row) is not dict or any(row.get(key) != expected[key] for key in ('cell_id', 'parameter')) or row.get('units') != request['operator_request']['parameter_units']:raise RuntimeError('member model identity/units mismatch')
        baselode.geophysics.forward_common._number(row.get('value'), expected['lower'], expected['upper'])
        for key in ('lower','upper','reference','scale'):
            baselode.geophysics.forward_common._number(row.get(key), -1e100, 1e100)
            if row[key] != expected[key]:raise RuntimeError('member parameter declaration mismatch')
        baselode.geophysics._ensemble_common._integer(row.get('active_bound'), -1, 1)
        norm_key = 'weighted_column_norm_upper_bound' if operation == 'exact_tmi_inversion' else 'weighted_column_norm'
        baselode.geophysics.forward_common._number(row.get(norm_key), 0, 1e100)
        parameters.append(copy.deepcopy(row))
    predicted = result.get('predicted');op = request['operator_request']
    if type(predicted) is not list or len(predicted) != len(op['channels']):raise RuntimeError('member prediction shape mismatch')
    for dataset, channel in zip(predicted, op['channels']):
        if type(dataset) is not dict or dataset.get('context') != baselode.geophysics.potential_field_operator._context(op, channel) or type(dataset.get('records')) is not list or len(dataset['records']) != len(op['points']):raise RuntimeError('member prediction context/coverage mismatch')
        for row, point in zip(dataset['records'], op['points']):
            if type(row) is not dict or any(row.get(key) != point[key] for key in point):raise RuntimeError('member prediction ID/coordinates mismatch')
            for key in ('x_m','y_m','z_m'):baselode.geophysics.forward_common._number(row.get(key), -1e9, 1e9)
            baselode.geophysics.forward_common._number(row.get('value'), -1e100, 1e100)
    if type(result.get(_REGISTRY[operation]['fitted'])) is not dict:raise RuntimeError('missing member fitted replay')
    forward_validation = getattr(baselode.geophysics, _REGISTRY[operation]['forward_validate'])(result[_REGISTRY[operation]['fitted']])
    if forward_validation['state'] != 'ok':raise RuntimeError('member fitted forward replay failed validation')
    return parameters, copy.deepcopy(predicted), calls, terms


def _statistics(members, options, template):
    good = [row for row in members if row['state'] == 'ok'];quantiles = options['quantiles'];model = []
    for index, identity in enumerate(good[0]['parameters']):
        values = [row['parameters'][index]['value'] for row in good];threshold = options['model_sign_threshold']['value'];positive = sum(value > threshold for value in values);negative = sum(value < -threshold for value in values)
        model.append({'cell_id': identity['cell_id'], 'parameter': identity['parameter'], 'units': identity['units'], **baselode.geophysics._ensemble_common._stats(values, quantiles), 'positive_count': positive, 'negative_count': negative, 'neutral_count': len(values)-positive-negative, 'positive_fraction_successful': positive/len(values), 'negative_fraction_successful': negative/len(values)})
    fields = []
    for j, threshold in enumerate(options['anomaly_thresholds']):
        rows = []
        for i, point in enumerate(template['points']):
            values = [row['predicted'][j]['records'][i]['value'] for row in good];hits = sum(baselode.geophysics._ensemble_common._hit(value, threshold) for value in values)
            rows.append({**point, **baselode.geophysics._ensemble_common._stats(values, quantiles), 'detection_count': hits, 'non_detection_count': len(values)-hits, 'unknown_members': len(members)-len(values), 'detection_fraction_successful': hits/len(values), 'coverage_fraction_requested': len(values)/len(members)})
        fields.append({'context': copy.deepcopy(good[0]['predicted'][j]['context']), 'threshold': copy.deepcopy(threshold), 'records': rows})
    magnetization = None
    if template['model_kind'] == 'magnetic_vector':
        magnetization = []
        for index in range(0, len(model), 3):
            vectors = [[row['parameters'][index+j]['value'] for j in range(3)] for row in good];amplitudes = [math.hypot(*v) for v in vectors];eligible = [i for i, a in enumerate(amplitudes) if a > options['magnetization_direction_min_amplitude_A_m']]
            mean = [math.fsum(vectors[i][j]/amplitudes[i] for i in eligible)/len(eligible) for j in range(3)] if eligible else None
            length = math.hypot(*mean) if mean is not None else None
            magnetization.append({'cell_id': model[index]['cell_id'], 'amplitude_A_m': baselode.geophysics._ensemble_common._stats(amplitudes, quantiles), 'direction': {'minimum_amplitude_A_m': options['magnetization_direction_min_amplitude_A_m'], 'eligible_members': len(eligible), 'excluded_low_amplitude_members': len(good)-len(eligible), 'eligible_member_ids': [good[i]['id'] for i in eligible], 'mean_unit_vector': dict(zip(('x', 'y', 'z_up'), mean)) if mean is not None else None, 'resultant_length': min(1., length) if length is not None else None, 'resultant_rounding_clamped': length is not None and length > 1}})
    return {'model': model, 'fields': fields, 'magnetization': magnetization, 'interpretation': 'empirical sensitivity of declared successful scenarios; not posterior uncertainty or mineralisation probability'}


def run_potential_field_ensemble(request):
    """Run registered fixed-geometry inversions with saved perturbations/quotas.

    Parameters
    ----------
    request : dict
        Same contract as validate_potential_field_ensemble. Noise uses supplied
        independent sigma in canonical channel/point order; repeated seeds allow
        paired scenarios. Equal reservations are never redistributed. Successful
        work is measured; numerical failures conservatively consume reservation.

    Returns
    -------
    dict
        All outcomes, actual perturbed/capped child requests and forward replays,
        coverage, work ledger and empirical model/field/vector summaries. Partial
        statistics require explicit collect policy and minimum successful count.
        Failed/unknown members are never counted as non-detections. Sample SD is
        null with one success; these are not posterior/ore probabilities.

    Raises
    ------
    ImportError
        Requires Python3.12+ and baselode[scalable].
    """
    baselode.geophysics.potential_field_operator._require_backend();report = _report('result')
    try:
        p, plans, template, totals = _prepare(request);members = [];aborted = False
        registry = _REGISTRY[p['operation']];validator = getattr(baselode.geophysics, registry['validate']);execute = getattr(baselode.geophysics, registry['run'])
        for original, plan in zip(p['members'], plans):
            row = {'id': original['id'], 'state': 'not_run', 'issues': [], 'executed_request': None, 'noise': None, 'parameters': [], 'predicted': None, 'forward_replay': None, 'objective': None, 'convergence': None, 'diagnostics': {}, 'backend': None, 'producer': None, 'budget': {'reserved_operator_calls': plan['max_operator_calls'], 'reserved_kernel_evaluations': plan['max_kernel_evaluations'], 'charged_operator_calls': 0, 'charged_kernel_evaluations': 0, 'usage_exact': True, 'execution_attempted': False}}
            members.append(row)
            if aborted:
                row['issues'] = [{'code': 'aborted', 'message': 'not run after prior member failure'}];continue
            actual, noise = _noise(plan['request'], original['noise']);row.update(executed_request=actual, noise=noise)
            validation = validator(actual)
            if validation['state'] != 'ok':row.update(state=validation['state'], issues=copy.deepcopy(validation['issues']))
            else:
                row['budget'].update(execution_attempted=True, usage_exact=False, charged_operator_calls=plan['max_operator_calls'], charged_kernel_evaluations=plan['max_kernel_evaluations'])
                try:
                    result = execute(actual)
                    if type(result) is not dict or result.get('state') not in ('ok', 'needs_input', 'rejected', 'failed'):raise RuntimeError('malformed member result state')
                    if result['state'] != 'ok':row.update(state=result['state'], issues=copy.deepcopy(result.get('issues', [])))
                    else:
                        parameters, predicted, calls, terms = _extract(result, actual, plan, p['operation'])
                        row.update(state='ok', parameters=parameters, predicted=predicted, forward_replay={'method': registry['forward'], 'request': copy.deepcopy(result[registry['fitted']])}, objective=copy.deepcopy(result['objective']), convergence=copy.deepcopy(result['convergence']), diagnostics=copy.deepcopy(result['diagnostics']), backend=copy.deepcopy(result['backend']), producer=copy.deepcopy(result['producer']))
                        row['budget'].update(charged_operator_calls=calls, charged_kernel_evaluations=terms, usage_exact=True)
                except (ValueError, TypeError, ArithmeticError, RuntimeError, Warning) as error:row.update(state='failed', issues=[{'code': 'member_execution', 'message': str(error)}])
            if row['state'] != 'ok' and p['options']['failure_policy'] == 'abort':aborted = True
        state, coverage = baselode.geophysics._ensemble_common._completion(members, p['options'])
        budget = {'allocation_policy': 'equal_reservations', 'limits': copy.deepcopy(p['execution']), **{key: sum(row['budget'][key] for row in members) for key in ('reserved_operator_calls', 'reserved_kernel_evaluations', 'charged_operator_calls', 'charged_kernel_evaluations')}}
        if budget['charged_operator_calls'] > p['execution']['max_operator_calls'] or budget['charged_kernel_evaluations'] > p['execution']['max_kernel_evaluations']:raise RuntimeError('ensemble work accounting exceeded global limit')
        report.update(state=state, request=p, members=members, coverage=coverage, budget=budget, statistics=_statistics(members, p['options'], template) if state != 'failed' else None, diagnostics={**totals, 'reused_seeds': baselode.geophysics._ensemble_common._reused_seeds(p['members']), 'noise_order': 'declared_channels_then_declared_point_ids', 'random_replay_policy': 'actual executed requests retain draws; cross-NumPy random sequence not guaranteed'})
        if state != 'ok':report['issues'] = [{'code': 'member_coverage', 'message': 'inspect member outcomes and explicit successful/requested denominators'}]
        baselode.geophysics._ensemble_common._json(report, True)
    except (ValueError, TypeError, RecursionError, ArithmeticError, RuntimeError, Warning) as error:_error(report, RuntimeError(str(error)) if isinstance(error, Warning) else error)
    return report
