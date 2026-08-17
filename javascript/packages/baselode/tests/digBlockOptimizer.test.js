/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  createSyntheticDigBlockModel,
  digDirectionAxes,
  optimizeDigBlocks,
} from '../src/grade_blocks/digBlockOptimizer.js';

describe('digDirectionAxes', () => {
  it('uses bearings clockwise from north', () => {
    expect(digDirectionAxes(0).forward).toEqual({ x: 0, y: 1 });
    expect(digDirectionAxes(90).forward.x).toBeCloseTo(1);
    expect(digDirectionAxes(90).forward.y).toBeCloseTo(0);
  });
});

describe('optimizeDigBlocks', () => {
  const fixture = createSyntheticDigBlockModel();

  it('assigns every eligible cell exactly once', () => {
    const result = optimizeDigBlocks(fixture.cells, fixture.blastPolygon, {
      digDirectionDeg: 20,
      targetTonnes: 10_000,
      targetGrade: 58,
    });
    const assignedIds = result.assignments.map(({ cellId }) => cellId);

    expect(new Set(assignedIds).size).toBe(fixture.cells.length);
    expect(assignedIds).toHaveLength(fixture.cells.length);
    expect(result.metrics.totalTonnes).toBeGreaterThan(190_000);
    expect(result.metrics.totalTonnes).toBeLessThan(220_000);
    expect(result.blocks).toHaveLength(result.metrics.blockCount);
    expect(result.blocks.every((block) => block.polygon[0][0] === block.polygon.at(-1)[0]
      && block.polygon[0][1] === block.polygon.at(-1)[1])).toBe(true);
  });

  it('is deterministic for the same controls', () => {
    const options = { digDirectionDeg: 35, targetTonnes: 12_000, targetGrade: 57 };
    expect(optimizeDigBlocks(fixture.cells, fixture.blastPolygon, options))
      .toEqual(optimizeDigBlocks(fixture.cells, fixture.blastPolygon, options));
  });

  it('uses the weighted source grade when no target is supplied', () => {
    const result = optimizeDigBlocks(fixture.cells, fixture.blastPolygon);
    expect(result.options.targetGrade).toBeCloseTo(result.metrics.weightedGrade);
  });

  it('responds to target tonnes and mining direction', () => {
    const small = optimizeDigBlocks(fixture.cells, fixture.blastPolygon, { targetTonnes: 8_000, digDirectionDeg: 0 });
    const large = optimizeDigBlocks(fixture.cells, fixture.blastPolygon, { targetTonnes: 16_000, digDirectionDeg: 90 });

    expect(small.blocks.length).toBeGreaterThan(large.blocks.length);
    expect(small.blocks[0].polygon).not.toEqual(large.blocks[0].polygon);
  });

  it('partitions thousands of cells in one shallow face band', () => {
    const cells = Array.from({ length: 5_000 }, (_, index) => ({
      id: `PERF-${index}`,
      x: index + 0.5,
      y: 0.5,
      dx: 1,
      dy: 1,
      tonnes: 2,
      fe: 55 + (index % 20) / 10,
      geology: index % 2 ? 'A' : 'B',
      hardness: 5,
    }));
    const result = optimizeDigBlocks(cells, [[0, 0], [5_000, 0], [5_000, 1], [0, 1]], {
      targetTonnes: 100,
      targetGrade: 56,
      targetFaceToDepthRatio: 50,
    });

    expect(result.assignments).toHaveLength(5_000);
    expect(result.blocks.length).toBeGreaterThan(50);
    expect(result.blocks.length).toBeLessThan(150);
  });

  it('rejects invalid physicals and empty selections', () => {
    expect(() => optimizeDigBlocks([{ x: 0, y: 0, tonnes: 1 }], [[-1, -1], [1, -1], [0, 1]]))
      .toThrow(/requires finite/);
    expect(() => optimizeDigBlocks(fixture.cells, [[500, 500], [510, 500], [500, 510]]))
      .toThrow(/does not contain/);
  });
});
