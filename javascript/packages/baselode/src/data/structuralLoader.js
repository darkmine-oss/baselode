/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { standardizeColumns } from './keying.js';
import { withDataErrorContext } from './dataErrorUtils.js';
import { HOLE_ID, FROM, TO, DEPTH, DIP, AZIMUTH } from './datamodel.js';

/**
 * Normalize a raw CSV row to standardized column names.
 * @private
 */
const normalizeRow = (rawRow, sourceColumnMap = null) => standardizeColumns(rawRow, null, sourceColumnMap);

/**
 * Determine if a set of rows represents point or interval data.
 * @private
 * @param {Array<Object>} rows - Normalized rows
 * @returns {'point'|'interval'|null}
 */
function detectSchema(rows) {
  if (!rows.length) return null;
  const first = rows[0];
  const hasInterval = FROM in first && TO in first;
  const hasPoint = DEPTH in first && !hasInterval;
  if (hasInterval) return 'interval';
  if (hasPoint) return 'point';
  return null;
}

/**
 * Coerce a value to a finite number or null.
 * @private
 */
function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize a single structural point row.
 * @private
 */
function extractStructuralPoint(row) {
  const holeId = row[HOLE_ID] !== undefined ? `${row[HOLE_ID]}`.trim() : '';
  if (!holeId) return null;
  const depth = toNumber(row[DEPTH]);
  if (depth === null) return null;

  return {
    ...row,
    [HOLE_ID]: holeId,
    [DEPTH]: depth,
    [DIP]: toNumber(row[DIP]),
    [AZIMUTH]: toNumber(row[AZIMUTH]),
    comments: row.comments != null ? `${row.comments}` : null,
  };
}

/**
 * Normalize a single structural interval row.
 * @private
 */
function extractStructuralInterval(row) {
  const holeId = row[HOLE_ID] !== undefined ? `${row[HOLE_ID]}`.trim() : '';
  if (!holeId) return null;
  const from = toNumber(row[FROM]);
  const to = toNumber(row[TO]);
  if (from === null || to === null || to <= from) return null;

  const mid = 0.5 * (from + to);
  return {
    ...row,
    [HOLE_ID]: holeId,
    [FROM]: from,
    [TO]: to,
    mid,
    [DIP]: toNumber(row[DIP]),
    [AZIMUTH]: toNumber(row[AZIMUTH]),
    classification: row.classification != null ? `${row.classification}` : null,
    comments: row.comments != null ? `${row.comments}` : null,
  };
}

/**
 * Validate an array of structural point rows.
 * Returns an object with valid rows and error details.
 *
 * @param {Array<Object>} rows - Normalized structural point rows
 * @returns {{ valid: Array<Object>, errors: Array<{row: Object, message: string}> }}
 */
export function validateStructuralPoints(rows) {
  const valid = [];
  const errors = [];

  for (const row of rows) {
    const messages = [];
    const dip = toNumber(row[DIP]);
    const az = toNumber(row[AZIMUTH]);

    if (dip !== null && (dip < 0 || dip > 90)) {
      messages.push(`dip ${dip} out of range [0, 90]`);
    }
    if (az !== null && (az < 0 || az >= 360)) {
      messages.push(`azimuth ${az} out of range [0, 360)`);
    }
    if (messages.length) {
      errors.push({ row, message: messages.join('; ') });
    } else {
      valid.push(row);
    }
  }

  return { valid, errors };
}

/**
 * Parse structural point measurements from already-decoded rows.
 *
 * @param {Array<Object>} rows - Parsed structural row objects
 * @param {Object|null} sourceColumnMap - Optional column name overrides
 * @returns {Array<Object>} Structural point objects
 */
export function parseStructuralPointsFromRows(rows, sourceColumnMap = null) {
  const parsed = [];
  for (const rawRow of rows || []) {
    const point = extractStructuralPoint(normalizeRow(rawRow, sourceColumnMap));
    if (point) parsed.push(point);
  }
  return parsed;
}

/**
 * Parse structural interval measurements from already-decoded rows.
 *
 * @param {Array<Object>} rows - Parsed structural row objects
 * @param {Object|null} sourceColumnMap - Optional column name overrides
 * @returns {Array<Object>} Structural interval objects
 */
