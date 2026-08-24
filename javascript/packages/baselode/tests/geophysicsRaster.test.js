/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  createGeophysicsRaster,
  geophysicsRasterRange,
  getGeophysicsRasterBand,
} from '../src/data/geophysicsRaster.js';
import {
  geophysicsHillshade,
  normalizeGeophysicsClipRange,
  renderGeophysicsRaster,
} from '../src/viz/geophysicsRasterViz.js';

const payload = {
  data: [[[0, 10], [20, null]]],
  transform: [10, 0, 500000, 0, -10, 7000000],
  crs: 'EPSG:28351',
  nodata: -9999,
  bandNames: ['tmi'],
};

describe('geophysics raster contract', () => {
  it('normalizes a portable raster with dimensions, affine bounds, and metadata', () => {
    const raster = createGeophysicsRaster(payload);
    expect(raster.bandCount).toBe(1);
    expect(raster.width).toBe(2);
    expect(raster.height).toBe(2);
    expect(raster.bounds).toEqual({ minX: 500000, minY: 6999980, maxX: 500020, maxY: 7000000 });
    expect(raster.bandNames).toEqual(['tmi']);
  });

  it('supports a two-dimensional single-band input and one-based access', () => {
    const raster = createGeophysicsRaster({ data: [[1, 2], [3, 4]] });
    expect(getGeophysicsRasterBand(raster)).toEqual([[1, 2], [3, 4]]);
    expect(() => getGeophysicsRasterBand(raster, 2)).toThrow('between 1 and 1');
  });

  it('rejects ragged grids and mismatched band names', () => {
    expect(() => createGeophysicsRaster({ data: [[1], [2, 3]] })).toThrow('rectangular');
    expect(() => createGeophysicsRaster({ data: [[1]], bandNames: ['a', 'b'] })).toThrow('one name');
  });

  it('calculates ranges without null values or nodata', () => {
    expect(geophysicsRasterRange(createGeophysicsRaster(payload))).toEqual([0, 20]);
  });
});

describe('geophysics raster rendering', () => {
  it('uses the natural range by default and accepts explicit clip controls', () => {
    const raster = createGeophysicsRaster(payload);
    expect(normalizeGeophysicsClipRange(raster)).toEqual([0, 20]);
    expect(normalizeGeophysicsClipRange(raster, [5, 15])).toEqual([5, 15]);
    expect(() => normalizeGeophysicsClipRange(raster, [15, 5])).toThrow('greater');
  });

  it('returns transparent pixels for null cells and RGBA data for valid cells', () => {
    const rendered = renderGeophysicsRaster(createGeophysicsRaster(payload), {
      palette: 'grayscale',
      clipRange: [0, 20],
    });
    expect(rendered.data).toHaveLength(16);
    expect(rendered.data[0]).toBe(0);
    expect(rendered.data[3]).toBe(255);
    expect(rendered.data[15]).toBe(0);
  });

  it('calculates a bounded hillshade field', () => {
    const shade = geophysicsHillshade(createGeophysicsRaster({ data: [[0, 1], [2, 4]] }));
    expect(shade.flat().every((value) => value >= 0 && value <= 1)).toBe(true);
  });
});
