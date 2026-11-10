# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Analytic/dense/quadrature, adjoint, terrain, resource and native contracts."""
import copy,json,math,pathlib,subprocess,sys
import jsonschema
import numpy as np
import pytest
import baselode.geophysics
import baselode.geophysics.potential_field_operator
ROOT=pathlib.Path(__file__).resolve().parents[1]
J=('magnetization_x_A_m','magnetization_y_A_m','magnetization_z_up_A_m')
def request(inverse=False):return json.loads((ROOT/('test/data/potential_field_'+('grid_inversion' if inverse else 'operator')+'_example.json')).read_text())
def supported():
    if sys.version_info>=(3,12):return True
    with pytest.raises(ImportError,match='Python>=3.12'):baselode.geophysics.calculate_potential_field_operator(request())
    return False

def run(p):
    r=baselode.geophysics.calculate_potential_field_operator(p);assert r['state']=='ok',r['issues'];return r

def magnetic(kind='magnetic_vector'):
    p=request();p.update(model_kind=kind,parameter_units='A/m' if kind=='magnetic_vector' else 'dimensionless',field_type='magnetic_anomaly',reference_id='synthetic_fixed_field',values=[.2,-.3,1.1] if kind=='magnetic_vector' else [.01],channels=['magnetic_bx','magnetic_by','magnetic_bz_up'],min_distance_m=1)
    if kind=='susceptibility':p['background_nT']={'x':0,'y':0,'z_up':50000}
    return p

def grid(p,shape,size,origin):
    n=math.prod(shape);p['grid'].update(shape=shape,cell_size_m=size,origin_m=origin,cell_ids=[str(i) for i in range(n)],active=[True]*n);p['values']=[1000]*n if p['model_kind']=='density' else [v for _ in range(n) for v in ([.2,-.3,1.1] if p['model_kind']=='magnetic_vector' else [.01])];return p

def test_analytic_gravity_cube_and_closed_form_ridge_density():
    if not supported():return
    p=request();before=copy.deepcopy(p);r=run(p);assert r['predicted'][0]['records'][0]['value']==pytest.approx(.6293849964203642,rel=1e-13);assert r['diagnostics']['matrix_free'] and p==before
    q=request(True);s=baselode.geophysics.invert_potential_field_grid(q);assert s['state']=='ok',s['issues'];a=.0006293849964203642;expected=(a*a*1000/.01**2)/(a*a/.01**2+1e-6/1000**2);assert s['parameters'][0]['value']==pytest.approx(expected,rel=1e-10);assert s['diagnostics']['data_rank'] is None and s['diagnostics']['augmented_condition_upper_bound']>=1;assert s['objective']['weighted_data']==s['misfit'][0]['summary']['statistics']['chi_squared'];assert run(s['fitted_operator_request'])['predicted']==s['predicted']
    for name,payload,result in [('potential_field_operator',p,r),('potential_field_grid_inversion',q,s)]:
        d=getattr(baselode.geophysics,'describe_'+name)();jsonschema.validate(payload,d['request_schema']);jsonschema.validate(result,d['result_schema'])

@pytest.mark.parametrize('kind',['magnetic_vector','susceptibility'])
def test_magnetic_unit_conversion_component_order_and_analytic_cube(kind):
    if not supported():return
    p=magnetic(kind);r=run(p);factor=(math.atan(1/math.sqrt(3))-math.atan(2500/(150*math.sqrt(27500))))/math.pi;k=1.25663706127e-6*1e9*factor;expected=[-.1*k,.15*k,1.1*k] if kind=='magnetic_vector' else [0,0,50000*.01*factor]
    assert [d['records'][0]['value'] for d in r['predicted']]==pytest.approx(expected,rel=2e-13,abs=1e-10)
    p['channels']=['magnetic_b_down'];r=run(p);assert r['predicted'][0]['records'][0]['value']==pytest.approx(-expected[2],rel=1e-13)

