/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import reference from '../../../../test/data/geophysics_corrections_reference.json';
import { describeGeophysicsCorrections, inspectGeophysicsCorrections, declareGeophysicsCorrections, correctGeophysicsMagneticBase } from '../src/data/geophysicsCorrections.js';
import { gridGeophysicsObservations } from '../src/data/geophysicsGridding.js';
import { encodeErs, encodeGeoTiff } from '../src/data/geophysicsWriters.js';
import { readErs } from '../src/data/ersLoader.js';
import { loadGeoTiff } from '../src/data/geophysicsRaster.js';
import { appendInput, encodeProvenance } from '../src/data/geophysicsProvenance.js';
const fixture = () => JSON.parse(JSON.stringify(reference));
const declaration = (changes = {}) => ({ id: 'source-history', correction: 'magnetic_diurnal', channels: ['mag'], state: 'unapplied', evidence: 'Contractor source record checked', ...changes });
async function corrected() { const item = fixture(); const result = await correctGeophysicsMagneticBase(item.survey, item.base, item.options); expect(result.state, JSON.stringify(result.issues)).toBe('ok'); return result.observations; }
it('recovers independent base variation and matches portable SHA-256 fixture', async () => {
  const item = fixture(); const before = JSON.stringify(item); const result = await correctGeophysicsMagneticBase(item.survey, item.base, item.options);
  expect(result.state).toBe('ok'); expect(result.observations.records.map((row) => row.values.mag)).toEqual(item.expected_values);
  expect(result.proposals.map((row) => row.base_value)).toEqual(item.expected_base);
  expect(result.observations.metadata.correction_ledger.initial_binding).toBe(item.expected_input_binding);
  expect(result.observations.metadata.correction_ledger.current_binding).toBe(item.expected_output_binding);
  expect(result.observations.metadata.correction_ledger.entries.at(-1).base_binding).toBe(item.expected_base_binding);
  expect(result.states.magnetic_diurnal).toEqual({ mag: 'applied', second: 'unapplied' });
  expect(result.observations.metadata.corrections.diurnal).toBe('unknown'); expect(JSON.stringify(item)).toBe(before);
  expect((await inspectGeophysicsCorrections(result.observations)).state).toBe('ok');
});
it('requires evidence-backed unapplied state and rejects resetting known history', async () => {
  const item = fixture(); delete item.survey.metadata.corrections;
  expect((await inspectGeophysicsCorrections(item.survey)).states.magnetic_diurnal.mag).toBe('unknown');
  expect((await correctGeophysicsMagneticBase(item.survey, item.base, item.options)).state).toBe('needs_input');
  const declared = await declareGeophysicsCorrections(item.survey, [declaration()]); expect(declared.state).toBe('ok');
  const applied = await correctGeophysicsMagneticBase(declared.observations, item.base, item.options); expect(applied.state).toBe('ok');
  expect((await declareGeophysicsCorrections(applied.observations, [declaration({ id: 'reset' })])).state).toBe('rejected');
});
it('guards applications per channel, event IDs and synchronized legacy aggregates', async () => {
  const item = fixture(); const output = await corrected();
  expect((await correctGeophysicsMagneticBase(output, item.base, { ...item.options, event_id: 'repeat' })).state).toBe('rejected');
  expect((await correctGeophysicsMagneticBase(output, item.base, { ...item.options, channel: 'second' })).state).toBe('rejected');
  const second = await correctGeophysicsMagneticBase(output, item.base, { ...item.options, channel: 'second', event_id: 'apply-second' });
  expect(second.state).toBe('ok'); expect(second.observations.records.map((row) => row.values.second)).toEqual(Array(5).fill(200));
  expect(second.observations.metadata.corrections.diurnal).toBe('applied');
});
it.each(['diurnal', 'BASE-STATION', 'base_station_correction', 'magnetic_diurnal', 'diurnal_correction'])('blocks legacy applied alias %s', async (alias) => {
  const item = fixture(); item.survey.metadata.corrections = { [alias]: 'applied' };
  expect((await correctGeophysicsMagneticBase(item.survey, item.base, item.options)).state).toBe('rejected');
});
it('rejects conflicting aliases and inconsistent scalar summary', async () => {
  const item = fixture(); item.survey.metadata.corrections.base_station = 'applied';
  expect((await inspectGeophysicsCorrections(item.survey)).state).toBe('rejected');
  const output = await corrected(); output.metadata.corrections.diurnal = 'unapplied';
  expect((await inspectGeophysicsCorrections(output)).state).toBe('rejected');
});
it.each(['value', 'time', 'geometry', 'order', 'units', 'add', 'drop'])('detects stale %s binding', async (change) => {
  const output = await corrected();
  if (change === 'value') output.records[0].values.mag += 1;
  if (change === 'time') output.records[0].time += 1;
  if (change === 'geometry') output.records[0].x += 1;
  if (change === 'order') output.records.reverse();
  if (change === 'units') output.channels.mag.units = 'T';
  if (change === 'add') output.records.push({ ...output.records[0], id: 'new' });
  if (change === 'drop') output.records.pop();
  expect((await inspectGeophysicsCorrections(output)).state).toBe('rejected');
});
it('requires complete support and never interpolates through nulls or excessive gaps', async () => {
  const item = fixture(); const before = JSON.stringify(item);
  const result = await correctGeophysicsMagneticBase(item.survey, item.base, { ...item.options, max_gap: 9 });
  expect(result.state).toBe('needs_input'); expect(result.observations).toBeNull(); expect(result.proposals.map((row) => row.supported)).toEqual([true, false, true, false, true]); expect(JSON.stringify(item)).toBe(before);
  item.base.records[1].values.base = null;
  const gaps = await correctGeophysicsMagneticBase(item.survey, item.base, item.options);
  expect(gaps.state).toBe('needs_input'); expect(gaps.proposals.map((row) => row.supported)).toEqual([true, false, false, false, true]);
});
it('never extrapolates and retains null survey readings', async () => {
  const item = fixture(); item.survey.records[0].time = -1;
  expect((await correctGeophysicsMagneticBase(item.survey, item.base, item.options)).proposals[0].reason).toBe('outside_base_span');
  item.survey.records[0].time = null;
  expect((await correctGeophysicsMagneticBase(item.survey, item.base, item.options)).proposals[0].reason).toBe('missing_time');
  item.survey.records[0].values.mag = null;
  const result = await correctGeophysicsMagneticBase(item.survey, item.base, item.options);
  expect(result.state).toBe('ok'); expect(result.observations.records[0].values.mag).toBeNull();
});
it('preserves acquisition order and explicit reference level', async () => {
  const item = fixture(); item.survey.records.reverse();
  const result = await correctGeophysicsMagneticBase(item.survey, item.base, { ...item.options, reference: 50010 });
  expect(result.state).toBe('ok'); expect(result.observations.records.map((row) => row.id)).toEqual(item.survey.records.map((row) => row.id));
  expect(result.observations.records.map((row) => row.values.mag)).toEqual([...item.expected_values].reverse().map((value) => value + 10));
});
it.each(['duplicate_time', 'reverse_time', 'missing_station', 'mixed_station', 'moving_x', 'moving_z', 'units', 'field_type'])('rejects invalid base %s', async (change) => {
  const item = fixture(); const rows = item.base.records;
  if (change === 'duplicate_time') rows[1].time = 0;
  if (change === 'reverse_time') rows.reverse();
  if (change === 'missing_station') rows[0].station_id = null;
  if (change === 'mixed_station') rows[0].station_id = 'other';
  if (change === 'moving_x') { rows[0].x = 1; rows[1].x = 2; }
  if (change === 'moving_z') { rows[0].z = 1; rows[1].z = 2; }
  if (change === 'units') item.base.channels.base.units = 'T';
  if (change === 'field_type') item.base.channels.base.field_type = 'radiometric';
  const result = await correctGeophysicsMagneticBase(item.survey, item.base, item.options);
  expect(result.state).toBe('rejected'); expect(result.observations).toBeNull();
});
it('rejects malformed events and unknown declarations before deriving channel states', async () => {
  for (const change of ['correction', 'chain', 'producer', 'count', 'extra']) {
    const output = await corrected(); const entry = output.metadata.correction_ledger.entries.at(-1);
    if (change === 'correction') entry.correction = 'custom';
    if (change === 'chain') entry.input_binding = '0'.repeat(64);
    if (change === 'producer') entry.producer.algorithm_version = true;
    if (change === 'count') entry.affected_records = 1;
    if (change === 'extra') entry.override = true;
    expect((await inspectGeophysicsCorrections(output)).state).toBe('rejected');
  }
  expect((await declareGeophysicsCorrections(fixture().survey, [declaration({ correction: 'custom' })])).state).toBe('rejected');
});
it('enforces option, event and numeric bounds', async () => {
  const item = fixture(); item.survey.records[0].values.mag = 1e101;
  expect((await inspectGeophysicsCorrections(item.survey)).state).toBe('rejected');
  const fresh = fixture();
  expect((await correctGeophysicsMagneticBase(fresh.survey, fresh.base, { ...fresh.options, clock_policy: 'guess' })).state).toBe('needs_input');
  expect((await correctGeophysicsMagneticBase(fresh.survey, fresh.base, { ...fresh.options, override: true })).state).toBe('rejected');
  expect((await declareGeophysicsCorrections(fresh.survey, Array.from({ length: 65 }, (_, index) => declaration({ id: String(index) })))).issues[0].code).toBe('resource');
});
it('persists corrected observation history through gridding and both formats', async () => {
  const item = fixture(); item.survey.metadata.uncertainty = { mag: 1 };
  const result = await correctGeophysicsMagneticBase(item.survey, item.base, item.options); const output = result.observations;
  expect(output.metadata.uncertainty).toBeUndefined(); expect(output.metadata.uncertainty_propagated).toBe(false);
  const step = output.metadata.processing.at(-2);
  expect(step.operation).toBe('magnetic_base_input');
  expect(output.metadata.input_lineage[step.operand_lineage].metadata.uncertainty).toEqual({ mag: 1 });
  const grid = gridGeophysicsObservations(output, { channels: ['mag'], radius: 100, duplicate_policy: 'mean', elevation_policy: 'ignore', bounds: [0, -5, 40, 5], shape: [1, 4], extrapolation: 'allow' });
  expect(grid.state).toBe('ok'); const raster = grid.artifacts.grid; const ers = encodeErs(raster, { dtype: 'float64' });
  for (const back of [readErs(ers.header, ers.data), await loadGeoTiff(encodeGeoTiff(raster, { dtype: 'float64' }))]) expect(back.metadata.observation_metadata.correction_ledger).toEqual(output.metadata.correction_ledger);
});
it('copies the shared descriptor and canonicalizes Unicode and signed zero', async () => {
  const descriptor = describeGeophysicsCorrections();
  expect(descriptor).toEqual(JSON.parse(readFileSync(new URL('../../../../python/src/baselode/geophysics/geophysics_corrections.json', import.meta.url), 'utf8')));
  descriptor.resources.max_events = 0; expect(describeGeophysicsCorrections().resources.max_events).toBe(64);
  const item = fixture(); item.survey.records[0].id = 'é😀'; item.survey.records[0].x = -0;
  const first = await inspectGeophysicsCorrections(item.survey); item.survey.records[0].x = 0;
  expect(first.ledger.current_binding).toBe((await inspectGeophysicsCorrections(item.survey)).ledger.current_binding);
});

