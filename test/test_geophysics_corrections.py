# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent base-variation expectations and immutable correction history."""
import copy
import json
import pathlib
import subprocess

import jsonschema
import numpy as np
import pytest

import baselode.geophysics

ROOT = pathlib.Path(__file__).resolve().parents[1]
REFERENCE = json.loads((ROOT / 'test/data/geophysics_corrections_reference.json').read_text())


def fixture():
    return copy.deepcopy(REFERENCE)


def corrected():
    item = fixture()
    result = baselode.geophysics.correct_magnetic_base(item['survey'], item['base'], item['options'])
    assert result['state'] == 'ok', result['issues']
    return result['observations']


def declaration(state='unapplied', channel='mag', correction='magnetic_diurnal', identity='source-history'):
    return {'id': identity, 'correction': correction, 'channels': [channel], 'state': state, 'evidence': 'Contractor source record checked'}


def test_independent_piecewise_variation_and_binding_fixture_preserves_inputs():
    item = fixture(); before = copy.deepcopy(item)
    result = baselode.geophysics.correct_magnetic_base(item['survey'], item['base'], item['options'])
    assert result['state'] == 'ok', result['issues']
    assert [row['values']['mag'] for row in result['observations']['records']] == item['expected_values']
    assert [row['base_value'] for row in result['proposals']] == item['expected_base']
    assert item == before
    ledger = result['observations']['metadata']['correction_ledger']
    assert ledger['initial_binding'] == item['expected_input_binding']
    assert ledger['current_binding'] == item['expected_output_binding']
    assert ledger['entries'][-1]['base_binding'] == item['expected_base_binding']
    assert result['states']['magnetic_diurnal'] == {'mag': 'applied', 'second': 'unapplied'}
    assert result['observations']['metadata']['corrections']['diurnal'] == 'unknown'
    assert result['observations']['channels']['mag']['field_type'] == 'magnetic_total_field'
    assert baselode.geophysics.inspect_corrections(result['observations'])['state'] == 'ok'


def test_declaring_unknown_history_does_not_change_data_and_cannot_reset_applied():
    item = fixture(); item['survey']['metadata'].pop('corrections')
    inspected = baselode.geophysics.inspect_corrections(item['survey'])
    assert inspected['state'] == 'ok' and inspected['states']['magnetic_diurnal']['mag'] == 'unknown'
    assert baselode.geophysics.correct_magnetic_base(item['survey'], item['base'], item['options'])['state'] == 'needs_input'
    declared = baselode.geophysics.declare_corrections(item['survey'], [declaration()])
    assert declared['state'] == 'ok', declared['issues']
    assert declared['observations']['records'] == baselode.geophysics.create_observations(item['survey'])['records']
    applied = baselode.geophysics.correct_magnetic_base(declared['observations'], item['base'], item['options'])
    assert applied['state'] == 'ok'
    reset = baselode.geophysics.declare_corrections(applied['observations'], [declaration(identity='reset')])
    assert reset['state'] == 'rejected' and reset['observations'] is None
    changed = baselode.geophysics.declare_corrections(declared['observations'], [declaration('unknown', identity='forget')])
    assert changed['state'] == 'rejected'


def test_repeated_application_and_event_id_reuse_are_blocked_per_channel():
    item = fixture(); output = corrected()
    result = baselode.geophysics.correct_magnetic_base(output, item['base'], {**item['options'], 'event_id': 'repeat'})
    assert result['state'] == 'rejected'
    result = baselode.geophysics.correct_magnetic_base(output, item['base'], {**item['options'], 'channel': 'second'})
    assert result['state'] == 'rejected'
    result = baselode.geophysics.correct_magnetic_base(output, item['base'], {**item['options'], 'channel': 'second', 'event_id': 'apply-diurnal-2'})
    assert result['state'] == 'ok', result['issues']
    assert [row['values']['second'] for row in result['observations']['records']] == [200] * 5
    assert result['observations']['metadata']['corrections']['diurnal'] == 'applied'
    assert result['states']['magnetic_diurnal'] == {'mag': 'applied', 'second': 'applied'}


