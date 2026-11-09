# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent calibrated gravity loops, tide effects and held-out repeats."""
import copy
import json
import pathlib
import subprocess

import jsonschema
import pytest

import baselode.geophysics
import baselode.geophysics.corrections

ROOT=pathlib.Path(__file__).resolve().parents[1]


def fixture():
    return json.loads((ROOT/'test/data/gravity_temporal_reference.json').read_text())


def corrected():
    f=fixture();t=baselode.geophysics.apply_gravity_tide(f['survey'],f['tide_options']);assert t['state']=='ok',t['issues']
    d=baselode.geophysics.correct_gravity_drift(t['observations'],f['drift_options']);assert d['state']=='ok',d['issues'];return t,d


def test_independent_tide_drift_absolute_tie_and_noncontrol_repeat_recovery():
    f=fixture();before=copy.deepcopy(f);t=baselode.geophysics.apply_gravity_tide(f['survey'],f['tide_options']);assert t['state']=='ok',t['issues']
    assert [r['values']['g'] for r in t['observations']['records']]==f['expected_tide_values']
    d=baselode.geophysics.correct_gravity_drift(t['observations'],f['drift_options']);assert d['state']=='ok',d['issues'];out=d['observations']
    assert [r['values']['g'] for r in out['records']]==f['expected_values'];assert f==before
    assert out['channels']['g']['field_type']=='gravity_observed' and out['channels']['other']['field_type']=='gravity_relative'
    assert out['metadata']['gravity_datum']=='relative instrument zero' and out['metadata']['gravity_channel_datums']=={'g':'synthetic absolute datum'}
    for source,row in zip(f['survey']['records'],out['records']):
        assert row['values']['other']==source['values']['other']
        for key in ['id','x','y','z','time','station_id','extra']:
            if key in source:assert row[key]==source[key]
    before_s=next(r for r in d['diagnostics']['repeats_before'] if r['station_id']=='S');after_s=next(r for r in d['diagnostics']['repeats_after'] if r['station_id']=='S')
    assert before_s['statistics']['range']==.5 and after_s['statistics']['range']==0 and after_s['geometry_comparable']
    assert d['diagnostics']['loops'][0]['closed_station_loop'] and d['diagnostics']['loops'][0]['drift_change_mGal']==1
    assert d['ledger']['entries'][-1]['model']['ties'][0]['record_id']=='b0'
    assert baselode.geophysics.inspect_corrections(out)['state']=='ok'
    assert d['states']['gravity_tide']=={'g':'applied','other':'unapplied'} and d['states']['gravity_drift']=={'g':'applied','other':'unapplied'}
    jsonschema.validate(d['ledger'],baselode.geophysics.describe_corrections()['ledger_schema'])
    for key in ['uncertainty','variance','standard_deviation']:assert key not in out['metadata']


def test_unsorted_targets_preserve_order_and_multiple_absolute_reference_stations():
    f=fixture();f['survey']['records'][:4]=[f['survey']['records'][i] for i in [2,0,3,1]]
    t=baselode.geophysics.apply_gravity_tide(f['survey'],f['tide_options']);d=baselode.geophysics.correct_gravity_drift(t['observations'],f['drift_options']);assert d['state']=='ok',d['issues']
    assert [r['id'] for r in d['observations']['records']]==['s2','b0','b1','s1','missing']
    f=fixture();f['drift_options']['controls']=[{'record_id':'b0','reference_mGal':980000},{'record_id':'s1','reference_mGal':980010},{'record_id':'b1','reference_mGal':980000}]
    t=baselode.geophysics.apply_gravity_tide(f['survey'],f['tide_options']);d=baselode.geophysics.correct_gravity_drift(t['observations'],f['drift_options']);assert d['state']=='ok',d['issues']
    assert [r['values']['g'] for r in d['observations']['records']]==f['expected_values'];assert not d['diagnostics']['loops'][0]['closed_station_loop']


