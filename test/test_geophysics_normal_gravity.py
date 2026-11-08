# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent normal-potential references, guarded reductions and replay."""
import copy
import json
import math
import pathlib
import subprocess

import jsonschema
import numpy as np
import pytest

import baselode.geophysics
import baselode.geophysics.normal_gravity

ROOT = pathlib.Path(__file__).resolve().parents[1]
REFERENCE = json.loads((ROOT/'test/data/normal_gravity_reference.json').read_text())
PARAMS = {'channel':'g','model':'WGS84','reference_policy':'caller_verified','event_id':'normal','evidence':'synthetic calibrated absolute gravity; reference and tide compatibility checked'}


def survey():
    case = next(c for c in REFERENCE['cases'] if c['model']=='WGS84' and c['point']['latitude']==-32)
    point = case['point']
    return {'crs':'EPSG:4326','crs_units':'degrees','channels':{'g':{'field_type':'gravity_observed','units':'mGal'},'other':{'field_type':'gravity_observed','units':'mGal'}},
            'records':[{'id':'station😀','x':point['longitude'],'y':point['latitude'],'z':point['height_m'],'time':100,'line_id':'A','station_id':'s','values':{'g':case['normal_gravity']+25,'other':case['normal_gravity']-10},'extra':{'keep':True}},{'id':'missing','values':{'g':None,'other':None}}],
            'metadata':{'height_units':'m','height_datum':'WGS84_ellipsoid','z_positive':'up','gravity_datum':'synthetic absolute reference','tide_system':'tide_free','corrections':{k:'unapplied' for k in ['gravity_normal','gravity_free_air','gravity_bouguer','gravity_terrain']},'uncertainty':{'g':.01},'variance':{'g':.0001},'standard_deviation':{'g':.01}}}


def removed(data=None,options=None):
    r=baselode.geophysics.remove_normal_gravity(survey() if data is None else data,PARAMS if options is None else options)
    assert r['state']=='ok',r['issues'];return r


@pytest.mark.parametrize('model',['WGS84','GRS80'])
def test_independent_80_digit_normal_potential_gradient_and_height_sensitivity(model):
    cases=[c for c in REFERENCE['cases'] if c['model']==model and c['point']['height_m']>=0];request={'model':model,'points':[c['point'] for c in cases]};before=copy.deepcopy(request)
    r=baselode.geophysics.calculate_normal_gravity(request);assert r['state']=='ok',r['issues'];assert request==before
    for actual,expected in zip(r['fields'],cases):
        assert actual['normal_gravity']==pytest.approx(expected['normal_gravity'],abs=REFERENCE['tolerance_mGal'],rel=0)
        assert actual['height_sensitivity_mGal_per_m']==pytest.approx(expected['height_sensitivity_mGal_per_m'],abs=REFERENCE['sensitivity_tolerance_mGal_per_m'],rel=0)
        assert actual['normal_gravity']==pytest.approx(math.hypot(actual['ellipsoidal_u_component_mGal'],actual['ellipsoidal_beta_component_mGal']),abs=1e-9)
        assert actual['height_sensitivity_mGal_per_m']<0
    # Off-surface tangential contribution is real and tested independently.
    off=next(row for row in r['fields'] if row['id']==model+'_60_10000')
    assert off['normal_gravity']-off['ellipsoidal_u_component_mGal']>6e-5
    jsonschema.validate(request,baselode.geophysics.describe_normal_gravity()['request_schema'])
    jsonschema.validate(r,baselode.geophysics.describe_normal_gravity()['result_schema'])


def test_published_noaa_nga_surface_values_and_geographic_symmetry():
    for model,equator,pole in [('WGS84',9.7803253359,9.8321849378),('GRS80',9.7803267715,9.8321863685)]:
        r=baselode.geophysics.calculate_normal_gravity({'model':model,'points':[{'id':str(lat),'longitude':0,'latitude':lat,'height_m':0} for lat in [0,90,-90,32,-32]]})
        assert r['state']=='ok';assert r['fields'][0]['normal_gravity']==pytest.approx(equator*1e5,abs=1e-5,rel=0)
        assert r['fields'][1]['normal_gravity']==pytest.approx(pole*1e5,abs=1e-5,rel=0)
        assert r['fields'][1]['normal_gravity']==r['fields'][2]['normal_gravity']
        assert r['fields'][3]['normal_gravity']==r['fields'][4]['normal_gravity']


