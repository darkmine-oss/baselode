/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import { parseDrillholesCSV } from '../src/data/drillholeLoader.js';

describe('parseDrillholesCSV', () => {
  it('preserves md on each point even when source uses md/depth/survey_depth aliases', async () => {
    // Source column "md" — the canonical name in our skill output and most
    // Baselode-converted datasets.
    const csvMd = [
      'hole_id,md,easting,northing,elevation',
      'H1,0,500000,6900000,300',
      'H1,1,500000.5,6900000,299.13',
      'H1,2,500001,6900000,298.27',
    ].join('\n');
    const { holes: holesMd } = await parseDrillholesCSV(csvMd);
    expect(holesMd).toHaveLength(1);
    expect(holesMd[0].points).toHaveLength(3);
    expect(holesMd[0].points.map((p) => p.md)).toEqual([0, 1, 2]);
    // The canonical `depth` field is also populated (it's what
    // standardizeColumns produces internally).
    expect(holesMd[0].points.map((p) => p.depth)).toEqual([0, 1, 2]);

    // Source column "depth" — should land in both fields too.
    const csvDepth = [
      'hole_id,depth,easting,northing,elevation',
      'H1,0,500000,6900000,300',
      'H1,5,500001,6900000,295',
    ].join('\n');
    const { holes: holesDepth } = await parseDrillholesCSV(csvDepth);
    expect(holesDepth[0].points.map((p) => p.md)).toEqual([0, 5]);
    expect(holesDepth[0].points.map((p) => p.depth)).toEqual([0, 5]);
  });

  it('drops rows missing x/y/z but keeps md alignment for survivors', async () => {
    const csv = [
      'hole_id,md,easting,northing,elevation',
      'H1,0,500000,6900000,300',
      'H1,1,,6900000,299',         // missing easting -> dropped
      'H1,2,500002,6900000,298',
    ].join('\n');
    const { holes } = await parseDrillholesCSV(csv);
    expect(holes[0].points).toHaveLength(2);
    expect(holes[0].points.map((p) => p.md)).toEqual([0, 2]);
  });
});
