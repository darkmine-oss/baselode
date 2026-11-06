/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it } from 'vitest';
import reference from '../../../../test/data/geophysics_gridding_reference.json';
import { describeGeophysicsGridding, gridGeophysicsObservations, crossValidateGeophysicsGridding } from '../src/data/geophysicsGridding.js';
import { encodeErs, encodeGeoTiff } from '../src/data/geophysicsWriters.js';
import { readErs } from '../src/data/ersLoader.js';
import { loadGeoTiff } from '../src/data/geophysicsRaster.js';
const observations = (points = [[0, 0, 0], [2, 0, 4], [0, 2, 2], [2, 2, 6]]) => ({
  channels: { mag: { field_type: 'magnetic_anomaly', units: 'nT' } }, crs_units: 'm',
  records: points.map(([x, y, value], index) => ({ id: `r${index}`, x, y, values: { mag: value } })), metadata: { corrections: { igrf: 'applied' } },
});
const interpolation = (changes = {}) => ({ channels: ['mag'], radius: 10, duplicate_policy: 'mean', elevation_policy: 'ignore', ...changes });
const options = (changes = {}) => ({ ...interpolation(), bounds: [0, 0, 2, 2], shape: [1, 1], ...changes });
function close(actual, expected) {
  if (typeof expected === 'number') expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-10 * Math.max(1, Math.abs(expected)));
  else if (Array.isArray(expected)) { expect(actual).toHaveLength(expected.length); expected.forEach((value, index) => close(actual[index], value)); }
  else if (expected && typeof expected === 'object') { expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort()); Object.entries(expected).forEach(([key, value]) => close(actual[key], value)); }
  else expect(actual).toEqual(expected);
}
it('matches shared Python gridding artifacts and validation reports', () => {
  const result = gridGeophysicsObservations(reference.input, reference.options); expect(result.state).toBe('ok');
  for (const [key, expected] of Object.entries(reference.artifacts)) close(result.artifacts[key].data, expected);
  const { producer, ...validation } = crossValidateGeophysicsGridding(reference.validation_input, interpolation(), { by: 'line' });
  close(validation, reference.validation); expect(producer.algorithm_version).toBe(1);
  const descriptor = describeGeophysicsGridding(); descriptor.resources.max_folds = 0; expect(describeGeophysicsGridding().resources.max_folds).toBe(64);
});
it('recovers independent symmetric IDW and first-location nearest ties', () => {
  const result = gridGeophysicsObservations(observations(), options()); expect(result.state).toBe('ok');
  expect(result.artifacts.grid.data[0][0][0]).toBe(3); expect(result.artifacts.support.data[0][0][0]).toBe(1);
  expect(result.artifacts.neighbor_count.data[0][0][0]).toBe(4); expect(result.artifacts.nearest_distance.data[0][0][0]).toBeCloseTo(Math.sqrt(2), 12);
  expect(result.artifacts.grid.transform).toEqual([2, 0, 0, 0, -2, 2]);
  expect(gridGeophysicsObservations(observations(), options({ method: 'nearest' })).artifacts.grid.data[0][0][0]).toBe(0);
  const linear = gridGeophysicsObservations(observations([[0, 0, 0], [2, 0, 10]]), options({ bounds: [0, -0.5, 1, 0.5] }));
  expect(linear.artifacts.grid.data[0][0][0]).toBeCloseTo(1, 12);
});
it('masks radius gaps and extrapolation and enforces minimum support even at samples', () => {
  const gap = gridGeophysicsObservations(observations(), options({ radius: 1 }));
  expect(gap.artifacts.grid.data[0][0][0]).toBeNull(); expect(gap.artifacts.support.data[0][0][0]).toBe(0);
  expect(gap.artifacts.neighbor_count.data[0][0][0]).toBe(0); expect(gap.artifacts.nearest_distance.data[0][0][0]).toBeCloseTo(Math.sqrt(2), 12);
  expect(gap.artifacts.extrapolation.data[0][0][0]).toBe(0);
  const outside = gridGeophysicsObservations(observations(), options({ bounds: [2, 2, 4, 4] }));
  expect(outside.artifacts.support.data[0][0][0]).toBe(0); expect(outside.artifacts.extrapolation.data[0][0][0]).toBe(1);
  expect(gridGeophysicsObservations(observations(), options({ bounds: [2, 2, 4, 4], extrapolation: 'allow' })).artifacts.support.data[0][0][0]).toBe(1);
  expect(gridGeophysicsObservations(observations([[0, 0, 7]]), options({ bounds: [-0.5, -0.5, 0.5, 0.5], min_neighbors: 2 })).artifacts.support.data[0][0][0]).toBe(0);
});
it('groups duplicates explicitly and includes the exact support radius', () => {
  const payload = observations([[0, 0, 2], [0, 0, 4]]);
  const result = gridGeophysicsObservations(payload, options({ bounds: [-0.5, -0.5, 0.5, 0.5] }));
  expect(result.artifacts.grid.data[0][0][0]).toBe(3); expect(result.artifacts.neighbor_count.data[0][0][0]).toBe(1);
  expect(gridGeophysicsObservations(payload, options({ duplicate_policy: 'reject' })).state).toBe('rejected');
  expect(gridGeophysicsObservations(observations([[0, 0, 7]]), options({ bounds: [2.5, 3.5, 3.5, 4.5], radius: 5, extrapolation: 'allow' })).artifacts.grid.data[0][0][0]).toBe(7);
});
it('preserves inputs and exposes per-channel support with missing observations', () => {
  const payload = observations(); payload.channels.aux = { field_type: 'magnetic_anomaly', units: 'nT' }; payload.records[0].values.aux = 8;
  payload.records.push({ id: 'missingXY', x: null, y: 1, values: { mag: 999 } }); const before = structuredClone(payload);
  const result = gridGeophysicsObservations(payload, options({ channels: ['mag', 'aux'] })); expect(result.state).toBe('ok'); expect(payload).toEqual(before);
  expect(result.artifacts.support.data.map((band) => band[0][0])).toEqual([1, 0]);
  expect(result.artifacts.neighbor_count.data.map((band) => band[0][0])).toEqual([4, 1]); expect(result.diagnostics.skipped_records).toBe(1);
  result.artifacts.grid.metadata.corrections.igrf = 'unknown'; expect(payload.metadata.corrections.igrf).toBe('applied');
});
it('retains export/import lineage, units and correction declarations with sanitized sources', async () => {
  const payload = observations(); payload.crs = 'EPSG:28350'; payload.metadata.source = 'https://user:secret@example.com/survey?token=private';
  const result = gridGeophysicsObservations(payload, options()); const encoded = encodeErs(result.artifacts.grid, { dtype: 'float64' });
  for (const back of [readErs(encoded.header, encoded.data), await loadGeoTiff(encodeGeoTiff(result.artifacts.grid, { dtype: 'float64' }))]) {
    expect(back.metadata.units).toEqual(['nT']); expect(back.metadata.field_type).toBe('magnetic_anomaly'); expect(back.metadata.corrections.igrf).toBe('applied');
    expect(back.metadata.processing.at(-1).operation).toBe('grid_observations'); expect(back.metadata.baselode_provenance.sources).toEqual(['https://example.com/survey']);
    expect(JSON.stringify(back.metadata.baselode_provenance)).not.toMatch(/secret|token=/);
  }
});
it('requires elevation acknowledgement and handles tiny coordinate geometry', () => {
  const payload = observations(); payload.records.forEach((row, index) => { row.z = index * 10; });
  const missing = options(); delete missing.elevation_policy; expect(gridGeophysicsObservations(payload, missing).state).toBe('needs_input');
  expect(gridGeophysicsObservations(payload, options()).diagnostics.elevation).toEqual({ policy: 'ignore', known: 4, missing: 0, min: 0, max: 30 });
  payload.records.forEach((row) => { row.x *= 1e-200; row.y *= 1e-200; });
  expect(gridGeophysicsObservations(payload, options({ bounds: [0, 0, 2e-200, 2e-200] })).artifacts.grid.data[0][0][0]).toBe(3);
});
it('detects a known held-out line offset and exposes unsupported outer folds', () => {
  const payload = structuredClone(reference.validation_input); const before = structuredClone(payload);
  const result = crossValidateGeophysicsGridding(payload, interpolation(), { by: 'line' }); expect(result.state).toBe('ok'); expect(payload).toEqual(before);
  const centre = result.folds.find((fold) => fold.group === 'L0'); close(centre.metrics.mag, { tested: 3, supported: 3, unsupported: 0, coverage: 1, rmse: 10, mae: 10, bias: -10 });
  expect(result.summary.mag.coverage).toBeCloseTo(1 / 3, 12); expect(result.summary.mag.unsupported).toBe(6);
  const buffered = crossValidateGeophysicsGridding(payload, interpolation(), { by: 'line', buffer_distance: 1 }).folds.find((fold) => fold.group === 'L0');
  expect(buffered.train_records).toBe(0); expect(buffered.excluded_buffer_records).toBe(6); expect(buffered.metrics.mag.rmse).toBeNull();
});
it('never leaks held-out duplicate positions into training', () => {
  const payload = observations([]); payload.records = ['A', 'B'].flatMap((line) => [0, 1].map((x) => ({ id: `${line}${x}`, line_id: line, x, y: 0, values: { mag: line === 'A' ? 1 : 1000 } })));
  const result = crossValidateGeophysicsGridding(payload, interpolation({ duplicate_policy: 'reject', extrapolation: 'allow' }), { by: 'line' }); expect(result.state).toBe('ok');
  expect(result.folds.every((fold) => fold.train_records === 0 && fold.excluded_buffer_records === 2)).toBe(true); expect(result.summary.mag.supported).toBe(0); expect(result.summary.mag.rmse).toBeNull();
});
it('uses explicit-origin block floors for negative coordinates and constant-field scores', () => {
  const payload = observations([[-1, -1, 7], [1, 1, 7], [3, 1, 7]]);
  const result = crossValidateGeophysicsGridding(payload, interpolation({ extrapolation: 'allow' }), { by: 'block', block_size: [2, 2], origin: [0, 0] });
  expect(result.state).toBe('ok'); expect(result.folds.map((fold) => fold.group)).toEqual(['-1:-1', '0:0', '1:0']); expect(result.summary.mag.rmse).toBeCloseTo(0, 12);
  expect(crossValidateGeophysicsGridding(payload, interpolation(), { by: 'block', block_size: [2, 2] }).state).toBe('needs_input');
});
it.each([{ radius: 0 }, { radius: '10' }, { power: true }, { shape: [0, 1] }, { shape: [1.5, 1] }, { neighbors: 0 }, { min_neighbors: 9, neighbors: 8 }, { bounds: [1, 0, 0, 2] }, { method: 'kriging' }, { channels: ['unknown'] }, { channels: ['mag', 'mag'] }, { target_height: 100 }, { radius: NaN }])('preflights invalid options %o', (changes) => {
  const result = gridGeophysicsObservations(observations(), options(changes)); expect(result.state).toBe('rejected'); expect(result.artifacts).toEqual({});
});
it('guards coordinate context, absent readings, grid size and validation work', () => {
  const angular = observations(); angular.crs = 'EPSG:4326'; delete angular.crs_units;
  expect(gridGeophysicsObservations(angular, options()).state).toBe('needs_input'); expect(gridGeophysicsObservations(observations([]), options()).state).toBe('needs_input');
  expect(gridGeophysicsObservations(observations(), options({ shape: [400, 400] })).issues[0].code).toBe('resource');
  const large = observations(Array.from({ length: 100 }, (_, x) => [x, 0, 1])); expect(gridGeophysicsObservations(large, options({ shape: [100, 1000] })).issues[0].code).toBe('resource');
  const validation = observations(Array.from({ length: 2000 }, (_, x) => [x, 0, 1])); validation.records.forEach((row) => { row.line_id = row.x % 2 ? 'A' : 'B'; });
  expect(crossValidateGeophysicsGridding(validation, interpolation(), { by: 'line' }).issues[0].code).toBe('resource');
});

it('guards fold counts, invalid split contracts and mixed field families', () => {
  const payload = observations(Array.from({ length: 65 }, (_, x) => [x, 0, 1])); payload.records.forEach((row) => { row.line_id = row.id; });
  expect(crossValidateGeophysicsGridding(payload, interpolation(), { by: 'line' }).issues[0].code).toBe('resource');
  for (const split of [{ by: 'random' }, { by: 'line', buffer_distance: -1 }, { by: 'line', origin: [0, 0] }]) expect(crossValidateGeophysicsGridding(reference.validation_input, interpolation(), split).state).toBe('rejected');
  const mixed = observations(); mixed.channels.radio = { field_type: 'radiometric', units: 'ppm' };
  expect(gridGeophysicsObservations(mixed, options({ channels: ['mag', 'radio'] })).state).toBe('rejected');
});
