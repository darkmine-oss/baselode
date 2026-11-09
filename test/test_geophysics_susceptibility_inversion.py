# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Analytic induced cube, conversion/sign physics and approximation diagnostics."""
import copy,json,math,pathlib,subprocess
import jsonschema
import pytest
import baselode.geophysics
ROOT=pathlib.Path(__file__).resolve().parents[1]
J=('magnetization_x_A_m','magnetization_y_A_m','magnetization_z_up_A_m')
MU0=1.25663706127e-6

def request():return json.loads((ROOT/'test/data/susceptibility_inversion_example.json').read_text())
def run(p):
    r=baselode.geophysics.invert_susceptibility(p);assert r['state']=='ok',r['issues'];return r

def synthetic(chi=.01,points=None,remanent=None):
    p=request();f=p['forward_request']
    if points is not None:f['points']=points
    truth=copy.deepcopy(f);truth['include_sensitivities']=False;bg=[f['background_nT'][k] for k in ('x','y','z_up')]
    for row in truth['model']['blocks']:
        for i,k in enumerate(J):row[k]=chi*bg[i]*1e-9/MU0 if remanent is None else remanent[i]
    result=baselode.geophysics.calculate_block_forward(truth);assert result['state']=='ok',result['issues'];p['observed']['records']=[{**point,'value':field['tmi_linear'],'standard_deviation':.01,'group_id':None} for point,field in zip(f['points'],result['fields'])]
    return p,result

def test_analytic_cube_axis_susceptibility_sign_conversion_schema_and_replay():
    p=request();before=copy.deepcopy(p);r=run(p)
    # Independent solid angles of uniformly magnetically charged top/bottom faces.
    a=50.;near=50.;far=150.;factor=(math.atan(a*a/(near*math.sqrt(near*near+2*a*a)))-math.atan(a*a/(far*math.sqrt(far*far+2*a*a))))/math.pi
    assert r['operator']['matrix'][0][0]==pytest.approx(50000*factor,rel=2e-13);assert r['parameters'][0]['value']==pytest.approx(.01,rel=2e-13);assert r['parameters'][0]['units']=='dimensionless'
    assert r['fitted_forward_request']['model']['blocks'][0][J[2]]==pytest.approx(.01*50000e-9/MU0);assert r['magnetic_model']['inducing_field_H_A_m']['z_up']==pytest.approx(50000e-9/MU0);assert r['misfit']['summary']['statistics']['rmse']<1e-10 and r['exact_tmi_misfit']['summary']['statistics']['rmse']<1e-10
    assert p==before and run(r['request'])['parameters']==r['parameters'];assert baselode.geophysics.calculate_block_forward(r['fitted_forward_request'])['fields']==r['forward_result']['fields']
    d=baselode.geophysics.describe_susceptibility_inversion();jsonschema.validate(p,d['request_schema']);jsonschema.validate(r,d['result_schema']);jsonschema.validate(baselode.geophysics.validate_susceptibility_inversion(p),d['validation_schema'])

def test_reversed_inducing_field_and_negative_allowed_susceptibility():
    p=request();p['forward_request']['background_nT']['z_up']=-50000;r=run(p);assert r['parameters'][0]['value']==pytest.approx(.01);assert r['fitted_forward_request']['model']['blocks'][0][J[2]]<0
    p=request();p['parameters'][0]['lower']=-.1;p['observed']['records'][0]['value']*=-1;r=run(p);assert r['parameters'][0]['value']==pytest.approx(-.01) and r['fitted_forward_request']['model']['blocks'][0][J[2]]<0

@pytest.mark.parametrize('weight',[0,1e5,1e8])
def test_independent_scalar_reference_penalty_solution(weight):
    p=request();p['parameters'][0]['reference']=.05;p['regularization']['reference_weight']=weight;a=p['observed']['records'][0]['value']/.01;sigma=.01;expected=(a*a*.01/sigma**2+weight*.05/.01**2)/(a*a/sigma**2+weight/.01**2);r=run(p);assert r['parameters'][0]['value']==pytest.approx(expected,rel=2e-12)
    assert r['objective']['reference']==pytest.approx(weight*((expected-.05)/.01)**2,rel=1e-10,abs=1e-12)

def test_hard_susceptibility_bound_and_projection_finite_difference():
    p=request();p['parameters'][0]['upper']=.005;r=run(p);assert r['parameters'][0]['value']==.005 and r['parameters'][0]['active_bound']==1
    p,truth=synthetic(points=[{'id':'off_axis','x_m':100,'y_m':30,'z_m':0}]);r=run(p);_,next_truth=synthetic(chi=.010001,points=p['forward_request']['points']);derivative=(next_truth['fields'][0]['tmi_linear']-truth['fields'][0]['tmi_linear'])/.000001;assert r['operator']['matrix'][0][0]==pytest.approx(derivative,rel=1e-10)

