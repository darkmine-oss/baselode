/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Column-classification helpers shared by every interactive panel.
 * Lifted verbatim from the inline implementations that lived in
 * `demo-viewer-react` and `baselode-frontend`, so the panels (and
 * the viewer apps now consuming them) all classify columns the same
 * way regardless of which app they're rendered in.
 *
 * Two heuristics:
 * - Numeric columns: rows where the value parses as a finite number,
 *   sorted by frequency descending so the most-populated columns
 *   surface as defaults.
 * - Categorical columns: majority-non-numeric (≥50% of populated
 *   values are non-numeric) with 2–40 distinct values.  The
 *   majority-rule lets columns like `geology_code` — where most rows
 *   are strings but a few happen to be integers — through, which the
 *   stricter "no row is numeric" rule would reject.
 */

import { FROM, HOLE_ID, MID, TO } from '../data/datamodel.js';

const RESERVED_COLUMN_NAMES = new Set([
  HOLE_ID, FROM, TO, MID,
  'depth', '_source',
]);

/**
 * Detect numeric columns in a row array.
 *
 * @param {Array<Object>} rows
 * @param {Object} [options]
 * @param {Set<string>} [options.reserved=RESERVED_COLUMN_NAMES] -
 *   Override the always-skip set when the caller knows columns we
 *   don't ship in the default reservation (e.g. extra IDs).
 * @returns {Array<string>} Column names, sorted by populated-row
 *   count descending so the loudest analytes come first.
 */
export function detectNumericColumns(rows, options = {}) {
  const reserved = options.reserved || RESERVED_COLUMN_NAMES;
  if (!rows || !rows.length) return [];
  const counts = new Map();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (reserved.has(key)) continue;
      // `Number('')` is 0 — explicit blank-string skip prevents
      // empty cells from masquerading as numeric.
      if (value == null) continue;
      if (typeof value === 'string' && value.trim() === '') continue;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
}

/**
 * Detect categorical columns in a row array.
 *
 * @param {Array<Object>} rows
 * @param {Object} [options]
 * @param {Set<string>} [options.reserved=RESERVED_COLUMN_NAMES]
 * @param {number} [options.maxDistinct=40] - Reject columns with
 *   more than this many distinct values — they're almost certainly
 *   free-text or IDs rather than a categorical breakdown.
 * @returns {Array<string>} Column names, sorted by distinct-value
 *   count ascending so the smallest (most useful) categoricals come
 *   first.
 */
export function detectCategoricalColumns(rows, options = {}) {
  const reserved = options.reserved || RESERVED_COLUMN_NAMES;
  const maxDistinct = options.maxDistinct ?? 40;
  if (!rows || !rows.length) return [];
  // Track distinct values + how many of them parse as numeric per
  // column.  Majority-non-numeric → categorical.
  const stats = new Map();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (reserved.has(key)) continue;
      if (value == null) continue;
      if (typeof value === 'string' && value.trim() === '') continue;
      if (!stats.has(key)) stats.set(key, { distinct: new Set(), numeric: 0, total: 0 });
      const entry = stats.get(key);
      entry.distinct.add(String(value));
      entry.total += 1;
      if (Number.isFinite(Number(value))) entry.numeric += 1;
    }
  }
  return [...stats.entries()]
    .filter(([, entry]) => {
      const distinct = entry.distinct.size;
      if (distinct < 2 || distinct > maxDistinct) return false;
      // Majority non-numeric: at most half the populated values
      // parse as numbers.
      return entry.numeric * 2 <= entry.total;
    })
    .sort((a, b) => a[1].distinct.size - b[1].distinct.size)
    .map(([key]) => key);
}

/**
 * Pick a default colour-by column from a categorical list.
 *
 * Prefers names containing `lithology` / `litho`, then
 * `surface_sample_type`, then `project_id`, then the first entry.
 * Mirrors the convention the demo viewer + baselode-frontend
 * settled on so panels behave the same when dropped into either app.
 *
 * @param {Array<string>} categoricalColumns
 * @returns {string} Column name or `''` when the list is empty.
 */
export function defaultColorByColumn(categoricalColumns) {
  if (!categoricalColumns || !categoricalColumns.length) return '';
  const preferred = ['litho', 'surface_sample_type', 'project_id'];
  for (const hint of preferred) {
    const hit = categoricalColumns.find((column) => column.toLowerCase().includes(hint));
    if (hit) return hit;
  }
  return categoricalColumns[0];
}
