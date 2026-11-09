# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent cube tensor inversion, free direction and multi-channel policies."""
import copy,json,math,pathlib,subprocess
import jsonschema
import numpy as np
import pytest
import baselode.geophysics
ROOT=pathlib.Path(__file__).resolve().parents[1]
J=('magnetization_x_A_m','magnetization_y_A_m','magnetization_z_up_A_m')
QUANTITIES=('magnetic_bx','magnetic_by','magnetic_bz_up')

def request():return json.loads((ROOT/'test/data/magnetic_vector_inversion_example.json').read_text())
def run(p):
    r=baselode.geophysics.invert_magnetic_vector(p);assert r['state']=='ok',r['issues'];return r

def synthetic(points=None,vectors=None,tmi=False,two=False):
    p=request();f=p['forward_request']
    if two:
        base=json.loads((ROOT/'test/data/block_forward_example.json').read_text());f['model']=base['model'];p['parameters']=[dict(param,cell_id=identity) for identity in ['west','east'] for param in p['parameters']]
        for row in f['model']['blocks']:
            row.pop('rho')
            for k in J:row[k]=0
    if points is not None:f['points']=points
    if vectors is None:vectors=[[.2,-.3,1.1] for _ in f['model']['blocks']]
    if tmi:
        f['background_nT']={'x':0,'y':0,'z_up':50000};p['magnetic_assumptions'].update(objective='linear_tmi',background_reference_id='synthetic_fixed_field',max_response_to_background_ratio=.05)
    truth=copy.deepcopy(f);truth['include_sensitivities']=False
    for row,vector in zip(truth['model']['blocks'],vectors):
        for k,v in zip(J,vector):row[k]=v
    result=baselode.geophysics.calculate_block_forward(truth);assert result['state']=='ok',result['issues'];context=p['observed'][0]['context'];quantities=['magnetic_tmi_anomaly'] if tmi else QUANTITIES;fields=['tmi_linear'] if tmi else ['bx','by','bz_up']
    p['observed']=[{'context':{**context,'quantity':quantity,'reference_id':p['magnetic_assumptions']['background_reference_id'],'coordinate_frame':copy.deepcopy(f['coordinate_frame'])},'records':[{**point,'value':field[component],'standard_deviation':.01,'group_id':None} for point,field in zip(f['points'],result['fields'])]} for quantity,component in zip(quantities,fields)]
    return p,result

def test_independent_analytic_cube_tensor_recovers_vector_amplitude_and_direction():
    p=request();before=copy.deepcopy(p);r=run(p);a=50.;near=50.;far=150.;response=1.25663706127e-6*1e9/math.pi*(math.atan(a*a/(near*math.sqrt(near*near+2*a*a)))-math.atan(a*a/(far*math.sqrt(far*far+2*a*a))))
    assert np.array(r['operator']['matrix'])==pytest.approx(np.diag([-.5*response,-.5*response,response]),rel=2e-13,abs=1e-12);assert [row['value'] for row in r['parameters']]==pytest.approx([.2,-.3,1.1],rel=2e-13)
    model=r['magnetization'][0];amplitude=math.sqrt(.2**2+.3**2+1.1**2);assert model['amplitude_A_m']==pytest.approx(amplitude);assert list(model['unit_direction'].values())==pytest.approx([.2/amplitude,-.3/amplitude,1.1/amplitude]);assert r['exact_tmi_misfit'] is None and r['magnetic_model']['background_nT'] is None and r['magnetic_model']['max_fitted_response_to_background_ratio'] is None
    assert r['diagnostics']['parameters']==3 and r['diagnostics']['observations']==3 and r['diagnostics']['data_nullity']==0
    assert [row['quantity'] for row in r['operator']['rows']]==list(QUANTITIES);assert r['objective']['weighted_data']==sum(q['summary']['statistics']['chi_squared'] for q in r['misfit']);assert p==before
    d=baselode.geophysics.describe_magnetic_vector_inversion();jsonschema.validate(p,d['request_schema']);jsonschema.validate(r,d['result_schema']);jsonschema.validate(baselode.geophysics.validate_magnetic_vector_inversion(p),d['validation_schema']);assert run(r['request'])['magnetization']==r['magnetization'];assert baselode.geophysics.calculate_block_forward(r['fitted_forward_request'])['fields']==r['forward_result']['fields']

