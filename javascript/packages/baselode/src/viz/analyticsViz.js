/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Shared helpers for the analytics plot family — scatter, histogram, box,
 * violin, ternary.  Each plot primitive lives in its own module and
 * imports from here for partitioning + colour resolution + numeric
 * coercion.
 */

import { getColour, resolveColourMap } from './colourMap.js';
import { BASELODE_COLORWAY } from './baselodeTemplate.js';

const NULLISH_CATEGORY = '(missing)';

/**
 * Coerce *value* to a number; return `null` for missing / unparseable.
 */
export function asNumeric(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Return rows split into groups by the *groupBy* property.  Missing values
 * collapse into a single ``(missing)`` group so they're still visible.
 *
 * Preserves first-seen order of group keys so chart legends are stable
 * across runs on the same data.
 *
 * @param {Array<Object>} rows
 * @param {string} groupBy
 * @returns {Array<{ key: string, rows: Array<Object> }>}
 */
export function groupRowsBy(rows, groupBy) {
  if (!rows || !rows.length || !groupBy) return [];
  const grouped = new Map();
  for (const row of rows) {
    if (!row) continue;
    const rawValue = row[groupBy];
    const key = rawValue == null || rawValue === ''
      ? NULLISH_CATEGORY
      : String(rawValue);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return [...grouped.entries()].map(([key, groupRows]) => ({ key, rows: groupRows }));
}

/**
 * Resolve a categorical colour map (string name or explicit object) to a
 * function that returns a colour per group key.
 *
 * Lookup order per key:
 *   1. The explicit map (`commodity`, `lithology`, or a `{key: cssColour}` object)
 *   2. A cyclic default palette (`BASELODE_COLORWAY` by default) — each
 *      new group key gets the next colour, assigned at first lookup so
 *      the same key always resolves to the same colour within one render.
 *   3. The plain fallback colour, only used when both the map and the
 *      palette are empty.
 *
 * This means a column like `holetype` (no built-in map) still produces
 * distinct colours per group instead of every group sharing the
 * fallback grey.
 */
export function buildCategoricalColourResolver(colourMap, fallback = '#94a3b8', palette = BASELODE_COLORWAY) {
  let resolved = {};
  if (colourMap) {
    try {
      resolved = resolveColourMap(colourMap);
    } catch (_error) {
      // Unknown built-in name etc. — fall back to the cyclic palette.
      resolved = {};
    }
  }
  const palettePool = palette && palette.length ? palette : null;
  const cycledByKey = new Map();
  let nextPaletteIdx = 0;
  return (groupKey) => {
    const sentinel = '__BASELODE_NO_MATCH__';
    const explicit = getColour(groupKey, resolved, sentinel);
    if (explicit !== sentinel) return explicit;
    if (!palettePool) return fallback;
    const stableKey = groupKey == null ? '' : String(groupKey);
    if (!cycledByKey.has(stableKey)) {
      cycledByKey.set(stableKey, palettePool[nextPaletteIdx % palettePool.length]);
      nextPaletteIdx += 1;
    }
    return cycledByKey.get(stableKey);
  };
}

/**
 * Pull numeric values from *rows* for *property*, skipping null / NaN.
 * Returns parallel arrays of values + the row each value came from, so
 * callers can attach hover labels or category data.
 */
export function collectNumericValues(rows, property) {
  if (!rows || !rows.length || !property) return { values: [], sourceRows: [] };
  const values = [];
  const sourceRows = [];
  for (const row of rows) {
    if (!row) continue;
    const numeric = asNumeric(row[property]);
    if (numeric == null) continue;
    values.push(numeric);
    sourceRows.push(row);
  }
  return { values, sourceRows };
}

export { NULLISH_CATEGORY };
