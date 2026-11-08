# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent circular heading calibration and source/model binding checks."""
import copy
import json
import pathlib
import subprocess

import jsonschema
import pytest

import baselode.geophysics
import baselode.geophysics.corrections
import baselode.geophysics.provenance

ROOT = pathlib.Path(__file__).resolve().parents[1]
REFERENCE = json.loads((ROOT/'test/data/geophysics_heading_reference.json').read_text())


def fixture():
    return copy.deepcopy(REFERENCE)


def corrected():
    f = fixture(); r = baselode.geophysics.correct_magnetic_heading(f['survey'], f['options'])
    assert r['state'] == 'ok', r['issues']
    return r['observations']


def test_independent_signed_bias_cardinal_midpoint_and_north_seam_expectations():
    f = fixture(); before = copy.deepcopy(f)
    r = baselode.geophysics.correct_magnetic_heading(f['survey'], f['options'])
    assert r['state'] == 'ok', r['issues']
    assert r['proposals'][7]['calibration_headings'] == [270, 0]
    assert [p['bias_nT'] for p in r['proposals']] == f['expected_bias']
    assert [row['values']['mag'] for row in r['observations']['records']] == f['expected_values']
    assert [n['heading_degrees'] for n in r['parameters']['calibration']] == [0, 90, 180, 270]
    assert f == before
    assert r['observations']['channels'] == f['survey']['channels']
    for original, actual in zip(f['survey']['records'], r['observations']['records']):
        for key in ['id', 'time', 'x', 'y', 'z', 'line_id', 'extra']: assert actual[key] == original[key]
        assert actual['values']['other'] == original['values']['other']
    assert r['states']['magnetic_heading'] == {'mag': 'applied', 'other': 'unapplied'}
    assert r['ledger']['entries'][-1]['affected_records'] == 9
    assert baselode.geophysics.inspect_corrections(r['observations'])['state'] == 'ok'
    jsonschema.validate(f['options'], baselode.geophysics.describe_corrections()['heading_parameters'])
    jsonschema.validate(r['ledger'], baselode.geophysics.describe_corrections()['ledger_schema'])


def test_circular_interpolation_without_zero_calibration_node():
    f = fixture(); options = f['options']; options['calibration'] = [{'heading_degrees':350,'bias_nT':-2},{'heading_degrees':10,'bias_nT':2}]; options['max_heading_gap'] = 20
    heads = [350,355,0,5,10,360]; biases = [-2,-1,0,1,2,0]
    f['survey']['records'] = [{'id':str(i),'values':{'mag':100+b},'extra':{'sensor_heading':h}} for i,(h,b) in enumerate(zip(heads,biases))]
    r = baselode.geophysics.correct_magnetic_heading(f['survey'], options)
    assert r['state'] == 'ok', r['issues']
    assert [p['bias_nT'] for p in r['proposals']] == biases
    assert [row['values']['mag'] for row in r['observations']['records']] == [100]*6


def test_exact_nodes_remain_supported_despite_adjacent_gap_limit():
    f = fixture(); f['survey']['records'] = [f['survey']['records'][i] for i in [0,4]]
    f['options']['calibration'] = [{'heading_degrees':0,'bias_nT':10},{'heading_degrees':180,'bias_nT':2}]; f['options']['max_heading_gap'] = 1
    r = baselode.geophysics.correct_magnetic_heading(f['survey'], f['options'])
    assert r['state'] == 'ok' and [p['bias_nT'] for p in r['proposals']] == [10,2]


@pytest.mark.parametrize('reference', ['true_north','magnetic_north','grid_north'])
def test_explicit_matching_heading_reference_frames(reference):
    f = fixture(); f['options']['heading_reference'] = reference; f['survey']['metadata']['heading']['reference'] = reference
    assert baselode.geophysics.correct_magnetic_heading(f['survey'], f['options'])['state'] == 'ok'