def test_zero_amplitude_has_no_direction_and_bdown_sign_is_explicit():
    p=request()
    for observed in p['observed']:observed['records'][0]['value']=0
    r=run(p);assert r['magnetization'][0]['amplitude_A_m']==0 and r['magnetization'][0]['unit_direction'] is None
    p=request();p['observed'][2]['context']['quantity']='magnetic_b_down';p['observed'][2]['records'][0]['value']*=-1;r=run(p);assert [row['value'] for row in r['parameters']]==pytest.approx([.2,-.3,1.1]) and r['operator']['matrix'][2][2]<0

def test_vector_objective_does_not_require_weak_total_field_approximation():
    p=request();p['forward_request']['background_nT']={'x':0,'y':0,'z_up':1};r=run(p);assert r['magnetic_model']['max_fitted_response_to_background_ratio']>100;assert r['exact_tmi_misfit'] is None and [x['value'] for x in r['parameters']]==pytest.approx([.2,-.3,1.1])

def test_bounds_are_on_cartesian_components_and_change_reported_direction():
    p=request();p['parameters'][0]['upper']=.1;r=run(p);assert [x['value'] for x in r['parameters']]==pytest.approx([.1,-.3,1.1]);assert r['parameters'][0]['active_bound']==1;assert r['magnetization'][0]['unit_direction']['x']<.1

def test_linear_tmi_free_direction_recovery_and_scalar_assumption_mismatch():
    points=[{'id':str(i),'x_m':x,'y_m':y,'z_m':0} for i,(x,y) in enumerate([(-100,0),(100,0),(0,-100),(0,100),(0,0)])];p,_=synthetic(points=points,vectors=[[1,.2,.3]],tmi=True);r=run(p);assert [v['value'] for v in r['parameters']]==pytest.approx([1,.2,.3],rel=1e-11);assert r['misfit'][0]['summary']['statistics']['chi_squared']<1e-15;assert r['exact_tmi_misfit'][0]['summary']['statistics']['chi_squared']>0
    scalar=copy.deepcopy(p);scalar['schema']='baselode.geophysics.susceptibility_inversion_request';scalar['observed']=scalar['observed'][0];scalar['parameters']=[{'cell_id':'west','parameter':'susceptibility_SI','lower':0,'upper':.1,'reference':0,'scale':.01}];scalar['magnetic_assumptions'].update(model='induced_only_no_demagnetization');del scalar['magnetic_assumptions']['error_model'];s=baselode.geophysics.invert_susceptibility(scalar);assert s['state']=='ok',s['issues'];assert s['misfit']['summary']['statistics']['chi_squared']>1000

def test_nullity_regularisation_and_componentwise_edges_select_a_uniform_vector():
    p,_=synthetic(two=True);bad=baselode.geophysics.invert_magnetic_vector(p);assert bad['state']=='needs_input' and bad['magnetization']==[]
    p['regularization'].update(smoothness_weight=1,edges=[{'cell_a':'west','cell_b':'east','weight':1}]);r=run(p);assert r['diagnostics']['data_nullity']==3 and r['diagnostics']['augmented_rank']==6
    for model in r['magnetization']:assert [model['x_A_m'],model['y_A_m'],model['z_up_A_m']]==pytest.approx([.2,-.3,1.1],rel=1e-10)
    p['regularization'].update(reference_weight=1,smoothness_weight=0,edges=[]);p['parameters'][0]['reference']=2;biased=run(p);assert biased['parameters'][0]['value']>r['parameters'][0]['value'];assert biased['diagnostics']['data_nonunique']

def test_weighted_multi_channel_noise_matches_independent_normal_equations_and_order():
    points=[{'id':str(i),'x_m':x,'y_m':y,'z_m':z} for i,(x,y,z) in enumerate([(0,0,0),(75,40,25),(-50,-20,0)])];p,_=synthetic(points=points)
    for c,observed in enumerate(p['observed']):
        for i,row in enumerate(observed['records']):row['value']+=(i-1)*(.03+c*.02);row['standard_deviation']=.02*(1+i+c)
    r=run(p);a=np.array(r['operator']['matrix']);data=np.array([row['value'] for o in p['observed'] for row in o['records']]);sigma=np.array([row['standard_deviation'] for o in p['observed'] for row in o['records']]);expected=np.linalg.solve(a.T@(a/sigma[:,None]**2),a.T@(data/sigma**2));assert [v['value'] for v in r['parameters']]==pytest.approx(expected,rel=1e-11)
    p['observed'].reverse()
    for observed in p['observed']:observed['records'].reverse()
    assert [v['value'] for v in run(p)['parameters']]==pytest.approx(expected,rel=1e-11)

