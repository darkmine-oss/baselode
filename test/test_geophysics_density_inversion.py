# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent bounded scalar/ridge solutions, nonuniqueness and kernel replay."""
import copy,json,pathlib,subprocess,types
import jsonschema
import numpy as np
import pytest
import baselode.geophysics
import baselode.geophysics.inversion
ROOT=pathlib.Path(__file__).resolve().parents[1]
def request():return json.loads((ROOT/'test/data/density_inversion_example.json').read_text())
def run(p):
    r=baselode.geophysics.invert_density(p);assert r['state']=='ok',r['issues'];return r

def two_cells(points=None):
    p=request();f=json.loads((ROOT/'test/data/block_forward_example.json').read_text())
    for row in f['model']['blocks']:row['rho']=0
    if points is not None:f['points']=points
    p['forward_request']=f;p['parameters']=[dict(p['parameters'][0],cell_id=identity) for identity in ['west','east']];p['observed']['records']=[{**point,'value':.6293849964203642,'standard_deviation':.01,'group_id':None} for point in f['points']]
    return p

def test_independent_cube_density_recovery_operator_residual_replay_and_schema():
    p=request();before=copy.deepcopy(p);r=run(p);assert r['parameters'][0]['value']==pytest.approx(1000,rel=1e-12);assert r['operator']['matrix'][0][0]==pytest.approx(.0006293849964203642);assert r['misfit']['summary']['statistics']['rmse']<1e-12 and r['diagnostics']['data_nullity']==0 and r['convergence']['success']
    assert r['objective']['total']==pytest.approx(sum(r['objective'][k] for k in ['weighted_data','reference','smoothness'])) and p==before
    assert baselode.geophysics.calculate_block_forward(r['fitted_forward_request'])['fields']==r['forward_result']['fields'];assert run(r['request'])['parameters']==r['parameters']
    d=baselode.geophysics.describe_density_inversion();jsonschema.validate(p,d['request_schema']);jsonschema.validate(r,d['result_schema']);jsonschema.validate(baselode.geophysics.validate_density_inversion(p),d['validation_schema']);d['resources'].clear();assert baselode.geophysics.describe_density_inversion()['resources']['max_active_cells']==16

@pytest.mark.parametrize('regularization',[0,1,1e5])
def test_weighted_scalar_and_reference_prior_match_closed_form(regularization):
    p=request();a=.0006293849964203642;p['forward_request']['points'].append(dict(p['forward_request']['points'][0],id='second'));p['observed']['records'].append(dict(p['observed']['records'][0],id='second',value=1200*a,standard_deviation=.02));p['parameters'][0]['reference']=2000;p['regularization']['reference_weight']=regularization
    expected=(a*(1000*a)/.01**2+a*(1200*a)/.02**2+regularization*2000/1000**2)/(a*a/.01**2+a*a/.02**2+regularization/1000**2);r=run(p);assert r['parameters'][0]['value']==pytest.approx(expected,rel=1e-12)
    z=(expected-2000)/1000;assert r['objective']['reference']==pytest.approx(regularization*z*z,rel=1e-12,abs=1e-15)
    p['observed']['records'].reverse();assert run(p)['parameters'][0]['value']==pytest.approx(expected,rel=1e-12)

def test_hard_bounds_and_contradictory_reference_are_explicit():
    p=request();p['parameters'][0]['upper']=500;r=run(p);assert r['parameters'][0]['value']==500 and r['parameters'][0]['active_bound']==1;assert r['misfit']['summary']['statistics']['rmse']>.3
    p=request();p['parameters'][0]['lower']=1500;p['parameters'][0]['reference']=2000;r=run(p);assert r['parameters'][0]['value']==1500 and r['parameters'][0]['active_bound']==-1

