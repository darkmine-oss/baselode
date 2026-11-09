# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Equivalent solid prism, partition conservation and portable preparation."""
import copy,json,pathlib,subprocess
import pandas as pd
import jsonschema
import pytest
import baselode.blockmodel
import baselode.geophysics
import baselode.geophysics.gravity_prisms
import baselode.geophysics.magnetic_prisms
ROOT=pathlib.Path(__file__).resolve().parents[1]
J=('magnetization_x_A_m','magnetization_y_A_m','magnetization_z_up_A_m')
def request():return json.loads((ROOT/'test/data/block_forward_example.json').read_text())
def magnetic():
    p=request();p.update(physics='magnetic',background_nT={'x':100,'y':200,'z_up':50000},min_distance_m=1,properties={k:{'column':k,'units':'A/m'} for k in J})
    for r in p['model']['blocks']:r.update(dict(zip(J,[20,-10,1])))
    return p
def run(p):
    r=baselode.geophysics.calculate_block_forward(p);assert r['state']=='ok',r['issues'];return r

def test_real_block_model_serialization_and_independent_cube_partition():
    p=request();d=baselode.blockmodel.BlockModelDefinition.from_dict(p['model']['definition']);model=baselode.blockmodel.BlockModel(pd.DataFrame(p['model']['blocks']),definition=d);p['model']={'definition':model.definition.to_dict(),'blocks':model.blocks.to_dict('records')};before=copy.deepcopy(p);r=run(p)
    # Sum of two equal half prisms must match the independent solid cube fixture.
    q=json.loads((ROOT/'test/data/gravity_prisms_example.json').read_text());q['sources']=[{'id':'solid','kind':'prism','bounds_m':[-50,50,-50,50,-150,-50],'density_contrast_kg_m3':1000}];q['points']=p['points']
    expected=baselode.geophysics.calculate_gravity_prisms(q)['fields'][0]
    for key in ['gx','gy','gz_up','g_down','potential']:assert r['fields'][0][key]==pytest.approx(expected[key],abs=1e-14)
    assert r['fields'][0]['g_down']==pytest.approx(.6293849964203642);assert r['cell_ids']==['west','east'] and p==before
    descriptor=baselode.geophysics.describe_block_forward();jsonschema.validate(p,descriptor['request_schema']);jsonschema.validate(r,descriptor['result_schema']);jsonschema.validate(baselode.geophysics.prepare_block_forward(p),descriptor['result_schema'])
    assert run(r['request'])['fields']==r['fields']

@pytest.mark.parametrize('factory',[request,magnetic])
def test_batch_partition_invariance_and_sensitivities(factory):
    p=factory();a=run(p);p['batch_size']=64;b=run(p)
    assert a['fields']==b['fields'] and a['sensitivities']==b['sensitivities']
    p['batch_size']=1;p['model']['blocks'][1]['active']=False;c=run(p);assert c['inactive_ids']==['east'] and c['cell_ids']==['west'];assert len(c['sensitivities'])==(3 if p['physics']=='magnetic' else 1)
    # Optional all-active mode is an explicit null, never inferred from absent fields.
    p['active_column']=None;assert run(p)['cell_ids']==['west','east']

def test_exact_tmi_uses_global_vector_sum_and_signed_density_superposition():
    p=magnetic();r=run(p);prepared=baselode.geophysics.prepare_block_forward(p)
    separate=sum(baselode.geophysics.calculate_magnetic_prisms(x)['fields'][0]['tmi_exact'] for x in prepared['batches']);assert abs(separate-r['fields'][0]['tmi_exact'])>1e-3
    field=r['fields'][0];b=[p['background_nT'][k] for k in ['x','y','z_up']];v=[field[k] for k in ['bx','by','bz_up']]
    import math
    assert field['tmi_exact']==pytest.approx(math.sqrt(sum((x+y)**2 for x,y in zip(b,v)))-math.sqrt(sum(x*x for x in b)),abs=1e-10)
    p=request();p['model']['blocks'][1]['rho']=-1000;r=run(p);assert abs(r['fields'][0]['g_down'])<1e-14;assert r['fields'][0]['gx']!=0

def cases():
    out=[]
    def add(path,value,state='rejected'):
        p=request();row=p
        for k in path[:-1]:row=row[k]
        row[path[-1]]=value;out.append((p,state))
    add(['batch_size'],True);add(['batch_size'],1.5);add(['extra'],1);add(['properties','density_contrast_kg_m3','units'],'g/cm^3');add(['model','definition','rotation','azimuth'],30,'needs_input');add(['coordinate_frame','id'],'other','needs_input');add(['model','blocks',0,'i'],.5);add(['model','blocks',0,'ni'],3);add(['model','blocks',0,'rho'],None);add(['model','blocks',0,'active'],1);add(['model','blocks',1,'cell_id'],'west');add(['model','blocks',1,'i'],0);add(['model','blocks',0,'fill_fraction'],.5,'needs_input');add(['model','blocks',0,'fill_fraction'],True,'needs_input');add(['model','blocks',0,'x'],0);add(['model','definition','origin','x'],True);add(['include_sensitivities'],'yes');add(['background_nT'],{'x':1,'y':0,'z_up':0})
    p=request();p['model']['blocks']*=257;out.append((p,'rejected'))
    p=request()
    for row in p['model']['blocks']:row['active']=False
    out.append((p,'needs_input'))
    p=magnetic();p['points'][0]['z_m']=-100;out.append((p,'needs_input'))
    p=request();del p['active_column'];out.append((p,'needs_input'))
    return out