it('requires known unapplied base history and validates existing base bindings', async () => {
  const item = fixture(); item.base.metadata.corrections = {};
  expect((await correctGeophysicsMagneticBase(item.survey, item.base, item.options)).state).toBe('needs_input');
  item.base.metadata.corrections = { diurnal: 'applied' };
  expect((await correctGeophysicsMagneticBase(item.survey, item.base, item.options)).state).toBe('rejected');
  const fresh = fixture(); const declared = await declareGeophysicsCorrections(fresh.base, [declaration({ channels: ['base'], id: 'base-qc' })]);
  expect(declared.state).toBe('ok'); declared.observations.records[0].values.base += 1;
  expect((await correctGeophysicsMagneticBase(fresh.survey, declared.observations, fresh.options)).state).toBe('rejected');
});
it('reports missing native Web Crypto as actionable context', async () => {
  vi.stubGlobal('crypto', undefined);
  try { const result = await inspectGeophysicsCorrections(fixture().survey); expect(result.state).toBe('needs_input'); expect(result.issues[0].message).toContain('Web Crypto'); }
  finally { vi.unstubAllGlobals(); }
});

it('rejects dropped ledgers when processing still records the correction', async () => {
  const item = fixture(); const output = await corrected(); delete output.metadata.correction_ledger;
  expect((await inspectGeophysicsCorrections(output)).state).toBe('rejected');
  expect((await declareGeophysicsCorrections(output, [declaration({ id: 'claim-raw' })])).state).toBe('rejected');
  expect((await correctGeophysicsMagneticBase(output, item.base, item.options)).state).toBe('rejected');
});
it('classifies corrupt stored application options as contract violations', async () => {
  for (const change of ['missing', 'clock']) {
    const output = await corrected(); const params = output.metadata.correction_ledger.entries.at(-1).parameters;
    if (change === 'missing') delete params.reference; else params.clock_policy = 'guess';
    const result = await inspectGeophysicsCorrections(output);
    expect(result.state).toBe('rejected'); expect(result.issues[0].code).toBe('contract');
  }
});
it('preserves unrelated large binary64 values during correction and inspection', async () => {
  const item = fixture(); item.survey.records[0].clearance = 1e90; item.survey.records[0].values.second = 2 ** 60;
  const result = await correctGeophysicsMagneticBase(item.survey, item.base, item.options);
  expect(result.state).toBe('ok'); expect(result.observations.records[0].clearance).toBe(1e90);
  expect(result.observations.records[0].values.second).toBe(2 ** 60);
  expect((await inspectGeophysicsCorrections(result.observations)).state).toBe('ok');
});

