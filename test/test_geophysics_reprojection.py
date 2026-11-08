# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent UTM anchors and correction history across horizontal frames."""
import copy
import json
import pathlib
import subprocess

import jsonschema
import pytest

import baselode.geophysics
import baselode.geophysics.provenance

ROOT = pathlib.Path(__file__).resolve().parents[1]


def options(target='EPSG:32750', event='project'):
    return {'target_crs': target, 'datum_policy': 'backend', 'event_id': event, 'evidence': 'Independent synthetic WGS84 check'}


def survey():
    return {'crs': 'EPSG:4326', 'crs_units': 'degrees',
            'channels': {'mag': {'field_type': 'magnetic_total_field', 'units': 'nT'}, 'other': {'field_type': 'magnetic_anomaly', 'units': 'nT'}},
            'metadata': {'height_units': 'm', 'height_datum': 'WGS84_ellipsoid', 'z_positive': 'up', 'corrections': {'lag': 'unapplied', 'igrf': 'unapplied'}, 'uncertainty': 2},
            'records': [{'id': 'point😀', 'x': 117, 'y': -32, 'z': 100, 'time': 1735689600, 'line_id': 'A', 'values': {'mag': 50000, 'other': None}, 'extra': {'azimuth': 90}},
                        {'id': 'missing', 'x': None, 'y': None, 'values': {'mag': None, 'other': 2}}]}


def project(data=None, opts=None):
    result = baselode.geophysics.reproject_observations(survey() if data is None else data, options() if opts is None else opts)
    assert result['state'] == 'ok', result['issues']
    return result


@pytest.mark.parametrize('zone,south', [(1, False), (30, True), (50, True), (60, False)])
def test_independent_central_meridian_equator_anchors(zone, south):
    data = survey(); data['records'] = data['records'][:1]
    data['records'][0].update(x=zone*6-183, y=0)
    result = project(data, options(f'EPSG:{32700+zone if south else 32600+zone}'))
    row = result['observations']['records'][0]
    assert row['x'] == pytest.approx(500000, abs=1e-7)
    assert row['y'] == pytest.approx(10000000 if south else 0, abs=1e-7)


def test_roundtrip_preserves_measurements_nulls_history_and_input():
    data = survey(); before = copy.deepcopy(data); first = project(data)
    out = first['observations']; event = first['ledger']['entries'][-1]
    assert data == before
    assert event['source'] == {'crs': 'EPSG:4326', 'crs_units': 'degrees'}
    assert first['states']['magnetic_lag'] == {'mag': 'unapplied', 'other': 'unapplied'}
    assert first['diagnostics']['transformed_records'] == 1 and first['diagnostics']['missing_xy_records'] == 1
    normalized = baselode.geophysics.create_observations(data)
    for original, row in zip(normalized['records'], out['records']):
        for key in set(original) - {'x', 'y'}: assert row[key] == original[key]
    assert out['records'][1]['x'] is None and out['records'][1]['y'] is None
    assert out['metadata']['uncertainty_propagated'] is False and 'uncertainty' not in out['metadata']
    nodes = out['metadata']['input_lineage']; assert nodes[-1]['metadata']['uncertainty'] == 2
    second = project(out, options('EPSG:4326', 'back'))
    assert second['ledger']['entries'][:-1] == first['ledger']['entries']
    assert second['observations']['records'][0]['x'] == pytest.approx(117, abs=1e-8)
    assert second['observations']['records'][0]['y'] == pytest.approx(-32, abs=1e-8)
    assert baselode.geophysics.inspect_corrections(second['observations'])['state'] == 'ok'
    third = project(second['observations'], options('EPSG:32750', 'again'))
    assert third['states'] == first['states']
    same = project(out, options('EPSG:32750', 'identity'))
    assert same['observations']['records'] == out['records']
    assert same['ledger']['entries'][-1]['backend']['name'] == 'identity'
    jsonschema.validate(first['ledger'], baselode.geophysics.describe_corrections()['ledger_schema'])


