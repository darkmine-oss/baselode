/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { standardizeColumns } from './keying.js';
import { withDataErrorContext } from './dataErrorUtils.js';
import { HOLE_ID, LATITUDE, LONGITUDE, AZIMUTH, DIP, DEPTH, PROJECT_ID } from './datamodel.js';

/**
 * Parse survey CSV file containing downhole survey measurements
 * Expected columns: hole_id, depth, azimuth, dip
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
      complete: (results) => {
        const rows = results.data
          .map((row) => normalizeRow(row, sourceColumnMap))
          .filter((row) => row[HOLE_ID] && Number.isFinite(row[DEPTH]) && Number.isFinite(row[DIP]) && Number.isFinite(row[AZIMUTH]));
        resolve(rows);
      },
      error: (err) => reject(withDataErrorContext('parseSurveyCSV', err))
    });
  });
}

/**
 * Normalize a survey row to standardized field names
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
    // Legacy field names for backwards compatibility
    project_code: project,
    latitude: lat,
    longitude: lng,
    surveydepth: surveyDepth
  };
}

/**
 * Convert value to number, returning undefined if not finite
 * @private
 * @param {*} v - Value to convert
 * @returns {number|undefined} Finite number or undefined
 */
const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Desurvey drillhole traces using minimum curvature method
 * Converts survey measurements (azimuth, dip, depth) to 3D coordinates (x, y, z)
 * @param {Array<Object>} collars - Array of collar objects with location data
 * @param {Array<Object>} surveys - Array of survey measurement objects
 * @returns {Array<{id: string, project: string, points: Array<{x: number, y: number, z: number, md: number, azimuth: number, dip: number, lat: number, lng: number}>, collar: Object}>} Array of desurveyed holes with 3D points
 */
export function desurveyTraces(collars, surveys) {
  const collarByKey = new Map();
  collars.forEach((c) => {
    const holeId = (c[HOLE_ID] || c.holeId || c.id || '').toString().trim();
    if (!holeId) return;
    const key = holeId.toLowerCase();
    if (!collarByKey.has(key)) {
      collarByKey.set(key, c);
    }
  });

  const refLat = collars[0]?.lat ?? collars[0]?.[LATITUDE] ?? 0;
  const refLng = collars[0]?.lng ?? collars[0]?.[LONGITUDE] ?? 0;
  const refMetersPerDegLat = 111132;
  const refMetersPerDegLon = 111320 * Math.cos((refLat * Math.PI) / 180);

  const grouped = new Map();
  surveys.forEach((s) => {
    const holeId = (s[HOLE_ID] || '').toString().trim();
    if (!holeId) return;
    const key = holeId.toLowerCase();
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(s);
  });

  const holes = [];
  grouped.forEach((stations, key) => {
    const collar = collarByKey.get(key);
    if (!collar) return;
    const sorted = stations
      .filter((s) => Number.isFinite(s[DEPTH] ?? s.surveydepth))
      .sort((a, b) => (a[DEPTH] ?? a.surveydepth) - (b[DEPTH] ?? b.surveydepth));
    if (!sorted.length) return;

    const lat0 = collar.lat ?? collar[LATITUDE];
    const lng0 = collar.lng ?? collar[LONGITUDE];
    const metersPerDegLat = 111132;
    const metersPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
    const baseX = (lng0 - refLng) * refMetersPerDegLon;
    const baseY = (lat0 - refLat) * refMetersPerDegLat;

    const points = [];
    let accX = 0;
    let accY = 0;
    let accZ = 0;

    for (let i = 0; i < sorted.length; i += 1) {
      const curr = sorted[i];
      const prev = sorted[i - 1];
      const currDepth = curr[DEPTH] ?? curr.surveydepth;
      const currAzimuth = curr[AZIMUTH] ?? curr.azimuth;
      const currDip = curr[DIP] ?? curr.dip;
      
      if (!prev) {
        points.push({
          x: baseX + accX,
          y: baseY + accY,
          z: 0,
          md: currDepth,
          azimuth: currAzimuth,
          dip: currDip
        });
        continue;
      }

      const prevDepth = prev[DEPTH] ?? prev.surveydepth;
      const prevAzimuth = prev[AZIMUTH] ?? prev.azimuth;
      const prevDip = prev[DIP] ?? prev.dip;
      
      const deltaMD = currDepth - prevDepth;
      if (deltaMD <= 0) continue;

      const inc1 = toInclination(prevDip);
      const inc2 = toInclination(currDip);
      const az1 = degToRad(prevAzimuth);
      const az2 = degToRad(currAzimuth);

      const beta = Math.acos(
        Math.sin(inc1) * Math.sin(inc2) * Math.cos(az1 - az2) +
          Math.cos(inc1) * Math.cos(inc2)
      );

      const rf = beta > 1e-6 ? (2 / beta) * Math.tan(beta / 2) : 1;

      const dx = 0.5 * deltaMD * (Math.sin(inc1) * Math.cos(az1) + Math.sin(inc2) * Math.cos(az2)) * rf;
      const dy = 0.5 * deltaMD * (Math.sin(inc1) * Math.sin(az1) + Math.sin(inc2) * Math.sin(az2)) * rf;
      const dzDown = 0.5 * deltaMD * (Math.cos(inc1) + Math.cos(inc2)) * rf; // down is positive

      accX += dx;
      accY += dy;
      accZ += dzDown;

      points.push({
        x: baseX + accX,
        y: baseY + accY,
        z: -accZ, // render with z up; depth down
        md: currDepth,
        azimuth: currAzimuth,
        dip: currDip
      });
    }

    // convert local meters back to approx lat/lon for map overlay if needed
    const pointsWithGeo = points.map((p) => ({
      ...p,
      lat: lat0 + (p.y / metersPerDegLat),
      lng: lng0 + (p.x / metersPerDegLon)
    }));

    holes.push({
      id: collar[HOLE_ID] || collar.holeId || key,
      project: collar[PROJECT_ID] || collar.project_id || collar.project || '',
      points: pointsWithGeo,
      collar
    });
  });

  return holes;
}

/**
 * Convert degrees to radians
 * @private
 * @param {number} d - Degrees
 * @returns {number} Radians
 */
const degToRad = (d) => (d * Math.PI) / 180;

/**
 * Convert dip (negative downward from horizontal) to inclination from vertical
 * @private
 * @param {number} dipDeg - Dip in degrees (negative = downward)
 * @returns {number} Inclination in radians from vertical (0 = vertical down)
 */
const toInclination = (dipDeg) => {
  const val = Number(dipDeg);
  const incDeg = 90 + (Number.isFinite(val) ? val : 0); // dip -60 => inc 30
  const clamped = Math.min(180, Math.max(0, incDeg));
  return degToRad(clamped);
};
