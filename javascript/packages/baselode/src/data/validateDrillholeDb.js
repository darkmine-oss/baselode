/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Comprehensive drillhole-database validator.
 *
 * Mirrors the Python `baselode.drill.validate.validate_drillhole_db`
 * shape: returns `{summary, issues}` where each issue carries a `check`
 * name, `severity` (`error` / `warning` / `info`), the affected
 * `hole_id` / `table` / `row_index`, a human-readable `message`, and a
 * `fix` recipe when one is available.
 */

import { HOLE_ID, FROM, TO, DEPTH, AZIMUTH, DIP, MAX_DEPTH } from './datamodel.js';
import { detectGaps, detectOverlaps } from './intervals.js';

export const SEVERITY_ERROR = 'error';
export const SEVERITY_WARNING = 'warning';
export const SEVERITY_INFO = 'info';

const BDL_PATTERN = /^\s*<\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*$/;

function makeIssue({ check, severity, message, holeId = null, table = null, rowIndex = null, fix = null }) {
  return { check, severity, hole_id: holeId, table, row_index: rowIndex, message, fix };
}

function buildMaxDepthLookup(collar, holeCol, maxDepthCol) {
  const lookup = new Map();
  for (const row of collar || []) {
    const holeId = row && row[holeCol];
    const value = row && row[maxDepthCol];
    if (holeId == null || value == null || Number.isNaN(Number(value))) continue;
    lookup.set(holeId, Number(value));
  }
  return lookup;
}

function groupBy(rows, key) {
  const grouped = new Map();
  for (const row of rows || []) {
    const value = row && row[key];
    if (value == null) continue;
    if (!grouped.has(value)) grouped.set(value, []);
    grouped.get(value).push(row);
  }
  return grouped;
}

function checkDuplicateHoleIds(collar, holeCol) {
  if (!collar || !collar.length) return [];
  const counts = new Map();
  for (const row of collar) {
    const holeId = row && row[holeCol];
    if (holeId == null) continue;
    counts.set(holeId, (counts.get(holeId) || 0) + 1);
  }
  const issues = [];
  for (const [holeId, count] of counts) {
    if (count > 1) {
      issues.push(makeIssue({
        check: 'duplicate_hole_ids',
        severity: SEVERITY_ERROR,
        holeId: String(holeId),
        table: 'collar',
        message: `Hole '${holeId}' appears ${count} times in the collar table`,
        fix: 'Remove or merge duplicate collar rows so each hole_id is unique',
      }));
    }
  }
  return issues;
}

function checkSingleStationSurveys(survey, holeCol) {
  if (!survey || !survey.length) return [];
  const grouped = groupBy(survey, holeCol);
  const issues = [];
  for (const [holeId, group] of grouped) {
    if (group.length === 1) {
      const rowIndex = survey.indexOf(group[0]);
      issues.push(makeIssue({
        check: 'single_station_surveys',
        severity: SEVERITY_WARNING,
        holeId: String(holeId),
        table: 'survey',
        rowIndex,
        message: `Hole '${holeId}' has only one survey station; desurvey will fail`,
        fix: 'Call fixSingleStationSurveys(survey, collar) to add a synthetic station',
      }));
    }
  }
  return issues;
}

function checkAzimuthRange(survey, holeCol, azimuthCol, allowFullCircle = false) {
  if (!survey || !survey.length) return [];
  const intervalText = allowFullCircle ? '[0, 360]' : '[0, 360)';
  const issues = [];
  survey.forEach((row, rowIndex) => {
    const value = row && row[azimuthCol];
    if (value == null || Number.isNaN(Number(value))) return;
    const numeric = Number(value);
    const outOfRange = numeric < 0 || (allowFullCircle ? numeric > 360 : numeric >= 360);
    if (outOfRange) {
      issues.push(makeIssue({
        check: 'azimuth_range',
        severity: SEVERITY_ERROR,
        holeId: row[holeCol] != null ? String(row[holeCol]) : null,
        table: 'survey',
        rowIndex,
        message: `Azimuth ${numeric} outside ${intervalText}`,
        fix: 'Call normalizeAzimuth(survey) to wrap into [0, 360) or correct the source value',
      }));
    }
  });
  return issues;
}

