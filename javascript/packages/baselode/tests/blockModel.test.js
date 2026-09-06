/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  blockModelBounds,
  blockModelCorners,
  blockModelDefinitionFromDict,
  blockModelDefinitionToDict,
  blockModelExtent,
  blockModelOutline2d,
  blockModelRotationMatrix,
  containsIndex,
  createBlockModelDefinition,
  indexToWorld,
  localToWorld,
  parentBlockSize,
  sameGrid,
  worldToIndex,
  worldToLocal,
} from '../src/blockmodel/blockModelDefinition.js';
import {
  aggregateToParentBlocks,
  attachBlockCentroids,
  attachBlockIndices,
  blockAttributeKeys,
  blockModelTonnage,
  blockModelVolume,
  clipBlocks,
  createBlockModel,
  diffBlockModels,
  findBlockAt,
  gradeTonnage,
  regularizeBlocks,
  sampleBlocksAt,
  selectBlocks,
  validateBlockModel,
} from '../src/blockmodel/blockModel.js';
import { parseBlockModelFromRows } from '../src/data/blockModelLoader.js';
import Papa from 'papaparse';

import reference from '../../../test/data/blockmodel/blockmodel_reference.json';
import legacyMeta from '../../../test/data/blockmodel/demo_blockmodel_meta.json';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_CSV = join(here, '../../../../test/data/blockmodel/demo_subblocked.csv');
const FIXTURE_META = join(here, '../../../../test/data/blockmodel/demo_subblocked_meta.json');

function definition(overrides = {}) {
  return createBlockModelDefinition({
    origin: [1000, 2000, 100],
    blockSize: [5, 5, 2.5],
    nBlocks: [4, 4, 4],
    parentSize: [2, 2, 2],
    ...overrides,
  });
}

function loadFixture() {
  const csv = readFileSync(FIXTURE_CSV, 'utf8');
  const parsed = Papa.parse(csv, { header: true, dynamicTyping: true, skipEmptyLines: true });
  const { data } = parseBlockModelFromRows(parsed.data);
  const meta = JSON.parse(readFileSync(FIXTURE_META, 'utf8'));
  return createBlockModel({ definition: blockModelDefinitionFromDict(meta), blocks: data });
}

const close = (a, b, digits = 6) => a.forEach((v, idx) => expect(v).toBeCloseTo(b[idx], digits));