@pytest.mark.parametrize('change', ['missing_heading','missing_context','frame','units','positive','key','sparse','no_readings','unknown','applied'])
def test_missing_context_coverage_and_history_are_atomic(change):
    f = fixture(); data = f['survey']
    if change == 'missing_heading': del data['records'][3]['extra']['sensor_heading']
    elif change == 'missing_context': data['metadata'].pop('heading')
    elif change == 'frame': data['metadata']['heading']['reference'] = 'magnetic_north'
    elif change == 'units': data['metadata']['heading']['units'] = 'radians'
    elif change == 'positive': data['metadata']['heading']['positive'] = 'counterclockwise'
    elif change == 'key': data['metadata']['heading']['key'] = 'track'
    elif change == 'sparse': f['options']['calibration'] = [{'heading_degrees':0,'bias_nT':10},{'heading_degrees':90,'bias_nT':-6}]
    elif change == 'no_readings':
        for row in data['records']: row['values']['mag'] = None
    elif change == 'unknown': data['metadata']['corrections'] = {}
    elif change == 'applied': data['metadata']['corrections']['heading'] = 'applied'
    before = copy.deepcopy(f)
    r = baselode.geophysics.correct_magnetic_heading(data, f['options'])
    assert r['state'] in ['needs_input','rejected'] and r['observations'] is None and r['ledger'] is None
    assert f == before
    if change == 'missing_heading': assert r['proposals'][3]['reason'] == 'missing_heading'
    if change == 'sparse': assert any(p['reason'] == 'excessive_heading_gap' for p in r['proposals'])


@pytest.mark.parametrize('value', [True,'45',-1,361,float('nan')])
def test_invalid_record_headings_reject_even_on_null_magnetic_readings(value):
    for index in [0,-1]:
        f = fixture(); f['survey']['records'][index]['extra']['sensor_heading'] = value
        r = baselode.geophysics.correct_magnetic_heading(f['survey'],f['options'])
        assert r['state'] == 'rejected' and r['observations'] is None


@pytest.mark.parametrize('change',['duplicate','node_360','node_negative','node_bool','bias_bool','empty','missing_bias','unknown_node','gap_zero','gap_large','sign','reference','field','units','extra_option'])
def test_invalid_calibrations_options_and_fields_reject(change):
    f = fixture(); opts = f['options']; nodes = opts['calibration']
    if change == 'duplicate': nodes[1]['heading_degrees'] = nodes[0]['heading_degrees']
    elif change == 'node_360': nodes[0]['heading_degrees'] = 360
    elif change == 'node_negative': nodes[0]['heading_degrees'] = -10
    elif change == 'node_bool': nodes[0]['heading_degrees'] = True
    elif change == 'bias_bool': nodes[0]['bias_nT'] = True
    elif change == 'empty': opts['calibration'] = []
    elif change == 'missing_bias': nodes[0].pop('bias_nT')
    elif change == 'unknown_node': nodes[0]['other'] = 1
    elif change == 'gap_zero': opts['max_heading_gap'] = 0
    elif change == 'gap_large': opts['max_heading_gap'] = 181
    elif change == 'sign': opts['bias_convention'] = 'additive_correction'
    elif change == 'reference': opts['heading_reference'] = 'unknown'
    elif change == 'field': f['survey']['channels']['mag']['field_type'] = 'gravity_anomaly'
    elif change == 'units': f['survey']['channels']['mag']['units'] = 'T'
    elif change == 'extra_option': opts['auto_estimate'] = True
    r = baselode.geophysics.correct_magnetic_heading(f['survey'],opts)
    assert r['state'] == 'rejected' and r['observations'] is None


def test_required_options_and_resource_limits():
    f = fixture()
    for key in f['options']:
        opts = dict(f['options']); del opts[key]
        assert baselode.geophysics.correct_magnetic_heading(f['survey'],opts)['state'] == 'needs_input'
    opts = dict(f['options']); opts['calibration'] = [{'heading_degrees':i,'bias_nT':1} for i in range(73)]
    assert baselode.geophysics.correct_magnetic_heading(f['survey'],opts)['issues'][0]['code'] == 'resource'
    data = copy.deepcopy(f['survey']); data['records'] = [{**copy.deepcopy(data['records'][0]),'id':str(i)} for i in range(4097)]
    assert baselode.geophysics.correct_magnetic_heading(data,f['options'])['issues'][0]['code'] == 'resource'