def test_known_injected_disturbance_preserves_other_channels_nulls_inputs_and_lineage():
    data=survey();before=copy.deepcopy(data);r=removed(data);out=r['observations']
    assert data==before;assert out['records'][0]['values']['g']==pytest.approx(25,abs=1e-5)
    assert out['records'][0]['values']['other']==data['records'][0]['values']['other'];assert out['records'][1]['values']['g'] is None
    assert out['channels']['g']['field_type']=='gravity_disturbance' and out['channels']['other']['field_type']=='gravity_observed'
    assert r['states']['gravity_normal']=={'g':'applied','other':'unapplied'}
    assert r['states']['gravity_tide']=={'g':'unknown','other':'unknown'}
    for key in ['uncertainty','variance','standard_deviation']:assert key not in out['metadata'];assert out['metadata']['input_lineage'][-1]['metadata'][key]==data['metadata'][key]
    assert out['metadata']['uncertainty_propagated'] is False
    assert baselode.geophysics.inspect_corrections(out)['state']=='ok'
    jsonschema.validate(r['ledger'],baselode.geophysics.describe_corrections()['ledger_schema'])
    second=removed(out,{**PARAMS,'channel':'other','event_id':'normal-other'})
    assert second['observations']['records'][0]['values']['other']==pytest.approx(-10,abs=1e-5)
    assert second['states']['gravity_normal']=={'g':'applied','other':'applied'}


@pytest.mark.parametrize('change',['model','longitude','latitude','height','missing','id','extra','empty','resource','nonfinite'])
def test_invalid_point_requests_are_atomic(change):
    q={'model':'WGS84','points':[{'id':'p','longitude':117,'latitude':-32,'height_m':100}]}
    if change=='model':q['model']='custom'
    if change=='longitude':q['points'][0]['longitude']=181
    if change=='latitude':q['points'][0]['latitude']=91
    if change=='height':q['points'][0]['height_m']=-1
    if change=='missing':del q['points'][0]['height_m']
    if change=='id':q['points']*=2
    if change=='extra':q['points'][0]['time']=0
    if change=='empty':q['points']=[]
    if change=='resource':q['points']*=513
    if change=='nonfinite':q['points'][0]['height_m']=float('nan')
    r=baselode.geophysics.calculate_normal_gravity(q);assert r['state']!='ok' and r['fields']==[]


@pytest.mark.parametrize('change',['normal','free_air','bouguer','terrain','unknown','height_datum','height_units','z_positive','gravity_datum','tide_system','crs','units','field','missing_z','missing_xy','no_readings','params'])
def test_ambiguous_or_prior_reduced_observations_reject_atomically(change):
    data=survey();params=copy.deepcopy(PARAMS)
    if change in ['normal','free_air','bouguer','terrain']:data['metadata']['corrections']['gravity_'+change]='applied'
    elif change=='unknown':data['metadata']['corrections']={}
    elif change in ['height_datum','height_units','z_positive','gravity_datum','tide_system']:data['metadata'].pop(change)
    elif change=='crs':data['crs']='EPSG:28350'
    elif change=='units':data['channels']['g']['units']='m/s^2'
    elif change=='field':data['channels']['g']['field_type']='gravity_anomaly'
    elif change=='missing_z':data['records'][0]['z']=None
    elif change=='missing_xy':data['records'][0]['x']=None
    elif change=='no_readings':data['records'][0]['values']['g']=None
    elif change=='params':params['reference_policy']='automatic'
    before=copy.deepcopy(data);r=baselode.geophysics.remove_normal_gravity(data,params)
    assert r['state']!='ok' and r['observations'] is None and r['ledger'] is None;assert data==before


