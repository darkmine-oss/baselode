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
assert.equal(geophysics.listGeophysicsOperations().length, 15);
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

const lagSurvey = { records: [{ id: 'a', line_id: 'L', time: 0, values: { mag: 100 } }, { id: 'b', line_id: 'L', time: 1, values: { mag: 102 } }], channels: { mag: { field_type: 'magnetic_total_field', units: 'nT' } }, metadata: { corrections: { lag: 'unapplied' } } };
const lagged = await geophysics.correctGeophysicsMagneticLag(lagSurvey, { channel: 'mag', lag_seconds: .5, max_gap: 1, unsupported_policy: 'mask', event_id: 'lag-1', evidence: 'synthetic', clock_policy: 'synchronized' });
assert.equal(lagged.state, 'ok');
assert.deepEqual(lagged.observations.records.map((row) => row.values.mag), [101, null]);
assert.deepEqual(lagged.ledger.entries.at(-1).masked_records, [{ id: 'b', value: 102 }]);
assert.equal((await geophysics.inspectGeophysicsCorrections(lagged.observations)).state, 'ok');

const headingSurvey = { records: [{ id: 'a', values: { mag: 102 }, extra: { sensor_heading: 0 } }, { id: 'b', values: { mag: 98 }, extra: { sensor_heading: 180 } }], channels: { mag: { field_type: 'magnetic_total_field', units: 'nT' } }, metadata: { corrections: { heading: 'unapplied' }, heading: { key: 'sensor_heading', units: 'degrees', reference: 'true_north', positive: 'clockwise' } } };
const headingCorrected = await geophysics.correctGeophysicsMagneticHeading(headingSurvey, { channel: 'mag', heading_key: 'sensor_heading', heading_reference: 'true_north', calibration_id: 'synthetic', calibration: [{ heading_degrees: 0, bias_nT: 2 }, { heading_degrees: 180, bias_nT: -2 }], max_heading_gap: 180, bias_convention: 'observed_minus_reference', event_id: 'heading-1', evidence: 'synthetic' });
assert.equal(headingCorrected.state, 'ok');
assert.deepEqual(headingCorrected.observations.records.map((row) => row.values.mag), [100, 100]);
assert.equal((await geophysics.inspectGeophysicsCorrections(headingCorrected.observations)).state, 'ok');

const tieSurvey = { channels: { mag: { field_type: 'magnetic_anomaly', units: 'nT' } }, crs: 'LOCAL', crs_units: 'm', metadata: { corrections: { levelling: 'unapplied' } }, records: [{ id: 'a0', line_id: 'A', x: 0, y: -1, values: { mag: 105 } }, { id: 'a1', line_id: 'A', x: 0, y: 1, values: { mag: 105 } }, { id: 'r0', line_id: 'R', x: -1, y: 0, values: { mag: 100 } }, { id: 'r1', line_id: 'R', x: 1, y: 0, values: { mag: 100 } }] };
const crossingOptions = { channel: 'mag', max_segment_length: 10, min_crossing_angle: 30, intersection_tolerance: 1e-6, elevation_policy: 'ignore', max_height_difference: null };
assert.equal((await geophysics.analyzeGeophysicsCrossovers(tieSurvey, crossingOptions)).crossovers[0].difference, 5);
const tied = await geophysics.levelGeophysicsMagneticLines(tieSurvey, { ...crossingOptions, reference_lines: ['R'], target_lines: ['A'], min_crossovers: 1, min_reference_lines: 1, max_abs_correction: 10, max_rms_residual: 0, event_id: 'tie-1', evidence: 'synthetic' });
assert.equal(tied.state, 'ok');
assert.deepEqual(tied.observations.records.map((row) => row.values.mag), [100, 100, 100, 100]);
assert.equal((await geophysics.inspectGeophysicsCorrections(tied.observations)).state, 'ok');
assert.equal(geophysics.describeGeophysicsCrossovers().version, 1);

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

const projectionSource = geophysics.createGeophysicsObservations({crs:'EPSG:4326',crs_units:'degree',channels:{mag:{field_type:'magnetic_total_field',units:'nT'}},records:[{id:'anchor',x:117,y:0,values:{mag:50000}}]});
const projected = await geophysics.reprojectGeophysicsObservations(projectionSource,{target_crs:'EPSG:32750',datum_policy:'backend',event_id:'project',evidence:'synthetic anchor'});
assert.equal(projected.state,'ok');
assert.ok(Math.abs(projected.observations.records[0].x-500000)<1e-7);
assert.equal(projected.observations.records[0].y,10000000);
assert.equal((await geophysics.inspectGeophysicsCorrections(projected.observations)).state,'ok');
assert.equal(geophysics.describeGeophysicsReprojection().version,1);

