/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Length-weighted compositing of downhole intervals.
 *
 * Mirrors the Python `composite_intervals` for hard / soft boundary
 * modes.  True-thickness compositing is Python-only (no JS parity per
 * TRK-109 scope — it depends on a desurveyed trace).
 *
 * @param {Array<Object>} intervals - Interval rows.  Each row must carry
 *   the hole-id, from, to and value properties; in `mode="hard"` also
 *   the boundary column.
 * @param {string} valueCol - Property name to composite.
 * @param {Object} [options]
 * @param {string} [options.fromCol="from"]
 * @param {string} [options.toCol="to"]
 * @param {string} [options.holeCol="hole_id"]
 * @param {number} [options.length=1.0] - Composite length in metres.
 * @param {"average"|"sum"} [options.method="average"] - Length-weighted
 *   average (default) or total contribution.
 * @param {"soft"|"hard"} [options.mode="soft"] - Boundary handling.
 *   `"soft"` extends bins across the full hole range and lets
 *   composites cross contacts; `"hard"` resets at every change in
 *   `boundaryCol`.
 * @param {string} [options.boundaryCol] - Domain column for hard mode.
 *   Required when `mode === "hard"`.
 * @param {"discard"|"add_to_previous"|"distribute"} [options.residual="discard"]
 *   Tail-of-domain handling in hard mode.  See the Python docstring
 *   for the exact semantics — kept identical so cross-language test
 *   data round-trips.
 * @returns {Array<Object>} Composite rows with the same key names as
 *   the input plus (for hard mode) the boundary column carrying the
 *   originating domain value.
 */
export function compositeIntervals(intervals, valueCol, options = {}) {
  const fromCol = options.fromCol || 'from';
  const toCol = options.toCol || 'to';
  const holeCol = options.holeCol || 'hole_id';
  const length = options.length ?? 1.0;
  const method = options.method || 'average';
  const mode = options.mode || 'soft';
  const boundaryCol = options.boundaryCol;
  const residual = options.residual || 'discard';

  if (mode !== 'soft' && mode !== 'hard') {
    throw new Error(`mode must be "soft" or "hard", got "${mode}"`);
  }
  if (mode === 'hard') {
    if (!boundaryCol) throw new Error('mode="hard" requires a boundaryCol');
    if (!['discard', 'add_to_previous', 'distribute'].includes(residual)) {
      throw new Error(`residual must be one of discard, add_to_previous, distribute; got "${residual}"`);
    }
  }
  if (!intervals || !intervals.length) return [];

  // Group by hole id, preserving each hole's original sort.
  const byHole = new Map();
  for (const row of intervals) {
    const id = row[holeCol];
    if (id == null) continue;
    if (!byHole.has(id)) byHole.set(id, []);
    byHole.get(id).push(row);
  }
  for (const rows of byHole.values()) {
    rows.sort((a, b) => Number(a[fromCol]) - Number(b[fromCol]));
  }

  const out = [];
  if (mode === 'soft') {
    for (const [holeId, rows] of byHole.entries()) {
      const start = Math.min(...rows.map((r) => Number(r[fromCol])));
      const end = Math.max(...rows.map((r) => Number(r[toCol])));
      for (let cFrom = start; cFrom < end; cFrom += length) {
        const cTo = cFrom + length;
        const row = composeBin(rows, valueCol, fromCol, toCol, cFrom, cTo, method);
        if (row == null) continue;
        row[holeCol] = holeId;
        out.push(row);
      }
    }
    return out;
  }

  // Hard mode: walk each hole, split into contiguous same-domain
  // runs, bin each domain individually.
  for (const [holeId, rows] of byHole.entries()) {
    const runs = groupRuns(rows, fromCol, toCol, boundaryCol);
    for (const run of runs) {
      const start = Math.min(...run.map((r) => Number(r[fromCol])));
      const end = Math.max(...run.map((r) => Number(r[toCol])));
      const domainValue = run[0][boundaryCol];
      const edges = binEdgesForDomain(start, end, length, residual);
      for (let i = 0; i < edges.length - 1; i += 1) {
        const row = composeBin(run, valueCol, fromCol, toCol, edges[i], edges[i + 1], method);
        if (row == null) continue;
        row[holeCol] = holeId;
        row[boundaryCol] = domainValue;
        out.push(row);
      }
    }
  }
  return out;
}

function composeBin(rows, valueCol, fromCol, toCol, cFrom, cTo, method) {
  let weightedSum = 0;
  let totalOverlap = 0;
  for (const r of rows) {
    const f = Number(r[fromCol]);
    const t = Number(r[toCol]);
    if (!(f < cTo) || !(t > cFrom)) continue;
    const overlap = Math.min(t, cTo) - Math.max(f, cFrom);
    if (!(overlap > 0)) continue;
    const v = Number(r[valueCol]);
    if (!Number.isFinite(v)) continue;
    weightedSum += v * overlap;
    totalOverlap += overlap;
  }
  if (totalOverlap <= 0) return null;
  const value = method === 'sum' ? weightedSum : weightedSum / totalOverlap;
  return { [fromCol]: cFrom, [toCol]: cTo, [valueCol]: value };
}

function groupRuns(rows, fromCol, toCol, boundaryCol) {
  if (!rows.length) return [];
  const tol = 1e-9;
  const runs = [];
  let current = [];
  let prevTo = null;
  let prevDomain = null;
  for (const row of rows) {
    const domain = row[boundaryCol];
    const sameDomain = prevDomain != null && domain === prevDomain;
    const abuts = prevTo == null || Math.abs(Number(row[fromCol]) - prevTo) <= tol;
    if (current.length && sameDomain && abuts) {
      current.push(row);
    } else {
      if (current.length) runs.push(current);
      current = [row];
    }
    prevTo = Number(row[toCol]);
    prevDomain = domain;
  }
  if (current.length) runs.push(current);
  return runs;
}

function binEdgesForDomain(start, end, length, residual) {
  const domainLength = end - start;
  if (domainLength <= 0) return [];
  if (residual === 'distribute') {
    const nBins = Math.max(1, Math.round(domainLength / length));
    const binLen = domainLength / nBins;
    const edges = [];
    for (let i = 0; i <= nBins; i += 1) edges.push(start + i * binLen);
    return edges;
  }
  const nFull = Math.floor(domainLength / length + 1e-9);
  const remainder = domainLength - nFull * length;
  const hasResidual = remainder > 1e-9;
  const edges = [];
  for (let i = 0; i <= nFull; i += 1) edges.push(start + i * length);

  if (!hasResidual) return edges;
  if (residual === 'discard') {
    if (nFull === 0) return [];
    return edges;
  }
  if (residual === 'add_to_previous') {
    if (nFull === 0) return [start, end];
    edges[edges.length - 1] = end;
    return edges;
  }
  return edges;
}
