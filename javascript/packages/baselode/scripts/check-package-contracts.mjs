/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const publishedEntries = {
  './geophysics': ['dist/geophysics.js', 'types/geophysics.d.ts'],
  './extent': ['dist/extent.js', 'types/extent.d.ts'],
  './tool-ui': ['dist/tool-ui.js', 'types/tool-ui.d.ts'],
  './tool-ui/contracts': ['dist/tool-ui-contracts.js', 'types/tool-ui-contracts.d.ts'],
  './assistant-ui': ['dist/assistant-ui.js', 'types/assistant-ui.d.ts'],
};

for (const [entry, [runtime, types]] of Object.entries(publishedEntries)) {
  assert.equal(packageJson.exports[entry].import, `./${runtime}`);
  assert.equal(packageJson.exports[entry].types, `./${types}`);
  readFileSync(resolve(root, runtime));
  readFileSync(resolve(root, types));
}

for (const clientEntry of ['dist/tool-ui.js', 'dist/assistant-ui.js']) {
  assert.match(readFileSync(resolve(root, clientEntry), 'utf8').slice(0, 80), /"use client";/);
}

const contracts = await import(pathToFileURL(resolve(root, 'dist/tool-ui-contracts.js')));
assert.equal(Object.keys(contracts.BASELODE_TOOL_UI_SCHEMA_CONTRACTS).length, 8);

const extentModule = await import(pathToFileURL(resolve(root, 'dist/extent.js')));
const extent = extentModule.Extent.fromBbox([118, -32, 120, -30]);
assert.deepEqual(extent.center(), [119, -31]);
assert.equal(extentModule.DEFAULT_EXTENT_CRS, 'EPSG:4326');

const geophysics = await import(pathToFileURL(resolve(root, 'dist/geophysics.js')));
assert.equal(geophysics.listGeophysicsOperations().length, 11);
const workflowGrid = geophysics.createGeophysicsRaster({
  data: [[1, 2], [3, 4]], transform: [10, 0, 0, 0, -10, 20],
  metadata: { field_type: 'magnetic_anomaly', units: ['nT'], crs_units: 'm' },
});
assert.equal(geophysics.runGeophysicsWorkflow(geophysics.magneticGridRecipe(), { magnetic: workflowGrid }).state, 'ok');

const observations = geophysics.createGeophysicsObservations({
  records: [{ id: 'a', x: 1, y: 2, values: { mag: 10 } }],
  channels: { mag: { field_type: 'magnetic_total_field', units: 'nT' } }, crs_units: 'm',
});
assert.equal(geophysics.qcGeophysicsObservations(observations).state, 'ok');
assert.equal(geophysics.describeGeophysicsObservationQc().version, 1);

const gridReport = geophysics.gridGeophysicsObservations(observations, {
  channels: ['mag'], radius: 5, duplicate_policy: 'mean', elevation_policy: 'ignore',
  bounds: [0, 1, 2, 3], shape: [1, 1],
});
assert.equal(gridReport.state, 'ok');
assert.equal(gridReport.artifacts.grid.data[0][0][0], 10);
assert.equal(geophysics.describeGeophysicsGridding().version, 1);

assert.equal(geophysics.describeGeophysicsAlignment().version, 1);
const alignmentSource = geophysics.createGeophysicsRaster({
  data: [[1, 2], [3, 4]], crs: 'EPSG:28350', transform: [10, 0, 0, 0, -10, 20],
  metadata: { field_type: 'magnetic_anomaly', units: ['nT'] },
});
const alignment = geophysics.matchGeophysicsRaster(alignmentSource, alignmentSource, { method: 'bilinear', value_kind: 'continuous' });
assert.equal(alignment.state, 'ok');
assert.deepEqual(alignment.artifacts.raster.data, alignmentSource.data);
assert.equal(typeof geophysics.alignGeophysicsRaster, 'function');

assert.equal(geophysics.describeGeophysicsEquivalentSources().execution.javascript, 'contract_only');
assert.equal(geophysics.describeGeophysicsEquivalentSources().request_schema.properties.version.const, 1);

assert.equal(geophysics.describeGeophysicsCorrections().version, 1);
const correctionSurvey = { records: [{ id: 's', time: 0, values: { mag: 100 } }], channels: { mag: { field_type: 'magnetic_total_field', units: 'nT' } }, metadata: { corrections: { diurnal: 'unapplied' } } };
const correctionBase = { records: [{ id: 'b', time: 0, station_id: 'BASE', values: { base: 1001 } }], channels: { base: { field_type: 'magnetic_total_field', units: 'nT' } }, metadata: { corrections: { diurnal: 'unapplied' } } };
const correctedBase = await geophysics.correctGeophysicsMagneticBase(correctionSurvey, correctionBase, { channel: 'mag', base_channel: 'base', reference: 1000, max_gap: 10, event_id: 'base-1', evidence: 'synthetic', clock_policy: 'synchronized' });
assert.equal(correctedBase.state, 'ok');
assert.equal(correctedBase.observations.records[0].values.mag, 99);
assert.equal((await geophysics.inspectGeophysicsCorrections(correctedBase.observations)).state, 'ok');

const npmCache = mkdtempSync(join(tmpdir(), 'baselode-pack-'));
let pack;
try {
  pack = JSON.parse(execFileSync(
    'npm',
    ['pack', '--ignore-scripts', '--dry-run', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: npmCache },
    },
  ));
} finally {
  rmSync(npmCache, { recursive: true, force: true });
}
const files = new Set(pack[0].files.map(({ path }) => path));
for (const [runtime, types] of Object.values(publishedEntries)) {
  assert(files.has(runtime), `${runtime} is missing from npm pack output`);
  assert(files.has(types), `${types} is missing from npm pack output`);
}
assert(files.has('dist/style.css'));
assert(files.has('src/tool-ui/style.css'));
assert(files.has('README.md'));

assert.equal(geophysics.describeGeophysicsIgrf().model.model, 'IGRF14');
assert.equal(geophysics.describeGeophysicsIgrf().execution.install, "pip install 'baselode[magnetics]'");

console.log('Published Extent, geophysics and Tool UI contracts are present, importable, and typed.');
