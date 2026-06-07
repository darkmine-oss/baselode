/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  intervalLength,
  fromToMidpoints,
  detectGaps,
  detectOverlaps,
  splitAt,
  clip,
  mergeTables,
} from '../src/data/intervals.js';

const makeRow = (hole_id, from, to, grade) => ({ hole_id, from, to, grade });

describe('intervalLength', () => {
  it('returns per-row length', () => {
    expect(intervalLength([makeRow('A', 0, 1.5, 0.1), makeRow('A', 1.5, 3, 0.2)])).toEqual([1.5, 1.5]);
  });
});

describe('fromToMidpoints', () => {
  it('returns per-row midpoint', () => {
    expect(fromToMidpoints([makeRow('A', 0, 10, 0.1)])).toEqual([5]);
  });
});

describe('detectGaps', () => {
  it('returns empty for touching intervals', () => {
    expect(detectGaps([makeRow('A', 0, 1, 0.1), makeRow('A', 1, 2, 0.2)])).toEqual([]);
  });

  it('reports a single gap', () => {
    const gaps = detectGaps([makeRow('A', 0, 1, 0.1), makeRow('A', 2.5, 3, 0.2)]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ hole_id: 'A', from: 1, to: 2.5, length: 1.5 });
  });

  it('respects minGap', () => {
    const gaps = detectGaps(
      [makeRow('A', 0, 1, 0.1), makeRow('A', 1.001, 2, 0.2), makeRow('A', 5, 6, 0.3)],
      { minGap: 0.5 },
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0].from).toBe(2);
    expect(gaps[0].to).toBe(5);
  });

  it('isolates gaps per hole', () => {
    const gaps = detectGaps([makeRow('A', 0, 1, 0.1), makeRow('A', 2, 3, 0.2), makeRow('B', 5, 6, 0.3)]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].hole_id).toBe('A');
  });
});

describe('detectOverlaps', () => {
  it('returns empty when intervals only touch', () => {
    expect(detectOverlaps([makeRow('A', 0, 1, 0.1), makeRow('A', 1, 2, 0.2)])).toEqual([]);
  });

  it('reports a single overlap', () => {
    const overlaps = detectOverlaps([makeRow('A', 0, 1.5, 0.1), makeRow('A', 1, 2, 0.2)]);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ from: 1, to: 1.5, length: 0.5 });
    expect(overlaps[0].first_index).toBe(0);
    expect(overlaps[0].second_index).toBe(1);
  });

  it('isolates overlaps per hole', () => {
    const overlaps = detectOverlaps([
      makeRow('A', 0, 1.5, 0.1),
      makeRow('A', 1, 2, 0.2),
      makeRow('B', 0, 1, 0.3),
      makeRow('B', 2, 3, 0.4),
    ]);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].hole_id).toBe('A');
  });
});

describe('splitAt', () => {
  it('splits through inner depths', () => {
    const out = splitAt([makeRow('A', 0, 10, 0.5)], { A: [3, 7] });
    expect(out).toHaveLength(3);
    expect(out.map((row) => row.from)).toEqual([0, 3, 7]);
    expect(out.map((row) => row.to)).toEqual([3, 7, 10]);
    expect(out.every((row) => row.grade === 0.5)).toBe(true);
  });

  it('ignores boundaries at endpoints', () => {
    const out = splitAt([makeRow('A', 0, 10, 0.5)], { A: [0, 10] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ from: 0, to: 10 });
  });

  it('broadcasts a list to every hole', () => {
    const out = splitAt([makeRow('A', 0, 10, 0.1), makeRow('B', 0, 10, 0.2)], [5]);
    expect(out).toHaveLength(4);
    expect([...new Set(out.map((row) => row.from))].sort((first, second) => first - second)).toEqual([0, 5]);
  });

  it('accepts an array of {hole_id, depth} rows', () => {
    const out = splitAt(
      [makeRow('A', 0, 10, 0.1), makeRow('B', 0, 10, 0.2)],
      [{ hole_id: 'A', depth: 4 }, { hole_id: 'B', depth: 6 }],
    );
    const fromsA = out.filter((row) => row.hole_id === 'A').map((row) => row.from);
    const fromsB = out.filter((row) => row.hole_id === 'B').map((row) => row.from);
    expect(fromsA).toEqual([0, 4]);
    expect(fromsB).toEqual([0, 6]);
  });
});

describe('clip', () => {
  it('drops intervals entirely outside the window', () => {
    const out = clip([makeRow('A', 0, 1, 0.1), makeRow('A', 5, 6, 0.2)], 2, 4);
    expect(out).toEqual([]);
  });

  it('trims straddling intervals', () => {
    const out = clip([makeRow('A', 0, 3, 0.1), makeRow('A', 4, 8, 0.2)], 1, 6);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ from: 1, to: 3 });
    expect(out[1]).toMatchObject({ from: 4, to: 6 });
  });
});

describe('mergeTables', () => {
  it('aligns columns on a common support', () => {
    const assay = [
      { hole_id: 'A', from: 0, to: 5, cu: 0.1 },
      { hole_id: 'A', from: 5, to: 10, cu: 0.2 },
    ];
    const litho = [
      { hole_id: 'A', from: 0, to: 3, rock: 'x' },
      { hole_id: 'A', from: 3, to: 10, rock: 'y' },
    ];
    const merged = mergeTables({ assay, litho });
    expect(merged.map((row) => row.from)).toEqual([0, 3, 5]);
    expect(merged.map((row) => row.to)).toEqual([3, 5, 10]);
    expect(merged.map((row) => row.assay_cu)).toEqual([0.1, 0.1, 0.2]);
    expect(merged.map((row) => row.litho_rock)).toEqual(['x', 'y', 'y']);
  });

  it('emits null when another table misses the hole', () => {
    const assay = [{ hole_id: 'A', from: 0, to: 5, cu: 0.1 }];
    const litho = [{ hole_id: 'B', from: 0, to: 5, rock: 'x' }];
    const merged = mergeTables({ assay, litho });
    expect(merged).toHaveLength(1);
    expect(merged[0].assay_cu).toBe(0.1);
    expect(merged[0].litho_rock).toBeNull();
  });

  it('returns empty for empty input', () => {
    expect(mergeTables({})).toEqual([]);
    expect(mergeTables({ a: [] })).toEqual([]);
  });
});

describe('edge cases', () => {
  it('all functions accept empty input', () => {
    expect(intervalLength([])).toEqual([]);
    expect(fromToMidpoints([])).toEqual([]);
    expect(detectGaps([])).toEqual([]);
    expect(detectOverlaps([])).toEqual([]);
    expect(splitAt([], [1])).toEqual([]);
    expect(clip([], 0, 1)).toEqual([]);
  });
});
