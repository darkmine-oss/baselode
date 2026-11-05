/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it, vi } from 'vitest';
import fixture from '../../../../test/data/geophysics_workflow_reference.json';
import { createGeophysicsRaster, loadGeoTiff } from '../src/data/geophysicsRaster.js';
import { encodeErs, encodeGeoTiff } from '../src/data/geophysicsWriters.js';
import { readErs } from '../src/data/ersLoader.js';
import * as processing from '../src/data/geophysicsProcessing.js';
import { listGeophysicsOperations, describeGeophysicsOperation, geophysicsWorkflowSchema, magneticGridRecipe, validateGeophysicsWorkflow, runGeophysicsWorkflow } from '../src/data/geophysicsWorkflows.js';
const grid = () => createGeophysicsRaster(fixture.input);
const single = (operation = 'horizontal_derivative', parameters = {}) => ({ schema: 'baselode.geophysics.workflow', version: 1,
  steps: [{ id: 'product', operation, version: 1, inputs: ['magnetic'], parameters }], outputs: ['product'] });

it('exposes independent contracts and the shared recipe/schema', () => {
  const catalogue = listGeophysicsOperations(); expect(catalogue).toHaveLength(11);
  catalogue[0].parameters.properties = {};
  expect(describeGeophysicsOperation('low_pass').parameters.properties.wavelength).toBeDefined();
  expect(() => describeGeophysicsOperation('constructor')).toThrow(/unknown/);
  expect(magneticGridRecipe()).toEqual(fixture.workflow);
  expect(geophysicsWorkflowSchema().properties.version.const).toBe(1);
});
it('replays the Python reference at full resolution, persists lineage and preserves inputs', async () => {
  const source = grid(); const original = structuredClone(source); const recipe = magneticGridRecipe();
  const result = runGeophysicsWorkflow(recipe, { magnetic: source }); expect(result.state).toBe('ok');
  expect(result.completed_steps).toEqual(['regional', 'residual', 'edges']);
  expect(result.resource_estimate.retained_cell_values).toBe(256);
  for (const [key, expected] of Object.entries(fixture.outputs)) result.artifacts[key].data.flat(2).forEach((value, index) => expect(value).toBeCloseTo(expected.flat(2)[index], 9));
  expect(runGeophysicsWorkflow(JSON.parse(JSON.stringify(recipe)), { magnetic: source }).artifacts.edges.data).toEqual(result.artifacts.edges.data);
  const { edges } = result.artifacts; expect(edges.metadata.units).toEqual(['nT/m']);
  const encoded = encodeErs(edges, { dtype: 'float64' });
  for (const back of [readErs(encoded.header, encoded.data), await loadGeoTiff(encodeGeoTiff(edges, { dtype: 'float64' }))]) {
    expect(back.metadata.processing).toEqual(edges.metadata.processing); expect(back.metadata.input_lineage).toEqual(edges.metadata.input_lineage);
  }
  edges.metadata.input_lineage[0].metadata.source = 'changed'; expect(source).toEqual(original);
});
it('recovers an independent plane gradient and records effective defaults', () => {
  const source = createGeophysicsRaster({ ...grid(), data: Array.from({ length: 12 }, (_, row) => Array.from({ length: 12 }, (_, col) => 20 + 20 * col - 30 * row)) });
  const report = runGeophysicsWorkflow(single(), { magnetic: source }); expect(report.state).toBe('ok');
  expect(report.plan[0].parameters).toEqual({ direction: 'east' });
  report.artifacts.product.data.flat(2).forEach((value) => expect(value).toBeCloseTo(2, 12));
  runGeophysicsWorkflow(magneticGridRecipe(), { magnetic: source }).artifacts.residual.data.flat(2).forEach((value) => expect(value).toBeCloseTo(0, 9));
});
it.each([
  ['low_pass', { wavelength: 40 }], ['high_pass', { wavelength: 40 }], ['band_pass', { long_wavelength: 80, short_wavelength: 20 }],
  ['vertical_derivative', { order: 2 }], ['horizontal_derivative', { direction: 'north' }], ['total_horizontal_derivative', {}],
  ['tilt_derivative', {}], ['analytic_signal', {}], ['upward_continuation', { height: 20 }], ['reduce_to_pole', { inclination: -55, declination: 1 }],
])('executes %s with portable parameters', (operation, parameters) => {
  const report = runGeophysicsWorkflow(single(operation, parameters), { magnetic: grid() }); expect(report.state).toBe('ok'); expect(report.artifacts.product.width).toBe(8);
});
it.each([
  [{ field_type: 'radiometric', units: ['ppm'], crs_units: 'm' }, 'rejected'], [{ units: ['nT'], crs_units: 'm' }, 'needs_input'],
  [{ field_type: 'magnetic_anomaly', crs_units: 'm' }, 'needs_input'], [{ field_type: 'magnetic_anomaly', units: ['nT'] }, 'needs_input'],
])('requires applicable scientific context %o', (metadata, state) => {
  const report = runGeophysicsWorkflow(magneticGridRecipe(), { magnetic: { ...grid(), metadata } }); expect(report.state).toBe(state); expect(report.completed_steps).toEqual([]);
});
it('rejects geographic/degenerate grids and requests missing inputs or parameters', () => {
  for (const source of [{ ...grid(), crs: 'EPSG:4326', metadata: { field_type: 'magnetic_anomaly', units: ['nT'] } }, { ...grid(), transform: [0, 0, 0, 0, 0, 0] }]) expect(validateGeophysicsWorkflow(magneticGridRecipe(), { magnetic: source }).state).toBe('rejected');
  expect(runGeophysicsWorkflow(magneticGridRecipe(), {}).state).toBe('needs_input');
  expect(validateGeophysicsWorkflow(single('upward_continuation'), { magnetic: grid() }).state).toBe('needs_input');
});
it.each([
  ['low_pass', { wavelength: '40' }], ['low_pass', { wavelength: -1 }], ['low_pass', { wavelength: 40, order: true }], ['low_pass', { wavelength: 40, method: 'typo' }],
  ['band_pass', { long_wavelength: 10, short_wavelength: 20 }], ['reduce_to_pole', { inclination: 1, declination: 0 }], ['reduce_to_pole', { inclination: -55, declination: 500 }],
  ['horizontal_derivative', { direction: 'up' }], ['analytic_signal', { typo: 2 }],
])('preflights invalid %s parameters %o', (operation, parameters) => {
  const report = runGeophysicsWorkflow(single(operation, parameters), { magnetic: grid() }); expect(report.state).toBe('rejected'); expect(report.completed_steps).toEqual([]);
});
it('validates every step before execution and structures backend failures', () => {
  const spy = vi.spyOn(processing, 'processGeophysicsRaster').mockImplementation(() => { throw Error('injected backend failure'); });
  try {
    const recipe = magneticGridRecipe(); recipe.steps[2].operation = 'eval'; expect(runGeophysicsWorkflow(recipe, { magnetic: grid() }).state).toBe('rejected'); expect(spy).not.toHaveBeenCalled();
    const report = runGeophysicsWorkflow(single(), { magnetic: grid() }); expect(report.state).toBe('failed'); expect(report.artifacts).toEqual({}); expect(report.issues[0].message).toBe('injected backend failure');
  } finally { spy.mockRestore(); }
});
it('rejects versions, forward references, misalignment and mixed units', () => {
  for (const key of ['version', 'operation']) { const recipe = magneticGridRecipe(); recipe.steps[0][key] = 99; expect(validateGeophysicsWorkflow(recipe, { magnetic: grid() }).state).toBe('rejected'); }
  const recipe = magneticGridRecipe(); recipe.steps[0].inputs = ['edges']; expect(validateGeophysicsWorkflow(recipe, { magnetic: grid() }).state).toBe('rejected');
  const combine = single('combine'); combine.steps[0].inputs = ['magnetic', 'other'];
  for (const other of [{ ...grid(), transform: [10, 0, 1, 0, -10, 80] }, { ...grid(), metadata: { ...grid().metadata, units: ['mGal'] } }]) expect(validateGeophysicsWorkflow(combine, { magnetic: grid(), other }).state).toBe('rejected');
});
it('rejects non-JSON recipes, malformed dimensions and resource overflow', () => {
  expect(validateGeophysicsWorkflow({ ...single(), bad: NaN }, {}).state).toBe('rejected');
  expect(validateGeophysicsWorkflow(single(), { magnetic: { ...grid(), width: 1 } }).state).toBe('rejected');
  const source = createGeophysicsRaster({ ...grid(), data: Array.from({ length: 512 }, () => Array(512).fill(1)) });
  const recipe = single(); recipe.steps = Array.from({ length: 64 }, (_, index) => ({ ...recipe.steps[0], id: `step${index}` })); recipe.outputs = ['step63'];
  expect(validateGeophysicsWorkflow(recipe, { magnetic: source }).issues.some((issue) => issue.code === 'resource')).toBe(true);
});

it.each([[10, 3, 0, 0, -10, 80], [1e200, 0, 0, 0, -1e200, 80]])('preflights unsupported affine %o', (...transform) => {
  const report = runGeophysicsWorkflow(single(), { magnetic: { ...grid(), transform } });
  expect(report.state).toBe('rejected'); expect(report.completed_steps).toEqual([]);
});
it('supports rectangular rotations and JSON integer numbers', () => {
  const recipe = single('vertical_derivative', { order: 1.0 });
  expect(runGeophysicsWorkflow(recipe, { magnetic: { ...grid(), transform: [0, 10, 0, 10, 0, 80] } }).state).toBe('ok');
});
