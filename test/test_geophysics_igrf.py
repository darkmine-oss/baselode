# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent official-model vectors, per-point dates and guarded removal."""
import copy
import json
import pathlib
import subprocess

import jsonschema
import numpy as np
import pytest

import baselode.geophysics
import baselode.geophysics.igrf
import baselode.geophysics.provenance

ROOT = pathlib.Path(__file__).resolve().parents[1]
REFERENCE = json.loads((ROOT / 'test/data/geophysics_igrf_reference.json').read_text())
OPTIONS = {'channel': 'mag', 'model': 'IGRF14', 'event_id': 'igrf-remove', 'evidence': 'Contractor source field and ellipsoidal height checked'}


def request():
    return {'model': 'IGRF14', 'points': [copy.deepcopy(c['point']) for c in REFERENCE['cases']]}


def survey():
    points = [c['point'] for c in REFERENCE['cases'][1:4]]
    return {'crs': 'EPSG:4326', 'crs_units': 'degrees', 'channels': {'mag': {'field_type': 'magnetic_total_field', 'units': 'nT'}, 'other': {'field_type': 'magnetic_total_field', 'units': 'nT'}},
            'records': [{'id': p['id'], 'x': p['longitude'], 'y': p['latitude'], 'z': p['height_m'], 'time': p['time'], 'values': {'mag': REFERENCE['cases'][i + 1]['expected']['total'] + 100, 'other': 42}, 'extra': {'keep': True}} for i, p in enumerate(points)] + [{'id': 'missing', 'values': {'mag': None, 'other': 50}}],
            'metadata': {'height_units': 'm', 'height_datum': 'WGS84_ellipsoid', 'z_positive': 'up', 'corrections': {'igrf': 'unapplied'}, 'source': 'survey.xyz', 'uncertainty': {'mag': 1}}}


def corrected():
    result = baselode.geophysics.remove_igrf(survey(), OPTIONS)
    assert result['state'] == 'ok', result['issues']
    return result['observations']


def test_official_bgs_reference_vectors_historical_predictive_hemispheres_and_heights():
    item = request(); before = copy.deepcopy(item)
    result = baselode.geophysics.calculate_igrf(item)
    assert result['state'] == 'ok', result['issues']
    for actual, case in zip(result['fields'], REFERENCE['cases']):
        assert actual['id'] == case['point']['id']
        for name in ['north', 'east', 'down', 'horizontal', 'total']:
            assert actual[name] == pytest.approx(case['expected'][name], abs=REFERENCE['tolerance_nT'])
        for name in ['declination', 'inclination']:
            assert actual[name] == pytest.approx(case['expected'][name], abs=REFERENCE['tolerance_degrees'])
    assert item == before
    jsonschema.validate(item, baselode.geophysics.describe_igrf()['request_schema'])
    jsonschema.validate(result, baselode.geophysics.describe_igrf()['result_schema'])


def test_mixed_dates_batch_equal_times_without_cross_product_and_restore_order(monkeypatch):
    item = request(); item['points'] = [item['points'][1], {**item['points'][1], 'id': 'repeat'}, item['points'][0]]
    backend = baselode.geophysics.igrf._ppigrf.igrf; calls = []
    def record(lon, lat, height, date, **kwargs):
        calls.append((len(lon), date)); return backend(lon, lat, height, date, **kwargs)
    monkeypatch.setattr(baselode.geophysics.igrf._ppigrf, 'igrf', record)
    result = baselode.geophysics.calculate_igrf(item)
    assert result['state'] == 'ok' and [x['id'] for x in result['fields']] == [p['id'] for p in item['points']]
    assert sorted(n for n, _ in calls) == [1, 2]
    assert result['fields'][0]['total'] == result['fields'][1]['total']


@pytest.mark.parametrize('field,value', [('longitude', 181), ('latitude', -90), ('latitude', 90), ('height_m', -1001), ('height_m', 100001), ('time', -2208988801), ('time', 1893456001), ('time', True), ('height_m', float('nan')), ('time', 2**60+1)])
def test_invalid_points_are_rejected_atomically(field, value):
    item = request(); item['points'][-1][field] = value
    result = baselode.geophysics.calculate_igrf(item)
    assert result['state'] == 'rejected' and result['fields'] == [] and result['model'] is None