@pytest.mark.parametrize('alias', ['diurnal', 'BASE-STATION', 'base_station_correction', 'magnetic_diurnal', 'diurnal_correction'])
def test_legacy_applied_aliases_cannot_be_bypassed(alias):
    item = fixture(); item['survey']['metadata']['corrections'] = {alias: 'applied'}
    assert baselode.geophysics.correct_magnetic_base(item['survey'], item['base'], item['options'])['state'] == 'rejected'


def test_conflicting_aliases_and_edited_scalar_summary_are_rejected():
    item = fixture(); item['survey']['metadata']['corrections']['base_station'] = 'applied'
    assert baselode.geophysics.inspect_corrections(item['survey'])['state'] == 'rejected'
    output = corrected(); output['metadata']['corrections']['diurnal'] = 'unapplied'
    assert baselode.geophysics.inspect_corrections(output)['state'] == 'rejected'


@pytest.mark.parametrize('change', ['value', 'time', 'geometry', 'order', 'channel_units', 'add', 'drop'])
def test_binding_rejects_stale_observation_data(change):
    output = corrected()
    if change == 'value': output['records'][0]['values']['mag'] += 1
    if change == 'time': output['records'][0]['time'] += 1
    if change == 'geometry': output['records'][0]['x'] += 1
    if change == 'order': output['records'].reverse()
    if change == 'channel_units': output['channels']['mag']['units'] = 'T'
    if change == 'add': output['records'].append({**copy.deepcopy(output['records'][0]), 'id': 'new'})
    if change == 'drop': output['records'].pop()
    result = baselode.geophysics.inspect_corrections(output)
    assert result['state'] == 'rejected' and result['ledger'] is None


def test_unsupported_coverage_is_atomic_with_missing_reading_gap_markers():
    item = fixture(); original = copy.deepcopy(item)
    result = baselode.geophysics.correct_magnetic_base(item['survey'], item['base'], {**item['options'], 'max_gap': 9})
    assert result['state'] == 'needs_input' and result['observations'] is None
    assert [row['supported'] for row in result['proposals']] == [True, False, True, False, True]
    assert item == original
    item['base']['records'][1]['values']['base'] = None
    result = baselode.geophysics.correct_magnetic_base(item['survey'], item['base'], item['options'])
    assert result['state'] == 'needs_input'
    assert [row['supported'] for row in result['proposals']] == [True, False, False, False, True]
    assert result['proposals'][2]['reason'] == 'missing_base_reading'


def test_no_extrapolation_missing_times_and_missing_readings():
    item = fixture(); item['survey']['records'][0]['time'] = -1
    result = baselode.geophysics.correct_magnetic_base(item['survey'], item['base'], item['options'])
    assert result['state'] == 'needs_input' and result['proposals'][0]['reason'] == 'outside_base_span'
    item['survey']['records'][0]['time'] = None
    result = baselode.geophysics.correct_magnetic_base(item['survey'], item['base'], item['options'])
    assert result['state'] == 'needs_input' and result['proposals'][0]['reason'] == 'missing_time'
    item['survey']['records'][0]['values']['mag'] = None
    result = baselode.geophysics.correct_magnetic_base(item['survey'], item['base'], item['options'])
    assert result['state'] == 'ok' and result['observations']['records'][0]['values']['mag'] is None
    assert result['diagnostics']['missing_readings'] == 1


def test_acquisition_order_and_explicit_reference_are_preserved():
    item = fixture(); item['survey']['records'].reverse()
    result = baselode.geophysics.correct_magnetic_base(item['survey'], item['base'], {**item['options'], 'reference': 50010})
    assert result['state'] == 'ok'
    assert [row['id'] for row in result['observations']['records']] == [row['id'] for row in item['survey']['records']]
    assert [row['values']['mag'] for row in result['observations']['records']] == [value + 10 for value in reversed(item['expected_values'])]


