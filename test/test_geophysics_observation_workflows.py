# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Saved registered pipelines recover independent signals and fail atomically."""
import copy
import json
import math
import pathlib
import subprocess

import jsonschema
import numpy as np
import pytest

import baselode.geophysics
import baselode.geophysics.corrections
import baselode.geophysics.igrf
import baselode.geophysics.observation_workflows

ROOT = pathlib.Path(__file__).resolve().parents[1]


def fixture():
    return json.loads((ROOT/'test/data/geophysics_crossovers_reference.json').read_text())


def recipe():
    return baselode.geophysics.magnetic_observation_recipe()


def run(workflow=None, inputs=None):
    return baselode.geophysics.run_observation_workflow(recipe() if workflow is None else workflow, {'survey':fixture()['survey']} if inputs is None else inputs)


def step(name,operation,params,source=None):
    return {'id':name,'operation':operation,'version':1,'inputs':[{'input':'survey'}] if source is None else [source],'parameters':params}


def workflow(steps, outputs):
    return {'schema':'baselode.geophysics.observation_workflow','version':1,'steps':steps,'outputs':outputs}


def test_saved_recipe_restores_independent_biases_grid_and_gradient_without_mutation():
    f = fixture(); w = recipe(); before = copy.deepcopy((w,f))
    r = run(w,{'survey':f['survey']})
    assert r['state'] == 'ok', r['issues']
    assert r['completed_steps'] == ['qc','level','grid','edges']
    assert [row['values']['mag'] for row in r['artifacts']['corrected']['records']] == f['expected_values']
    np.testing.assert_array_equal(r['artifacts']['grid'].data,[[[134,146],[104,116]]])
    np.testing.assert_allclose(r['artifacts']['edges'].data, math.hypot(2.4,6), atol=1e-12)
    np.testing.assert_array_equal(r['artifacts']['support'].data, np.ones((1,2,2)))
    assert baselode.geophysics.inspect_corrections(r['artifacts']['corrected'])['state'] == 'ok'
    assert r['step_reports']['level']['ledger']['entries'][-1]['line_offsets'] == f['expected_offsets']
    assert r['resource_estimate']['retained_cell_values'] == r['resource_usage']['retained_cell_values'] == 24
    assert r['resource_usage']['retained_records'] == 16
    assert (w,f) == before
    replay = run(json.loads(json.dumps(w)), {'survey':f['survey']})
    assert replay['input_bindings'] == r['input_bindings']
    assert replay['artifacts']['corrected'] == r['artifacts']['corrected']
    assert r['artifacts']['grid'].metadata['observation_metadata']['correction_ledger'] == r['artifacts']['corrected']['metadata']['correction_ledger']


@pytest.mark.parametrize('change',['schema','version','unknown','step_version','id','duplicate','collision','forward','cycle','port','type','output','extra','params','missing','empty','reference_shape'])
def test_structural_rejections_never_execute_or_expose_requested_raw_input(monkeypatch,change):
    w = recipe(); w['outputs']['raw'] = {'input':'survey'}
    if change=='schema':w['schema']='custom'
    if change=='version':w['version']=True
    if change=='unknown':w['steps'][-1]['operation']='eval'
    if change=='step_version':w['steps'][-1]['version']=2
    if change=='id':w['steps'][0]['id']='bad\n'
    if change=='duplicate':w['steps'][1]['id']='qc'
    if change=='collision':w['steps'][1]['id']='survey'
    if change=='forward':w['steps'][0]['inputs']=[{'step':'level','output':'observations'}]
    if change=='cycle':w['steps'][1]['inputs']=[{'step':'level','output':'observations'}]
    if change=='port':w['steps'][2]['inputs'][0]['output']='unknown'
    if change=='type':w['steps'][2]['inputs']=[{'step':'qc','output':'report'}]
    if change=='output':w['outputs']['bad']={'step':'missing','output':'raster'}
    if change=='extra':w['steps'][1]['code']='print(1)'
    if change=='params':w['steps'][1]['parameters']['custom']=1
    if change=='missing':del w['steps'][1]['parameters']['reference_lines']
    if change=='empty':w['steps']=[]
    if change=='reference_shape':w['steps'][1]['inputs']=[{'input':'survey','step':'qc'}]
    def forbidden(*args): raise AssertionError('numerical execution during structural preflight')
    monkeypatch.setattr(baselode.geophysics.corrections,'level_magnetic_lines',forbidden)
    r = run(w)
    assert r['state'] in ('needs_input','rejected') and r['completed_steps'] == [] and r['artifacts'] == {}


def test_qc_gate_is_explicit_and_retains_flags_without_repairing_data():
    f = fixture(); f['survey']['records'][0]['values']['mag'] = None
    r = run(inputs={'survey':f['survey']})
    assert r['state'] == 'needs_input' and r['completed_steps'] == [] and r['artifacts'] == {}
    assert r['step_reports']['qc']['flags']
    w = recipe();w['steps'][0]['parameters']['max_flags']=100
    # The gate permits review policy, but later native levelling still rejects
    # missing crossing support, rather than filling a missing reading.
    r = run(w, {'survey':f['survey']})
    assert r['state'] == 'needs_input' and r['completed_steps'] == ['qc'] and r['artifacts'] == {}


