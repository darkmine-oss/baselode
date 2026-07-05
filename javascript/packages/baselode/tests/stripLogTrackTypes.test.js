/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import {
  buildPlotConfig,
  buildTwoCurveFillConfig,
  buildCompositionConfig,
} from '../src/viz/drillholeViz.js';
import {
  buildPointLogConfig,
  buildDepthAnnotationsConfig,
  buildDipAzimuthConfig,
} from '../src/viz/structuralViz.js';
import {
  LITHOLOGY_COLOURS,
  LITHOLOGY_PATTERNS,
  resolvePatternMap,
} from '../src/viz/colourMap.js';
import { CHART_OPTIONS, DISPLAY_NUMERIC } from '../src/data/columnMeta.js';
import { SerializableBaselodeStripLogTrackSchema } from '../src/tool-ui/schema.js';

// Numeric interval points sorted deep→shallow as buildIntervalPoints emits them.
const numericPoints = [
  { z: 25, val: 40, from: 20, to: 30, errorPlus: 5, errorMinus: 5 },
  { z: 15, val: 20, from: 10, to: 20, errorPlus: 5, errorMinus: 5 },
  { z: 5, val: 5, from: 0, to: 10, errorPlus: 5, errorMinus: 5 },
];

describe('CHART_OPTIONS — new numeric chart types', () => {
  it('appends filled-line / step-line / heat-strip after the existing entries', () => {
    const values = CHART_OPTIONS[DISPLAY_NUMERIC].map((option) => option.value);
    expect(values.slice(-3)).toEqual(['filled-line', 'step-line', 'heat-strip']);
    const byValue = Object.fromEntries(
      CHART_OPTIONS[DISPLAY_NUMERIC].map((option) => [option.value, option.label])
    );
    expect(byValue['filled-line']).toBe('Filled line');
    expect(byValue['step-line']).toBe('Stepped line');
    expect(byValue['heat-strip']).toBe('Heat strip');
  });
});

describe('buildPlotConfig — filled-line chart type', () => {
  it('draws a line filled toward x=0 with the series colour at low alpha', () => {
    const { data } = buildPlotConfig({
      points: numericPoints, isCategorical: false, property: 'value', chartType: 'filled-line',
    });
    expect(data).toHaveLength(1);
    const [trace] = data;
    expect(trace.mode).toBe('lines');
    expect(trace.fill).toBe('tozerox');
    expect(trace.fillcolor).toMatch(/^rgba\(.*0\.35\)$/);
    // Same points as `line` (interval mids), no error bars.
    expect(trace.y).toEqual([25, 15, 5]);
    expect(trace.error_y).toBeUndefined();
  });

  it('respects logScale on the value axis', () => {
    const { layout } = buildPlotConfig({
      points: numericPoints, isCategorical: false, property: 'value',
      chartType: 'filled-line', logScale: true,
    });
    expect(layout.xaxis.type).toBe('log');
  });
});

describe('buildPlotConfig — step-line chart type', () => {
  it('builds two vertices per interval, sorted shallow→deep, in one polyline', () => {
    const { data } = buildPlotConfig({
      points: numericPoints, isCategorical: false, property: 'value', chartType: 'step-line',
    });
    expect(data).toHaveLength(1);
    const [trace] = data;
    expect(trace.mode).toBe('lines');
    // (val, from) and (val, to) per interval, shallow→deep.
    expect(trace.x).toEqual([5, 5, 20, 20, 40, 40]);
    expect(trace.y).toEqual([0, 10, 10, 20, 20, 30]);
    // Connected polyline — no nulls inserted at gaps, no error bars.
    expect(trace.x.every((value) => value != null)).toBe(true);
    expect(trace.error_y).toBeUndefined();
  });

  it('still connects across a gap between intervals', () => {
    const gappyPoints = [
      { z: 45, val: 8, from: 40, to: 50 },
      { z: 5, val: 2, from: 0, to: 10 },
    ];
    const { data } = buildPlotConfig({
      points: gappyPoints, isCategorical: false, property: 'value', chartType: 'step-line',
    });
    expect(data[0].y).toEqual([0, 10, 40, 50]);
    expect(data[0].x).toEqual([2, 2, 8, 8]);
  });
});