@pytest.mark.parametrize('p,state',cases())
def test_atomic_invalid_contract_geometry_units_and_domains(p,state):
    r=baselode.geophysics.prepare_block_forward(p);assert r['state']==state,r;assert r['request'] is None and r['batches']==[] and r['cell_ids']==[]
    r=baselode.geophysics.calculate_block_forward(p);assert r['state']==state,r;assert r['fields']==[] and r['sensitivities']==[]

def test_backend_failure_withholds_preparation_and_fields(monkeypatch):
    monkeypatch.setattr(baselode.geophysics.gravity_prisms,'calculate_gravity_prisms',lambda p:{'state':'failed','issues':[{'message':'failure'}]})
    r=baselode.geophysics.calculate_block_forward(request());assert r['state']=='failed' and r['request'] is None and not r['batches'] and not r['fields']

def test_inactive_attributes_nullable_snapshot_depth_and_result_independence():
    p=request();p['model']['blocks'][1].update(active=False,rho=None);assert run(p)['inactive_ids']==['east']
    r=baselode.geophysics.prepare_block_forward(p);r['batches'][0]['sources'][0]['bounds_m'][0]=999;assert p['model']['definition']['origin']['x']==-50
    p['metadata']={'cycle':p};assert baselode.geophysics.prepare_block_forward(p)['state']=='rejected'

def test_native_replay_positive_and_all_negative_states(tmp_path):
    cases_all=[request(),magnetic()]+[p for p,s in cases()];a=tmp_path/'input.json';b=tmp_path/'output.json';a.write_text(json.dumps(cases_all));subprocess.run(['node',str(ROOT/'test/data/block_forward_parity.mjs'),str(a),str(b)],check=True,capture_output=True,text=True,cwd=ROOT/'javascript/packages/baselode');js=json.loads(b.read_text());assert js['descriptor']==baselode.geophysics.describe_block_forward()
    for p,j in zip(cases_all,js['reports']):
        py=baselode.geophysics.prepare_block_forward(p)
        for key in ['state','request','batches','cell_ids','inactive_ids','diagnostics']:assert py[key]==j[key],(key,py,j)
        assert [x['code'] for x in py['issues']]==[x['code'] for x in j['issues']]
        if j['state']=='ok':assert baselode.geophysics.prepare_block_forward(j['request'])['batches']==j['batches']

def test_full_cell_budget_and_global_sensitivity_resource_gate():
    p=request();d=p['model']['definition'];d.update(origin={'x':0,'y':0,'z':0},block_size={'dx':100,'dy':100,'dz':100},n_blocks={'nx':8,'ny':8,'nz':8});p['model']['blocks']=[dict(p['model']['blocks'][0],cell_id=str(i),i=i%8,j=(i//8)%8,k=i//64) for i in range(512)];p['points']=[{'id':'outside','x_m':-10,'y_m':-10,'z_m':-10}]
    r=baselode.geophysics.prepare_block_forward(p);assert r['state']=='ok' and r['diagnostics']['active_count']==512 and r['diagnostics']['batch_count']==512
    p['points']=[dict(p['points'][0],id=str(i)) for i in range(9)];r=baselode.geophysics.prepare_block_forward(p);assert r['state']=='rejected' and r['issues'][0]['code']=='resource'
    p=request();p['metadata']={'large':'x'*131073};assert baselode.geophysics.prepare_block_forward(p)['issues'][0]['code']=='resource'

def test_cancellation_keeps_source_order_independent_of_three_way_batching(monkeypatch):
    import math
    p=request();p['model']['definition']['n_blocks']['nx']=3;p['model']['blocks'].append(dict(p['model']['blocks'][0],cell_id='third',i=2));contributions={'west':1e16,'east':1.,'third':-1e16}
    def kernel(child):
        v=math.fsum(contributions[s['id']] for s in child['sources'])
        return {'state':'ok','fields':[{'gx':v,'gy':0.,'gz_up':0.,'g_down':0.,'potential':0.}],'sensitivities':[],'field_units':{}}
    monkeypatch.setattr(baselode.geophysics.gravity_prisms,'calculate_gravity_prisms',kernel)
    for size in [1,2,3,64]:p['batch_size']=size;assert run(p)['fields'][0]['gx']==1.

def test_returned_batches_have_independent_points_frame_and_replay_snapshot():
    for factory in [request,magnetic]:
        p=factory();r=baselode.geophysics.prepare_block_forward(p);before=copy.deepcopy(r['request']);other=copy.deepcopy(r['batches'][1]);r['batches'][0]['points'][0]['z_m']=999;r['batches'][0]['coordinate_frame']['id']='edited';assert r['request']==before and r['batches'][1]==other and p==before