def test_matrix_free_products_weighted_norms_and_transpose_match_dense_small_reference():
    if not supported():return
    p=grid(magnetic(),[2,2,1],[50,50,100],[-50,-50,-150]);p['points']=[{'id':str(i),'x_m':x,'y_m':y,'z_m':0} for i,(x,y) in enumerate([(-30,-20),(30,40),(0,0)])];p,ids,_,diag=baselode.geophysics.potential_field_operator._prepare(p);a,norms,counter,adjoint=baselode.geophysics.potential_field_operator._build(p,ids,diag);columns=np.column_stack([a@np.eye(diag['parameters'])[:,i] for i in range(diag['parameters'])]);x=np.sin(np.arange(diag['parameters']));y=np.cos(np.arange(diag['observations']));assert a@x==pytest.approx(columns@x,rel=1e-12,abs=1e-11);assert a.rmatvec(y)==pytest.approx(columns.T@y,rel=1e-12,abs=1e-11)
    weights=np.arange(diag['observations'])/10+1;assert norms(weights)==pytest.approx(np.linalg.norm(columns*weights[:,None],axis=0),rel=1e-12);assert adjoint<1e-10 and counter.calls>0

def test_larger_tile_more_than_old_limits_partitions_match_verified_prisms():
    if not supported():return
    p=grid(request(),[4,4,4],[25,25,25],[-50,-50,-150]);p['points']=[{'id':str(i+16*j),'x_m':-75+10*i,'y_m':-75+10*j,'z_m':0} for j in range(16) for i in range(16)];r=run(p);assert r['diagnostics']['active_cells']==64 and r['diagnostics']['observations']==256
    q=json.loads((ROOT/'test/data/gravity_prisms_example.json').read_text());q['sources']=[{'id':'whole','kind':'prism','bounds_m':[-50,50,-50,50,-150,-50],'density_contrast_kg_m3':1000}];q['points']=p['points'];q['include_sensitivities']=False;expected=baselode.geophysics.calculate_gravity_prisms(q);assert expected['state']=='ok';assert [row['value'] for row in r['predicted'][0]['records']]==pytest.approx([row['g_down'] for row in expected['fields']],rel=1e-11,abs=1e-12)
    inv=request(True);inv['operator_request']=copy.deepcopy(p);inv['operator_request']['values']=[0]*64;inv['observed']=[]
    for dataset in r['predicted']:inv['observed'].append({'context':dataset['context'],'records':[{**row,'standard_deviation':.01,'group_id':None} for row in dataset['records']]})
    inv['parameters']=[dict(inv['parameters'][0],cell_id=identity,reference=1000) for identity in p['grid']['cell_ids']];inv['regularization']['reference_weight']=1;s=baselode.geophysics.invert_potential_field_grid(inv);assert s['state']=='ok',s['issues'];assert [p['value'] for p in s['parameters']]==pytest.approx([1000]*64,rel=1e-10);assert s['diagnostics']['matrix_free'] and s['diagnostics']['data_rank'] is None

def test_terrain_selection_and_volumes_are_conservative_and_keep_exceptions():
    p=grid(request(),[1,1,4],[100,100,100],[-50,-50,-300]);p['grid'].update(terrain_policy='exclude_intersecting',terrain_z_m=[-50,-50,-50,-50]);p['points'][0]['z_m']=200;r=baselode.geophysics.validate_potential_field_operator(p);assert r['state']=='ok',r;assert r['active_cell_ids']==['0','1'];assert r['excluded']=={'masked_ids':[],'above_ids':['3'],'intersecting_ids':['2']};assert r['diagnostics']['active_volume_m3']==2000000 and r['diagnostics']['excluded_volume_m3']==2000000
    if supported():
        actual=run(p);q=copy.deepcopy(p);q['grid'].update(terrain_policy='none',terrain_z_m=None,active=[True,True,False,False]);assert run(q)['predicted']==actual['predicted']

def volume_reference(point,kind,order=10):
    nodes,weights=np.polynomial.legendre.leggauss(order);axes=nodes/2;w=weights/2;total=np.zeros(3)
    for i,x in enumerate(axes):
        for j,y in enumerate(axes):
            for k,z in enumerate(axes):
                r=np.array(point)-[x,y,z];distance=np.linalg.norm(r);weight=w[i]*w[j]*w[k]
                if kind=='density':total+=6.6743e-11*100000*1e5*weight*(-r/distance**3)
                else:
                    moment=np.array([1000.,-500.,250.])*weight;total+=1.25663706127e-6/(4*math.pi)*1e9*(3*r*np.dot(moment,r)/distance**5-moment/distance**3)
    return -total[2] if kind=='density' else total