describe('buildPlotConfig — heat-strip chart type', () => {
  it('renders full-width bars coloured by value on the assay ramp', () => {
    const { data, layout } = buildPlotConfig({
      points: numericPoints, isCategorical: false, property: 'value', chartType: 'heat-strip',
    });
    expect(data).toHaveLength(1);
    const [trace] = data;
    expect(trace.type).toBe('bar');
    expect(trace.orientation).toBe('h');
    // Dummy bar length 1 from base 0; the colour carries the value.
    expect(trace.x).toEqual([1, 1, 1]);
    expect(trace.base).toBe(0);
    expect(trace.width).toEqual([10, 10, 10]);
    expect(trace.marker.color).toEqual([40, 20, 5]);
    expect(trace.marker.cmin).toBe(5);
    expect(trace.marker.cmax).toBe(40);
    expect(trace.marker.showscale).toBe(true);
    expect(Array.isArray(trace.marker.colorscale)).toBe(true);
    // Hover reports the value + interval, never the dummy x.
    expect(trace.hovertemplate).toContain('%{customdata[2]}');
    expect(trace.hovertemplate).not.toContain('%{x}');
    // Fixed hidden x-axis.
    expect(layout.xaxis.range).toEqual([0, 1]);
    expect(layout.xaxis.fixedrange).toBe(true);
    expect(layout.xaxis.showticklabels).toBe(false);
    expect(layout.xaxis.title.text).toBeUndefined();
    // Right gutter widened for the colour bar.
    expect(layout.margin.r).toBeGreaterThan(20);
  });

  it('ignores logScale (no error, axis stays linear)', () => {
    const { layout } = buildPlotConfig({
      points: numericPoints, isCategorical: false, property: 'value',
      chartType: 'heat-strip', logScale: true,
    });
    expect(layout.xaxis.type).toBeUndefined();
  });
});

describe('buildPlotConfig — logScale option', () => {
  it('log-scales the value axis for the plain numeric chart types', () => {
    for (const chartType of ['bar', 'markers', 'markers+line', 'line', 'step-line']) {
      const { layout } = buildPlotConfig({
        points: numericPoints, isCategorical: false, property: 'value', chartType, logScale: true,
      });
      expect(layout.xaxis.type, chartType).toBe('log');
    }
  });

  it('defaults off and is ignored for colored-line', () => {
    const plain = buildPlotConfig({
      points: numericPoints, isCategorical: false, property: 'value', chartType: 'line',
    });
    expect(plain.layout.xaxis.type).toBeUndefined();
    const graded = buildPlotConfig({
      points: numericPoints, isCategorical: false, property: 'value',
      chartType: 'colored-line', logScale: true,
    });
    expect(graded.layout.xaxis.type).toBeUndefined();
  });
});

describe('buildTwoCurveFillConfig', () => {
  // A and B cross exactly at depth 10 (A: 1→3, B: 3→1 across mids 5 and 15).
  const hole = {
    id: 'H1',
    points: [
      { from: 0, to: 10, density: 1, neutron: 3 },
      { from: 10, to: 20, density: 3, neutron: 1 },
    ],
  };

  it('shades between the curves, flipping colour at the crossover', () => {
    const { data, layout } = buildTwoCurveFillConfig({
      hole, propertyA: 'density', propertyB: 'neutron', colorA: '#ff0000', colorB: '#0000ff',
    });
    // Two fill runs (anchor + tonextx each) + the two visible curves.
    expect(data).toHaveLength(6);
    const fills = data.filter((trace) => trace.fill === 'tonextx');
    expect(fills).toHaveLength(2);
    // Shallow run: B > A → colour B; deep run: A > B → colour A.
    expect(fills[0].fillcolor).toBe('rgba(0, 0, 255, 0.4)');
    expect(fills[1].fillcolor).toBe('rgba(255, 0, 0, 0.4)');
    // Fill machinery never hovers or appears in the legend.
    const helpers = data.filter((trace) => trace.showlegend === false);
    expect(helpers).toHaveLength(4);
    expect(helpers.every((trace) => trace.hoverinfo === 'skip')).toBe(true);
    // Crossing depth (10) is inserted into the fill runs so shading flips there.
    expect(fills[0].y[fills[0].y.length - 1]).toBeCloseTo(10, 9);
    expect(fills[1].y[0]).toBeCloseTo(10, 9);
    // Main curves carry hover and the legend.
    const curves = data.filter((trace) => trace.showlegend === true);
    expect(curves.map((trace) => trace.name)).toEqual(['density', 'neutron']);
    expect(curves.every((trace) => typeof trace.hovertemplate === 'string')).toBe(true);
    // Depth axis reversed as usual.
    expect(layout.yaxis.autorange).toBe('reversed');
  });

  it('supports logScale and returns empty when a property has no data', () => {
    const { layout } = buildTwoCurveFillConfig({
      hole, propertyA: 'density', propertyB: 'neutron', logScale: true,
    });
    expect(layout.xaxis.type).toBe('log');
    expect(buildTwoCurveFillConfig({ hole, propertyA: 'density', propertyB: 'missing' }))
      .toEqual({ data: [], layout: {} });
  });
});