const observationExample = JSON.parse(readFileSync(resolve(root,'../../../test/data/geophysics_crossovers_reference.json'),'utf8'));
const observationRun = await geophysics.runGeophysicsObservationWorkflow(geophysics.magneticObservationRecipe(),{survey:observationExample.survey});
assert.equal(observationRun.state,'ok',JSON.stringify(observationRun.issues));
assert.deepEqual(observationRun.artifacts.grid.data,[[[134,146],[104,116]]]);
assert.equal(geophysics.describeGeophysicsObservationWorkflow().version,1);
assert.equal((await geophysics.inspectGeophysicsCorrections(observationRun.artifacts.corrected)).state,'ok');

assert.equal(geophysics.describeGeophysicsNormalGravity().models.WGS84.backend_version,'0.6.0');

const gravityTemporalExample=JSON.parse(readFileSync(resolve(root,'../../../test/data/gravity_temporal_reference.json'),'utf8'));
const gravityTide=await geophysics.applyGeophysicsGravityTide(gravityTemporalExample.survey,gravityTemporalExample.tide_options);
assert.equal(gravityTide.state,'ok',JSON.stringify(gravityTide.issues));
const gravityDrift=await geophysics.correctGeophysicsGravityDrift(gravityTide.observations,gravityTemporalExample.drift_options);
assert.equal(gravityDrift.state,'ok',JSON.stringify(gravityDrift.issues));
assert.deepEqual(gravityDrift.observations.records.map(row=>row.values.g),gravityTemporalExample.expected_values);
assert.equal(geophysics.describeGeophysicsGravityTemporal().version,1);

assert.equal(geophysics.describeGeophysicsGravityTopography().models.gravity_bouguer.algorithm,'infinite_land_plate_v1');
const topographyReplay=JSON.parse(readFileSync(resolve(root,'../../../test/data/gravity_topography_ledger_reference.json'),'utf8'));
assert.equal((await geophysics.inspectGeophysicsCorrections(topographyReplay.terrain_observations)).state,'ok');

const radioExample=JSON.parse(readFileSync(resolve(root,'../../../test/data/radiometrics_reference.json'),'utf8'));
const radioStack=geophysics.createGeophysicsRaster({...radioExample,bandNames:radioExample.band_names});
assert.deepEqual(geophysics.calculateGeophysicsRadiometricRatios(radioStack,radioExample.ratio_options).data,radioExample.expected_ratios);
assert.deepEqual(geophysics.createGeophysicsRadiometricTernary(radioStack,radioExample.ternary_options).data,radioExample.expected_ternary);
assert.equal(geophysics.describeGeophysicsRadiometrics().version,1);

assert.equal(geophysics.describeGeophysicsMicrolevelling().version,1);
const microGrid=geophysics.createGeophysicsRaster({data:Array.from({length:64},()=>Array.from({length:64},(_,col)=>7+Math.cos(2*Math.PI*(col+.5)/8))),transform:[1,0,0,0,-1,64],crs:'EPSG:32750',metadata:{field_type:'magnetic_anomaly',units:['nT'],crs_units:'m',grid_corrections:{magnetic_levelling:'applied',magnetic_microlevelling:'unapplied'}}});
const microOptions={flight_azimuth:0,line_spacing:4,along_line_wavelength:32,across_line_wavelength:16,max_abs_correction:5,protected_bounds:[],edge_margin_cells:8,min_training_fraction:.5,reference_policy:'caller_verified',evidence:'analytic verified grid',geology_policy:'directional_overlap_acknowledged'};
const microEstimate=geophysics.estimateGeophysicsMagneticMicrolevelling(microGrid,microOptions),microCorrected=geophysics.microlevelGeophysicsMagneticGrid(microGrid,microOptions);
assert.equal(microEstimate.metadata.field_type,'other');
assert.ok(Math.abs(microCorrected.data[0][16][16]-(7+.0625*Math.cos(2*Math.PI*16.5/8)))<1e-10);
assert.throws(()=>geophysics.microlevelGeophysicsMagneticGrid(microCorrected,microOptions));