def test_data_nullity_requires_augmented_rank_and_explicit_regularization_selects_model():
    p=two_cells();bad=baselode.geophysics.invert_density(p);assert bad['state']=='needs_input' and bad['parameters']==[] and bad['operator'] is None
    p['regularization']['reference_weight']=1;r=run(p);assert r['diagnostics']['data_rank']==1 and r['diagnostics']['data_nullity']==1 and r['diagnostics']['data_condition'] is None and r['diagnostics']['augmented_rank']==2
    p['regularization'].update(reference_weight=0,smoothness_weight=1,edges=[{'cell_a':'west','cell_b':'east','weight':1}]);r=run(p);assert [r['value'] for r in r['parameters']]==pytest.approx([1000,1000],rel=1e-11)

def test_signed_two_cell_recovery_smoothing_tradeoff_and_condition_gate():
    p=two_cells([{'id':str(i),'x_m':x,'y_m':y,'z_m':z} for i,(x,y,z) in enumerate([(-75,0,25),(75,0,25),(0,0,75)])]);f=copy.deepcopy(p['forward_request']);f['include_sensitivities']=False
    for row,value in zip(f['model']['blocks'],[800,-500]):row['rho']=value
    expected=baselode.geophysics.calculate_block_forward(f)
    for row,field in zip(p['observed']['records'],expected['fields']):row['value']=field['g_down']
    plain=run(p);assert [r['value'] for r in plain['parameters']]==pytest.approx([800,-500],rel=1e-11)
    p['regularization'].update(smoothness_weight=100,edges=[{'cell_a':'west','cell_b':'east','weight':2}]);smooth=run(p);assert abs(smooth['parameters'][0]['value']-smooth['parameters'][1]['value'])<1300;assert smooth['objective']['weighted_data']>plain['objective']['weighted_data'] and smooth['objective']['smoothness']>0
    p['regularization'].update(reference_weight=1e-20,smoothness_weight=0,edges=[]);p['parameters'][0]['scale']=.001;p['solver']['condition_limit']=100;assert baselode.geophysics.invert_density(p)['state']=='needs_input'

def cases():
    out=[]
    def add(path,value,state='rejected'):
        p=request();row=p
        for k in path[:-1]:row=row[k]
        row[path[-1]]=value;out.append((p,state))
    for key in ['schema','version','forward_request','observed','parameters','regularization','solver']:
        p=request();del p[key];out.append((p,'needs_input'))
    add(['version'],True);add(['extra'],1);add(['forward_request','include_sensitivities'],False);add(['forward_request','model','blocks',0,'rho'],1);add(['observed','context','quantity'],'magnetic_bx');add(['observed','context','units'],'nT');add(['observed','context','coordinate_frame','height_datum'],'other','needs_input');add(['observed','records',0,'value'],None,'needs_input');add(['observed','records',0,'value'],1e9);add(['observed','records',0,'standard_deviation'],None,'needs_input');add(['observed','records',0,'standard_deviation'],0);add(['observed','records',0,'x_m'],1,'needs_input');add(['parameters',0,'cell_id'],'other');add(['parameters',0,'lower'],3000);add(['parameters',0,'reference'],4000);add(['parameters',0,'scale'],True);add(['parameters',0,'scale'],1e-6);add(['parameters',0,'parameter'],'absolute_density');add(['regularization','reference_weight'],-1);add(['regularization','smoothness_weight'],1,'needs_input');add(['regularization','edges'],[{'cell_a':'west','cell_b':'east','weight':1}]);add(['solver','method'],'automatic');add(['solver','tolerance'],0);add(['solver','max_iterations'],1.5);add(['solver','condition_limit'],10)
    p=request();p['forward_request']['points']=[dict(p['forward_request']['points'][0],id=str(i)) for i in range(129)];out.append((p,'rejected'))
    p=request();p['metadata']={'large':'x'*131073};out.append((p,'rejected'))
    add(['regularization','edges'],{});add(['regularization','edges'],'bad');add(['forward_request','properties','density_contrast_kg_m3','column'],'j')
    return out

