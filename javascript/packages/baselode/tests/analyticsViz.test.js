/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import {
  asNumeric,
  collectNumericValues,
  groupRowsBy,
  buildCategoricalColourResolver,
  NULLISH_CATEGORY,
} from '../src/viz/analyticsViz.js';
import { buildScatterPlotConfig } from '../src/viz/scatterViz.js';
import { buildHistogramPlotConfig } from '../src/viz/histogramViz.js';
import { buildBoxPlotConfig } from '../src/viz/boxPlotViz.js';
import { buildViolinPlotConfig } from '../src/viz/violinPlotViz.js';
import { buildTernaryPlotConfig } from '../src/viz/ternaryPlotViz.js';

const SAMPLE = [
  { hole_id: 'A', au_ppm: 0.1, ag_ppm: 2.0, cu_pct: 0.5, lithology: 'granite' },
  { hole_id: 'A', au_ppm: 0.4, ag_ppm: 8.0, cu_pct: 0.7, lithology: 'granite' },
  { hole_id: 'B', au_ppm: 1.2, ag_ppm: 12.0, cu_pct: 0.2, lithology: 'schist' },
  { hole_id: 'B', au_ppm: 0.8, ag_ppm: 9.0, cu_pct: 0.1, lithology: 'schist' },
  { hole_id: 'C', au_ppm: null, ag_ppm: 5.0, cu_pct: 0.3, lithology: 'basalt' },
];

describe('analytics helpers', () => {
  it('asNumeric coerces numeric strings and rejects junk', () => {
    expect(asNumeric(1.5)).toBe(1.5);
    expect(asNumeric('2')).toBe(2);
    expect(asNumeric('')).toBeNull();
    expect(asNumeric(null)).toBeNull();
    expect(asNumeric('abc')).toBeNull();
    expect(asNumeric(NaN)).toBeNull();
  });

  it('groupRowsBy partitions and collapses missing into the (missing) bucket', () => {
    const rows = [
      { litho: 'granite' }, { litho: 'schist' }, { litho: 'granite' }, { litho: null },
    ];
    const groups = groupRowsBy(rows, 'litho');
    expect(groups).toHaveLength(3);
    const keys = groups.map((group) => group.key);
    expect(keys).toContain('granite');
    expect(keys).toContain('schist');
    expect(keys).toContain(NULLISH_CATEGORY);
  });

  it('collectNumericValues skips non-numeric and missing', () => {
    const { values, sourceRows } = collectNumericValues(SAMPLE, 'au_ppm');
    expect(values).toEqual([0.1, 0.4, 1.2, 0.8]);
    expect(sourceRows).toHaveLength(4);
  });

  it('buildCategoricalColourResolver returns fallback for unknown groups', () => {
    const resolve = buildCategoricalColourResolver({ granite: '#aaa' }, '#fff');
    expect(resolve('granite')).toBe('#aaa');
    expect(resolve('schist')).toBe('#fff');
  });

  it('buildCategoricalColourResolver tolerates an unknown built-in name', () => {
    const resolve = buildCategoricalColourResolver('does-not-exist', '#fff');
    expect(resolve('granite')).toBe('#fff');
  });
});

describe('buildScatterPlotConfig', () => {
  it('emits a single trace when colorBy is absent', () => {
    const { data, layout } = buildScatterPlotConfig(SAMPLE, { xProp: 'au_ppm', yProp: 'ag_ppm' });
    expect(data).toHaveLength(1);
    expect(data[0].x).toEqual([0.1, 0.4, 1.2, 0.8]);
    expect(data[0].y).toEqual([2.0, 8.0, 12.0, 9.0]);
    expect(layout.xaxis.title.text).toBe('au_ppm');
    expect(layout.yaxis.title.text).toBe('ag_ppm');
  });

  it('emits one trace per group when colorBy is set', () => {
    const { data } = buildScatterPlotConfig(SAMPLE, {
      xProp: 'au_ppm', yProp: 'ag_ppm', colorBy: 'lithology',
    });
    const names = data.map((trace) => trace.name).sort();
    expect(names).toEqual(['granite', 'schist']);
    const granite = data.find((trace) => trace.name === 'granite');
    expect(granite.x).toEqual([0.1, 0.4]);
  });

  it('returns an empty config when xProp or yProp is missing', () => {
    expect(buildScatterPlotConfig(SAMPLE, { xProp: 'au_ppm' }).data).toEqual([]);
  });

  it('honours log axes', () => {
    const { layout } = buildScatterPlotConfig(SAMPLE, {
      xProp: 'au_ppm', yProp: 'ag_ppm', log: { x: true, y: true },
    });
    expect(layout.xaxis.type).toBe('log');
    expect(layout.yaxis.type).toBe('log');
  });
});

