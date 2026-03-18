/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from 'vitest';

import { buildInterpSamplesFromAssays } from '../src/interpolation/InterpSamplePoint.js';
import { computeVolumeBounds, buildVolumeBoundsFromMinMax } from '../src/interpolation/computeVolumeBounds.js';
import { SpatialHash3D } from '../src/interpolation/SpatialHash3D.js';
import { IDWSampler }    from '../src/interpolation/IDWSampler.js';
import { buildVoxelGrid, voxelGridStats } from '../src/interpolation/buildVoxelGrid.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSample(id, x, y, z, value) {
  return { id: String(id), holeId: 'H1', x, y, z, value };
}

// ---------------------------------------------------------------------------
// buildInterpSamplesFromAssays
// ---------------------------------------------------------------------------

describe('buildInterpSamplesFromAssays', () => {
  it('returns empty array for missing inputs', () => {
    expect(buildInterpSamplesFromAssays(null, 'Au')).toHaveLength(0);
    expect(buildInterpSamplesFromAssays([], 'Au')).toHaveLength(0);
    expect(buildInterpSamplesFromAssays([{ x: 0, y: 0, z: 0, Au: 5, from: 0, to: 1 }], null)).toHaveLength(0);
  });

  it('extracts samples from desurveyed rows with x/y/z', () => {
    const rows = [
      { holeId: 'H1', from: 0, to: 10, Au: 100, x: 10, y: 20, z: -5 },
    ];
    const samples = buildInterpSamplesFromAssays(rows, 'Au');
    expect(samples).toHaveLength(1);
    expect(samples[0].value).toBe(100);
    expect(samples[0].x).toBe(10);
    expect(samples[0].y).toBe(20);
    expect(samples[0].z).toBe(-5);
    expect(samples[0].holeId).toBe('H1');
  });

  it('uses collar-position fallback with vertical assumption', () => {
    const rows = [
      { holeId: 'H1', from: 0, to: 10, Au: 50, x_collar: 5, y_collar: 15, z_collar: 100 },
    ];
    const samples = buildInterpSamplesFromAssays(rows, 'Au');
    expect(samples).toHaveLength(1);
    // midMd = 5; z = collar_z - midMd = 100 - 5 = 95
    expect(samples[0].z).toBeCloseTo(95);
    expect(samples[0].x).toBe(5);
  });

  it('skips rows with non-finite attribute values', () => {
    const rows = [
      { holeId: 'H1', from: 0, to: 10, Au: NaN, x: 0, y: 0, z: 0 },
      { holeId: 'H1', from: 0, to: 10, Au: null, x: 0, y: 0, z: 0 },
      { holeId: 'H1', from: 0, to: 10, Au: 5, x: 0, y: 0, z: 0 },
    ];
    const samples = buildInterpSamplesFromAssays(rows, 'Au');
    expect(samples).toHaveLength(1);
    expect(samples[0].value).toBe(5);
  });

  it('skips rows with negative interval length', () => {
    const rows = [
      { holeId: 'H1', from: 10, to: 5, Au: 1, x: 0, y: 0, z: 0 },
    ];
    expect(buildInterpSamplesFromAssays(rows, 'Au')).toHaveLength(0);
  });

  it('attaches length to samples', () => {
    const rows = [
      { holeId: 'H1', from: 0, to: 4, Au: 10, x: 0, y: 0, z: 0 },
    ];
    const samples = buildInterpSamplesFromAssays(rows, 'Au');
    expect(samples[0].length).toBeCloseTo(4);
  });
});

// ---------------------------------------------------------------------------
// computeVolumeBounds
// ---------------------------------------------------------------------------

