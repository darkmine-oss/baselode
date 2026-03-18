/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { standardizeColumns } from './keying.js';
import { HOLE_ID, DEPTH, FROM, TO, MID, GEOPHYSICS_NULL_SENTINEL } from './datamodel.js';

/**
 * Column name variants for depth in geophysics point logs.
 * These are tried (after normalisation) when the standard 'depth' column is absent.
 * @private
 */
const DEPTH_ALIASES = ['depth', 'md', 'measured_depth', 'dept', 'z'];

/**
 * Resolve the depth value from a standardised geophysics row.
 *
 * Supports both point-based (single depth column) and interval-based (from/to)
 * schemas. For interval rows the midpoint is returned. The standard DEPTH
 * column is tried first; common aliases are checked as a fallback.
 *
 * @private
 * @param {object} row - Standardised row object
 * @returns {number|null}
 */
function resolveDepth(row) {
  // Point-based: explicit depth column
  if (row[DEPTH] !== undefined) {
    const v = Number(row[DEPTH]);
    if (Number.isFinite(v)) return v;
  }
  for (const alias of DEPTH_ALIASES) {
    if (row[alias] !== undefined) {
      const v = Number(row[alias]);
      if (Number.isFinite(v)) return v;
    }
  }
  // Interval-based: compute midpoint from from/to
  const f = Number(row[FROM]);
  const t = Number(row[TO]);
  if (Number.isFinite(f) && Number.isFinite(t) && t >= f) return (f + t) / 2;
  return null;
}

/**
 * Discover the numeric value columns in a geophysics file.
 *
 * All columns that are not hole_id or a recognised depth alias are considered
 * candidate value columns.  Only columns whose values parse as finite numbers
 * for the majority (>50 %) of rows are retained, so comment or flag columns
 * are dropped automatically.
 *
 * @private
 * @param {object[]} rows - Standardised rows
 * @returns {string[]} Ordered list of numeric value column names
 */
function detectValueColumns(rows) {
  if (rows.length === 0) return [];
  const skipSet = new Set([HOLE_ID, DEPTH, FROM, TO, MID, ...DEPTH_ALIASES]);
  const candidates = Object.keys(rows[0]).filter((c) => !skipSet.has(c));

  return candidates.filter((col) => {
    let numericCount = 0;
    for (const row of rows) {
      const v = Number(row[col]);
      if (Number.isFinite(v)) numericCount++;
    }
    return numericCount / rows.length > 0.5;
  });
}

/**
 * Parse a geophysics point-log CSV into per-hole arrays of depths and values.
 *
 * Unlike assay intervals (from/to), geophysics logs contain one row per sample
 * depth — typically at a fixed spacing (e.g. 0.1 m for gamma probes).  This
 * loader handles the higher sample density gracefully; there is no upper limit
 * on the number of rows.
 *
 * ### Column detection
 * - **hole_id** — standard variants recognised by `standardizeColumns`.
 * - **depth** — standard `depth` plus common aliases: `md`, `measured_depth`,
 *   `dept`, `z`.
 * - **value columns** — every other numeric column is treated as a geophysics
 *   channel (gamma, resistivity, SP, etc.).  Column names are preserved as-is
 *   after normalisation so callers can identify individual channels.
 *
 * ### Return value
 * Returns an array of **hole objects**, one per unique hole_id:
 * ```js
 * [
 *   {
 *     holeId: 'GSWA001',
 *     channels: {
 *       gamma: { depths: [0.0, 0.1, 0.2, ...], values: [45, 47, 52, ...] },
 *       sp:    { depths: [0.0, 0.1, 0.2, ...], values: [-12, -11, -9, ...] },
 *     }
 *   },
 *   ...
 * ]
 * ```
 * The `channels` object keys match the normalised CSV column names.  Each
 * channel only includes rows where both depth and value are finite numbers.
 *
 * @param {string} csvText - Raw CSV text
 * @param {object} [columnMap] - Optional `{ rawName: standardName }` overrides
 * @returns {Array<{holeId: string, channels: object}>}
 */
export function parseGeophysicsCSV(csvText, columnMap = null) {
  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  const rawRows = result.data || [];
  if (rawRows.length === 0) return [];

  const rows = rawRows.map((r) => standardizeColumns(r, null, columnMap));

  // Discover value columns from the full dataset
  const valueCols = detectValueColumns(rows);

  // Group rows by hole
  const byHole = new Map();
  for (const row of rows) {
    const holeId = row[HOLE_ID] != null ? `${row[HOLE_ID]}`.trim() : '';
    if (!holeId) continue;

    const depth = resolveDepth(row);
    if (depth === null || depth < 0) continue;

    if (!byHole.has(holeId)) byHole.set(holeId, []);
    byHole.get(holeId).push({ depth, row });
  }

  const holes = [];
  for (const [holeId, samples] of byHole) {
    // Sort by depth (ascending)
    samples.sort((a, b) => a.depth - b.depth);

    const channels = {};
    for (const col of valueCols) {
      const depths = [];
      const values = [];
      for (const { depth, row } of samples) {
        const v = Number(row[col]);
        if (Number.isFinite(v) && v !== GEOPHYSICS_NULL_SENTINEL) {
          depths.push(depth);
          values.push(v);
        }
      }
      if (depths.length >= 2) {
        channels[col] = { depths, values };
      }
    }

    if (Object.keys(channels).length > 0) {
      holes.push({ holeId, channels });
    }
  }

  return holes;
}

/**
 * Convert the output of `parseGeophysicsCSV` into the strip log format
 * expected by `Baselode3DScene.setStripLogs`.
 *
 * A single channel from each hole becomes one strip log entry.  If a hole has
 * multiple channels, pass `channel` to select which one (defaults to the first
 * channel found).
 *
 * @param {Array<{holeId: string, channels: object}>} geophysicsHoles
 *   Output of `parseGeophysicsCSV`.
 * @param {string} [channel]
 *   Channel name to use.  When omitted, the first available channel per hole
 *   is used.
 * @param {object} [options]
 *   Strip log display options forwarded to each entry's `options` field.
 *   See `normalizeStripLogOptions` for available keys.
 * @returns {Array<{holeId: string, depths: number[], values: number[], options: object}>}
 */
export function geophysicsToStripLogs(geophysicsHoles, channel = null, options = {}) {
  const stripLogs = [];
  for (const { holeId, channels } of geophysicsHoles) {
    const key = channel && channels[channel] ? channel : Object.keys(channels)[0];
    if (!key) continue;
    const { depths, values } = channels[key];
    stripLogs.push({ holeId, depths, values, options });
  }
  return stripLogs;
}
