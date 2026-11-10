# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Analytic statistics/noise, nonlinear coverage and registered raster stability."""
import copy
import json
import math
import pathlib
import statistics
import subprocess
import sys
import jsonschema
import numpy as np
import pytest
import baselode.geophysics
import baselode.geophysics.model_ensembles
import baselode.geophysics.processing_ensembles

ROOT = pathlib.Path(__file__).resolve().parents[1]


def request(processing=False):
    return json.loads((ROOT/('test/data/'+('processing' if processing else 'potential_field')+'_ensemble_example.json')).read_text())


def supported():
    if sys.version_info >= (3, 12):return True
    with pytest.raises(ImportError, match='Python>=3.12'):baselode.geophysics.run_potential_field_ensemble(request())
    return False


def run(p, processing=False, state='ok'):
    result = getattr(baselode.geophysics, 'run_'+('processing' if processing else 'potential_field')+'_ensemble')(p)
    assert result['state'] == state, result['issues']
    return result


def child_root(child, operation, count=3):
    p = request();p['operation'] = operation;p['members'] = [{'id': str(i), 'request': copy.deepcopy(child), 'noise': {'kind': 'none', 'seed': None}} for i in range(count)]
    op = child['operator_request'];p['options'].update(minimum_successful_members=count, model_sign_threshold={'units': op['parameter_units'], 'value': 0}, magnetization_direction_min_amplitude_A_m=.01 if op['model_kind'] == 'magnetic_vector' else None,
        anomaly_thresholds=[{'quantity': q, 'units': 'mGal' if op['model_kind'] == 'density' else 'nT', 'direction': 'absolute', 'threshold': 1} for q in op['channels']])
    return p


def recipe(operation, parameters, name='product'):
    return {'schema': 'baselode.geophysics.workflow', 'version': 1, 'steps': [{'id': name, 'operation': operation, 'version': 1, 'inputs': ['survey'], 'parameters': parameters}], 'outputs': [name]}


def test_analytic_noisy_ridge_statistics_exact_member_and_forward_replays():
    if not supported():return
    p=request();before=copy.deepcopy(p);legacy=np.random.get_state();r=run(p);after=np.random.get_state();assert legacy[0]==after[0] and np.array_equal(legacy[1],after[1]) and legacy[2:]==after[2:];assert p==before
    g=.0006293849964203642;sigma=.01;d=.6293849964203642;expected=[]
    for member in p['members']:
        z=float(np.random.Generator(np.random.PCG64(member['noise']['seed'])).standard_normal());expected.append((g*(d+sigma*z)/sigma**2)/(g*g/sigma**2+1e-6/1000**2))
    stats=r['statistics']['model'][0];assert stats['mean']==pytest.approx(statistics.mean(expected),rel=1e-12);assert stats['sample_standard_deviation']==pytest.approx(statistics.stdev(expected),rel=1e-12)
    assert [q['value'] for q in stats['quantiles']]==pytest.approx(np.quantile(expected,p['options']['quantiles']),rel=1e-12)
    assert r['coverage']['successful_members']==4 and stats['positive_count']==4
    hits=sum(abs(g*value)>=.63 for value in expected);field=r['statistics']['fields'][0]['records'][0];assert field['detection_count']==hits and field['unknown_members']==0 and field['detection_fraction_successful']==hits/4
    for i,member in enumerate(r['members']):
        assert member['parameters'][0]['value']==pytest.approx(expected[i],rel=1e-12)
        actual=baselode.geophysics.invert_potential_field_grid(member['executed_request']);assert actual['parameters']==member['parameters'] and actual['predicted']==member['predicted']
        forward=getattr(baselode.geophysics,member['forward_replay']['method'])(member['forward_replay']['request']);assert forward['state']=='ok' and forward['predicted']==member['predicted']
        assert member['budget']['usage_exact'] and member['budget']['charged_kernel_evaluations']<=member['budget']['reserved_kernel_evaluations']
    assert r['budget']['charged_operator_calls']<=r['budget']['reserved_operator_calls']<=p['execution']['max_operator_calls']