@pytest.mark.parametrize('change', ['partial', 'both_missing', 'longitude', 'latitude', 'zone', 'hemisphere', 'polar', 'unit', 'datum', 'local', 'unknown_option', 'ack', 'missing_option', 'zone0', 'zone61', 'xy_bound'])
def test_invalid_context_or_coordinates_fail_atomically(change):
    data = survey(); opts = options()
    if change == 'partial': data['records'][0]['y'] = None
    if change == 'both_missing': data['records'][0].update(x=None, y=None)
    if change == 'longitude': data['records'][0]['x'] = 181
    if change == 'latitude': data['records'][0]['y'] = -91
    if change == 'zone': data['records'][0]['x'] = 111
    if change == 'hemisphere': data['records'][0]['y'] = 1
    if change == 'polar': data['records'][0]['y'] = -81
    if change == 'unit': data['crs_units'] = 'm'
    if change == 'datum': data['crs'] = 'EPSG:4283'
    if change == 'local': data['crs'] = None
    if change == 'unknown_option': opts['rotate_headings'] = True
    if change == 'ack': opts['datum_policy'] = 'automatic'
    if change == 'missing_option': del opts['target_crs']
    if change == 'zone0': opts['target_crs'] = 'EPSG:32600'
    if change == 'zone61': opts['target_crs'] = 'EPSG:32761'
    if change == 'xy_bound': data['records'][0]['x'] = 1e13
    before = copy.deepcopy(data)
    result = baselode.geophysics.reproject_observations(data, opts)
    assert result['state'] != 'ok' and result['observations'] is None and result['ledger'] is None
    assert data == before


@pytest.mark.parametrize('change', ['xy', 'source', 'target', 'params', 'count', 'backend', 'digest', 'id', 'producer', 'extra', 'chain', 'missing_ledger'])
def test_stale_derivations_and_missing_history_reject(change):
    data = project()['observations']; event = data['metadata']['correction_ledger']['entries'][-1]
    if change == 'xy': data['records'][0]['x'] += 1
    if change == 'source': event['source']['crs_units'] = 'degree'
    if change == 'target': event['target']['crs'] = 'EPSG:32749'
    if change == 'params': event['parameters']['datum_policy'] = 'automatic'
    if change == 'count': event['transformed_records'] += 1
    if change == 'backend': event['backend']['version'] = 'changed'
    if change == 'digest': event['transform_binding'] = '0'*64
    if change == 'id': event['id'] = 'different'
    if change == 'producer': event['producer']['algorithm_version'] = True
    if change == 'extra': event['allow'] = True
    if change == 'chain': event['input_binding'] = '0'*64
    if change == 'missing_ledger': del data['metadata']['correction_ledger']
    assert baselode.geophysics.inspect_corrections(data)['state'] != 'ok'
    assert baselode.geophysics.reproject_observations(data, options('EPSG:4326','back'))['observations'] is None


def level_fixture():
    f = json.loads((ROOT/'test/data/geophysics_crossovers_reference.json').read_text())
    f['survey']['crs'] = 'EPSG:32750'
    for row in f['survey']['records']:
        row['x'] += 500000; row['y'] += 6500000
    return f


def test_prior_levelling_context_survives_geographic_and_return_frames():
    f = level_fixture(); level = baselode.geophysics.level_magnetic_lines(f['survey'], f['options'])
    assert level['state'] == 'ok', level['issues']
    first = project(level['observations'], options('EPSG:4326'))
    assert first['ledger']['entries'][:-1] == level['ledger']['entries']
    assert first['states'] == level['states']
    assert baselode.geophysics.inspect_corrections(first['observations'])['state'] == 'ok'
    back = project(first['observations'], options('EPSG:32750', 'back'))
    assert baselode.geophysics.level_magnetic_lines(back['observations'], {**f['options'], 'event_id': 'twice'})['state'] == 'rejected'
    second = baselode.geophysics.level_magnetic_lines(back['observations'], {**f['options'], 'channel': 'other', 'event_id': 'other', 'max_rms_residual': 1e-6})
    assert second['state'] == 'ok', second['issues']
    assert baselode.geophysics.inspect_corrections(second['observations'])['state'] == 'ok'


