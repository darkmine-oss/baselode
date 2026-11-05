/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Python generates the `editing` cases in test/data/geophysics_reference.json
// (test/test_geophysics_reference.py); the browser implementation must agree.
// The files under test/data/geophysics_js_written* are this encoder's output,
// which Python reads back with GDAL in test/test_geophysics_editing.py.
// Regenerate them after an intentional change with
// UPDATE_GEOPHYSICS_FIXTURES=1 npx vitest run tests/geophysicsEditing.test.js

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import fixture from '../../../../test/data/geophysics_reference.json';
import { createGeophysicsRaster } from '../src/data/geophysicsRaster.js';
import {
  GEOPHYSICS_COMBINE_OPERATIONS,
  clipGeophysicsRaster,
  combineGeophysicsRasters,
  cropGeophysicsRaster,
  fillGeophysicsGaps,
} from '../src/data/geophysicsEditing.js';
import { encodeErs, encodeGeoTiff, ersCoordinateSpace } from '../src/data/geophysicsWriters.js';
import { parseErsHeader, readErs } from '../src/data/ersLoader.js';
import { loadGeoTiff } from '../src/data/geophysicsRaster.js';
import * as geophysicsEntry from '../src/geophysics.js';

const { editing } = fixture;
const DATA_DIR = fileURLToPath(new URL('../../../../test/data/', import.meta.url));

function expectGrid(actual, expected, tolerance = 1e-8) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((band, b) => band.forEach((row, i) => row.forEach((value, j) => {
    const want = expected[b][i][j];
    if (want === null) expect(value, `[${b}][${i}][${j}]`).toBeNull();
    else expect(Math.abs(value - want), `[${b}][${i}][${j}] ${value} vs ${want}`).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(want)));
  })));
}

function expectResult(raster, expected, tolerance) {
  expectGrid(raster.data, expected.data, tolerance);
  raster.transform.forEach((value, index) => expect(value).toBeCloseTo(expected.transform[index], 6));
  expect(raster.metadata.processing.at(-1)).toEqual(expected.step);
}

describe('geophysics editing reference', () => {
  it.each(editing.crop.map((testCase, index) => [index, testCase]))('crop %i matches Python', (_, { bounds, result }) => {
    expectResult(cropGeophysicsRaster(editing.raster, bounds), result);
  });

  it.each(editing.clip.map((testCase, index) => [index, testCase]))('clip %i matches Python', (_, { polygon, crop, result }) => {
    expectResult(clipGeophysicsRaster(editing.raster, polygon, { crop }), result);
  });

  it.each(editing.combine.map((testCase) => [`${testCase.operation} ${testCase.operand}`, testCase]))(
    '%s matches Python',
    (_, { operation, operand, result }) => {
      const right = operand === 'regional' ? editing.regional : operand;
      expectResult(combineGeophysicsRasters(editing.raster, right, operation), result);
    },
  );

  it.each(editing.fill.map((testCase) => [`maxDistance ${testCase.maxDistance} iterations ${testCase.iterations}`, testCase]))(
    'fill with %s matches Python',
    (_, { maxDistance, iterations, result }) => {
      expectResult(fillGeophysicsGaps(editing.raster, { maxDistance, iterations }), result, 1e-9);
    },
  );

  it('writes the same ERS dataset as Python', () => {
    const { raster, name, header, data } = editing.ersWriter;
    const encoded = encodeErs(raster, { name, includeProvenance: false });
    expect(Buffer.from(encoded.data).toString('base64')).toBe(data);
    expect(normaliseNumbers(parseErsHeader(encoded.header))).toEqual(normaliseNumbers(parseErsHeader(header)));
  });
});

/** Python writes `400000.0` where JS writes `400000`; compare as numbers. */
function normaliseNumbers(value) {
  if (Array.isArray(value)) return value.map(normaliseNumbers);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normaliseNumbers(item)]));
  }
  if (typeof value === 'string' && /^-?\d+\.0$/.test(value)) return String(Number(value));
  return value;
}

