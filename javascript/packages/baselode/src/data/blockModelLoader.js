/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { withDataErrorContext } from './dataErrorUtils.js';

// ---------------------------------------------------------------------------
// Column-name normalisation
// ---------------------------------------------------------------------------

/** Canonical geometry columns expected on every block row. */
const GEOMETRY_COLS = ['x', 'y', 'z', 'dx', 'dy', 'dz'];

/** Maps accepted source column name variants to canonical names. */
const BLOCK_COL_MAP = {
  x: ['x', 'easting', 'center_x', 'xc', 'xcentre', 'xcenter', 'x_centre', 'x_center', 'cx'],
  y: ['y', 'northing', 'center_y', 'yc', 'ycentre', 'ycenter', 'y_centre', 'y_center', 'cy'],
  z: ['z', 'elevation', 'center_z', 'zc', 'zcentre', 'zcenter', 'z_centre', 'z_center', 'cz'],
  dx: ['dx', 'size_x', 'sx', 'sizex', 'dim_x', 'block_size_x'],
  dy: ['dy', 'size_y', 'sy', 'sizey', 'dim_y', 'block_size_y'],
  dz: ['dz', 'size_z', 'sz', 'sizez', 'dim_z', 'block_size_z'],
};

/** Reverse lookup: lower-cased source name → canonical name */
const _blockColLookup = {};
Object.entries(BLOCK_COL_MAP).forEach(([canon, variants]) => {
  variants.forEach((v) => { _blockColLookup[v.toLowerCase()] = canon; });
});

/**
 * Rename a block row's keys from source column names to canonical names.
 * Unrecognised keys are kept as-is.
 * @param {Object} row - Raw parsed row object
 * @returns {Object} Row with canonical geometry key names
 */
export function normalizeBlockRow(row) {
  const out = {};
  Object.entries(row).forEach(([key, value]) => {
    const canon = _blockColLookup[key.toLowerCase().trim()] || key;
    out[canon] = value;
  });
  return out;
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/**
 * Parse block model CSV data.
 *
 * Accepts columns named ``x/y/z/dx/dy/dz`` (baselode canonical) or the
 * legacy ``center_x/center_y/center_z/size_x/size_y/size_z`` variants.
 * Both forms are normalised to the canonical names.
 *
 * @param {File|Blob|string} file - Block model CSV source
 * @returns {Promise<{data: Array<Object>, properties: Array<string>}>}
 *   Parsed blocks (canonical column names) and property column names.
 */
export function parseBlockModelCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        const normalized = (results.data || []).map(normalizeBlockRow);
        const data = normalized.filter(
          (row) => row.x !== null && row.y !== null && row.z !== null
        );

        const propertyColumns = Object.keys(data[0] || {}).filter(
          (key) => !GEOMETRY_COLS.includes(key)
        );

        resolve({ data, properties: propertyColumns });
      },
      error: (error) => {
        reject(withDataErrorContext('parseBlockModelCSV', error));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/**
 * Parse a block model metadata JSON string or plain object.
 *
 * The metadata object may contain: ``name``, ``description``, ``crs``,
 * ``origin``, ``max_block_size``, ``min_block_size``, ``bbox_3d``,
 * ``outline_2d``, ``attributes``, ``extra``.
 *
 * @param {string|Object} source - JSON string or already-parsed object
 * @returns {Object} Parsed metadata object
 */
export function loadBlockModelMetadata(source) {
  if (typeof source === 'string') {
    try {
      return JSON.parse(source);
    } catch (err) {
      throw withDataErrorContext('loadBlockModelMetadata', err);
    }
  }
  if (source && typeof source === 'object') return source;
  throw withDataErrorContext('loadBlockModelMetadata', new Error('Invalid metadata source'));
}

// ---------------------------------------------------------------------------
// Property statistics
// ---------------------------------------------------------------------------

/**
 * Calculate statistics for a property column in block model data.
 *
 * @param {Array<Object>} data - Block model data array
 * @param {string} property - Property column name to analyse
 * @returns {{type: 'numeric'|'categorical', min?: number, max?: number,
 *   values: Array, categories?: Array}} Property statistics
 */
export function calculatePropertyStats(data, property) {
  const values = data
    .map((row) => row[property])
    .filter((v) => v !== null && v !== undefined);

  const isNumeric = values.length > 0 && values.every((v) => typeof v === 'number');

  if (isNumeric) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { type: 'numeric', min, max, values };
  }

  const uniqueValues = [...new Set(values)];
  return { type: 'categorical', categories: uniqueValues, values };
}

