/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Ensure value is an array
 * @private
 */
function toArray(rows) {
  return Array.isArray(rows) ? rows : [];
}

/**
 * Extract hole ID from a row using common field name variations
 * @private
 */
function getHoleId(row = {}) {
  return row.hole_id ?? row.holeId ?? row.id;
}

/**
 * Convert value to finite number or undefined
 * @private
 */
function toNumber(value, fallback = undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Convert trace points to line segments grouped by hole ID
 * @param {Array<Object>} traces - Array of trace points with x, y, z, md coordinates
 * @param {string|null} colorBy - Optional property name for per-point color values
 * @returns {Array<{hole_id: string, x: Array<number>, y: Array<number>, z: Array<number>, color: Array|null}>} Array of line segments
 */
export function tracesAsSegments(traces = [], colorBy = null) {
  const grouped = new Map();

  toArray(traces).forEach((row) => {
    const holeId = getHoleId(row);
    if (holeId === undefined || holeId === null || `${holeId}`.trim() === '') return;
    const key = `${holeId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  const segments = [];
  grouped.forEach((rows, holeId) => {
    const sorted = [...rows].sort((a, b) => toNumber(a.md, 0) - toNumber(b.md, 0));
    const payload = {
      hole_id: holeId,
      x: sorted.map((row) => toNumber(row.x, 0)),
      y: sorted.map((row) => toNumber(row.y, 0)),
      z: sorted.map((row) => toNumber(row.z, 0)),
      color: null
    };
    if (colorBy) {
      payload.color = sorted.map((row) => row?.[colorBy]);
    }
    segments.push(payload);
  });

  return segments;
}

/**
 * Convert interval data to tube/cylinder representations for 3D rendering
 * @param {Array<Object>} intervals - Array of interval objects with from/to depths and x, y, z coordinates
 * @param {number} radius - Tube radius
 * @param {string|null} colorBy - Optional property name for color value
 * @returns {Array<{hole_id: string, x: number, y: number, z: number, from: number, to: number, radius: number, color_value: *}>} Array of tube specifications
 */
export function intervalsAsTubes(intervals = [], radius = 1, colorBy = null) {
  return toArray(intervals).map((row) => ({
    hole_id: getHoleId(row),
    from: row?.from,
    to: row?.to,
    radius,
    color: colorBy ? row?.[colorBy] : null,
    value: colorBy ? row?.[colorBy] : null
  }));
}

/**
 * Extract annotation labels from interval data for 3D text display
 * @param {Array<Object>} intervals - Array of interval objects
 * @param {string|null} labelCol - Property name to use for label text
 * @returns {Array<{hole_id: string, label: string, depth: number}>} Array of annotations with computed mid-depth
 */
export function annotationsFromIntervals(intervals = [], labelCol = null) {
  if (!labelCol) return [];
  return toArray(intervals)
    .filter((row) => Object.prototype.hasOwnProperty.call(row || {}, labelCol))
    .map((row) => ({
      hole_id: getHoleId(row),
      label: row?.[labelCol],
      depth: 0.5 * ((toNumber(row?.from, 0)) + (toNumber(row?.to, 0)))
    }));
}