describe('buildCompositionConfig', () => {
  const hole = {
    id: 'H1',
    points: [
      { from: 0, to: 10, sand: 2, silt: 1, clay: 1 },
      { from: 10, to: 20, sand: 0, silt: 0, clay: 0 },
      { from: 20, to: 30, sand: -1, silt: 2, clay: 0 },
    ],
  };

  it('stacks per-interval fractions with a fixed percent axis when normalized', () => {
    const { data, layout } = buildCompositionConfig({
      hole, properties: ['sand', 'silt', 'clay'],
    });
    expect(data).toHaveLength(3);
    expect(data.map((trace) => trace.name)).toEqual(['sand', 'silt', 'clay']);
    expect(layout.barmode).toBe('stack');
    expect(layout.bargap).toBe(0);
    expect(layout.xaxis.range).toEqual([0, 1]);
    expect(layout.xaxis.tickformat).toBe('.0%');
    expect(layout.xaxis.title.text).toBe('Fraction');
    // The all-zero interval (10–20) is skipped: two cells remain, deep→shallow.
    expect(data[0].y).toEqual([25, 5]);
    // Interval 0–10: 2/4, 1/4, 1/4. Interval 20–30: sand clamped to 0, silt 2/2.
    expect(data[0].x).toEqual([0, 0.5]);
    expect(data[1].x).toEqual([1, 0.25]);
    expect(data[2].x).toEqual([0, 0.25]);
    // Every interval's fractions sum to 1.
    const totals = data[0].x.map((_, cellIndex) => data.reduce(
      (total, trace) => total + trace.x[cellIndex], 0
    ));
    totals.forEach((total) => expect(total).toBeCloseTo(1, 9));
    // Negative raw value stays in the hover customdata ([raw, pct, from, to]).
    expect(data[0].customdata[0][0]).toBe(-1);
    expect(data[0].customdata[0].slice(2)).toEqual([20, 30]);
  });

  it('stacks raw values on an autoranged axis when normalize is false', () => {
    const { data, layout } = buildCompositionConfig({
      hole, properties: ['sand', 'silt', 'clay'], normalize: false,
    });
    expect(layout.xaxis.range).toBeUndefined();
    expect(layout.xaxis.tickformat).toBeUndefined();
    expect(data[0].x).toEqual([0, 2]);
    expect(data[1].x).toEqual([2, 1]);
  });

  it('colours components from the colour map with a colorway fallback', () => {
    const { data } = buildCompositionConfig({
      hole, properties: ['sand', 'silt'], colourMap: { sand: '#123456' },
    });
    expect(data[0].marker.color).toBe('#123456');
    expect(data[1].marker.color).not.toBe('#123456');
  });

  it('drops components with no readings instead of faking measured zeros', () => {
    const { data } = buildCompositionConfig({
      hole, properties: ['sand', 'no_such_column', 'silt'],
    });
    expect(data.map((trace) => trace.name)).toEqual(['sand', 'silt']);
  });
});

