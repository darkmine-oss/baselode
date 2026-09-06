/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Block model operations — mirrors `baselode.blockmodel.data` /
 * `baselode.blockmodel.validate`.
 *
 * A model is a plain `{ definition, blocks }` object: `definition` from
 * `createBlockModelDefinition`, `blocks` an array of row objects carrying
 * `i, j, k, ni, nj, nk` (base-grid index of the minimum corner + extent in
 * base blocks), `x, y, z, dx, dy, dz` (world centroid + size along the grid
 * axes) and any attribute keys.  Either geometry encoding may be supplied;
 * `createBlockModel` derives the other.
 */

import { filterBlocks } from '../data/blockModelLoader.js';
import {
  containsIndex,
  indexToWorld,
  parentIndex,
  sameGrid,
  worldToIndex,
  worldToLocal,
} from './blockModelDefinition.js';

export const BLOCK_GEOMETRY_KEYS = ['x', 'y', 'z', 'dx', 'dy', 'dz'];
export const BLOCK_INDEX_KEYS = ['i', 'j', 'k', 'ni', 'nj', 'nk'];
const RESERVED = new Set([...BLOCK_GEOMETRY_KEYS, ...BLOCK_INDEX_KEYS]);
const VALID_AGGREGATIONS = ['mean', 'sum', 'min', 'max', 'majority', 'first'];

