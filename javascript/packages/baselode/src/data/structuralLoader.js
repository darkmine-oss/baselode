/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { standardizeColumns } from './keying.js';
import { withDataErrorContext } from './dataErrorUtils.js';
import { HOLE_ID, FROM, TO, DEPTH, DIP, AZIMUTH, STRUCTURE_TYPE, CONFIDENCE, INTENSITY } from './datamodel.js';

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
    [HOLE_ID]: holeId,
    [DEPTH]: depth,
    [DIP]: toNumber(row[DIP]),
    [AZIMUTH]: toNumber(row[AZIMUTH]),
    [STRUCTURE_TYPE]: row[STRUCTURE_TYPE] != null ? `${row[STRUCTURE_TYPE]}` : null,
    [CONFIDENCE]: row[CONFIDENCE] != null ? `${row[CONFIDENCE]}` : null,
    comments: row.comments != null ? `${row.comments}` : null,
    ...row,
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
    [HOLE_ID]: holeId,
    [FROM]: from,
    [TO]: to,
    mid,
    [DIP]: toNumber(row[DIP]),
    [AZIMUTH]: toNumber(row[AZIMUTH]),
    [STRUCTURE_TYPE]: row[STRUCTURE_TYPE] != null ? `${row[STRUCTURE_TYPE]}` : null,
    [INTENSITY]: toNumber(row[INTENSITY]),
    classification: row.classification != null ? `${row.classification}` : null,
    comments: row.comments != null ? `${row.comments}` : null,
    ...row,
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
      complete: (results) => {
        const rows = [];
        for (const rawRow of results.data) {
          const row = normalizeRow(rawRow, sourceColumnMap);
          const point = extractStructuralPoint(row);
          if (point) rows.push(point);
        }
        resolve(rows);
      },
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
      complete: (results) => {
        const rows = [];
        for (const rawRow of results.data) {
          const row = normalizeRow(rawRow, sourceColumnMap);
          const interval = extractStructuralInterval(row);
          if (interval) rows.push(interval);
        }
        resolve(rows);
      },
      error: (error) => reject(withDataErrorContext('parseStructuralIntervalsCSV', error)),
    });
  });
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
        const normalized = results.data.map(r => normalizeRow(r, sourceColumnMap));
        const schema = detectSchema(normalized);

        if (!schema) {
          reject(withDataErrorContext('parseStructuralCSV',
            new Error("Structural CSV requires either 'depth' (point) or 'from'/'to' (interval) columns")));
          return;
        }

        const rows = [];
        for (const row of normalized) {
          const parsed = schema === 'interval'
            ? extractStructuralInterval(row)
            : extractStructuralPoint(row);
          if (parsed) rows.push(parsed);
        }
        resolve({ schema, rows });
      },
      error: (error) => reject(withDataErrorContext('parseStructuralCSV', error)),
    });
  });
}