def test_heading_and_model_binding_guards_inputs_excluded_from_generic_binding():
    out = corrected()
    for change in ['heading','null_heading','context','model','calibration_id','gap','binding','drop','count']:
        bad = copy.deepcopy(out); entry = bad['metadata']['correction_ledger']['entries'][-1]
        if change == 'heading': bad['records'][0]['extra']['sensor_heading'] = 1
        elif change == 'null_heading': bad['records'][-1]['extra']['sensor_heading'] = 1
        elif change == 'context': bad['metadata']['heading']['reference'] = 'grid_north'
        elif change == 'model': entry['parameters']['calibration'][0]['bias_nT'] += 1
        elif change == 'calibration_id': entry['parameters']['calibration_id'] = 'different'
        elif change == 'gap': entry['parameters']['max_heading_gap'] = 100
        elif change == 'binding': entry['heading_binding'] = '0'*64
        elif change == 'drop': bad['metadata'].pop('correction_ledger')
        elif change == 'count': entry['affected_records'] -= 1
        if change in ['heading','null_heading','context']:
            assert baselode.geophysics.corrections._binding(bad) == out['metadata']['correction_ledger']['current_binding']
        assert baselode.geophysics.inspect_corrections(bad)['state'] == 'rejected', change
    assert baselode.geophysics.correct_magnetic_heading(out,{**fixture()['options'],'event_id':'repeat'})['state'] == 'rejected'


def test_heading_ledger_before_and_after_lag_mask_preserves_historical_counts():
    f = fixture(); f['survey']['metadata']['corrections']['lag'] = 'unapplied'
    lag_options = {'channel':'mag','lag_seconds':.5,'max_gap':1,'unsupported_policy':'mask','event_id':'lag-1','evidence':'synthetic','clock_policy':'synchronized'}
    heading = baselode.geophysics.correct_magnetic_heading(f['survey'],f['options'])
    lag = baselode.geophysics.correct_magnetic_lag(heading['observations'],lag_options)
    assert lag['state'] == 'ok',lag['issues']
    assert baselode.geophysics.inspect_corrections(lag['observations'])['state'] == 'ok'
    assert [e['affected_records'] for e in lag['ledger']['entries'] if e['kind']=='application'] == [9,9]
    first = baselode.geophysics.correct_magnetic_lag(f['survey'],lag_options)
    after = baselode.geophysics.correct_magnetic_heading(first['observations'],f['options'])
    assert after['state'] == 'ok',after['issues']
    assert [e['affected_records'] for e in after['ledger']['entries'] if e['kind']=='application'] == [9,8]


def test_source_uncertainty_flat_lineage_and_descriptor():
    output = corrected(); metadata = output['metadata']; step = metadata['processing'][-1]
    for name in ['uncertainty','variance','standard_deviation']:
        assert name not in metadata
        assert metadata['input_lineage'][step['operand_lineage']]['metadata'][name] == fixture()['survey']['metadata'][name]
    nodes, operand = baselode.geophysics.provenance.append_input({'source':'foreign.xyz'},metadata)
    moved = nodes[operand]['metadata']['processing'][-1]
    assert nodes[moved['operand_lineage']]['metadata']['source'] == 'heading-test.xyz'
    baselode.geophysics.provenance.encode({'input_lineage':nodes},'GeoTIFF','float64')
    descriptor = baselode.geophysics.describe_corrections()
    assert descriptor == json.loads((ROOT/'javascript/packages/baselode/src/data/geophysics_corrections.json').read_text())
    for name in ['ledger_schema','heading_parameters','heading_context']: jsonschema.Draft202012Validator.check_schema(descriptor[name])