def test_exact_tmi_qc_exposes_linearisation_error_at_high_measurement_precision():
    p,_=synthetic(points=[{'id':'off_axis','x_m':100,'y_m':0,'z_m':0}]);p['observed']['records'][0]['standard_deviation']=1e-6;r=run(p);assert r['parameters'][0]['value']==pytest.approx(.01,rel=1e-12)
    assert r['misfit']['summary']['statistics']['chi_squared']<1e-10 and r['exact_tmi_misfit']['summary']['statistics']['chi_squared']>1
    field=r['forward_result']['fields'][0];exact=math.sqrt(field['bx']**2+field['by']**2+(50000+field['bz_up'])**2)-50000;assert r['exact_tmi_misfit']['rows'][0]['predicted']==pytest.approx(exact,abs=1e-10)

def test_postfit_full_vector_policy_is_checked_even_when_linear_anomaly_is_small():
    p,truth=synthetic(points=[{'id':'off_axis','x_m':100,'y_m':0,'z_m':0}]);field=truth['fields'][0];scalar=abs(field['tmi_linear'])/50000;vector=math.sqrt(field['bx']**2+field['by']**2+field['bz_up']**2)/50000;assert vector>scalar;p['magnetic_assumptions']['max_response_to_background_ratio']=(scalar+vector)/2
    assert baselode.geophysics.validate_susceptibility_inversion(p)['state']=='ok';r=baselode.geophysics.invert_susceptibility(p);assert r['state']=='needs_input' and r['parameters']==[] and r['magnetic_model'] is None and r['exact_tmi_misfit'] is None

def test_remanent_odd_signal_does_not_become_a_claim_of_induced_fit():
    p,_=synthetic(points=[{'id':str(i),'x_m':x,'y_m':0,'z_m':0} for i,x in enumerate([-100,0,100])],remanent=[1,0,0]);r=run(p);assert r['misfit']['summary']['statistics']['chi_squared']>1000;assert r['exact_tmi_misfit']['summary']['statistics']['chi_squared']>1000

def cases():
    out=[]
    def add(path,value,state='rejected'):
        p=request();row=p
        for k in path[:-1]:row=row[k]
        row[path[-1]]=value;out.append((p,state))
    p=request();del p['magnetic_assumptions'];out.append((p,'needs_input'))
    add(['magnetic_assumptions','model'],'remanent');add(['magnetic_assumptions','objective'],'exact_tmi');add(['magnetic_assumptions','background_reference_id'],'other','needs_input');add(['magnetic_assumptions','max_response_to_background_ratio'],0);add(['magnetic_assumptions','max_response_to_background_ratio'],.1);add(['magnetic_assumptions','max_response_to_background_ratio'],1e-12,'needs_input');add(['forward_request','background_nT'],None,'needs_input');add(['forward_request','model','blocks',0,J[0]],1);add(['forward_request','properties',J[1],'column'],J[0]);add(['parameters',0,'upper'],1);add(['parameters',0,'parameter'],'susceptibility_cgs');add(['parameters',0,'scale'],.2);add(['observed','context','quantity'],'gravity_g_down');add(['observed','context','field_type'],'gravity_anomaly');add(['observed','records',0,'value'],None,'needs_input');add(['regularization','edges'],{});add(['solver','tolerance'],True)
    return out

@pytest.mark.parametrize('p,state',cases())
def test_explicit_assumption_units_context_and_domain_failures(p,state):
    for f in [baselode.geophysics.validate_susceptibility_inversion,baselode.geophysics.invert_susceptibility]:
        r=f(p);assert r['state']==state,r;assert r['request'] is None
        if 'parameters' in r:assert r['parameters']==[] and r['magnetic_model'] is None and r['exact_tmi_misfit'] is None

def test_native_induced_descriptor_and_all_negative_request_replay(tmp_path):
    examples=[request()]+[p for p,s in cases()];a=tmp_path/'in.json';b=tmp_path/'out.json';a.write_text(json.dumps(examples));subprocess.run(['node',str(ROOT/'test/data/inversion_parity.mjs'),str(a),str(b),'susceptibility'],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True);js=json.loads(b.read_text());assert js['descriptor']==baselode.geophysics.describe_susceptibility_inversion()
    for p,j in zip(examples,js['reports']):
        py=baselode.geophysics.validate_susceptibility_inversion(p)
        for key in ['state','request','diagnostics']:assert py[key]==j[key],(key,py,j)
        assert [i['code'] for i in py['issues']]==[i['code'] for i in j['issues']]