describe('createBlockModelDefinition', () => {
  it('accepts arrays and keyed objects and derives parent size / extent', () => {
    const a = definition();
    const b = createBlockModelDefinition({
      origin: { x: 1000, y: 2000, z: 100 },
      blockSize: { dx: 5, dy: 5, dz: 2.5 },
      nBlocks: { nx: 4, ny: 4, nz: 4 },
      parentSize: { nx: 2, ny: 2, nz: 2 },
    });
    expect(blockModelDefinitionToDict(a)).toEqual(blockModelDefinitionToDict(b));
    expect(parentBlockSize(a)).toEqual([10, 10, 5]);
    expect(blockModelExtent(a)).toEqual([20, 20, 10]);
    expect(a.rotation).toEqual({ azimuth: 0, dip: 0, plunge: 0 });
  });

  it('rejects non-positive sizes and counts', () => {
    expect(() => definition({ blockSize: [5, 0, 2.5] })).toThrow(/> 0/);
    expect(() => definition({ nBlocks: [4, 4, 0] })).toThrow(/>= 1/);
    expect(() => definition({ parentSize: [2, 0, 2] })).toThrow(/>= 1/);
  });

  it('maps indices to world and back on an unrotated grid', () => {
    const d = definition();
    close(indexToWorld(d, 0, 0, 0), [1002.5, 2002.5, 101.25]);
    close(indexToWorld(d, 1, 2, 3, 2, 1, 1), [1010, 2012.5, 108.75]);
    expect(worldToIndex(d, 1002.5, 2012.5, 108.75)).toEqual([0, 2, 3]);
    expect(worldToIndex(d, 1019.99, 2019.99, 109.99)).toEqual([3, 3, 3]);
    expect(containsIndex(d, 3, 3, 3)).toBe(true);
    expect(containsIndex(d, 3, 0, 0, 2)).toBe(false);
  });

  it('follows the azimuth / dip / plunge convention', () => {
    close(localToWorld(definition({ rotation: { azimuth: 90 } }), 0, 10, 0), [1010, 2000, 100]);
    close(localToWorld(definition({ rotation: { azimuth: 90 } }), 10, 0, 0), [1000, 1990, 100]);
    const dipped = localToWorld(definition({ rotation: { dip: 30 } }), 0, 10, 0);
    close([dipped[1], dipped[2]], [2000 + 10 * Math.cos(Math.PI / 6), 95]);
    const plunged = localToWorld(definition({ rotation: { plunge: 30 } }), 10, 0, 0);
    close([plunged[0], plunged[2]], [1000 + 10 * Math.cos(Math.PI / 6), 95]);
  });

  it('round-trips exactly on a fully rotated grid', () => {
    const d = definition({ rotation: [37, 12, -8] });
    const m = blockModelRotationMatrix(37, 12, -8);
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) {
        const dot = m[r][0] * m[c][0] + m[r][1] * m[c][1] + m[r][2] * m[c][2];
        expect(dot).toBeCloseTo(r === c ? 1 : 0, 12);
      }
    }
    for (const index of [[0, 0, 0], [3, 2, 1], [1, 3, 3]]) {
      const [x, y, z] = indexToWorld(d, ...index);
      expect(worldToIndex(d, x, y, z)).toEqual(index);
    }
    close(worldToLocal(d, ...localToWorld(d, 7.25, 3.5, 1.75)), [7.25, 3.5, 1.75], 9);
  });

  it('bounds, corners and outline follow the rotation', () => {
    const d = definition({ rotation: { azimuth: 90 } });
    const bounds = blockModelBounds(d);
    expect(bounds.min_x).toBeCloseTo(1000, 9);
    expect(bounds.max_x).toBeCloseTo(1020, 9);
    expect(bounds.min_y).toBeCloseTo(1980, 9);
    expect(bounds.max_y).toBeCloseTo(2000, 9);
    expect(blockModelCorners(d)).toHaveLength(8);
    const ring = blockModelOutline2d(d).coordinates[0];
    expect(ring).toHaveLength(5);
    close(ring[0], [1000, 2000]);
  });

  it('reads Python to_dict output and legacy metadata', () => {
    const d = definition({ rotation: { azimuth: 15 }, crs: 'EPSG:28350', name: 'm', extra: { k: 1 } });
    const again = blockModelDefinitionFromDict(blockModelDefinitionToDict(d));
    expect(blockModelDefinitionToDict(again)).toEqual(blockModelDefinitionToDict(d));
    const legacy = blockModelDefinitionFromDict(legacyMeta);
    expect(legacy.origin).toEqual([500000, 6900000, 290]);
    expect(legacy.blockSize).toEqual([10, 10, 10]);
    expect(legacy.nBlocks).toEqual([5, 4, 3]);
    expect(legacy.parentSize).toEqual([1, 1, 1]);
    expect(() => blockModelDefinitionFromDict({ block_size: [1, 1, 1] })).toThrow(/origin/);
  });

  it('sameGrid ignores extent and parents but not rotation', () => {
    expect(sameGrid(definition(), definition({ nBlocks: [8, 8, 8], parentSize: null }))).toBe(true);
    expect(sameGrid(definition(), definition({ rotation: { azimuth: 1 } }))).toBe(false);
  });
});