@pytest.mark.parametrize('field', ['height_m', 'time', 'longitude'])
def test_missing_point_context_is_not_inferred(field):
    item = request(); del item['points'][0][field]
    result = baselode.geophysics.calculate_igrf(item)
    assert result['state'] == 'needs_input' and not result['fields']


def test_limits_id_uniqueness_and_strict_models():
    for change in ['points', 'duplicate', 'model', 'unknown']:
        item = request()
        if change == 'points': item['points'] = [item['points'][0]] * 513
        if change == 'duplicate': item['points'][1]['id'] = item['points'][0]['id']
        if change == 'model': item['model'] = 'latest'
        if change == 'unknown': item['hidden_conversion'] = True
        result = baselode.geophysics.calculate_igrf(item)
        assert result['state'] == 'rejected' and not result['fields']
        if change == 'points': assert result['issues'][0]['code'] == 'resource'


def test_backend_integrity_and_nonfinite_result_fail_without_partial_fields(monkeypatch):
    monkeypatch.setattr(baselode.geophysics.igrf.importlib.metadata, 'version', lambda name: 'changed')
    result = baselode.geophysics.calculate_igrf(request())
    assert result['state'] == 'failed' and not result['fields'] and result['issues'][0]['code'] == 'backend'
    monkeypatch.undo()
    def invalid(*args, **kwargs): return np.array([[float('nan')]]), np.array([[1.]]), np.array([[2.]])
    monkeypatch.setattr(baselode.geophysics.igrf._ppigrf, 'igrf', invalid)
    assert baselode.geophysics.calculate_igrf(request())['state'] == 'failed'
    result = baselode.geophysics.remove_igrf(survey(), OPTIONS)
    assert result['state'] == 'failed' and result['observations'] is None and result['ledger'] is None


def test_absent_optional_extra_has_install_guidance_and_descriptor_still_works(monkeypatch):
    monkeypatch.setattr(baselode.geophysics.igrf, '_ppigrf', None)
    assert baselode.geophysics.describe_igrf()['execution']['install']
    with pytest.raises(ImportError, match=r'baselode\[magnetics\]'): baselode.geophysics.calculate_igrf(request())
    with pytest.raises(ImportError, match=r'baselode\[magnetics\]'): baselode.geophysics.remove_igrf(survey(), OPTIONS)


def test_removal_uses_scalar_F_relabels_preserves_other_data_and_source_uncertainty():
    item = survey(); before = copy.deepcopy(item)
    result = baselode.geophysics.remove_igrf(item, OPTIONS)
    assert result['state'] == 'ok', result['issues']
    out = result['observations']
    assert [r['values']['mag'] for r in out['records'][:3]] == pytest.approx([100] * 3, abs=0.05)
    assert out['records'][-1]['values']['mag'] is None
    assert [r['values']['other'] for r in out['records']] == [42, 42, 42, 50]
    assert out['channels']['mag']['field_type'] == 'magnetic_anomaly'
    assert out['channels']['other']['field_type'] == 'magnetic_total_field'
    assert [r['id'] for r in out['records']] == [r['id'] for r in item['records']]
    assert item == before
    assert out['metadata']['corrections']['igrf'] == 'unknown' # second channel remains unapplied
    assert result['states']['magnetic_igrf'] == {'mag': 'applied', 'other': 'unapplied'}
    assert 'uncertainty' not in out['metadata'] and out['metadata']['uncertainty_propagated'] is False
    step = out['metadata']['processing'][-1]
    assert out['metadata']['input_lineage'][step['operand_lineage']]['metadata']['uncertainty'] == {'mag': 1}
    assert result['ledger']['entries'][-1]['model'] == baselode.geophysics.describe_igrf()['model']
    jsonschema.validate(result['ledger'], baselode.geophysics.describe_corrections()['ledger_schema'])
    assert baselode.geophysics.inspect_corrections(out)['state'] == 'ok'
    result['ledger']['entries'].clear()
    assert out['metadata']['correction_ledger']['entries']