describe('categorical pattern fills', () => {
  const points = [
    { z: 5, val: 'sandstone', from: 0, to: 10 },
    { z: 15, val: 'coal', from: 10, to: 20 },
  ];

  it('applies the built-in lithology hatch as a light overlay on the band colour', () => {
    const { data } = buildPlotConfig({
      points, isCategorical: true, property: 'lith',
      chartType: 'categorical', colourMap: 'lithology', patternMap: 'lithology',
    });
    const sandstone = data.find((trace) => trace.name === 'sandstone');
    expect(sandstone.marker.pattern).toEqual({
      shape: '.',
      solidity: 0.3,
      fgcolor: '#ffffff',
      bgcolor: LITHOLOGY_COLOURS.sandstone,
      size: 6,
    });
    // coal has no mapped shape → solid band, no pattern dict at all.
    const coal = data.find((trace) => trace.name === 'coal');
    expect(coal.marker.pattern).toBeUndefined();
  });

  it('is case-insensitive and emits no pattern dicts without a patternMap', () => {
    const upper = buildPlotConfig({
      points: [{ z: 5, val: 'SANDSTONE', from: 0, to: 10 }],
      isCategorical: true, property: 'lith', chartType: 'categorical', patternMap: 'lithology',
    });
    expect(upper.data[0].marker.pattern.shape).toBe('.');
    const plain = buildPlotConfig({
      points, isCategorical: true, property: 'lith', chartType: 'categorical',
    });
    expect(plain.data.every((trace) => trace.marker.pattern === undefined)).toBe(true);
  });
});

describe('resolvePatternMap / LITHOLOGY_PATTERNS', () => {
  it('resolves the built-in name, passes objects through, rejects unknowns', () => {
    expect(resolvePatternMap('lithology')).toBe(LITHOLOGY_PATTERNS);
    expect(resolvePatternMap(null)).toEqual({});
    const custom = { sandstone: 'x' };
    expect(resolvePatternMap(custom)).toBe(custom);
    expect(() => resolvePatternMap('nope')).toThrow(RangeError);
    expect(() => resolvePatternMap(['x'])).toThrow(TypeError);
  });

  it('keeps pattern keys a subset of LITHOLOGY_COLOURS with valid shapes', () => {
    const validShapes = new Set(['/', '\\', 'x', '-', '|', '+', '.', '']);
    for (const [key, shape] of Object.entries(LITHOLOGY_PATTERNS)) {
      expect(LITHOLOGY_COLOURS, key).toHaveProperty(key);
      expect(validShapes.has(shape), `${key}: ${shape}`).toBe(true);
    }
  });
});

describe('buildPointLogConfig', () => {
  const rows = [
    { depth: 12.4, defect: 'joint' },
    { depth: 18.1, defect: 'fault' },
    { depth: 25.9, defect: 'joint' },
    { depth: 31.2, defect: 'vein' },
    { depth: 40.0, defect: null },
  ];

  it('assigns each category a distinct x slot, colour, and symbol with a legend', () => {
    const { data, layout } = buildPointLogConfig({ rows, categoryKey: 'defect' });
    // Alphabetical categories: fault, joint, vein (null row dropped).
    expect(data.map((trace) => trace.name)).toEqual(['fault', 'joint', 'vein']);
    expect(data[0].x).toEqual([0]);
    expect(data[1].x).toEqual([1, 1]);
    expect(data[2].x).toEqual([2]);
    const symbols = data.map((trace) => trace.marker.symbol);
    expect(new Set(symbols).size).toBe(3);
    const colours = data.map((trace) => trace.marker.color);
    expect(new Set(colours).size).toBe(3);
    expect(layout.showlegend).toBe(true);
    expect(layout.xaxis.tickvals).toEqual([0, 1, 2]);
    expect(layout.xaxis.ticktext).toEqual(['fault', 'joint', 'vein']);
    expect(layout.xaxis.range).toEqual([-0.5, 2.5]);
    expect(layout.yaxis.autorange).toBe('reversed');
  });

  it('accepts a hole object and returns empty for no usable rows', () => {
    const { data } = buildPointLogConfig({ hole: { id: 'H1', points: rows } });
    expect(data).toHaveLength(3);
    expect(buildPointLogConfig({ rows: [{ depth: 1, defect: 'NaN' }] }))
      .toEqual({ data: [], layout: {} });
  });
});

