/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it } from 'vitest';
import reference from '../../../../test/data/geophysics_alignment_reference.json';
import { describeGeophysicsAlignment, alignGeophysicsRaster, matchGeophysicsRaster } from '../src/data/geophysicsAlignment.js';
import { createGeophysicsRaster, loadGeoTiff } from '../src/data/geophysicsRaster.js';
import { encodeErs, encodeGeoTiff } from '../src/data/geophysicsWriters.js';
import { readErs } from '../src/data/ersLoader.js';
const raster = () => createGeophysicsRaster({ ...reference.source, data: Array.from({ length: 4 }, (_, row) => Array.from({ length: 4 }, (_, col) => 2 * (col + 0.5) + 3 * (4 - row - 0.5))) });
const target = (changes = {}) => ({ shape: [4, 4], transform: [1, 0, 0, 0, -1, 4], crs: null, crs_units: 'm', frame_id: 'survey-A', ...changes });
const options = (changes = {}) => ({ method: 'bilinear', value_kind: 'continuous', ...changes });
function close(actual, expected) {
  if (typeof expected === 'number') expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-10 * Math.max(1, Math.abs(expected)));
  else if (Array.isArray(expected)) { expect(actual).toHaveLength(expected.length); expected.forEach((value, index) => close(actual[index], value)); }
  else expect(actual).toEqual(expected);
}
it('matches Python reference artifacts and independent identity/shifted planes', () => {
  const result = alignGeophysicsRaster(createGeophysicsRaster(reference.source), reference.target, reference.options); expect(result.state).toBe('ok');
  for (const [key, expected] of Object.entries(reference.artifacts)) close(result.artifacts[key].data, expected);
  const source = raster(); const original = structuredClone(source);
  expect(alignGeophysicsRaster(source, target(), options()).artifacts.raster.data).toEqual(source.data); expect(source).toEqual(original);
  const shifted = alignGeophysicsRaster(source, target({ shape: [2, 2], transform: [1, 0, 0.25, 0, -1, 3.75] }), options());
  close(shifted.artifacts.raster.data[0], [3.25, 2.25].map((y) => [0.75, 1.75].map((x) => 2 * x + 3 * y)));
  expect(describeGeophysicsAlignment().pixel_tolerance).toBe(1e-7);
});
it.each([[0, 1, 0, 1, 0, 0], [1, 0.25, 0, 0, -1, 4]])('supports rotated/sheared identity %o', (...transform) => {
  const source = createGeophysicsRaster({ ...raster(), transform }); const result = alignGeophysicsRaster(source, target({ transform }), options());
  expect(result.state).toBe('ok'); close(result.artifacts.raster.data, source.data);
});
it('uses reference geometry without its bands, values or science metadata', () => {
  const source = raster(); const ref = createGeophysicsRaster({ data: [[[1, 1], [1, 1]], [[1, 1], [1, 1]]], transform: [2, 0, 0, 0, -2, 4], bandNames: ['ref1', 'ref2'], metadata: { frame_id: 'survey-A', crs_units: 'm', units: ['ppm', 'ppm'], field_type: 'radiometric' } });
  const before = structuredClone(ref); const result = matchGeophysicsRaster(source, ref, options());
  expect(result.state).toBe('ok'); expect(result.artifacts.raster.bandCount).toBe(1); expect(result.artifacts.raster.bandNames).toEqual(['mag']);
  expect(result.artifacts.raster.metadata.units).toEqual(['nT']); expect(result.artifacts.raster.metadata.field_type).toBe('magnetic_anomaly');
  expect(result.artifacts.raster.transform).toEqual(ref.transform); expect(ref).toEqual(before);
  ref.metadata.opaque = () => 'unused'; ref.data = ref.data.map((band) => band.map((row) => row.map(() => 1e200)));
  expect(matchGeophysicsRaster(source, ref, options()).state).toBe('ok');
});
it('separates footprint/coordinate validity from missing-data support', () => {
  const source = raster(); source.data[0][1][1] = null;
  const result = alignGeophysicsRaster(source, target({ shape: [1, 3], transform: [1, 0, -1.5, 0, -1, 2.5] }), options());
  expect(result.state).toBe('ok'); expect(result.artifacts.footprint.data[0][0]).toEqual([0, 1, 1]);
  expect(result.artifacts.coordinate_valid.data[0][0]).toEqual([1, 1, 1]); expect(result.artifacts.support.data[0][0]).toEqual([0, 1, 0]);
  const sentinel = raster(); sentinel.data[0][1][1] = -9999; sentinel.nodata = -9999;
  expect(alignGeophysicsRaster(sentinel, target({ shape: [1, 1], transform: [1, 0, 0.5, 0, -1, 3] }), options()).artifacts.support.data[0][0][0]).toBe(0);
});
it('reprojects known Web Mercator formula coordinates after backend acknowledgement', () => {
  const source = createGeophysicsRaster({ ...raster(), crs: 'EPSG:4326', metadata: { units: ['nT'], crs_units: 'degree', field_type: 'magnetic_anomaly' } });
  const r = 6378137; const x = r * 1.5 * Math.PI / 180; const y = r * Math.log(Math.tan(Math.PI / 4 + 2.5 * Math.PI / 360));
  const grid = target({ shape: [1, 1], transform: [100, 0, x - 50, 0, -100, y + 50], crs: 'EPSG:3857', crs_units: 'm', frame_id: null });
  expect(alignGeophysicsRaster(source, grid, options()).state).toBe('needs_input');
  const result = alignGeophysicsRaster(source, grid, options({ datum_policy: 'backend' })); expect(result.state).toBe('ok');
  expect(result.artifacts.raster.data[0][0][0]).toBeCloseTo(10.5, 8); expect(result.artifacts.raster.metadata.crs_units).toBe('m'); expect(result.artifacts.raster.metadata.units).toEqual(['nT']);
});
it('uses known UTM central-meridian/equator coordinates', () => {
  const source = createGeophysicsRaster({ ...raster(), transform: [1, 0, 115, 0, -1, 2], crs: 'EPSG:4326', metadata: { units: ['nT'], crs_units: 'degree' } });
  const grid = target({ shape: [1, 1], transform: [10, 0, 499995, 0, -10, 5], crs: 'EPSG:32650', frame_id: null });
  const result = alignGeophysicsRaster(source, grid, options({ datum_policy: 'backend' })); expect(result.state).toBe('ok');
  expect(result.artifacts.raster.data[0][0][0]).toBeCloseTo((source.data[0][1][1] + source.data[0][1][2] + source.data[0][2][1] + source.data[0][2][2]) / 4, 8);
});
it('stores old geometry/uncertainty in lineage and persists it through exports', async () => {
  const source = raster(); source.crs = 'EPSG:28350'; Object.assign(source.metadata, { driver: 'old', width: 4, tags: { old: 'yes' }, uncertainty: [[1, 2]], source: 'survey.ers' });
  const result = alignGeophysicsRaster(source, target({ shape: [2, 2], transform: [2, 0, 0, 0, -2, 4], crs: 'EPSG:28350', frame_id: null }), options());
  expect(result.state).toBe('ok'); const aligned = result.artifacts.raster; expect(aligned.metadata.uncertainty).toBeUndefined(); expect(aligned.metadata.driver).toBeUndefined();
  const step = aligned.metadata.processing.at(-1); expect(aligned.metadata.input_lineage[step.operand_lineage].metadata.uncertainty).toEqual([[1, 2]]);
  const encoded = encodeErs(aligned, { dtype: 'float64' });
  for (const back of [readErs(encoded.header, encoded.data), await loadGeoTiff(encodeGeoTiff(aligned, { dtype: 'float64' }))]) {
    expect(back.metadata.processing).toEqual(aligned.metadata.processing); expect(back.metadata.input_lineage).toEqual(aligned.metadata.input_lineage); expect(back.metadata.corrections).toEqual({ igrf: 'applied' });
  }
});
it.each([{ method: 'average' }, { value_kind: 'vector' }, { datum_policy: 'exact' }, { method: null }, { extra: 1 }])('rejects options %o', (changes) => {
  const result = alignGeophysicsRaster(raster(), target(), options(changes)); expect(result.state).toBe('rejected'); expect(result.artifacts).toEqual({});
});
it('rejects ambiguous context, conflicting units, unsupported CRSs and resource overflow', () => {
  expect(alignGeophysicsRaster(raster(), target({ frame_id: 'different' }), options()).state).toBe('rejected');
  expect(alignGeophysicsRaster(raster(), target({ frame_id: null }), options()).state).toBe('needs_input');
  expect(alignGeophysicsRaster(raster(), target({ crs_units: 'ft' }), options()).state).toBe('rejected');
  expect(alignGeophysicsRaster(raster(), target({ shape: [1000, 1000] }), options()).issues[0].code).toBe('resource');
  expect(alignGeophysicsRaster(raster(), target({ transform: [0, 0, 0, 0, 0, 0] }), options()).state).toBe('rejected');
  const unknown = { ...raster(), crs: 'EPSG:3577' };
  expect(alignGeophysicsRaster(unknown, target({ crs: 'EPSG:3857', frame_id: null }), options({ datum_policy: 'backend' })).state).toBe('rejected');
  expect(alignGeophysicsRaster(unknown, target({ crs: 'EPSG:3577', frame_id: null }), options()).state).toBe('ok');
});
it('requires safe integer categorical codes and treats large nodata sentinels as missing', () => {
  expect(alignGeophysicsRaster(raster(), target(), options({ method: 'nearest', value_kind: 'categorical' })).state).toBe('rejected');
  const source = createGeophysicsRaster({ ...raster(), data: Array.from({ length: 4 }, () => Array(4).fill(3)) });
  expect(alignGeophysicsRaster(source, target(), options({ method: 'nearest', value_kind: 'categorical' })).artifacts.raster.data).toEqual(source.data);
  expect(alignGeophysicsRaster(source, target(), options({ value_kind: 'categorical' })).state).toBe('rejected');
  source.data = source.data.map((band) => band.map((row) => row.map(() => -1e300))); source.nodata = -1e300;
  expect(alignGeophysicsRaster(source, target(), options({ method: 'nearest', value_kind: 'categorical' })).state).toBe('ok');
});