@pytest.mark.parametrize('which',['quality','repeat','coordinates','qc_option'])
def test_native_failures_stop_at_stage_and_withhold_all_final_artifacts(which):
    w = recipe();data = fixture()['survey'];w['outputs']['raw']={'input':'survey'}
    if which=='quality':w['steps'][1]['parameters']['max_abs_correction']=1
    if which=='repeat':data['metadata']['corrections']['levelling']='applied'
    if which=='coordinates':data['crs']='EPSG:4326';data['crs_units']='degrees'
    if which=='qc_option':w['steps'][0]['parameters']['qc']=None
    r = run(w,{'survey':data})
    assert r['state'] != 'ok' and r['artifacts'] == {}
    assert 'grid' not in r['completed_steps']


def test_unexpected_backend_error_stops_with_bounded_audit_and_no_partial_products(monkeypatch):
    def broken(*args):raise RuntimeError('injected backend failure')
    monkeypatch.setattr(baselode.geophysics.corrections,'level_magnetic_lines',broken)
    r=run();assert r['state']=='failed' and r['completed_steps']==['qc'] and r['artifacts']=={}
    assert r['issues'][-1]['code']=='execution'


@pytest.mark.parametrize('limit',['max_steps','max_inputs','max_outputs','max_workflow_json_bytes','max_input_json_bytes','max_retained_records','max_retained_readings','max_retained_cell_values','max_reports_json_bytes'])
def test_resource_failures_are_atomic_and_reports_bounded(monkeypatch,limit):
    monkeypatch.setitem(baselode.geophysics.observation_workflows._LIMITS,limit,0)
    r=run();assert r['state']=='rejected' and r['artifacts']=={} and r['issues'][-1]['code']=='resource'


def test_static_grid_resource_estimate_blocks_kernels_before_work(monkeypatch):
    w=recipe();w['steps'][2]['parameters']['shape']=[10000,10000]
    def forbidden(*args):raise AssertionError('must reject before any stage')
    monkeypatch.setattr(baselode.geophysics.corrections,'level_magnetic_lines',forbidden)
    r=run(w);assert r['state']=='rejected' and r['completed_steps']==[] and r['issues'][-1]['code']=='resource'


def test_stale_input_history_rejects_before_execution():
    corrected=baselode.geophysics.level_magnetic_lines(fixture()['survey'],fixture()['options'])['observations']
    corrected['records'][0]['values']['mag']+=1
    r=run(inputs={'survey':corrected});assert r['state']=='rejected' and r['completed_steps']==[] and r['issues'][-1]['code']=='history'


def igrf_workflow():
    p={'target_crs':'EPSG:32750','datum_policy':'backend','event_id':'project','evidence':'synthetic WGS84 test'}
    w=workflow([step('igrf','remove_igrf',{'channel':'mag','model':'IGRF14','event_id':'igrf','evidence':'checked synthetic height/time'}),step('project','reproject_observations',p,{'step':'igrf','output':'observations'}),step('grid','grid_observations',{'channels':['mag'],'method':'nearest','radius':100,'duplicate_policy':'mean','elevation_policy':'ignore','bounds':[499990,6459550,500010,6459570],'shape':[2,2],'extrapolation':'allow'},{'step':'project','output':'observations'})],{'corrected':{'step':'project','output':'observations'},'grid':{'step':'grid','output':'grid'}})
    data={'crs':'EPSG:4326','crs_units':'degrees','channels':{'mag':{'field_type':'magnetic_total_field','units':'nT'}},'records':[{'id':'point','x':117,'y':-32,'z':100,'time':1735689600,'values':{'mag':50000}}],'metadata':{'height_units':'m','height_datum':'WGS84_ellipsoid','z_positive':'up','corrections':{'igrf':'unapplied'}}}
    return w,{'survey':data}


def test_python_igrf_projection_gridding_and_missing_backend_preflight(monkeypatch):
    w,inputs=igrf_workflow();r=run(w,inputs)
    assert r['state']=='ok',r['issues']
    assert r['artifacts']['corrected']['channels']['mag']['field_type']=='magnetic_anomaly'
    assert baselode.geophysics.inspect_corrections(r['artifacts']['corrected'])['state']=='ok'
    monkeypatch.setattr(baselode.geophysics.igrf,'_ppigrf',None)
    r=run(w,inputs);assert r['state']=='needs_input' and r['completed_steps']==[] and r['issues'][-1]['code']=='backend'


def test_input_and_step_namespaces_are_distinct_even_for_input_named_observations():
    w=workflow([step('input','declare_corrections',{'declarations':[{'id':'source','correction':'magnetic_heading','channels':['mag'],'state':'unknown','evidence':'unknown is explicit'}]}, {'input':'observations'})],{'raw':{'input':'observations'},'derived':{'step':'input','output':'observations'}})
    r=run(w,{'observations':fixture()['survey']});assert r['state']=='ok',r['issues']
    assert 'correction_ledger' not in r['artifacts']['raw']['metadata'] and 'correction_ledger' in r['artifacts']['derived']['metadata']