def test_paired_noise_is_canonical_by_id_not_observed_record_order():
    if not supported():return
    p=request();p['members']=p['members'][:2];p['options']['minimum_successful_members']=2
    for member in p['members']:
        member['noise']['seed']=111;child=member['request'];point={'id':'other','x_m':30,'y_m':0,'z_m':0};child['operator_request']['points'].append(point);child['observed'][0]['records'].append({**point,'value':.2,'standard_deviation':.02,'group_id':None})
    p['members'][1]['request']['observed'][0]['records'].reverse();r=run(p)
    assert r['members'][0]['noise']['draws']==r['members'][1]['noise']['draws'];assert r['diagnostics']['reused_seeds']==[111]
    a={row['id']:row['value'] for row in r['members'][0]['executed_request']['observed'][0]['records']};b={row['id']:row['value'] for row in r['members'][1]['executed_request']['observed'][0]['records']};assert a==b


def test_partial_abort_minimum_and_conservative_failure_reservations():
    if not supported():return
    child=json.loads((ROOT/'test/data/exact_tmi_inversion_example.json').read_text());p=child_root(child,'exact_tmi_inversion');p['members'][0]['request']['solver']['max_function_evaluations']=1;p['options']['minimum_successful_members']=2
    r=run(p,state='partial');assert r['coverage']['failed_members']==1 and r['coverage']['successful_members']==2
    failed=r['members'][0];assert not failed['parameters'] and failed['forward_replay'] is None and not failed['budget']['usage_exact']
    assert failed['budget']['charged_operator_calls']==failed['budget']['reserved_operator_calls'];assert r['statistics']['fields'][0]['records'][0]['unknown_members']==1
    p['options']['minimum_successful_members']=3;r=run(p,state='failed');assert r['statistics'] is None and r['members'][1]['state']=='ok'
    p['options'].update(minimum_successful_members=1,failure_policy='abort');r=run(p,state='failed');assert [row['state'] for row in r['members']]==['failed','not_run','not_run'];assert r['members'][1]['budget']['charged_operator_calls']==0
    p['options'].update(minimum_successful_members=2,failure_policy='collect');p['members'][0]['request']['solver']['max_function_evaluations']=100;p['execution']['max_operator_calls']=18;r=run(p,state='failed');assert all(row['state']=='failed' for row in r['members']) and r['budget']['charged_operator_calls']==18


def test_single_member_has_no_sample_uncertainty_and_minimum_budget_can_run():
    if not supported():return
    p=request();p['members']=p['members'][:1];p['options']['minimum_successful_members']=1;p['members'][0]['noise']={'kind':'none','seed':None};p['members'][0]['request']['observed'][0]['records'][0]['value']=0;p['execution'].update(max_operator_calls=10,max_kernel_evaluations=10)
    r=run(p);assert r['statistics']['model'][0]['sample_standard_deviation'] is None and r['budget']['charged_operator_calls']==10


def test_malformed_member_cannot_enter_statistics(monkeypatch):
    if not supported():return
    monkeypatch.setattr(baselode.geophysics,'invert_potential_field_grid',lambda request:{'state':'ok'})
    r=run(request(),state='failed');assert r['statistics'] is None and all(not row['parameters'] for row in r['members']);assert r['budget']['charged_operator_calls']==r['budget']['reserved_operator_calls']


def test_large_model_ambiguity_can_have_stable_predicted_anomaly():
    if not supported():return
    child=json.loads((ROOT/'test/data/sparse_potential_field_inversion_example.json').read_text());op=child['operator_request'];op['grid'].update(shape=[2,1,1],origin_m=[-100,-50,-150],cell_ids=['a','b'],active=[True,True]);op['values']=[1000,0];forward=baselode.geophysics.calculate_potential_field_operator(op);assert forward['state']=='ok';child['observed']=[{'context':forward['predicted'][0]['context'],'records':[{**forward['predicted'][0]['records'][0],'standard_deviation':.01,'group_id':None}]}];op['values']=[0,0];child['parameters']=[dict(child['parameters'][0],cell_id=identity,lower=0) for identity in ['a','b']];child['regularization']['reference_weight']=1;child['penalty']['stages']=[{'model_epsilon':.3,'gradient_epsilon':.3},{'model_epsilon':.05,'gradient_epsilon':.05}];child['initial_values']=[900,100]
    p=child_root(child,'sparse_potential_field_inversion',2);p['members'][1]['request']['initial_values']=[100,900];r=run(p)
    assert r['statistics']['model'][0]['sample_standard_deviation']>600;assert r['statistics']['fields'][0]['records'][0]['sample_standard_deviation']<1e-8