@pytest.mark.parametrize('change',['value','model','context','parameters','drop','binding'])
def test_repeat_stale_model_context_and_missing_history_guards(change):
    data=removed()['observations'];entry=data['metadata']['correction_ledger']['entries'][-1]
    if change=='value':data['records'][0]['values']['g']+=1
    if change=='model':entry['model']['flattening']+=.001
    if change=='context':data['metadata']['gravity_datum']='edited'
    if change=='parameters':entry['parameters']['reference_policy']='automatic'
    if change=='drop':data['metadata'].pop('correction_ledger')
    if change=='binding':entry['normal_binding']='0'*64
    assert baselode.geophysics.inspect_corrections(data)['state']=='rejected'
    assert baselode.geophysics.remove_normal_gravity(data,{**PARAMS,'event_id':'repeat'})['observations'] is None


def test_grs80_crs_and_explicit_matching_height_context():
    data=survey();data['crs']='EPSG:7844';data['metadata']['height_datum']='GRS80_ellipsoid'
    r=removed(data,{**PARAMS,'model':'GRS80'});assert r['ledger']['entries'][-1]['model']['model']=='GRS80'
    assert baselode.geophysics.remove_normal_gravity(data,PARAMS)['state']=='needs_input'


def test_historical_normal_context_survives_reprojection_and_workflow_grid():
    data=survey();w={'schema':'baselode.geophysics.observation_workflow','version':1,'steps':[{'id':'normal','operation':'remove_normal_gravity','version':1,'inputs':[{'input':'survey'}],'parameters':PARAMS},{'id':'project','operation':'reproject_observations','version':1,'inputs':[{'step':'normal','output':'observations'}],'parameters':{'target_crs':'EPSG:32750','datum_policy':'backend','event_id':'project','evidence':'checked WGS84'}},{'id':'grid','operation':'grid_observations','version':1,'inputs':[{'step':'project','output':'observations'}],'parameters':{'channels':['g'],'radius':100,'method':'nearest','duplicate_policy':'mean','elevation_policy':'ignore','bounds':[499990,6459550,500010,6459570],'shape':[2,2],'extrapolation':'allow'}},{'id':'edge','operation':'raster_total_horizontal_derivative','version':1,'inputs':[{'step':'grid','output':'grid'}],'parameters':{}}],'outputs':{'observations':{'step':'project','output':'observations'},'grid':{'step':'grid','output':'grid'},'edge':{'step':'edge','output':'raster'}}}
    r=baselode.geophysics.run_observation_workflow(w,{'survey':data});assert r['state']=='ok',r['issues']
    assert r['artifacts']['grid'].metadata['field_type']=='gravity_disturbance'
    assert baselode.geophysics.inspect_corrections(r['artifacts']['observations'])['state']=='ok'
    np.testing.assert_allclose(r['artifacts']['edge'].data,0,atol=1e-12)


def test_missing_and_changed_backend_fail_explicitly(monkeypatch):
    with monkeypatch.context() as m:
        m.setattr(baselode.geophysics.normal_gravity,'_boule',None)
        with pytest.raises(ImportError,match='baselode\\[gravity\\]'):baselode.geophysics.calculate_normal_gravity({'model':'WGS84','points':[]})
        w={'schema':'baselode.geophysics.observation_workflow','version':1,'steps':[{'id':'n','operation':'remove_normal_gravity','version':1,'inputs':[{'input':'survey'}],'parameters':PARAMS}],'outputs':{'out':{'step':'n','output':'observations'}}}
        r=baselode.geophysics.run_observation_workflow(w,{'survey':survey()});assert r['state']=='needs_input' and r['completed_steps']==[]
    with monkeypatch.context() as m:
        m.setattr(baselode.geophysics.normal_gravity.importlib.metadata,'version',lambda name:'unsupported')
        r=baselode.geophysics.calculate_normal_gravity({'model':'WGS84','points':[REFERENCE['cases'][0]['point']]});assert r['state']=='failed' and r['fields']==[]


def test_descriptor_parity_and_result_schema():
    d=baselode.geophysics.describe_normal_gravity();assert d==json.loads((ROOT/'javascript/packages/baselode/src/data/geophysics_normal_gravity.json').read_text())
    for k in ['request_schema','result_schema','removal_parameters']:jsonschema.Draft202012Validator.check_schema(d[k])
    d['models']['WGS84']['semimajor_axis']=0;assert baselode.geophysics.describe_normal_gravity()['models']['WGS84']['semimajor_axis']==6378137


