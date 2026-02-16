/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { ASSAY_NON_VALUE_FIELDS } from './assayFieldSets.js';
import { standardizeColumns } from './keying.js';
import { withDataErrorContext } from './dataErrorUtils.js';
import { HOLE_ID, FROM, TO, PROJECT_ID } from './datamodel.js';

/**
 * Normalize a raw CSV row to use standardized column names
 * @private
 */
const normalizeRow = (rawRow, sourceColumnMap = null) => standardizeColumns(rawRow, null, sourceColumnMap);

/**
 * Extract hole ID from a normalized row
 * @private
 * @param {Object} row - Normalized row object
 * @returns {{holeId: string}} Object containing hole ID
 */
function extractIdFields(row) {
  const holeId = row[HOLE_ID];
  return { holeId };
}

/**
 * Extract and validate assay interval data from a row
 * @private
 * @param {Object} row - Normalized row object
 * @param {Object|null} sourceColumnMap - Optional column mappings
 * @returns {Object|null} Interval object or null if invalid
 */
function extractInterval(row, sourceColumnMap = null) {
  const holeIdRaw = row[HOLE_ID];
  const holeId = holeIdRaw !== undefined ? `${holeIdRaw}`.trim() : '';
  if (!holeId) return null;

  const project = row[PROJECT_ID] || row.project || row.project_code;
  const from = Number(row[FROM]);
  const to = Number(row[TO]);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;

  return {
    holeId,
    project,
    from,
    to,
    ...row
  };
}

/**
 * Convert array of intervals to a hole object with points
 * @private
 * @param {string} holeId - Hole identifier
 * @param {Array<Object>} intervals - Array of interval objects
 * @returns {{id: string, project: string, points: Array<Object>}} Hole object
 */
function intervalsToHole(holeId, intervals) {
  const sorted = intervals.sort((a, b) => a.from - b.from);
  const points = [];
  sorted.forEach((iv) => {
    const { from, to, project, ...rest } = iv;
    const pointData = {
      z: from,
      from,
      to,
      [HOLE_ID]: holeId,
      [PROJECT_ID]: project,
      ...rest
    };
    points.push(pointData);
    points.push({ ...pointData, z: to });
  });
  return { id: holeId, project: sorted[0]?.project, points };
}

/**
 * Parse assay CSV to extract unique hole IDs (quick pass, no interval data)
 * @param {File|Blob} file - Assay CSV file
 * @param {Object|null} sourceColumnMap - Optional column name mappings
 * @returns {Promise<Array<string>>} Array of unique hole IDs
 */
export function parseAssayHoleIds(file, sourceColumnMap = null) {
  return new Promise((resolve, reject) => {
    const holeIds = new Set();
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      step: (results) => {
        const row = normalizeRow(results.data, sourceColumnMap);
        const hid = row[HOLE_ID];
        if (hid !== undefined && `${hid}`.trim() !== '') {
          holeIds.add(`${hid}`.trim());
        }
      },
      complete: () => resolve(Array.from(holeIds)),
      error: (error) => reject(withDataErrorContext('parseAssayHoleIds', error))
    });
  });
}

/**
 * Check if a row has at least one non-null assay value
 * @private
 * @param {Object} row - Normalized row object
 * @returns {boolean} True if row contains assay data
 */
function hasAssayValue(row) {
  return Object.entries(row || {}).some(([k, v]) => {
    if (ASSAY_NON_VALUE_FIELDS.has(k)) return false;
    if (v === undefined || v === null) return false;
    if (typeof v === 'string' && v.trim() === '') return false;
    return true;
  });
}

/**
 * Parse assay CSV to extract hole IDs that have at least one assay value (quick pass)
 * @param {File|Blob} file - Assay CSV file
 * @param {Object|null} sourceColumnMap - Optional column name mappings
 * @returns {Promise<Array<{holeId: string}>>} Array of objects with hole IDs that have assay data
 */
export function parseAssayHoleIdsWithAssays(file, sourceColumnMap = null) {
  return new Promise((resolve, reject) => {
    const byHole = new Map();
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      step: (results) => {
        const row = normalizeRow(results.data, sourceColumnMap);
        if (!hasAssayValue(row)) return;
        const ids = extractIdFields(row);
        const hid = ids.holeId;
        if (hid !== undefined && `${hid}`.trim() !== '') {
          const key = `${hid}`.trim();
          if (!byHole.has(key)) {
            byHole.set(key, {
              holeId: key
            });
          }
        }
      },
      complete: () => resolve(Array.from(byHole.values())),
      error: (error) => reject(withDataErrorContext('parseAssayHoleIdsWithAssays', error))
    });
  });
}

/**
 * Parse assay CSV for a single hole's intervals
 * @param {File|Blob} file - Assay CSV file
 * @param {string} holeId - Hole identifier to extract
 * @param {Object|null} config - Optional configuration (unused, for backwards compatibility)
 * @param {Object|null} sourceColumnMap - Optional column name mappings
 * @returns {Promise<Object|null>} Hole object with intervals or null if not found
 */
export function parseAssayHole(file, holeId, config = null, sourceColumnMap = null) {
  return new Promise((resolve, reject) => {
    const wanted = `${holeId}`.trim();
    if (!wanted) {
      reject(withDataErrorContext('parseAssayHole', new Error('Missing hole id')));
      return;
    }
    const intervals = [];
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      step: (results) => {
        const row = normalizeRow(results.data, sourceColumnMap);
        const interval = extractInterval(row, sourceColumnMap);
        if (!interval) return;
        if (`${interval.holeId}`.trim() !== wanted) return;
        intervals.push(interval);
      },
      complete: () => {
        if (!intervals.length) {
          resolve(null);
          return;
        }
        const hole = intervalsToHole(wanted, intervals);
        resolve(hole);
      },
      error: (error) => reject(withDataErrorContext('parseAssayHole', error))
    });
  });
}

/**
 * Parse complete assay CSV file with all holes and intervals (eager load)
 * @param {File|Blob} file - Assay CSV file
 * @param {Object|null} config - Optional configuration (unused, for backwards compatibility)
 * @param {Object|null} sourceColumnMap - Optional column name mappings
 * @returns {Promise<{holes: Array<Object>}>} Object containing array of all holes with intervals
 */
export function parseAssaysCSV(file, config = null, sourceColumnMap = null) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        const byHole = new Map();
        results.data.forEach((rawRow) => {
          const row = normalizeRow(rawRow, sourceColumnMap);
          const interval = extractInterval(row, sourceColumnMap);
          if (!interval) return;
          if (!byHole.has(interval.holeId)) byHole.set(interval.holeId, []);
          byHole.get(interval.holeId).push(interval);
        });

        const holes = Array.from(byHole.entries()).map(([hid, intervals]) => intervalsToHole(hid, intervals));
        resolve({ holes });
      },
      error: (error) => reject(withDataErrorContext('parseAssaysCSV', error))
    });
  });
}
