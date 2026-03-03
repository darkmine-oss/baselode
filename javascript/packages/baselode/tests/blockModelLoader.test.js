/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import {
  normalizeBlockRow,
  loadBlockModelMetadata,
  calculatePropertyStats,
  getBlockStats,
  filterBlocks,
  calculateBlockVolume,
  getColorForValue,
} from '../src/data/blockModelLoader.js';


// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build a small block model data array using canonical x/y/z/dx/dy/dz names. */
function makeBlocks() {
  return [
    { x: 5, y: 5, z: 5, dx: 10, dy: 10, dz: 10, grade: 1.5, rock_type: 'fresh' },
    { x: 15, y: 5, z: 5, dx: 10, dy: 10, dz: 10, grade: 2.5, rock_type: 'oxide' },
    { x: 25, y: 5, z: 5, dx: 10, dy: 10, dz: 10, grade: 3.0, rock_type: 'fresh' },
  ];
}

/** Minimal THREE-like stub that createColor returns a plain object from. */
const THREE_STUB = {
  Color: class {
    constructor(val) { this._val = val || ''; }
    setHSL(h, s, l) { this._hsl = [h, s, l]; return this; }
  }
};


// ---------------------------------------------------------------------------
// normalizeBlockRow
// ---------------------------------------------------------------------------

describe('normalizeBlockRow', () => {
  it('passes through canonical x/y/z/dx/dy/dz unchanged', () => {
    const row = { x: 5, y: 5, z: 5, dx: 10, dy: 10, dz: 10, grade: 1.0 };
    expect(normalizeBlockRow(row)).toEqual(row);
  });

  it('normalises center_x/center_y/center_z to x/y/z', () => {
    const row = { center_x: 5, center_y: 10, center_z: 15 };
    const out = normalizeBlockRow(row);
    expect(out.x).toBe(5);
    expect(out.y).toBe(10);
    expect(out.z).toBe(15);
    expect('center_x' in out).toBe(false);
  });

  it('normalises size_x/size_y/size_z to dx/dy/dz', () => {
    const row = { size_x: 10, size_y: 10, size_z: 5 };
    const out = normalizeBlockRow(row);
    expect(out.dx).toBe(10);
    expect(out.dy).toBe(10);
    expect(out.dz).toBe(5);
  });

  it('normalises easting/northing/elevation to x/y/z', () => {
    const row = { easting: 500000, northing: 6900000, elevation: 300 };
    const out = normalizeBlockRow(row);
    expect(out.x).toBe(500000);
    expect(out.y).toBe(6900000);
    expect(out.z).toBe(300);
  });

  it('keeps unrecognised keys unchanged', () => {
    const row = { x: 5, y: 5, z: 5, dx: 10, dy: 10, dz: 10, custom_attr: 'hello' };
    expect(normalizeBlockRow(row).custom_attr).toBe('hello');
  });
});


// ---------------------------------------------------------------------------
// loadBlockModelMetadata
// ---------------------------------------------------------------------------

describe('loadBlockModelMetadata', () => {
  it('parses a JSON string to an object', () => {
    const meta = { name: 'test', crs: 'EPSG:32750' };
    const result = loadBlockModelMetadata(JSON.stringify(meta));
    expect(result).toEqual(meta);
  });

  it('returns a plain object directly', () => {
    const meta = { name: 'direct' };
    expect(loadBlockModelMetadata(meta)).toBe(meta);
  });

  it('throws on invalid source', () => {
    expect(() => loadBlockModelMetadata(null)).toThrow();
  });
});


// ---------------------------------------------------------------------------
// calculatePropertyStats
// ---------------------------------------------------------------------------

describe('calculatePropertyStats', () => {
  const data = makeBlocks();

  it('returns numeric stats for a numeric column', () => {
    const stats = calculatePropertyStats(data, 'grade');
    expect(stats.type).toBe('numeric');
    expect(stats.min).toBe(1.5);
    expect(stats.max).toBe(3.0);
    expect(stats.values).toHaveLength(3);
  });

  it('returns categorical stats for a string column', () => {
    const stats = calculatePropertyStats(data, 'rock_type');
    expect(stats.type).toBe('categorical');
    expect(stats.categories).toContain('fresh');
    expect(stats.categories).toContain('oxide');
  });

  it('returns empty values for unknown column', () => {
    const stats = calculatePropertyStats(data, 'nonexistent');
    expect(stats.values).toHaveLength(0);
  });
});


