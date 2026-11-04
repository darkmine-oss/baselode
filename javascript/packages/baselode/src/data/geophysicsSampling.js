/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Read raster values at points, table rows and along profile lines.
// Mirrors Python's baselode.geophysics.sampling; both are checked against
// the `sampling` cases in test/data/geophysics_reference.json.

import { createGeophysicsRaster, getGeophysicsRasterBand } from './geophysicsRaster.js';
import { normaliseCrs, transformPoints } from '../extent/crs.js';

export const GEOPHYSICS_SAMPLING_METHODS = Object.freeze(['bilinear', 'nearest']);

// Pixel positions within this fraction of a cell of a cell centre or grid
// edge snap to it.  Inverting the affine transform at projected coordinates
// (around 1e7 m) leaves rounding errors of about 1e-10 cells, which would
// otherwise make a point on a cell centre depend on (and become missing
// because of) a neighbouring cell, or fall just outside the grid.
const PIXEL_TOLERANCE = 1e-7;

function snap(fraction) {
  if (fraction < PIXEL_TOLERANCE) return 0;
  if (fraction > 1 - PIXEL_TOLERANCE) return 1;
  return fraction;
}

function asRaster(raster) {
  return raster?.bandCount ? raster : createGeophysicsRaster(raster);
}

function checkMethod(method) {
  if (!GEOPHYSICS_SAMPLING_METHODS.includes(method)) {
    throw new RangeError(`method must be one of ${GEOPHYSICS_SAMPLING_METHODS.join(', ')}; received ${JSON.stringify(method)}`);
  }
}

function toNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return NaN;
  return Number(value);
}

function toPair(point) {
  if (Array.isArray(point)) return [toNumber(point[0]), toNumber(point[1])];
  if (point && typeof point === 'object') return [toNumber(point.x), toNumber(point.y)];
  return [NaN, NaN];
}

function reproject(pairs, crs, raster) {
  if (crs === undefined || crs === null) return pairs;
  if (!raster.crs) {
    throw new Error(
      "the raster has no CRS, so points given with crs cannot be reprojected onto it; set the raster's crs or pass points already in its coordinates",
    );
  }
  if (normaliseCrs(crs) === normaliseCrs(raster.crs)) return pairs;
  return transformPoints(crs, raster.crs, pairs);
}

function isValid(value, nodata) {
  return value !== null && value !== undefined && Number.isFinite(value) && value !== nodata;
}

/**
 * Sample one raster band at map coordinates.
 *
 * Cell values sit at cell centres.  `bilinear` interpolates between the four
 * surrounding centres and returns `null` if any contributing cell is missing;
 * within half a cell of the edge the edge cells are used without
 * extrapolation.  `nearest` returns the containing cell's value.  Points
 * outside the grid give `null`.
 *
 * @param {object} raster - Raster object or payload (see createGeophysicsRaster).
 * @param {Array<[number, number]|{x: number, y: number}>} points
 * @param {object} [options]
 * @param {number} [options.band=1] - One-based band number.
 * @param {'bilinear'|'nearest'} [options.method='bilinear']
 * @param {string|number} [options.crs] - CRS of the points.  When it differs
 *   from the raster's they are reprojected first (see extent/crs.js for the
 *   built-in systems).
 * @returns {Array<number|null>}
 */
export function sampleGeophysicsRaster(raster, points, { band = 1, method = 'bilinear', crs } = {}) {
  checkMethod(method);
  const normalized = asRaster(raster);
  const transform = normalized.transform;
  if (!transform) throw new Error('the raster has no transform, so map coordinates cannot be sampled');
  const [a, b, c, d, e, f] = transform;
  const determinant = a * e - b * d;
  if (determinant === 0) throw new Error('the raster transform is not invertible');
  const values = getGeophysicsRasterBand(normalized, band);
  const { width, height, nodata } = normalized;
  const pairs = reproject(points.map(toPair), crs, normalized);

  return pairs.map(([x, y]) => {
    const dx = x - c;
    const dy = y - f;
    const column = (e * dx - b * dy) / determinant;
    const row = (-d * dx + a * dy) / determinant;
    if (!(column >= -PIXEL_TOLERANCE && column <= width + PIXEL_TOLERANCE
      && row >= -PIXEL_TOLERANCE && row <= height + PIXEL_TOLERANCE)) return null;

    if (method === 'nearest') {
      const i = Math.min(Math.max(Math.floor(row), 0), height - 1);
      const j = Math.min(Math.max(Math.floor(column), 0), width - 1);
      const value = values[i][j];
      return isValid(value, nodata) ? value : null;
    }

    const u = Math.min(Math.max(column - 0.5, 0), width - 1);
    const v = Math.min(Math.max(row - 0.5, 0), height - 1);
    const j0 = Math.floor(u);
    const i0 = Math.floor(v);
    const j1 = Math.min(j0 + 1, width - 1);
    const i1 = Math.min(i0 + 1, height - 1);
    const tx = snap(u - j0);
    const ty = snap(v - i0);
    let total = 0;
    for (const [i, j, weight] of [
      [i0, j0, (1 - tx) * (1 - ty)],
      [i0, j1, tx * (1 - ty)],
      [i1, j0, (1 - tx) * ty],
      [i1, j1, tx * ty],
    ]) {
      if (weight <= 0) continue;
      const value = values[i][j];
      if (!isValid(value, nodata)) return null;
      total += weight * value;
    }
    return total;
  });
}