@pytest.mark.parametrize('change',['gap','outside','cap','rate','duplicate_time','missing_control','null_control','unknown_tide','applied','instrument','calibration','height','datum','time','options'])
def test_drift_support_quality_history_and_context_fail_atomically(change):
    f=fixture();t=baselode.geophysics.apply_gravity_tide(f['survey'],f['tide_options']);data=t['observations'];options=f['drift_options']
    if change=='gap':options['max_gap_seconds']=50
    if change=='outside':
        # Use a fresh explicitly tide-corrected source for a changed time.
        data=f['survey'];data['metadata']['corrections']['gravity_tide']='applied';data['records'][1]['time']=-1
    if change=='cap':options['max_abs_correction_mGal']=10
    if change=='rate':options['max_drift_rate_mGal_per_s']=.001
    if change=='duplicate_time':options['controls']=[{'record_id':'s1','reference_mGal':980010},{'record_id':'s1','reference_mGal':980010}]
    if change=='missing_control':options['controls'][0]['record_id']='absent'
    if change=='null_control':options['controls'][0]['record_id']='missing'
    if change=='unknown_tide':data=f['survey'];data['metadata']['corrections'].pop('gravity_tide')
    if change=='applied':data=f['survey'];data['metadata']['corrections'].update(gravity_tide='applied',gravity_drift='applied')
    if change=='instrument':data['metadata'].pop('instrument_id')
    if change=='calibration':data['metadata'].pop('gravity_scale_calibration_id')
    if change=='height':data['metadata']['height_units']='ft'
    if change=='datum':data['metadata']['gravity_datum']='unknown'
    if change=='time':data['records'][1]['time']=None
    if change=='options':options['clock_policy']='automatic'
    before=copy.deepcopy(data);r=baselode.geophysics.correct_gravity_drift(data,options)
    assert r['state']!='ok' and r['observations'] is None and r['ledger'] is None;assert data==before
    if change=='gap':assert any(p['reason']=='excessive_control_gap' for p in r['proposals'])


@pytest.mark.parametrize('change',['missing','extra','duplicate','cap','sign','history','absolute','time','nonfinite','unit'])
def test_tide_table_is_exact_and_history_safe(change):
    f=fixture();data=f['survey'];options=f['tide_options']
    if change=='missing':options['effects'].pop()
    if change=='extra':options['effects'].append({'record_id':'missing','effect_mGal':0})
    if change=='duplicate':options['effects'].append(copy.deepcopy(options['effects'][0]))
    if change=='cap':options['max_abs_effect_mGal']=.01
    if change=='sign':options['effect_convention']='reference_minus_observed'
    if change=='history':data['metadata']['corrections']['gravity_tide']='applied'
    if change=='absolute':data['channels']['g']['field_type']='gravity_observed'
    if change=='time':data['records'][0]['time']=None
    if change=='nonfinite':options['effects'][0]['effect_mGal']=float('nan')
    if change=='unit':data['channels']['g']['units']='dial'
    r=baselode.geophysics.apply_gravity_tide(data,options);assert r['state']!='ok' and r['observations'] is None


@pytest.mark.parametrize('change',['datum','instrument','scale','tide','height','model','effect','parameters','count','drop','value'])
def test_bound_temporal_models_and_contexts_reject_edits(change):
    _,d=corrected();data=d['observations'];entries=data['metadata']['correction_ledger']['entries'];drift=entries[-1];tide=next(e for e in entries if e.get('kind')=='application' and e.get('correction')=='gravity_tide')
    if change=='datum':data['metadata']['gravity_channel_datums']['g']='changed'
    if change=='instrument':data['metadata']['instrument_id']='changed'
    if change=='scale':data['metadata']['gravity_scale_calibration_id']='changed'
    if change=='tide':data['metadata']['tide_system']='zero_tide'
    if change=='height':data['metadata']['height_datum']='changed'
    if change=='model':drift['model']['ties'][0]['original_mGal']+=1
    if change=='effect':tide['parameters']['effects'][0]['effect_mGal']+=.01
    if change=='parameters':drift['parameters']['max_gap_seconds']+=1
    if change=='count':drift['affected_records']+=1
    if change=='drop':data['metadata'].pop('correction_ledger')
    if change=='value':data['records'][1]['values']['g']+=1
    r=baselode.geophysics.inspect_corrections(data);assert r['state']=='rejected',r


