/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { interpolateTrajectory } from '../src/data/desurveyMethods.js';

function verticalTrace() {
  const rows = [];
  for (let md = 0; md <= 100; md += 1) {
    rows.push({
      hole_id: 'A',
      md,
      x: 500000,
      y: 6900000,
      z: 300 + md,
      azimuth: 0,
      dip: -90,
    });
  }
  return rows;
}

function twoHoleTraces() {
  const verticalA = verticalTrace();
  const verticalB = verticalA.map((row) => ({ ...row, hole_id: 'B', x: 600000, y: 6800000 }));
  return [...verticalA, ...verticalB];
}

describe('interpolateTrajectory', () => {
  it('returns the station value when depth matches a sample', () => {
    const traces = verticalTrace();
    const result = interpolateTrajectory(traces, { A: [0, 50, 100] });
    expect(result).toHaveLength(3);
    expect(result.map((row) => row.depth)).toEqual([0, 50, 100]);
    expect(result.map((row) => row.z)).toEqual([300, 350, 400]);
    expect(result.every((row) => row.x === 500000)).toBe(true);
  });

  it('interpolates linearly between stations', () => {
    const traces = verticalTrace();
    const result = interpolateTrajectory(traces, { A: [25.5, 75.5] });
    expect(result[0].z).toBeCloseTo(325.5, 9);
    expect(result[1].z).toBeCloseTo(375.5, 9);
  });

  it('out-of-range depths get null fields', () => {
    const traces = verticalTrace();
    const result = interpolateTrajectory(traces, { A: [-5, 150] });
    expect(result).toHaveLength(2);
    expect(result.every((row) => row.x === null && row.y === null && row.z === null)).toBe(true);
  });

  it('unknown hole gets null fields', () => {
    const traces = verticalTrace();
    const result = interpolateTrajectory(traces, { B: [25] });
    expect(result).toHaveLength(1);
    expect(result[0].hole_id).toBe('B');
    expect(result[0].x).toBeNull();
  });

  it('per-hole dict treats holes independently', () => {
    const traces = twoHoleTraces();
    const result = interpolateTrajectory(traces, { A: [25], B: [50] });
    expect(result).toHaveLength(2);
    const byHole = Object.fromEntries(result.map((row) => [row.hole_id, row]));
    expect(byHole.A.x).toBe(500000);
    expect(byHole.B.x).toBe(600000);
  });

  it('broadcasts a list of numbers to every hole', () => {
    const traces = twoHoleTraces();
    const result = interpolateTrajectory(traces, [25, 75]);
    expect(result).toHaveLength(4);
    expect(new Set(result.map((row) => row.hole_id))).toEqual(new Set(['A', 'B']));
    expect([...new Set(result.map((row) => row.depth))].sort((a, b) => a - b)).toEqual([25, 75]);
  });

  it('broadcasts a scalar to every hole', () => {
    const traces = twoHoleTraces();
    const result = interpolateTrajectory(traces, 30);
    expect(result).toHaveLength(2);
    expect(result.every((row) => row.depth === 30)).toBe(true);
  });

  it('accepts an array of {hole_id, depth} rows', () => {
    const traces = twoHoleTraces();
    const result = interpolateTrajectory(traces, [
      { hole_id: 'A', depth: 25 },
      { hole_id: 'B', depth: 50 },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ hole_id: 'A', depth: 25 });
    expect(result[1]).toMatchObject({ hole_id: 'B', depth: 50 });
  });

  it('returns empty array on empty request dict', () => {
    expect(interpolateTrajectory(verticalTrace(), {})).toEqual([]);
  });

  it('respects column-name overrides for non-default trace shapes', () => {
    const traces = verticalTrace().map((row) => ({
      hole_id: row.hole_id,
      md: row.md,
      easting: row.x,
      northing: row.y,
      elevation: row.z,
      azimuth: row.azimuth,
      dip: row.dip,
    }));
    const result = interpolateTrajectory(
      traces,
      { A: [50] },
      { eastingCol: 'easting', northingCol: 'northing', elevationCol: 'elevation' },
    );
    expect(result[0]).toMatchObject({
      easting: 500000, northing: 6900000, elevation: 350,
    });
  });
});