def test_live_js_replay_context_binding_and_native_reprojection(tmp_path):
    out=removed()['observations'];source=tmp_path/'source.json';target=tmp_path/'target.json';source.write_text(json.dumps({'observations':out,'params':PARAMS}))
    subprocess.run(['node',str(ROOT/'test/data/normal_gravity_parity.mjs'),str(source),str(target)],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True)
    js=json.loads(target.read_text());assert js['inspect']['state']=='ok',js['inspect']['issues'];assert js['project']['state']=='ok',js['project']['issues'];assert js['tampered']['state']=='rejected';assert js['workflow']['state']=='needs_input' and js['workflow']['completed_steps']==[]
    assert baselode.geophysics.inspect_corrections(js['project']['observations'])['state']=='ok'


@pytest.mark.parametrize('extension',['ers','tif'])
def test_gravity_ledger_persists_through_grid_exports(tmp_path,extension):
    out=removed()['observations'];project=baselode.geophysics.reproject_observations(out,{'target_crs':'EPSG:32750','datum_policy':'backend','event_id':'project','evidence':'checked'})['observations']
    grid=baselode.geophysics.grid_observations(project,{'channels':['g'],'radius':100,'method':'nearest','duplicate_policy':'mean','elevation_policy':'ignore','bounds':[499990,6459550,500010,6459570],'shape':[2,2],'extrapolation':'allow'});assert grid['state']=='ok',grid['issues']
    path=tmp_path/('gravity.'+extension);baselode.geophysics.save_raster(grid['artifacts']['grid'],path,dtype='float64');back=baselode.geophysics.load_raster(path)
    assert back.metadata['field_type']=='gravity_disturbance' and back.metadata['observation_metadata']['correction_ledger']==project['metadata']['correction_ledger']


def test_relative_or_zero_readings_are_not_mislabeled_absolute_magnitude():
    for value in [0,-10]:
        data=survey();data['records'][0]['values']['g']=value
        r=baselode.geophysics.remove_normal_gravity(data,PARAMS);assert r['state']=='rejected' and r['observations'] is None


@pytest.mark.parametrize('model',['WGS84','GRS80'])
def test_below_ellipsoid_requires_explicit_flagged_analytic_continuation(model):
    cases=[c for c in REFERENCE['cases'] if c['model']==model and c['point']['height_m']<0]
    request={'model':model,'points':[c['point'] for c in cases]}
    default=baselode.geophysics.calculate_normal_gravity(request)
    assert default['state']=='needs_input' and default['fields']==[]
    request['height_policy']='analytic_continuation'
    r=baselode.geophysics.calculate_normal_gravity(request);assert r['state']=='ok',r['issues']
    for actual,expected in zip(r['fields'],cases):
        assert actual['height_extrapolated'] is True
        assert actual['normal_gravity']==pytest.approx(expected['normal_gravity'],abs=1e-5,rel=0)
    data=survey();data['records'][0]['z']=-50
    if model=='GRS80':data['crs']='EPSG:7844';data['metadata']['height_datum']='GRS80_ellipsoid'
    assert baselode.geophysics.remove_normal_gravity(data,{**PARAMS,'model':model})['state']=='needs_input'
    out=removed(data,{**PARAMS,'model':model,'height_policy':'analytic_continuation'})
    assert out['proposals'][0]['height_extrapolated'] is True and out['diagnostics']['continued_height_records']==1
    assert out['ledger']['entries'][-1]['parameters']['height_policy']=='analytic_continuation'
    assert baselode.geophysics.inspect_corrections(out['observations'])['state']=='ok'
    out['observations']['metadata']['correction_ledger']['entries'][-1]['parameters']['height_policy']='external_only'
    assert baselode.geophysics.inspect_corrections(out['observations'])['state']=='rejected'
    request['points'][0]['height_m']=-1001
    assert baselode.geophysics.calculate_normal_gravity(request)['state']=='rejected'
