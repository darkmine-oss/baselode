/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  interpolateTrace,
  alphaBetaToNormal,
  computeStructuralPositions,
} from '../src/data/structuralPositions.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm(v) {
  return Math.sqrt(dot(v, v));
}

function expectUnit(obj) {
  const len = norm([obj.dx ?? obj.nx, obj.dy ?? obj.ny, obj.dz ?? obj.nz]);
  expect(len).toBeCloseTo(1, 10);
}

// Simple straight vertical trace: z decreases with md (z-up coordinate system).
const verticalTrace = [
  { hole_id: 'H1', md: 0, x: 100, y: 200, z: 50 },
  { hole_id: 'H1', md: 10, x: 100, y: 200, z: 40 },
  { hole_id: 'H1', md: 20, x: 100, y: 200, z: 30 },
];

// Trace that dips north-east and down (azimuth 45°, dip such that x/y/z all change).
const diagonalTrace = [
  { hole_id: 'H2', md: 0,  x: 0,   y: 0,  z: 100 },
  { hole_id: 'H2', md: 10, x: 7,   y: 7,  z: 93 },
  { hole_id: 'H2', md: 20, x: 14,  y: 14, z: 86 },
];

// ─── interpolateTrace ────────────────────────────────────────────────────────

describe('interpolateTrace', () => {
  it('returns null for null/undefined input', () => {
    expect(interpolateTrace(null, 5)).toBeNull();
    expect(interpolateTrace(undefined, 5)).toBeNull();
    expect(interpolateTrace([], 5)).toBeNull();
  });

  it('returns null for non-finite targetMd', () => {
    expect(interpolateTrace(verticalTrace, NaN)).toBeNull();
    expect(interpolateTrace(verticalTrace, Infinity)).toBeNull();
    expect(interpolateTrace(verticalTrace, -Infinity)).toBeNull();
  });

  it('single-point trace: returns point coords with default vertical direction', () => {
    const single = [{ hole_id: 'H1', md: 5, x: 1, y: 2, z: 3 }];
    const result = interpolateTrace(single, 5);
    expect(result).not.toBeNull();
    expect(result.x).toBe(1);
    expect(result.y).toBe(2);
    expect(result.z).toBe(3);
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
    expect(result.dz).toBe(-1);
  });

  it('single-point trace: any targetMd returns the same position', () => {
    const single = [{ hole_id: 'H1', md: 5, x: 1, y: 2, z: 3 }];
    const a = interpolateTrace(single, 0);
    const b = interpolateTrace(single, 100);
    expect(a.x).toBe(1);
    expect(b.x).toBe(1);
  });

  it('interpolates at exact start and end points', () => {
    const r0 = interpolateTrace(verticalTrace, 0);
    expect(r0.x).toBeCloseTo(100);
    expect(r0.y).toBeCloseTo(200);
    expect(r0.z).toBeCloseTo(50);

    const r20 = interpolateTrace(verticalTrace, 20);
    expect(r20.x).toBeCloseTo(100);
    expect(r20.y).toBeCloseTo(200);
    expect(r20.z).toBeCloseTo(30);
  });

  it('interpolates midpoint correctly', () => {
    const r = interpolateTrace(verticalTrace, 10);
    expect(r.x).toBeCloseTo(100);
    expect(r.y).toBeCloseTo(200);
    expect(r.z).toBeCloseTo(40);
  });

  it('interpolates fractional depths', () => {
    const r = interpolateTrace(verticalTrace, 5);
    expect(r.z).toBeCloseTo(45);

    const r2 = interpolateTrace(diagonalTrace, 5);
    expect(r2.x).toBeCloseTo(3.5);
    expect(r2.y).toBeCloseTo(3.5);
    expect(r2.z).toBeCloseTo(96.5);
  });

  it('extrapolates before first point using first segment', () => {
    const r = interpolateTrace(verticalTrace, -5);
    // Segment 0→10 has dz = -1 per unit md; at md=-5, z = 50 + 5 = 55
    expect(r.z).toBeCloseTo(55);
    expect(r.x).toBeCloseTo(100);
  });

  it('extrapolates beyond last point using last segment', () => {
    const r = interpolateTrace(verticalTrace, 30);
    // Last segment 10→20: dz/md=-1; at md=30, z = 30 - 10 = 20
    expect(r.z).toBeCloseTo(20);
    expect(r.x).toBeCloseTo(100);
  });

  it('returns a unit direction vector from finite-difference fallback', () => {
    const r = interpolateTrace(verticalTrace, 5);
    expectUnit(r);
    // Vertical downward: expect dz < 0
    expect(r.dz).toBeLessThan(0);
  });

  it('finite-difference direction is downward for vertical trace', () => {
    const r = interpolateTrace(verticalTrace, 10);
    expect(r.dx).toBeCloseTo(0);
    expect(r.dy).toBeCloseTo(0);
    expect(r.dz).toBeCloseTo(-1);
  });

  it('uses azimuth/dip when present and returns a unit direction', () => {
    const traceWithDirs = [
      { hole_id: 'H1', md: 0,  x: 0, y: 0, z: 0, azimuth: 0,  dip: -60 },
      { hole_id: 'H1', md: 10, x: 5, y: 5, z: -8, azimuth: 10, dip: -65 },
    ];
    const r = interpolateTrace(traceWithDirs, 5);
    expect(r).not.toBeNull();
    expectUnit(r);
  });

  it('interpolates azimuth/dip between segment endpoints at mid-segment', () => {
    const traceWithDirs = [
      { hole_id: 'H1', md: 0,  x: 0, y: 0, z: 100, azimuth: 0,  dip: -30 },
      { hole_id: 'H1', md: 10, x: 5, y: 0, z: 91.3, azimuth: 20, dip: -50 },
    ];
    const r = interpolateTrace(traceWithDirs, 5);
    // Direction at t=0.5 should come from interpolated az=10, dip=-40
    const azRad = (10 * Math.PI) / 180;
    const dipRad = (-40 * Math.PI) / 180;
    const expectedDx = Math.cos(dipRad) * Math.sin(azRad);
    const expectedDy = Math.cos(dipRad) * Math.cos(azRad);
    const expectedDz = -Math.sin(dipRad);
    expect(r.dx).toBeCloseTo(expectedDx, 6);
    expect(r.dy).toBeCloseTo(expectedDy, 6);
    expect(r.dz).toBeCloseTo(expectedDz, 6);
  });

  it('falls back to default (0,0,-1) for a degenerate zero-length segment', () => {
    const degenerate = [
      { hole_id: 'H1', md: 5, x: 10, y: 20, z: 30 },
      { hole_id: 'H1', md: 5, x: 10, y: 20, z: 30 }, // identical
    ];
    const r = interpolateTrace(degenerate, 5);
    expect(r.dx).toBeCloseTo(0);
    expect(r.dy).toBeCloseTo(0);
    expect(r.dz).toBeCloseTo(-1);
  });
});

