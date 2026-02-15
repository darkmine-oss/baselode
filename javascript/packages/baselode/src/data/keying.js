/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { _COLUMN_LOOKUP, DEFAULT_COLUMN_MAP, HOLE_ID } from './datamodel.js';

/**
 * Normalize a field name to lowercase with underscores
 * @param {string} name - The field name to normalize
 * @returns {string} - The normalized field name
 */
export function normalizeFieldName(name) {
  return (name || '').toString().trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Standardize column names in a row object using the baselode data model
 * @param {Object} row - The row object with arbitrary column names
 * @param {Object} [columnMap] - Optional column map to use (defaults to DEFAULT_COLUMN_MAP)
 * @param {Object} [sourceColumnMap] - Optional additional column mappings from user
 * @returns {Object} - The row object with standardized column names
 */
export function standardizeColumns(row, columnMap = null, sourceColumnMap = null) {
  const lookup = { ..._COLUMN_LOOKUP };
  
  // Add user-provided column mappings
  if (sourceColumnMap) {
    for (const [rawName, expectedName] of Object.entries(sourceColumnMap)) {
      if (rawName != null && expectedName != null) {
        const normalizedKey = normalizeFieldName(rawName);
        const normalizedValue = normalizeFieldName(expectedName);
        lookup[normalizedKey] = normalizedValue;
      }
    }
  }

  const renamed = {};
  for (const [col, value] of Object.entries(row)) {
    const key = normalizeFieldName(col);
    const mapped = lookup[key] || key;
    renamed[mapped] = value;
  }

  return renamed;
}

/**
 * Standardize an array of rows (e.g., from CSV parsing)
 * @param {Array<Object>} rows - Array of row objects
 * @param {Object} [columnMap] - Optional column map to use
 * @param {Object} [sourceColumnMap] - Optional additional column mappings from user
 * @returns {Array<Object>} - Array of rows with standardized column names
 */
export function standardizeRowArray(rows, columnMap = null, sourceColumnMap = null) {
  return rows.map(row => standardizeColumns(row, columnMap, sourceColumnMap));
}