@pytest.mark.parametrize('change', ['duplicate_time', 'reverse_time', 'missing_station', 'mixed_station', 'moving_x', 'moving_z', 'units', 'field_type'])
def test_base_input_contracts_are_enforced(change):
    item = fixture(); records = item['base']['records']
    if change == 'duplicate_time': records[1]['time'] = 0
    if change == 'reverse_time': records.reverse()
    if change == 'missing_station': records[0]['station_id'] = None
    if change == 'mixed_station': records[0]['station_id'] = 'other'
    if change == 'moving_x': records[0]['x'] = 1; records[1]['x'] = 2
    if change == 'moving_z': records[0]['z'] = 1; records[1]['z'] = 2
    if change == 'units': item['base']['channels']['base']['units'] = 'T'
    if change == 'field_type': item['base']['channels']['base']['field_type'] = 'radiometric'
    result = baselode.geophysics.correct_magnetic_base(item['survey'], item['base'], item['options'])
    assert result['state'] == 'rejected' and result['observations'] is None


def test_schema_and_malformed_ledger_events_reject_before_state_derivation():
    descriptor = baselode.geophysics.describe_corrections()
    jsonschema.Draft202012Validator.check_schema(descriptor['ledger_schema'])
    output = corrected(); jsonschema.validate(output['metadata']['correction_ledger'], descriptor['ledger_schema'])
    for change in ('correction', 'chain', 'producer', 'count', 'extra'):
        damaged = copy.deepcopy(output); entry = damaged['metadata']['correction_ledger']['entries'][-1]
        if change == 'correction': entry['correction'] = 'custom'
        if change == 'chain': entry['input_binding'] = '0' * 64
        if change == 'producer': entry['producer']['algorithm_version'] = True
        if change == 'count': entry['affected_records'] = 1
        if change == 'extra': entry['override'] = True
        assert baselode.geophysics.inspect_corrections(damaged)['state'] == 'rejected'
    result = baselode.geophysics.declare_corrections(fixture()['survey'], [declaration(correction='custom')])
    assert result['state'] == 'rejected'


def test_numeric_resource_and_option_guards():
    item = fixture(); item['survey']['records'][0]['values']['mag'] = 2 ** 53 + 1
    assert baselode.geophysics.inspect_corrections(item['survey'])['state'] == 'rejected'
    item = fixture()
    assert baselode.geophysics.correct_magnetic_base(item['survey'], item['base'], {**item['options'], 'clock_policy': 'guess'})['state'] == 'needs_input'
    assert baselode.geophysics.correct_magnetic_base(item['survey'], item['base'], {**item['options'], 'override': True})['state'] == 'rejected'
    assert baselode.geophysics.declare_corrections(item['survey'], [declaration(identity=str(i)) for i in range(65)])['issues'][0]['code'] == 'resource'


@pytest.mark.parametrize('extension', ['ers', 'tif'])
def test_corrected_observation_ledger_survives_gridding_and_export(tmp_path, extension):
    item = fixture(); item['survey']['metadata']['uncertainty'] = {'mag': 1}
    result = baselode.geophysics.correct_magnetic_base(item['survey'], item['base'], item['options'])
    output = result['observations']; assert 'uncertainty' not in output['metadata'] and output['metadata']['uncertainty_propagated'] is False
    step = output['metadata']['processing'][-1]
    assert output['metadata']['input_lineage'][step['source_operand_lineage']]['metadata']['uncertainty'] == {'mag': 1}
    grid = baselode.geophysics.grid_observations(output, {'channels': ['mag'], 'radius': 100, 'duplicate_policy': 'mean', 'elevation_policy': 'ignore', 'bounds': [0, -5, 40, 5], 'shape': [1, 4], 'extrapolation': 'allow'})
    assert grid['state'] == 'ok', grid['issues']
    raster = grid['artifacts']['grid']; path = tmp_path / ('corrected.' + extension)
    baselode.geophysics.save_raster(raster, path, dtype='float64'); back = baselode.geophysics.load_raster(path)
    assert back.metadata['observation_metadata']['correction_ledger'] == output['metadata']['correction_ledger']