it('remaps and validates both source and base references through foreign graphs', async () => {
  const item = fixture(); item.survey.metadata.uncertainty = { mag: 1 };
  const output = (await correctGeophysicsMagneticBase(item.survey, item.base, item.options)).observations;
  const left = { input_lineage: [{ metadata: { source: 'unrelated.xyz' }, sources: ['unrelated.xyz'] }] };
  const { nodes, operand } = appendInput(left, output.metadata);
  const sourceStep = nodes[operand].metadata.processing.at(-2); const baseStep = nodes[operand].metadata.processing.at(-1);
  expect(sourceStep.operation).toBe('magnetic_base_input');
  expect(sourceStep.operand_lineage).not.toBe(0);
  expect(nodes[sourceStep.operand_lineage].metadata.uncertainty).toEqual({ mag: 1 });
  expect(nodes[baseStep.operand_lineage].metadata.source).toBe('base.xyz');
  expect(() => encodeProvenance({ input_lineage: nodes }, 'GeoTIFF', 'float64')).not.toThrow();
  nodes[operand].metadata.processing.at(-2).operand_lineage = -1;
  expect(() => encodeProvenance({ input_lineage: nodes }, 'GeoTIFF', 'float64')).toThrow('operand_lineage');
});
it('uses compact UTF-8 option bytes at the exact transport boundary', async () => {
  const limit = 256 * 1024; const items = Array.from({ length: 63 }, (_, index) => declaration({ id: `edge-${index}`, evidence: 'x'.repeat(4096) }));
  const size = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
  let remaining = size(items) - (limit - 1); expect(remaining).toBeGreaterThan(0);
  for (const item of items) { const removed = Math.min(remaining, item.evidence.length - 1); if (removed) item.evidence = item.evidence.slice(0, -removed); remaining -= removed; }
  expect(size(items)).toBe(limit - 1);
  expect((await declareGeophysicsCorrections(fixture().survey, items)).state).toBe('ok');
  items[0].evidence += 'xx'; const result = await declareGeophysicsCorrections(fixture().survey, items);
  expect(result.state).toBe('rejected'); expect(result.issues[0].code).toBe('resource');
});