describe('computeVolumeBounds', () => {
  it('returns zero bounds for empty input', () => {
    const b = computeVolumeBounds([]);
    expect(b.min).toEqual([0, 0, 0]);
    expect(b.max).toEqual([0, 0, 0]);
    expect(b.size).toEqual([0, 0, 0]);
    expect(b.center).toEqual([0, 0, 0]);
  });

  it('wraps a single point with zero size', () => {
    const b = computeVolumeBounds([{ x: 5, y: 10, z: -3 }]);
    expect(b.min).toEqual([5, 10, -3]);
    expect(b.max).toEqual([5, 10, -3]);
    expect(b.size).toEqual([0, 0, 0]);
    expect(b.center).toEqual([5, 10, -3]);
  });

  it('computes correct bounds for multiple points', () => {
    const pts = [
      { x: 0,  y: 0,  z: 0  },
      { x: 10, y: 20, z: -5 },
      { x: 5,  y: 30, z: 15 },
    ];
    const b = computeVolumeBounds(pts);
    expect(b.min).toEqual([0, 0, -5]);
    expect(b.max).toEqual([10, 30, 15]);
    expect(b.size).toEqual([10, 30, 20]);
    expect(b.center).toEqual([5, 15, 5]);
  });

  it('applies padding correctly', () => {
    const pts = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 }];
    const b = computeVolumeBounds(pts, 5);
    expect(b.min).toEqual([-5, -5, -5]);
    expect(b.max).toEqual([15, 15, 15]);
    expect(b.size).toEqual([20, 20, 20]);
  });

  it('ignores non-finite point coordinates', () => {
    const pts = [
      { x: NaN, y: 0,  z: 0 },
      { x: 0,   y: 10, z: 5 },
    ];
    const b = computeVolumeBounds(pts);
    expect(b.min[0]).toBe(0);
  });
});

describe('buildVolumeBoundsFromMinMax', () => {
  it('constructs correct bounds', () => {
    const b = buildVolumeBoundsFromMinMax(0, 0, 0, 10, 20, 30);
    expect(b.min).toEqual([0, 0, 0]);
    expect(b.max).toEqual([10, 20, 30]);
    expect(b.size).toEqual([10, 20, 30]);
    expect(b.center).toEqual([5, 10, 15]);
  });
});

// ---------------------------------------------------------------------------
// SpatialHash3D
// ---------------------------------------------------------------------------