def test_bidirectional_python_javascript_ledger_replay(tmp_path):
    item = fixture(); item['survey']['records'][0]['clearance'] = 1e90
    first = baselode.geophysics.correct_magnetic_base(item['survey'], item['base'], item['options'])
    assert first['state'] == 'ok'
    item['python_output'] = first['observations']
    source = tmp_path / 'input.json'; target = tmp_path / 'output.json'
    source.write_text(json.dumps(item))
    script = ROOT / 'test/data/corrections_parity.mjs'
    subprocess.run(['node', str(script), str(source), str(target)], cwd=ROOT/'javascript/packages/baselode', check=True, capture_output=True, text=True)
    result = json.loads(target.read_text())
    assert result['inspect_state'] == 'ok' and result['correction']['state'] == 'ok'
    output = result['correction']['observations']
    inspected = baselode.geophysics.inspect_corrections(output)
    assert inspected['state'] == 'ok', inspected['issues']
    assert inspected['states']['magnetic_diurnal'] == {'mag': 'applied', 'second': 'applied'}
    assert [row['values']['second'] for row in output['records']] == [200] * 5


def test_shared_descriptor_and_unicode_signed_zero_binding():
    name = 'geophysics_corrections.json'
    assert baselode.geophysics.describe_corrections() == json.loads((ROOT/'javascript/packages/baselode/src/data'/name).read_text())
    payload = fixture()['survey']; payload['records'][0]['id'] = 'é😀'; payload['records'][0]['x'] = -0.0
    first = baselode.geophysics.inspect_corrections(payload)
    payload['records'][0]['x'] = 0
    assert first['ledger']['current_binding'] == baselode.geophysics.inspect_corrections(payload)['ledger']['current_binding']


def test_base_history_must_be_unapplied_and_existing_binding_must_validate():
    item = fixture(); item['base']['metadata']['corrections'] = {}
    assert baselode.geophysics.correct_magnetic_base(item['survey'], item['base'], item['options'])['state'] == 'needs_input'
    item['base']['metadata']['corrections'] = {'diurnal': 'applied'}
    assert baselode.geophysics.correct_magnetic_base(item['survey'], item['base'], item['options'])['state'] == 'rejected'
    item = fixture()
    declared = baselode.geophysics.declare_corrections(item['base'], [declaration(channel='base', identity='base-qc')])
    assert declared['state'] == 'ok'
    declared['observations']['records'][0]['values']['base'] += 1
    assert baselode.geophysics.correct_magnetic_base(item['survey'], declared['observations'], item['options'])['state'] == 'rejected'


def test_retained_processing_blocks_reinitializing_a_dropped_ledger():
    item = fixture(); output = corrected(); del output['metadata']['correction_ledger']
    assert baselode.geophysics.inspect_corrections(output)['state'] == 'rejected'
    declared = baselode.geophysics.declare_corrections(output, [declaration(identity='claim-raw')])
    assert declared['state'] == 'rejected' and declared['observations'] is None
    assert baselode.geophysics.correct_magnetic_base(output, item['base'], item['options'])['state'] == 'rejected'


def test_malformed_stored_application_options_are_contract_rejections():
    for change in ('missing', 'clock'):
        output = corrected(); params = output['metadata']['correction_ledger']['entries'][-1]['parameters']
        if change == 'missing': del params['reference']
        else: params['clock_policy'] = 'guess'
        result = baselode.geophysics.inspect_corrections(output)
        assert result['state'] == 'rejected' and result['issues'][0]['code'] == 'contract'


def test_unrelated_large_binary64_values_remain_usable():
    item = fixture(); item['survey']['records'][0]['clearance'] = 1e90
    item['survey']['records'][0]['values']['second'] = 2 ** 60
    result = baselode.geophysics.correct_magnetic_base(item['survey'], item['base'], item['options'])
    assert result['state'] == 'ok', result['issues']
    assert result['observations']['records'][0]['clearance'] == 1e90
    assert result['observations']['records'][0]['values']['second'] == 2 ** 60
    assert baselode.geophysics.inspect_corrections(result['observations'])['state'] == 'ok'
