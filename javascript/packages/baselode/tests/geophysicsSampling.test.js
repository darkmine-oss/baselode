/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Python generates the `sampling` cases in test/data/geophysics_reference.json
// (test/test_geophysics_reference.py); the browser implementation must agree.

import { describe, expect, it } from 'vitest';
import fixture from '../../../../test/data/geophysics_reference.json';
import { createGeophysicsRaster } from '../src/data/geophysicsRaster.js';
import {
  GEOPHYSICS_SAMPLING_METHODS,
  geophysicsProfileStations,
  sampleGeophysicsProfile,
  sampleGeophysicsRaster,
  sampleGeophysicsRows,
} from '../src/data/geophysicsSampling.js';
import { transformPoints } from '../src/extent/crs.js';
import * as geophysicsEntry from '../src/geophysics.js';

function expectValues(actual, expected, tolerance = 1e-7) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => {
    if (expected[index] === null) expect(value, `index ${index}`).toBeNull();
    else expect(value, `index ${index}`).toBeCloseTo(expected[index], -Math.log10(tolerance));
  });
}

// value = 10 * row + column, 10 m cells, top-left corner at (500000, 7000030)
function ramp({ crs = 'EPSG:28350', nodata = null, transform } = {}) {
  const data = Array.from({ length: 3 }, (_, row) => Array.from({ length: 4 }, (__, column) => 10 * row + column));
  return createGeophysicsRaster({ data, transform: transform ?? [10, 0, 500000, 0, -10, 7000030], crs, nodata });
}

const xy = (column, row) => [500000 + 10 * column, 7000030 - 10 * row];

describe('geophysics sampling reference', () => {
  const { raster, cases, profile } = fixture.sampling;

  it.each(cases.map((testCase) => [`${testCase.method} ${testCase.crs ?? 'native'}`, testCase]))(
    'matches Python for %s points',
    (_, { method, crs, points, values }) => {
      expectValues(sampleGeophysicsRaster(raster, points, { method, crs: crs ?? undefined }), values, crs ? 1e-5 : 1e-8);
    },
  );

  it('matches Python along a bent profile', () => {
    const result = sampleGeophysicsProfile(raster, profile.vertices, { spacing: profile.spacing });
    expectValues(result.map((station) => station.distance), profile.distance);
    expectValues(result.map((station) => station.x), profile.x);
    expectValues(result.map((station) => station.y), profile.y);
    expectValues(result.map((station) => station.value), profile.values);
  });
});

describe('sampleGeophysicsRaster', () => {
  it('is exact on a linear surface and returns nearest cells', () => {
    const points = [[0.5, 0.5], [1.75, 1.25], [2.5, 2.0], [3.2, 0.9]].map(([c, r]) => xy(c, r));
    expectValues(sampleGeophysicsRaster(ramp(), points), [0, 8.75, 17, 6.7]);
    const near = [[0.1, 0.2], [1.9, 2.7], [3.99, 1.5]].map(([c, r]) => xy(c, r));
    expect(sampleGeophysicsRaster(ramp(), near, { method: 'nearest' })).toEqual([0, 21, 13]);
  });

  it('uses edge cells within the grid and null outside it', () => {
    const edges = [[0, 0], [4, 3], [0.2, 1.5], [4, 1.5]].map(([c, r]) => xy(c, r));
    expectValues(sampleGeophysicsRaster(ramp(), edges), [0, 23, 10, 13]);
    const outside = [xy(-0.01, 1), xy(4.01, 1), xy(2, -0.5), xy(2, 3.5), [NaN, 7000000], null, { x: 'a', y: 1 }];
    for (const method of GEOPHYSICS_SAMPLING_METHODS) {
      expect(sampleGeophysicsRaster(ramp(), outside, { method })).toEqual(Array(outside.length).fill(null));
    }
  });

  it('makes samples that depend on missing cells null', () => {
    const raster = ramp({ nodata: -99999 });
    raster.data[0][1][1] = -99999;
    raster.data[0][2][3] = null;
    const points = [[1.5, 1.5], [1, 1], [0.5, 0.5], [3.5, 2.5], [2.5, 0.5]].map(([c, r]) => xy(c, r));
    expect(sampleGeophysicsRaster(raster, points)).toEqual([null, null, 0, null, 2]);
    expect(sampleGeophysicsRaster(raster, points, { method: 'nearest' })).toEqual([null, null, 0, null, 2]);
  });

  it('accepts {x, y} points and rotated transforms', () => {
    const angle = Math.PI / 6;
    const a = 10 * Math.cos(angle);
    const b = 10 * Math.sin(angle);
    const rotated = ramp({ transform: [a, b, 500000, b, -a, 7000030] });
    const [column, row] = [2.25, 1.6];
    const point = { x: a * column + b * row + 500000, y: b * column - a * row + 7000030 };
    expectValues(sampleGeophysicsRaster(rotated, [point]), [10 * 1.1 + 1.75]);
  });

  it('keeps cell centres intact despite affine rounding on rotated grids', () => {
    const angle = Math.PI / 6;
    const a = 10 * Math.cos(angle);
    const b = 10 * Math.sin(angle);
    const transform = [a, b, 500000, b, -a, 7000030];
    const at = (column, row) => [a * column + b * row + 500000, b * column - a * row + 7000030];
    const gappy = createGeophysicsRaster({ data: [[7, null], [null, null]], transform });
    expect(sampleGeophysicsRaster(gappy, [at(0.5, 0.5), at(2, 2)])).toEqual([7, null]);
    expectValues(sampleGeophysicsRaster(ramp({ transform }), [at(4, 3)]), [23]);
  });

  it('treats missing coordinates as missing rather than zero', () => {
    const origin = createGeophysicsRaster({ data: [[5, 6], [7, 8]], transform: [1, 0, -1, 0, -1, 1] });
    expect(sampleGeophysicsRaster(origin, [[0, 0]])).toEqual([6.5]);
    expect(sampleGeophysicsRaster(origin, [[null, null], { x: null, y: null }, ['', ''], [false, 0]]))
      .toEqual([null, null, null, null]);
  });

  it('reprojects points given in another CRS', () => {
    const points = [xy(1.3, 0.8), xy(2.6, 2.1)];
    const lonLat = transformPoints('EPSG:28350', 'EPSG:4283', points);
    expectValues(sampleGeophysicsRaster(ramp(), lonLat, { crs: 'EPSG:4283' }), sampleGeophysicsRaster(ramp(), points), 1e-6);
    expect(sampleGeophysicsRaster(ramp(), points, { crs: 28350 })).toEqual(sampleGeophysicsRaster(ramp(), points));
  });

  it('rejects unusable input', () => {
    expect(() => sampleGeophysicsRaster(ramp({ crs: null }), [xy(1, 1)], { crs: 'EPSG:4283' })).toThrow(/no CRS/);
    expect(() => sampleGeophysicsRaster(ramp({ transform: [1, 2, 0, 2, 4, 0] }), [[0, 0]])).toThrow(/invertible/);
    expect(() => sampleGeophysicsRaster(ramp(), [xy(1, 1)], { method: 'cubic' })).toThrow(/method/);
  });
});