def test_repeat_geometry_flags_and_absent_repeat_coverage():
    _,d=corrected();data=d['observations'];r=baselode.geophysics.analyze_gravity_repeats(data,{'channel':'g'});assert r['state']=='ok';assert all(x['geometry_comparable'] for x in r['diagnostics']['repeats'])
    data=fixture()['survey'];data['records'][2]['z']+=1
    r=baselode.geophysics.analyze_gravity_repeats(data,{'channel':'g'});s=next(x for x in r['diagnostics']['repeats'] if x['station_id']=='S');assert s['same_height'] is False and not s['geometry_comparable']
    for i,row in enumerate(data['records']):row['station_id']='station'+str(i)
    assert baselode.geophysics.analyze_gravity_repeats(data,{'channel':'g'})['state']=='needs_input'


def test_normal_history_on_other_channel_survives_per_channel_absolute_tying():
    f=fixture();data=f['survey'];data['channels']['other']['field_type']='gravity_observed';data['metadata']['gravity_channel_datums']={'other':'old absolute datum'}
    for row in data['records']:row['values']['other']=980100 if row['values']['g'] is not None else None
    n=baselode.geophysics.remove_normal_gravity(data,{'channel':'other','model':'WGS84','reference_policy':'caller_verified','event_id':'normal-other','evidence':'checked'});assert n['state']=='ok',n['issues']
    t=baselode.geophysics.apply_gravity_tide(n['observations'],f['tide_options']);assert t['state']=='ok',t['issues'];d=baselode.geophysics.correct_gravity_drift(t['observations'],f['drift_options']);assert d['state']=='ok',d['issues']
    assert d['observations']['metadata']['gravity_channel_datums']=={'other':'old absolute datum','g':'synthetic absolute datum'}
    assert baselode.geophysics.inspect_corrections(d['observations'])['state']=='ok'
    assert d['observations']['records'][0]['values']['other']==n['observations']['records'][0]['values']['other']


def workflow():
    f=fixture();steps=[{'id':'tide','operation':'apply_gravity_tide','version':1,'inputs':[{'input':'survey'}],'parameters':f['tide_options']},{'id':'drift','operation':'correct_gravity_drift','version':1,'inputs':[{'step':'tide','output':'observations'}],'parameters':f['drift_options']},{'id':'repeat','operation':'analyze_gravity_repeats','version':1,'inputs':[{'step':'drift','output':'observations'}],'parameters':{'channel':'g'}}]
    return {'schema':'baselode.geophysics.observation_workflow','version':1,'steps':steps,'outputs':{'observations':{'step':'drift','output':'observations'},'repeat':{'step':'repeat','output':'report'}}}


def test_saved_temporal_workflow_and_normal_projection_gridding():
    f=fixture();w=workflow();w['steps'] += [{'id':'normal','operation':'remove_normal_gravity','version':1,'inputs':[{'step':'drift','output':'observations'}],'parameters':{'channel':'g','model':'WGS84','reference_policy':'caller_verified','event_id':'normal','evidence':'checked'}},{'id':'project','operation':'reproject_observations','version':1,'inputs':[{'step':'normal','output':'observations'}],'parameters':{'target_crs':'EPSG:32750','datum_policy':'backend','event_id':'project','evidence':'checked'}}];w['outputs']['project']={'step':'project','output':'observations'}
    r=baselode.geophysics.run_observation_workflow(w,{'survey':f['survey']});assert r['state']=='ok',r['issues'];assert baselode.geophysics.inspect_corrections(r['artifacts']['project'])['state']=='ok'
    grid=baselode.geophysics.grid_observations(r['artifacts']['project'],{'channels':['g'],'radius':200,'method':'nearest','duplicate_policy':'mean','elevation_policy':'ignore','bounds':[499990,6459550,500110,6459570],'shape':[2,2],'extrapolation':'allow'});assert grid['state']=='ok',grid['issues']
    assert grid['artifacts']['grid'].metadata['field_type']=='gravity_disturbance'
    assert r['artifacts']['repeat']['diagnostics']['repeats'][0]['statistics']['range']==0