// value = 10 * row + column on a 4 x 5 grid of 10 m cells
function ramp(options = {}) {
  const data = Array.from({ length: 4 }, (_, row) => Array.from({ length: 5 }, (__, column) => 10 * row + column));
  return createGeophysicsRaster({
    data,
    transform: [10, 0, 500000, 0, -10, 7000040],
    crs: 'EPSG:28350',
    bandNames: ['tmi'],
    metadata: { units: ['nT'], source: 'ramp.ers' },
    ...options,
  });
}

describe('cropGeophysicsRaster', () => {
  it('keeps whole overlapping cells and rejects boxes off the grid', () => {
    const cropped = cropGeophysicsRaster(ramp(), [500012, 7000040 - 25, 500030, 7000040 - 5]);
    expect(cropped.data[0]).toEqual([[1, 2], [11, 12], [21, 22]]);
    expect(cropped.transform).toEqual([10, 0, 500010, 0, -10, 7000040]);
    expect(cropped.metadata.units).toEqual(['nT']);
    expect(() => cropGeophysicsRaster(ramp(), [0, 0, 10, 10])).toThrow(/overlap/);
    expect(() => cropGeophysicsRaster(ramp(), [3, 3, 1, 1])).toThrow(/minX/);
  });
});

describe('clipGeophysicsRaster', () => {
  it('masks outside cells and cuts holes', () => {
    const x = (column) => 500000 + 10 * column;
    const y = (row) => 7000040 - 10 * row;
    const outer = [[x(0), y(0)], [x(5), y(0)], [x(5), y(4)], [x(0), y(4)]];
    const hole = [[x(1), y(1)], [x(3), y(1)], [x(3), y(3)], [x(1), y(3)]];
    const clipped = clipGeophysicsRaster(ramp(), [outer, hole]);
    expect(clipped.data[0][1]).toEqual([10, null, null, 13, 14]);
    const feature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[x(2), y(0)], [x(5), y(0)], [x(5), y(3)]]] } };
    const triangle = clipGeophysicsRaster(ramp(), feature);
    expect(triangle.data[0].map((row) => row.map((value) => value !== null))).toEqual([
      [true, true, true],
      [false, true, true],
      [false, false, true],
    ]);
    expect(clipGeophysicsRaster(ramp(), feature, { crop: false }).width).toBe(5);
    expect(() => clipGeophysicsRaster(ramp(), [[x(0.1), y(0.1)], [x(0.3), y(0.1)], [x(0.2), y(0.3)]])).toThrow(/cell centre/);
    // More vertices than a function call accepts as arguments.
    const detailed = Array.from({ length: 200000 }, (_, k) => {
      const angle = (2 * Math.PI * k) / 200000;
      return [x(2.5) + 30 * Math.cos(angle), y(2) + 30 * Math.sin(angle)];
    });
    expect(clipGeophysicsRaster(ramp(), detailed).metadata.processing.at(-1).inside_cells).toBeGreaterThan(0);
  });
});

describe('combineGeophysicsRasters', () => {
  it('combines aligned rasters and rejects misaligned ones', () => {
    const residual = combineGeophysicsRasters(ramp(), 5, 'subtract');
    expect(residual.data[0][0]).toEqual([-5, -4, -3, -2, -1]);
    const ratio = combineGeophysicsRasters(ramp(), ramp(), 'divide');
    expect(ratio.data[0][0][0]).toBeNull();
    expect(ratio.metadata.units).toEqual([null]);
    expect(combineGeophysicsRasters(ramp(), ramp({ crs: 28350 }), 'add').data[0][1][1]).toBe(22);
    expect(() => combineGeophysicsRasters(ramp(), ramp({ transform: [10, 0, 500005, 0, -10, 7000040] }), 'add')).toThrow(/share a grid/);
    expect(() => combineGeophysicsRasters(ramp(), ramp({ crs: 'EPSG:28351' }), 'add')).toThrow(/coordinate systems/);
    expect(() => combineGeophysicsRasters(ramp(), cropGeophysicsRaster(ramp(), [500000, 7000020, 500020, 7000040]), 'add')).toThrow(/same shape/);
    expect(() => combineGeophysicsRasters(ramp(), 1, 'power')).toThrow(/operation/);
    expect(GEOPHYSICS_COMBINE_OPERATIONS).toEqual(['add', 'subtract', 'multiply', 'divide']);
  });
});

