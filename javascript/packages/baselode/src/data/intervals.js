/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * From-to interval algebra primitives.
 *
 * Pure functions on arrays of interval rows.  All rows are plain objects
 * keyed by `HOLE_ID`, `FROM`, `TO` plus any additional value columns.
 * Functions never mutate inputs.
 */

import { HOLE_ID, FROM, TO } from './datamodel.js';

function groupByHole(rows, holeCol) {
  const grouped = new Map();
  for (const row of rows) {
    const hole = row[holeCol];
    if (hole == null) continue;
    if (!grouped.has(hole)) grouped.set(hole, []);
    grouped.get(hole).push(row);
  }
  return grouped;
}

/**
 * Length of each interval row (`to - from`).
 *
 * @returns {number[]}
 */
export function intervalLength(rows, { fromCol = FROM, toCol = TO } = {}) {
  return rows.map((row) => Number(row[toCol]) - Number(row[fromCol]));
}

/**
 * Midpoint depth of each interval row.
 *
 * @returns {number[]}
 */
export function fromToMidpoints(rows, { fromCol = FROM, toCol = TO } = {}) {
  return rows.map((row) => (Number(row[fromCol]) + Number(row[toCol])) / 2);
}

/**
 * Uncovered downhole ranges between consecutive intervals, per hole.
 *
 * @param {number} [options.minGap=0] - Minimum gap length to report.
 * @returns {Array<Object>} `{hole_id, from, to, length}` per gap.
 */
export function detectGaps(
  rows,
  { fromCol = FROM, toCol = TO, holeCol = HOLE_ID, minGap = 0 } = {},
) {
  if (!rows || !rows.length) return [];

  const result = [];
  for (const [hole, group] of groupByHole(rows, holeCol)) {
    const sorted = [...group].sort(
      (left, right) => Number(left[fromCol]) - Number(right[fromCol]),
    );
    let prevTo = null;
    for (const row of sorted) {
      const fromDepth = Number(row[fromCol]);
      const toDepth = Number(row[toCol]);
      if (prevTo !== null && fromDepth - prevTo > minGap) {
        result.push({
          [holeCol]: hole,
          [fromCol]: prevTo,
          [toCol]: fromDepth,
          length: fromDepth - prevTo,
        });
      }
      if (prevTo === null || toDepth > prevTo) prevTo = toDepth;
    }
  }
  return result;
}

/**
 * Pairwise overlapping intervals, per hole.
 *
 * Indices are positional into the input `rows` array.
 *
 * @returns {Array<Object>} `{hole_id, from, to, length, first_index, second_index}`.
 */
export function detectOverlaps(
  rows,
  { fromCol = FROM, toCol = TO, holeCol = HOLE_ID } = {},
) {
  if (!rows || !rows.length) return [];

  const indexed = rows.map((row, originalIndex) => ({ row, originalIndex }));
  const byHole = new Map();
  for (const entry of indexed) {
    const hole = entry.row[holeCol];
    if (hole == null) continue;
    if (!byHole.has(hole)) byHole.set(hole, []);
    byHole.get(hole).push(entry);
  }

  const result = [];
  for (const [hole, group] of byHole) {
    const sorted = [...group].sort(
      (left, right) => Number(left.row[fromCol]) - Number(right.row[fromCol]),
    );
    for (let firstIdx = 0; firstIdx < sorted.length; firstIdx += 1) {
      const firstFrom = Number(sorted[firstIdx].row[fromCol]);
      const firstTo = Number(sorted[firstIdx].row[toCol]);
      for (let secondIdx = firstIdx + 1; secondIdx < sorted.length; secondIdx += 1) {
        const secondFrom = Number(sorted[secondIdx].row[fromCol]);
        if (secondFrom >= firstTo) break;
        const secondTo = Number(sorted[secondIdx].row[toCol]);
        const overlapFrom = Math.max(firstFrom, secondFrom);
        const overlapTo = Math.min(firstTo, secondTo);
        if (overlapTo > overlapFrom) {
          result.push({
            [holeCol]: hole,
            [fromCol]: overlapFrom,
            [toCol]: overlapTo,
            length: overlapTo - overlapFrom,
            first_index: sorted[firstIdx].originalIndex,
            second_index: sorted[secondIdx].originalIndex,
          });
        }
      }
    }
  }
  return result;
}

function normalizeDepthsArg(depths, holeCol) {
  if (depths == null) return { byHole: new Map(), all: [] };
  if (Array.isArray(depths)) {
    return { byHole: new Map(), all: depths.map(Number) };
  }
  if (typeof depths === 'number') {
    return { byHole: new Map(), all: [Number(depths)] };
  }
  if (depths && typeof depths === 'object') {
    if (depths[holeCol] != null && depths.depth != null) {
      const byHole = new Map();
      byHole.set(depths[holeCol], [Number(depths.depth)]);
      return { byHole, all: [] };
    }
    const byHole = new Map();
    for (const [hole, value] of Object.entries(depths)) {
      const list = Array.isArray(value) ? value : [value];
      byHole.set(hole, list.map(Number));
    }
    return { byHole, all: [] };
  }
  return { byHole: new Map(), all: [] };
}

/**
 * Split intervals at boundary depths.
 *
 * Any depth strictly inside `(from, to)` is introduced as a new boundary;
 * the row is replaced by the resulting sub-intervals.  All other columns
 * are inherited unchanged.
 *
 * @param {(number|number[]|Object)} depths - One of: a scalar applied to
 *   every hole; an array applied to every hole; or
 *   `{hole_id: [d1, d2, ...]}`.
 * @returns {Array<Object>}
 */
