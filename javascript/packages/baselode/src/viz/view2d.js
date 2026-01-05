/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Ensure value is an array
 * @private
 * @param {*} rows - Value to convert to array
 * @returns {Array} Array
 */
function toArray(rows) {
  return Array.isArray(rows) ? rows : [];
}

/**
 * Convert value to finite number or undefined
 * @private
 * @param {*} value - Value to convert
 * @returns {number|undefined} Finite number or undefined
 */
function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Normalize a point to ensure x, y, z are finite numbers
 * @private
 * @param {Object} point - Point object
 * @returns {Object} Normalized point
 */
function normalizePoint(point = {}) {
  return {
    ...point,
    x: toNumber(point.x),
    y: toNumber(point.y),
    z: toNumber(point.z)
  };
}

/**
 * Project 3D trace points onto a 2D cross-section plane
 * @param {Array<Object>} traces - Array of trace points with x, y, z coordinates
 * @param {Array<number>} origin - Section origin [x, y] coordinates
 * @param {number} azimuth - Section azimuth in degrees
 * @returns {Array<Object>} Trace points with added 'along' and 'across' section coordinates
 */
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

/**
 * Filter trace points to those within a width window around a section line
 * @param {Array<Object>} traces - Array of trace points
 * @param {Array<number>} origin - Section origin [x, y] coordinates
 * @param {number} azimuth - Section azimuth in degrees
 * @param {number} width - Section width (points within ±width/2 are included)
 * @returns {Array<Object>} Filtered trace points within section window
 */
export function sectionWindow(traces = [], origin = [0, 0], azimuth = 0, width = 50) {
  const projected = projectTraceToSection(traces, origin, azimuth);
  const half = 0.5 * Number(width || 0);
  if (!Number.isFinite(half) || half <= 0) return projected;
  return projected.filter((row) => Number.isFinite(row.across) && Math.abs(row.across) <= half);
}

/**
 * Generate plan view of traces, optionally filtered by depth slice
 * @param {Array<Object>} traces - Array of trace points
 * @param {Array<number>|null} depthSlice - Optional [top, bottom] depth range to filter
 * @param {string|null} colorBy - Optional property name for color_value
 * @returns {Array<Object>} Trace points for plan view
 */
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

/**
 * Generate cross-section view of traces within a window
 * @param {Array<Object>} traces - Array of trace points
 * @param {Array<number>} origin - Section origin [x, y] coordinates
 * @param {number} azimuth - Section azimuth in degrees
 * @param {number} width - Section width
 * @param {string|null} colorBy - Optional property name for color_value
 * @returns {Array<Object>} Section trace points with along/across coordinates
 */
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