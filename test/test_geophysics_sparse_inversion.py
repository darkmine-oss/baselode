# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent penalty/cubic, L2 equivalence, compactness and native regressions."""
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
import scipy.optimize
import baselode.geophysics
import baselode.geophysics.sparse_inversion

ROOT = pathlib.Path(__file__).resolve().parents[1]


def request():
    return json.loads((ROOT/'test/data/sparse_potential_field_inversion_example.json').read_text())


def supported():
    if sys.version_info >= (3, 12):return True
    with pytest.raises(ImportError, match='Python>=3.12'):baselode.geophysics.invert_sparse_potential_field(request())
    return False


def run(p):
    result = baselode.geophysics.invert_sparse_potential_field(p)
    assert result['state'] == 'ok', result['issues']
    return result


def assert_history(result):
    for stage in range(len(result['path'])):
        rows = [row for row in result['history'] if row['stage'] == stage]
        for a, b in zip(rows, rows[1:]):
            assert b['objective']['total'] <= a['objective']['total']+64*math.ulp(1.)*max(1, a['objective']['total'], b['objective']['total'])
        assert rows[-1]['projected_gradient'] <= rows[-1]['projected_gradient_threshold']
    assert baselode.geophysics.calculate_potential_field_operator(result['fitted_operator_request'])['predicted'] == result['predicted']


@pytest.mark.parametrize('p', [0, 1e-100, .1, .5, 1, 1.5, 2])
def test_penalty_and_derivative_are_independent_stable_and_zero_at_reference(p):
    r = np.array([-3., -.2, 0, .1, 2.]);epsilon = .3
    actual = baselode.geophysics.sparse_inversion._phi(r, p, epsilon)
    if p == 0 or p < 1e-10:expected = np.log1p((r/epsilon)**2)
    else:expected = (2/p)*((r*r+epsilon*epsilon)**(p/2)-epsilon**p)
    assert actual == pytest.approx(expected, rel=1e-12, abs=1e-14)
    h = 1e-6
    finite = (baselode.geophysics.sparse_inversion._phi(r+h, p, epsilon)-baselode.geophysics.sparse_inversion._phi(r-h, p, epsilon))/(2*h)
    assert finite == pytest.approx(2*r*(r*r+epsilon*epsilon)**(p/2-1), rel=1e-7, abs=1e-8)
    assert actual[2] == 0


@pytest.mark.parametrize('p', [0, .5, 1, 1.5, 2])
@pytest.mark.parametrize('sign', [-1, 1])
def test_independent_scalar_stationarity_and_l2_reduction(p, sign):
    if not supported():return
    q = request();q['penalty']['model_p'] = p;q['observed'][0]['records'][0]['value'] *= sign;r = run(q)
    a = .6293849964203642/.01;epsilon = .1
    expected = scipy.optimize.brentq(lambda z:a*a*(z-sign)+10*z*(z*z+epsilon*epsilon)**(p/2-1), *sorted([.5*sign, 1.1*sign]))*1000
    assert r['parameters'][0]['value'] == pytest.approx(expected, rel=1e-8, abs=1e-6)
    assert_history(r)
    if p == 2:
        base = {key: value for key, value in q.items() if key not in ('penalty', 'initial_values', 'execution')};base['schema'] = 'baselode.geophysics.potential_field_grid_inversion_request';base['solver'] = {key: value for key, value in q['solver'].items() if key not in ('outer_tolerance', 'max_outer_iterations', 'max_polish_iterations', 'max_backtracking_steps')};base['solver']['method'] = 'trf_lsmr';old = baselode.geophysics.invert_potential_field_grid(base)
        assert old['state'] == 'ok';assert r['parameters'][0]['value'] == pytest.approx(old['parameters'][0]['value'], rel=1e-12)
        assert r['objective']['total'] == pytest.approx(old['objective']['total'], rel=1e-12)
        assert r['convergence']['convex_objective']


def model_request(shape, size, origin, truth, points):
    p = request();op = p['operator_request'];n = math.prod(shape)
    op['grid'].update(shape=shape, cell_size_m=size, origin_m=origin, cell_ids=[str(i) for i in range(n)], active=[True]*n)
    op['values'] = truth;op['points'] = [{'id': str(i), 'x_m': x, 'y_m': y, 'z_m': z} for i, (x, y, z) in enumerate(points)]
    forward = baselode.geophysics.calculate_potential_field_operator(op);assert forward['state'] == 'ok', forward['issues']
    p['observed'] = [{'context': d['context'], 'records': [{**row, 'standard_deviation': .01, 'group_id': None} for row in d['records']]} for d in forward['predicted']]
    op['values'] = [0]*n;p['parameters'] = [dict(p['parameters'][0], cell_id=str(i), lower=0, upper=3000) for i in range(n)];p['initial_values'] = [0]*n
    return p