describe('buildHistogramPlotConfig', () => {
  it('one trace without groupBy', () => {
    const { data } = buildHistogramPlotConfig(SAMPLE, { prop: 'au_ppm' });
    expect(data).toHaveLength(1);
    expect(data[0].x).toEqual([0.1, 0.4, 1.2, 0.8]);
  });

  it('overlaid traces with groupBy', () => {
    const { data, layout } = buildHistogramPlotConfig(SAMPLE, {
      prop: 'au_ppm', groupBy: 'lithology',
    });
    expect(layout.barmode).toBe('overlay');
    const names = data.map((trace) => trace.name).sort();
    expect(names).toEqual(['granite', 'schist']);
  });

  it('returns empty config without prop', () => {
    expect(buildHistogramPlotConfig(SAMPLE, {}).data).toEqual([]);
  });
});

describe('buildBoxPlotConfig', () => {
  it('one box without groupBy', () => {
    const { data, layout } = buildBoxPlotConfig(SAMPLE, { prop: 'au_ppm' });
    expect(data).toHaveLength(1);
    expect(data[0].type).toBe('box');
    expect(layout.showlegend).toBe(false);
  });

  it('one box per group when groupBy is set', () => {
    const { data, layout } = buildBoxPlotConfig(SAMPLE, {
      prop: 'au_ppm', groupBy: 'lithology',
    });
    const names = data.map((trace) => trace.name).sort();
    expect(names).toEqual(['granite', 'schist']);
    expect(layout.showlegend).toBe(true);
  });
});

describe('buildViolinPlotConfig', () => {
  it('emits violin traces with inner box on by default', () => {
    const { data } = buildViolinPlotConfig(SAMPLE, {
      prop: 'au_ppm', groupBy: 'lithology',
    });
    expect(data).toHaveLength(2);
    expect(data[0].type).toBe('violin');
    expect(data[0].box.visible).toBe(true);
  });

  it('respects showBox=false', () => {
    const { data } = buildViolinPlotConfig(SAMPLE, {
      prop: 'au_ppm', showBox: false,
    });
    expect(data[0].box.visible).toBe(false);
  });
});

describe('buildTernaryPlotConfig', () => {
  it('emits one trace per group with three-component points', () => {
    const { data, layout } = buildTernaryPlotConfig(SAMPLE, {
      aProp: 'au_ppm', bProp: 'ag_ppm', cProp: 'cu_pct',
      colorBy: 'lithology',
    });
    const granite = data.find((trace) => trace.name === 'granite');
    expect(granite).toBeTruthy();
    expect(granite.a).toEqual([0.1, 0.4]);
    expect(granite.b).toEqual([2.0, 8.0]);
    expect(granite.c).toEqual([0.5, 0.7]);
    expect(layout.ternary.aaxis.title.text).toBe('au_ppm');
  });

  it('skips rows where any of the three components is missing', () => {
    const { data } = buildTernaryPlotConfig(SAMPLE, {
      aProp: 'au_ppm', bProp: 'ag_ppm', cProp: 'cu_pct',
    });
    // Row C has au_ppm=null → dropped. So 4 points total (A×2 + B×2).
    expect(data[0].a).toHaveLength(4);
  });

  it('skips rows whose three components sum to zero', () => {
    const zeroSet = [{ x: 0, y: 0, z: 0 }];
    const { data } = buildTernaryPlotConfig(zeroSet, {
      aProp: 'x', bProp: 'y', cProp: 'z',
    });
    expect(data).toEqual([]);
  });

  it('skips rows where any component is negative', () => {
    const mixed = [
      { x: 1, y: 1, z: 1 },     // ok
      { x: -1, y: 5, z: 1 },    // a negative → skip
      { x: 2, y: -3, z: 1 },    // b negative → skip
      { x: 1, y: 1, z: -0.1 },  // c negative → skip
    ];
    const { data } = buildTernaryPlotConfig(mixed, {
      aProp: 'x', bProp: 'y', cProp: 'z',
    });
    expect(data).toHaveLength(1);
    expect(data[0].a).toEqual([1]);
    expect(data[0].b).toEqual([1]);
    expect(data[0].c).toEqual([1]);
  });

  it('returns empty config when any apex prop is missing', () => {
    expect(buildTernaryPlotConfig(SAMPLE, { aProp: 'au_ppm', bProp: 'ag_ppm' }).data).toEqual([]);
  });
});