@pytest.mark.parametrize('change', ['unknown', 'applied', 'height_units', 'height_datum', 'z_positive', 'crs', 'crs_units', 'unit', 'anomaly', 'missing_time', 'missing_z', 'no_readings', 'options'])
def test_removal_refuses_ambiguous_context_or_history_atomically(change):
    item = survey(); options = copy.deepcopy(OPTIONS)
    if change == 'unknown': item['metadata']['corrections'] = {}
    elif change == 'applied': item['metadata']['corrections']['igrf'] = 'applied'
    elif change in ['height_units', 'height_datum', 'z_positive']: item['metadata'].pop(change)
    elif change in ['crs', 'crs_units']: item[change] = 'unknown'
    elif change == 'unit': item['channels']['mag']['units'] = 'T'
    elif change == 'anomaly': item['channels']['mag']['field_type'] = 'magnetic_anomaly'
    elif change == 'missing_time': item['records'][1]['time'] = None
    elif change == 'missing_z': item['records'][1]['z'] = None
    elif change == 'no_readings':
        for row in item['records']: row['values']['mag'] = None
    elif change == 'options': del options['model']
    before = copy.deepcopy(item)
    result = baselode.geophysics.remove_igrf(item, options)
    assert result['state'] in ['needs_input', 'rejected'] and result['observations'] is None and result['ledger'] is None
    assert item == before


def test_repeat_removal_stale_binding_and_missing_ledger_guards():
    out = corrected()
    assert baselode.geophysics.remove_igrf(out, {**OPTIONS, 'event_id': 'second'})['state'] == 'rejected'
    for change in ['value', 'model', 'parameters', 'drop']:
        item = copy.deepcopy(out)
        if change == 'value': item['records'][0]['x'] += 1
        if change == 'model': item['metadata']['correction_ledger']['entries'][-1]['model']['coefficients_sha256'] = '0' * 64
        if change == 'parameters': item['metadata']['correction_ledger']['entries'][-1]['parameters'].pop('model')
        if change == 'drop': item['metadata'].pop('correction_ledger')
        assert baselode.geophysics.inspect_corrections(item)['state'] == 'rejected'
    declared = baselode.geophysics.declare_corrections(out, [{'id': 'reset', 'correction': 'magnetic_igrf', 'channels': ['mag'], 'state': 'unapplied', 'evidence': 'reset'}])
    assert declared['state'] == 'rejected'


def test_lineage_remaps_through_foreign_graph_and_transport_roundtrip():
    metadata = corrected()['metadata']
    nodes, operand = baselode.geophysics.provenance.append_input({'source': 'unrelated.xyz'}, metadata)
    step = nodes[operand]['metadata']['processing'][-1]
    assert nodes[step['operand_lineage']]['metadata']['uncertainty'] == {'mag': 1}
    encoded = baselode.geophysics.provenance.encode({'input_lineage': nodes}, 'GeoTIFF', 'float64')
    assert encoded


def test_shared_descriptors_are_independent_and_valid():
    d = baselode.geophysics.describe_igrf()
    assert d == json.loads((ROOT/'javascript/packages/baselode/src/data/geophysics_igrf.json').read_text())
    for name in ['request_schema', 'result_schema']:
        jsonschema.Draft202012Validator.check_schema(d[name])
    d['model']['model'] = 'changed'
    assert baselode.geophysics.describe_igrf()['model']['model'] == 'IGRF14'


def test_python_igrf_ledger_replayed_in_javascript_and_returned_to_python(tmp_path):
    source = tmp_path/'input.json'; target = tmp_path/'output.json'
    source.write_text(json.dumps(corrected()))
    subprocess.run(['node', str(ROOT/'test/data/igrf_parity.mjs'), str(source), str(target)], cwd=ROOT/'javascript/packages/baselode', check=True, capture_output=True, text=True)
    result = json.loads(target.read_text())
    assert result['inspect']['state'] == 'ok', result['inspect']['issues']
    assert all(r['state'] == 'rejected' for r in result['invalid'])
    assert result['declared']['state'] == 'ok', result['declared']['issues']
    assert baselode.geophysics.inspect_corrections(result['declared']['observations'])['state'] == 'ok'


