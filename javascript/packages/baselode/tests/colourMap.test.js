/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import {
  BUILTIN_COLOUR_MAPS,
  COMMODITY_COLOURS,
  FALLBACK_COLOUR,
  LITHOLOGY_COLOURS,
  getColour,
  resolveColourMap,
} from '../src/viz/colourMap.js';

import {
  buildCategoricalStripLogConfig,
  buildPlotConfig,
} from '../src/viz/drillholeViz.js';


// ---------------------------------------------------------------------------
// Built-in maps
// ---------------------------------------------------------------------------

describe('built-in colour maps', () => {
  it('COMMODITY_COLOURS contains core elements', () => {
    for (const elem of ['Cu', 'Au', 'Fe', 'Ni']) {
      expect(COMMODITY_COLOURS).toHaveProperty(elem);
    }
  });

  it('LITHOLOGY_COLOURS contains core categories', () => {
    for (const lith of ['BIF', 'shale', 'granite', 'basalt']) {
      expect(LITHOLOGY_COLOURS).toHaveProperty(lith);
    }
  });

  it('BUILTIN_COLOUR_MAPS registry contains commodity and lithology', () => {
    expect(BUILTIN_COLOUR_MAPS).toHaveProperty('commodity');
    expect(BUILTIN_COLOUR_MAPS).toHaveProperty('lithology');
    expect(BUILTIN_COLOUR_MAPS.commodity).toBe(COMMODITY_COLOURS);
    expect(BUILTIN_COLOUR_MAPS.lithology).toBe(LITHOLOGY_COLOURS);
  });

  it('all commodity colours are strings', () => {
    for (const [key, val] of Object.entries(COMMODITY_COLOURS)) {
      expect(typeof val).toBe('string', `COMMODITY_COLOURS[${key}] is not a string`);
    }
  });

  it('all lithology colours are strings', () => {
    for (const [key, val] of Object.entries(LITHOLOGY_COLOURS)) {
      expect(typeof val).toBe('string', `LITHOLOGY_COLOURS[${key}] is not a string`);
    }
  });
});


// ---------------------------------------------------------------------------
// getColour
// ---------------------------------------------------------------------------

describe('getColour', () => {
  it('returns the exact-match colour', () => {
    expect(getColour('Cu', COMMODITY_COLOURS)).toBe(COMMODITY_COLOURS.Cu);
  });

  it('is case-insensitive', () => {
    expect(getColour('cu', COMMODITY_COLOURS)).toBe(COMMODITY_COLOURS.Cu);
    expect(getColour('GRANITE', LITHOLOGY_COLOURS)).toBe(LITHOLOGY_COLOURS.granite);
  });

  it('returns FALLBACK_COLOUR for unknown values', () => {
    expect(getColour('Unobtanium', COMMODITY_COLOURS)).toBe(FALLBACK_COLOUR);
  });

  it('accepts a custom fallback', () => {
    expect(getColour('Unobtanium', COMMODITY_COLOURS, '#123456')).toBe('#123456');
  });

  it('returns fallback for null value', () => {
    expect(getColour(null, COMMODITY_COLOURS)).toBe(FALLBACK_COLOUR);
  });

  it('returns fallback for empty map', () => {
    expect(getColour('Cu', {})).toBe(FALLBACK_COLOUR);
  });

  it('returns fallback for null map', () => {
    expect(getColour('Cu', null)).toBe(FALLBACK_COLOUR);
  });
});


// ---------------------------------------------------------------------------
// resolveColourMap
// ---------------------------------------------------------------------------

