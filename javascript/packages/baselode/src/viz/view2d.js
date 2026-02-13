/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

function toArray(rows) {
  return Array.isArray(rows) ? rows : [];
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function normalizePoint(point = {}) {
  return {
    ...point,
    x: toNumber(point.x),
    y: toNumber(point.y),
    z: toNumber(point.z)
  };
}

export function projectTraceToSection(traces = [], origin = [0, 0], azimuth = 0) {
  const [ox, oy] = origin;
  const azRad = (Number(azimuth) * Math.PI) / 180;
  const cosA = Math.cos(azRad);
  const sinA = Math.sin(azRad);

  return toArray(traces)
    .map(normalizePoint)
    .map((row) => {
      if (!Number.isFinite(row.x) || !Number.isFinite(row.y)) return { ...row };
      const dx = row.x - ox;
      const dy = row.y - oy;
      return {
        ...row,
        along: (dx * sinA) + (dy * cosA),
        across: (dx * cosA) - (dy * sinA)
      };
    });
}

export function sectionWindow(traces = [], origin = [0, 0], azimuth = 0, width = 50) {
  const projected = projectTraceToSection(traces, origin, azimuth);
  const half = 0.5 * Number(width || 0);
  if (!Number.isFinite(half) || half <= 0) return projected;
  return projected.filter((row) => Number.isFinite(row.across) && Math.abs(row.across) <= half);
}

export function planView(traces = [], depthSlice = null, colorBy = null) {
  let rows = toArray(traces).map(normalizePoint);
  if (Array.isArray(depthSlice) && depthSlice.length === 2) {
    const [top, bottom] = depthSlice;
    rows = rows.filter((row) => Number.isFinite(row.z) && row.z <= Number(top) && row.z >= Number(bottom));
  }
  if (colorBy) {
    rows = rows.map((row) => ({
      ...row,
      color_value: row?.[colorBy]
    }));
  }
  return rows;
}

export function sectionView(traces = [], origin = [0, 0], azimuth = 0, width = 50, colorBy = null) {
  let section = sectionWindow(traces, origin, azimuth, width);
  if (colorBy) {
    section = section.map((row) => ({
      ...row,
      color_value: row?.[colorBy]
    }));
  }
  return section;
}