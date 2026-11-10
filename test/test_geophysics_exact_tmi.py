# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Exact magnitude physics, nonlinear Jacobian, recovery and portable contracts."""
import copy
import json
import math
import pathlib
import subprocess
import sys
import types
import jsonschema
import numpy as np
import pytest
import baselode.geophysics
import baselode.geophysics.exact_tmi

ROOT = pathlib.Path(__file__).resolve().parents[1]


def request(inverse=False):
    return json.loads((ROOT/('test/data/exact_tmi_'+('inversion' if inverse else 'operator')+'_example.json')).read_text())


def supported():
    if sys.version_info >= (3, 12):
        return True
    with pytest.raises(ImportError, match='Python>=3.12'):
        baselode.geophysics.calculate_exact_tmi_operator(request())
    return False


def run(p, inverse=False):
    r = getattr(baselode.geophysics, 'invert_exact_tmi' if inverse else 'calculate_exact_tmi_operator')(p)
    assert r['state'] == 'ok', r['issues']
    return r


def factor():
    return (math.atan(1/math.sqrt(3))-math.atan(2500/(150*math.sqrt(27500))))/math.pi


def observed(p):
    return [{'context': d['context'], 'records': [{**row, 'standard_deviation': .01*(1+i/10), 'group_id': None} for i, row in reversed(list(enumerate(d['records'])))]} for d in run(p)['predicted']]


def test_analytic_cube_exact_forward_and_recovery_replay_schema():
    if not supported():return
    p = request();before = copy.deepcopy(p);r = run(p)
    k = 1.25663706127e-6*1e9*factor();expected = math.hypot(-2.5*k, 1.5*k, 1000+10*k)-1000
    assert r['predicted'][0]['records'][1]['value'] == pytest.approx(expected, rel=1e-13)
    assert r['predicted'][0]['records'][1]['value'] != pytest.approx(r['linear_predicted'][0]['records'][1]['value'], rel=1e-4)
    assert p == before
    q = request(True);s = run(q, True)
    assert [row['value'] for row in s['parameters']] == pytest.approx([5, -3, 10], rel=1e-8, abs=1e-8)
    assert s['objective']['weighted_data'] < 1e-12
    assert s['linear_misfit'][0]['summary']['statistics']['chi_squared'] > 1000
    assert not s['convergence']['local_minimum_guaranteed'] and not s['convergence']['global_optimum_guaranteed']
    assert run(s['fitted_forward_request'])['predicted'] == s['predicted']
    for kind, payload, result in [('exact_tmi_operator', p, r), ('exact_tmi_inversion', q, s)]:
        d = getattr(baselode.geophysics, 'describe_'+kind)()
        jsonschema.validate(payload, d['request_schema']);jsonschema.validate(result, d['result_schema'])
        validation = getattr(baselode.geophysics, 'validate_'+kind)(payload)
        jsonschema.validate(validation, d['result_schema'])


def test_exact_jacobian_directional_finite_difference_adjoint_and_matmat_with_edges():
    if not supported():return
    p = request(True);op = p['operator_request'];op['grid'].update(shape=[2, 1, 1], cell_ids=['body', 'other'], active=[True, True]);op['values'] = [0]*6
    p['parameters'] += [dict(row, cell_id='other') for row in copy.deepcopy(p['parameters'])];p['initial_values'] = [0]*6
    p['regularization'].update(smoothness_weight=.3, edges=[{'cell_a': 'body', 'cell_b': 'other', 'weight': 2.4}])
    prepared, template, indices, excluded, diag = baselode.geophysics.exact_tmi._prepare(p, True)
    arrays, fun, jac, *_ = baselode.geophysics.exact_tmi._problem(prepared, template, indices, diag)
    z = np.arange(6)/10;v = np.cos(np.arange(6));h = 1e-6
    a = jac(z);finite = (fun(z+h*v)-fun(z-h*v))/(2*h)
    assert a@v == pytest.approx(finite, rel=2e-7, abs=1e-9)
    y = np.sin(np.arange(len(finite))+1)
    assert np.dot(a@v, y) == pytest.approx(np.dot(v, a.rmatvec(y)), rel=1e-12, abs=1e-12)
    matrix = np.column_stack([v, -2*v]);assert a@matrix == pytest.approx(np.column_stack([a@v, -2*(a@v)]), rel=1e-13, abs=1e-13)


