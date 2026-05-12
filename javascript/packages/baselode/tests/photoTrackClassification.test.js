/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  classifyColumns,
  DISPLAY_PHOTO,
  DISPLAY_HIDDEN,
  DISPLAY_CATEGORICAL,
  DISPLAY_NUMERIC,
  CHART_OPTIONS,
} from '../src/data/columnMeta.js';
import { coerceChartTypeForProperty } from '../src/data/traceGridConfig.js';
import { deriveAssayProps } from '../src/data/assayDataLoader.js';

describe('classifyColumns — image_url → photo', () => {
  it('classifies image_url as DISPLAY_PHOTO when at least one value is set', () => {
    const rows = [
      { from: 0, to: 10, image_url: 'https://example.com/tray1.jpg' },
      { from: 10, to: 20, image_url: 'https://example.com/tray2.jpg' },
    ];
    const result = classifyColumns(rows);
    expect(result.byType.image_url).toBe(DISPLAY_PHOTO);
    expect(result.photoCols).toEqual(['image_url']);
  });

  it('hides image_url when every value is null/empty', () => {
    const rows = [
      { from: 0, to: 10, image_url: null },
      { from: 10, to: 20, image_url: '' },
    ];
    const result = classifyColumns(rows);
    expect(result.byType.image_url).toBe(DISPLAY_HIDDEN);
    expect(result.photoCols).toEqual([]);
  });

  it('keeps photo classification distinct from categorical text', () => {
    const rows = [
      { from: 0, to: 10, lith: 'GRN', image_url: 'a.jpg' },
      { from: 10, to: 20, lith: 'BSL', image_url: 'b.jpg' },
    ];
    const result = classifyColumns(rows);
    expect(result.byType.image_url).toBe(DISPLAY_PHOTO);
    expect(result.byType.lith).toBe(DISPLAY_CATEGORICAL);
    expect(result.photoCols).toEqual(['image_url']);
    expect(result.categoricalCols).toEqual(['lith']);
  });

  it('returns empty photoCols for empty input', () => {
    expect(classifyColumns([]).photoCols).toEqual([]);
    expect(classifyColumns(null).photoCols).toEqual([]);
  });

  it('CHART_OPTIONS exposes a single photo entry', () => {
    expect(CHART_OPTIONS[DISPLAY_PHOTO]).toEqual([
      { value: 'photo', label: 'Core photos' },
    ]);
  });
});

describe('coerceChartTypeForProperty — photo properties', () => {
  it('coerces a photo property to chart type "photo"', () => {
    expect(coerceChartTypeForProperty({
      property: 'image_url',
      chartType: 'line',
      photoProps: ['image_url'],
    })).toBe('photo');
  });

  it('photo takes precedence over comment/categorical for the same name', () => {
    // Defensive: if a column ends up in both lists, photo wins (it's checked first).
    expect(coerceChartTypeForProperty({
      property: 'image_url',
      chartType: '',
      photoProps: ['image_url'],
      commentProps: ['image_url'],
    })).toBe('photo');
  });

  it('falls back to numeric default when a previously-photo chart type is reused for a numeric property', () => {
    expect(coerceChartTypeForProperty({
      property: 'au_ppm',
      chartType: 'photo',
      numericDefaultChartType: 'line',
    })).toBe('line');
  });

  it('photoProps defaults to [] (back-compat)', () => {
    expect(coerceChartTypeForProperty({
      property: 'au_ppm',
      chartType: 'markers+line',
    })).toBe('markers+line');
  });
});

describe('deriveAssayProps — photo plumbing', () => {
  it('returns photoProps populated from holes containing image_url', () => {
    const holes = [{
      id: '09RTD001',
      points: [
        { from: 0, to: 10, image_url: '/a.jpg', au_ppm: 0.5 },
        { from: 10, to: 20, image_url: '/b.jpg', au_ppm: 0.7 },
      ],
    }];
    const props = deriveAssayProps(holes);
    expect(props.photoProps).toEqual(['image_url']);
    expect(props.numericProps).toContain('au_ppm');
    expect(props.columnMeta.image_url).toBe(DISPLAY_PHOTO);
    expect(props.columnMeta.au_ppm).toBe(DISPLAY_NUMERIC);
  });

  it('returns empty photoProps when no holes carry image_url', () => {
    const props = deriveAssayProps([{ id: 'H1', points: [{ from: 0, to: 1, au_ppm: 1.0 }] }]);
    expect(props.photoProps).toEqual([]);
  });
});
