# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent analytical time shifts and correction-ledger mask accounting."""
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
REFERENCE = json.loads((ROOT/'test/data/geophysics_lag_reference.json').read_text())


def fixture():
    return copy.deepcopy(REFERENCE)


def corrected():
    f = fixture(); result = baselode.geophysics.correct_magnetic_lag(f['survey'], f['options'])
    assert result['state'] == 'ok', result['issues']
    return result['observations']


def simple(times, values, lines=None):
    data = fixture()['survey']
    data['records'] = [{'id': str(i), 'line_id': lines[i] if lines else 'L', 'time': t, 'values': {'mag': v}} for i, (t, v) in enumerate(zip(times, values))]
    return data


def test_independent_irregular_ramp_signs_mask_archive_and_immutable_source():
    for sign in ['positive', 'negative']:
        item = fixture()
        if sign == 'negative': item['options']['lag_seconds'] *= -1
        before = copy.deepcopy(item)
        result = baselode.geophysics.correct_magnetic_lag(item['survey'], item['options'])
        assert result['state'] == 'ok', result['issues']
        out = result['observations']
        assert [r['values']['mag'] for r in out['records']] == item['expected_' + sign]
        assert result['ledger']['entries'][-1]['masked_records'] == item['expected_' + sign + '_masked']
        assert item == before
        for original, actual in zip(item['survey']['records'], out['records']):
            for key in ['id', 'time', 'x', 'y', 'z', 'line_id', 'extra']: assert actual[key] == original[key]
            assert actual['values']['other'] == original['values']['other']
        assert out['channels'] == item['survey']['channels']
        assert result['states']['magnetic_lag'] == {'mag': 'applied', 'other': 'unapplied'}
        assert result['ledger']['entries'][-1]['affected_records'] == 5
        assert baselode.geophysics.inspect_corrections(out)['state'] == 'ok'
        jsonschema.validate(item['options'], baselode.geophysics.describe_corrections()['lag_parameters'])
        jsonschema.validate(result['ledger'], baselode.geophysics.describe_corrections()['ledger_schema'])


def test_integer_pulse_shift_proves_positive_lag_advances_signal():
    data = simple([0, 1, 2, 3, 4], [0, 0, 10, 0, 0]); options = {**fixture()['options'], 'lag_seconds': 1}
    result = baselode.geophysics.correct_magnetic_lag(data, options)
    assert result['state'] == 'ok'
    assert [r['values']['mag'] for r in result['observations']['records']] == [0, 10, 0, 0, None]
    assert result['proposals'][1]['source_ids'] == ['2']


def test_zero_shift_supports_exact_samples_and_preserves_input_nulls():
    data = simple([0, 1, 3], [1, None, 9]); options = {**fixture()['options'], 'lag_seconds': 0, 'unsupported_policy': 'reject', 'max_gap': .1}
    result = baselode.geophysics.correct_magnetic_lag(data, options)
    assert result['state'] == 'ok'
    assert [r['values']['mag'] for r in result['observations']['records']] == [1, None, 9]
    assert result['ledger']['entries'][-1]['masked_records'] == []
    assert result['diagnostics']['missing_readings'] == 1


def test_reject_policy_returns_proposals_and_no_committed_output():
    f = fixture(); before = copy.deepcopy(f)
    result = baselode.geophysics.correct_magnetic_lag(f['survey'], {**f['options'], 'unsupported_policy': 'reject'})
    assert result['state'] == 'needs_input' and result['observations'] is None and result['ledger'] is None
    assert result['proposals'][-1]['reason'] == 'outside_segment'
    assert result['diagnostics']['supported_readings'] == 4 and f == before


def test_reused_line_ids_are_separate_contiguous_segments():
    data = simple([0, 1, 2, 2, 3, 4, 2, 3, 4], [0, 1, 2, 100, 101, 102, 200, 201, 202], ['A']*3+['B']*3+['A']*3)
    result = baselode.geophysics.correct_magnetic_lag(data, {**fixture()['options'], 'lag_seconds': 1})
    assert result['state'] == 'ok', result['issues']
    assert [r['values']['mag'] for r in result['observations']['records']] == [1, 2, None, 101, 102, None, 201, 202, None]
    assert result['diagnostics']['segments'] == 3


def test_missing_source_markers_and_excessive_gaps_are_not_bridged():
    data = simple([0, 1, 2, 3, 4], [0, None, 20, 30, 40])
    result = baselode.geophysics.correct_magnetic_lag(data, fixture()['options'])
    assert result['state'] == 'ok'
    assert [r['values']['mag'] for r in result['observations']['records']] == [None, None, 25, 35, None]
    assert result['proposals'][0]['reason'] == 'missing_source_reading'
    data = simple([0, 1, 5, 6], [0, 1, 5, 6])
    result = baselode.geophysics.correct_magnetic_lag(data, {**fixture()['options'], 'max_gap': 1})
    assert result['state'] == 'ok'
    assert [r['values']['mag'] for r in result['observations']['records']] == [.5, None, 5.5, None]
    assert result['proposals'][1]['reason'] == 'excessive_gap'