// ─── alphaBetaToNormal ───────────────────────────────────────────────────────

describe('alphaBetaToNormal', () => {
  // Vertical downward drill (z-up coordinate system).
  const vertDown = { dx: 0, dy: 0, dz: -1 };
  // Horizontal north-pointing drill.
  const horizNorth = { dx: 0, dy: 1, dz: 0 };

  it('always returns a unit normal vector', () => {
    const cases = [
      [90, 0], [90, 45], [90, 180], [45, 0], [45, 90], [0, 0],
    ];
    for (const [a, b] of cases) {
      const n = alphaBetaToNormal(a, b, vertDown);
      expect(norm([n.nx, n.ny, n.nz])).toBeCloseTo(1, 10);
    }
  });

  it('alpha=90 → normal is perpendicular to drill direction', () => {
    const dirs = [
      vertDown,
      horizNorth,
      { dx: 0.5, dy: 0.5, dz: -Math.SQRT1_2 },
    ];
    for (const drillDir of dirs) {
      const n = alphaBetaToNormal(90, 0, drillDir);
      const d = Math.abs(dot([n.nx, n.ny, n.nz], [drillDir.dx, drillDir.dy, drillDir.dz]));
      expect(d).toBeCloseTo(0, 10);
    }
  });

  it('alpha=0 → normal is parallel to drill direction (same or opposite)', () => {
    const dirs = [vertDown, horizNorth];
    for (const drillDir of dirs) {
      const n = alphaBetaToNormal(0, 0, drillDir);
      const d = dot([n.nx, n.ny, n.nz], [drillDir.dx, drillDir.dy, drillDir.dz]);
      expect(Math.abs(d)).toBeCloseTo(1, 10);
    }
  });

  it('vertical drill triggers fallback U=(0,1,0) — result is still a valid unit vector', () => {
    // dz=-1 is nearly parallel to default up (0,0,1); fallback must be used
    const n = alphaBetaToNormal(90, 0, vertDown);
    expect(norm([n.nx, n.ny, n.nz])).toBeCloseTo(1, 10);
    // Should be perpendicular to drill direction
    const d = dot([n.nx, n.ny, n.nz], [vertDown.dx, vertDown.dy, vertDown.dz]);
    expect(Math.abs(d)).toBeCloseTo(0, 10);
  });

  it('also triggers fallback for nearly vertical upward drill (dz=+1)', () => {
    const nearlyUp = { dx: 0, dy: 0, dz: 1 };
    const n = alphaBetaToNormal(90, 0, nearlyUp);
    expect(norm([n.nx, n.ny, n.nz])).toBeCloseTo(1, 10);
    const d = dot([n.nx, n.ny, n.nz], [0, 0, 1]);
    expect(Math.abs(d)).toBeCloseTo(0, 10);
  });

  it('beta rotation of 180° gives the opposite perpendicular direction', () => {
    const n0 = alphaBetaToNormal(90, 0, horizNorth);
    const n180 = alphaBetaToNormal(90, 180, horizNorth);
    expect(n0.nx).toBeCloseTo(-n180.nx, 6);
    expect(n0.ny).toBeCloseTo(-n180.ny, 6);
    expect(n0.nz).toBeCloseTo(-n180.nz, 6);
  });

  it('beta rotation of 360° returns same direction as beta=0', () => {
    const n0 = alphaBetaToNormal(90, 0, horizNorth);
    const n360 = alphaBetaToNormal(90, 360, horizNorth);
    expect(n0.nx).toBeCloseTo(n360.nx, 6);
    expect(n0.ny).toBeCloseTo(n360.ny, 6);
    expect(n0.nz).toBeCloseTo(n360.nz, 6);
  });

  it('betaHandedness=-1 reverses the beta rotation direction', () => {
    const nPos = alphaBetaToNormal(90, 45, horizNorth, { betaHandedness: 1 });
    const nNeg = alphaBetaToNormal(90, -45, horizNorth, { betaHandedness: 1 });
    const nFlipped = alphaBetaToNormal(90, 45, horizNorth, { betaHandedness: -1 });
    expect(nFlipped.nx).toBeCloseTo(nNeg.nx, 6);
    expect(nFlipped.ny).toBeCloseTo(nNeg.ny, 6);
    expect(nFlipped.nz).toBeCloseTo(nNeg.nz, 6);
  });

  it('betaZeroAxis R vs B gives different starting orientations for non-zero beta=0', () => {
    // At beta=0 the result should differ depending on anchor axis
    const nB = alphaBetaToNormal(90, 0, horizNorth, { betaZeroAxis: 'B' });
    const nR = alphaBetaToNormal(90, 0, horizNorth, { betaZeroAxis: 'R' });
    // Both are perpendicular to D and unit length
    expect(norm([nB.nx, nB.ny, nB.nz])).toBeCloseTo(1, 10);
    expect(norm([nR.nx, nR.ny, nR.nz])).toBeCloseTo(1, 10);
    // They should differ (different anchor axes yield different normals at beta=0)
    const same = Math.abs(nB.nx - nR.nx) < 1e-6 &&
                 Math.abs(nB.ny - nR.ny) < 1e-6 &&
                 Math.abs(nB.nz - nR.nz) < 1e-6;
    expect(same).toBe(false);
  });

  it('alpha=45 normal is at 45° to both drill axis and perpendicular plane', () => {
    const n = alphaBetaToNormal(45, 0, vertDown);
    const d = Math.abs(dot([n.nx, n.ny, n.nz], [vertDown.dx, vertDown.dy, vertDown.dz]));
    // cos(theta) = cos((90-45)*π/180) = cos(45°) ≈ 0.7071
    expect(d).toBeCloseTo(Math.cos(Math.PI / 4), 6);
  });

  it('known values: vertical drill, alpha=90, beta=0 (betaZeroAxis=B) → normal = B axis', () => {
    // With D=(0,0,-1), U fallback=(0,1,0):
    //   R = normalize(cross(U, D)) = normalize(cross([0,1,0],[0,0,-1])) = [-1,0,0]
    //   B = normalize(cross(D, R)) = normalize(cross([0,0,-1],[-1,0,0])) = [0,1,0]
    // At alpha=90, beta=0, betaZeroAxis='B': N = B = [0,1,0]
    const n = alphaBetaToNormal(90, 0, vertDown, { betaZeroAxis: 'B' });
    expect(n.nx).toBeCloseTo(0, 6);
    expect(n.ny).toBeCloseTo(1, 6);
    expect(n.nz).toBeCloseTo(0, 6);
  });
});

