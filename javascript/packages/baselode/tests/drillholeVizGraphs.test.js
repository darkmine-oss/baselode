/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import {
  buildPlotConfig,
  buildMultiAssayConfig,
  buildPlotlyColorscale,
  assignCategoriesByDepth,
} from '../src/viz/drillholeViz.js';
import { ASSAY_COLOR_PALETTE_10 } from '../src/viz/assayColorScale.js';

// Numeric interval points sorted deep→shallow as buildIntervalPoints emits them.
const numericPoints = [
  { z: 25, val: 40, from: 20, to: 30, errorPlus: 5, errorMinus: 5 },
  { z: 15, val: 20, from: 10, to: 20, errorPlus: 5, errorMinus: 5 },
  { z: 5, val: 5, from: 0, to: 10, errorPlus: 5, errorMinus: 5 },
];

// Lithology colour-by segments covering the same hole depth.
const lithoSegments = [
  { from: 0, to: 12, val: 'SAP' },
  { from: 12, to: 30, val: 'BAS' },
];

describe('buildPlotlyColorscale', () => {
  it('maps a palette onto evenly spaced [0,1] stops', () => {
    const scale = buildPlotlyColorscale(['#000000', '#777777', '#ffffff']);
    expect(scale).toEqual([
      [0, '#000000'],
      [0.5, '#777777'],
      [1, '#ffffff'],
    ]);
  });

  it('handles a single-colour palette without dividing by zero', () => {
    expect(buildPlotlyColorscale(['#abcdef'])).toEqual([[0, '#abcdef'], [1, '#abcdef']]);
  });

  it('defaults to the assay palette and spans the full range', () => {
    const scale = buildPlotlyColorscale();
    expect(scale).toHaveLength(ASSAY_COLOR_PALETTE_10.length);
    expect(scale[0][0]).toBe(0);
    expect(scale[scale.length - 1][0]).toBe(1);
  });
});

describe('assignCategoriesByDepth', () => {
  it('assigns each numeric point the segment covering its mid-depth', () => {
    const cats = assignCategoriesByDepth(numericPoints, lithoSegments);
    // z=25 → BAS, z=15 → BAS, z=5 → SAP
    expect(cats).toEqual(['BAS', 'BAS', 'SAP']);
  });

  it('returns null for points outside every segment', () => {
    const cats = assignCategoriesByDepth([{ z: 100, from: 95, to: 105 }], lithoSegments);
    expect(cats).toEqual([null]);
  });

  it('ignores nan/empty category segments', () => {
    const cats = assignCategoriesByDepth(
      [{ z: 5, from: 0, to: 10 }],
      [{ from: 0, to: 10, val: 'NaN' }],
    );
    expect(cats).toEqual([null]);
  });
});

describe('strip-log hover', () => {
  it('uses a depth-unified (horizontal) hover across single-property chart types', () => {
    for (const chartType of ['markers+line', 'bar', 'line', 'colored-line']) {
      const { layout } = buildPlotConfig({
        points: numericPoints, isCategorical: false, property: 'Au', chartType,
      });
      expect(layout.hovermode).toBe('y unified');
    }
    // Categorical bands too.
    const cat = buildPlotConfig({
      points: [{ z: 5, val: 'SAP', from: 0, to: 10 }], isCategorical: true, property: 'geol', chartType: 'categorical',
    });
    expect(cat.layout.hovermode).toBe('y unified');
  });
});

describe('buildPlotConfig — numeric bar chart', () => {
  it('sizes each bar to its interval and uses no error bars', () => {
    const { data } = buildPlotConfig({
      points: numericPoints, isCategorical: false, property: 'Au', chartType: 'bar',
    });
    const [trace] = data;
    expect(trace.type).toBe('bar');
    expect(trace.orientation).toBe('h');
    // Bar thickness equals the interval length (to − from), all 10 m here.
    expect(trace.width).toEqual([10, 10, 10]);
    expect(trace.error_y).toBeUndefined();
  });

  it('keeps error bars on markers/line chart types', () => {
    const { data } = buildPlotConfig({
      points: numericPoints, isCategorical: false, property: 'Au', chartType: 'markers+line',
    });
    expect(data[0].error_y).toBeDefined();
    expect(data[0].width).toBeUndefined();
  });
});

describe('buildPlotConfig — graded (colored-line) chart type', () => {
  it('colours markers by value with a continuous scale and colour bar', () => {
    const { data, layout } = buildPlotConfig({
      points: numericPoints, isCategorical: false, property: 'Au', chartType: 'colored-line',
    });
    expect(data).toHaveLength(1);
    const [trace] = data;
    expect(trace.mode).toBe('lines+markers');
    expect(trace.marker.color).toEqual([40, 20, 5]);
    expect(trace.marker.showscale).toBe(true);
    expect(trace.marker.cmin).toBe(5);
    expect(trace.marker.cmax).toBe(40);
    expect(Array.isArray(trace.marker.colorscale)).toBe(true);
    // Right gutter is widened so the colour bar sits outside the plot area.
    expect(layout.margin.r).toBeGreaterThan(20);
  });
});

