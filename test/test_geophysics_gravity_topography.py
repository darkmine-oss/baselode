# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent Newtonian terrain anchors, history/order and native replay."""
import copy
import json
import pathlib
import subprocess

import jsonschema
import pytest

import baselode.geophysics
import baselode.geophysics.corrections
import baselode.geophysics.gravity_topography

ROOT = pathlib.Path(__file__).resolve().parents[1]


def fixture():
    return json.loads((ROOT/'test/data/gravity_topography_reference.json').read_text())


def reduced():
    f=fixture();p=baselode.geophysics.apply_bouguer_plate(f['survey'],f['plate_options']);assert p['state']=='ok',p['issues']
    t=baselode.geophysics.correct_gravity_terrain(p['observations'],f['terrain_options']);assert t['state']=='ok',t['issues'];return p,t


def test_independent_newtonian_relief_recovers_known_disturbances_and_density_sensitivity():
    f=fixture();before=copy.deepcopy(f);p=baselode.geophysics.apply_bouguer_plate(f['survey'],f['plate_options']);assert p['state']=='ok',p['issues']
    t=baselode.geophysics.correct_gravity_terrain(p['observations'],f['terrain_options']);assert t['state']=='ok',t['issues'];assert f==before
    for index,expected in enumerate(f['expected']):
        assert p['proposals'][index]['correction_mGal']==pytest.approx(-expected['plate_mGal'],abs=1e-12)
        assert t['proposals'][index]['correction_mGal']==pytest.approx(expected['terrain_mGal'],abs=1e-12,rel=0)
        assert t['observations']['records'][index]['values']['g']==pytest.approx(expected['truth_mGal'],abs=1e-11,rel=0)
        assert t['proposals'][index]['density_sensitivity_mGal_per_kg_m3']==pytest.approx(expected['terrain_mGal']/2670,abs=1e-15)
    assert t['observations']['records'][-1]['values']['g'] is None
    assert t['observations']['channels']['g']['field_type']=='gravity_disturbance'
    for a,b in zip(f['survey']['records'],t['observations']['records']):
        assert a['values']['other']==b['values']['other']
        for key in ['id','x','y','z']:assert a.get(key)==b.get(key)
    assert t['states']['gravity_bouguer']=={'g':'applied','other':'unapplied'}
    assert t['states']['gravity_terrain']=={'g':'applied','other':'unapplied'}
    assert baselode.geophysics.inspect_corrections(t['observations'])['state']=='ok'
    jsonschema.validate(t['ledger'],baselode.geophysics.describe_corrections()['ledger_schema'])
    assert 'uncertainty' not in t['observations']['metadata'] and t['observations']['metadata']['uncertainty_propagated'] is False
    assert p['observations']['metadata']['input_lineage'][-1]['metadata']['uncertainty']==f['survey']['metadata']['uncertainty']


def test_flat_dem_exact_zero_and_hill_valley_positive_density_linear():
    f=fixture();p=baselode.geophysics.apply_bouguer_plate(f['survey'],f['plate_options']);options=f['terrain_options']
    options['dem']['heights']=[[100]*3 for _ in range(3)]
    t=baselode.geophysics.correct_gravity_terrain(p['observations'],options);assert t['state']=='ok',t['issues'];assert all(row['correction_mGal']==0 for row in t['proposals'])
    for i,j,h in [(0,1,120),(1,0,80)]:
        f=fixture();f['terrain_options']['dem']['heights']=[[100]*3 for _ in range(3)];f['terrain_options']['dem']['heights'][i][j]=h
        p=baselode.geophysics.apply_bouguer_plate(f['survey'],f['plate_options']);t=baselode.geophysics.correct_gravity_terrain(p['observations'],f['terrain_options']);assert t['state']=='ok',t['issues'];assert all(row['correction_mGal']>0 for row in t['proposals'])
        f['plate_options']['density_kg_m3']/=2;f['terrain_options']['density_kg_m3']/=2
        p2=baselode.geophysics.apply_bouguer_plate(f['survey'],f['plate_options']);t2=baselode.geophysics.correct_gravity_terrain(p2['observations'],f['terrain_options']);assert t2['state']=='ok'
        assert t2['proposals'][0]['correction_mGal']==pytest.approx(t['proposals'][0]['correction_mGal']/2,abs=1e-13)


@pytest.mark.parametrize('params',[{'density_kg_m3':0,'thicknesses_m':[1]},{'density_kg_m3':2670,'thicknesses_m':[-1]},{'density_kg_m3':2670,'thicknesses_m':[True]},{'density_kg_m3':2670,'thicknesses_m':[float('nan')]},{'density_kg_m3':2670,'thicknesses_m':[1]*513}])
def test_plate_calculator_bounds_atomic(params):
    r=baselode.geophysics.calculate_bouguer_plate(params);assert r['state']=='rejected' and r['fields']==[]