def test_descriptor_schema_recipe_and_parameter_contracts_are_shared_and_independent():
    d=baselode.geophysics.describe_observation_workflow();assert d==json.loads((ROOT/'javascript/packages/baselode/src/data/geophysics_observation_workflow.json').read_text())
    jsonschema.Draft202012Validator.check_schema(d['workflow_schema']);jsonschema.validate(recipe(),d['workflow_schema'])
    for op in d['operations']:jsonschema.Draft202012Validator.check_schema(op['parameters'])
    d['resources']['max_steps']=0;assert baselode.geophysics.describe_observation_workflow()['resources']['max_steps']==16


@pytest.mark.parametrize('extension',['ers','tif'])
def test_workflow_correction_history_and_step_metadata_persist_in_exports(tmp_path,extension):
    r=run();path=tmp_path/('workflow.'+extension)
    baselode.geophysics.save_raster(r['artifacts']['edges'],path,dtype='float64')
    back=baselode.geophysics.load_raster(path)
    assert back.metadata['observation_metadata']['correction_ledger']==r['artifacts']['corrected']['metadata']['correction_ledger']
    assert back.metadata['processing'][-1]['registered_operation']=='raster_total_horizontal_derivative'


def test_live_saved_json_cross_runtime_replay_and_ledger_inspection(tmp_path):
    r=run();source=tmp_path/'source.json';target=tmp_path/'target.json';w,inputs=igrf_workflow()
    source.write_text(json.dumps({'workflow':recipe(),'inputs':{'survey':fixture()['survey']},'python_corrected':r['artifacts']['corrected'],'igrf_workflow':w,'igrf_inputs':inputs}))
    subprocess.run(['node',str(ROOT/'test/data/observation_workflow_parity.mjs'),str(source),str(target)],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True)
    js=json.loads(target.read_text());assert js['state']=='ok',js['issues'];assert js['inspected']['state']=='ok'
    assert js['igrf']['state']=='needs_input' and js['igrf']['completed_steps']==[]
    assert js['corrected']['metadata']['correction_ledger']['current_binding']==r['artifacts']['corrected']['metadata']['correction_ledger']['current_binding']
    np.testing.assert_allclose(js['grid'],r['artifacts']['grid'].data,atol=1e-12)
    np.testing.assert_allclose(js['edges'],r['artifacts']['edges'].data,atol=1e-12)
    assert baselode.geophysics.inspect_corrections(js['corrected'])['state']=='ok'


@pytest.mark.parametrize('name,operation', [('corrections','correct_magnetic_base'),('lag','correct_magnetic_lag'),('heading','correct_magnetic_heading')])
def test_registered_correction_ports_execute_existing_independent_calibrations(name,operation):
    f=json.loads((ROOT/f'test/data/geophysics_{name}_reference.json').read_text())
    node=step('correct',operation,f['options'])
    inputs={'survey':f['survey']}
    if name=='corrections':node['inputs'].append({'input':'base'});inputs['base']=f['base']
    w=workflow([node],{'observations':{'step':'correct','output':'observations'}})
    r=run(w,inputs);assert r['state']=='ok',r['issues']
    expected=f['expected_values'] if 'expected_values' in f else f.get('positive_expected')
    if expected is not None:assert [row['values']['mag'] for row in r['artifacts']['observations']['records']]==expected
    assert baselode.geophysics.inspect_corrections(r['artifacts']['observations'])['state']=='ok'


def test_report_only_crossovers_and_two_input_raster_combine_ports():
    w=recipe();w['steps'].append(step('ties','analyze_crossovers',fixture()['analysis'],{'step':'level','output':'observations'}))
    w['steps'].append({'id':'zero','operation':'raster_combine','version':1,'inputs':[{'step':'grid','output':'grid'}]*2,'parameters':{'operation':'subtract'}})
    w['outputs'].update(ties={'step':'ties','output':'report'},zero={'step':'zero','output':'raster'})
    r=run(w);assert r['state']=='ok',r['issues']
    assert all(row['difference']==0 for row in r['artifacts']['ties']['crossovers'])
    np.testing.assert_array_equal(r['artifacts']['zero'].data,np.zeros((1,2,2)))


def test_non_json_and_cyclic_workflows_reject_before_processing():
    w=recipe();w['steps'][0]['parameters']['bad']=float('nan')
    assert run(w)['state']=='rejected'
    w=recipe();w['steps'][0]['parameters']['cycle']=w
    assert run(w)['state']=='rejected'


def test_overflowing_shape_rejects_with_finite_serializable_resource_report():
    w=recipe();w['steps'][2]['parameters']['shape']=[1e308,1e308]
    r=run(w);assert r['state']=='rejected' and r['issues'][-1]['code']=='resource'
    json.dumps(r,allow_nan=False)