@pytest.mark.parametrize('kind',['density','magnetic_vector'])
def test_far_conditioning_domain_against_independent_volume_integral(kind):
    if not supported():return
    p=request() if kind=='density' else magnetic();p['grid'].update(origin_m=[-.5,-.5,-.5],cell_size_m=[1,1,1]);p['values']=[100000] if kind=='density' else [1000,-500,250];p['points']=[{'id':'far','x_m':500,'y_m':400,'z_m':1000}];r=run(p);expected=volume_reference([500,400,1000],kind);actual=[d['records'][0]['value'] for d in r['predicted']]
    assert actual==pytest.approx([expected] if kind=='density' else expected,rel=1e-4,abs=2e-9 if kind!='density' else 2e-10)

def test_tmi_checks_full_vector_and_budget_failure_is_atomic():
    if not supported():return
    p=magnetic();p['points']=[{'id':'off','x_m':100,'y_m':0,'z_m':0}];p['background_nT']={'x':0,'y':0,'z_up':50000};p['values']=[1,0,0];components=run(p);values=[d['records'][0]['value'] for d in components['predicted']];p['channels']=['magnetic_tmi_anomaly'];p['max_response_to_background_ratio']=(abs(values[2])+math.hypot(*values))/2/50000;r=baselode.geophysics.calculate_potential_field_operator(p);assert r['state']=='needs_input' and r['request'] is None and r['predicted'] is None
    p=request(True);p['operator_request']['execution']['max_operator_calls']=4;r=baselode.geophysics.invert_potential_field_grid(p);assert r['state']=='failed' and r['parameters']==[] and r['objective'] is None

def cases():
    out=[]
    def add(path,value,state='rejected'):
        p=request();o=p
        for k in path[:-1]:o=o[k]
        o[path[-1]]=value;out.append((p,state))
    add(['version'],True);add(['extra'],1);add(['grid','order'],'k_fastest');add(['grid','active'],[1]);add(['values'],[None],'needs_input');add(['grid','cell_size_m'],[.1,100,100]);add(['grid','shape'],[2,1,1]);add(['coordinate_frame','units'],'degree');add(['field_type'],'gravity_observed');add(['grid','terrain_z_m'],[0,0,0,0]);add(['execution','workspace_budget_mib'],16);add(['points',0,'z_m'],100001,'needs_input');add(['channels'],['magnetic_bx']);add(['grid','cell_ids'],['unknown']);add(['metadata'],{'huge':'x'*131073})
    p=grid(request(),[4096,1,1],[1,1,1],[0,0,-10]);out.append((p,'rejected'));p=magnetic();p['points'][0]['z_m']=-100;out.append((p,'needs_input'));p=request();p['grid']['active']=[False];out.append((p,'needs_input'))
    return out

@pytest.mark.parametrize('p,state',cases())
def test_atomic_core_contract_and_resource_failures(p,state):
    r=baselode.geophysics.validate_potential_field_operator(p);assert r['state']==state,r;assert r['request'] is None and r['active_cell_ids']==[] and r['predicted'] is None

@pytest.mark.parametrize('inverse',[False,True])
def test_native_descriptors_requests_and_negative_replay(tmp_path,inverse):
    examples=[request(inverse)] if inverse else [request(),magnetic(),magnetic('susceptibility')]+[p for p,s in cases()]
    if inverse:
        for path,value in [(['regularization','reference_weight'],0),(['solver','method'],'bvls'),(['parameters',0,'cell_id'],'other')]:
            p=request(True);o=p
            for k in path[:-1]:o=o[k]
            o[path[-1]]=value;examples.append(p)
    a=tmp_path/'in.json';b=tmp_path/'out.json';a.write_text(json.dumps(examples));subprocess.run(['node',str(ROOT/'test/data/potential_field_operator_parity.mjs'),str(a),str(b),'inverse' if inverse else 'operator'],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True);js=json.loads(b.read_text());name='potential_field_grid_inversion' if inverse else 'potential_field_operator';assert js['descriptor']==getattr(baselode.geophysics,'describe_'+name)()
    for p,j in zip(examples,js['reports']):
        py=getattr(baselode.geophysics,'validate_'+name)(p)
        for k in ['state','request','active_cell_ids','excluded','diagnostics']:assert py[k]==j[k],(k,py,j)
        assert [i['code'] for i in py['issues']]==[i['code'] for i in j['issues']]