@pytest.mark.parametrize('p,state',cases())
def test_atomic_bad_contracts_context_and_resource(p,state):
    for f in [baselode.geophysics.validate_density_inversion,baselode.geophysics.invert_density]:
        r=f(p);assert r['state']==state,r;assert r['request'] is None and r['diagnostics']=={}
        if 'parameters' in r:assert r['parameters']==[] and r['fitted_forward_request'] is None and r['misfit'] is None

@pytest.mark.parametrize('failure',['status','bounds','flags','nan','incomplete','exception','gradient'])
def test_solver_failures_do_not_escape_or_publish_partial_models(monkeypatch,failure):
    def solve(*a,**k):
        if failure=='exception':raise ValueError('backend failure')
        if failure=='incomplete':return types.SimpleNamespace()
        s=types.SimpleNamespace(success=True,status=3,x=np.array([1.]),active_mask=np.array([0]),nit=0,optimality=0.,message='mock')
        if failure=='status':s.success=False;s.status=0
        if failure=='bounds':s.x=np.array([1e10])
        if failure=='flags':s.active_mask=np.array([-1])
        if failure=='nan':s.optimality=float('nan')
        if failure=='gradient':s.x=np.array([0.])
        return s
    monkeypatch.setattr(baselode.geophysics.inversion._optimize,'lsq_linear',solve);r=baselode.geophysics.invert_density(request());assert r['state']=='failed' and r['parameters']==[] and r['operator'] is None,r

def test_optional_backend_contract_and_cycle(monkeypatch):
    p=request();p['metadata']={'cycle':p};assert baselode.geophysics.validate_density_inversion(p)['state']=='rejected'
    monkeypatch.setattr(baselode.geophysics.inversion,'_optimize',None);assert baselode.geophysics.validate_density_inversion(request())['state']=='ok'
    with pytest.raises(ImportError,match=r'baselode\[inversion\]'):baselode.geophysics.invert_density(request())

def test_native_descriptor_and_positive_negative_portable_replay(tmp_path):
    examples=[request()]+[p for p,s in cases()];a=tmp_path/'in.json';b=tmp_path/'out.json';a.write_text(json.dumps(examples));subprocess.run(['node',str(ROOT/'test/data/inversion_parity.mjs'),str(a),str(b)],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True);js=json.loads(b.read_text());assert js['descriptor']==baselode.geophysics.describe_density_inversion()
    for p,j in zip(examples,js['reports']):
        r=baselode.geophysics.validate_density_inversion(p)
        for key in ['state','request','diagnostics']:assert r[key]==j[key],(key,r,j)
        assert [i['code'] for i in r['issues']]==[i['code'] for i in j['issues']]

@pytest.mark.parametrize('edges',[{},'bad',True])
def test_malformed_edge_type_is_contract_not_resource(edges):
    p=request();p['regularization']['edges']=edges;r=baselode.geophysics.validate_density_inversion(p);assert r['state']=='rejected' and r['issues'][0]['code']=='contract'

def test_reserved_property_mapping_is_rejected_before_model_write():
    p=request();p['forward_request']['properties']['density_contrast_kg_m3']['column']='j';r=baselode.geophysics.validate_density_inversion(p);assert r['state']=='rejected' and r['issues'][0]['code']=='contract'

def test_extreme_normalized_target_needs_input_without_numerical_warnings():
    p=request();p['forward_request']['points'][0]['z_m']=-100;p['observed']['records'][0]['z_m']=-100;p['regularization']['reference_weight']=1e-320;r=baselode.geophysics.invert_density(p);assert r['state']=='needs_input' and r['parameters']==[] and r['operator'] is None

def test_solver_wrong_version_has_installation_instruction(monkeypatch):
    original=baselode.geophysics.inversion.importlib.metadata.version
    monkeypatch.setattr(baselode.geophysics.inversion.importlib.metadata,'version',lambda name:'unsupported' if name=='scipy' else original(name))
    assert baselode.geophysics.validate_density_inversion(request())['state']=='ok'
    with pytest.raises(ImportError,match=r'baselode\[inversion\]'):baselode.geophysics.invert_density(request())
