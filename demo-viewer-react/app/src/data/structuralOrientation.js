/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { alphaBetaToDipAzimuth, HOLE_ID, DEPTH, DIP, AZIMUTH, ALPHA, BETA } from 'baselode';

/**
 * Coerce a cell to a finite number, treating null / empty string as missing —
 * `Number(null)` and `Number('')` are both 0, which would let empty Dip /
 * Azimuth CSV cells masquerade as real measurements.
 * @private
 */
function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Index survey stations by hole for depth lookups.
 *
 * @param {Array<Object>} surveyRows - Rows from `parseSurveyCSV` (standardized
 *   hole_id / depth / dip / azimuth fields)
 * @returns {Map<string, Array<{depth: number, dip: number, azimuth: number}>>}
 *   Stations per hole, sorted by depth ascending
 */
export function buildSurveyStationIndex(surveyRows) {
  const byHole = new Map();
  for (const row of surveyRows || []) {
    const holeId = row[HOLE_ID] != null ? `${row[HOLE_ID]}`.trim() : '';
    const depth = finiteOrNull(row[DEPTH]);
    const dip = finiteOrNull(row[DIP]);
    const azimuth = finiteOrNull(row[AZIMUTH]);
    if (!holeId || depth === null || dip === null || azimuth === null) continue;
    if (!byHole.has(holeId)) byHole.set(holeId, []);
    byHole.get(holeId).push({ depth, dip, azimuth });
  }
  for (const stations of byHole.values()) {
    stations.sort((first, second) => first.depth - second.depth);
  }
  return byHole;
}

/** Shortest-arc interpolation between two azimuths (degrees). @private */
function interpolateAzimuth(startAzimuth, endAzimuth, fraction) {
  const delta = ((endAzimuth - startAzimuth + 540) % 360) - 180;
  return (startAzimuth + fraction * delta + 360) % 360;
}

/**
 * Hole orientation (survey dip / azimuth) at a measured depth, linearly
 * interpolated between the bracketing survey stations (azimuth via the
 * shortest arc).  Depths beyond the survey extent clamp to the end stations.
 *
 * @param {Array<{depth: number, dip: number, azimuth: number}>} stations -
 *   Survey stations for one hole, sorted by depth ascending
 * @param {number} targetDepth - Measured depth to look up
 * @returns {{dip: number, azimuth: number}|null}
 */
export function orientationAtDepth(stations, targetDepth) {
  if (!stations?.length || !Number.isFinite(targetDepth)) return null;
  const first = stations[0];
  const last = stations[stations.length - 1];
  if (targetDepth <= first.depth) return { dip: first.dip, azimuth: first.azimuth };
  if (targetDepth >= last.depth) return { dip: last.dip, azimuth: last.azimuth };

  for (let stationIndex = 1; stationIndex < stations.length; stationIndex += 1) {
    const upper = stations[stationIndex];
    if (targetDepth > upper.depth) continue;
    const lower = stations[stationIndex - 1];
    const span = upper.depth - lower.depth;
    const fraction = span > 0 ? (targetDepth - lower.depth) / span : 0;
    return {
      dip: lower.dip + fraction * (upper.dip - lower.dip),
      azimuth: interpolateAzimuth(lower.azimuth, upper.azimuth, fraction),
    };
  }
  return { dip: last.dip, azimuth: last.azimuth };
}

/**
 * Resolve dip / azimuth for structural point rows.
 *
 * Rows that already carry measured dip + azimuth pass through unchanged.
 * Rows with only oriented-core alpha / beta angles are converted with
 * `alphaBetaToDipAzimuth`, using the hole's survey orientation at the
 * measurement depth.  Rows with neither are dropped.
 *
 * @param {Array<Object>} rows - Structural point rows for a single hole
 * @param {Array<{depth: number, dip: number, azimuth: number}>|undefined} stations -
 *   The hole's survey stations (from `buildSurveyStationIndex`)
 * @returns {{rows: Array<Object>, measuredCount: number, derivedCount: number}}
 *   Resolved rows (sorted by depth, tagged `orientation_source:
 *   'measured'|'derived'`) plus per-source counts
 */
export function resolveDipAzimuthRows(rows, stations) {
  const resolved = [];
  let measuredCount = 0;
  let derivedCount = 0;

  for (const row of rows || []) {
    const depth = finiteOrNull(row[DEPTH]);
    if (depth === null) continue;

    const measuredDip = finiteOrNull(row[DIP]);
    const measuredAzimuth = finiteOrNull(row[AZIMUTH]);
    if (measuredDip !== null && measuredAzimuth !== null) {
      resolved.push({ ...row, orientation_source: 'measured' });
      measuredCount += 1;
      continue;
    }

    const alpha = finiteOrNull(row[ALPHA]);
    const beta = finiteOrNull(row[BETA]);
    if (alpha === null || beta === null) continue;
    const holeOrientation = orientationAtDepth(stations, depth);
    if (!holeOrientation) continue;

    const converted = alphaBetaToDipAzimuth(holeOrientation.dip, holeOrientation.azimuth, alpha, beta);
    resolved.push({
      ...row,
      [DIP]: converted.dip,
      [AZIMUTH]: converted.dipDirection,
      orientation_source: 'derived',
    });
    derivedCount += 1;
  }

  resolved.sort((first, second) => Number(first[DEPTH]) - Number(second[DEPTH]));
  return { rows: resolved, measuredCount, derivedCount };
}
