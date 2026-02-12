/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { primaryFieldFromConfig, resolvePrimaryId } from './keying.js';

const COLLAR_CACHE_KEY = 'baselode-collars-cache-v1';
const SURVEY_CACHE_KEY = 'baselode-survey-cache-v1';
const DESURVEY_CACHE_KEY = 'baselode-desurvey-cache-v1';

export function loadCachedCollars() {
  try {
    const raw = localStorage.getItem(COLLAR_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) =>
      Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.project && p.holeId
    );
  } catch (e) {
    console.warn('Failed to read cached collars', e);
    return [];
  }
}

export function saveCachedSurvey(rows) {
  try {
    localStorage.setItem(SURVEY_CACHE_KEY, JSON.stringify(rows || []));
  } catch (e) {
    console.warn('Failed to cache survey', e);
  }
}

export function loadCachedSurvey() {
  try {
    const raw = localStorage.getItem(SURVEY_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('Failed to read cached survey', e);
    return [];
  }
}

export function saveCachedDesurveyed(holes) {
  try {
    localStorage.setItem(DESURVEY_CACHE_KEY, JSON.stringify(holes || []));
  } catch (e) {
    console.warn('Failed to cache desurveyed holes', e);
  }
}

export function loadCachedDesurveyed() {
  try {
    const raw = localStorage.getItem(DESURVEY_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('Failed to read cached desurveyed holes', e);
    return [];
  }
}

export function parseSurveyCSV(file, config) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data
          .map((row) => normalizeRow(row, config))
          .filter((row) => row.hole_id && Number.isFinite(row.surveydepth) && Number.isFinite(row.dip) && Number.isFinite(row.azimuth));
        resolve(rows);
      },
      error: (err) => reject(err)
    });
  });
}

function normalizeRow(row, config) {
  const norm = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    if (!key) return;
    const k = key.trim().toLowerCase();
    norm[k] = value;
  });

  const primaryField = primaryFieldFromConfig(config);
  const primaryId = resolvePrimaryId(norm, primaryField);
  const holeId = pick(norm, ['hole_id', 'holeid', 'id']);
  const project = pick(norm, ['project_code', 'project']);
  const lat = toNumber(pick(norm, ['latitude', 'lat']));
  const lng = toNumber(pick(norm, ['longitude', 'lon', 'lng']));
  const surveyDepth = toNumber(norm.surveydepth ?? norm.depth);
  const dip = toNumber(norm.dip);
  const azimuth = toNumber(norm.azimuth);
  const maxDepth = toNumber(norm.maxdepth);

  return {
    raw: norm,
    hole_id: holeId,
    primary_id: primaryId,
    project_code: project,
    latitude: lat,
    longitude: lng,
    surveydepth: surveyDepth,
    dip,
    azimuth,
    maxdepth: maxDepth
  };
}

const pick = (obj, keys) => {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && `${obj[key]}`.trim() !== '') return obj[key];
  }
  return undefined;
};

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// Minimum curvature desurvey; returns array of {id, project, points:[{x,y,z,md,azimuth,dip}...]}
export function desurveyTraces(collars, surveys, config) {
  const primaryField = primaryFieldFromConfig(config);
  const collarByKey = new Map();
  collars.forEach((c) => {
    const primaryId = (c.primaryId || c.holeId || c.id || '').toString().trim().toLowerCase();
    if (!primaryId) return;
    if (!collarByKey.has(primaryId)) {
      collarByKey.set(primaryId, c);
    }
  });

  const refLat = collars[0]?.lat ?? 0;
  const refLng = collars[0]?.lng ?? 0;
  const refMetersPerDegLat = 111132;
  const refMetersPerDegLon = 111320 * Math.cos((refLat * Math.PI) / 180);

  const grouped = new Map();
  surveys.forEach((s) => {
    const primaryId = (s.primary_id || s.hole_id || '').toString().trim().toLowerCase();
    if (!primaryId) return;
    if (!grouped.has(primaryId)) grouped.set(primaryId, []);
    grouped.get(primaryId).push(s);
  });

  const holes = [];
  grouped.forEach((stations, key) => {
    const collar = collarByKey.get(key);
    if (!collar) return;
    const sorted = stations
      .filter((s) => Number.isFinite(s.surveydepth))
      .sort((a, b) => a.surveydepth - b.surveydepth);
    if (!sorted.length) return;

    const lat0 = collar.lat;
    const lng0 = collar.lng;
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
      if (!prev) {
        points.push({
          x: baseX + accX,
          y: baseY + accY,
          z: 0,
          md: curr.surveydepth,
          azimuth: curr.azimuth,
          dip: curr.dip
        });
        continue;
      }

      const deltaMD = curr.surveydepth - prev.surveydepth;
      if (deltaMD <= 0) continue;

      const inc1 = toInclination(prev.dip);
      const inc2 = toInclination(curr.dip);
      const az1 = degToRad(prev.azimuth);
      const az2 = degToRad(curr.azimuth);

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
        md: curr.surveydepth,
        azimuth: curr.azimuth,
        dip: curr.dip
      });
    }

    // convert local meters back to approx lat/lon for map overlay if needed
    const pointsWithGeo = points.map((p) => ({
      ...p,
      lat: lat0 + (p.y / metersPerDegLat),
      lng: lng0 + (p.x / metersPerDegLon)
    }));

    holes.push({
      id: collar.primaryId || collar.holeId || key,
      project: collar.project,
      points: pointsWithGeo,
      collar
    });
  });

  return holes;
}

const degToRad = (d) => (d * Math.PI) / 180;

// Dip is given as negative downward from horizontal; convert to inclination from vertical (0 = vertical)
const toInclination = (dipDeg) => {
  const val = Number(dipDeg);
  const incDeg = 90 + (Number.isFinite(val) ? val : 0); // dip -60 => inc 30
  const clamped = Math.min(180, Math.max(0, incDeg));
  return degToRad(clamped);
};