// ---------------------------------------------------------------------------
// getBlockStats
// ---------------------------------------------------------------------------

describe('getBlockStats', () => {
  it('returns stats for all non-geometry columns', () => {
    const stats = getBlockStats(makeBlocks());
    expect(stats).toHaveProperty('grade');
    expect(stats).toHaveProperty('rock_type');
    // Geometry columns must not appear
    expect(stats).not.toHaveProperty('x');
    expect(stats).not.toHaveProperty('dx');
  });

  it('returns empty object for empty data', () => {
    expect(getBlockStats([])).toEqual({});
  });
});


// ---------------------------------------------------------------------------
// filterBlocks
// ---------------------------------------------------------------------------

describe('filterBlocks', () => {
  const data = makeBlocks();

  it('filters by exact categorical equality', () => {
    const fresh = filterBlocks(data, { rock_type: 'fresh' });
    expect(fresh).toHaveLength(2);
    fresh.forEach((b) => expect(b.rock_type).toBe('fresh'));
  });

  it('filters by numeric gt', () => {
    const high = filterBlocks(data, { grade: { gt: 2.0 } });
    expect(high).toHaveLength(2);
    high.forEach((b) => expect(b.grade).toBeGreaterThan(2.0));
  });

  it('filters by numeric gte + lte range', () => {
    const mid = filterBlocks(data, { grade: { gte: 2.0, lte: 2.9 } });
    expect(mid).toHaveLength(1);
    expect(mid[0].grade).toBe(2.5);
  });

  it('filters by in list', () => {
    const result = filterBlocks(data, { rock_type: { in: ['oxide'] } });
    expect(result).toHaveLength(1);
    expect(result[0].rock_type).toBe('oxide');
  });

  it('returns full data when criteria is null', () => {
    expect(filterBlocks(data, null)).toHaveLength(data.length);
  });

  it('filters by combined criteria', () => {
    const result = filterBlocks(data, { rock_type: 'fresh', grade: { gte: 2.5 } });
    expect(result).toHaveLength(1);
    expect(result[0].grade).toBe(3.0);
  });
});


// ---------------------------------------------------------------------------
// calculateBlockVolume
// ---------------------------------------------------------------------------

describe('calculateBlockVolume', () => {
  const data = makeBlocks();

  it('calculates total volume of all blocks', () => {
    // 3 blocks × (10 * 10 * 10) = 3000
    expect(calculateBlockVolume(data)).toBe(3000);
  });

  it('calculates filtered volume', () => {
    // 2 fresh blocks × 1000
    const vol = calculateBlockVolume(data, { rock_type: 'fresh' });
    expect(vol).toBe(2000);
  });

  it('returns 0 for empty data', () => {
    expect(calculateBlockVolume([])).toBe(0);
  });
});


// ---------------------------------------------------------------------------
// getColorForValue
// ---------------------------------------------------------------------------

describe('getColorForValue', () => {
  it('returns grey for null stats', () => {
    const c = getColorForValue(1.0, null, THREE_STUB);
    expect(c._val).toBe('#888888');
  });

  it('uses HSL for numeric stats', () => {
    const stats = { type: 'numeric', min: 0, max: 10 };
    const c = getColorForValue(5, stats, THREE_STUB);
    expect(c._hsl).toBeDefined();
  });

  it('uses HSL for categorical stats', () => {
    const stats = { type: 'categorical', categories: ['a', 'b', 'c'] };
    const c = getColorForValue('b', stats, THREE_STUB);
    expect(c._hsl).toBeDefined();
  });

  it('handles min=max without error', () => {
    const stats = { type: 'numeric', min: 5, max: 5 };
    expect(() => getColorForValue(5, stats, THREE_STUB)).not.toThrow();
  });
});