def test_compact_nonunique_body_changes_with_start_and_l2_is_diffuse():
    if not supported():return
    p = model_request([2, 1, 1], [100, 100, 100], [-100, -50, -150], [1000, 0], [(0, 0, 0)])
    p['regularization']['reference_weight'] = 1;p['penalty']['stages'] = [{'model_epsilon': .3, 'gradient_epsilon': .3}, {'model_epsilon': .05, 'gradient_epsilon': .05}];p['initial_values'] = [900, 100]
    a = run(p);other = copy.deepcopy(p);other['initial_values'] = [100, 900];b = run(other)
    assert a['parameters'][0]['value'] > 990 and a['parameters'][1]['value'] < 10
    assert b['parameters'][1]['value'] > 990 and b['parameters'][0]['value'] < 10
    assert a['predicted'][0]['records'][0]['value'] == pytest.approx(b['predicted'][0]['records'][0]['value'], rel=1e-10)
    assert not a['convergence']['global_optimum_guaranteed'] and a['diagnostics']['data_rank'] is None
    l2 = copy.deepcopy(p);l2['penalty'].update(model_p=2, gradient_p=2);c = run(l2)
    assert c['parameters'][0]['value'] == pytest.approx(c['parameters'][1]['value'], rel=1e-10)
    assert 490 < c['parameters'][0]['value'] < 510
    for result in (a, b, c):assert_history(result)


def test_declared_gradient_penalty_controls_contact_smoothing_tradeoff():
    if not supported():return
    p = model_request([4, 1, 1], [50, 50, 50], [-100, -25, -100], [1000, 1000, 0, 0], [(x, 0, 0) for x in (-75, -25, 25, 75)])
    p['penalty'].update(model_p=2, gradient_p=1, stages=[{'model_epsilon': .3, 'gradient_epsilon': .3}, {'model_epsilon': .05, 'gradient_epsilon': .05}]);p['regularization'].update(reference_weight=.01, smoothness_weight=.001, edges=[{'cell_a': str(i), 'cell_b': str(i+1), 'weight': 1} for i in range(3)])
    low = run(p);p['regularization']['smoothness_weight'] = 1e4;high = run(p)
    rough = lambda result:sum(abs(result['parameters'][i]['value']-result['parameters'][i+1]['value']) for i in range(3))
    assert rough(high) < rough(low)/10
    assert high['objective']['weighted_data'] > low['objective']['weighted_data']
    assert_history(low);assert_history(high)


def test_zero_sensitivity_channel_is_portable_and_selects_declared_reference():
    if not supported():return
    p = request();op = p['operator_request'];op.update(model_kind='susceptibility', parameter_units='dimensionless', field_type='magnetic_anomaly', values=[0], channels=['magnetic_bx'], background_nT={'x': 0, 'y': 0, 'z_up': 50000}, min_distance_m=1)
    forward = baselode.geophysics.calculate_potential_field_operator(op);assert forward['state'] == 'ok', forward['issues'];assert forward['diagnostics']['adjoint_relative_error'] < 1e-10 and forward['predicted'][0]['records'][0]['value'] == 0
    p['observed'] = [{'context': forward['predicted'][0]['context'], 'records': [{**forward['predicted'][0]['records'][0], 'standard_deviation': .01, 'group_id': None}]}];p['parameters'] = [{'cell_id': 'body', 'parameter': 'susceptibility_SI', 'lower': -.1, 'upper': .1, 'reference': .02, 'scale': .1}];p['initial_values'] = [.02]
    r = run(p);assert r['parameters'][0]['value'] == pytest.approx(.02);assert r['parameters'][0]['weighted_column_norm'] < 1e-8;assert_history(r)


