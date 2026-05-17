/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import {
  formatPropertyLabel,
  resolvePropertyLabelParts,
  derivePropertyMeta,
} from '../src/data/propertyLabels.js';

describe('formatPropertyLabel', () => {
  it('returns the bare property when no metadata is supplied', () => {
    expect(formatPropertyLabel('Au')).toBe('Au');
    expect(formatPropertyLabel('Au', undefined)).toBe('Au');
    expect(formatPropertyLabel('Au', {})).toBe('Au');
  });

  it('appends the unit when present', () => {
    expect(formatPropertyLabel('Au', { unit: 'ppm' })).toBe('Au (ppm)');
  });

  it('appends unit and source attribute when both differ from the label', () => {
    expect(formatPropertyLabel('Au', { unit: 'ppm', sourceAttribute: 'Au_ppb' }))
      .toBe('Au (ppm, source: Au_ppb)');
  });

  it('shows the source attribute alone when there is no unit', () => {
    expect(formatPropertyLabel('Au', { sourceAttribute: 'Au_ppb' }))
      .toBe('Au (source: Au_ppb)');
  });

  it('omits the source attribute when it matches the label (case-insensitive)', () => {
    expect(formatPropertyLabel('Au', { unit: 'ppm', sourceAttribute: 'au' }))
      .toBe('Au (ppm)');
    expect(formatPropertyLabel('Au', { sourceAttribute: 'Au' })).toBe('Au');
  });

  it('honours an explicit label override', () => {
    expect(formatPropertyLabel('au_ppm', { label: 'Au', unit: 'ppm' }))
      .toBe('Au (ppm)');
  });

  it('ignores blank unit / source values', () => {
    expect(formatPropertyLabel('Au', { unit: '   ', sourceAttribute: '' })).toBe('Au');
    expect(formatPropertyLabel('Au', { unit: null, sourceAttribute: null })).toBe('Au');
  });
});

describe('resolvePropertyLabelParts', () => {
  it('splits a property into label / unit / source', () => {
    expect(resolvePropertyLabelParts('Au', { unit: 'ppm', sourceAttribute: 'Au_ppb' }))
      .toEqual({ label: 'Au', unit: 'ppm', source: 'Au_ppb' });
  });

  it('nulls the source when equal to the label', () => {
    expect(resolvePropertyLabelParts('Au', { sourceAttribute: 'AU' }))
      .toEqual({ label: 'Au', unit: null, source: null });
  });
});

describe('derivePropertyMeta', () => {
  const rows = [
    { Au: 30, analyte_attribute: 'Au_ppb', analysis_uom: 'ppm' },
    { Au: 41, analyte_attribute: 'Au_ppb', analysis_uom: 'ppm' },
    { Cu: 8, analyte_attribute: 'Cu_ppm', analysis_uom: 'ppm' },
  ];

  it('derives unanimous unit / source per property from rows', () => {
    expect(derivePropertyMeta(rows, ['Au', 'Cu'])).toEqual({
      Au: { unit: 'ppm', sourceAttribute: 'Au_ppb' },
      Cu: { unit: 'ppm', sourceAttribute: 'Cu_ppm' },
    });
  });

  it('omits a property entirely when it has no co-occurring metadata', () => {
    expect(derivePropertyMeta([{ Ni: 1 }], ['Ni'])).toEqual({});
  });

  it('omits a unit that is not unanimous across rows', () => {
    const mixed = [
      { Au: 1, analysis_uom: 'ppm', analyte_attribute: 'Au_ppb' },
      { Au: 2, analysis_uom: 'g/t', analyte_attribute: 'Au_ppb' },
    ];
    expect(derivePropertyMeta(mixed, ['Au'])).toEqual({
      Au: { sourceAttribute: 'Au_ppb' },
    });
  });

  it('returns an empty map for invalid inputs', () => {
    expect(derivePropertyMeta(null, ['Au'])).toEqual({});
    expect(derivePropertyMeta(rows, null)).toEqual({});
  });
});