describe('buildDepthAnnotationsConfig', () => {
  const rows = [
    { depth: 10, comments: 'Broken core zone' },
    { depth: 55.5, comments: 'A very long annotation that definitely exceeds the forty character label budget' },
    { depth: 70, comments: '' },
  ];

  it('pins truncated text markers at depth with the full text in hover', () => {
    const { data, layout } = buildDepthAnnotationsConfig({ rows });
    expect(data).toHaveLength(1);
    const [trace] = data;
    expect(trace.mode).toBe('markers+text');
    expect(trace.marker.symbol).toBe('line-ew-open');
    expect(trace.x).toEqual([0, 0]);
    expect(trace.y).toEqual([10, 55.5]);
    expect(trace.textposition).toBe('middle right');
    // Long text word-truncated to ~40 chars with an ellipsis; hover keeps it all.
    expect(trace.text[1].endsWith('…')).toBe(true);
    expect(trace.text[1].length).toBeLessThanOrEqual(41);
    expect(trace.hovertext[1]).toContain('forty character label budget');
    expect(layout.xaxis.range).toEqual([0, 1]);
    expect(layout.xaxis.visible).toBe(false);
    expect(layout.yaxis.autorange).toBe('reversed');
  });

  it('drops missing-value sentinels instead of rendering them as labels', () => {
    const { data } = buildDepthAnnotationsConfig({
      rows: [
        { depth: 5, comments: 'Real note' },
        { depth: 10, comments: 'NaN' },
        { depth: 15, comments: ' None ' },
        { depth: 20, comments: 'NULL' },
        { depth: 25, comments: null },
      ],
    });
    expect(data).toHaveLength(1);
    expect(data[0].y).toEqual([5]);
    expect(data[0].hovertext).toHaveLength(1);
    expect(data[0].hovertext[0]).toContain('Real note');
  });
});

describe('buildDipAzimuthConfig', () => {
  const rows = [
    { depth: 10, dip: 45, azimuth: 90, defect: 'joint' },
    { depth: 20, dip: 60, azimuth: 270, defect: 'fault' },
    { depth: 30, dip: 30, azimuth: 180, defect: 'joint' },
  ];

  it('splits dip and azimuth into two fixed-range tracks over a shared depth axis', () => {
    const { data, layout } = buildDipAzimuthConfig({ rows });
    expect(data).toHaveLength(2);
    const [dipTrace, azTrace] = data;
    expect(dipTrace.xaxis).toBe('x');
    expect(dipTrace.x).toEqual([45, 60, 30]);
    expect(azTrace.xaxis).toBe('x2');
    expect(azTrace.x).toEqual([90, 270, 180]);
    expect(layout.xaxis.range).toEqual([0, 90]);
    expect(layout.xaxis2.range).toEqual([0, 360]);
    expect(layout.xaxis2.dtick).toBe(90);
    // Two non-overlapping domains, shared reversed depth axis, unified hover.
    expect(layout.xaxis.domain[1]).toBeLessThan(layout.xaxis2.domain[0]);
    expect(layout.yaxis.autorange).toBe('reversed');
    expect(layout.hovermode).toBe('y unified');
    expect(layout.showlegend).toBe(false);
  });

  it('emits one legendgrouped trace pair per colorBy category', () => {
    const { data, layout } = buildDipAzimuthConfig({ rows, colorBy: 'defect' });
    // fault + joint, each with a dip trace and an azimuth trace.
    expect(data).toHaveLength(4);
    const legendTraces = data.filter((trace) => trace.showlegend);
    expect(legendTraces.map((trace) => trace.name)).toEqual(['fault', 'joint']);
    // Both tracks toggle together via the shared legendgroup.
    const groups = data.map((trace) => trace.legendgroup);
    expect(groups.filter((group) => group === 'joint')).toHaveLength(2);
    expect(layout.showlegend).toBe(true);
  });
});

describe('tool-ui track schema — new fields', () => {
  it('accepts the new chart types plus logScale / usePatterns booleans', () => {
    const parsed = SerializableBaselodeStripLogTrackSchema.safeParse({
      property: 'au_ppm',
      chartType: 'heat-strip',
      logScale: true,
      usePatterns: true,
    });
    expect(parsed.success).toBe(true);
    for (const chartType of ['filled-line', 'step-line', 'heat-strip']) {
      expect(SerializableBaselodeStripLogTrackSchema.safeParse({
        property: 'au_ppm', chartType,
      }).success).toBe(true);
    }
    expect(SerializableBaselodeStripLogTrackSchema.safeParse({
      property: 'au_ppm', chartType: 'not-a-chart',
    }).success).toBe(false);
    expect(SerializableBaselodeStripLogTrackSchema.safeParse({
      property: 'au_ppm', logScale: 'yes',
    }).success).toBe(false);
  });
});