def test_vector_amplitude_direction_coherence_and_zero_amplitude_exclusion():
    if not supported():return
    child=json.loads((ROOT/'test/data/potential_field_grid_inversion_example.json').read_text());op=child['operator_request'];op.update(model_kind='magnetic_vector',parameter_units='A/m',field_type='magnetic_anomaly',channels=['magnetic_bx','magnetic_by','magnetic_bz_up'],min_distance_m=1,values=[.2,-.3,1.1]);f=baselode.geophysics.calculate_potential_field_operator(op);assert f['state']=='ok';op['values']=[0]*3
    child['observed']=[{'context':d['context'],'records':[{**row,'standard_deviation':.01,'group_id':None} for row in d['records']]} for d in f['predicted']];child['parameters']=[{'cell_id':'body','parameter':name,'lower':-3,'upper':3,'reference':0,'scale':1} for name in ['magnetization_x_A_m','magnetization_y_A_m','magnetization_z_up_A_m']]
    p=child_root(child,'potential_field_grid_inversion',3)
    for dataset in p['members'][1]['request']['observed']:
        for row in dataset['records']:row['value']*=-1
    for dataset in p['members'][2]['request']['observed']:
        for row in dataset['records']:row['value']=0
    r=run(p);direction=r['statistics']['magnetization'][0]['direction'];assert direction['eligible_members']==2 and direction['excluded_low_amplitude_members']==1;assert direction['resultant_length']<1e-12;assert r['statistics']['magnetization'][0]['amplitude_A_m']['maximum']>1


def test_processing_constant_mask_maps_lineage_and_exact_registered_replay():
    p=request(True);before=copy.deepcopy(p);r=run(p,True);assert p==before
    assert r['maps']['mean'][8][8]==pytest.approx(100,abs=1e-11);assert r['maps']['valid_member_count'][8][8]==3 and r['maps']['detection_fraction_valid'][8][8]==1
    assert r['maps']['mean'][0][0] is None and r['maps']['valid_member_count'][0][0]==0;assert r['maps']['edge_warning'][0][0] and not r['maps']['edge_warning'][8][8]
    assert r['mean_raster']['metadata']['field_type']=='other' and 'grid_corrections' not in r['mean_raster']['metadata'];assert len(r['mean_raster']['metadata']['ensemble_member_lineage'])==3
    for member in r['members']:
        raster=baselode.geophysics.raster.GeophysicsRaster.from_payload(member['executed_input'])
        product=raster if member['workflow'] is None else baselode.geophysics.workflows.run_workflow(member['workflow'],{'survey':raster})['artifacts'][member['output']]
        assert product.to_payload()['data']==member['selected_raster']['data']


def test_genuine_line_aligned_geology_and_boundary_warnings_are_not_classifiers():
    p=request(True);n=32;x=np.arange(n);signal=20*np.cos(4*math.pi*(x-(n-1)/2)/n);values=np.tile(signal,(n,1));p['raster']['data']=[values.tolist()];p['raster']['transform']=[10,0,0,0,-10,320];p['options']['threshold']['threshold']=10;p['members'][1]['workflow']['steps'][0]['parameters']['wavelength']=20;p['members'][2]['workflow']['steps'][0]['parameters']['height']=10
    r=run(p,True);column=int(np.argmax(signal));assert r['maps']['detection_fraction_valid'][16][column]==1
    assert r['maps']['mean'][16][column]>10 and r['maps']['edge_warning'][0][column] and not r['maps']['edge_warning'][16][column]
    # A boundary impulse is explicitly flagged even when stable across methods.
    values=np.zeros((n,n));values[0,0]=100;values[16,16]=100;p['raster']['data']=[values.tolist()];p['options']['threshold']['threshold']=.01;r=run(p,True)
    assert r['maps']['edge_warning'][0][0] and not r['maps']['edge_warning'][16][16];assert r['maps']['detection_count'][0][0]>=1