describe('block model operations', () => {
  it('derives indices from world geometry and vice versa', () => {
    const d = definition();
    const fromWorld = attachBlockIndices([
      { x: 1005, y: 2005, z: 102.5, dx: 10, dy: 10, dz: 5, grade: 1 },
      { x: 1002.5, y: 2017.5, z: 108.75, dx: 5, dy: 5, dz: 2.5, grade: 2 },
    ], d);
    expect(fromWorld.map((r) => [r.i, r.j, r.k, r.ni, r.nj, r.nk])).toEqual([[0, 0, 0, 2, 2, 2], [0, 3, 3, 1, 1, 1]]);
    const [fromIndex] = attachBlockCentroids([{ i: 1, j: 2, k: 3, grade: 0.5 }], d);
    close([fromIndex.x, fromIndex.y, fromIndex.z, fromIndex.dx, fromIndex.dy, fromIndex.dz], [1007.5, 2012.5, 108.75, 5, 5, 2.5]);
    const model = createBlockModel({ definition: d, blocks: [{ i: 1, j: 2, k: 3, grade: 0.5 }] });
    expect(model.blocks[0]).toMatchObject({ i: 1, j: 2, k: 3, ni: 1, nj: 1, nk: 1 });
    expect(blockAttributeKeys(model.blocks)).toEqual(['grade']);
  });

  it('loads the shared fixture and validates clean', () => {
    const model = loadFixture();
    expect(model.blocks).toHaveLength(reference.block_count);
    expect(blockModelDefinitionToDict(model.definition)).toEqual(reference.definition);
    expect(validateBlockModel(model).summary).toEqual({ error: 0, warning: 0, info: 0 });
    expect(blockModelVolume(model)).toBeCloseTo(reference.total_volume, 6);
  });

  it('names misaligned, overlapping, outside and straddling blocks', () => {
    const d = definition();
    const model = createBlockModel({
      definition: d,
      blocks: [
        { i: 0, j: 0, k: 0, ni: 2, nj: 2, nk: 2 },
        { i: 0, j: 0, k: 0, ni: 1, nj: 1, nk: 1 },
        { i: 2, j: 0, k: 0, ni: 1, nj: 1, nk: 1 },
        { i: 1, j: 0, k: 0, ni: 2, nj: 1, nk: 1 },
      ],
    });
    const report = validateBlockModel(model);
    const checks = new Set(report.issues.map((issue) => `${issue.check}:${issue.row_index}`));
    expect(checks.has('overlap:1')).toBe(true);
    expect(checks.has('overlap:3')).toBe(true);
    expect(checks.has('parent_containment:3')).toBe(true);
    expect(report.summary.warning).toBe(1);

    const shifted = model.blocks.map((row, idx) => (idx === 2 ? { ...row, x: row.x + 1 } : row));
    const misaligned = createBlockModel({ definition: d, blocks: shifted.map(({ i, j, k, ni, nj, nk, ...rest }) => rest) });
    const alignment = validateBlockModel(misaligned).issues.filter((issue) => issue.check === 'alignment');
    expect(alignment.map((issue) => [issue.row_index, issue.type, issue.axis])).toEqual([[2, 'misaligned_corner', 'x']]);
    expect(alignment[0].offset).toBeCloseTo(1, 9);

    const outside = createBlockModel({ definition: d, blocks: [{ i: 3, j: 0, k: 0, ni: 2, nj: 1, nk: 1 }] });
    const within = validateBlockModel(outside).issues.find((issue) => issue.check === 'within_grid');
    expect(within).toMatchObject({ type: 'block_outside_grid', axis: 'x' });
    const odd = createBlockModel({ definition: d, blocks: [{ x: 1004.5, y: 2002.5, z: 101.25, dx: 7, dy: 5, dz: 2.5 }] });
    const types = new Set(validateBlockModel(odd).issues.filter((i) => i.check === 'alignment').map((i) => i.type));
    expect(types).toEqual(new Set(['size_not_multiple', 'misaligned_corner']));
  });

  it('regularizes to base blocks preserving volume', () => {
    const model = loadFixture();
    const regular = regularizeBlocks(model);
    expect(regular.blocks).toHaveLength(reference.regularized_count);
    expect(regular.blocks.every((row) => row.ni === 1 && row.nj === 1 && row.nk === 1)).toBe(true);
    expect(blockModelVolume(regular)).toBeCloseTo(blockModelVolume(model), 6);
    expect(validateBlockModel(regular).summary).toEqual({ error: 0, warning: 0, info: 0 });
  });

  it('aggregates to parents exactly as Python does', () => {
    const model = loadFixture();
    const parents = aggregateToParentBlocks(model, { densityKey: 'density' });
    expect(parents.blocks).toHaveLength(reference.parent_count);
    parents.blocks.forEach((row, idx) => {
      const expected = reference.parents[idx];
      expect([row.i, row.j, row.k]).toEqual([expected.i, expected.j, expected.k]);
      close([row.x, row.y, row.z], [expected.x, expected.y, expected.z], 6);
      expect(row.grade).toBeCloseTo(expected.grade, 9);
      expect(row.density).toBeCloseTo(expected.density, 9);
      expect(row.rock_type).toBe(expected.rock_type);
      expect(row.n_subblocks).toBe(expected.n_subblocks);
      expect(row.fill_fraction).toBeCloseTo(expected.fill_fraction, 9);
    });
    expect(blockModelTonnage(parents, { densityKey: 'density' })).toBeCloseTo(blockModelTonnage(model, { densityKey: 'density' }), 6);
  });

  it('applies aggregation rules and reports partial parents', () => {
    const d = definition();
    const model = createBlockModel({
      definition: d,
      blocks: [
        { i: 0, j: 0, k: 0, grade: 1, density: 2, rock: 'a', flag: 1 },
        { i: 1, j: 0, k: 0, grade: 3, density: 4, rock: 'b', flag: 1 },
        { i: 0, j: 0, k: 1, grade: 5, density: 2, rock: 'b', flag: 1 },
      ],
    });
    const [row] = aggregateToParentBlocks(model, { densityKey: 'density', aggregations: { flag: 'sum', rock: 'first' } }).blocks;
    expect(row.n_subblocks).toBe(3);
    expect(row.fill_fraction).toBeCloseTo(3 / 8, 12);
    expect(row.grade).toBeCloseTo((1 * 2 + 3 * 4 + 5 * 2) / 8, 12);
    expect(row.density).toBeCloseTo(8 / 3, 12);
    expect(row.flag).toBe(3);
    expect(row.rock).toBe('a');
    const [majority] = aggregateToParentBlocks(model).blocks;
    expect(majority.rock).toBe('b');
    expect(majority.grade).toBeCloseTo(3, 12);
    expect(() => aggregateToParentBlocks(model, { aggregations: { grade: 'median' } })).toThrow(/unknown aggregation/);
    expect(() => aggregateToParentBlocks(createBlockModel({ definition: definition({ parentSize: null }), blocks: model.blocks }))).toThrow(/parentSize/);
  });

  it('finds and samples blocks at world points like Python', () => {
    const model = loadFixture();
    for (const entry of reference.samples) {
      expect(findBlockAt(model, ...entry.point)).toBe(entry.block_row);
    }
    for (const entry of reference.world_to_index) {
      expect(worldToIndex(model.definition, ...entry.world)).toEqual(entry.index);
    }
    const samples = sampleBlocksAt(model, reference.samples.map((e) => e.point), { attributes: ['grade', 'rock_type'] });
    expect(samples.map((s) => s.block_row)).toEqual(reference.samples.map((e) => e.block_row));
    expect(samples[0].grade).toBe(reference.samples[0].grade);
    expect(samples[0].rock_type).toBe(reference.samples[0].rock_type);
    expect(samples[1].grade).toBeNull();
  });

  it('computes tonnage and the grade-tonnage curve like Python', () => {
    const model = loadFixture();
    expect(blockModelTonnage(model, { densityKey: 'density' })).toBeCloseTo(reference.tonnes, 6);
    expect(blockModelTonnage(model, { density: 2 })).toBeCloseTo(2 * reference.total_volume, 6);
    expect(() => blockModelTonnage(model)).toThrow(/densityKey/);
    const curve = gradeTonnage(model, 'grade', [0, 1, 2], { densityKey: 'density' });
    curve.forEach((row, idx) => {
      const expected = reference.grade_tonnage[idx];
      expect(row.cutoff).toBe(expected.cutoff);
      expect(row.n_blocks).toBe(expected.n_blocks);
      expect(row.volume).toBeCloseTo(expected.volume, 6);
      expect(row.tonnes).toBeCloseTo(expected.tonnes, 6);
      expect(row.grade).toBeCloseTo(expected.grade, 9);
      expect(row.metal).toBeCloseTo(expected.metal, 6);
    });
  });

  it('selects and clips', () => {
    const model = loadFixture();
    const ore = selectBlocks(model, { classification: 'ore' });
    expect(ore.blocks.every((row) => row.classification === 'ore')).toBe(true);
    const bottom = clipBlocks(model, { max_z: 300 });
    expect(bottom.blocks.every((row) => row.z <= 300)).toBe(true);
    expect(bottom.blocks.length).toBeGreaterThan(0);
    expect(bottom.blocks.length).toBeLessThan(model.blocks.length);
  });

  it('diffs two models cell by cell', () => {
    const d = definition();
    const base = createBlockModel({
      definition: d,
      blocks: [{ i: 0, j: 0, k: 0, ni: 2, nj: 1, nk: 1, grade: 1, rock: 'a' }, { i: 2, j: 0, k: 0, grade: 2, rock: 'b' }],
    });
    const other = createBlockModel({
      definition: definition({ nBlocks: [8, 4, 4] }),
      blocks: [
        { i: 0, j: 0, k: 0, grade: 1, rock: 'a' },
        { i: 1, j: 0, k: 0, grade: 1.5, rock: 'a' },
        { i: 3, j: 0, k: 0, grade: 9, rock: 'c' },
      ],
    });
    const result = diffBlockModels(base, other);
    expect(result.summary).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 1, cells_a: 3, cells_b: 3 });
    const byI = Object.fromEntries(result.cells.map((cell) => [cell.i, cell]));
    expect(byI[1].status).toBe('changed');
    expect(byI[1].grade_delta).toBeCloseTo(0.5, 12);
    expect(byI[2].status).toBe('removed');
    expect(byI[3].status).toBe('added');
    expect(byI[0].x).toBeCloseTo(1002.5, 9);
    expect(() => diffBlockModels(base, createBlockModel({ definition: definition({ rotation: { azimuth: 5 } }), blocks: other.blocks }))).toThrow(/same base grid/);
  });
});
