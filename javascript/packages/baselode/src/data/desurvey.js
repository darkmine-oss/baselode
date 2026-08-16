/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { standardizeColumns } from './keying.js';
import { withDataErrorContext } from './dataErrorUtils.js';
import { HOLE_ID, LATITUDE, LONGITUDE, AZIMUTH, DIP, DEPTH, PROJECT_ID } from './datamodel.js';

/**
 * Normalize already-parsed survey rows.
 *
 * @param {Array<Object>} rows - Parsed survey row objects
 * @param {Object|null} sourceColumnMap - Optional column name mappings
 * @returns {Array<Object>} Valid normalized survey rows
 */
export function parseSurveyFromRows(rows, sourceColumnMap = null) {
  return (rows || [])
    .map((row) => normalizeRow(row, sourceColumnMap))
    .filter((row) => (
      row[HOLE_ID]
      && Number.isFinite(row[DEPTH])
      && Number.isFinite(row[DIP])
      && Number.isFinite(row[AZIMUTH])
    ));
}

/**
 * Parse survey CSV file containing downhole survey measurements.
 *
 * @param {File|Blob} file - Survey CSV file
 * @param {Object|null} sourceColumnMap - Optional column name mappings
 * @returns {Promise<Array<Object>>} Array of normalized survey rows
 */
export function parseSurveyCSV(file, sourceColumnMap = null) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => resolve(parseSurveyFromRows(results.data, sourceColumnMap)),
      error: (err) => reject(withDataErrorContext('parseSurveyCSV', err))
    });
  });
}

/**
 * Normalize a survey row to standardized field names.
 *
 * @private
 * @param {Object} row - Raw survey row
 * @param {Object|null} sourceColumnMap - Optional column mappings
 * @returns {Object} Normalized row with standardized field names
 */
function normalizeRow(row, sourceColumnMap = null) {
  const norm = standardizeColumns(row, null, sourceColumnMap);
  const holeId = norm[HOLE_ID];
  const project = norm[PROJECT_ID] || norm.project || norm.project_code;
  const lat = toNumber(norm[LATITUDE]);
  const lng = toNumber(norm[LONGITUDE]);
  const surveyDepth = toNumber(norm[DEPTH]);
  const dip = toNumber(norm[DIP]);
  const azimuth = toNumber(norm[AZIMUTH]);
  const maxDepth = toNumber(norm.maxdepth);

  return {
    raw: norm,
    [HOLE_ID]: holeId,
    [PROJECT_ID]: project,
    [LATITUDE]: lat,
    [LONGITUDE]: lng,
    [DEPTH]: surveyDepth,
    [DIP]: dip,
    [AZIMUTH]: azimuth,
    maxdepth: maxDepth,
    project_code: project,
    latitude: lat,
    longitude: lng,
    surveydepth: surveyDepth
  };
}

/**
 * Convert value to number, returning undefined if not finite.
 *
 * @private
 * @param {*} value - Value to convert
 * @returns {number|undefined} Finite number or undefined
 */
function toNumber(value) {
  if (value == null) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