def test_processing_supplied_noise_seeds_preserve_replay_and_input_uncertainty_lineage():
    p=request(True);p['members']=p['members'][:2];p['members'][1]['workflow']=None;p['members'][1]['output']='survey';p['options'].update(minimum_successful_members=2,minimum_cell_members=2);p['noise_standard_deviation']=2
    for member in p['members']:member['noise']={'kind':'independent_gaussian','seed':42}
    r=run(p,True);assert r['members'][0]['executed_input']==r['members'][1]['executed_input'];assert r['resource_estimate']['reused_seeds']==[42]
    assert r['members'][0]['noise']['standard_draws'][0][0] is None;assert r['members'][0]['executed_input']['metadata']['processing'][-1]['operation']=='ensemble_noise'
    assert r['maps']['sample_standard_deviation'][8][8]==0


def test_processing_partial_failure_and_cell_coverage_are_explicit(monkeypatch):
    p=request(True);p['options'].update(minimum_successful_members=2,minimum_cell_members=3);original=baselode.geophysics.workflows.run_workflow
    def one_failure(workflow,inputs):
        if workflow['steps'][0]['operation']=='low_pass':return {'state':'failed','issues':[{'code':'injected','message':'known failed variant'}],'completed_steps':[],'artifacts':{}}
        return original(workflow,inputs)
    monkeypatch.setattr(baselode.geophysics.workflows,'run_workflow',one_failure);r=run(p,True,'partial');assert r['maps']['valid_member_count'][8][8]==2 and r['maps']['mean'][8][8] is None and r['maps']['coverage_fraction_requested'][8][8]==2/3
    p['options'].update(failure_policy='abort',minimum_successful_members=1);r=run(p,True,'failed');assert [m['state'] for m in r['members']]==['ok','failed','not_run'] and r['maps'] is None


def test_deep_input_metadata_remains_transportable_through_flat_member_lineage():
    p=request(True);deep=0
    for _ in range(29):deep=[deep]
    p['raster']['metadata']['deep']=deep;r=run(p,True);assert r['mean_raster']['metadata']['input_lineage']
    too_deep=0
    for _ in range(35):too_deep=[too_deep]
    with pytest.raises(baselode.geophysics.corrections._ResourceError):baselode.geophysics.forward_common._bounded_json(too_deep,10000)


def cases(processing=False):
    out=[]
    fields=[(['version'],True),(['members',1,'id'],'seed_11' if not processing else 'identity'),(['options','quantiles'],[.5,.5]),(['members',0,'noise'],{'kind':'independent_gaussian','seed':None}),(['metadata'],[])]
    if processing:fields +=[(['context','units'],'mGal'),(['members',1,'output'],'missing'),(['members',1,'workflow','steps',0,'operation'],'vertical_derivative'),(['execution','max_retained_cell_values'],1),(['raster','transform'],None),(['options','edge_margin_cells'],1000)]
    else:fields +=[(['operation'],'__proto__'),(['execution','max_operator_calls'],1),(['execution','max_kernel_evaluations'],1),(['options','model_sign_threshold','units'],'nT'),(['options','magnetization_direction_min_amplitude_A_m'],1)]
    for path,value in fields:
        p=request(processing);target=p
        for key in path[:-1]:target=target[key]
        target[path[-1]]=value;out.append(p)
    return out


@pytest.mark.parametrize('processing',[False,True])
def test_native_validation_schema_negative_replay_and_immutable_descriptors(tmp_path,processing):
    kind='processing' if processing else 'potential_field';p=request(processing);descriptor=getattr(baselode.geophysics,'describe_'+kind+'_ensemble')();jsonschema.validate(p,descriptor['request_schema']);validation=getattr(baselode.geophysics,'validate_'+kind+'_ensemble')(p);assert validation['state']=='ok';jsonschema.validate(validation,descriptor['result_schema']);examples=[p]+cases(processing);a=tmp_path/'in.json';b=tmp_path/'out.json';a.write_text(json.dumps(examples));subprocess.run(['node',str(ROOT/'test/data/ensembles_parity.mjs'),str(a),str(b),'processing' if processing else 'model'],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True);js=json.loads(b.read_text());assert js['descriptor']==descriptor
    for i,(value,native) in enumerate(zip(examples,js['reports'])):
        py=getattr(baselode.geophysics,'validate_'+kind+'_ensemble')(value)
        for key in ['state','request','members','coverage','budget' if not processing else 'resource_estimate','diagnostics' if not processing else 'maps']:assert py[key]==native[key],(key,py,native)
        assert [issue['code'] for issue in py['issues']]==[issue['code'] for issue in native['issues']]
        assert py['state']=='ok' if i==0 else py['state']!='ok'
    descriptor['resources']['max_members']=0;assert getattr(baselode.geophysics,'describe_'+kind+'_ensemble')()['resources']['max_members']==16
    if processing or supported():jsonschema.validate(run(p,processing),getattr(baselode.geophysics,'describe_'+kind+'_ensemble')()['result_schema'])