def test_512_distinct_survey_timestamps_commit_one_bound_application():
    item = survey(); row = item['records'][0]
    item['records'] = [{**copy.deepcopy(row), 'id': 'sample-' + str(i), 'time': row['time'] + i} for i in range(512)]
    result = baselode.geophysics.remove_igrf(item, OPTIONS)
    assert result['state'] == 'ok', result['issues']
    assert result['diagnostics']['unique_times'] == 512
    assert result['ledger']['entries'][-1]['affected_records'] == 512
    assert len([e for e in result['ledger']['entries'] if e['kind'] == 'application']) == 1
    assert baselode.geophysics.inspect_corrections(result['observations'])['state'] == 'ok'


def test_missing_distribution_metadata_is_a_failed_backend_report(monkeypatch):
    def missing(name): raise baselode.geophysics.igrf.importlib.metadata.PackageNotFoundError(name)
    monkeypatch.setattr(baselode.geophysics.igrf.importlib.metadata, 'version', missing)
    result = baselode.geophysics.calculate_igrf(request())
    assert result['state'] == 'failed' and result['issues'][0]['code'] == 'backend' and result['fields'] == []
    result = baselode.geophysics.remove_igrf(survey(), OPTIONS)
    assert result['state'] == 'failed' and result['observations'] is None and result['ledger'] is None


def test_pre_1970_dates_do_not_depend_on_platform_timestamp_conversion(monkeypatch):
    original = baselode.geophysics.igrf.datetime.datetime
    class WindowsDatetime(original):
        @classmethod
        def fromtimestamp(cls, *args, **kwargs):
            raise OSError('platform negative timestamp conversion unavailable')
    monkeypatch.setattr(baselode.geophysics.igrf.datetime, 'datetime', WindowsDatetime)
    result = baselode.geophysics.calculate_igrf({'model': 'IGRF14', 'points': [request()['points'][0]]})
    assert result['state'] == 'ok', result['issues']
    assert result['fields'][0]['north'] == pytest.approx(REFERENCE['cases'][0]['expected']['north'], abs=0.05)


@pytest.mark.parametrize('igrf_first', [True, False])
def test_igrf_and_base_corrections_chain_with_one_valid_ledger(igrf_first):
    item = survey(); item['metadata']['corrections']['diurnal'] = 'unapplied'
    # Missing selected readings do not require support from either correction.
    times = [r['time'] for r in item['records'] if 'time' in r]
    base = {'channels': {'base': {'field_type': 'magnetic_total_field', 'units': 'nT'}}, 'records': [{'id': str(i), 'time': t, 'station_id': 'BASE', 'values': {'base': 50001}} for i, t in enumerate(sorted(set(times)))], 'metadata': {'corrections': {'diurnal': 'unapplied'}}}
    options = {'channel': 'mag', 'base_channel': 'base', 'reference': 50000, 'max_gap': 1, 'event_id': 'base-remove', 'evidence': 'synthetic stationary monitor', 'clock_policy': 'synchronized'}
    if igrf_first:
        first = baselode.geophysics.remove_igrf(item, OPTIONS)
        final = baselode.geophysics.correct_magnetic_base(first['observations'], base, options)
    else:
        first = baselode.geophysics.correct_magnetic_base(item, base, options)
        final = baselode.geophysics.remove_igrf(first['observations'], OPTIONS)
    assert first['state'] == 'ok' and final['state'] == 'ok', (first['issues'], final['issues'])
    assert [r['values']['mag'] for r in final['observations']['records'][:3]] == pytest.approx([99] * 3, abs=0.05)
    assert baselode.geophysics.inspect_corrections(final['observations'])['state'] == 'ok'
    for correction in ['magnetic_diurnal', 'magnetic_igrf']:
        assert final['states'][correction]['mag'] == 'applied'
