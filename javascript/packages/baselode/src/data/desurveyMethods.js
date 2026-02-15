/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { withDataErrorContext } from './dataErrorUtils.js';
/**
 * Convert value to number with optional fallback
 * @private
 */function toNumber(value, fallback = undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Normalize hole ID value to trimmed string
 * @private
 */
function normalizeHoleIdValue(value) {
  if (value === undefined || value === null) return '';
  return `${value}`.trim();
}

/**
 * Canonicalize hole ID column across rows with varying column names
 * @private
 */
function canonicalizeHoleIdRows(rows = [], holeIdCol = null) {
  const preferred = holeIdCol || 'hole_id';
  const candidates = [preferred, 'hole_id', 'holeId', 'id'];
  const resolved = candidates.find((col) => rows.some((row) => normalizeHoleIdValue(row?.[col])));
  if (!resolved) {
    throw withDataErrorContext('canonicalizeHoleIdRows', new Error(`hole id column '${preferred}' not found`));
  }
  return {
    aliasCol: resolved,
    rows: rows.map((row) => ({
      ...row,
      hole_id: normalizeHoleIdValue(row?.[resolved])
    }))
  };
}

/**
 * Convert degrees to radians
 * @private
 */
function degToRad(angle) {
  return (Number(angle) * Math.PI) / 180;
}

/**
 * Calculate direction cosines from azimuth and dip
 * @private
 */
function directionCosines(azimuth, dip) {
  const azRad = degToRad(azimuth);
  const dipRad = degToRad(dip);
  const ca = Math.cos(dipRad) * Math.sin(azRad);
  const cb = Math.cos(dipRad) * Math.cos(azRad);
  const cc = Math.sin(dipRad) * -1;
  return { ca, cb, cc };
}

/**
 * Calculate displacement vector for a survey segment using specified method
 * @private
 */
function segmentDisplacement(deltaMd, az0, dip0, az1, dip1, method = 'minimum_curvature') {
  const dc0 = directionCosines(az0, dip0);
  const dc1 = directionCosines(az1, dip1);

  if (method === 'tangential') {
    return {
      dx: deltaMd * dc0.ca,
      dy: deltaMd * dc0.cb,
      dz: deltaMd * dc0.cc,
      azimuth: az0,
      dip: dip0
    };
  }

  if (method === 'balanced_tangential') {
    const azAvg = 0.5 * (az0 + az1);
    const dipAvg = 0.5 * (dip0 + dip1);
    const dcAvg = directionCosines(azAvg, dipAvg);
    return {
      dx: deltaMd * dcAvg.ca,
      dy: deltaMd * dcAvg.cb,
      dz: deltaMd * dcAvg.cc,
      azimuth: azAvg,
      dip: dipAvg
    };
  }

  const dot = (dc0.ca * dc1.ca) + (dc0.cb * dc1.cb) + (dc0.cc * dc1.cc);
  const dogleg = Math.acos(Math.max(-1, Math.min(1, dot)));
  const rf = dogleg > 1e-6 ? (2 * Math.tan(dogleg / 2)) / dogleg : 1;

  return {
    dx: 0.5 * deltaMd * (dc0.ca + dc1.ca) * rf,
    dy: 0.5 * deltaMd * (dc0.cb + dc1.cb) * rf,
    dz: 0.5 * deltaMd * (dc0.cc + dc1.cc) * rf,
    azimuth: az1,
    dip: dip1
  };
}

function desurvey(rowsCollars = [], rowsSurveys = [], options = {}) {
  const {
    step = 1,
    holeIdCol = null,
    method = 'minimum_curvature'
  } = options;

  const safeStep = Number.isFinite(Number(step)) && Number(step) > 0 ? Number(step) : 1;

  const collarsCanonical = canonicalizeHoleIdRows(rowsCollars, holeIdCol);
  const surveysCanonical = canonicalizeHoleIdRows(rowsSurveys, holeIdCol || collarsCanonical.aliasCol);

  if (!collarsCanonical.rows.length || !surveysCanonical.rows.length) return [];

  const collarsByHole = new Map();
  collarsCanonical.rows.forEach((row) => {
    if (!row.hole_id || collarsByHole.has(row.hole_id)) return;
    collarsByHole.set(row.hole_id, row);
  });

  const surveysByHole = new Map();
  surveysCanonical.rows.forEach((row) => {
    if (!row.hole_id) return;
    if (!surveysByHole.has(row.hole_id)) surveysByHole.set(row.hole_id, []);
    surveysByHole.get(row.hole_id).push(row);
  });

  const out = [];
  surveysByHole.forEach((stations, holeId) => {
    const collar = collarsByHole.get(holeId);
    if (!collar) return;

    const sorted = [...stations]
      .map((row) => ({
        ...row,
        from: toNumber(row.from),
        azimuth: toNumber(row.azimuth),
        dip: toNumber(row.dip)
      }))
      .filter((row) => Number.isFinite(row.from) && Number.isFinite(row.azimuth) && Number.isFinite(row.dip))
      .sort((a, b) => a.from - b.from);

    if (!sorted.length) return;

    let x = toNumber(collar.x, 0);
    let y = toNumber(collar.y, 0);
    let z = toNumber(collar.z, 0);
    let mdCursor = sorted[0].from;
    const azPrev = sorted[0].azimuth;
    const dipPrev = sorted[0].dip;

    const firstRecord = {
      hole_id: holeId,
      md: mdCursor,
      x,
      y,
      z,
      azimuth: azPrev,
      dip: dipPrev
    };

    if (collarsCanonical.aliasCol !== 'hole_id' && collar[collarsCanonical.aliasCol] !== undefined) {
      firstRecord[collarsCanonical.aliasCol] = collar[collarsCanonical.aliasCol];
    }
    out.push(firstRecord);

    for (let idx = 0; idx < sorted.length - 1; idx += 1) {
      const s0 = sorted[idx];
      const s1 = sorted[idx + 1];
      const md0 = s0.from;
      const md1 = s1.from;
      const deltaMd = md1 - md0;
      if (deltaMd <= 0) continue;

      const segmentSteps = Math.max(1, Math.ceil(deltaMd / safeStep));
      const mdIncrement = deltaMd / segmentSteps;

      for (let stepIdx = 0; stepIdx < segmentSteps; stepIdx += 1) {
        mdCursor += mdIncrement;
        const weight = (mdCursor - md0) / deltaMd;
        const azInterp = s0.azimuth + weight * (s1.azimuth - s0.azimuth);
        const dipInterp = s0.dip + weight * (s1.dip - s0.dip);

        const disp = segmentDisplacement(mdIncrement, s0.azimuth, s0.dip, s1.azimuth, s1.dip, method);
        x += disp.dx;
        y += disp.dy;
        z += disp.dz;

        const record = {
          hole_id: holeId,
          md: mdCursor,
          x,
          y,
          z,
          azimuth: method === 'minimum_curvature' ? azInterp : disp.azimuth,
          dip: method === 'minimum_curvature' ? dipInterp : disp.dip
        };

        if (collarsCanonical.aliasCol !== 'hole_id' && collar[collarsCanonical.aliasCol] !== undefined) {
          record[collarsCanonical.aliasCol] = collar[collarsCanonical.aliasCol];
        }
        out.push(record);
      }
    }
  });

  return out;
}

/**
 * Desurvey drillholes using minimum curvature method
 * @param {Array<Object>} collars - Collar data with hole_id, lat, lng
 * @param {Array<Object>} surveys - Survey data with hole_id, depth, azimuth, dip
 * @param {Object} options - Desurvey options
 * @returns {Array<Object>} Desurveyed trace points with x, y, z, md coordinates
 */
export function minimumCurvatureDesurvey(collars, surveys, options = {}) {
  return desurvey(collars, surveys, { ...options, method: 'minimum_curvature' });
}

/**
 * Desurvey drillholes using tangential method
 * @param {Array<Object>} collars - Collar data
 * @param {Array<Object>} surveys - Survey data
 * @param {Object} options - Desurvey options
 * @returns {Array<Object>} Desurveyed trace points
 */
export function tangentialDesurvey(collars, surveys, options = {}) {
  return desurvey(collars, surveys, { ...options, method: 'tangential' });
}

/**
 * Desurvey drillholes using balanced tangential method
 * @param {Array<Object>} collars - Collar data
 * @param {Array<Object>} surveys - Survey data
 * @param {Object} options - Desurvey options
 * @returns {Array<Object>} Desurveyed trace points
 */
export function balancedTangentialDesurvey(collars, surveys, options = {}) {
  return desurvey(collars, surveys, { ...options, method: 'balanced_tangential' });
}

/**
 * Build desurveyed traces using minimum curvature method (alias for minimumCurvatureDesurvey)
 * @param {Array<Object>} collars - Collar data
 * @param {Array<Object>} surveys - Survey data
 * @param {Object} options - Desurvey options
 * @returns {Array<Object>} Desurveyed trace points
 */
export function buildTraces(collars, surveys, options = {}) {
  return minimumCurvatureDesurvey(collars, surveys, options);
}

/**
 * Find nearest trace point by measured depth
 * @private
 */
function nearestByMeasuredDepth(traceRows, midMd) {
  if (!traceRows.length || !Number.isFinite(midMd)) return null;
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < traceRows.length; i += 1) {
    const row = traceRows[i];
    const md = toNumber(row.md);
    if (!Number.isFinite(md)) continue;
    const dist = Math.abs(md - midMd);
    if (dist < bestDist) {
      bestDist = dist;
      best = row;
    }
  }
  return best;
}

