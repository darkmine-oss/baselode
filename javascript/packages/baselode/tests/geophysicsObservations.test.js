/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it } from 'vitest';
import contract from '../src/data/geophysics_observation_qc.json';
import reference from '../../../../test/data/geophysics_observations_reference.json';
import { createGeophysicsObservations, geophysicsObservationSchema, describeGeophysicsObservationQc, qcGeophysicsObservations } from '../src/data/geophysicsObservations.js';
const survey = () => structuredClone(reference.input);
function expectPortableClose(actual, expected) {
  if (typeof expected === 'number') {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(expected)));
  } else if (Array.isArray(expected)) {
    expect(actual).toHaveLength(expected.length); expected.forEach((value, index) => expectPortableClose(actual[index], value));
  } else if (expected && typeof expected === 'object') {
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    Object.entries(expected).forEach(([key, value]) => expectPortableClose(actual[key], value));
  } else expect(actual).toEqual(expected);
}
it('matches the shared QC reference and independent known speed/spike/repeat outcomes', () => {
  const payload = survey(); const original = structuredClone(payload);
  const report = qcGeophysicsObservations(payload, reference.options); const { producer, ...portable } = report;
  expectPortableClose(portable, reference.report); expect(producer.algorithm_version).toBe(1); expect(payload).toEqual(original);
  expect(report.flags.filter((item) => item.code === 'spike_candidate').map((item) => item.id)).toEqual(['r3']);
  expect(report.flags.filter((item) => item.code === 'high_speed').map((item) => item.speed)).toEqual(Array(6).fill(5));
  expect(report.coincident_locations).toEqual([[2, 15], [11, 12, 13]]);
  expect(report.repeats[0].channels.mag).toEqual({ count: 3, mean: 12, min: 10, max: 14, range: 4, sample_std: 2 });
  expect(report.summary.corrections).toEqual(payload.metadata.corrections);
  expect(report.segments.at(-1).start).toBe(15);
});
it('normalizes independently and idempotently without changing observations', () => {
  const payload = survey(); payload.records[0].extra = { operator: 'α' };
  const document = createGeophysicsObservations(payload);
  expect(createGeophysicsObservations(JSON.parse(JSON.stringify(document)))).toEqual(document);
  expect(document.records[9].x).toBeNull(); expect(document.records[0].station_id).toBeNull();
  document.records[0].extra.operator = 'changed'; document.metadata.corrections.diurnal = 'unapplied';
  expect(payload.records[0].extra.operator).toBe('α'); expect(payload.metadata.corrections.diurnal).toBe('applied');
  const schema = geophysicsObservationSchema(); schema.properties = {}; expect(geophysicsObservationSchema().properties.records).toBeDefined();
  expect(describeGeophysicsObservationQc().version).toBe(1);
});
it('handles empty/singleton surveys and missing line context', () => {
  const payload = survey(); payload.records = []; expect(qcGeophysicsObservations(payload).state).toBe('ok');
  payload.records = survey().records.slice(0, 1); expect(qcGeophysicsObservations(payload).state).toBe('ok');
  expect(qcGeophysicsObservations(payload, { max_speed: 5 }).state).toBe('needs_input');
  payload.records = survey().records.slice(0, 7); payload.records.forEach((row) => delete row.line_id);
  const report = qcGeophysicsObservations(payload, { max_time_gap: 5, spike_thresholds: { mag: 5 } });
  expect(report.state).toBe('needs_input'); expect(report.edges).toEqual([]); expect(report.segments).toHaveLength(7); expect(report.segments.every((segment) => segment.reason === 'unassigned_line')).toBe(true);
});
it('does not call a monotonic trend a spike or bridge missing readings', () => {
  const payload = survey(); payload.records = payload.records.slice(0, 7); payload.records.forEach((row, index) => { row.values.mag = index * 100; });
  let report = qcGeophysicsObservations(payload, { spike_thresholds: { mag: 1 } });
  expect(report.state).toBe('ok'); expect(report.flags.some((item) => item.code === 'spike_candidate')).toBe(false);
  payload.records[3].values.mag = null; report = qcGeophysicsObservations(payload, { spike_thresholds: { mag: 1 } });
  expect(report.state).toBe('needs_input'); expect(report.coverage.skipped_spike_windows).toBe(3); expect(report.coverage.spike_windows).toBe(0);
});
it.each([[null, null], ['EPSG:4326', null], [null, 'degree'], ['EPSG:28350', 'ft']])('requires usable distance context %s/%s', (crs, crs_units) => {
  const report = qcGeophysicsObservations({ ...survey(), crs, crs_units }, { max_speed: 5 });
  expect(report.state).toBe('needs_input'); expect(report.edges).toEqual([]); expect(report.summary.distance_units).toBeNull();
});
it('uses native foot units and measured clearance with explicit height units', () => {
  const payload = survey(); payload.crs_units = 'ft'; let report = qcGeophysicsObservations(payload, { max_speed: 4 });
  expect(report.summary.distance_units).toBe('ft'); expect(report.edges[0].speed).toBe(5);
  payload.metadata.height_units = 'degree'; expect(qcGeophysicsObservations(payload, { min_clearance: 20 }).state).toBe('needs_input');
  payload.metadata.height_units = 'm'; delete payload.records[0].clearance; report = qcGeophysicsObservations(payload, { min_clearance: 20 });
  expect(report.state).toBe('needs_input'); expect(report.flags.some((item) => item.code === 'missing_clearance')).toBe(true);
});
it('does not equate station identity with colocation/precision', () => {
  const payload = survey(); payload.records[12].x += 1; payload.records[13].values.mag = null;
  const report = qcGeophysicsObservations(payload); expect(report.repeats[0].same_location).toBe(false);
  expect(report.repeats[0].channels.mag.sample_std).toBeCloseTo(Math.sqrt(2), 12);
  expect(report.flags.filter((item) => item.code === 'station_location_mismatch')).toHaveLength(3);
});
it.each([{ typo: 1 }, { max_speed: true }, { max_time_gap: -1 }, { max_speed: NaN }, { spike_window: 4 }, { spike_window: 103 }, { spike_thresholds: { unknown: 1 } }, { spike_thresholds: { mag: 0 } }, { max_speed: '5' }])('structures bad options %o', (options) => {
  expect(qcGeophysicsObservations(survey(), options).state).toBe('rejected');
});
it.each(['future', 'null_schema', 'duplicate_id', 'unknown_channel', 'string_value', 'boolean_x', 'nan', 'bad_correction', 'extra_field', 'bad_units'])('rejects bad observation contract %s', (change) => {
  const payload = survey();
  if (change === 'future') payload.version = 2;
  if (change === 'null_schema') payload.schema = null;
  if (change === 'duplicate_id') payload.records[1].id = payload.records[0].id;
  if (change === 'unknown_channel') payload.records[0].values.bad = 1;
  if (change === 'string_value') payload.records[0].values.mag = '10';
  if (change === 'boolean_x') payload.records[0].x = true;
  if (change === 'nan') payload.records[0].time = NaN;
  if (change === 'bad_correction') payload.metadata.corrections.igrf = 'maybe';
  if (change === 'extra_field') payload.records[0].oops = 1;
  if (change === 'bad_units') payload.channels.mag.units = '';
  expect(qcGeophysicsObservations(payload).state).toBe('rejected'); expect(() => createGeophysicsObservations(payload)).toThrow();
});
it('supports prototype-like channel/station IDs without object collisions', () => {
  const payload = { channels: { constructor: { field_type: 'other', units: 'unit' } }, records: [
    { id: 'a', station_id: '__proto__', x: 1, y: 1, values: { constructor: 1 } },
    { id: 'b', station_id: '__proto__', x: 1, y: 1, values: { constructor: 3 } },
  ] };
  const report = qcGeophysicsObservations(payload); expect(report.state).toBe('ok'); expect(report.repeats[0].channels.constructor.mean).toBe(2);
});