export function parseStructuralIntervalsFromRows(rows, sourceColumnMap = null) {
  const parsed = [];
  for (const rawRow of rows || []) {
    const interval = extractStructuralInterval(normalizeRow(rawRow, sourceColumnMap));
    if (interval) parsed.push(interval);
  }
  return parsed;
}

/**
 * Auto-detect and parse structural measurements from already-decoded rows.
 *
 * @param {Array<Object>} rows - Parsed structural row objects
 * @param {Object|null} sourceColumnMap - Optional column name overrides
 * @returns {{schema: 'point'|'interval', rows: Array<Object>}}
 */
export function parseStructuralFromRows(rows, sourceColumnMap = null) {
  const sourceRows = rows || [];
  const first = sourceRows.length ? normalizeRow(sourceRows[0], sourceColumnMap) : null;
  const schema = detectSchema(first ? [first] : []);
  if (!schema) {
    throw withDataErrorContext(
      'parseStructuralFromRows',
      new Error("Structural rows require either 'depth' (point) or 'from'/'to' (interval) columns"),
    );
  }

  const parsed = [];
  for (let index = 0; index < sourceRows.length; index += 1) {
    const row = index === 0 ? first : normalizeRow(sourceRows[index], sourceColumnMap);
    const value = schema === 'interval'
      ? extractStructuralInterval(row)
      : extractStructuralPoint(row);
    if (value) parsed.push(value);
  }
  return { schema, rows: parsed };
}

/**
 * Parse a structural points CSV (point schema: hole_id, depth, dip, azimuth, ...).
 *
 * @param {File|Blob|string} source - CSV file or text
 * @param {Object|null} sourceColumnMap - Optional column name overrides
 * @returns {Promise<Array<Object>>} Array of structural point objects
 */
export function parseStructuralPointsCSV(source, sourceColumnMap = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => resolve(parseStructuralPointsFromRows(results.data, sourceColumnMap)),
      error: (error) => reject(withDataErrorContext('parseStructuralPointsCSV', error)),
    };

    if (typeof source === 'string' && !source.startsWith('data:') && source.includes('\n')) {
      Papa.parse(source, opts);
    } else {
      Papa.parse(source, opts);
    }
  });
}

/**
 * Parse a structural intervals CSV (interval schema: hole_id, from, to, dip, azimuth, ...).
 *
 * @param {File|Blob|string} source - CSV file or text
 * @param {Object|null} sourceColumnMap - Optional column name overrides
 * @returns {Promise<Array<Object>>} Array of structural interval objects
 */
export function parseStructuralIntervalsCSV(source, sourceColumnMap = null) {
  return new Promise((resolve, reject) => {
    Papa.parse(source, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => resolve(parseStructuralIntervalsFromRows(results.data, sourceColumnMap)),
      error: (error) => reject(withDataErrorContext('parseStructuralIntervalsCSV', error)),
    });
  });
}

/**
 * Group a flat array of structural rows into hole objects keyed by hole_id.
 *
 * The resulting hole objects use the same shape as assay holes
 * ({ holeId, points }) so they can be merged into useDrillholeTraceGrid.
 *
 * @param {Array<Object>} rows - Flat array of structural rows (already normalized)
 * @param {string} [holeIdCol='hole_id'] - Column name containing the hole identifier
 * @returns {Array<{ holeId: string, points: Array<Object> }>}
 */
export function groupRowsByHole(rows, holeIdCol = HOLE_ID) {
  const byId = new Map();
  for (const row of rows) {
    const id = row[holeIdCol] != null ? String(row[holeIdCol]).trim() : '';
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, { holeId: id, points: [] });
    byId.get(id).points.push(row);
  }
  return Array.from(byId.values());
}

/**
 * Parse a structural CSV, auto-detecting point vs interval schema.
 *
 * @param {File|Blob|string} source - CSV file or text
 * @param {Object|null} sourceColumnMap - Optional column name overrides
 * @returns {Promise<{ schema: 'point'|'interval', rows: Array<Object> }>}
 */
export function parseStructuralCSV(source, sourceColumnMap = null) {
  return new Promise((resolve, reject) => {
    Papa.parse(source, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          resolve(parseStructuralFromRows(results.data, sourceColumnMap));
        } catch (error) {
          reject(withDataErrorContext('parseStructuralCSV', error));
        }
      },
      error: (error) => reject(withDataErrorContext('parseStructuralCSV', error)),
    });
  });
}