/**
 * Compute per-property statistics for all non-geometry columns.
 *
 * @param {Array<Object>} data - Block model data array
 * @returns {Object} Map of ``propertyName → stats`` (same shape as
 *   :func:`calculatePropertyStats` return value)
 */
export function getBlockStats(data) {
  if (!data || data.length === 0) return {};
  const propertyKeys = Object.keys(data[0]).filter(
    (key) => !GEOMETRY_COLS.includes(key)
  );
  const result = {};
  propertyKeys.forEach((key) => {
    result[key] = calculatePropertyStats(data, key);
  });
  return result;
}

// ---------------------------------------------------------------------------
// Filtering and volume
// ---------------------------------------------------------------------------

/**
 * Filter block model rows by attribute criteria.
 *
 * @param {Array<Object>} data - Block model data array
 * @param {Object} criteria - Map of ``columnName → condition``.
 *   Each condition may be:
 *   - A scalar (exact equality)
 *   - An object with operator keys: ``gt``, ``gte``, ``lt``, ``lte``,
 *     ``eq``, ``ne``, ``in`` (array)
 * @returns {Array<Object>} Filtered array of block rows
 */
export function filterBlocks(data, criteria) {
  if (!criteria || typeof criteria !== 'object') return data;
  return data.filter((row) =>
    Object.entries(criteria).every(([col, condition]) => {
      const val = row[col];
      if (condition === null || condition === undefined) return true;
      if (typeof condition !== 'object' || Array.isArray(condition)) {
        return val === condition;
      }
      if ('gt' in condition && !(val > condition.gt)) return false;
      if ('gte' in condition && !(val >= condition.gte)) return false;
      if ('lt' in condition && !(val < condition.lt)) return false;
      if ('lte' in condition && !(val <= condition.lte)) return false;
      if ('eq' in condition && val !== condition.eq) return false;
      if ('ne' in condition && val === condition.ne) return false;
      if ('in' in condition && !condition.in.includes(val)) return false;
      return true;
    })
  );
}

/**
 * Calculate total block volume, optionally filtered by criteria.
 *
 * @param {Array<Object>} data - Block model data array (canonical column names)
 * @param {Object|null} [criteria] - Optional filter criteria (see :func:`filterBlocks`)
 * @returns {number} Sum of dx * dy * dz for matching blocks
 */
export function calculateBlockVolume(data, criteria = null) {
  const subset = criteria ? filterBlocks(data, criteria) : data;
  return subset.reduce((sum, row) => {
    const dx = Number(row.dx) || 0;
    const dy = Number(row.dy) || 0;
    const dz = Number(row.dz) || 0;
    return sum + dx * dy * dz;
  }, 0);
}

// ---------------------------------------------------------------------------
// Colorisation
// ---------------------------------------------------------------------------

/**
 * Generate a color for a property value based on its statistics.
 *
 * @param {*} value - Property value to colourise
 * @param {{type: 'numeric'|'categorical', min?: number, max?: number,
 *   categories?: Array}|null} stats - Property statistics
 * @param {Object} THREEInstance - THREE.js instance for creating Color objects
 * @returns {THREE.Color} Color object for the value
 */
export function getColorForValue(value, stats, THREEInstance) {
  if (!stats) return new THREEInstance.Color('#888888');

  if (stats.type === 'numeric') {
    const range = stats.max - stats.min;
    const normalized = range === 0 ? 0.5 : (value - stats.min) / range;
    const hue = (1 - normalized) * 240; // blue=240, red=0
    return new THREEInstance.Color().setHSL(hue / 360, 0.8, 0.5);
  }

  const index = stats.categories.indexOf(value);
  const hue = (index / Math.max(stats.categories.length, 1)) * 360;
  return new THREEInstance.Color().setHSL(hue / 360, 0.7, 0.5);
}