def test_grid_north_heading_and_following_lag_preserve_bound_acquisition_context():
    f = level_fixture(); data = f['survey']
    data['metadata']['corrections'].update(heading='unapplied', lag='unapplied')
    data['metadata']['heading'] = {'key':'azimuth','units':'degrees','reference':'grid_north','positive':'clockwise'}
    for index, row in enumerate(data['records']):
        row['extra']['azimuth'] = 90; row['time'] = index*10
    opts = {'channel':'mag','heading_key':'azimuth','heading_reference':'grid_north','calibration_id':'test','calibration':[{'heading_degrees':0,'bias_nT':0},{'heading_degrees':90,'bias_nT':1},{'heading_degrees':180,'bias_nT':0},{'heading_degrees':270,'bias_nT':-1}],'max_heading_gap':90,'bias_convention':'observed_minus_reference','event_id':'heading','evidence':'synthetic'}
    heading = baselode.geophysics.correct_magnetic_heading(data, opts)
    assert heading['state'] == 'ok', heading['issues']
    out = project(heading['observations'], options('EPSG:4326'))['observations']
    assert out['metadata']['heading'] == data['metadata']['heading']
    assert baselode.geophysics.inspect_corrections(out)['state'] == 'ok'
    lag = baselode.geophysics.correct_magnetic_lag(out, {'channel':'mag','lag_seconds':1,'max_gap':20,'unsupported_policy':'mask','clock_policy':'synchronized','event_id':'lag','evidence':'synthetic'})
    assert lag['state'] == 'ok', lag['issues']
    assert baselode.geophysics.inspect_corrections(lag['observations'])['state'] == 'ok'
    back = project(lag['observations'], options('EPSG:32750','back'))
    assert back['states']['magnetic_heading']['mag'] == 'applied'


def test_descriptors_independent_shared_and_schemas_valid():
    descriptor = baselode.geophysics.describe_reprojection()
    assert descriptor == json.loads((ROOT/'javascript/packages/baselode/src/data/geophysics_reprojection.json').read_text())
    for key in ['parameters','event']: jsonschema.Draft202012Validator.check_schema(descriptor[key])
    descriptor['resources']['max_records'] = 0
    assert baselode.geophysics.describe_reprojection()['resources']['max_records'] == 100000


def test_live_cross_runtime_reprojection_and_original_levelling_context(tmp_path):
    f = level_fixture(); level = baselode.geophysics.level_magnetic_lines(f['survey'], f['options'])
    first = project(level['observations'], options('EPSG:4326'))
    source = tmp_path/'source.json'; target = tmp_path/'target.json'
    source.write_text(json.dumps({'survey':survey(),'options':options(),'python_output':first['observations'],'levelled':level['observations']}))
    subprocess.run(['node',str(ROOT/'test/data/reprojection_parity.mjs'),str(source),str(target)],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True)
    result = json.loads(target.read_text())
    assert result['inspected']['state'] == 'ok', result['inspected']['issues']
    for key in ['first','levelled','back']: assert result[key]['state'] == 'ok', result[key]['issues']
    expected = project()['observations']['records'][0]; actual = result['first']['observations']['records'][0]
    assert actual['x'] == pytest.approx(expected['x'],abs=1e-6)
    assert actual['y'] == pytest.approx(expected['y'],abs=1e-6)
    for key in ['first','levelled','back']:
        inspected = baselode.geophysics.inspect_corrections(result[key]['observations'])
        assert inspected['state'] == 'ok', inspected['issues']


@pytest.mark.parametrize('extension', ['ers', 'tif'])
def test_igrf_to_projection_to_grid_and_export_preserves_complete_history(tmp_path, extension):
    data = survey(); data['records'] = data['records'][:1]
    igrf = baselode.geophysics.remove_igrf(data, {'channel':'mag','model':'IGRF14','event_id':'igrf','evidence':'synthetic checked WGS84 height/time'})
    assert igrf['state'] == 'ok', igrf['issues']
    projected = project(igrf['observations'])
    assert projected['states']['magnetic_igrf']['mag'] == 'applied'
    assert projected['ledger']['entries'][:-1] == igrf['ledger']['entries']
    assert baselode.geophysics.remove_igrf(projected['observations'], {'channel':'mag','model':'IGRF14','event_id':'again','evidence':'test'})['state'] != 'ok'
    row = projected['observations']['records'][0]; x, y = row['x'], row['y']
    grid = baselode.geophysics.grid_observations(projected['observations'], {'channels':['mag'],'radius':100,'duplicate_policy':'mean','elevation_policy':'ignore','bounds':[x-10,y-10,x+10,y+10],'shape':[2,2],'extrapolation':'allow'})
    assert grid['state'] == 'ok', grid['issues']
    path = tmp_path/('projected.'+extension)
    baselode.geophysics.save_raster(grid['artifacts']['grid'], path, dtype='float64')
    back = baselode.geophysics.load_raster(path)
    assert back.metadata['observation_metadata']['correction_ledger'] == projected['ledger']
    assert grid['artifacts']['grid'].data[0,0,0] == pytest.approx(igrf['observations']['records'][0]['values']['mag'])