it('rejects resource overflows before expensive work and marks partial flag reports', () => {
  const payload = survey(); payload.records = Array(100001).fill(payload.records[0]);
  expect(qcGeophysicsObservations(payload).state).toBe('rejected');
  const previous = contract.resources.max_flags; const work = contract.resources.max_spike_window_values;
  try {
    contract.resources.max_spike_window_values = 1;
    expect(qcGeophysicsObservations(survey(), reference.options).state).toBe('rejected');
    contract.resources.max_spike_window_values = work; contract.resources.max_flags = 2;
    const report = qcGeophysicsObservations(survey(), reference.options);
    expect(report.state).toBe('rejected'); expect(report.flags_truncated).toBe(true); expect(report.flags).toHaveLength(2);
    expect(report.summary.flags_by_code.high_speed).toBe(6);
  } finally { contract.resources.max_flags = previous; contract.resources.max_spike_window_values = work; }
});
it('structures extreme speed without nonfinite report numbers', () => {
  const payload = survey(); payload.records = payload.records.slice(0, 2); payload.records[1].time = 1e-320;
  const report = qcGeophysicsObservations(payload); expect(report.state).toBe('rejected'); expect(report.edges).toEqual([]);
});

it('retains small readings through cancellation in station means', () => {
  const payload = survey(); payload.records = payload.records.slice(11, 14);
  payload.records.forEach((row, index) => { row.values.mag = [1e16, 1, -1e16][index]; });
  expect(qcGeophysicsObservations(payload).repeats[0].channels.mag.mean).toBeCloseTo(1 / 3, 14);
});