def test_scalar_susceptibility_exact_field_and_strong_precision_fit():
    if not supported():return
    fw = request();fw['operator_request'].update(model_kind='susceptibility', parameter_units='dimensionless', values=[.08], background_nT={'x': 5000, 'y': 10000, 'z_up': 40000})
    k = factor();bg = np.array([5000, 10000, 40000]);field = .08*k*bg*np.array([-.5, -.5, 1])
    actual = run(fw)['predicted'][0]['records'][1]['value'];assert actual == pytest.approx(float(np.linalg.norm(bg+field)-np.linalg.norm(bg)), rel=1e-12)
    p = request(True);p['operator_request'] = copy.deepcopy(fw['operator_request']);p['operator_request']['values'] = [0];p['observed'] = observed(fw);p['initial_values'] = [.01]
    p['parameters'] = [{'cell_id': 'body', 'parameter': 'susceptibility_SI', 'lower': -.1, 'upper': .1, 'reference': 0, 'scale': .1}]
    r = run(p, True);assert r['parameters'][0]['value'] == pytest.approx(.08, rel=1e-8);assert r['linear_misfit'][0]['summary']['statistics']['chi_squared'] > 100
    assert r['convergence']['solver_backend']=='trf_exact_single_column'
    p['parameters'][0]['upper']=.05;bounded=run(p,True);assert bounded['parameters'][0]['value']==pytest.approx(.05,abs=1e-9);assert bounded['objective']['weighted_data']>1


def test_weak_limit_matches_linear_and_prior_selected_nonuniqueness_is_explicit():
    if not supported():return
    fw = request();fw['operator_request'].update(values=[1e-5, -2e-5, 3e-5], background_nT={'x': 0, 'y': 0, 'z_up': 50000})
    r = run(fw);assert [row['value'] for row in r['predicted'][0]['records']] == pytest.approx([row['value'] for row in r['linear_predicted'][0]['records']], abs=1e-9)
    p = request(True);p['operator_request']['points'] = [p['operator_request']['points'][1]];p['observed'][0]['records'] = [next(row for row in p['observed'][0]['records'] if row['id'] == '1')]
    a = run(p, True);other = copy.deepcopy(p);other['parameters'][0]['reference'] = 15;other['initial_values'] = [15, 0, 0];b = run(other, True)
    assert a['diagnostics']['data_rank'] is None and b['diagnostics']['data_rank'] is None
    assert abs(a['parameters'][0]['value']-b['parameters'][0]['value']) > 1
    assert a['objective']['weighted_data'] < 1e-8 and b['objective']['weighted_data'] < 1e-8


def test_failure_budgets_nonconvergence_and_total_field_zero_withhold_products():
    if not supported():return
    p = request(True);p['solver']['max_function_evaluations'] = 1
    r = baselode.geophysics.invert_exact_tmi(p);assert r['state'] == 'failed' and r['parameters'] == [] and r['fitted_forward_request'] is None and r['predicted'] is None
    p = request(True);p['operator_request']['execution']['max_operator_calls'] = 4
    r = baselode.geophysics.invert_exact_tmi(p);assert r['state'] == 'failed' and r['linear_misfit'] is None
    p = request();p['operator_request']['points'] = [p['operator_request']['points'][1]];p['operator_request']['values'] = [0, 0, -1000/(1.25663706127e-6*1e9*factor())];p['field_norm_floor_nT'] = 1
    r = baselode.geophysics.calculate_exact_tmi_operator(p);assert r['state'] == 'needs_input' and r['request'] is None and r['vector_fields'] is None


def cases(inverse=False):
    out = []
    fields = [(['version'], True), (['extra'], 1), (['field_norm_floor_nT'], 0), (['operator_request', 'max_response_to_background_ratio'], .05), (['operator_request', 'background_nT'], None), (['operator_request', 'channels'], ['magnetic_bx']), (['metadata'], []), (['operator_request', 'coordinate_frame', 'units'], 'degree')]
    if inverse:fields += [(['initial_values'], []), (['initial_values', 0], 100), (['solver', 'method'], 'trf_lsmr'), (['solver', 'max_function_evaluations'], 1.5), (['parameters', 0, 'cell_id'], 'other'), (['observed', 0, 'records', 0, 'standard_deviation'], 0)]
    for path, value in fields:
        p = request(inverse);target = p
        for key in path[:-1]:target = target[key]
        target[path[-1]] = value;out.append(p)
    return out


