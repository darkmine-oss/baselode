/*
 * Copyright (C) 2026 Darkmine Pty Ltd
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
    // Canonical Walstrom 1969 / Harvey & Eppink 1972 form: average
    // direction cosines at the upper and lower stations, NOT the
    // cosines of averaged angles.  The two coincide on gentle doglegs
    // but diverge meaningfully on strong direction changes.  Matches
    // wellpathpy and PyGSLIB.
    const caAvg = 0.5 * (dc0.ca + dc1.ca);
    const cbAvg = 0.5 * (dc0.cb + dc1.cb);
    const ccAvg = 0.5 * (dc0.cc + dc1.cc);
    const azAvg = 0.5 * (az0 + az1);
    const dipAvg = 0.5 * (dip0 + dip1);
    return {
      dx: deltaMd * caAvg,
      dy: deltaMd * cbAvg,
      dz: deltaMd * ccAvg,
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
 * Look up trace position + orientation at arbitrary downhole depths.
 *
 * Linear interpolation per coordinate.  Accurate when the trace was
 * desurveyed at a small step so adjacent samples bracket the requested
 * depth tightly.  Depths outside a hole's trace range — or whose hole
 * isn't in `traces` at all — produce a row with `null` in every output
 * field except `hole_id` and `depth`.
 *
 * @param {Array<Object>} traces - Desurveyed trace rows (hole_id, md, x,
 *   y, z, azimuth, dip).
 * @param {(number|number[]|Object|Array<Object>)} depths - One of:
 *   a scalar applied to every hole; an array of numbers applied to every
 *   hole; `{hole_id: [d1, d2, ...]}` keyed by hole; or an array of
 *   `{hole_id, depth}` rows.
 * @returns {Array<Object>} One row per (hole_id, depth) request.
 */
export function interpolateTrajectory(
  traces,
  depths,
  {
    holeCol = 'hole_id',
    mdCol = 'md',
    eastingCol = 'x',
    northingCol = 'y',
    elevationCol = 'z',
    azimuthCol = 'azimuth',
    dipCol = 'dip',
  } = {},
) {
  const coordCols = [eastingCol, northingCol, elevationCol, azimuthCol, dipCol];
  const tracesByHole = new Map();
  for (const row of traces || []) {
    const hole = row && row[holeCol];
    if (hole == null) continue;
    if (!tracesByHole.has(hole)) tracesByHole.set(hole, []);
    tracesByHole.get(hole).push(row);
  }
  for (const [hole, rows] of tracesByHole) {
    const sorted = rows
      .filter((row) => Number.isFinite(Number(row[mdCol])))
      .sort((left, right) => Number(left[mdCol]) - Number(right[mdCol]));
    tracesByHole.set(hole, sorted);
  }

  const requests = _normalizeDepthRequests(depths, traces, holeCol);

  const nullPosition = (hole, depth) => ({
    [holeCol]: hole,
    depth,
    [eastingCol]: null,
    [northingCol]: null,
    [elevationCol]: null,
    [azimuthCol]: null,
    [dipCol]: null,
  });

  const out = [];
  for (const { hole, depth } of requests) {
    const traceForHole = tracesByHole.get(hole);
    if (!traceForHole || !traceForHole.length) {
      out.push(nullPosition(hole, depth));
      continue;
    }
    const mds = traceForHole.map((row) => Number(row[mdCol]));
    const minMd = mds[0];
    const maxMd = mds[mds.length - 1];
    if (depth < minMd || depth > maxMd) {
      out.push(nullPosition(hole, depth));
      continue;
    }
    const upperIdx = mds.findIndex((value) => value >= depth);
    if (upperIdx === -1) {
      out.push(nullPosition(hole, depth));
      continue;
    }
    if (upperIdx === 0 || mds[upperIdx] === depth) {
      const sample = traceForHole[upperIdx];
      const row = { [holeCol]: hole, depth };
      for (const col of coordCols) row[col] = Number(sample[col]);
      out.push(row);
      continue;
    }
    const lowerIdx = upperIdx - 1;
    const lower = traceForHole[lowerIdx];
    const upper = traceForHole[upperIdx];
    const mdLower = mds[lowerIdx];
    const mdUpper = mds[upperIdx];
    const fraction = (depth - mdLower) / (mdUpper - mdLower);
    const row = { [holeCol]: hole, depth };
    for (const col of coordCols) {
      const left = Number(lower[col]);
      const right = Number(upper[col]);
      row[col] = left + fraction * (right - left);
    }
    out.push(row);
  }
  return out;
}

function _normalizeDepthRequests(depths, traces, holeCol) {
  if (depths == null) return [];
  if (Array.isArray(depths)) {
    const firstEntry = depths[0];
    const isRowArray = depths.length
      && firstEntry
      && typeof firstEntry === 'object'
      && firstEntry[holeCol] != null
      && firstEntry.depth != null;
    if (isRowArray) {
      return depths
        .filter((row) => row && row[holeCol] != null && row.depth != null)
        .map((row) => ({ hole: row[holeCol], depth: Number(row.depth) }));
    }
    const broadcastHoles = [...new Set(
      (traces || []).map((row) => row && row[holeCol]).filter((value) => value != null),
    )];
    const requests = [];
    for (const hole of broadcastHoles) {
      for (const depth of depths) {
        requests.push({ hole, depth: Number(depth) });
      }
    }
    return requests;
  }
  if (typeof depths === 'number') {
    const broadcastHoles = [...new Set(
      (traces || []).map((row) => row && row[holeCol]).filter((value) => value != null),
    )];
    return broadcastHoles.map((hole) => ({ hole, depth: Number(depths) }));
  }
  if (depths && typeof depths === 'object') {
    const requests = [];
    for (const [hole, values] of Object.entries(depths)) {
      if (values == null) continue;
      const list = Array.isArray(values) ? values : [values];
      for (const depth of list) {
        requests.push({ hole, depth: Number(depth) });
      }
    }
    return requests;
  }
  return [];
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