def test_shared_contracts_resource_and_output_limits(monkeypatch):
    d=baselode.geophysics.describe_gravity_temporal();assert d==json.loads((ROOT/'javascript/packages/baselode/src/data/geophysics_gravity_temporal.json').read_text())
    for key in ['tide_parameters','drift_parameters','repeat_parameters','drift_model']:jsonschema.Draft202012Validator.check_schema(d[key])
    f=fixture();large=copy.deepcopy(f['survey']);large['records']*=820
    assert baselode.geophysics.apply_gravity_tide(large,f['tide_options'])['state']=='rejected'
    monkeypatch.setitem(baselode.geophysics.corrections._LIMITS,'max_output_json_bytes',1)
    r=baselode.geophysics.apply_gravity_tide(f['survey'],f['tide_options']);assert r['state']=='rejected' and r['observations'] is None


def test_live_cross_runtime_model_binding_and_channel_datum_replay(tmp_path):
    t,d=corrected();f=fixture();source=tmp_path/'in.json';target=tmp_path/'out.json';source.write_text(json.dumps({**f,'python_tide':t['observations'],'python_drift':d['observations'],'workflow':workflow()}))
    subprocess.run(['node',str(ROOT/'test/data/gravity_temporal_parity.mjs'),str(source),str(target)],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True)
    js=json.loads(target.read_text())
    for key in ['inspect','tide','drift','continued','workflow','project']:assert js[key]['state']=='ok',(key,js[key]['issues'])
    assert js['drift']['ledger']['current_binding']==d['ledger']['current_binding']
    assert js['drift']['ledger']['entries'][-1]['temporal_binding']==d['ledger']['entries'][-1]['temporal_binding']
    assert baselode.geophysics.inspect_corrections(js['project']['observations'])['state']=='ok'
    n=baselode.geophysics.remove_normal_gravity(js['drift']['observations'],{'channel':'g','model':'WGS84','reference_policy':'caller_verified','event_id':'normal','evidence':'checked'});assert n['state']=='ok',n['issues']


@pytest.mark.parametrize('extension',['ers','tif'])
def test_temporal_history_and_datums_persist_in_exports(tmp_path,extension):
    _,d=corrected();project=baselode.geophysics.reproject_observations(d['observations'],{'target_crs':'EPSG:32750','datum_policy':'backend','event_id':'p','evidence':'checked'})['observations']
    grid=baselode.geophysics.grid_observations(project,{'channels':['g'],'radius':200,'method':'nearest','duplicate_policy':'mean','elevation_policy':'ignore','bounds':[499990,6459550,500110,6459570],'shape':[2,2],'extrapolation':'allow'});assert grid['state']=='ok',grid['issues']
    path=tmp_path/('gravity.'+extension);baselode.geophysics.save_raster(grid['artifacts']['grid'],path,dtype='float64');back=baselode.geophysics.load_raster(path)
    assert back.metadata['observation_metadata']['gravity_channel_datums']=={'g':'synthetic absolute datum'} and back.metadata['observation_metadata']['correction_ledger']==project['metadata']['correction_ledger']


def test_irregular_times_recover_station_gravity_and_duplicate_tie_times_reject():
    f=fixture();times=[10.1,31.7,77.3,123.9]
    for i,t in enumerate(times):f['survey']['records'][i]['time']=t;f['survey']['records'][i]['values']['g']=f['expected_values'][i]-980000+.003*t+f['tide_options']['effects'][i]['effect_mGal']
    tide=baselode.geophysics.apply_gravity_tide(f['survey'],f['tide_options']);d=baselode.geophysics.correct_gravity_drift(tide['observations'],f['drift_options']);assert d['state']=='ok',d['issues']
    for row,value in zip(d['observations']['records'][:4],f['expected_values'][:4]):assert row['values']['g']==pytest.approx(value,abs=1e-8,rel=0)
    f=fixture();f['survey']['records'][3]['time']=0;t=baselode.geophysics.apply_gravity_tide(f['survey'],f['tide_options']);r=baselode.geophysics.correct_gravity_drift(t['observations'],f['drift_options']);assert r['state']=='rejected' and r['observations'] is None