def test_schema_immutable_replay_and_atomic_execution_failures(monkeypatch):
    p = request();before = copy.deepcopy(p);descriptor = baselode.geophysics.describe_sparse_potential_field_inversion();jsonschema.validate(p, descriptor['request_schema'])
    validation = baselode.geophysics.validate_sparse_potential_field_inversion(p);assert validation['state'] == 'ok';jsonschema.validate(validation, descriptor['result_schema'])
    if not supported():return
    r = run(p);assert p == before;jsonschema.validate(r, descriptor['result_schema']);assert_history(r)
    for path, value in [(['solver', 'max_outer_iterations'], 1), (['execution', 'max_operator_calls'], 15), (['solver', 'condition_limit'], 100)]:
        q = copy.deepcopy(p);target = q
        for key in path[:-1]:target = target[key]
        target[path[-1]] = value
        if path[-1]=='condition_limit':q['regularization']['reference_weight']=1e-12
        failed = baselode.geophysics.invert_sparse_potential_field(q);assert failed['state'] != 'ok' and not failed['parameters'] and not failed['history'] and failed['fitted_operator_request'] is None
    monkeypatch.setattr(baselode.geophysics.sparse_inversion._optimize, 'lsq_linear', lambda *args, **kwargs:types.SimpleNamespace())
    failed = baselode.geophysics.invert_sparse_potential_field(p);assert failed['state'] == 'failed' and failed['objective'] is None


def test_real_fixed_epsilon_cost_increase_is_not_accepted(monkeypatch):
    if not supported():return
    original = baselode.geophysics.sparse_inversion._evaluate;calls = []
    def increased(*args, **kwargs):
        predicted, residual, edges, objective = original(*args, **kwargs);calls.append(1)
        if len(calls) >= 2:objective['total'] += 1e6
        return predicted, residual, edges, objective
    monkeypatch.setattr(baselode.geophysics.sparse_inversion, '_evaluate', increased)
    r = baselode.geophysics.invert_sparse_potential_field(request());assert r['state'] == 'failed' and 'objective increased' in r['issues'][0]['message'];assert not r['parameters'] and r['predicted'] is None


def cases():
    out = []
    for path, value in [(['execution','max_operator_calls'],14), (['execution','max_kernel_evaluations'],14), (['version'], True), (['penalty', 'model_p'], -1), (['penalty', 'gradient_p'], 3), (['penalty', 'stages'], []), (['penalty', 'stages', 0, 'model_epsilon'], 0), (['penalty', 'stages', 1, 'model_epsilon'], 2), (['solver', 'method'], 'trf_lsmr_exact_tmi'), (['solver', 'max_outer_iterations'], 1.5), (['initial_values'], []), (['initial_values', 0], 1e8), (['operator_request', 'max_response_to_background_ratio'], .1)]:
        p = request();target = p
        for key in path[:-1]:target = target[key]
        target[path[-1]] = value;out.append(p)
    return out


def test_native_descriptor_and_negative_replay(tmp_path):
    examples = [request()]+cases();a = tmp_path/'in.json';b = tmp_path/'out.json';a.write_text(json.dumps(examples))
    subprocess.run(['node', str(ROOT/'test/data/sparse_inversion_parity.mjs'), str(a), str(b)], cwd=ROOT/'javascript/packages/baselode', check=True, capture_output=True, text=True)
    js = json.loads(b.read_text());assert js['descriptor'] == baselode.geophysics.describe_sparse_potential_field_inversion()
    for i, (p, native) in enumerate(zip(examples, js['reports'])):
        py = baselode.geophysics.validate_sparse_potential_field_inversion(p)
        for key in ['state', 'request', 'active_cell_ids', 'excluded', 'diagnostics', 'parameters', 'history', 'path']:
            assert py[key] == native[key]
        assert [issue['code'] for issue in py['issues']] == [issue['code'] for issue in native['issues']]
        assert py['state'] == 'ok' if i == 0 else py['state'] != 'ok'

def test_exact_zero_gravity_operator_has_plain_json_diagnostics_and_prior_only_model():
    if not supported():return
    p=request();p['operator_request']['points'][0]['z_m']=-100;p['observed'][0]['records'][0].update(z_m=-100,value=0);p['parameters'][0]['reference']=500;p['initial_values']=[500]
    r=run(p);assert r['diagnostics']['adjoint_relative_error']==0 and type(r['diagnostics']['adjoint_relative_error']) is float
    assert r['parameters'][0]['value']==500 and r['parameters'][0]['weighted_column_norm']==0
    assert_history(r)