/**
 * Add raster values to row objects, such as collars, surface samples or
 * desurveyed trace stations.
 *
 * @param {object} raster
 * @param {object[]} rows - Not modified.
 * @param {object} [options]
 * @param {string} [options.xField='easting']
 * @param {string} [options.yField='northing']
 * @param {string} [options.field] - Output field; defaults to the band name.
 * @param {number} [options.band=1]
 * @param {'bilinear'|'nearest'} [options.method='bilinear']
 * @param {string|number} [options.crs] - CRS of the coordinate fields.
 * @returns {object[]} New row objects with the sampled value (`null` where there is none).
 */
export function sampleGeophysicsRows(raster, rows, {
  xField = 'easting', yField = 'northing', field, band = 1, method = 'bilinear', crs,
} = {}) {
  const normalized = asRaster(raster);
  const name = field ?? normalized.bandNames[band - 1];
  const values = sampleGeophysicsRaster(
    normalized,
    rows.map((row) => [toNumber(row?.[xField]), toNumber(row?.[yField])]),
    { band, method, crs },
  );
  return rows.map((row, index) => ({ ...row, [name]: values[index] }));
}

/**
 * Regularly spaced stations along a polyline.  Stations start at the first
 * vertex, step by `spacing` through bends, and always include the last vertex.
 *
 * @param {Array<[number, number]|{x: number, y: number}>} vertices - At least two points.
 * @param {number} spacing - In the vertex units.
 * @returns {Array<{distance: number, x: number, y: number}>}
 */
export function geophysicsProfileStations(vertices, spacing) {
  const step = Number(spacing);
  if (!(Number.isFinite(step) && step > 0)) throw new RangeError('spacing must be a positive number');
  if (!Array.isArray(vertices) || vertices.length < 2) {
    throw new RangeError('vertices must contain at least two points');
  }
  const raw = vertices.map(toPair);
  if (raw.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) {
    throw new RangeError('vertices must be finite');
  }
  const points = [raw[0]];
  const lengths = [];
  for (let index = 1; index < raw.length; index += 1) {
    const [px, py] = points[points.length - 1];
    const length = Math.hypot(raw[index][0] - px, raw[index][1] - py);
    if (length > 0) {
      points.push(raw[index]);
      lengths.push(length);
    }
  }
  if (lengths.length === 0) throw new RangeError('the profile line has zero length');
  const cumulative = [0];
  for (const length of lengths) cumulative.push(cumulative[cumulative.length - 1] + length);
  const total = cumulative[cumulative.length - 1];
  const count = Math.floor(total / step + 1e-9);
  const distances = Array.from({ length: count + 1 }, (_, index) => index * step);
  if (total - distances[distances.length - 1] > 1e-9 * Math.max(total, 1)) distances.push(total);
  else distances[distances.length - 1] = Math.min(distances[distances.length - 1], total);

  let segment = 0;
  return distances.map((distance) => {
    while (segment < lengths.length - 1 && cumulative[segment + 1] <= distance) segment += 1;
    const fraction = (distance - cumulative[segment]) / lengths[segment];
    const [x0, y0] = points[segment];
    const [x1, y1] = points[segment + 1];
    return { distance, x: x0 + fraction * (x1 - x0), y: y0 + fraction * (y1 - y0) };
  });
}

/**
 * Sample a raster along a polyline, such as a section line.
 *
 * @param {object} raster
 * @param {Array<[number, number]|{x: number, y: number}>} vertices - In `crs` when given.
 * @param {object} options
 * @param {number} options.spacing - Station spacing in the vertex units.  Use a
 *   projected CRS (metres) for the line; lat/long lines are spaced in degrees.
 * @param {number} [options.band=1]
 * @param {'bilinear'|'nearest'} [options.method='bilinear']
 * @param {string|number} [options.crs] - CRS of the vertices.
 * @returns {Array<{distance: number, x: number, y: number, value: number|null}>}
 *   `x`/`y` stay in the line's CRS.
 */
export function sampleGeophysicsProfile(raster, vertices, { spacing, band = 1, method = 'bilinear', crs } = {}) {
  const stations = geophysicsProfileStations(vertices, spacing);
  const values = sampleGeophysicsRaster(raster, stations.map(({ x, y }) => [x, y]), { band, method, crs });
  return stations.map((station, index) => ({ ...station, value: values[index] }));
}