def test_live_bidirectional_heading_data_and_model_bindings(tmp_path):
    f = fixture(); f['python_output'] = corrected()
    source = tmp_path/'input.json'; target = tmp_path/'output.json'; source.write_text(json.dumps(f))
    subprocess.run(['node',str(ROOT/'test/data/heading_parity.mjs'),str(source),str(target)],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True)
    result = json.loads(target.read_text())
    for name in ['inspected','first','second']: assert result[name]['state'] == 'ok',result[name]['issues']
    assert result['tampered']['state'] == 'rejected'
    js_first = result['first']['observations']; py_first = f['python_output']
    for name in ['current_binding','initial_binding']: assert js_first['metadata']['correction_ledger'][name] == py_first['metadata']['correction_ledger'][name]
    assert result['first']['ledger']['entries'][-1]['heading_binding'] == py_first['metadata']['correction_ledger']['entries'][-1]['heading_binding']
    assert [r['values']['other'] for r in result['second']['observations']['records']] == f['expected_other_values']
    assert baselode.geophysics.inspect_corrections(result['second']['observations'])['state'] == 'ok'
    second = baselode.geophysics.correct_magnetic_heading(js_first,{**f['options'],'channel':'other','event_id':'py-other'})
    assert second['state'] == 'ok',second['issues']
    assert second['ledger']['current_binding'] == result['second']['ledger']['current_binding']
    assert second['ledger']['entries'][-1]['heading_binding'] == result['second']['ledger']['entries'][-1]['heading_binding']


@pytest.mark.parametrize('extension',['ers','tif'])
def test_heading_calibration_and_binding_persist_through_grid_exports(tmp_path,extension):
    output = corrected()
    grid = baselode.geophysics.grid_observations(output,{'channels':['mag'],'radius':100,'duplicate_policy':'mean','elevation_policy':'ignore','bounds':[0,-5,90,5],'shape':[1,9],'extrapolation':'allow'})
    assert grid['state'] == 'ok',grid['issues']
    path = tmp_path/('heading.'+extension); baselode.geophysics.save_raster(grid['artifacts']['grid'],path,dtype='float64')
    back = baselode.geophysics.load_raster(path)
    metadata = back.metadata['observation_metadata']
    assert metadata['correction_ledger'] == output['metadata']['correction_ledger']
    assert metadata['heading'] == output['metadata']['heading']


def test_base_and_igrf_histories_before_heading_stay_valid():
    f = fixture(); f['survey']['metadata']['corrections']['diurnal'] = 'unapplied'
    base = {'channels':{'base':{'field_type':'magnetic_total_field','units':'nT'}},'records':[{'id':str(i),'time':i,'station_id':'BASE','values':{'base':101}} for i in range(10)],'metadata':{'corrections':{'diurnal':'unapplied'}}}
    opts = {'channel':'mag','base_channel':'base','reference':100,'max_gap':1,'event_id':'base-1','evidence':'constant synthetic','clock_policy':'synchronized'}
    first = baselode.geophysics.correct_magnetic_base(f['survey'],base,opts)
    after = baselode.geophysics.correct_magnetic_heading(first['observations'],f['options'])
    assert after['state'] == 'ok',after['issues']
    assert [r['values']['mag'] for r in after['observations']['records']] == [99]*9+[None]
    data = f['survey']; data.update(crs='EPSG:4326',crs_units='degrees'); data['metadata'].update(height_units='m',height_datum='WGS84_ellipsoid',z_positive='up'); data['metadata']['corrections']['igrf'] = 'unapplied'
    for row in data['records']: row.update(x=115,y=-32,z=100,time=1735689600+row['time'])
    first = baselode.geophysics.remove_igrf(data,{'channel':'mag','model':'IGRF14','event_id':'igrf-1','evidence':'synthetic'})
    after = baselode.geophysics.correct_magnetic_heading(first['observations'],f['options'])
    assert after['state'] == 'ok',after['issues']
    assert baselode.geophysics.inspect_corrections(after['observations'])['state'] == 'ok'