function checkDipRange(survey, holeCol, dipCol) {
  if (!survey || !survey.length) return [];
  const issues = [];
  survey.forEach((row, rowIndex) => {
    const value = row && row[dipCol];
    if (value == null || Number.isNaN(Number(value))) return;
    const numeric = Number(value);
    if (numeric < -90 || numeric > 90) {
      issues.push(makeIssue({
        check: 'dip_range',
        severity: SEVERITY_ERROR,
        holeId: row[holeCol] != null ? String(row[holeCol]) : null,
        table: 'survey',
        rowIndex,
        message: `Dip ${numeric} outside [-90, 90]`,
        fix: 'Correct the source dip value',
      }));
    }
  });
  return issues;
}

function checkOrphanIntervals(table, tableName, collarHoleIds, holeCol) {
  if (!table || !table.length) return [];
  const issues = [];
  table.forEach((row, rowIndex) => {
    const holeId = row && row[holeCol];
    if (holeId == null) return;
    if (!collarHoleIds.has(holeId)) {
      issues.push(makeIssue({
        check: 'orphan_intervals',
        severity: SEVERITY_ERROR,
        holeId: String(holeId),
        table: tableName,
        rowIndex,
        message: `Hole '${holeId}' in '${tableName}' is not present in the collar table`,
        fix: 'Call dropOrphanIntervals(table, collar) to remove these rows, or add the hole to the collar table',
      }));
    }
  });
  return issues;
}

function checkNegativeLengths(table, tableName, holeCol, fromCol, toCol) {
  if (!table || !table.length) return [];
  const issues = [];
  table.forEach((row, rowIndex) => {
    const fromDepth = row && row[fromCol];
    const toDepth = row && row[toCol];
    if (fromDepth == null || toDepth == null) return;
    if (Number(toDepth) <= Number(fromDepth)) {
      issues.push(makeIssue({
        check: 'negative_lengths',
        severity: SEVERITY_ERROR,
        holeId: row[holeCol] != null ? String(row[holeCol]) : null,
        table: tableName,
        rowIndex,
        message: `Interval from=${fromDepth} to=${toDepth} has zero or negative length`,
        fix: 'Call swapInvertedIntervals(table) to fix data-entry typos where to<from; zero-length rows (to===from) require manual review',
      }));
    }
  });
  return issues;
}

function checkIntervalsBeyondMaxDepth(table, tableName, maxDepthLookup, holeCol, toCol) {
  if (!maxDepthLookup.size || !table || !table.length) return [];
  const issues = [];
  table.forEach((row, rowIndex) => {
    const holeId = row && row[holeCol];
    if (holeId == null) return;
    const maxDepth = maxDepthLookup.get(holeId);
    if (maxDepth == null) return;
    const toDepth = row && row[toCol];
    if (toDepth == null) return;
    if (Number(toDepth) > maxDepth) {
      issues.push(makeIssue({
        check: 'intervals_beyond_max_depth',
        severity: SEVERITY_WARNING,
        holeId: String(holeId),
        table: tableName,
        rowIndex,
        message: `Interval to=${toDepth} exceeds collar max_depth=${maxDepth} for '${holeId}'`,
        fix: 'Extend collar max_depth or clip the interval',
      }));
    }
  });
  return issues;
}

function checkIntervalGaps(table, tableName, holeCol, fromCol, toCol) {
  if (!table || !table.length) return [];
  return detectGaps(table, { holeCol, fromCol, toCol }).map((gap) => makeIssue({
    check: 'interval_gaps',
    severity: SEVERITY_INFO,
    holeId: String(gap[holeCol]),
    table: tableName,
    message: `Gap from ${gap[fromCol]} to ${gap[toCol]} (${gap.length.toFixed(3)} m) in '${tableName}'`,
    fix: 'Re-sample the interval or document the gap',
  }));
}