describe('SpatialHash3D', () => {
  it('reports correct size after build', () => {
    const idx = new SpatialHash3D({ cellSize: 10 });
    idx.build([makeSample(1, 0, 0, 0, 1), makeSample(2, 5, 5, 5, 2)]);
    expect(idx.size).toBe(2);
  });

  it('queryRadius returns points within radius', () => {
    const idx = new SpatialHash3D({ cellSize: 10 });
    const pts = [
      makeSample(1, 0,  0,  0, 1),
      makeSample(2, 5,  0,  0, 2),
      makeSample(3, 20, 0,  0, 3), // far
    ];
    idx.build(pts);
    const res = idx.queryRadius(0, 0, 0, 10);
    expect(res.length).toBe(2);
    expect(res.map(p => p.id).sort()).toEqual(['1', '2']);
  });

  it('queryRadius returns empty for no matches', () => {
    const idx = new SpatialHash3D({ cellSize: 10 });
    idx.build([makeSample(1, 100, 100, 100, 1)]);
    expect(idx.queryRadius(0, 0, 0, 5)).toHaveLength(0);
  });

  it('queryRadius includes points exactly on the boundary', () => {
    const idx = new SpatialHash3D({ cellSize: 5 });
    idx.build([makeSample(1, 10, 0, 0, 1)]);
    // distance = 10, radius = 10 → should be included
    expect(idx.queryRadius(0, 0, 0, 10)).toHaveLength(1);
  });

  it('queryKNearest returns sorted nearest neighbours', () => {
    const idx = new SpatialHash3D({ cellSize: 10 });
    idx.build([
      makeSample(1, 1, 0, 0, 1),
      makeSample(2, 3, 0, 0, 2),
      makeSample(3, 10, 0, 0, 3),
    ]);
    const res = idx.queryKNearest(0, 0, 0, 2);
    expect(res).toHaveLength(2);
    expect(res[0].id).toBe('1');
    expect(res[1].id).toBe('2');
  });

  it('queryKNearest handles k > number of points', () => {
    const idx = new SpatialHash3D({ cellSize: 10 });
    idx.build([makeSample(1, 0, 0, 0, 1)]);
    expect(idx.queryKNearest(0, 0, 0, 5)).toHaveLength(1);
  });

  it('rebuild replaces old index', () => {
    const idx = new SpatialHash3D({ cellSize: 10 });
    idx.build([makeSample(1, 0, 0, 0, 1)]);
    idx.build([makeSample(2, 50, 50, 50, 2)]);
    expect(idx.size).toBe(1);
    expect(idx.queryRadius(0, 0, 0, 5)).toHaveLength(0);
  });

  it('handles grid cell boundary crossing correctly', () => {
    // Points straddling adjacent cells
    const idx = new SpatialHash3D({ cellSize: 10 });
    idx.build([
      makeSample(1,  9.9, 0, 0, 1),  // just inside cell [0]
      makeSample(2, 10.1, 0, 0, 2),  // just inside cell [1]
    ]);
    // From origin with radius 11, both should be found
    const res = idx.queryRadius(0, 0, 0, 11);
    expect(res).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// IDWSampler
// ---------------------------------------------------------------------------

describe('IDWSampler', () => {
  it('returns nodata when no samples are provided', () => {
    const s = new IDWSampler([], { searchRadius: 100 });
    expect(s.getValueAt(0, 0, 0)).toBeNaN();
  });

  it('returns exact value for a coincident sample', () => {
    const samples = [makeSample(1, 5, 5, 5, 42)];
    const s = new IDWSampler(samples, { searchRadius: 100, epsilon: 0.001 });
    // Exact hit (distance = 0)
    expect(s.getValueAt(5, 5, 5)).toBe(42);
  });

  it('returns exact value for near-coincident sample within epsilon', () => {
    const samples = [makeSample(1, 0, 0, 0, 99)];
    const s = new IDWSampler(samples, { searchRadius: 100, epsilon: 0.1 });
    expect(s.getValueAt(0.05, 0, 0)).toBe(99);
  });

  it('two-sample midpoint returns average for power=1', () => {
    const samples = [
      makeSample(1,  10, 0, 0, 0),
      makeSample(2, -10, 0, 0, 100),
    ];
    // query at origin: equidistant from both → average
    const s = new IDWSampler(samples, { power: 1, searchRadius: 50 });
    const v = s.getValueAt(0, 0, 0);
    expect(v).toBeCloseTo(50, 5);
  });

  it('interpolation is biased toward closer sample for power=2', () => {
    const samples = [
      makeSample(1, 1, 0, 0, 0),   // distance 1
      makeSample(2, 10, 0, 0, 100), // distance 9
    ];
    const s = new IDWSampler(samples, { power: 2, searchRadius: 50 });
    const v = s.getValueAt(0, 0, 0);
    // w1 = 1/1^2 = 1, w2 = 1/9^2 ≈ 0.0123
    // v ≈ (0 * 1 + 100 * 0.0123) / (1 + 0.0123) ≈ 1.22
    expect(v).toBeLessThan(10);
    expect(v).toBeGreaterThan(0);
  });

  it('returns nodata when no samples within radius', () => {
    const s = new IDWSampler([makeSample(1, 100, 100, 100, 5)], { searchRadius: 10 });
    const v = s.getValueAt(0, 0, 0);
    expect(v).toBeNaN();
  });

  it('custom nodataValue is returned when no neighbours', () => {
    const s = new IDWSampler([], { searchRadius: 10, nodataValue: -9999 });
    expect(s.getValueAt(0, 0, 0)).toBe(-9999);
  });

  it('respects minNeighbors', () => {
    const samples = [makeSample(1, 1, 0, 0, 5)];
    const s = new IDWSampler(samples, { searchRadius: 100, minNeighbors: 2 });
    expect(s.getValueAt(0, 0, 0)).toBeNaN();
  });

  it('respects maxNeighbors cap', () => {
    // 10 identical samples at different positions, all close
    const samples = Array.from({ length: 10 }, (_, i) =>
      makeSample(i, i * 2, 0, 0, i * 10)
    );
    const s = new IDWSampler(samples, {
      power: 2,
      searchRadius: 100,
      maxNeighbors: 3,
    });
    // Should still return a finite value
    const v = s.getValueAt(0, 0, 0);
    expect(isFinite(v)).toBe(true);
  });

  it('higher power concentrates weight on closest sample', () => {
    const samples = [
      makeSample(1, 1,  0, 0, 0),
      makeSample(2, 10, 0, 0, 100),
    ];
    const s2  = new IDWSampler(samples, { power: 2,  searchRadius: 50 });
    const s10 = new IDWSampler(samples, { power: 10, searchRadius: 50 });
    const v2  = s2.getValueAt(0, 0, 0);
    const v10 = s10.getValueAt(0, 0, 0);
    // Higher power → value is even more dominated by the nearest (0) sample
    expect(v10).toBeLessThan(v2);
  });

  it('setSamples rebuilds the index', () => {
    const s = new IDWSampler([makeSample(1, 0, 0, 0, 5)], { searchRadius: 10 });
    expect(isFinite(s.getValueAt(0, 0, 0))).toBe(true);
    s.setSamples([makeSample(2, 100, 100, 100, 99)]);
    expect(s.getValueAt(0, 0, 0)).toBeNaN(); // original sample gone
  });
});

// ---------------------------------------------------------------------------
// buildVoxelGrid
// ---------------------------------------------------------------------------

describe('buildVoxelGrid', () => {
  // Simple single-sample field: constant value everywhere within radius
  const samples = [makeSample(1, 5, 5, 5, 10)];
  const bounds = computeVolumeBounds(samples, 5);
  const sampler = new IDWSampler(samples, { power: 2, searchRadius: 20 });

  it('returns correct dimensions', async () => {
    const grid = await buildVoxelGrid(sampler, bounds, [4, 4, 4], { sync: true });
    expect(grid.dims).toEqual([4, 4, 4]);
    expect(grid.values).toHaveLength(4 * 4 * 4);
    expect(grid.nodataMask).toHaveLength(4 * 4 * 4);
  });

  it('all voxels have the same value for a single-sample field', async () => {
    const grid = await buildVoxelGrid(sampler, bounds, [4, 4, 4], { sync: true });
    // Every voxel center is within searchRadius of the single sample
    for (let i = 0; i < grid.values.length; i++) {
      expect(grid.nodataMask[i]).toBe(0);
      expect(grid.values[i]).toBeCloseTo(10, 4);
    }
  });

  it('marks nodata voxels outside search radius', async () => {
    // Tiny radius so most voxels are empty
    const narrowSampler = new IDWSampler(samples, { power: 2, searchRadius: 0.1 });
    const grid = await buildVoxelGrid(narrowSampler, bounds, [4, 4, 4], { sync: true });
    const nodataCount = Array.from(grid.nodataMask).filter(v => v === 1).length;
    expect(nodataCount).toBeGreaterThan(0);
  });

  it('voxelSize matches bounds / dims', async () => {
    const grid = await buildVoxelGrid(sampler, bounds, [4, 8, 2], { sync: true });
    expect(grid.voxelSize[0]).toBeCloseTo(bounds.size[0] / 4, 8);
    expect(grid.voxelSize[1]).toBeCloseTo(bounds.size[1] / 8, 8);
    expect(grid.voxelSize[2]).toBeCloseTo(bounds.size[2] / 2, 8);
  });

  it('cancellation token aborts build early', async () => {
    const token = { cancelled: false };
    const bigSampler = new IDWSampler(samples, { power: 2, searchRadius: 100 });
    const promise = buildVoxelGrid(bigSampler, bounds, [16, 16, 16], {
      cancellationToken: token,
    });
    token.cancelled = true;
    const grid = await promise;
    // Grid may have partial data; values array still exists
    expect(grid.values).toBeInstanceOf(Float32Array);
  });

  it('onProgress callback is called', async () => {
    const calls = [];
    await buildVoxelGrid(sampler, bounds, [4, 4, 4], {
      sync: true,
      onProgress: (p) => calls.push(p),
    });
    expect(calls.length).toBeGreaterThan(0);
    const last = calls[calls.length - 1];
    expect(last.completed).toBe(4 * 4 * 4);
    expect(last.total).toBe(4 * 4 * 4);
  });

  it('stores bounds reference on the returned grid', async () => {
    const grid = await buildVoxelGrid(sampler, bounds, [2, 2, 2], { sync: true });
    expect(grid.bounds).toBe(bounds);
  });
});

describe('voxelGridStats', () => {
  it('computes voxelSize and total', () => {
    const bounds = buildVolumeBoundsFromMinMax(0, 0, 0, 10, 20, 30);
    const stats = voxelGridStats(bounds, [5, 4, 3]);
    expect(stats.total).toBe(60);
    expect(stats.voxelSize[0]).toBeCloseTo(2, 8);
    expect(stats.voxelSize[1]).toBeCloseTo(5, 8);
    expect(stats.voxelSize[2]).toBeCloseTo(10, 8);
  });
});
