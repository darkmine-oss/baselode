/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { significantIntercepts } from '../src/data/intercepts.js';

describe('significantIntercepts', () => {
  it('returns a single intercept spanning all qualifying intervals', () => {
    const intervals = [
      { hole_id: 'DH001', from: 0, to: 10, CU_PCT: 0.20 },
      { hole_id: 'DH001', from: 10, to: 20, CU_PCT: 0.40 },
      { hole_id: 'DH001', from: 20, to: 30, CU_PCT: 0.30 },
    ];
    const result = significantIntercepts(intervals, 'CU_PCT', 0.10, 25);
    expect(result).toHaveLength(1);
    const r = result[0];
    expect(r.hole_id).toBe('DH001');
    expect(r.from).toBe(0);
    expect(r.to).toBe(30);
    expect(r.length).toBe(30);
    expect(Math.abs(r.avg_grade - 0.30)).toBeLessThan(1e-9);
    expect(r.n_samples).toBe(3);
    expect(r.assay_field).toBe('CU_PCT');
    expect(r.label).toBe('30.0 m @ 0.30 CU_PCT');
  });

  it('discards runs shorter than min_length', () => {
    const intervals = [
      { hole_id: 'DH001', from: 0, to: 10, CU_PCT: 0.50 },
      { hole_id: 'DH001', from: 10, to: 20, CU_PCT: 0.50 },
    ];
    const result = significantIntercepts(intervals, 'CU_PCT', 0.10, 25);
    expect(result).toHaveLength(0);
  });

  it('splits runs when a below-threshold interval breaks contiguity', () => {
    const intervals = [
      { hole_id: 'DH001', from: 0, to: 10, AU_PPM: 1.0 },
      { hole_id: 'DH001', from: 10, to: 20, AU_PPM: 1.5 },
      { hole_id: 'DH001', from: 20, to: 30, AU_PPM: 0.05 }, // below threshold
      { hole_id: 'DH001', from: 30, to: 40, AU_PPM: 2.0 },
      { hole_id: 'DH001', from: 40, to: 50, AU_PPM: 2.5 },
    ];
    const result = significantIntercepts(intervals, 'AU_PPM', 0.10, 15);
    expect(result).toHaveLength(2);
    const froms = result.map((r) => r.from).sort((a, b) => a - b);
    const tos = result.map((r) => r.to).sort((a, b) => a - b);
    expect(froms).toEqual([0, 30]);
    expect(tos).toEqual([20, 50]);
  });

  it('returns empty array for empty input', () => {
    expect(significantIntercepts([], 'CU_PCT', 0.10, 5)).toEqual([]);
  });

  it('returns empty array when no intervals meet min_grade', () => {
    const intervals = [
      { hole_id: 'DH001', from: 0, to: 10, CU_PCT: 0.01 },
    ];
    expect(significantIntercepts(intervals, 'CU_PCT', 0.10, 5)).toEqual([]);
  });

  it('handles multiple holes independently', () => {
    const intervals = [
      { hole_id: 'DH001', from: 0, to: 10, CU_PCT: 0.50 },
      { hole_id: 'DH001', from: 10, to: 20, CU_PCT: 0.60 },
      { hole_id: 'DH002', from: 0, to: 10, CU_PCT: 0.05 },
      { hole_id: 'DH002', from: 10, to: 20, CU_PCT: 0.05 },
    ];
    const result = significantIntercepts(intervals, 'CU_PCT', 0.10, 15);
    expect(result).toHaveLength(1);
    expect(result[0].hole_id).toBe('DH001');
  });

  it('calculates weighted average grade correctly', () => {
    const intervals = [
      { hole_id: 'DH001', from: 0, to: 10, CU_PCT: 0.10 },
      { hole_id: 'DH001', from: 10, to: 20, CU_PCT: 0.50 },
      { hole_id: 'DH001', from: 20, to: 30, CU_PCT: 0.10 },
    ];
    const result = significantIntercepts(intervals, 'CU_PCT', 0.05, 25);
    expect(result).toHaveLength(1);
    const expected = (0.10 * 10 + 0.50 * 10 + 0.10 * 10) / 30;
    expect(Math.abs(result[0].avg_grade - expected)).toBeLessThan(1e-9);
  });
});