// ─── computeStructuralPositions ──────────────────────────────────────────────

describe('computeStructuralPositions', () => {
  const traceRows = [
    { hole_id: 'H1', md: 0,  x: 100, y: 200, z: 50 },
    { hole_id: 'H1', md: 10, x: 100, y: 200, z: 40 },
    { hole_id: 'H1', md: 20, x: 100, y: 200, z: 30 },
    { hole_id: 'H2', md: 0,  x: 0,   y: 0,   z: 100 },
    { hole_id: 'H2', md: 20, x: 14,  y: 14,  z: 86 },
  ];

  it('returns empty array for empty structures or empty trace rows', () => {
    expect(computeStructuralPositions([], traceRows)).toEqual([]);
    expect(computeStructuralPositions(null, traceRows)).toEqual([]);
    expect(computeStructuralPositions([{ hole_id: 'H1', depth: 5, alpha: 90, beta: 0 }], [])).toEqual([]);
    expect(computeStructuralPositions([{ hole_id: 'H1', depth: 5, alpha: 90, beta: 0 }], null)).toEqual([]);
  });

  it('enriches rows with x, y, z, nx, ny, nz from alpha/beta', () => {
    const structures = [{ hole_id: 'H1', depth: 10, alpha: 90, beta: 0 }];
    const result = computeStructuralPositions(structures, traceRows);
    expect(result).toHaveLength(1);
    const r = result[0];
    expect(Number.isFinite(r.x)).toBe(true);
    expect(Number.isFinite(r.y)).toBe(true);
    expect(Number.isFinite(r.z)).toBe(true);
    expect(Number.isFinite(r.nx)).toBe(true);
    expect(Number.isFinite(r.ny)).toBe(true);
    expect(Number.isFinite(r.nz)).toBe(true);
  });

  it('preserves original fields in output rows', () => {
    const structures = [{ hole_id: 'H1', depth: 5, alpha: 90, beta: 45, grade: 1.23, lithology: 'sandstone' }];
    const result = computeStructuralPositions(structures, traceRows);
    expect(result[0].grade).toBe(1.23);
    expect(result[0].lithology).toBe('sandstone');
  });

  it('position x/y/z matches interpolated trace at given depth', () => {
    const structures = [{ hole_id: 'H1', depth: 5, alpha: 90, beta: 0 }];
    const result = computeStructuralPositions(structures, traceRows);
    // At md=5 on H1: x=100, y=200, z=45
    expect(result[0].x).toBeCloseTo(100);
    expect(result[0].y).toBeCloseTo(200);
    expect(result[0].z).toBeCloseTo(45);
  });

  it('accepts "mid" field as fallback for depth', () => {
    const structures = [{ hole_id: 'H1', mid: 10, alpha: 90, beta: 0 }];
    const result = computeStructuralPositions(structures, traceRows);
    expect(result).toHaveLength(1);
    expect(result[0].z).toBeCloseTo(40);
  });

  it('"depth" takes priority over "mid"', () => {
    const structures = [{ hole_id: 'H1', depth: 0, mid: 20, alpha: 90, beta: 0 }];
    const result = computeStructuralPositions(structures, traceRows);
    expect(result[0].z).toBeCloseTo(50); // depth=0, not mid=20
  });

  it('uses geographic dip/azimuth when alpha is absent', () => {
    const structures = [{ hole_id: 'H1', depth: 10, dip: 60, azimuth: 90 }];
    const result = computeStructuralPositions(structures, traceRows);
    expect(result).toHaveLength(1);
    const r = result[0];
    const dipRad = (60 * Math.PI) / 180;
    const azRad = (90 * Math.PI) / 180;
    expect(r.nx).toBeCloseTo(Math.sin(azRad) * Math.sin(dipRad), 6);
    expect(r.ny).toBeCloseTo(Math.cos(azRad) * Math.sin(dipRad), 6);
    expect(r.nz).toBeCloseTo(Math.cos(dipRad), 6);
  });

  it('skips rows with no hole_id', () => {
    const structures = [
      { depth: 5, alpha: 90, beta: 0 },
      { hole_id: '', depth: 5, alpha: 90, beta: 0 },
    ];
    expect(computeStructuralPositions(structures, traceRows)).toHaveLength(0);
  });

  it('skips rows whose hole_id has no matching trace', () => {
    const structures = [{ hole_id: 'UNKNOWN', depth: 5, alpha: 90, beta: 0 }];
    expect(computeStructuralPositions(structures, traceRows)).toHaveLength(0);
  });

  it('matches hole_id case-insensitively', () => {
    const structures = [
      { hole_id: 'h1', depth: 10, alpha: 90, beta: 0 },
      { hole_id: 'H1', depth: 10, alpha: 90, beta: 0 },
    ];
    const result = computeStructuralPositions(structures, traceRows);
    expect(result).toHaveLength(2);
  });

  it('skips rows with non-finite depth and no mid', () => {
    const structures = [
      { hole_id: 'H1', depth: NaN, alpha: 90, beta: 0 },
      { hole_id: 'H1', depth: null, mid: null, alpha: 90, beta: 0 },
      { hole_id: 'H1', alpha: 90, beta: 0 }, // neither depth nor mid
    ];
    expect(computeStructuralPositions(structures, traceRows)).toHaveLength(0);
  });

  it('skips rows with no alpha and missing dip or azimuth fields', () => {
    const structures = [
      { hole_id: 'H1', depth: 5, dip: 45 },          // azimuth missing
      { hole_id: 'H1', depth: 5, azimuth: 90 },       // dip missing
      { hole_id: 'H1', depth: 5 },                    // both missing
    ];
    expect(computeStructuralPositions(structures, traceRows)).toHaveLength(0);
  });

  it('defaults beta to 0 when alpha is present but beta is missing', () => {
    const withBeta = computeStructuralPositions(
      [{ hole_id: 'H1', depth: 10, alpha: 90, beta: 0 }], traceRows
    );
    const withoutBeta = computeStructuralPositions(
      [{ hole_id: 'H1', depth: 10, alpha: 90 }], traceRows
    );
    expect(withoutBeta[0].nx).toBeCloseTo(withBeta[0].nx, 6);
    expect(withoutBeta[0].ny).toBeCloseTo(withBeta[0].ny, 6);
    expect(withoutBeta[0].nz).toBeCloseTo(withBeta[0].nz, 6);
  });

  it('normal vector from alpha/beta is a unit vector', () => {
    const structures = [
      { hole_id: 'H1', depth: 5,  alpha: 90, beta: 0 },
      { hole_id: 'H1', depth: 10, alpha: 45, beta: 90 },
      { hole_id: 'H1', depth: 15, alpha: 0,  beta: 0 },
    ];
    const results = computeStructuralPositions(structures, traceRows);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(norm([r.nx, r.ny, r.nz])).toBeCloseTo(1, 10);
    }
  });

  it('handles multiple holes in a single call', () => {
    const structures = [
      { hole_id: 'H1', depth: 10, alpha: 90, beta: 0 },
      { hole_id: 'H2', depth: 10, alpha: 90, beta: 0 },
    ];
    const result = computeStructuralPositions(structures, traceRows);
    expect(result).toHaveLength(2);
    const h1 = result.find((r) => r.hole_id === 'H1');
    const h2 = result.find((r) => r.hole_id === 'H2');
    expect(h1.x).toBeCloseTo(100);
    expect(h2.x).toBeCloseTo(7); // midpoint of H2 diagonal trace at md=10
  });

  it('handles extrapolation for depth beyond trace max', () => {
    const structures = [{ hole_id: 'H1', depth: 30, alpha: 90, beta: 0 }];
    const result = computeStructuralPositions(structures, traceRows);
    expect(result).toHaveLength(1);
    expect(result[0].z).toBeCloseTo(20); // extrapolated using last segment
  });
});
