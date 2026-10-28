/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  GEOPHYSICS_PALETTES,
  createGeophysicsStretch,
  geophysicsColorGradient,
  geophysicsScaleColor,
  normalizeGeophysicsStretch,
} from '../src/viz/geophysicsColorScales.js';

const values = [0, 1, 2, 3, 100, null, -5, 4, 5, 6, -9999];

describe('geophysics colour scales', () => {
  it('offers standard sequential, diverging and geophysics scales', () => {
    expect(GEOPHYSICS_PALETTES).toEqual(expect.arrayContaining([
      'viridis', 'magma', 'inferno', 'plasma', 'cividis', 'turbo', 'diverging', 'rainbow', 'magnetic', 'grayscale',
    ]));
    expect(geophysicsScaleColor('grayscale', 0.5)).toEqual([128, 128, 128]);
    expect(geophysicsScaleColor('grayscale', 0, true)).toEqual([255, 255, 255]);
    expect(geophysicsColorGradient('grayscale')).toBe('linear-gradient(to right, rgb(0, 0, 0) 0%, rgb(255, 255, 255) 100%)');
    expect(() => geophysicsScaleColor('jet', 0)).toThrow('Unknown');
  });

  it('defaults to a relative 2-98 percentile stretch and validates limits', () => {
    expect(normalizeGeophysicsStretch()).toEqual({ mode: 'relative', low: 2, high: 98 });
    expect(() => normalizeGeophysicsStretch({ mode: 'relative', low: 60, high: 40 })).toThrow('percentiles');
    expect(() => normalizeGeophysicsStretch({ mode: 'absolute', min: 5 })).toThrow('min < max');
    expect(() => normalizeGeophysicsStretch({ mode: 'log' })).toThrow('mode');
  });

  it('maps relative, absolute and equalised stretches to colour positions', () => {
    const relative = createGeophysicsStretch(values, { mode: 'relative', low: 0, high: 100 }, -9999);
    expect(relative.limits).toEqual([-5, 100]);
    expect(relative.toRatio(-9999)).toBeNaN();

    const absolute = createGeophysicsStretch(values, { mode: 'absolute', min: 0, max: 10 }, -9999);
    expect(absolute.toRatio(1)).toBeCloseTo(0.1);
    expect(absolute.toRatio(100)).toBe(1);
    expect(absolute.valueAt(0.5)).toBe(5);

    const equalized = createGeophysicsStretch(values, { mode: 'equalize' }, -9999);
    const ratios = values.map(equalized.toRatio).filter((ratio) => !Number.isNaN(ratio)).sort((a, b) => a - b);
    ratios.forEach((ratio, index) => expect(ratio).toBeCloseTo(index / (ratios.length - 1)));
    expect(equalized.valueAt(1)).toBe(100);
  });
});