function checkIntervalOverlaps(table, tableName, holeCol, fromCol, toCol) {
  if (!table || !table.length) return [];
  return detectOverlaps(table, { holeCol, fromCol, toCol }).map((overlap) => makeIssue({
    check: 'interval_overlaps',
    severity: SEVERITY_WARNING,
    holeId: String(overlap[holeCol]),
    table: tableName,
    rowIndex: overlap.first_index,
    message: (
      `Overlap from ${overlap[fromCol]} to ${overlap[toCol]} (${overlap.length.toFixed(3)} m) `
      + `between rows ${overlap.first_index} and ${overlap.second_index}`
    ),
    fix: 'Merge overlapping intervals or correct the from/to depths',
  }));
}

function checkBelowDetectionLimit(table, tableName, holeCol, fromCol, toCol) {
  if (!table || !table.length) return [];
  const reserved = new Set([holeCol, fromCol, toCol]);
  const issues = [];
  table.forEach((row, rowIndex) => {
    if (!row) return;
    for (const [col, value] of Object.entries(row)) {
      if (reserved.has(col)) continue;
      if (typeof value !== 'string') continue;
      if (!BDL_PATTERN.test(value)) continue;
      issues.push(makeIssue({
        check: 'below_detection_limit',
        severity: SEVERITY_INFO,
        holeId: row[holeCol] != null ? String(row[holeCol]) : null,
        table: tableName,
        rowIndex,
        message: `Column '${col}' contains below-detection sentinel '${value}'`,
        fix: 'Call replaceBelowDetectionLimit(rows, {columns: [...]}) to substitute MDL/2',
      }));
    }
  });
  return issues;
}

/**
 * Run the full drillhole-database validation suite.
 *
 * @param {Object} db - `{ collar, survey, intervalTables }`
 * @returns {{ summary: Object, issues: Array<Object> }}
 */
export function validateDrillholeDb(
  { collar = [], survey = [], intervalTables = null } = {},
  {
    holeCol = HOLE_ID,
    depthCol = DEPTH,
    azimuthCol = AZIMUTH,
    dipCol = DIP,
    fromCol = FROM,
    toCol = TO,
    maxDepthCol = MAX_DEPTH,
    allowFullCircle = false,
  } = {},
) {
  const issues = [];
  issues.push(...checkDuplicateHoleIds(collar, holeCol));
  issues.push(...checkSingleStationSurveys(survey, holeCol));
  issues.push(...checkAzimuthRange(survey, holeCol, azimuthCol, allowFullCircle));
  issues.push(...checkDipRange(survey, holeCol, dipCol));

  if (intervalTables) {
    const collarHoleIds = new Set(
      (collar || []).map((row) => row && row[holeCol]).filter((value) => value != null),
    );
    const maxDepthLookup = buildMaxDepthLookup(collar, holeCol, maxDepthCol);
    for (const [tableName, table] of Object.entries(intervalTables)) {
      issues.push(...checkOrphanIntervals(table, tableName, collarHoleIds, holeCol));
      issues.push(...checkNegativeLengths(table, tableName, holeCol, fromCol, toCol));
      issues.push(...checkIntervalsBeyondMaxDepth(table, tableName, maxDepthLookup, holeCol, toCol));
      issues.push(...checkIntervalGaps(table, tableName, holeCol, fromCol, toCol));
      issues.push(...checkIntervalOverlaps(table, tableName, holeCol, fromCol, toCol));
      issues.push(...checkBelowDetectionLimit(table, tableName, holeCol, fromCol, toCol));
    }
  }

  const summary = {
    [SEVERITY_ERROR]: issues.filter((issue) => issue.severity === SEVERITY_ERROR).length,
    [SEVERITY_WARNING]: issues.filter((issue) => issue.severity === SEVERITY_WARNING).length,
    [SEVERITY_INFO]: issues.filter((issue) => issue.severity === SEVERITY_INFO).length,
  };
  return { summary, issues };
}

/**
 * Synthesize a second survey station for any hole with only one.
 *
 * Mirrors `baselode.drill.validate.fix_single_station_surveys` — appends
 * a duplicate row at `collar.max_depth` (when available, otherwise
 * `depth + 1.0`) preserving azimuth/dip.
 */