def test_linear_tmi_postfit_vector_gate_withholds_every_model_and_qc():
    point=[{'id':'off_axis','x_m':100,'y_m':0,'z_m':0}];p,truth=synthetic(points=point,vectors=[[1,0,0]],tmi=True);p['regularization']['reference_weight']=1e4
    for param,value in zip(p['parameters'],[1,0,0]):param['reference']=value
    field=truth['fields'][0];scalar=abs(field['tmi_linear'])/50000;vector=math.hypot(field['bx'],field['by'],field['bz_up'])/50000;assert vector>scalar;p['magnetic_assumptions']['max_response_to_background_ratio']=(scalar+vector)/2
    assert baselode.geophysics.validate_magnetic_vector_inversion(p)['state']=='ok';r=baselode.geophysics.invert_magnetic_vector(p);assert r['state']=='needs_input' and r['magnetization']==[] and r['parameters']==[] and r['misfit'] is None and r['exact_tmi_misfit'] is None

def cases():
    out=[]
    def add(path,value,state='rejected'):
        p=request();row=p
        for k in path[:-1]:row=row[k]
        row[path[-1]]=value;out.append((p,state))
    add(['observed'],{});add(['observed'],[],'needs_input');add(['observed',0,'records',0,'standard_deviation'],None,'needs_input');add(['observed',0,'context','reference_id'],'other','needs_input');add(['parameters',1,'parameter'],J[0]);add(['parameters',0,'upper'],1001);add(['magnetic_assumptions','model'],'induced_only_no_demagnetization');add(['magnetic_assumptions','objective'],'exact_tmi');add(['magnetic_assumptions','error_model'],'full_covariance');add(['magnetic_assumptions','max_response_to_background_ratio'],.05);add(['forward_request','properties',J[1],'column'],J[0]);add(['forward_request','model','blocks',0,J[2]],1)
    p=request();del p['magnetic_assumptions']['max_response_to_background_ratio'];out.append((p,'needs_input'))
    p=request();p['observed'][1]=copy.deepcopy(p['observed'][2]);p['observed'][1]['context']['quantity']='magnetic_b_down';p['observed'][1]['records'][0]['value']*=-1;out.append((p,'rejected'))
    p=request();p['observed']*=2;out.append((p,'rejected'))
    p,_=synthetic(tmi=True);p['forward_request']['background_nT']=None;out.append((p,'needs_input'))
    p=request();p['forward_request']['points']=[dict(p['forward_request']['points'][0],id=str(i)) for i in range(43)]
    for observed in p['observed']:observed['records']=[dict(observed['records'][0],id=str(i)) for i in range(43)]
    out.append((p,'rejected'))
    return out

@pytest.mark.parametrize('p,state',cases())
def test_atomic_context_channels_property_and_resource_contracts(p,state):
    for fn in [baselode.geophysics.validate_magnetic_vector_inversion,baselode.geophysics.invert_magnetic_vector]:
        r=fn(p);assert r['state']==state,r;assert r['request'] is None
        if 'parameters' in r:assert r['parameters']==[] and r['magnetization']==[] and r['magnetic_model'] is None and r['exact_tmi_misfit'] is None

def test_native_shared_descriptor_channels_and_negative_replay(tmp_path):
    examples=[request(),synthetic(tmi=True)[0]]+[p for p,s in cases()];a=tmp_path/'in.json';b=tmp_path/'out.json';a.write_text(json.dumps(examples));subprocess.run(['node',str(ROOT/'test/data/inversion_parity.mjs'),str(a),str(b),'magnetic_vector'],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True);js=json.loads(b.read_text());assert js['descriptor']==baselode.geophysics.describe_magnetic_vector_inversion()
    for p,j in zip(examples,js['reports']):
        py=baselode.geophysics.validate_magnetic_vector_inversion(p)
        for key in ['state','request','diagnostics']:assert py[key]==j[key],(key,py,j)
        assert [i['code'] for i in py['issues']]==[i['code'] for i in j['issues']]