def test_multicomponent_reordered_weighted_l2_with_edges_matches_independent_dense_solve():
    if not supported():return
    p=request();op=p['operator_request'];op.update(model_kind='magnetic_vector',parameter_units='A/m',field_type='magnetic_anomaly',channels=['magnetic_b_down','magnetic_bx','magnetic_by'],min_distance_m=1,values=[.4,-.2,1.1,-.3,.6,.8]);op['grid'].update(shape=[2,1,1],cell_ids=['a','b'],active=[True,True]);op['points']=[{'id':str(i),'x_m':x,'y_m':y,'z_m':0} for i,(x,y) in enumerate([(-40,-30),(80,20),(30,100)])]
    fields=baselode.geophysics.calculate_potential_field_operator(op);assert fields['state']=='ok',fields['issues']
    p['observed']=[{'context':d['context'],'records':[{**row,'standard_deviation':.1*(i+1+j),'group_id':None} for i,row in reversed(list(enumerate(d['records'])))]} for j,d in enumerate(fields['predicted'])];op['values']=[0]*6
    names=['magnetization_x_A_m','magnetization_y_A_m','magnetization_z_up_A_m'];p['parameters']=[{'cell_id':identity,'parameter':name,'lower':-3,'upper':3,'reference':.1*(i-2),'scale':.5+.2*i} for i,(identity,name) in enumerate([(identity,name) for identity in ['a','b'] for name in names])];p['initial_values']=[r['reference'] for r in p['parameters']];p['penalty'].update(model_p=2,gradient_p=2,stages=[{'model_epsilon':.1,'gradient_epsilon':.1}]);p['regularization'].update(reference_weight=.2,smoothness_weight=.1,edges=[{'cell_a':'a','cell_b':'b','weight':2}])
    r=run(p);template,indices,_,diag=baselode.geophysics.potential_field_operator._prepare(op);a,_,_,_=baselode.geophysics.potential_field_operator._build(template,indices,diag);g=np.column_stack([a@np.eye(6)[:,i] for i in range(6)]);ref=np.array([r['reference'] for r in p['parameters']]);scale=np.array([r['scale'] for r in p['parameters']]);order=np.array([j*3+int(row['id']) for j,d in enumerate(p['observed']) for row in d['records']]);data=np.array([row['value'] for d in p['observed'] for row in d['records']]);sigma=np.array([row['standard_deviation'] for d in p['observed'] for row in d['records']]);difference=np.column_stack([np.eye(3),-np.eye(3)])*math.sqrt(2);aug=np.vstack([g[order]*scale/sigma[:,None],math.sqrt(.2)*np.eye(6),math.sqrt(.1)*difference]);target=np.r_[(data-g[order]@ref)/sigma,np.zeros(9)];expected=ref+scale*np.linalg.lstsq(aug,target,rcond=None)[0]
    assert [row['value'] for row in r['parameters']]==pytest.approx(expected,rel=1e-7,abs=1e-8);assert_history(r)

def test_requested_projected_gradient_polish_resolves_near_active_bound():
    if not supported():return
    p=request();p['penalty'].update(model_p=2,gradient_p=2);a=.6293849964203642/.01;p['parameters'][0]['upper']=1000*a*a/(a*a+10)-.001
    without=copy.deepcopy(p);without['solver']['max_polish_iterations']=0;failed=baselode.geophysics.invert_sparse_potential_field(without);assert failed['state']=='failed' and not failed['parameters']
    r=run(p);assert r['convergence']['projected_gradient_polish_iterations']>0;assert r['parameters'][0]['value']==p['parameters'][0]['upper'] and r['parameters'][0]['active_bound']==1;assert_history(r)


def test_increasing_proposal_is_backtracked_and_true_gradient_checked(monkeypatch):
    if not supported():return
    original=baselode.geophysics.sparse_inversion._evaluate;calls=[]
    def one_bad_proposal(*args,**kwargs):
        predicted,residual,edges,objective=original(*args,**kwargs);calls.append(1)
        if len(calls)==2:objective['total']+=1e6
        return predicted,residual,edges,objective
    monkeypatch.setattr(baselode.geophysics.sparse_inversion,'_evaluate',one_bad_proposal)
    r=run(request());assert r['convergence']['backtracking_steps']>0 and any(row['accepted_fraction'] is not None and row['accepted_fraction']<1 for row in r['history']);assert_history(r)

def test_known_minimum_setup_stage_budget_is_checked_and_can_succeed():
    p=request();p['penalty']['stages']=p['penalty']['stages'][:1];p['operator_request']['points'][0]['z_m']=-100;p['observed'][0]['records'][0].update(z_m=-100,value=0);p['parameters'][0]['reference']=500;p['initial_values']=[500];p['execution'].update(max_operator_calls=10,max_kernel_evaluations=10)
    assert baselode.geophysics.validate_sparse_potential_field_inversion(p)['state']=='ok'
    for key in ['max_operator_calls','max_kernel_evaluations']:
        bad=copy.deepcopy(p);bad['execution'][key]=9;v=baselode.geophysics.validate_sparse_potential_field_inversion(bad);assert v['state']=='rejected' and v['request'] is None
    if not supported():return
    r=run(p);assert r['diagnostics']['operator_calls']==10 and r['diagnostics']['kernel_evaluations']==10