function num(value) {
  // Missing stays missing: Number(null) / Number('') would silently be 0.
  if (value === null || value === undefined || value === '') return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function hasKeys(row, keys) {
  return Boolean(row) && keys.every((key) => row[key] !== undefined && row[key] !== null && row[key] !== '');
}

function cellKey(i, j, k) {
  return `${i},${j},${k}`;
}

/** Attribute keys: everything that is neither geometry nor index. */
export function blockAttributeKeys(blocks) {
  const keys = new Set();
  for (const row of blocks || []) {
    for (const key of Object.keys(row || {})) if (!RESERVED.has(key)) keys.add(key);
  }
  return [...keys];
}

/**
 * Derive `i, j, k, ni, nj, nk` from world centroids and sizes by snapping
 * to the nearest base cell / whole number of base blocks.  Never fails —
 * misaligned blocks get the closest indices and `validateBlockModel`
 * reports the residual.
 */
export function attachBlockIndices(blocks, definition, { overwrite = false } = {}) {
  const [bx, by, bz] = definition.blockSize;
  return (blocks || []).map((row) => {
    if (!overwrite && hasKeys(row, BLOCK_INDEX_KEYS)) {
      const out = { ...row };
      for (const key of BLOCK_INDEX_KEYS) out[key] = Math.trunc(num(row[key]));
      return out;
    }
    const dx = num(row.dx);
    const dy = num(row.dy);
    const dz = num(row.dz);
    const [u, v, w] = worldToLocal(definition, num(row.x), num(row.y), num(row.z));
    return {
      ...row,
      i: Math.round((u - dx / 2) / bx),
      j: Math.round((v - dy / 2) / by),
      k: Math.round((w - dz / 2) / bz),
      ni: Math.max(1, Math.round(dx / bx)),
      nj: Math.max(1, Math.round(dy / by)),
      nk: Math.max(1, Math.round(dz / bz)),
    };
  });
}

/** Derive `x, y, z, dx, dy, dz` from base-grid indices (`ni/nj/nk` default 1). */
export function attachBlockCentroids(blocks, definition, { overwrite = false } = {}) {
  const [bx, by, bz] = definition.blockSize;
  return (blocks || []).map((row) => {
    if (!overwrite && hasKeys(row, BLOCK_GEOMETRY_KEYS)) return { ...row };
    const ni = row.ni == null ? 1 : num(row.ni);
    const nj = row.nj == null ? 1 : num(row.nj);
    const nk = row.nk == null ? 1 : num(row.nk);
    const [x, y, z] = indexToWorld(definition, num(row.i), num(row.j), num(row.k), ni, nj, nk);
    return { ...row, ni, nj, nk, x, y, z, dx: ni * bx, dy: nj * by, dz: nk * bz };
  });
}

/**
 * Normalise `{ definition, blocks }`: rows get both geometry encodings.
 * @param {{definition: Object, blocks: Array<Object>}} model
 * @returns {{definition: Object, blocks: Array<Object>}}
 */
export function createBlockModel({ definition, blocks = [] } = {}) {
  if (!definition) throw new Error('createBlockModel needs a definition');
  let rows = (blocks || []).filter(Boolean);
  const anyGeometry = rows.some((row) => hasKeys(row, BLOCK_GEOMETRY_KEYS));
  const anyIndex = rows.some((row) => hasKeys(row, ['i', 'j', 'k']));
  if (!anyGeometry && anyIndex) rows = attachBlockCentroids(rows, definition);
  rows = attachBlockIndices(rows, definition);
  return { definition, blocks: rows };
}

/** Map "i,j,k" → row index of the block covering that base cell (first wins). */
export function buildBlockOccupancy(model) {
  const occupancy = new Map();
  model.blocks.forEach((row, index) => {
    if (!hasKeys(row, BLOCK_INDEX_KEYS)) return;
    for (let di = 0; di < row.ni; di += 1) {
      for (let dj = 0; dj < row.nj; dj += 1) {
        for (let dk = 0; dk < row.nk; dk += 1) {
          const key = cellKey(row.i + di, row.j + dj, row.k + dk);
          if (!occupancy.has(key)) occupancy.set(key, index);
        }
      }
    }
  });
  return occupancy;
}

/** Row index of the block containing world point (x, y, z), or -1. */
export function findBlockAt(model, x, y, z, occupancy = null) {
  const lookup = occupancy || buildBlockOccupancy(model);
  const [i, j, k] = worldToIndex(model.definition, x, y, z);
  const hit = lookup.get(cellKey(i, j, k));
  return hit === undefined ? -1 : hit;
}

/**
 * Attributes of the block under each point.
 * @param {Object} model
 * @param {Array<number[]|{x,y,z}>} points
 * @param {{attributes?: string[]}} [options]
 * @returns {Array<Object>} `{x, y, z, block_row, ...attributes}` per point
 *   (`block_row` -1 and null attributes where uncovered)
 */
export function sampleBlocksAt(model, points, { attributes = null } = {}) {
  const keys = attributes || blockAttributeKeys(model.blocks);
  const occupancy = buildBlockOccupancy(model);
  return (points || []).map((point) => {
    const [x, y, z] = Array.isArray(point) ? point : [point.x, point.y, point.z];
    const row = findBlockAt(model, x, y, z, occupancy);
    const out = { x, y, z, block_row: row };
    for (const key of keys) out[key] = row >= 0 ? model.blocks[row][key] ?? null : null;
    return out;
  });
}

/** Geometric volume of one block row. */
export function blockVolume(row) {
  return (num(row.dx) || 0) * (num(row.dy) || 0) * (num(row.dz) || 0);
}

/**
 * Volume used for mass: the geometric volume scaled by `fill_fraction` when
 * present (parents from `aggregateToParentBlocks`), so tonnage is conserved
 * through aggregation even for partially filled parents.
 */
function massVolume(row) {
  const fill = row.fill_fraction == null ? 1 : num(row.fill_fraction);
  return blockVolume(row) * (Number.isFinite(fill) ? fill : 1);
}

/** Total volume over the model's blocks. */
export function blockModelVolume(model) {
  return model.blocks.reduce((sum, row) => sum + blockVolume(row), 0);
}

/** New model holding only rows matching `criteria` (see `filterBlocks`). */
export function selectBlocks(model, criteria) {
  return { definition: model.definition, blocks: filterBlocks(model.blocks, criteria) };
}

/** New model with only the blocks whose centroid lies inside `bounds`. */
export function clipBlocks(model, bounds = {}) {
  const inside = (row) => ['x', 'y', 'z'].every((axis) => {
    const lo = bounds[`min_${axis}`];
    const hi = bounds[`max_${axis}`];
    return (lo == null || row[axis] >= lo) && (hi == null || row[axis] <= hi);
  });
  return { definition: model.definition, blocks: model.blocks.filter(inside) };
}

/**
 * Total tonnes = sum(volume · density); parent rows are scaled by their
 * `fill_fraction` so tonnage survives aggregation.
 * @param {Object} model
 * @param {{densityKey?: string, density?: number, criteria?: Object}} options
 */
export function blockModelTonnage(model, { densityKey = null, density = null, criteria = null } = {}) {
  if (densityKey == null && density == null) throw new Error('blockModelTonnage needs densityKey or density');
  const rows = criteria ? filterBlocks(model.blocks, criteria) : model.blocks;
  return rows.reduce((sum, row) => {
    const rho = densityKey != null ? num(row[densityKey]) : Number(density);
    return sum + (Number.isFinite(rho) ? massVolume(row) * rho : 0);
  }, 0);
}

/**
 * Grade-tonnage curve: tonnes, tonnage-weighted grade and metal above each
 * cut-off (inclusive).
 * @returns {Array<{cutoff, n_blocks, volume, tonnes, grade, metal}>}
 */
export function gradeTonnage(model, gradeKey, cutoffs, { densityKey = null, density = null } = {}) {
  if (densityKey == null && density == null) throw new Error('gradeTonnage needs densityKey or density');
  return (cutoffs || []).map((cutoff) => {
    let nBlocks = 0;
    let volume = 0;
    let tonnes = 0;
    let metal = 0;
    for (const row of model.blocks) {
      const grade = num(row[gradeKey]);
      if (!(grade >= Number(cutoff))) continue;
      const rho = densityKey != null ? num(row[densityKey]) : Number(density);
      const vol = massVolume(row);
      const t = Number.isFinite(rho) ? vol * rho : 0;
      nBlocks += 1;
      volume += vol;
      tonnes += t;
      metal += t * grade;
    }
    const grade = tonnes > 0 ? metal / tonnes : NaN;
    return { cutoff: Number(cutoff), n_blocks: nBlocks, volume, tonnes, grade, metal: tonnes > 0 ? metal : 0 };
  });
}

/** Split every block into its base blocks (attributes copied, volume preserved). */
export function regularizeBlocks(model) {
  const { definition } = model;
  const attributes = blockAttributeKeys(model.blocks);
  const out = [];
  for (const row of model.blocks) {
    if (!hasKeys(row, BLOCK_INDEX_KEYS)) continue;
    const attrs = {};
    for (const key of attributes) if (key in row) attrs[key] = row[key];
    for (let di = 0; di < row.ni; di += 1) {
      for (let dj = 0; dj < row.nj; dj += 1) {
        for (let dk = 0; dk < row.nk; dk += 1) {
          out.push({ i: row.i + di, j: row.j + dj, k: row.k + dk, ni: 1, nj: 1, nk: 1, ...attrs });
        }
      }
    }
  }
  return { definition, blocks: attachBlockCentroids(out, definition, { overwrite: true }) };
}

function weightedMean(values, weights) {
  let total = 0;
  let sum = 0;
  values.forEach((value, idx) => {
    const v = num(value);
    const w = num(weights[idx]);
    if (!Number.isFinite(v) || !Number.isFinite(w)) return;
    total += w;
    sum += v * w;
  });
  return total > 0 ? sum / total : NaN;
}

function majority(values, weights) {
  const totals = new Map();
  values.forEach((value, idx) => {
    if (value === null || value === undefined || value === '') return;
    totals.set(value, (totals.get(value) || 0) + num(weights[idx]));
  });
  let best = null;
  let bestWeight = -Infinity;
  for (const [value, weight] of totals) {
    if (weight > bestWeight) { best = value; bestWeight = weight; }
  }
  return best;
}

/**
 * Merge sub-blocks into their parent blocks.  Numeric attributes are
 * volume-weighted means (mass-weighted with `densityKey`, except the
 * density column itself, which stays volume-weighted so parent tonnage
 * equals sub-block tonnage), categoricals take the volume-weighted
 * majority; each parent also gets `n_subblocks` and `fill_fraction`.
 * @param {Object} model
 * @param {{aggregations?: Object, densityKey?: string}} options -
 *   `aggregations[key]` is one of 'mean' | 'sum' | 'min' | 'max' |
 *   'majority' | 'first' or a `(values, weights) => value` function.
 */
export function aggregateToParentBlocks(model, { aggregations = {}, densityKey = null } = {}) {
  const { definition } = model;
  if (!definition.parentSize) throw new Error('aggregateToParentBlocks needs a definition with parentSize');
  for (const [key, rule] of Object.entries(aggregations)) {
    if (typeof rule !== 'function' && !VALID_AGGREGATIONS.includes(rule)) {
      throw new Error(`unknown aggregation '${rule}' for '${key}'`);
    }
  }
  const [px, py, pz] = definition.parentSize;
  const parentCells = px * py * pz;
  const cellVolume = definition.blockSize[0] * definition.blockSize[1] * definition.blockSize[2];
  const attributes = blockAttributeKeys(model.blocks);
  const groups = new Map();
  for (const row of model.blocks) {
    if (!hasKeys(row, BLOCK_INDEX_KEYS)) continue;
    const [pi, pj, pk] = parentIndex(definition, row.i, row.j, row.k);
    const key = cellKey(pi, pj, pk);
    if (!groups.has(key)) groups.set(key, { pi, pj, pk, rows: [] });
    groups.get(key).rows.push(row);
  }
  const ordered = [...groups.values()].sort((a, b) => (a.pi - b.pi) || (a.pj - b.pj) || (a.pk - b.pk));
  const out = ordered.map(({ pi, pj, pk, rows }) => {
    const cells = rows.map((row) => row.ni * row.nj * row.nk);
    const volumes = cells.map((c) => c * cellVolume);
    const weights = densityKey == null
      ? volumes
      : volumes.map((vol, idx) => vol * (Number.isFinite(num(rows[idx][densityKey])) ? num(rows[idx][densityKey]) : 0));
    const record = { i: pi * px, j: pj * py, k: pk * pz, ni: px, nj: py, nk: pz };
    for (const key of attributes) {
      const values = rows.map((row) => row[key]);
      const numeric = values.every((v) => v === null || v === undefined || Number.isFinite(num(v)))
        && values.some((v) => Number.isFinite(num(v)));
      let rule = aggregations[key];
      if (rule === undefined) rule = numeric ? 'mean' : 'majority';
      const keyWeights = key === densityKey ? volumes : weights;
      if (typeof rule === 'function') record[key] = rule(values, keyWeights);
      else if (rule === 'mean') record[key] = weightedMean(values, keyWeights);
      else if (rule === 'sum') record[key] = values.reduce((s, v) => s + (Number.isFinite(num(v)) ? num(v) : 0), 0);
      else if (rule === 'min') record[key] = values.reduce((m, v) => (m === null || v < m ? v : m), null);
      else if (rule === 'max') record[key] = values.reduce((m, v) => (m === null || v > m ? v : m), null);
      else if (rule === 'majority') record[key] = majority(values, volumes);
      else if (rule === 'first') record[key] = values[0];
    }
    record.n_subblocks = rows.length;
    record.fill_fraction = cells.reduce((s, c) => s + c, 0) / parentCells;
    return record;
  });
  return { definition, blocks: attachBlockCentroids(out, definition, { overwrite: true }) };
}

function issue(check, severity, message, rowIndex, details = {}) {
  return { check, severity, row_index: rowIndex, message, ...details };
}

/**
 * Grid-aware validation: alignment (error), index_consistency (error —
 * supplied indices disagree with the geometry), within_grid (error),
 * overlap (error), duplicate_index (error), nan_centre (error),
 * parent_containment (warning).  Same `{summary, issues}` shape as the Python validator.
 */
export function validateBlockModel(model, { tol = 1e-6 } = {}) {
  const { definition, blocks } = model;
  const issues = [];
  const [bx, by, bz] = definition.blockSize;
  const [nx, ny, nz] = definition.nBlocks;
  const occupancy = new Map();
  const seenPairs = new Set();
  const seenIndex = new Set();

  blocks.forEach((row, index) => {
    const x = num(row.x);
    const y = num(row.y);
    const z = num(row.z);
    if ([x, y, z].some((v) => !Number.isFinite(v))) {
      issues.push(issue('nan_centre', 'error', 'Block has a NaN centre coordinate', index));
      return;
    }
    const [u, v, w] = worldToLocal(definition, x, y, z);
    const axes = [
      ['x', u, num(row.dx), bx], ['y', v, num(row.dy), by], ['z', w, num(row.dz), bz],
    ];
    for (const [axis, centre, size, base] of axes) {
      if (!(size > 0)) {
        issues.push(issue('alignment', 'error', `Block ${index} is not on the base grid along ${axis} (non_positive_block_size)`, index, { type: 'non_positive_block_size', axis }));
        continue;
      }
      const multiple = size / base;
      if (Math.abs(multiple - Math.round(multiple)) > tol || Math.round(multiple) < 1) {
        issues.push(issue('alignment', 'error', `Block ${index} is not on the base grid along ${axis} (size_not_multiple)`, index, { type: 'size_not_multiple', axis, block_size: size, base_size: base, multiple }));
      }
      const corner = (centre - size / 2) / base;
      const residual = corner - Math.round(corner);
      if (Math.abs(residual) > tol) {
        issues.push(issue('alignment', 'error', `Block ${index} is not on the base grid along ${axis} (misaligned_corner)`, index, { type: 'misaligned_corner', axis, offset: residual * base, base_size: base }));
      }
    }
    if (!hasKeys(row, BLOCK_INDEX_KEYS)) {
      issues.push(issue('within_grid', 'error', `Block ${index} lies outside the grid extent`, index, { type: 'missing_index' }));
      return;
    }
    const extents = [['x', row.i, row.ni, nx], ['y', row.j, row.nj, ny], ['z', row.k, row.nk, nz]];
    for (const [axis, start, count, extent] of extents) {
      if (start < 0 || start + count > extent) {
        issues.push(issue('within_grid', 'error', `Block ${index} lies outside the grid extent along ${axis}`, index, { type: 'block_outside_grid', axis, first_cell: start, last_cell: start + count - 1, n_cells: extent }));
      }
    }
    if (definition.parentSize) {
      const parents = [['x', row.i, row.ni, definition.parentSize[0]], ['y', row.j, row.nj, definition.parentSize[1]], ['z', row.k, row.nk, definition.parentSize[2]]];
      for (const [axis, start, count, parent] of parents) {
        if (count > parent) {
          issues.push(issue('parent_containment', 'warning', `Block ${index} straddles a parent block boundary along ${axis}`, index, { type: 'larger_than_parent', axis, n_cells: count, parent_cells: parent }));
        } else if (Math.floor(start / parent) !== Math.floor((start + count - 1) / parent)) {
          issues.push(issue('parent_containment', 'warning', `Block ${index} straddles a parent block boundary along ${axis}`, index, { type: 'straddles_parent', axis, first_cell: start, last_cell: start + count - 1, parent_cells: parent }));
        }
      }
    }
    const [derived] = attachBlockIndices([{ x, y, z, dx: row.dx, dy: row.dy, dz: row.dz }], definition, { overwrite: true });
    for (const key of BLOCK_INDEX_KEYS) {
      if (Number.isFinite(derived[key]) && derived[key] !== row[key]) {
        issues.push(issue('index_consistency', 'error', `Block ${index}: ${key}=${row[key]} but its geometry gives ${derived[key]}`, index, { type: 'index_mismatch', column: key, supplied: row[key], derived: derived[key] }));
      }
    }
    const indexKey = BLOCK_INDEX_KEYS.map((key) => row[key]).join(',');
    if (seenIndex.has(indexKey)) {
      issues.push(issue('duplicate_index', 'error', `Block ${index} duplicates another block's cells`, index));
    }
    seenIndex.add(indexKey);
    for (let di = 0; di < row.ni; di += 1) {
      for (let dj = 0; dj < row.nj; dj += 1) {
        for (let dk = 0; dk < row.nk; dk += 1) {
          const key = cellKey(row.i + di, row.j + dj, row.k + dk);
          const first = occupancy.get(key);
          if (first === undefined) {
            occupancy.set(key, index);
          } else if (first !== index && !seenPairs.has(`${first}|${index}`)) {
            seenPairs.add(`${first}|${index}`);
            issues.push(issue('overlap', 'error', `Blocks ${first} and ${index} overlap`, index, { type: 'overlap', block_i: first, block_j: index, cell: [row.i + di, row.j + dj, row.k + dk] }));
          }
        }
      }
    }
  });

  const summary = {
    error: issues.filter((entry) => entry.severity === 'error').length,
    warning: issues.filter((entry) => entry.severity === 'warning').length,
    info: issues.filter((entry) => entry.severity === 'info').length,
  };
  return { summary, issues };
}

/**
 * Cell-by-cell comparison of two models on the same base grid.
 * @returns {{summary: Object, cells: Array<Object>}} — each cell carries
 *   `i, j, k, x, y, z, status` ('added' | 'removed' | 'changed' | 'unchanged')
 *   and `<attr>_a`, `<attr>_b`, numeric `<attr>_delta`.
 */
export function diffBlockModels(a, b, { attributes = null, tol = 1e-9 } = {}) {
  if (!sameGrid(a.definition, b.definition)) {
    throw new Error('diffBlockModels needs two models on the same base grid (origin, blockSize, rotation)');
  }
  const keysA = blockAttributeKeys(a.blocks);
  const keysB = new Set(blockAttributeKeys(b.blocks));
  const compare = attributes || keysA.filter((key) => keysB.has(key));
  const cellsA = new Map(regularizeBlocks(a).blocks.map((row) => [cellKey(row.i, row.j, row.k), row]));
  const cellsB = new Map(regularizeBlocks(b).blocks.map((row) => [cellKey(row.i, row.j, row.k), row]));
  const keys = [...new Set([...cellsA.keys(), ...cellsB.keys()])];
  const cells = keys.map((key) => {
    const left = cellsA.get(key);
    const right = cellsB.get(key);
    const ref = left || right;
    const [x, y, z] = indexToWorld(a.definition, ref.i, ref.j, ref.k);
    const cell = { i: ref.i, j: ref.j, k: ref.k, x, y, z };
    let status = left && right ? 'unchanged' : (left ? 'removed' : 'added');
    for (const attr of compare) {
      const va = left ? left[attr] ?? null : null;
      const vb = right ? right[attr] ?? null : null;
      cell[`${attr}_a`] = va;
      cell[`${attr}_b`] = vb;
      const na = num(va);
      const nb = num(vb);
      if (Number.isFinite(na) && Number.isFinite(nb)) {
        cell[`${attr}_delta`] = nb - na;
        if (left && right && Math.abs(nb - na) > tol) status = 'changed';
      } else if (left && right && va !== vb && !(va == null && vb == null)) {
        status = 'changed';
      }
    }
    cell.status = status;
    return cell;
  });
  cells.sort((p, q) => (p.i - q.i) || (p.j - q.j) || (p.k - q.k));
  const summary = { added: 0, removed: 0, changed: 0, unchanged: 0, cells_a: cellsA.size, cells_b: cellsB.size };
  for (const cell of cells) summary[cell.status] += 1;
  return { summary, cells };
}