@pytest.mark.parametrize('change', ['time', 'line', 'duplicate_time', 'reverse_time', 'unknown', 'applied', 'units', 'field', 'empty', 'no_support', 'precision'])
def test_context_contract_and_history_failures_are_atomic(change):
    f = fixture(); data = f['survey']; options = f['options']
    if change == 'time': data['records'][1]['time'] = None
    elif change == 'line': data['records'][1]['line_id'] = None
    elif change == 'duplicate_time': data['records'][1]['time'] = 0
    elif change == 'reverse_time': data['records'].reverse()
    elif change == 'unknown': data['metadata']['corrections'] = {}
    elif change == 'applied': data['metadata']['corrections']['lag'] = 'applied'
    elif change == 'units': data['channels']['mag']['units'] = 'T'
    elif change == 'field': data['channels']['mag']['field_type'] = 'gravity_anomaly'
    elif change == 'empty':
        for r in data['records']: r['values']['mag'] = None
    elif change == 'no_support': options['lag_seconds'] = 100
    elif change == 'precision':
        for i, r in enumerate(data['records']): r['time'] = 2**60 + i*256
        options['lag_seconds'] = .1
    before = copy.deepcopy(data)
    result = baselode.geophysics.correct_magnetic_lag(data, options)
    assert result['state'] in ['needs_input', 'rejected'] and result['observations'] is None and result['ledger'] is None
    assert data == before


@pytest.mark.parametrize('key,value', [('lag_seconds', 3601), ('lag_seconds', float('nan')), ('lag_seconds', True), ('max_gap', 0), ('unsupported_policy', 'guess'), ('clock_policy', 'local'), ('channel', 'unknown'), ('event_id', ''), ('evidence', ''), ('extra', True)])
def test_options_are_explicit_and_strict(key, value):
    f = fixture(); options = {**f['options'], key: value}
    result = baselode.geophysics.correct_magnetic_lag(f['survey'], options)
    assert result['state'] in ['needs_input', 'rejected'] and result['observations'] is None


def test_required_options_and_record_cap():
    f = fixture()
    for key in f['options']:
        options = dict(f['options']); del options[key]
        assert baselode.geophysics.correct_magnetic_lag(f['survey'], options)['state'] == 'needs_input'
    data = simple(list(range(4097)), list(range(4097)))
    result = baselode.geophysics.correct_magnetic_lag(data, f['options'])
    assert result['state'] == 'rejected' and result['issues'][0]['code'] == 'resource'


def test_repeat_stale_data_and_removed_ledger_cannot_reset_history():
    out = corrected()
    assert baselode.geophysics.correct_magnetic_lag(out, {**fixture()['options'], 'event_id': 'repeat'})['state'] == 'rejected'
    for change in ['value', 'drop', 'count', 'mask', 'duplicate_mask', 'unknown_mask', 'policy']:
        bad = copy.deepcopy(out); entry = bad['metadata']['correction_ledger']['entries'][-1]
        if change == 'value': bad['records'][0]['values']['mag'] += 1
        elif change == 'drop': del bad['metadata']['correction_ledger']
        elif change == 'count': entry['affected_records'] -= 1
        elif change == 'mask': entry['masked_records'][0]['id'] = 'r0'
        elif change == 'duplicate_mask': entry['masked_records'] *= 2
        elif change == 'unknown_mask': entry['masked_records'][0]['id'] = 'absent'
        elif change == 'policy': entry['parameters']['unsupported_policy'] = 'reject'
        assert baselode.geophysics.inspect_corrections(bad)['state'] == 'rejected'


def test_source_uncertainty_is_only_in_remappable_lineage():
    out = corrected(); metadata = out['metadata']; step = metadata['processing'][-1]
    for name in ['uncertainty', 'variance', 'standard_deviation']:
        assert name not in metadata
        assert metadata['input_lineage'][step['operand_lineage']]['metadata'][name] == fixture()['survey']['metadata'][name]
    nodes, operand = baselode.geophysics.provenance.append_input({'source': 'foreign.xyz'}, metadata)
    moved = nodes[operand]['metadata']['processing'][-1]
    assert nodes[moved['operand_lineage']]['metadata']['source'] == 'lag-test.xyz'
    baselode.geophysics.provenance.encode({'input_lineage': nodes}, 'GeoTIFF', 'float64')