/**
 * Attach 3D position data from desurveyed traces to assay intervals
 * Finds nearest trace point by mid-depth of each assay interval
 * @param {Array<Object>} assays - Assay data with hole_id, from, to
 * @param {Array<Object>} traces - Desurveyed trace data with hole_id, md, x, y, z
 * @param {Object} options - Options
 * @param {string} options.holeIdCol - Hole ID column name (default: 'hole_id')
 * @returns {Array<Object>} Assay rows enriched with x, y, z, md, azimuth, dip from nearest trace point
 */
export function attachAssayPositions(assays = [], traces = [], options = {}) {
  const holeIdCol = options.holeIdCol || 'hole_id';
  const assaysCanonical = canonicalizeHoleIdRows(assays, holeIdCol);
  const tracesCanonical = canonicalizeHoleIdRows(traces, holeIdCol);

  if (!assaysCanonical.rows.length || !tracesCanonical.rows.length) return [...assaysCanonical.rows];

  const tracesByHole = new Map();
  tracesCanonical.rows.forEach((row) => {
    if (!row.hole_id) return;
    if (!tracesByHole.has(row.hole_id)) tracesByHole.set(row.hole_id, []);
    tracesByHole.get(row.hole_id).push(row);
  });
  tracesByHole.forEach((rows, holeId) => {
    tracesByHole.set(holeId, [...rows].sort((a, b) => toNumber(a.md, 0) - toNumber(b.md, 0)));
  });

  return assaysCanonical.rows.map((assay) => {
    const from = toNumber(assay.from);
    const to = toNumber(assay.to);
    const midMd = Number.isFinite(from) && Number.isFinite(to) ? 0.5 * (from + to) : undefined;
    if (!assay.hole_id || !Number.isFinite(midMd)) return { ...assay };

    const nearest = nearestByMeasuredDepth(tracesByHole.get(assay.hole_id) || [], midMd);
    if (!nearest) return { ...assay };

    const merged = { ...assay };
    ['md', 'x', 'y', 'z', 'azimuth', 'dip'].forEach((key) => {
      if (nearest[key] === undefined) return;
      if (Object.prototype.hasOwnProperty.call(merged, key)) {
        merged[`${key}_trace`] = nearest[key];
      } else {
        merged[key] = nearest[key];
      }
    });
    return merged;
  });
}