def test_resource_limit_duplicate_event_and_source_binding_guards(monkeypatch):
    import baselode.geophysics.corrections
    first = project()['observations']
    assert baselode.geophysics.reproject_observations(first,options())['state'] == 'rejected'
    first['records'][0]['z'] += 1
    assert baselode.geophysics.reproject_observations(first,options('EPSG:4326','back'))['state'] == 'rejected'
    for limit in ['max_events','max_output_json_bytes']:
        with monkeypatch.context() as m:
            m.setitem(baselode.geophysics.corrections._LIMITS,limit,0)
            result = baselode.geophysics.reproject_observations(survey(),options())
            assert result['state'] == 'rejected' and result['issues'][0]['code'] == 'resource'
            assert result['observations'] is None


@pytest.mark.parametrize('lon,lat,crs,easting,northing', [(12,56,'EPSG:32632',687071.44,6210141.33),(174,-44,'EPSG:32759',740526.32,5123750.87)])
def test_published_proj_noncentral_examples(lon,lat,crs,easting,northing):
    # Published PROJ UTM examples use default GRS80, indistinguishable from
    # WGS84 at the quoted centimetre precision, not a datum-shift benchmark.
    data = survey(); data['records'] = data['records'][:1]
    data['records'][0].update(x=lon,y=lat)
    row = project(data,options(crs))['observations']['records'][0]
    assert row['x'] == pytest.approx(easting,abs=0.01,rel=0)
    assert row['y'] == pytest.approx(northing,abs=0.01,rel=0)


def test_source_utm_area_is_checked_even_when_target_is_geographic():
    data = project()['observations']
    # A fresh source claims zone 49 while its easting is the central meridian
    # of zone 50: this is still geometrically valid zone 49, so source CRS
    # truth cannot be inferred. An actual out-of-zone easting must reject.
    del data['metadata']['correction_ledger']; data['metadata'].pop('processing')
    data['records'][0]['x'] = 2000000
    assert baselode.geophysics.reproject_observations(data,options('EPSG:4326'))['state'] == 'rejected'


@pytest.mark.parametrize('zone,lat', [(1,1), (60,1), (1,-1), (60,-1)])
def test_antimeridian_spellings_share_both_zone_edges_and_return_paths(zone,lat):
    outputs = []
    crs = f'EPSG:{(32600 if lat>0 else 32700)+zone}'
    for lon in [-180,180]:
        data = survey(); data['records'] = data['records'][:1]
        data['records'][0].update(x=lon,y=lat)
        out = project(data, options(crs))['observations']; outputs.append(out['records'][0])
        back = project(out, options('EPSG:4326','back'))['observations']
        assert abs(back['records'][0]['x']) == pytest.approx(180,abs=1e-8)
        assert back['records'][0]['y'] == pytest.approx(lat,abs=1e-8)
        assert project(back, options(crs,'again'))['state'] == 'ok'
    for key in ['x','y']: assert outputs[0][key] == pytest.approx(outputs[1][key],abs=1e-6,rel=0)


@pytest.mark.parametrize('change', ['missing', 'ack'])
def test_malformed_stored_parameters_reject_instead_of_requesting_input(change):
    data = project()['observations']
    params = data['metadata']['correction_ledger']['entries'][-1]['parameters']
    if change == 'missing': del params['target_crs']
    else: params['datum_policy'] = 'automatic'
    for result in [baselode.geophysics.inspect_corrections(data), baselode.geophysics.reproject_observations(data,options('EPSG:4326','back'))]:
        assert result['state'] == 'rejected'
        assert result['issues'][0]['code'] == 'contract'
        assert result['observations'] is None