describe('fillGeophysicsGaps', () => {
  it('is exact inside planes and respects maxDistance', () => {
    const raster = ramp();
    for (let row = 1; row < 3; row += 1) for (let column = 1; column < 4; column += 1) raster.data[0][row][column] = null;
    const filled = fillGeophysicsGaps(raster, { iterations: 300 });
    filled.data[0].forEach((row, i) => row.forEach((value, j) => expect(value).toBeCloseTo(10 * i + j, 6)));
    expect(filled.metadata.processing.at(-1).filled_cells).toBe(6);

    const strip = createGeophysicsRaster({
      data: Array.from({ length: 7 }, (_, row) => Array.from({ length: 7 }, () => (row === 0 ? 1 : null))),
    });
    const near = fillGeophysicsGaps(strip, { maxDistance: 2 });
    expect(near.data[0].map((row) => row[3] !== null)).toEqual([true, true, true, false, false, false, false]);
    expect(() => fillGeophysicsGaps(strip, { maxDistance: -1 })).toThrow(/maxDistance/);
    expect(() => fillGeophysicsGaps(createGeophysicsRaster({ data: [[null, null]] }))).toThrow(/no data/);
  });
});

describe('writers', () => {
  it('round-trips ERS through readErs', () => {
    const raster = ramp();
    raster.data[0][2][2] = null;
    const { header, data } = encodeErs(raster, { name: 'ramp.ers' });
    const back = readErs(header, data);
    expect(back.crs).toBe('EPSG:28350');
    expect(back.transform).toEqual(raster.transform);
    expect(back.bandNames).toEqual(['tmi']);
    expect(back.metadata.units).toEqual(['nT']);
    expect(back.data[0][2][2]).toBeNull();
    expect(back.data[0][3]).toEqual([30, 31, 32, 33, 34]);
  });

  it.each([
    ['projected', {}],
    ['geographic', { crs: 'EPSG:4283', transform: [0.0025, 0, 118.123456789, 0, -0.0025, -27.5] }],
    ['unreferenced', { crs: null }],
  ])('round-trips a %s ERS coordinate space', (_, options) => {
    const raster = ramp(options);
    const back = readErs(encodeErs(raster, { dtype: 'float64' }).header, encodeErs(raster, { dtype: 'float64' }).data);
    expect(back.crs).toBe(raster.crs);
    expect(back.metadata.units).toEqual(raster.metadata.units);
    back.transform.forEach((value, index) => expect(value).toBeCloseTo(raster.transform[index], 9));
  });

  it('refuses what ERS cannot store', () => {
    expect(() => encodeErs(ramp({ transform: [1, 0.1, 0, 0.1, -1, 0] }))).toThrow(/north-up/);
    expect(() => encodeErs(ramp(), { dtype: 'uint8', nodata: 255 })).not.toThrow();
    expect(() => encodeErs(ramp(), { dtype: 'uint8', nodata: 0 })).toThrow(/also occurs as data/);
    expect(() => encodeErs(combineGeophysicsRasters(ramp(), 30, 'multiply'), { dtype: 'uint8' })).toThrow(/fit/);
    const gappy = ramp();
    gappy.data[0][0][0] = null;
    expect(() => encodeErs(gappy, { dtype: 'int16' })).toThrow(/nodata/);
    expect(() => encodeErs(ramp(), { dtype: 'complex' })).toThrow(/cannot write/);
    expect(ersCoordinateSpace('EPSG:7850')).toEqual(['GDA2020', 'MGA50', 'EN']);
    expect(ersCoordinateSpace(4326)).toEqual(['WGS84', 'GEODETIC', 'LATLONG']);
    expect(ersCoordinateSpace('EPSG:3857')).toEqual(['RAW', 'RAW', 'EN']);
    expect(ersCoordinateSpace(28348)).toEqual(['GDA94', 'MGA48', 'EN']);
    expect(ersCoordinateSpace(7859)).toEqual(['GDA2020', 'MGA59', 'EN']);
    expect(ersCoordinateSpace(7845)).toEqual(['RAW', 'RAW', 'EN']);
  });

  it.each([
    ['north-up float32', {}, {}],
    ['geographic float64', { crs: 'EPSG:4283', transform: [0.0025, 0, 118.1, 0, -0.0025, -27.5] }, { dtype: 'float64' }],
    ['rotated', { transform: [8.66, 5, 500000, 5, -8.66, 7000040] }, {}],
    ['int16 with nodata', { nodata: -32768 }, { dtype: 'int16' }],
  ])('round-trips a %s GeoTIFF through loadGeoTiff', async (_, options, encodeOptions) => {
    const raster = ramp(options);
    raster.data[0][1][1] = options.nodata ?? null;
    const back = await loadGeoTiff(encodeGeoTiff(raster, encodeOptions));
    expect(back.crs).toBe(raster.crs);
    expect(back.metadata.units).toEqual(raster.metadata.units);
    back.transform.forEach((value, index) => expect(value).toBeCloseTo(raster.transform[index], 9));
    expect(back.data[0][1][1] === null || back.data[0][1][1] === back.nodata).toBe(true);
    expect(back.data[0][3]).toEqual([30, 31, 32, 33, 34]);
  });

  it('refuses to turn data into nulls', () => {
    const sample = createGeophysicsRaster({ data: [[-99999, 1]], transform: [1, 0, 0, 0, -1, 1] });
    expect(() => encodeErs(sample)).toThrow(/also occurs as data/);
    expect(readErs(...Object.values(encodeErs(sample, { nodata: -1e30 }))).data[0][0]).toEqual([-99999, 1]);
    expect(() => encodeGeoTiff(sample)).not.toThrow();
    const gappy = createGeophysicsRaster({ data: [[null, 1]], transform: [1, 0, 0, 0, -1, 1] });
    expect(() => encodeErs(gappy, { dtype: 'uint8', nodata: -99999 })).toThrow(/does not fit uint8/);
    expect(() => encodeGeoTiff(gappy, { dtype: 'int16', nodata: 1.5 })).toThrow(/does not fit int16/);
  });

  it('refuses values too large for float32', () => {
    const big = createGeophysicsRaster({ data: [[1e40, 1]], transform: [1, 0, 0, 0, -1, 1] });
    expect(() => encodeGeoTiff(big)).toThrow(/float64/);
    expect(readErs(...Object.values(encodeErs(big, { dtype: 'float64' }))).data[0][0][0]).toBe(1e40);
    const gappy = createGeophysicsRaster({ data: [[null, 1]], transform: [1, 0, 0, 0, -1, 1] });
    expect(() => encodeErs(gappy, { nodata: -1e40 })).toThrow(/too large/);
  });

  it('takes the GeoTIFF model type from what is known about the CRS', async () => {
    const { fromArrayBuffer } = await import('geotiff');
    const keysOf = async (raster) => (await (await fromArrayBuffer(encodeGeoTiff(raster))).getImage()).getGeoKeys();
    // EPSG:4087 is projected (World Equidistant Cylindrical) despite its number.
    expect((await keysOf(ramp({ crs: 'EPSG:4087', metadata: { crs_units: 'metre' } }))).ProjectedCSTypeGeoKey).toBe(4087);
    expect((await keysOf(ramp({ crs: 'EPSG:6668', metadata: { crs_units: 'degree' } }))).GeographicTypeGeoKey).toBe(6668);
    expect(() => encodeGeoTiff(ramp({ crs: 'EPSG:6668' }))).toThrow(/crs_units/);
    // Units survive a save, load and save again.
    const albers = await loadGeoTiff(encodeGeoTiff(ramp({ crs: 'EPSG:3577', metadata: { crs_units: 'metre' } })));
    expect(albers.metadata.crs_units).toBe('metre');
    expect(() => encodeGeoTiff(albers)).not.toThrow();
    expect((await loadGeoTiff(encodeGeoTiff(ramp()))).metadata.crs_units).toBe('metre');
  });

  it('writes GDA2020 lat/long as a geographic GeoTIFF', async () => {
    const raster = ramp({ crs: 'EPSG:7844', transform: [0.0025, 0, 118.1, 0, -0.0025, -27.5] });
    const { fromArrayBuffer } = await import('geotiff');
    const keys = (await (await fromArrayBuffer(encodeGeoTiff(raster))).getImage()).getGeoKeys();
    expect(keys.GTModelTypeGeoKey).toBe(2);
    expect(keys.GeographicTypeGeoKey).toBe(7844);
    expect(keys.ProjectedCSTypeGeoKey).toBeUndefined();
  });

  it('writes multi-band GeoTIFFs', async () => {
    const raster = createGeophysicsRaster({
      data: [[[1, 2], [3, 4]], [[5, 6], [7, null]]],
      transform: [1, 0, 0, 0, -1, 2],
      crs: 'EPSG:32750',
      bandNames: ['a', 'b'],
    });
    const back = await loadGeoTiff(encodeGeoTiff(raster));
    expect(back.bandCount).toBe(2);
    expect(back.data[1]).toEqual([[5, 6], [7, null]]);
  });
});

