# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Calibrated gravity tide effects, fixed-reference loop drift and repeat QC."""
import bisect
import copy
import json
import pathlib

import baselode.geophysics.corrections
import baselode.geophysics.observations
import baselode.geophysics.provenance

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent / 'geophysics_gravity_temporal.json').read_text())


def describe_gravity_temporal():
    """Return independent tide/drift/repeat contracts and assumptions.

    Returns
    -------
    dict
        Versioned parameters, fixed-reference model schema and resource bounds.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _repeats(data, channel):
    qc = baselode.geophysics.observations.qc_observations(data, {})
    groups = []
    for repeat in qc['repeats']:
        indexes = [i for i in repeat['rows'] if data['records'][i]['values'][channel] is not None]
        if not indexes:
            continue
        rows = [data['records'][i] for i in indexes]
        locations = {(row['x'], row['y']) for row in rows}
        heights = {row['z'] for row in rows}
        same_location = len(locations) == 1 if all(row['x'] is not None and row['y'] is not None for row in rows) else None
        same_height = len(heights) == 1 if all(row['z'] is not None for row in rows) else None
        groups.append({'station_id': repeat['station_id'], 'record_ids': [row['id'] for row in rows], 'same_location': same_location, 'same_height': same_height,
                       'geometry_comparable': len(rows) >= 2 and same_location is True and same_height is True, 'statistics': repeat['channels'][channel]})
    return groups


def analyze_gravity_repeats(payload, options):
    """Inspect repeat-station statistics without changing observations.

    Parameters
    ----------
    payload : dict
        V1 gravity_relative/observed/disturbance observations in mGal.
    options : dict
        Explicit selected channel only. Existing history must validate.

    Returns
    -------
    dict
        Correction-style report with repeats under diagnostics, including
        exact same-location/height and geometry-comparability flags. This is
        raw QC, not inferred drift, uncertainty or automatic station repair.
    """
    report = baselode.geophysics.corrections._report('analyze_gravity_repeats')
    report['assumptions'] = copy.deepcopy(_DESCRIPTOR['assumptions'])
    try:
        params = baselode.geophysics.corrections._json(options)
        if type(params) is not dict or set(params) != {'channel'}:
            raise ValueError('repeat analysis requires exactly channel')
        data = baselode.geophysics.observations.create_observations(payload)
        channel = params['channel']
        if not isinstance(channel, str) or channel not in data['channels'] or not data['channels'][channel]['field_type'].startswith('gravity_') or data['channels'][channel]['units'] != 'mGal':
            raise ValueError('repeat analysis requires a gravity channel in mGal')
        if len(data['records']) > 4096:
            raise baselode.geophysics.corrections._ResourceError('gravity repeat analysis accepts at most 4096 records')
        ledger = baselode.geophysics.corrections._load(data)
        repeats = _repeats(data, channel)
        report.update(parameters=params, states=baselode.geophysics.corrections._states(data, ledger), diagnostics={'repeats': repeats, 'gravity_datum': baselode.geophysics.corrections._effective_gravity_datum(data, channel)})
        if not any(item['statistics']['count'] >= 2 for item in repeats):
            raise baselode.geophysics.corrections._NeedsInput('no station has two nonnull selected readings; repeat coverage unavailable')
    except (ValueError, TypeError, RecursionError) as error:
        baselode.geophysics.corrections._error(report, error)
    return report


def _start(payload, options, drift):
    params = baselode.geophysics.corrections._gravity_drift_options(options) if drift else baselode.geophysics.corrections._gravity_tide_options(options)
    data = baselode.geophysics.observations.create_observations(payload)
    channel = params['channel']
    if channel not in data['channels'] or data['channels'][channel]['field_type'] not in ('gravity_relative', 'gravity_observed') or data['channels'][channel]['units'] != 'mGal':
        raise ValueError('use scale-calibrated gravity_relative or absolute gravity_observed in mGal')
    baselode.geophysics.corrections._gravity_temporal_context(data, params)
    if not baselode.geophysics.corrections._known_gravity_label(baselode.geophysics.corrections._effective_gravity_datum(data, channel)):
        raise baselode.geophysics.corrections._NeedsInput('declare selected input gravity datum, including relative instrument zero when applicable')
    ledger = baselode.geophysics.corrections._load(data)
    states = baselode.geophysics.corrections._states(data, ledger)
    expected = {name: 'unapplied' for name in ('gravity_normal', 'gravity_free_air', 'gravity_bouguer', 'gravity_terrain')}
    expected['gravity_drift' if drift else 'gravity_tide'] = 'unapplied'
    if drift:
        expected['gravity_tide'] = 'applied'
    for name, required in expected.items():
        state = states[name][channel]
        if state == 'unknown':
            raise baselode.geophysics.corrections._NeedsInput('declare evidence-backed ' + required + ' ' + name + ' history')
        if state != required:
            raise ValueError('gravity processing order/repeat conflicts with ' + name + ' history')
    if any(entry['id'] == params['event_id'] for entry in ledger['entries']):
        raise ValueError('event_id already exists')
    if len(ledger['entries']) >= baselode.geophysics.corrections._LIMITS['max_events']:
        raise baselode.geophysics.corrections._ResourceError('gravity event limit exceeded')
    readings = [row for row in data['records'] if row['values'][channel] is not None]
    if not readings:
        raise baselode.geophysics.corrections._NeedsInput('selected channel needs nonnull readings')
    if data['channels'][channel]['field_type'] == 'gravity_observed' and any(row['values'][channel] <= 0 for row in readings):
        raise ValueError('absolute observed gravity must be positive; relative readings need gravity_relative field type')
    return data, params, ledger, readings


def _finish(data, params, ledger, report, before, model=None):
    after = baselode.geophysics.corrections._binding(data)
    temporal_binding = baselode.geophysics.corrections._gravity_temporal_binding(data, params, model)
    correction = 'gravity_drift' if model is not None else 'gravity_tide'
    event = {'id': params['event_id'], 'kind': 'application', 'correction': correction, 'channels': [params['channel']], 'state': 'applied', 'evidence': params['evidence'],
             'producer': baselode.geophysics.corrections._producer(), 'input_binding': before, 'output_binding': after, 'parameters': params, 'temporal_binding': temporal_binding,
             'affected_records': sum(row['values'][params['channel']] is not None for row in data['records'])}
    if model is not None:
        event['model'] = model
    ledger['entries'].append(event)
    ledger['current_binding'] = after
    metadata = data['metadata']
    for key in ('uncertainty', 'variance', 'standard_deviation'):
        metadata.pop(key, None)
    metadata['uncertainty_propagated'] = False
    metadata['processing'] = list(metadata.get('processing', [])) + [{'operation': 'correct_gravity_drift' if model is not None else 'apply_gravity_tide', 'version': 1, 'parameters': params, 'input_binding': before, 'output_binding': after, 'operand_lineage': report['diagnostics'].pop('source_operand')}]
    output = baselode.geophysics.corrections._save(data, ledger)
    report.update(observations=output, ledger=copy.deepcopy(ledger), states=baselode.geophysics.corrections._states(output, ledger))
    return report


def apply_gravity_tide(payload, options):
    """Subtract supplied, caller-verified per-record tide effects atomically.

    Parameters
    ----------
    payload : dict
        Calibrated mGal relative/absolute observations with explicit instrument,
        scale/height/tide context and known unapplied tide/reference reductions.
    options : dict
        channel, model_id, effects [{record_id,effect_mGal}], max_abs_effect_mGal,
        effect_convention='observed_minus_reference', clock_policy='synchronized',
        reference_policy='caller_verified', event_id and evidence.

    Returns
    -------
    dict
        Correction report; complete exact record coverage required. Geometry,
        other channels and nulls remain. No tide model or datum conversion is
        inferred; permanent tide system and selected field type are unchanged.
    """
    report = baselode.geophysics.corrections._report('apply_gravity_tide')
    report['assumptions'] = copy.deepcopy(_DESCRIPTOR['assumptions'])
    try:
        data, params, ledger, readings = _start(payload, options, False)
        report['parameters'] = params
        baselode.geophysics.corrections._gravity_temporal_binding(data, params)
        effects = {item['record_id']: item['effect_mGal'] for item in params['effects']}
        before = ledger['current_binding']
        nodes, operand = baselode.geophysics.provenance.append_input(data['metadata'], data['metadata'])
        data['metadata']['input_lineage'] = nodes
        report['diagnostics'] = {'source_operand': operand, 'affected_records': len(readings), 'uncertainty_propagated': False}
        for row in readings:
            original = row['values'][params['channel']]
            value = original - effects[row['id']]
            if not baselode.geophysics.corrections._number(value) or (data['channels'][params['channel']]['field_type'] == 'gravity_observed' and value <= 0):
                raise ValueError('tide-corrected reading violates finite/absolute magnitude bounds')
            row['values'][params['channel']] = value
            report['proposals'].append({'id': row['id'], 'original': original, 'effect_mGal': effects[row['id']], 'corrected': value})
        return _finish(data, params, ledger, report, before)
    except (ValueError, TypeError, RecursionError) as error:
        return baselode.geophysics.corrections._error(report, error)


def correct_gravity_drift(payload, options):
    """Tie calibrated readings to absolute references with linear loop drift.

    Parameters
    ----------
    payload : dict
        Calibrated relative/absolute mGal readings, known applied tide history
        and unapplied drift/reference/height reductions. Inputs never modified.
    options : dict
        channel, controls [{record_id,reference_mGal}], target_gravity_datum,
        model_id, max_gap_seconds, max_abs_correction_mGal (including datum
        offset), max_drift_rate_mGal_per_s, caller_verified/synchronized policies,
        event_id and evidence. Controls are copied and sorted by UTC time.

    Returns
    -------
    dict
        Complete positive absolute gravity_observed output only if every
        nonnull reading has bounded support. Reports retain proposals, tie/loop
        diagnostics and before/after native repeat QC. Zero fitted tie residual
        is a calibration constraint, not independent accuracy evidence.
        No extrapolation, global network solve or scale factor is inferred.
    """
    report = baselode.geophysics.corrections._report('correct_gravity_drift')
    report['assumptions'] = copy.deepcopy(_DESCRIPTOR['assumptions'])
    try:
        data, params, ledger, readings = _start(payload, options, True)
        report['parameters'] = params
        channel = params['channel']
        rows = {row['id']: row for row in readings}
        ties = []
        for control in params['controls']:
            if control['record_id'] not in rows:
                raise ValueError('control must identify a nonnull selected reading')
            row = rows[control['record_id']]
            if row['station_id'] is None:
                raise baselode.geophysics.corrections._NeedsInput('every control requires a station_id')
            ties.append({'record_id': row['id'], 'station_id': row['station_id'], 'time': row['time'], 'original_mGal': row['values'][channel], 'reference_mGal': control['reference_mGal'], 'bias_mGal': row['values'][channel] - control['reference_mGal']})
        ties.sort(key=lambda row: row['time'])
        model = {'algorithm': 'piecewise_linear_absolute_ties_v1', 'source_gravity_datum': baselode.geophysics.corrections._effective_gravity_datum(data, channel), 'input_field_type': data['channels'][channel]['field_type'], 'ties': ties}
        report['diagnostics']['model'] = copy.deepcopy(model)
        baselode.geophysics.corrections._validate_gravity_drift_model(data, params, model)
        times = [tie['time'] for tie in ties]
        report['diagnostics']['loops'] = [{'from_id': a['record_id'], 'to_id': b['record_id'], 'closed_station_loop': a['station_id'] == b['station_id'], 'elapsed_seconds': b['time'] - a['time'],
                                          'observed_change_mGal': b['original_mGal'] - a['original_mGal'], 'reference_change_mGal': b['reference_mGal'] - a['reference_mGal'], 'drift_change_mGal': b['bias_mGal'] - a['bias_mGal']} for a, b in zip(ties[:-1], ties[1:])]
        report['diagnostics']['repeats_before'] = _repeats(data, channel)
        for row in readings:
            index = bisect.bisect_left(times, row['time'])
            bias, reason = None, None
            if index < len(times) and times[index] == row['time']:
                bias = ties[index]['bias_mGal']
            elif index == 0 or index == len(times):
                reason = 'outside_control_span'
            elif times[index] - times[index - 1] > params['max_gap_seconds']:
                reason = 'excessive_control_gap'
            else:
                a, b = ties[index - 1], ties[index]
                weight = (row['time'] - a['time']) / (b['time'] - a['time'])
                bias = a['bias_mGal'] + weight * (b['bias_mGal'] - a['bias_mGal'])
            value = None if bias is None else row['values'][channel] - bias
            if value is not None and (not baselode.geophysics.corrections._number(value) or value <= 0):
                reason = 'invalid_absolute_output'
            report['proposals'].append({'id': row['id'], 'time': row['time'], 'original': row['values'][channel], 'bias_mGal': bias, 'corrected': value, 'supported': reason is None, 'reason': reason})
        if any(not item['supported'] for item in report['proposals']):
            raise baselode.geophysics.corrections._NeedsInput('drift coverage/absolute-output support incomplete; no application committed')
        before = ledger['current_binding']
        nodes, operand = baselode.geophysics.provenance.append_input(data['metadata'], data['metadata'])
        data['metadata']['input_lineage'] = nodes
        report['diagnostics']['source_operand'] = operand
        for row, proposal in zip(readings, report['proposals']):
            row['values'][channel] = proposal['corrected']
        data['channels'][channel]['field_type'] = 'gravity_observed'
        data['metadata'].setdefault('gravity_channel_datums', {})[channel] = params['target_gravity_datum']
        report['diagnostics']['repeats_after'] = _repeats(data, channel)
        report['diagnostics']['uncertainty_propagated'] = False
        return _finish(data, params, ledger, report, before, model)
    except (ValueError, TypeError, RecursionError) as error:
        return baselode.geophysics.corrections._error(report, error)
