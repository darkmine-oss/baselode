/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  defaultColorByColumn,
  detectCategoricalColumns,
  detectNumericColumns,
} from '../src/panels/columnDetection.js';

describe('detectNumericColumns', () => {
  it('returns columns sorted by populated-row count desc', () => {
    const rows = [
      { au: 0.5, cu: 0.1 },
      { au: 1.2, cu: null },
      { au: 0.7 },
    ];
    expect(detectNumericColumns(rows)).toEqual(['au', 'cu']);
  });

  it('skips reserved columns', () => {
    const rows = [
      { hole_id: 'H1', from: 0, to: 1, au: 0.5 },
    ];
    expect(detectNumericColumns(rows)).toEqual(['au']);
  });

  it('treats blank strings as missing rather than zero', () => {
    // Number('') is 0; without the explicit blank skip, an
    // all-blank column would falsely register as numeric.
    const rows = [{ junk: '' }, { junk: '' }];
    expect(detectNumericColumns(rows)).toEqual([]);
  });

  it('returns [] for empty input', () => {
    expect(detectNumericColumns([])).toEqual([]);
    expect(detectNumericColumns(null)).toEqual([]);
  });
});

describe('detectCategoricalColumns', () => {
  it('accepts columns with mostly-string values', () => {
    const rows = [
      { lithology: 'granite', au: 0.5 },
      { lithology: 'schist', au: 1.2 },
      { lithology: 'basalt', au: 0.7 },
    ];
    expect(detectCategoricalColumns(rows)).toEqual(['lithology']);
  });

  it('accepts mixed string + numeric columns via majority rule', () => {
    // 3 strings + 1 number → still categorical.
    const rows = [
      { geology_code: 'GRA' },
      { geology_code: 'SCH' },
      { geology_code: 'BAS' },
      { geology_code: 5 },
    ];
    expect(detectCategoricalColumns(rows)).toContain('geology_code');
  });

  it('rejects all-numeric columns', () => {
    const rows = [{ au: 0.5 }, { au: 1.2 }, { au: 0.7 }];
    expect(detectCategoricalColumns(rows)).toEqual([]);
  });

  it('rejects single-value columns (no useful split)', () => {
    const rows = [
      { project: 'A' }, { project: 'A' }, { project: 'A' },
    ];
    expect(detectCategoricalColumns(rows)).toEqual([]);
  });

  it('respects the maxDistinct cap', () => {
    const rows = Array.from({ length: 50 }, (_, idx) => ({ id: `v${idx}` }));
    // 50 distinct → exceeds default cap of 40.
    expect(detectCategoricalColumns(rows)).toEqual([]);
    // Bumping the cap surfaces it.
    expect(detectCategoricalColumns(rows, { maxDistinct: 100 })).toEqual(['id']);
  });
});

describe('defaultColorByColumn', () => {
  it('prefers a lithology column when present', () => {
    expect(defaultColorByColumn(['project_id', 'lithology', 'hole_type'])).toBe('lithology');
    expect(defaultColorByColumn(['litho_code', 'project_id'])).toBe('litho_code');
  });

  it('falls through to surface_sample_type, then project_id', () => {
    expect(defaultColorByColumn(['project_id', 'surface_sample_type'])).toBe('surface_sample_type');
    expect(defaultColorByColumn(['project_id', 'hole_type'])).toBe('project_id');
  });

  it('returns the first entry when no preferred name matches', () => {
    expect(defaultColorByColumn(['hole_type', 'rock_class'])).toBe('hole_type');
  });

  it('returns "" for an empty list', () => {
    expect(defaultColorByColumn([])).toBe('');
    expect(defaultColorByColumn(null)).toBe('');
  });
});