describe('buildPlotConfig — colour numeric by categorical', () => {
  it('emits one legend trace per category plus a neutral connecting line', () => {
    const { data, layout } = buildPlotConfig({
      points: numericPoints,
      isCategorical: false,
      property: 'Au',
      chartType: 'markers+line',
      colorBy: { property: 'lithology', segments: lithoSegments },
    });
    expect(layout.showlegend).toBe(true);
    const named = data.filter((t) => t.showlegend);
    const names = named.map((t) => t.name).sort();
    expect(names).toEqual(['BAS', 'SAP']);
    // A non-legend connecting line is present for the markers+line type.
    expect(data.some((t) => t.mode === 'lines' && t.showlegend === false)).toBe(true);
    // Category hover surfaces the colour-by label.
    expect(named[0].hovertemplate).toContain('lithology');
  });

  it('renders coloured horizontal bars when chartType is bar', () => {
    const { data } = buildPlotConfig({
      points: numericPoints,
      isCategorical: false,
      property: 'Au',
      chartType: 'bar',
      colorBy: { property: 'lithology', segments: lithoSegments },
    });
    const bars = data.filter((t) => t.type === 'bar');
    expect(bars.length).toBeGreaterThan(0);
    expect(bars.every((t) => t.orientation === 'h')).toBe(true);
    // Bar length is the value (x); depth extent is the per-bar width, not `base`.
    expect(bars.every((t) => t.base === undefined && Array.isArray(t.width))).toBe(true);
    // No connecting line for the bar variant.
    expect(data.some((t) => t.mode === 'lines')).toBe(false);
  });
});

describe('buildMultiAssayConfig', () => {
  const series = [
    { property: 'Au_ppm', points: numericPoints },
    {
      property: 'Cu_pct',
      points: [
        { z: 25, val: 0.8, from: 20, to: 30 },
        { z: 15, val: 0.4, from: 10, to: 20 },
        { z: 5, val: 0.1, from: 0, to: 10 },
      ],
    },
  ];

  it('stacks one raw-value area band per assay with a legend', () => {
    const { data, layout } = buildMultiAssayConfig({ series, mode: 'multi-line' });
    expect(data).toHaveLength(2);
    expect(data.every((t) => t.type === 'scatter')).toBe(true);
    // Bands are stacked (shared stackgroup, horizontal) rather than overlaid.
    expect(data.every((t) => t.stackgroup === 'assays' && t.orientation === 'h')).toBe(true);
    expect(data.every((t) => typeof t.fillcolor === 'string')).toBe(true);
    // Raw ppm values are plotted (not normalised).
    expect(data[0].x).toEqual([40, 20, 5]);
    expect(layout.showlegend).toBe(true);
    // Hover reports the raw value.
    expect(data[0].customdata[0][0]).toBe(40);
    // Depth-unified hover: one horizontal box per depth (the shared depth is the
    // box header, so the per-row template drops from/to).
    expect(layout.hovermode).toBe('y unified');
    expect(data[0].hovertemplate).not.toContain('from:');
    // The element label must precede the value — in unified mode `<extra>` hides
    // the trace name, so relying on colour alone would leave the row unlabelled.
    expect(data[0].hovertemplate).toMatch(/\S+: %\{customdata\[0\]:/);
    expect(data[0].hovertemplate).not.toMatch(/^%\{customdata\[0\]/);
    // Value is formatted (significant figures) to avoid float noise like
    // 0.0020000000949949.
    expect(data[0].hovertemplate).toContain('customdata[0]:.4~r');
  });

  it('aligns assays onto a shared depth grid so every hover row resolves', () => {
    // As is present only at one depth; Au at all three. After alignment both
    // series span the same grid, so no densified point is left without a value.
    const sparse = [
      { property: 'Au_ppm', points: numericPoints },
      { property: 'As_ppm', points: [{ z: 15, val: 5, from: 10, to: 20 }] },
    ];
    const { data } = buildMultiAssayConfig({ series: sparse, mode: 'multi-line' });
    expect(data[0].x).toHaveLength(3);
    expect(data[1].x).toHaveLength(3);
    // The two intervals As does not cover are filled with 0 (no gaps).
    expect(data[1].x).toEqual([0, 5, 0]);
    expect(data[1].customdata.every((cd) => Number.isFinite(cd[0]))).toBe(true);
  });

  it('stacks horizontal bars across assays', () => {
    const { data, layout } = buildMultiAssayConfig({ series, mode: 'multi-stacked' });
    expect(layout.barmode).toBe('stack');
    expect(data.every((t) => t.type === 'bar' && t.orientation === 'h')).toBe(true);
    expect(data[0].x).toEqual([40, 20, 5]);
    // Depth-unified hover lists every assay's value at the hovered depth.
    expect(layout.hovermode).toBe('y unified');
  });

  it('floors below-detection (negative) values at 0 but keeps the true value in hover', () => {
    // -2 is the below-detection-limit convention ("below 2 ppm"); a stacked bar
    // must not extend left of zero, but the hover should still report -2.
    const belowDetection = [
      { property: 'Bi_ppm', points: [
        { z: 25, val: -2, from: 20, to: 30 },
        { z: 15, val: 3, from: 10, to: 20 },
      ] },
    ];
    const { data } = buildMultiAssayConfig({ series: belowDetection, mode: 'multi-stacked' });
    // Bar length floored at 0 — no leftward bars.
    expect(data[0].x).toEqual([0, 3]);
    expect(Math.min(...data[0].x)).toBeGreaterThanOrEqual(0);
    // Hover customdata preserves the reported value (-2).
    expect(data[0].customdata[0][0]).toBe(-2);
    expect(data[0].hovertemplate).toContain('customdata[0]');
  });

  it('returns an empty config when no series have points', () => {
    expect(buildMultiAssayConfig({ series: [{ property: 'Au', points: [] }] }))
      .toEqual({ data: [], layout: {} });
  });

  it('is reachable through buildPlotConfig via the series option', () => {
    const { data } = buildPlotConfig({ chartType: 'multi-line', series, property: 'Au_ppm' });
    expect(data).toHaveLength(2);
  });
});
