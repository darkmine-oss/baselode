/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it } from 'vitest';
import reference from '../../../../test/data/geophysics_lag_reference.json';
import { correctGeophysicsMagneticLag, inspectGeophysicsCorrections, correctGeophysicsMagneticBase } from '../src/data/geophysicsCorrections.js';
import { appendInput, encodeProvenance } from '../src/data/geophysicsProvenance.js';
const fixture = () => JSON.parse(JSON.stringify(reference));
async function corrected() { const f = fixture(); const r = await correctGeophysicsMagneticLag(f.survey, f.options); expect(r.state, JSON.stringify(r.issues)).toBe('ok'); return r.observations; }
function simple(times, values, lines = []) { const f = fixture().survey; f.records = times.map((t, i) => ({ id: String(i), time: t, line_id: lines[i] ?? 'L', values: { mag: values[i] } })); return f; }
it.each(['positive', 'negative'])('matches independent %s affine shift and preserves source', async (sign) => {
  const f = fixture(); if (sign === 'negative') f.options.lag_seconds *= -1; const before = JSON.stringify(f);
  const r = await correctGeophysicsMagneticLag(f.survey, f.options);
  expect(r.state, JSON.stringify(r.issues)).toBe('ok'); expect(r.observations.records.map((row) => row.values.mag)).toEqual(f[`expected_${sign}`]);
  expect(r.ledger.entries.at(-1).masked_records).toEqual(f[`expected_${sign}_masked`]); expect(JSON.stringify(f)).toBe(before);
  for (const [i, row] of r.observations.records.entries()) {
    for (const key of ['id', 'time', 'x', 'y', 'z', 'line_id', 'extra']) expect(row[key]).toEqual(f.survey.records[i][key]);
    expect(row.values.other).toBe(f.survey.records[i].values.other);
  }
  expect(r.states.magnetic_lag).toEqual({ mag: 'applied', other: 'unapplied' });
  expect((await inspectGeophysicsCorrections(r.observations)).state).toBe('ok');
});
it('advances an integer pulse without in-place source contamination', async () => {
  const r = await correctGeophysicsMagneticLag(simple([0, 1, 2, 3, 4], [0, 0, 10, 0, 0]), { ...fixture().options, lag_seconds: 1 });
  expect(r.state).toBe('ok'); expect(r.observations.records.map((row) => row.values.mag)).toEqual([0, 10, 0, 0, null]);
});
it('supports exact zero-shift samples, retaining null target readings', async () => {
  const r = await correctGeophysicsMagneticLag(simple([0, 1, 3], [1, null, 9]), { ...fixture().options, lag_seconds: 0, unsupported_policy: 'reject', max_gap: .1 });
  expect(r.state).toBe('ok'); expect(r.observations.records.map((row) => row.values.mag)).toEqual([1, null, 9]); expect(r.ledger.entries.at(-1).masked_records).toEqual([]);
});
it('rejects incomplete coverage atomically with useful proposals', async () => {
  const f = fixture(); const r = await correctGeophysicsMagneticLag(f.survey, { ...f.options, unsupported_policy: 'reject' });
  expect(r.state).toBe('needs_input'); expect(r.observations).toBeNull(); expect(r.ledger).toBeNull(); expect(r.proposals.at(-1).reason).toBe('outside_segment');
});
it('never joins a reused line ID across a line transition', async () => {
  const data = simple([0, 1, 2, 2, 3, 4, 2, 3, 4], [0, 1, 2, 100, 101, 102, 200, 201, 202], ['A', 'A', 'A', 'B', 'B', 'B', 'A', 'A', 'A']);
  const r = await correctGeophysicsMagneticLag(data, { ...fixture().options, lag_seconds: 1 });
  expect(r.state).toBe('ok'); expect(r.observations.records.map((row) => row.values.mag)).toEqual([1, 2, null, 101, 102, null, 201, 202, null]); expect(r.diagnostics.segments).toBe(3);
});
it('does not bridge null source readings or excessive gaps', async () => {
  let r = await correctGeophysicsMagneticLag(simple([0, 1, 2, 3, 4], [0, null, 20, 30, 40]), fixture().options);
  expect(r.state).toBe('ok'); expect(r.observations.records.map((row) => row.values.mag)).toEqual([null, null, 25, 35, null]); expect(r.proposals[0].reason).toBe('missing_source_reading');
  r = await correctGeophysicsMagneticLag(simple([0, 1, 5, 6], [0, 1, 5, 6]), { ...fixture().options, max_gap: 1 });
  expect(r.state).toBe('ok'); expect(r.observations.records.map((row) => row.values.mag)).toEqual([.5, null, 5.5, null]); expect(r.proposals[1].reason).toBe('excessive_gap');
});
it.each(['time', 'line', 'duplicate_time', 'reverse_time', 'unknown', 'applied', 'units', 'empty', 'no_support', 'precision'])('refuses %s without output', async (change) => {
  const f = fixture();
  if (change === 'time') f.survey.records[1].time = null;
  if (change === 'line') f.survey.records[1].line_id = null;
  if (change === 'duplicate_time') f.survey.records[1].time = 0;
  if (change === 'reverse_time') f.survey.records.reverse();
  if (change === 'unknown') f.survey.metadata.corrections = {};
  if (change === 'applied') f.survey.metadata.corrections.lag = 'applied';
  if (change === 'units') f.survey.channels.mag.units = 'T';
  if (change === 'empty') for (const row of f.survey.records) row.values.mag = null;
  if (change === 'no_support') f.options.lag_seconds = 100;
  if (change === 'precision') { f.survey.records.forEach((row, i) => { row.time = 2 ** 60 + i * 256; }); f.options.lag_seconds = .1; }
  const before = JSON.stringify(f); const r = await correctGeophysicsMagneticLag(f.survey, f.options);
  expect(['needs_input', 'rejected']).toContain(r.state); expect(r.observations).toBeNull(); expect(r.ledger).toBeNull(); expect(JSON.stringify(f)).toBe(before);
});
it.each([['lag_seconds', 3601], ['lag_seconds', NaN], ['lag_seconds', true], ['max_gap', 0], ['unsupported_policy', 'guess'], ['clock_policy', 'local'], ['channel', 'unknown'], ['event_id', ''], ['extra', true]])('requires valid option %s', async (key, value) => {
  const f = fixture(); const r = await correctGeophysicsMagneticLag(f.survey, { ...f.options, [key]: value }); expect(['needs_input', 'rejected']).toContain(r.state); expect(r.observations).toBeNull();
});
it('requires every option and bounds lag workload', async () => {
  const f = fixture();
  for (const key of Object.keys(f.options)) { const params = { ...f.options }; delete params[key]; expect((await correctGeophysicsMagneticLag(f.survey, params)).state).toBe('needs_input'); }
  const data = simple(Array.from({ length: 4097 }, (_, i) => i), Array(4097).fill(1)); const r = await correctGeophysicsMagneticLag(data, f.options); expect(r.state).toBe('rejected'); expect(r.issues[0].code).toBe('resource');
});
it('guards repeat application, stale bindings, missing ledger and corrupted masks', async () => {
  const out = await corrected(); expect((await correctGeophysicsMagneticLag(out, { ...fixture().options, event_id: 'again' })).state).toBe('rejected');
  for (const change of ['value', 'drop', 'count', 'mask', 'duplicate_mask', 'unknown_mask', 'policy']) {
    const bad = JSON.parse(JSON.stringify(out)); const entry = bad.metadata.correction_ledger.entries.at(-1);
    if (change === 'value') bad.records[0].values.mag += 1;
    if (change === 'drop') delete bad.metadata.correction_ledger;
    if (change === 'count') entry.affected_records -= 1;
    if (change === 'mask') entry.masked_records[0].id = 'r0';
    if (change === 'duplicate_mask') entry.masked_records.push({ ...entry.masked_records[0] });
    if (change === 'unknown_mask') entry.masked_records[0].id = 'absent';
    if (change === 'policy') entry.parameters.unsupported_policy = 'reject';
    expect((await inspectGeophysicsCorrections(bad)).state, change).toBe('rejected');
  }
});
it('preserves uncertainty only in standard remappable source lineage', async () => {
  const out = await corrected(); const step = out.metadata.processing.at(-1);
  for (const name of ['uncertainty', 'variance', 'standard_deviation']) { expect(Object.hasOwn(out.metadata, name)).toBe(false); expect(out.metadata.input_lineage[step.operand_lineage].metadata[name]).toEqual(fixture().survey.metadata[name]); }
  const { nodes, operand } = appendInput({ source: 'foreign.xyz' }, out.metadata); const moved = nodes[operand].metadata.processing.at(-1);
  expect(nodes[moved.operand_lineage].metadata.source).toBe('lag-test.xyz'); expect(encodeProvenance({ input_lineage: nodes }, 'GeoTIFF', 'float64')).toBeTruthy();
});
it('keeps historical counts valid when a later lag mask follows base correction', async () => {
  const f = fixture(); f.survey.metadata.corrections.diurnal = 'unapplied';
  const base = { channels: { base: { field_type: 'magnetic_total_field', units: 'nT' } }, records: [0, 1, 3, 6, 7].map((time, i) => ({ id: String(i), time, station_id: 'BASE', values: { base: 101 } })), metadata: { corrections: { diurnal: 'unapplied' } } };
  const opts = { channel: 'mag', base_channel: 'base', reference: 100, max_gap: 1, event_id: 'base-1', evidence: 'constant synthetic monitor', clock_policy: 'synchronized' };
  const first = await correctGeophysicsMagneticBase(f.survey, base, opts); const r = await correctGeophysicsMagneticLag(first.observations, f.options);
  expect(r.state, JSON.stringify(r.issues)).toBe('ok'); expect(r.ledger.entries.filter((e) => e.kind === 'application').map((e) => e.affected_records)).toEqual([5, 5]); expect((await inspectGeophysicsCorrections(r.observations)).state).toBe('ok');
});