def test_plate_calculator_exact_reference_and_derivative():
    r=baselode.geophysics.calculate_bouguer_plate({'density_kg_m3':2670,'thicknesses_m':[0,100]});assert r['state']=='ok';assert r['fields'][0]['effect_mGal']==0
    assert r['fields'][1]['effect_mGal']==pytest.approx(fixture()['expected'][0]['plate_mGal'],abs=1e-12)
    assert r['fields'][1]['density_sensitivity_mGal_per_kg_m3']*2670==pytest.approx(r['fields'][1]['effect_mGal'],abs=1e-12)


@pytest.mark.parametrize('change',['density','reference','datum','dem_datum','crs','units','frame','hole','shape','size','extent','edge','ground','outside','cap','history','missing_plate','repeat','missing_z','field','unknown','extra'])
def test_terrain_context_support_history_and_caps_fail_atomically(change):
    f=fixture();p=baselode.geophysics.apply_bouguer_plate(f['survey'],f['plate_options']);data=p['observations'];o=f['terrain_options']
    if change=='density':o['density_kg_m3']=2600
    if change=='reference':o['reference_height_m']=10
    if change=='datum':o['height_datum']='other'
    if change=='dem_datum':o['dem']['height_datum']='other'
    if change=='crs':o['dem']['crs']='EPSG:32751'
    if change=='units':o['dem']['crs_units']='ft'
    if change=='frame':o['dem']['frame_id']='local'
    if change=='hole':o['dem']['heights'][0][0]=None
    if change=='shape':o['dem']['heights'][0].pop()
    if change=='size':o['dem']['heights']=[[100]*33 for _ in range(33)]
    if change=='extent':o['dem']['bounds'][2]+=100001
    if change=='edge':o['min_edge_distance_m']=6
    if change=='ground':o['dem']['heights'][1][1]=101
    if change=='outside':o['outside_dem_policy']='ignore'
    if change=='cap':o['max_abs_correction_mGal']=0
    if change=='history':data['metadata']['corrections']['gravity_bouguer']='unapplied'
    if change=='missing_plate':data=f['survey'];data['metadata']['corrections']['gravity_bouguer']='applied'
    if change=='repeat':data=reduced()[1]['observations']
    if change=='missing_z':data=f['survey'];data['records'][0].pop('z')
    if change=='field':data=f['survey'];data['channels']['g']['field_type']='gravity_anomaly'
    if change=='unknown':data=f['survey'];data['metadata']['corrections'].pop('gravity_tide')
    if change=='extra':o['automatic_density']=True
    before=copy.deepcopy(data);r=baselode.geophysics.correct_gravity_terrain(data,o);assert r['state']!='ok' and r['observations'] is None and r['ledger'] is None;assert data==before


@pytest.mark.parametrize('change',['datum','height','tide','parameters','dem','model','binding','count','drop','value'])
def test_topography_ledger_rejects_mutated_context_model_or_missing_history(change):
    _,t=reduced();data=t['observations'];e=data['metadata']['correction_ledger']['entries'][-1]
    if change=='datum':data['metadata']['gravity_datum']='other'
    if change=='height':data['metadata']['height_datum']='other'
    if change=='tide':data['metadata']['tide_system']='mean_tide'
    if change=='parameters':e['parameters']['density_kg_m3']=2600
    if change=='dem':e['parameters']['dem']['heights'][0][0]=120
    if change=='model':e['model']['G_SI']*=2
    if change=='binding':e['topography_binding']='0'*64
    if change=='count':e['affected_records']+=1
    if change=='drop':data['metadata'].pop('correction_ledger')
    if change=='value':data['records'][0]['values']['g']+=1
    assert baselode.geophysics.inspect_corrections(data)['state']=='rejected'


def workflow():
    f=fixture();return {'schema':'baselode.geophysics.observation_workflow','version':1,'steps':[{'id':'plate','operation':'apply_bouguer_plate','version':1,'inputs':[{'input':'survey'}],'parameters':f['plate_options']},{'id':'terrain','operation':'correct_gravity_terrain','version':1,'inputs':[{'step':'plate','output':'observations'}],'parameters':f['terrain_options']}],'outputs':{'out':{'step':'terrain','output':'observations'}}}


def test_workflow_and_historical_reprojection():
    f=fixture();r=baselode.geophysics.run_observation_workflow(workflow(),{'survey':f['survey']});assert r['state']=='ok',r['issues'];out=r['artifacts']['out']
    p=baselode.geophysics.reproject_observations(out,{'target_crs':'EPSG:4326','datum_policy':'backend','event_id':'project','evidence':'checked'});assert p['state']=='ok',p['issues'];assert baselode.geophysics.inspect_corrections(p['observations'])['state']=='ok'


