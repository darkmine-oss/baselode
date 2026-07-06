/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, it, expect } from 'vitest';
import { mergeHoleSets } from '../src/viz/useDrillholeTraceGrid.jsx';

describe('mergeHoleSets', () => {
  const assayPoint = { from: 0, to: 4, au_ppm: 0.5 };
  const structuralPoint = { depth: 12, dip: 45 };

  it('concatenates points for holes present in both sets', () => {
    const merged = mergeHoleSets(
      [{ id: 'H1', points: [assayPoint] }],
      [{ id: 'H1', points: [structuralPoint] }, { id: 'H2', points: [] }],
    );
    const byId = Object.fromEntries(merged.map((hole) => [hole.id, hole]));
    expect(byId.H1.points).toEqual([assayPoint, structuralPoint]);
    expect(byId.H2).toBeDefined();
  });

  it('is idempotent when the same extra rows are re-presented', () => {
    // The extra-holes effect re-runs on every caller array identity change
    // (e.g. a second async source landing) and re-presents rows already
    // merged; those must not concatenate twice.
    const extras = [{ id: 'H1', points: [structuralPoint] }];
    const once = mergeHoleSets([{ id: 'H1', points: [assayPoint] }], extras);
    const twice = mergeHoleSets(once, extras);
    expect(twice[0].points).toEqual([assayPoint, structuralPoint]);
  });
});