describe('sampleGeophysicsRows', () => {
  it('adds a field without modifying the input rows', () => {
    const rows = [
      { hole_id: 'A', easting: xy(0.5, 0.5)[0], northing: xy(0.5, 0.5)[1] },
      { hole_id: 'B', easting: String(xy(1.5, 1.5)[0]), northing: xy(1.5, 1.5)[1] },
      { hole_id: 'C', easting: '', northing: xy(1, 1)[1] },
    ];
    const sampled = sampleGeophysicsRows(ramp(), rows);
    expect(rows[0]).not.toHaveProperty('band_1');
    expect(sampled.map((row) => row.band_1)).toEqual([0, 11, null]);
    const named = sampleGeophysicsRows(
      ramp(),
      rows.map(({ easting, northing }) => ({ x: easting, y: northing })),
      { xField: 'x', yField: 'y', field: 'bouguer', method: 'nearest' },
    );
    expect(named.map((row) => row.bouguer)).toEqual([0, 11, null]);
  });
});

describe('geophysicsProfileStations', () => {
  it('follows bends and ends on the last vertex', () => {
    const stations = geophysicsProfileStations([[0, 0], [30, 0], { x: 30, y: 25 }], 20);
    expect(stations).toEqual([
      { distance: 0, x: 0, y: 0 },
      { distance: 20, x: 20, y: 0 },
      { distance: 40, x: 30, y: 10 },
      { distance: 55, x: 30, y: 25 },
    ]);
    expect(geophysicsProfileStations([[0, 0], [0, 0], [40, 0]], 10).map((s) => s.distance)).toEqual([0, 10, 20, 30, 40]);
  });

  it.each([
    [[[0, 0]], 10],
    [[[0, 0], [0, 0]], 10],
    [[[0, 0], [10, 0]], 0],
    [[[0, 0], [NaN, 0]], 5],
  ])('rejects %j with spacing %s', (vertices, spacing) => {
    expect(() => geophysicsProfileStations(vertices, spacing)).toThrow(RangeError);
  });
});

// The main entry's exports are checked by test/test_parity_contract.py.
it('is exported from the worker-safe entry', () => {
  for (const entry of [geophysicsEntry]) {
    for (const name of ['sampleGeophysicsRaster', 'sampleGeophysicsRows', 'sampleGeophysicsProfile', 'geophysicsProfileStations', 'GEOPHYSICS_SAMPLING_METHODS']) {
      expect(entry[name], name).toBeDefined();
    }
  }
});