describe('resolveColourMap', () => {
  it('returns empty object for null', () => {
    expect(resolveColourMap(null)).toEqual({});
  });

  it('returns empty object for undefined', () => {
    expect(resolveColourMap(undefined)).toEqual({});
  });

  it('resolves "commodity" to COMMODITY_COLOURS', () => {
    expect(resolveColourMap('commodity')).toBe(COMMODITY_COLOURS);
  });

  it('resolves "lithology" to LITHOLOGY_COLOURS', () => {
    expect(resolveColourMap('lithology')).toBe(LITHOLOGY_COLOURS);
  });

  it('is case-insensitive for built-in names', () => {
    expect(resolveColourMap('COMMODITY')).toBe(COMMODITY_COLOURS);
    expect(resolveColourMap('Lithology')).toBe(LITHOLOGY_COLOURS);
  });

  it('passes through a user-supplied object', () => {
    const userMap = { sandstone: '#aabbcc' };
    expect(resolveColourMap(userMap)).toBe(userMap);
  });

  it('throws RangeError for unknown name', () => {
    expect(() => resolveColourMap('geology')).toThrow(RangeError);
  });

  it('throws TypeError for unsupported type (number)', () => {
    expect(() => resolveColourMap(42)).toThrow(TypeError);
  });

  it('throws TypeError for an array', () => {
    expect(() => resolveColourMap(['#ff0000'])).toThrow(TypeError);
  });

  it('throws TypeError for a Map instance', () => {
    expect(() => resolveColourMap(new Map([['Au', '#FFD700']]))).toThrow(TypeError);
  });

  it('throws TypeError for a class instance', () => {
    expect(() => resolveColourMap(new Date())).toThrow(TypeError);
  });
});


// ---------------------------------------------------------------------------
// Integration: buildCategoricalStripLogConfig with colourMap
// ---------------------------------------------------------------------------

describe('buildCategoricalStripLogConfig with colourMap', () => {
  const rows = [
    { from: 0, to: 10, geology_code: 'granite' },
    { from: 10, to: 20, geology_code: 'basalt' },
    { from: 20, to: 30, geology_code: 'BIF' },
    { from: 30, to: 40, geology_code: 'Unobtanium' },
  ];

  it('uses built-in lithology colours when colourMap is "lithology"', () => {
    const { data } = buildCategoricalStripLogConfig(rows, { colourMap: 'lithology' });
    const graniteTrace = data.find((t) => t.name === 'granite');
    const basaltTrace = data.find((t) => t.name === 'basalt');
    expect(graniteTrace.marker.color).toBe(LITHOLOGY_COLOURS.granite);
    expect(basaltTrace.marker.color).toBe(LITHOLOGY_COLOURS.basalt);
  });

  it('falls back to palette colour for unknown values not in the map', () => {
    const { data } = buildCategoricalStripLogConfig(rows, { colourMap: 'lithology' });
    const unknownTrace = data.find((t) => t.name === 'Unobtanium');
    // Should not throw and should produce a non-empty colour string
    expect(typeof unknownTrace.marker.color).toBe('string');
    expect(unknownTrace.marker.color.length).toBeGreaterThan(0);
  });

  it('uses a user-supplied colour map', () => {
    const userMap = { granite: '#ff0000', basalt: '#0000ff' };
    const { data } = buildCategoricalStripLogConfig(rows, { colourMap: userMap });
    expect(data.find((t) => t.name === 'granite').marker.color).toBe('#ff0000');
    expect(data.find((t) => t.name === 'basalt').marker.color).toBe('#0000ff');
  });

  it('works without a colourMap (existing behaviour preserved)', () => {
    const { data } = buildCategoricalStripLogConfig(rows);
    expect(data).toHaveLength(4);
    data.forEach((trace) => {
      expect(typeof trace.marker.color).toBe('string');
    });
  });
});


// ---------------------------------------------------------------------------
// Integration: buildPlotConfig with colourMap
// ---------------------------------------------------------------------------

describe('buildPlotConfig with colourMap', () => {
  const points = [
    { z: 5, val: 'Cu', from: 0, to: 10, errorPlus: 5, errorMinus: 5 },
    { z: 15, val: 'Au', from: 10, to: 20, errorPlus: 5, errorMinus: 5 },
  ];

  it('applies commodity colours via colourMap', () => {
    const { data } = buildPlotConfig({
      points,
      isCategorical: true,
      property: 'element',
      chartType: 'categorical',
      colourMap: COMMODITY_COLOURS,
    });
    const cuTrace = data.find((t) => t.name === 'Cu');
    const auTrace = data.find((t) => t.name === 'Au');
    expect(cuTrace.marker.color).toBe(COMMODITY_COLOURS.Cu);
    expect(auTrace.marker.color).toBe(COMMODITY_COLOURS.Au);
  });
});