it('does not bridge unknown timestamps when time-gap checks are requested', () => {
  const payload = survey(); payload.records = payload.records.slice(0, 7); delete payload.records[3].time;
  const report = qcGeophysicsObservations(payload, { max_time_gap: 10, spike_thresholds: { mag: 20 } });
  expect(report.state).toBe('needs_input'); expect(report.flags.some((item) => item.id === 'r3' && item.code === 'missing_time')).toBe(true);
  expect(report.coverage.spike_windows).toBe(0); expect(report.segments).toHaveLength(3);
});

it.each(['\ud800', '\udc00', 'a\ud800b'])('rejects unpaired Unicode %o', (value) => {
  const payload = survey(); payload.records[0].id = value;
  expect(qcGeophysicsObservations(payload).state).toBe('rejected');
  const keyPayload = survey(); keyPayload.metadata[value] = 'invalid key';
  expect(qcGeophysicsObservations(keyPayload).state).toBe('rejected');
});
it('preserves valid surrogate pairs/astral characters', () => {
  const payload = survey(); payload.records[0].id = '\ud83d\ude00';
  expect(createGeophysicsObservations(payload).records[0].id).toBe('😀');
});

it('runs sample-window QC for coordinate-free base-station series', () => {
  const payload = survey(); payload.records = payload.records.slice(0, 7); delete payload.crs_units;
  payload.records.forEach((row) => { delete row.x; delete row.y; });
  const report = qcGeophysicsObservations(payload, { spike_thresholds: { mag: 20 } });
  expect(report.state).toBe('ok'); expect(report.flags.filter((item) => item.code === 'spike_candidate').map((item) => item.id)).toEqual(['r3']);
  expect(report.segments).toHaveLength(1);
});
it('deduplicates numeric overflow issues and preserves coverage totals', () => {
  const payload = survey(); payload.records = payload.records.slice(0, 3); payload.records.forEach((row, index) => { row.time = index * 1e-320; });
  const report = qcGeophysicsObservations(payload); expect(report.state).toBe('rejected'); expect(report.issues).toHaveLength(1);
  expect(report.coverage.within_line_edges).toBe(2); expect(report.coverage.speed_edges + report.coverage.skipped_speed_edges).toBe(2);
  expect(report.segments).toHaveLength(3); expect(report.flags.filter((item) => item.code === 'numeric_range')).toHaveLength(2);
});
it.each(['\u001c', '\u001d', '\u001e', '\u001f', '\u0085', '\ufeff', '\u00a0', '\u3000'])('shares blank-string rules for %o', (blank) => {
  for (const kind of ['id', 'crs', 'units']) {
    const payload = survey(); if (kind === 'id') payload.records[0].id = blank; if (kind === 'crs') payload.crs = blank; if (kind === 'units') payload.channels.mag.units = blank;
    expect(qcGeophysicsObservations(payload).state).toBe('rejected');
  }
});
it('uses shared whitespace normalization for declared unit interpretation', () => {
  const payload = survey(); payload.crs_units = '\u0085m\ufeff'; payload.metadata.height_units = '\ufeffm\u0085';
  const report = qcGeophysicsObservations(payload, { min_clearance: 20 });
  expect(report.state).toBe('ok'); expect(report.summary.distance_units).toBe('m'); expect(report.flags.some((item) => item.code === 'low_clearance')).toBe(true);
});

it('canonicalizes signed zeros in copied data/options without changing originals', () => {
  const payload = survey(); payload.records = payload.records.slice(0, 1);
  for (const key of ['x', 'y', 'z', 'time', 'clearance']) payload.records[0][key] = -0;
  payload.records[0].values.mag = -0; payload.records[0].extra = { raw_zero: -0 };
  const normalized = createGeophysicsObservations(payload);
  for (const key of ['x', 'y', 'z', 'time', 'clearance']) expect(Object.is(normalized.records[0][key], 0)).toBe(true);
  expect(Object.is(normalized.records[0].values.mag, 0)).toBe(true); expect(Object.is(normalized.records[0].extra.raw_zero, 0)).toBe(true);
  expect(Object.is(qcGeophysicsObservations(payload, { min_clearance: -0 }).parameters.min_clearance, 0)).toBe(true);
  expect(Object.is(payload.records[0].x, -0)).toBe(true);
});

it('uses QC-specific contract messages for non-JSON options', () => {
  const options = { spike_thresholds: {} }; options.spike_thresholds.cycle = options;
  for (const invalid of [{ max_speed: NaN }, options]) {
    const report = qcGeophysicsObservations(survey(), invalid); expect(report.state).toBe('rejected');
    expect(report.issues[0].message).toBe('QC options require finite acyclic JSON');
  }
});