def maximum_model_manifest():
    child=json.loads((ROOT/'test/data/potential_field_grid_inversion_example.json').read_text());op=child['operator_request'];op.update(model_kind='magnetic_vector',parameter_units='A/m',field_type='magnetic_anomaly',reference_id='synthetic_zero_vector',channels=['magnetic_bx'],min_distance_m=1,values=[0]*768+[None]*768);op['grid'].update(shape=[8,8,8],origin_m=[-100,-100,-250],cell_size_m=[25,25,25],cell_ids=[str(i) for i in range(512)],active=[True]*256+[False]*256);op['points']=[{'id':str(i+16*j),'x_m':-100+20*i,'y_m':-100+20*j,'z_m':50} for j in range(32) for i in range(16)]
    child['parameters']=[{'cell_id':str(i),'parameter':name,'lower':-1000,'upper':1000,'reference':0,'scale':1} for i in range(256) for name in ['magnetization_x_A_m','magnetization_y_A_m','magnetization_z_up_A_m']];child['regularization'].update(reference_weight=1,smoothness_weight=0,edges=[{'cell_a':str(i),'cell_b':str((i+offset)%256),'weight':1} for offset in [1,2] for i in range(256)]);child['observed']=[{'context':baselode.geophysics.potential_field_operator._context(op,'magnetic_bx'),'records':[{**point,'value':0,'standard_deviation':1,'group_id':None} for point in op['points']]}]
    p=child_root(child,'potential_field_grid_inversion',16);p['execution']['max_kernel_evaluations']=1000000000;return p


def test_joint_maximum_members_parameters_data_edges_cells_fit_portable_budgets(tmp_path):
    p=maximum_model_manifest();r=baselode.geophysics.validate_potential_field_ensemble(p);assert r['state']=='ok',r['issues'];assert r['diagnostics']=={'parameters':12288,'observations':8192,'edges':8192,'total_cells':8192}
    a=tmp_path/'in.json';b=tmp_path/'out.json';a.write_text(json.dumps([p]));subprocess.run(['node',str(ROOT/'test/data/ensembles_parity.mjs'),str(a),str(b),'model'],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True);native=json.loads(b.read_text())['reports'][0];assert native['state']=='ok' and native['budget']==r['budget'] and native['diagnostics']==r['diagnostics']
    bad=copy.deepcopy(p);bad['metadata']={'too_large':'x'*65537};assert baselode.geophysics.validate_potential_field_ensemble(bad)['state']=='rejected'


def test_cycles_and_resource_preflight_never_execute_members(monkeypatch):
    p=request(True);p['metadata']={};p['metadata']['cycle']=p
    r=baselode.geophysics.validate_processing_ensemble(p);assert r['state']=='rejected' and r['request'] is None
    def forbidden(*args,**kwargs):raise AssertionError('preflight must finish before any workflow executes')
    monkeypatch.setattr(baselode.geophysics.workflows,'run_workflow',forbidden)
    p=request(True);p['execution']['max_fft_cell_work']=0;r=baselode.geophysics.run_processing_ensemble(p);assert r['state']=='rejected' and not r['members']
    p=request();p['metadata']={};p['metadata']['cycle']=p;assert baselode.geophysics.validate_potential_field_ensemble(p)['state']=='rejected'


def test_malformed_processing_product_cannot_be_aggregated(monkeypatch):
    p=request(True);p['members']=p['members'][1:2];p['options'].update(minimum_successful_members=1,minimum_cell_members=1)
    monkeypatch.setattr(baselode.geophysics.workflows,'run_workflow',lambda *a,**k:{'state':'ok','issues':[],'completed_steps':[],'artifacts':{'filtered':0}})
    r=run(p,True,'failed');assert r['maps'] is None and r['members'][0]['selected_raster'] is None
