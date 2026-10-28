/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Python generates test/data/geophysics_reference.json
// (test/test_geophysics_reference.py); the browser renderer must agree.

import { describe, expect, it } from 'vitest';
import fixture from '../../../../test/data/geophysics_reference.json';
import { createGeophysicsRaster } from '../src/data/geophysicsRaster.js';
import { createGeophysicsStretch } from '../src/viz/geophysicsColorScales.js';
import {
  geophysicsHillshade,
  geophysicsHillshadeZFactor,
  renderGeophysicsRaster,
} from '../src/viz/geophysicsRasterViz.js';

const raster = createGeophysicsRaster(fixture.raster);
const band = raster.data[0];

function expectGridClose(actual, expected) {
  expected.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
    const cell = actual[rowIndex][columnIndex];
    if (value === null) expect(Number.isNaN(cell)).toBe(true);
    else expect(cell).toBeCloseTo(value, 9);
  }));
}

describe('geophysics Python parity', () => {
  it('computes the same automatic vertical exaggeration', () => {
    expect(geophysicsHillshadeZFactor(raster)).toBeCloseTo(fixture.zFactorAuto, 12);
  });

  it.each(fixture.hillshade.map((testCase) => [testCase.name, testCase]))('hillshade %s', (_, testCase) => {
    expectGridClose(geophysicsHillshade(raster, testCase.options), testCase.shade);
  });

  it.each(fixture.stretches.map((testCase) => [testCase.stretch.mode, testCase]))('%s stretch', (_, testCase) => {
    const scale = createGeophysicsStretch(band.flat(), testCase.stretch, raster.nodata);
    expect(scale.limits[0]).toBeCloseTo(testCase.limits[0], 9);
    expect(scale.limits[1]).toBeCloseTo(testCase.limits[1], 9);
    expectGridClose(band.map((row) => row.map(scale.toRatio)), testCase.ratios);
  });

  it.each(fixture.renders.map((testCase) => [testCase.palette, testCase]))('%s RGBA render', (_, testCase) => {
    const rendered = renderGeophysicsRaster(raster, testCase);
    const differences = Array.from(rendered.data, (value, index) => Math.abs(value - testCase.rgba[index]));
    // Floating-point order can move a channel across a rounding boundary.
    expect(Math.max(...differences)).toBeLessThanOrEqual(1);
    expect(differences.filter((difference) => difference > 0).length).toBeLessThan(differences.length / 20);
  });
});