@pytest.mark.parametrize('inverse', [False, True])
def test_native_schema_descriptor_atomic_negative_parity(tmp_path, inverse):
    examples = [request(inverse)]+cases(inverse)
    a = tmp_path/'in.json';b = tmp_path/'out.json';a.write_text(json.dumps(examples))
    subprocess.run(['node', str(ROOT/'test/data/exact_tmi_parity.mjs'), str(a), str(b), 'inverse' if inverse else 'operator'], cwd=ROOT/'javascript/packages/baselode', check=True, capture_output=True, text=True)
    native = json.loads(b.read_text());kind = 'exact_tmi_inversion' if inverse else 'exact_tmi_operator'
    assert native['descriptor'] == getattr(baselode.geophysics, 'describe_'+kind)()
    for index, (p, js) in enumerate(zip(examples, native['reports'])):
        py = getattr(baselode.geophysics, 'validate_'+kind)(p)
        for key in ['state', 'request', 'active_cell_ids', 'excluded', 'diagnostics', 'predicted', 'vector_fields']:
            assert py[key] == js[key], (key, py, js)
        assert [issue['code'] for issue in py['issues']] == [issue['code'] for issue in js['issues']]
        assert py['state'] == 'ok' if index == 0 else py['state'] != 'ok'
        if index:assert py['request'] is None and py['predicted'] is None
    if not inverse:
        # Old public validation continues to require a weak approximation cap.
        assert baselode.geophysics.validate_potential_field_operator(request()['operator_request'])['state'] != 'ok'

def test_stationary_transverse_start_does_not_claim_a_minimum():
    if not supported():return
    fw=request();fw['operator_request'].update(model_kind='susceptibility',parameter_units='dimensionless',values=[.08],background_nT={'x':math.sqrt(2)*1000,'y':0,'z_up':1000});fw['operator_request']['points']=[fw['operator_request']['points'][1]]
    p=request(True);p['operator_request']=copy.deepcopy(fw['operator_request']);p['operator_request']['values']=[0];p['observed']=observed(fw);p['initial_values']=[0];p['parameters']=[{'cell_id':'body','parameter':'susceptibility_SI','lower':-.1,'upper':.1,'reference':0,'scale':.1}]
    r=run(p,True);assert abs(r['parameters'][0]['value'])<1e-8;assert r['objective']['weighted_data']>1
    assert not r['convergence']['local_minimum_guaranteed'] and not r['convergence']['global_optimum_guaranteed']
    p['initial_values']=[.06];other=run(p,True);assert other['objective']['weighted_data']<1e-8


def test_condition_and_malformed_backend_fail_atomically(monkeypatch):
    if not supported():return
    p=request(True);p['solver']['condition_limit']=100;r=baselode.geophysics.invert_exact_tmi(p);assert r['state']=='needs_input' and not r['parameters']
    monkeypatch.setattr(baselode.geophysics.exact_tmi._optimize,'least_squares',lambda *a,**k:types.SimpleNamespace());r=baselode.geophysics.invert_exact_tmi(request(True));assert r['state']=='failed' and r['fitted_forward_request'] is None and r['linear_misfit'] is None

def test_trial_field_floor_preserves_context_classification(monkeypatch):
    if not supported():return
    p=request(True);p['field_norm_floor_nT']=1
    def forbidden_trial(fun,*args,**kwargs):
        fun(np.array([0.,0.,-1000/(10*1.25663706127e-6*1e9*factor())]))
        raise AssertionError('the forbidden field trial must stop execution')
    monkeypatch.setattr(baselode.geophysics.exact_tmi._optimize,'least_squares',forbidden_trial)
    r=baselode.geophysics.invert_exact_tmi(p);assert r['state']=='needs_input' and r['issues'][0]['code']=='context'
    assert r['request'] is None and not r['parameters'] and r['fitted_forward_request'] is None and r['predicted'] is None