def test_inverse_bound_condition_and_malformed_backend_are_atomic(monkeypatch):
    if not supported():return
    p=request(True);p['parameters'][0]['upper']=500;r=baselode.geophysics.invert_potential_field_grid(p);assert r['state']=='ok',r['issues'];assert r['parameters'][0]['value']==pytest.approx(500,rel=1e-8) and r['parameters'][0]['active_bound'] in (0,1)
    p=request(True);p['regularization']['reference_weight']=1e-12;p['solver']['condition_limit']=100;r=baselode.geophysics.invert_potential_field_grid(p);assert r['state']=='needs_input' and not r['parameters']
    import types
    monkeypatch.setattr(baselode.geophysics.potential_field_operator._optimize,'lsq_linear',lambda *a,**k:types.SimpleNamespace());r=baselode.geophysics.invert_potential_field_grid(request(True));assert r['state']=='failed' and not r['parameters'] and r['fitted_operator_request'] is None

def test_noninteger_spacing_kernel_mesh_uses_index_times_spacing_without_cumulative_drift(monkeypatch):
    if not supported():return
    p=grid(request(),[64,1,1],[1.1,2,2],[100000000,100000000,-20]);p['points']=[{'id':'offset','x_m':100000020,'y_m':100000001,'z_m':10}];prepare=baselode.geophysics.potential_field_operator._prepare(p);original=baselode.geophysics.potential_field_operator._discretize.TensorMesh;captured=[]
    class mesh(original):
        def __init__(self,*a,**k):
            super().__init__(*a,**k);captured.append(self)
    monkeypatch.setattr(baselode.geophysics.potential_field_operator._discretize,'TensorMesh',mesh);baselode.geophysics.potential_field_operator._build(prepare[0],prepare[1],prepare[3]);assert np.array_equal(captured[0].nodes_x,np.arange(65)*1.1)

def test_combined_maximum_vector_request_fits_schema_specific_node_budget(tmp_path):
    p=request(True);op=grid(magnetic(),[16,16,8],[25,25,25],[-200,-200,-250]);op['values']=[0]*6144;op['channels']=['magnetic_bx'];op['points']=[{'id':str(i),'x_m':i%32*10,'y_m':i//32*5,'z_m':0} for i in range(2048)];p['operator_request']=op
    p['parameters']=[{'cell_id':identity,'parameter':name,'lower':-1000,'upper':1000,'reference':0,'scale':1} for identity in op['grid']['cell_ids'] for name in J]
    p['regularization']['edges']=[{'cell_a':str(i),'cell_b':str((i+offset)%2048),'weight':1} for offset in (1,2) for i in range(2048)]
    p['observed']=[{'context':baselode.geophysics.potential_field_operator._context(op,'magnetic_bx'),'records':[{**point,'value':0,'standard_deviation':1,'group_id':None} for point in op['points']]}]
    # Prove the old global budget rejects this otherwise supported combination.
    with pytest.raises(baselode.geophysics.corrections._ResourceError,match='node/depth'):baselode.geophysics.forward_common._bounded_json(p,8388608)
    r=baselode.geophysics.validate_potential_field_grid_inversion(p);assert r['state']=='ok',r['issues'];assert r['diagnostics']['parameters']==6144 and len(r['request']['regularization']['edges'])==4096
    a=tmp_path/'max.json';b=tmp_path/'out.json';a.write_text(json.dumps([p]));subprocess.run(['node',str(ROOT/'test/data/potential_field_operator_parity.mjs'),str(a),str(b),'inverse'],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True);native=json.loads(b.read_text())['reports'][0];assert native['state']=='ok',native['issues'];assert native['request']==r['request']
