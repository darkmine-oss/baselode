/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import {
  safeParseSerializableBaselodeScatterPlot,
  safeParseSerializableBaselodeHistogramPlot,
  safeParseSerializableBaselodeBoxPlot,
  safeParseSerializableBaselodeViolinPlot,
  safeParseSerializableBaselodeTernaryPlot,
} from '../src/tool-ui/schema.js';

const BASE = { id: 'plot-1', rows: [{ a: 1 }] };

describe('analytics tool-UI schemas', () => {
  it('scatter requires xProp and yProp', () => {
    expect(safeParseSerializableBaselodeScatterPlot({ ...BASE })).toBeNull();
    expect(safeParseSerializableBaselodeScatterPlot({
      ...BASE, xProp: 'au_ppm', yProp: 'ag_ppm',
    })).toMatchObject({ xProp: 'au_ppm', yProp: 'ag_ppm' });
  });

  it('scatter accepts a built-in colourMap name and a custom object', () => {
    expect(safeParseSerializableBaselodeScatterPlot({
      ...BASE, xProp: 'a', yProp: 'b', colourMap: 'lithology',
    })).toBeTruthy();
    expect(safeParseSerializableBaselodeScatterPlot({
      ...BASE, xProp: 'a', yProp: 'b', colourMap: { granite: '#aaa' },
    })).toBeTruthy();
  });

  it('histogram requires prop', () => {
    expect(safeParseSerializableBaselodeHistogramPlot({ ...BASE })).toBeNull();
    expect(safeParseSerializableBaselodeHistogramPlot({
      ...BASE, prop: 'au_ppm',
    })).toMatchObject({ prop: 'au_ppm' });
  });

  it('histogram bins must be a positive integer', () => {
    expect(safeParseSerializableBaselodeHistogramPlot({
      ...BASE, prop: 'a', bins: 30,
    })).toBeTruthy();
    expect(safeParseSerializableBaselodeHistogramPlot({
      ...BASE, prop: 'a', bins: -5,
    })).toBeNull();
  });

  it('box requires prop', () => {
    expect(safeParseSerializableBaselodeBoxPlot({ ...BASE })).toBeNull();
    expect(safeParseSerializableBaselodeBoxPlot({
      ...BASE, prop: 'au_ppm',
    })).toBeTruthy();
  });

  it('violin requires prop', () => {
    expect(safeParseSerializableBaselodeViolinPlot({ ...BASE })).toBeNull();
    expect(safeParseSerializableBaselodeViolinPlot({
      ...BASE, prop: 'au_ppm',
    })).toBeTruthy();
  });

  it('ternary requires the three apex props', () => {
    expect(safeParseSerializableBaselodeTernaryPlot({ ...BASE })).toBeNull();
    expect(safeParseSerializableBaselodeTernaryPlot({
      ...BASE, aProp: 'au', bProp: 'ag', cProp: 'cu',
    })).toBeTruthy();
  });

  it('ternary markerOpacity must be in [0, 1]', () => {
    expect(safeParseSerializableBaselodeTernaryPlot({
      ...BASE, aProp: 'au', bProp: 'ag', cProp: 'cu', markerOpacity: 0.5,
    })).toBeTruthy();
    expect(safeParseSerializableBaselodeTernaryPlot({
      ...BASE, aProp: 'au', bProp: 'ag', cProp: 'cu', markerOpacity: 1.5,
    })).toBeNull();
  });

  it('all schemas reject empty id', () => {
    const invalid = { ...BASE, id: '' };
    expect(safeParseSerializableBaselodeScatterPlot({ ...invalid, xProp: 'a', yProp: 'b' })).toBeNull();
    expect(safeParseSerializableBaselodeHistogramPlot({ ...invalid, prop: 'a' })).toBeNull();
    expect(safeParseSerializableBaselodeBoxPlot({ ...invalid, prop: 'a' })).toBeNull();
    expect(safeParseSerializableBaselodeViolinPlot({ ...invalid, prop: 'a' })).toBeNull();
    expect(safeParseSerializableBaselodeTernaryPlot({
      ...invalid, aProp: 'a', bProp: 'b', cProp: 'c',
    })).toBeNull();
  });
});