export function splitAt(
  rows,
  depths,
  { fromCol = FROM, toCol = TO, holeCol = HOLE_ID } = {},
) {
  if (!rows || !rows.length) return [];

  const { byHole, all } = normalizeDepthsArg(depths, holeCol);

  const out = [];
  for (const row of rows) {
    const hole = row[holeCol];
    const fromDepth = Number(row[fromCol]);
    const toDepth = Number(row[toCol]);
    const candidate = byHole.has(hole) ? byHole.get(hole) : all;
    const inner = [...new Set(
      candidate
        .map(Number)
        .filter((depth) => depth > fromDepth && depth < toDepth),
    )].sort((left, right) => left - right);
    if (!inner.length) {
      out.push({ ...row });
      continue;
    }
    const boundaries = [fromDepth, ...inner, toDepth];
    for (let boundaryIdx = 0; boundaryIdx < boundaries.length - 1; boundaryIdx += 1) {
      out.push({
        ...row,
        [fromCol]: boundaries[boundaryIdx],
        [toCol]: boundaries[boundaryIdx + 1],
      });
    }
  }
  return out;
}

/**
 * Clip intervals to a downhole depth window.
 *
 * Intervals entirely outside the window are dropped; straddling intervals
 * have their from/to pulled to the boundary.  All other columns preserved.
 *
 * @returns {Array<Object>}
 */
export function clip(rows, fromDepth, toDepth, { fromCol = FROM, toCol = TO } = {}) {
  if (!rows || !rows.length) return [];

  const out = [];
  for (const row of rows) {
    let segFrom = Number(row[fromCol]);
    let segTo = Number(row[toCol]);
    if (fromDepth != null) {
      if (segTo <= fromDepth) continue;
      if (segFrom < fromDepth) segFrom = fromDepth;
    }
    if (toDepth != null) {
      if (segFrom >= toDepth) continue;
      if (segTo > toDepth) segTo = toDepth;
    }
    out.push({ ...row, [fromCol]: segFrom, [toCol]: segTo });
  }
  return out;
}

function rowContaining(group, depth, fromCol, toCol) {
  for (const row of group) {
    if (Number(row[fromCol]) <= depth && Number(row[toCol]) > depth) return row;
  }
  return null;
}

/**
 * Left-join interval tables onto a common from-to support.
 *
 * Per hole, the first ("left") table anchors the support; boundary depths
 * from later tables that fall inside the left's coverage are introduced as
 * new sub-interval boundaries.  Each output row carries `<name>_<col>`
 * values looked up at the sub-interval midpoint.  Where a later table has
 * no row covering the midpoint, the column is `null`.
 *
 * @param {Object<string, Array<Object>>} tables - Ordered object literal:
 *   the first key is the left table.
 * @returns {Array<Object>} Rows with `hole_id`, `from`, `to`, and
 *   prefixed columns from every input table.
 */
export function mergeTables(
  tables,
  { fromCol = FROM, toCol = TO, holeCol = HOLE_ID } = {},
) {
  if (!tables) return [];

  const tableNames = Object.keys(tables);
  if (!tableNames.length) return [];

  const leftName = tableNames[0];
  const left = tables[leftName] || [];
  if (!left.length) return [];

  const leftByHole = groupByHole(left, holeCol);
  const otherByHole = {};
  for (const otherName of tableNames.slice(1)) {
    otherByHole[otherName] = groupByHole(tables[otherName] || [], holeCol);
  }

  const out = [];
  for (const [hole, leftRowsForHole] of leftByHole) {
    const boundaries = new Set();
    let leftMin = Infinity;
    let leftMax = -Infinity;
    for (const row of leftRowsForHole) {
      const fromDepth = Number(row[fromCol]);
      const toDepth = Number(row[toCol]);
      boundaries.add(fromDepth);
      boundaries.add(toDepth);
      if (fromDepth < leftMin) leftMin = fromDepth;
      if (toDepth > leftMax) leftMax = toDepth;
    }
    for (const otherName of tableNames.slice(1)) {
      const otherRowsForHole = otherByHole[otherName].get(hole) || [];
      for (const row of otherRowsForHole) {
        const otherFrom = Number(row[fromCol]);
        const otherTo = Number(row[toCol]);
        if (otherTo < leftMin || otherFrom > leftMax) continue;
        if (otherFrom > leftMin) boundaries.add(otherFrom);
        if (otherTo < leftMax) boundaries.add(otherTo);
      }
    }
    const ordered = [...boundaries].sort((first, second) => first - second);

    for (let boundaryIdx = 0; boundaryIdx < ordered.length - 1; boundaryIdx += 1) {
      const segFrom = ordered[boundaryIdx];
      const segTo = ordered[boundaryIdx + 1];
      const midpoint = (segFrom + segTo) / 2;
      const leftRow = rowContaining(leftRowsForHole, midpoint, fromCol, toCol);
      if (!leftRow) continue;
      const outRow = { [holeCol]: hole, [fromCol]: segFrom, [toCol]: segTo };
      for (const col of Object.keys(leftRow)) {
        if (col === holeCol || col === fromCol || col === toCol) continue;
        outRow[`${leftName}_${col}`] = leftRow[col];
      }
      for (const otherName of tableNames.slice(1)) {
        const otherRowsForHole = otherByHole[otherName].get(hole) || [];
        const otherRow = rowContaining(otherRowsForHole, midpoint, fromCol, toCol);
        const sample = (tables[otherName] && tables[otherName][0]) || {};
        const otherCols = Object.keys(sample).filter(
          (col) => col !== holeCol && col !== fromCol && col !== toCol,
        );
        for (const col of otherCols) {
          outRow[`${otherName}_${col}`] = otherRow ? otherRow[col] : null;
        }
      }
      out.push(outRow);
    }
  }
  return out;
}