def test_local_frame_and_native_plate_repetition_bounds():
    f=fixture();f['survey']['crs']=None;f['survey']['metadata']['frame_id']='local';f['terrain_options']['dem'].update(crs=None,frame_id='local')
    p=baselode.geophysics.apply_bouguer_plate(f['survey'],f['plate_options']);t=baselode.geophysics.correct_gravity_terrain(p['observations'],f['terrain_options']);assert t['state']=='ok',t['issues']
    assert baselode.geophysics.apply_bouguer_plate(p['observations'],{**f['plate_options'],'event_id':'twice'})['state']=='rejected'
    f=fixture();f['survey']['records']=[{**f['survey']['records'][0],'id':'p'+str(i)} for i in range(513)]
    assert baselode.geophysics.apply_bouguer_plate(f['survey'],f['plate_options'])['state']=='rejected'


def test_optional_backend_and_output_budget(monkeypatch):
    f=fixture();p=baselode.geophysics.apply_bouguer_plate(f['survey'],f['plate_options'])
    monkeypatch.setattr(baselode.geophysics.gravity_topography,'_harmonica',None)
    with pytest.raises(ImportError,match='potential-fields'):baselode.geophysics.correct_gravity_terrain(p['observations'],f['terrain_options'])
    monkeypatch.setitem(baselode.geophysics.corrections._LIMITS,'max_output_json_bytes',1)
    r=baselode.geophysics.apply_bouguer_plate(f['survey'],f['plate_options']);assert r['state']=='rejected' and r['observations'] is None


def test_live_cross_runtime_topography_replay_and_backend_gate(tmp_path):
    p,t=reduced();f=fixture();source=tmp_path/'in.json';target=tmp_path/'out.json';source.write_text(json.dumps({**f,'plate_observations':p['observations'],'terrain_observations':t['observations'],'workflow':workflow()}))
    subprocess.run(['node',str(ROOT/'test/data/gravity_topography_parity.mjs'),str(source),str(target)],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True)
    js=json.loads(target.read_text());assert js['inspect']['state']=='ok',js['inspect']['issues'];assert js['project']['state']=='ok',js['project']['issues'];assert js['gate']['state']=='needs_input' and js['gate']['completed_steps']==[]
    assert baselode.geophysics.inspect_corrections(js['project']['observations'])['state']=='ok'


@pytest.mark.parametrize('extension',['ers','tif'])
def test_topography_history_survives_gridding_and_export(tmp_path,extension):
    _,t=reduced();grid=baselode.geophysics.grid_observations(t['observations'],{'channels':['g'],'radius':50,'method':'nearest','duplicate_policy':'mean','elevation_policy':'ignore','bounds':[499995,6499995,500015,6500005],'shape':[1,2],'extrapolation':'allow'});assert grid['state']=='ok',grid['issues']
    path=tmp_path/('gravity.'+extension);baselode.geophysics.save_raster(grid['artifacts']['grid'],path,dtype='float64');back=baselode.geophysics.load_raster(path)
    assert back.metadata['observation_metadata']['correction_ledger']==t['ledger']


def test_complete_native_temporal_normal_projection_plate_terrain_sequence():
    f=json.loads((ROOT/'test/data/gravity_temporal_reference.json').read_text())
    tide=baselode.geophysics.apply_gravity_tide(f['survey'],f['tide_options']);drift=baselode.geophysics.correct_gravity_drift(tide['observations'],f['drift_options'])
    normal=baselode.geophysics.remove_normal_gravity(drift['observations'],{'channel':'g','model':'WGS84','reference_policy':'caller_verified','event_id':'normal','evidence':'checked'});assert normal['state']=='ok',normal['issues']
    project=baselode.geophysics.reproject_observations(normal['observations'],{'target_crs':'EPSG:32750','datum_policy':'backend','event_id':'project','evidence':'checked'});assert project['state']=='ok',project['issues']
    o=fixture();rows=[r for r in project['observations']['records'] if r['values']['g'] is not None]
    o['terrain_options']['dem'].update(bounds=[min(r['x'] for r in rows)-100,min(r['y'] for r in rows)-100,max(r['x'] for r in rows)+100,max(r['y'] for r in rows)+100],heights=[[100]*3 for _ in range(3)])
    plate=baselode.geophysics.apply_bouguer_plate(project['observations'],o['plate_options']);assert plate['state']=='ok',plate['issues']
    terrain=baselode.geophysics.correct_gravity_terrain(plate['observations'],o['terrain_options']);assert terrain['state']=='ok',terrain['issues']
    assert baselode.geophysics.inspect_corrections(terrain['observations'])['state']=='ok'
    assert terrain['observations']['metadata']['gravity_channel_datums']=={'g':'synthetic absolute datum'}
    for key in ['plate_parameters','terrain_parameters','dem_schema','plate_request_schema']:jsonschema.Draft202012Validator.check_schema(baselode.geophysics.describe_gravity_topography()[key])
    back=baselode.geophysics.reproject_observations(terrain['observations'],{'target_crs':'EPSG:4326','datum_policy':'backend','event_id':'back','evidence':'checked'});assert back['state']=='ok',back['issues']