// Frozen binary fixtures exercise legacy exports; provenance interoperability
// is checked separately with dynamic producer versions.
describe('files for Python', () => {
  // The fixture's ERS raster, written by this encoder for Python to read.
  const raster = editing.ersWriter.raster;
  const outputs = {
    'geophysics_js_written.tif': () => new Uint8Array(encodeGeoTiff(raster, { includeProvenance: false })),
    'geophysics_js_written.ers': () => encodeErs(raster, { name: 'geophysics_js_written.ers', includeProvenance: false }).header,
    geophysics_js_written: () => new Uint8Array(encodeErs(raster, { name: 'geophysics_js_written.ers', includeProvenance: false }).data),
  };

  it.each(Object.keys(outputs))('%s is current', (file) => {
    const current = outputs[file]();
    if (process.env.UPDATE_GEOPHYSICS_FIXTURES) writeFileSync(DATA_DIR + file, current);
    const committed = readFileSync(DATA_DIR + file);
    if (typeof current === 'string') expect(committed.toString('latin1')).toBe(current);
    else expect(Buffer.compare(committed, Buffer.from(current))).toBe(0);
  });
});

it('is exported from the worker-safe entry', () => {
  for (const name of [
    'cropGeophysicsRaster', 'clipGeophysicsRaster', 'combineGeophysicsRasters', 'fillGeophysicsGaps',
    'GEOPHYSICS_COMBINE_OPERATIONS', 'encodeErs', 'encodeGeoTiff', 'ersCoordinateSpace',
  ]) {
    expect(geophysicsEntry[name], name).toBeDefined();
  }
});

it('retains selected GeoTIFF band units through full-resolution and decimated reads', async () => {
  const raster = createGeophysicsRaster({
    data: [[[1, 2], [3, 4]], [[5, 6], [7, 8]]],
    transform: [10, 0, 500000, 0, -10, 7000000], crs: 'EPSG:28350',
    metadata: { units: ['nT/m', 'degree'] },
  });
  const encoded = encodeGeoTiff(raster);
  for (const maxCells of [undefined, 1]) {
    const result = await loadGeoTiff(encoded, { samples: [1, 0], maxCells });
    expect(result.metadata.units).toEqual(['degree', 'nT/m']);
  }
});
