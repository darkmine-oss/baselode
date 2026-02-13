/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

function toArray(rows) {
  return Array.isArray(rows) ? rows : [];
}

function getHoleId(row = {}) {
  return row.hole_id ?? row.holeId ?? row.id;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

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