export function fixSingleStationSurveys(
  survey,
  collar,
  { holeCol = HOLE_ID, depthCol = DEPTH, maxDepthCol = MAX_DEPTH } = {},
) {
  if (!survey || !survey.length) return [];

  const maxDepthLookup = collar ? buildMaxDepthLookup(collar, holeCol, maxDepthCol) : new Map();
  const grouped = groupBy(survey, holeCol);
  const additions = [];
  for (const [holeId, group] of grouped) {
    if (group.length !== 1) continue;
    const original = group[0];
    const originalDepth = Number(original[depthCol]);
    let anchorDepth = maxDepthLookup.get(holeId);
    if (anchorDepth == null || anchorDepth <= originalDepth) {
      anchorDepth = originalDepth + 1.0;
    }
    additions.push({ ...original, [depthCol]: anchorDepth });
  }

  const extended = [...survey, ...additions];
  return extended.sort((first, second) => {
    const firstHole = String(first[holeCol] ?? '');
    const secondHole = String(second[holeCol] ?? '');
    if (firstHole !== secondHole) return firstHole < secondHole ? -1 : 1;
    return Number(first[depthCol]) - Number(second[depthCol]);
  });
}

/**
 * Drop interval rows whose `hole_id` is not in the collar table.
 *
 * Complement of the `orphan_intervals` validation check.
 *
 * @returns {Array<Object>} new rows containing only those whose hole_id is in collar
 */
export function dropOrphanIntervals(table, collar, { holeCol = HOLE_ID } = {}) {
  if (!table || !table.length) return [];
  if (!collar || !collar.length) return [];
  const validHoleIds = new Set(
    collar.map((row) => row && row[holeCol]).filter((value) => value != null),
  );
  return table.filter((row) => row && validHoleIds.has(row[holeCol]));
}

/**
 * Swap `from` and `to` where the values are inverted.
 *
 * Fixes the common data-entry typo where `to < from`.  Rows where
 * `to === from` are genuinely malformed (zero-length intervals) and are
 * left untouched.  All other columns preserved.
 *
 * @returns {Array<Object>} new rows with inverted intervals corrected
 */
export function swapInvertedIntervals(table, { fromCol = FROM, toCol = TO } = {}) {
  if (!table || !table.length) return [];
  return table.map((row) => {
    if (!row) return row;
    const fromDepth = Number(row[fromCol]);
    const toDepth = Number(row[toCol]);
    if (Number.isFinite(fromDepth) && Number.isFinite(toDepth) && toDepth < fromDepth) {
      return { ...row, [fromCol]: toDepth, [toCol]: fromDepth };
    }
    return { ...row };
  });
}

/**
 * Wrap survey azimuths into `[0, 360)`.
 *
 * Folds `360` to `0`, brings negatives like `-30` to `330`, and is
 * idempotent for already-valid values.  Non-numeric or `null` values are
 * left untouched.
 *
 * @returns {Array<Object>} new rows with the azimuth column normalized
 */
export function normalizeAzimuth(survey, { azimuthCol = AZIMUTH } = {}) {
  if (!survey || !survey.length) return [];
  return survey.map((row) => {
    if (!row) return row;
    const value = row[azimuthCol];
    if (value == null) return { ...row };
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return { ...row };
    const wrapped = ((numeric % 360) + 360) % 360;
    return { ...row, [azimuthCol]: wrapped };
  });
}

/**
 * Replace `<MDL` strings with `MDL * sentinelFactor`.
 *
 * Mirrors `baselode.drill.validate.replace_below_detection_limit`.
 */
export function replaceBelowDetectionLimit(rows, { columns = null, sentinelFactor = 0.5 } = {}) {
  if (!rows || !rows.length) return [];
  const targetColumns = columns ? new Set(columns) : null;
  return rows.map((row) => {
    if (!row) return row;
    const out = { ...row };
    for (const [col, value] of Object.entries(row)) {
      if (targetColumns && !targetColumns.has(col)) continue;
      if (typeof value !== 'string') continue;
      const match = BDL_PATTERN.exec(value);
      if (match === null) continue;
      out[col] = Number(match[1]) * sentinelFactor;
    }
    return out;
  });
}
