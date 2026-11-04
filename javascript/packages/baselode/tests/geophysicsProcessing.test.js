/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Python generates the `processing` cases in test/data/geophysics_reference.json
// (test/test_geophysics_reference.py); the browser implementation must agree.

import { describe, expect, it } from 'vitest';
import fixture from '../../../../test/data/geophysics_reference.json';
import { createGeophysicsRaster } from '../src/data/geophysicsRaster.js';
import {
  GEOPHYSICS_OPERATIONS,
  fftSize,
  geophysicsAnalyticSignal,
  geophysicsReduceToPole,
  geophysicsTiltDerivative,
  geophysicsTotalHorizontalDerivative,
  geophysicsUpwardContinuation,
  geophysicsVerticalDerivative,
  processGeophysicsRaster,
  symmetricIndices,
} from '../src/data/geophysicsProcessing.js';

const CELL = 10;
const NORTH_UP = [CELL, 0, 500000, 0, -CELL, 7000000];

function grid(rows, columns, valueAt) {
  return Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (__, column) => valueAt(row, column)));
}

function rasterOf(values, transform = NORTH_UP) {
  return createGeophysicsRaster({ data: values, transform });
}

function dipoleTmi(inclination, declination, size = 64, depth = 40) {
  const i = (inclination * Math.PI) / 180;
  const d = (declination * Math.PI) / 180;
  const field = [Math.cos(i) * Math.sin(d), Math.cos(i) * Math.cos(d), Math.sin(i)];
  return grid(size, size, (row, column) => {
    const east = (column - size / 2) * CELL;
    const north = -(row - size / 2) * CELL;
    const down = -depth;
    const distance = Math.hypot(east, north, down);
    const along = (field[0] * east + field[1] * north + field[2] * down) / distance;
    return (1e7 * (3 * along ** 2 - 1)) / distance ** 3;
  });
}

function argmax(values) {
  let best = [0, 0];
  values.forEach((row, rowIndex) => row.forEach((value, column) => {
    if (value > values[best[0]][best[1]]) best = [rowIndex, column];
  }));
  return best;
}

describe('geophysics processing Python parity', () => {
  const raster = createGeophysicsRaster(fixture.processing.raster);

  it('covers every operation', () => {
    expect(new Set(fixture.processing.cases.map((testCase) => testCase.operation))).toEqual(new Set(GEOPHYSICS_OPERATIONS));
  });

  it.each(fixture.processing.cases.map((testCase) => [testCase.name, testCase]))('%s', (_, testCase) => {
    const result = processGeophysicsRaster(raster, testCase.operation, testCase.options);
    expect(result.metadata.processing.at(-1)).toEqual(testCase.step);
    expect(result.nodata).toBeNull();
    testCase.data.forEach((band, bandIndex) => band.forEach((row, rowIndex) => row.forEach((value, column) => {
      const cell = result.data[bandIndex][rowIndex][column];
      if (value === null) expect(cell).toBeNull();
      else expect(cell).toBeCloseTo(value, Math.abs(value) > 1 ? 8 : 9);
    })));
  });
});

describe('geophysics enhancements', () => {
  it('scales a wave by its wavenumber and continues it upwards', () => {
    const wavelength = 16;
    const values = grid(64, 64, (_, column) => Math.cos((2 * Math.PI * column) / wavelength));
    const k = (2 * Math.PI) / (wavelength * CELL);
    const first = geophysicsVerticalDerivative(rasterOf(values)).data[0];
    const continued = geophysicsUpwardContinuation(rasterOf(values), { height: 25 }).data[0];
    for (let row = 16; row < 48; row += 1) {
      for (let column = 16; column < 48; column += 1) {
        expect(Math.abs(first[row][column] - k * values[row][column])).toBeLessThan(0.02 * k);
        expect(Math.abs(continued[row][column] - Math.exp(-k * 25) * values[row][column])).toBeLessThan(0.01);
      }
    }
  });

  it('reduces a southern-hemisphere dipole anomaly to over its source', () => {
    const tmi = dipoleTmi(-55, 2);
    const reduced = geophysicsReduceToPole(rasterOf(tmi), { inclination: -55, declination: 2 }).data[0];
    const [row, column] = argmax(reduced);
    expect(Math.abs(row - 32)).toBeLessThanOrEqual(1);
    expect(Math.abs(column - 32)).toBeLessThanOrEqual(1);
    expect(argmax(tmi)).not.toEqual([row, column]);
    expect(() => geophysicsReduceToPole(rasterOf(tmi), { inclination: -10, declination: 0 })).toThrow(/unstable/);
  });

  it('gives a flat field zero tilt rather than rounding noise', () => {
    const flat = createGeophysicsRaster({ data: grid(8, 8, () => 50000), transform: [10, 0, 0, 0, -10, 0] });
    expect(geophysicsTiltDerivative(flat).data[0].flat()).toEqual(Array(64).fill(0));
  });

  it('keeps gaps missing and the analytic signal at least the horizontal gradient', () => {
    const values = grid(24, 20, (row, column) => 50 * Math.exp(-((row - 12) ** 2 + (column - 9) ** 2) / 10));
    values[5][6] = null;
    const raster = rasterOf(values);
    const signal = geophysicsAnalyticSignal(raster).data[0];
    const horizontal = geophysicsTotalHorizontalDerivative(raster).data[0];
    expect(signal[5][6]).toBeNull();
    signal.forEach((row, rowIndex) => row.forEach((value, column) => {
      if (value !== null) expect(value).toBeGreaterThanOrEqual(horizontal[rowIndex][column] - 1e-12);
    }));
  });

  it('validates operations and options', () => {
    const raster = rasterOf(grid(8, 8, (row, column) => row + column));
    expect(() => processGeophysicsRaster(raster, 'sharpen')).toThrow(/Unknown geophysics operation/);
    expect(() => processGeophysicsRaster(raster, 'low_pass', { wavelength: -1 })).toThrow(/positive/);
    expect(() => processGeophysicsRaster(raster, 'band_pass', { longWavelength: 10, shortWavelength: 20 }))
      .toThrow(/less than/);
    expect(() => processGeophysicsRaster(raster, 'vertical_derivative', { order: 0 })).toThrow(/order/);
    expect(() => processGeophysicsRaster(raster, 'horizontal_derivative', { direction: 'up' })).toThrow(/direction/);
    expect(() => processGeophysicsRaster(raster, 'upward_continuation', { height: 0 })).toThrow(/height/);
  });

  it('mirror-pads to a power of two like Python', () => {
    expect(symmetricIndices(3, 4, 16)).toEqual([2, 2, 1, 0, 0, 1, 2, 2, 1, 0, 0, 1, 2, 2, 1, 0]);
    expect([1, 2, 3, 64, 65].map(fftSize)).toEqual([1, 2, 4, 64, 128]);
  });
});