def test_base_history_before_and_after_lag_mask_stays_valid():
    f = fixture(); f['survey']['metadata']['corrections']['diurnal'] = 'unapplied'
    base = {'channels': {'base': {'field_type': 'magnetic_total_field', 'units': 'nT'}}, 'records': [{'id': str(i), 'time': t, 'station_id': 'BASE', 'values': {'base': 101}} for i,t in enumerate([0,1,3,6,7])], 'metadata': {'corrections': {'diurnal': 'unapplied'}}}
    options = {'channel': 'mag', 'base_channel': 'base', 'reference': 100, 'max_gap': 1, 'event_id': 'base-1', 'evidence': 'constant synthetic monitor', 'clock_policy': 'synchronized'}
    before = baselode.geophysics.correct_magnetic_base(f['survey'], base, options)
    lag = baselode.geophysics.correct_magnetic_lag(before['observations'], f['options'])
    assert lag['state'] == 'ok', lag['issues']
    applications = [e for e in lag['ledger']['entries'] if e['kind'] == 'application']
    assert [e['affected_records'] for e in applications] == [5, 5]
    assert baselode.geophysics.inspect_corrections(lag['observations'])['state'] == 'ok'
    lag = baselode.geophysics.correct_magnetic_lag(f['survey'], f['options'])
    after = baselode.geophysics.correct_magnetic_base(lag['observations'], base, options)
    assert after['state'] == 'ok', after['issues']
    assert [e['affected_records'] for e in after['ledger']['entries'] if e['kind'] == 'application'] == [5, 4]


def test_igrf_history_before_and_after_masking_stays_valid():
    f = fixture(); data = f['survey']; data['crs'] = 'EPSG:4326'; data['crs_units'] = 'degrees'
    data['metadata'].update(height_units='m', height_datum='WGS84_ellipsoid', z_positive='up')
    data['metadata']['corrections']['igrf'] = 'unapplied'
    for row in data['records']: row.update(x=115, y=-32, z=100, time=1735689600+row['time'])
    options = {'channel': 'mag', 'model': 'IGRF14', 'event_id': 'igrf-1', 'evidence': 'synthetic source'}
    initial = baselode.geophysics.remove_igrf(data, options)
    lag = baselode.geophysics.correct_magnetic_lag(initial['observations'], f['options'])
    assert lag['state'] == 'ok', lag['issues']
    assert baselode.geophysics.inspect_corrections(lag['observations'])['state'] == 'ok'
    initial = baselode.geophysics.correct_magnetic_lag(data, f['options'])
    final = baselode.geophysics.remove_igrf(initial['observations'], options)
    assert final['state'] == 'ok', final['issues']
    assert final['ledger']['entries'][-1]['affected_records'] == 4


def test_descriptors_share_extended_application_union():
    contract = baselode.geophysics.describe_corrections()
    assert contract == json.loads((ROOT/'javascript/packages/baselode/src/data/geophysics_corrections.json').read_text())
    jsonschema.Draft202012Validator.check_schema(contract['ledger_schema'])
    jsonschema.Draft202012Validator.check_schema(contract['lag_parameters'])


def test_live_python_javascript_bidirectional_mask_accounting(tmp_path):
    f = fixture(); f['python_output'] = corrected()
    source = tmp_path/'source.json'; target = tmp_path/'target.json'; source.write_text(json.dumps(f))
    subprocess.run(['node', str(ROOT/'test/data/lag_parity.mjs'), str(source), str(target)], cwd=ROOT/'javascript/packages/baselode', capture_output=True, text=True, check=True)
    result = json.loads(target.read_text())
    for name in ['inspected', 'first', 'second']: assert result[name]['state'] == 'ok', result[name]['issues']
    assert [r['values']['mag'] for r in result['first']['observations']['records']] == f['expected_positive']
    assert result['first']['ledger']['current_binding'] == f['python_output']['metadata']['correction_ledger']['current_binding']
    assert baselode.geophysics.inspect_corrections(result['second']['observations'])['state'] == 'ok'
    assert [r['values']['other'] for r in result['second']['observations']['records']] == [None, 500.5, 501.75, 502.8333333333333, 503.5]
    python_second = baselode.geophysics.correct_magnetic_lag(result['first']['observations'], {**f['options'], 'channel': 'other', 'lag_seconds': -.5, 'event_id': 'py-other'})
    assert python_second['state'] == 'ok', python_second['issues']
    assert python_second['ledger']['current_binding'] == result['second']['ledger']['current_binding']


@pytest.mark.parametrize('extension', ['ers', 'tif'])
def test_mask_archive_and_ledger_persist_through_gridding_and_export(tmp_path, extension):
    output = corrected()
    grid = baselode.geophysics.grid_observations(output, {'channels': ['mag'], 'radius': 100, 'duplicate_policy': 'mean', 'elevation_policy': 'ignore', 'bounds': [0, -5, 70, 5], 'shape': [1, 7], 'extrapolation': 'allow'})
    assert grid['state'] == 'ok', grid['issues']
    path = tmp_path/('lag.'+extension); baselode.geophysics.save_raster(grid['artifacts']['grid'], path, dtype='float64')
    back = baselode.geophysics.load_raster(path)
    assert back.metadata['observation_metadata']['correction_ledger'] == output['metadata']['correction_ledger']
