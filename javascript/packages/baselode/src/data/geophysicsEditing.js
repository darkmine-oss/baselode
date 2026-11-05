/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Crop, clip, combine and gap-fill geophysics rasters.  Mirrors Python's
// baselode.geophysics.editing step for step; both are checked against the
// `editing` cases in test/data/geophysics_reference.json.  Results are new
// rasters with missing cells as null, `nodata: null`, and a step appended to
// `metadata.processing` using Python's record names.

import { appendInput } from './geophysicsProvenance.js';
import { createGeophysicsRaster } from './geophysicsRaster.js';
import { canonicalCrs } from './geophysicsWriters.js';

export const GEOPHYSICS_COMBINE_OPERATIONS = Object.freeze(['add', 'subtract', 'multiply', 'divide']);

// Pixel positions within this fraction of a cell of a cell edge snap to it
// (as in sampling), so a bound on a cell edge never adds the neighbour.
const PIXEL_TOLERANCE = 1e-7;
// Over-relaxation factor for the gap-fill smoothing passes.
const RELAXATION = 1.6;

function asRaster(raster) {
  return raster?.bandCount ? raster : createGeophysicsRaster(raster);
}

function isValid(value, nodata) {
  return value !== null && value !== undefined && Number.isFinite(value) && value !== nodata;
}

/** Bands as row-major Float64Arrays with NaN for missing cells. */
function floatBands(raster) {
  return raster.data.map((band) => {
    const values = new Float64Array(raster.width * raster.height);
    band.forEach((row, i) => row.forEach((value, j) => {
      values[i * raster.width + j] = isValid(value, raster.nodata) ? value : NaN;
    }));
    return values;
  });
}

function toRows(values, width, height, rowOffset = 0, columnOffset = 0, columns = width, rows = height) {
  return Array.from({ length: rows }, (_, i) => Array.from({ length: columns }, (__, j) => {
    const value = values[(i + rowOffset) * width + j + columnOffset];
    return Number.isFinite(value) ? value : null;
  }));
}

function withStep(raster, data, step, changes = {}) {
  return createGeophysicsRaster({
    data,
    transform: changes.transform ?? raster.transform,
    crs: raster.crs,
    nodata: 'nodata' in changes ? changes.nodata : null,
    bandNames: raster.bandNames,
    metadata: {
      ...(changes.metadata ?? raster.metadata),
      processing: [...(raster.metadata.processing ?? []), step],
    },
  });
}

function requireTransform(raster) {
  const [a, b, , d, e] = raster.transform;
  if (a * e - b * d === 0) throw new Error('the raster transform is not invertible');
  return raster.transform;
}

function pixel([a, b, c, d, e, f], x, y) {
  const determinant = a * e - b * d;
  const dx = x - c;
  const dy = y - f;
  return [(e * dx - b * dy) / determinant, (-d * dx + a * dy) / determinant];
}

/** `[columnOffset, rowOffset, columns, rows]` covering a box, or null. */
function windowFor(raster, minX, minY, maxX, maxY) {
  const transform = requireTransform(raster);
  const corners = [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]].map(([x, y]) => pixel(transform, x, y));
  const columns = corners.map(([column]) => column);
  const rows = corners.map(([, row]) => row);
  const firstColumn = Math.max(Math.floor(Math.min(...columns) + PIXEL_TOLERANCE), 0);
  const lastColumn = Math.min(Math.ceil(Math.max(...columns) - PIXEL_TOLERANCE), raster.width);
  const firstRow = Math.max(Math.floor(Math.min(...rows) + PIXEL_TOLERANCE), 0);
  const lastRow = Math.min(Math.ceil(Math.max(...rows) - PIXEL_TOLERANCE), raster.height);
  if (lastColumn <= firstColumn || lastRow <= firstRow) return null;
  return [firstColumn, firstRow, lastColumn - firstColumn, lastRow - firstRow];
}

function windowTransform([a, b, c, d, e, f], [columnOffset, rowOffset]) {
  return [a, b, a * columnOffset + b * rowOffset + c, d, e, d * columnOffset + e * rowOffset + f];
}

/**
 * Cut a raster down to the cells that overlap a box.
 *
 * Whole cells only, so the result can extend up to a cell beyond the box;
 * values and `nodata` are unchanged.  Matches Python's `crop`.
 *
 * @param {object} raster
 * @param {[number, number, number, number]} bounds - `[minX, minY, maxX, maxY]` in the raster's coordinates.
 * @returns {object} With a `{operation: 'crop', bounds, window}` step;
 *   `window` is `[columnOffset, rowOffset, columns, rows]`.
 */
export function cropGeophysicsRaster(raster, bounds) {
  const normalized = asRaster(raster);
  const box = Array.from(bounds ?? [], Number);
  if (box.length !== 4 || !box.every(Number.isFinite)) throw new RangeError('bounds must be four finite numbers');
  const [minX, minY, maxX, maxY] = box;
  if (minX > maxX || minY > maxY) throw new RangeError('bounds must be [minX, minY, maxX, maxY]');
  const window = windowFor(normalized, minX, minY, maxX, maxY);
  if (!window) throw new RangeError('bounds do not overlap the raster');
  const [columnOffset, rowOffset, columns, rows] = window;
  const data = normalized.data.map((band) => band
    .slice(rowOffset, rowOffset + rows)
    .map((row) => row.slice(columnOffset, columnOffset + columns)));
  return withStep(normalized, data, { operation: 'crop', bounds: box, window }, {
    transform: windowTransform(normalized.transform, window),
    nodata: normalized.nodata,
  });
}

function ringsOf(polygon) {
  let rings;
  if (polygon && !Array.isArray(polygon) && typeof polygon === 'object') {
    if (polygon.type === 'Feature') return ringsOf(polygon.geometry);
    if (polygon.type === 'Polygon') rings = polygon.coordinates;
    else if (polygon.type === 'MultiPolygon') rings = polygon.coordinates.flat();
    else throw new RangeError(`polygon must be a Polygon or MultiPolygon, got ${JSON.stringify(polygon.type)}`);
  } else if (Array.isArray(polygon) && polygon.length && typeof polygon[0]?.[0] === 'number') {
    rings = [polygon];
  } else {
    rings = polygon;
  }
  if (!Array.isArray(rings) || rings.length === 0) throw new RangeError('polygon has no rings');
  return rings.map((ring) => {
    if (!Array.isArray(ring) || ring.length < 3) throw new RangeError('each polygon ring needs at least three (x, y) points');
    return ring.map((point) => {
      const x = Number(point?.[0]);
      const y = Number(point?.[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('polygon coordinates must be finite');
      return [x, y];
    });
  });
}

/** Even-odd point-in-polygon over every ring, as Python's `_inside`. */
function inside(rings, x, y) {
  let result = false;
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) {
      const [xi, yi] = ring[index];
      const [xj, yj] = ring[(index + 1) % ring.length];
      if (yi === yj) continue;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) result = !result;
    }
  }
  return result;
}

/**
 * Keep the cells whose centres fall inside a polygon; others become null.
 * Matches Python's `clip`.
 *
 * @param {object} raster
 * @param {Array|object} polygon - One ring of `[x, y]` points, a list of rings
 *   (inner rings cut holes by the even-odd rule), or a GeoJSON Polygon,
 *   MultiPolygon or Feature, in the raster's coordinates.
 * @param {object} [options]
 * @param {boolean} [options.crop=true] - Also cut the grid to the polygon's bounding box.
 * @returns {object} With a `{operation: 'clip', crop, inside_cells, window?}` step.
 */
export function clipGeophysicsRaster(raster, polygon, { crop = true } = {}) {
  const normalized = asRaster(raster);
  const rings = ringsOf(polygon);
  const transform = requireTransform(normalized);
  let window = [0, 0, normalized.width, normalized.height];
  if (crop) {
    // A loop rather than Math.min(...points): detailed boundaries can have
    // more vertices than a call accepts arguments.
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of rings) {
      for (const [x, y] of ring) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    window = windowFor(normalized, minX, minY, maxX, maxY);
    if (!window) throw new RangeError('the polygon does not overlap the raster');
  }
  const [columnOffset, rowOffset, columns, rows] = window;
  const [a, b, c, d, e, f] = transform;
  const keep = new Uint8Array(columns * rows);
  let count = 0;
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < columns; j += 1) {
      const column = columnOffset + j + 0.5;
      const row = rowOffset + i + 0.5;
      if (inside(rings, a * column + b * row + c, d * column + e * row + f)) {
        keep[i * columns + j] = 1;
        count += 1;
      }
    }
  }
  if (count === 0) throw new RangeError('no cell centre lies inside the polygon');
  const data = normalized.data.map((band) => Array.from({ length: crop ? rows : normalized.height }, (_, i) => {
    const sourceRow = crop ? i + rowOffset : i;
    return Array.from({ length: crop ? columns : normalized.width }, (__, j) => {
      const sourceColumn = crop ? j + columnOffset : j;
      const k = (sourceRow - rowOffset) * columns + (sourceColumn - columnOffset);
      const value = band[sourceRow][sourceColumn];
      return keep[k] && isValid(value, normalized.nodata) ? value : null;
    });
  }));
  const step = { operation: 'clip', crop: Boolean(crop), inside_cells: count };
  if (crop) step.window = window;
  return withStep(normalized, data, step, crop ? { transform: windowTransform(transform, window) } : {});
}

function sameCrs(left, right) {
  if (!left || !right) return true;
  return canonicalCrs(left) === canonicalCrs(right);
}

function checkAligned(left, right) {
  if (left.height !== right.height || left.width !== right.width) {
    throw new RangeError(
      `rasters must have the same shape to combine: ${left.height} x ${left.width} and ${right.height} x ${right.width}`,
    );
  }
  const [a, b, , d, e] = left.transform;
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(d), Math.abs(e));
  if (left.transform.some((value, index) => Math.abs(value - right.transform[index]) > 1e-6 * scale)) {
    throw new RangeError('rasters must share a grid (the same cell size and origin) to combine; resample one onto the other first');
  }
  if (!sameCrs(left.crs, right.crs)) {
    throw new RangeError(`rasters are in different coordinate systems: ${left.crs} and ${right.crs}`);
  }
  if (right.bandCount !== 1 && right.bandCount !== left.bandCount) {
    throw new RangeError('the second raster needs one band or as many bands as the first');
  }
}

/**
 * Add, subtract, multiply or divide two aligned rasters, or a raster and a
 * number.  A residual is `combineGeophysicsRasters(grid, regional, 'subtract')`.
 * Matches Python's `combine`.
 *
 * @param {object} left
 * @param {object|number} right - A raster on the same grid with one band or
 *   one per band of `left`, or a finite number.
 * @param {'add'|'subtract'|'multiply'|'divide'} operation
 * @returns {object} Null where either input is missing or on division by
 *   zero.  Units are kept for add/subtract and cleared otherwise.
 */
export function combineGeophysicsRasters(left, right, operation) {
  if (!GEOPHYSICS_COMBINE_OPERATIONS.includes(operation)) {
    throw new RangeError(`operation must be one of ${GEOPHYSICS_COMBINE_OPERATIONS.join(', ')}; received ${JSON.stringify(operation)}`);
  }
  const normalized = asRaster(left);
  const values = floatBands(normalized);
  let operandAt;
  let step;
  if (typeof right === 'number') {
    if (!Number.isFinite(right)) throw new RangeError('a numeric operand must be finite');
    operandAt = () => right;
    step = { operation, operand: right };
  } else {
    const other = asRaster(right);
    checkAligned(normalized, other);
    const operand = floatBands(other);
    operandAt = (band, index) => operand[other.bandCount === 1 ? 0 : band][index];
    step = { operation, operand: 'raster', operand_bands: [...other.bandNames] };
    if (other.metadata?.source) step.operand_source = String(other.metadata.source);
  }
  const apply = {
    add: (p, q) => p + q,
    subtract: (p, q) => p - q,
    multiply: (p, q) => p * q,
    divide: (p, q) => p / q,
  }[operation];
  const data = values.map((band, bandIndex) => {
    const result = band.map((value, index) => apply(value, operandAt(bandIndex, index)));
    return toRows(result, normalized.width, normalized.height);
  });
  const metadata = { ...normalized.metadata };
  if (typeof right !== 'number') {
    const { nodes, operand } = appendInput(normalized.metadata, asRaster(right).metadata);
    metadata.input_lineage = nodes;
    step.operand_lineage = operand;
  }
  if ((operation === 'multiply' || operation === 'divide') && 'units' in metadata) {
    metadata.units = Array(normalized.bandCount).fill(null);
  }
  return withStep(normalized, data, step, { metadata });
}

/** Cells within `maxDistance` steps (diagonals count as one) of a valid cell. */
function reachable(valid, width, height, maxDistance) {
  let reach = valid.slice();
  for (let step = 0; step < maxDistance; step += 1) {
    const grown = reach.slice();
    let changed = false;
    for (let i = 0; i < height; i += 1) {
      for (let j = 0; j < width; j += 1) {
        if (reach[i * width + j]) continue;
        for (let di = -1; di <= 1 && !grown[i * width + j]; di += 1) {
          for (let dj = -1; dj <= 1; dj += 1) {
            const ni = i + di;
            const nj = j + dj;
            if (ni >= 0 && ni < height && nj >= 0 && nj < width && reach[ni * width + nj]) {
              grown[i * width + j] = 1;
              changed = true;
              break;
            }
          }
        }
      }
    }
    if (!changed) break;
    reach = grown;
  }
  return reach;
}

/** Python's `_pyramid_fill`: missing cells take successively coarser block means. */
function pyramidFill(values, width, height) {
  const levels = [{ values: values.slice(), width, height }];
  for (;;) {
    const level = levels[levels.length - 1];
    if (!level.values.some(Number.isNaN) || (level.width === 1 && level.height === 1)) break;
    const parentWidth = Math.ceil(level.width / 2);
    const parentHeight = Math.ceil(level.height / 2);
    const parent = new Float64Array(parentWidth * parentHeight);
    const cell = (i, j) => (i < level.height && j < level.width ? level.values[i * level.width + j] : NaN);
    for (let i = 0; i < parentHeight; i += 1) {
      for (let j = 0; j < parentWidth; j += 1) {
        let total = 0;
        let count = 0;
        for (const value of [cell(2 * i, 2 * j), cell(2 * i + 1, 2 * j), cell(2 * i, 2 * j + 1), cell(2 * i + 1, 2 * j + 1)]) {
          if (!Number.isNaN(value)) {
            total += value;
            count += 1;
          }
        }
        parent[i * parentWidth + j] = count > 0 ? total / count : NaN;
      }
    }
    levels.push({ values: parent, width: parentWidth, height: parentHeight });
  }
  for (let index = levels.length - 2; index >= 0; index -= 1) {
    const level = levels[index];
    const parent = levels[index + 1];
    for (let i = 0; i < level.height; i += 1) {
      for (let j = 0; j < level.width; j += 1) {
        const k = i * level.width + j;
        if (Number.isNaN(level.values[k])) {
          level.values[k] = parent.values[Math.floor(i / 2) * parent.width + Math.floor(j / 2)];
        }
      }
    }
  }
  return levels[0].values;
}

/** Python's `_relax`: red-black over-relaxation of Laplace's equation on `active` cells. */
function relax(filled, fixed, active, width, height, iterations) {
  const usable = (i, j) => i >= 0 && i < height && j >= 0 && j < width && (fixed[i * width + j] || active[i * width + j]);
  const counts = new Float64Array(width * height);
  const colours = [[], []];
  for (let i = 0; i < height; i += 1) {
    for (let j = 0; j < width; j += 1) {
      const k = i * width + j;
      counts[k] = usable(i - 1, j) + usable(i + 1, j) + usable(i, j - 1) + usable(i, j + 1);
      if (active[k] && counts[k] > 0) colours[(i + j) % 2].push(k);
    }
  }
  const values = filled.map((value, k) => (fixed[k] || active[k] ? value : 0));
  const at = (i, j) => (i >= 0 && i < height && j >= 0 && j < width ? values[i * width + j] : 0);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const colour of colours) {
      // Cells of one colour only neighbour the other, so update them together.
      const updates = colour.map((k) => {
        const i = Math.floor(k / width);
        const j = k - i * width;
        const total = 0 + at(i - 1, j) + at(i + 1, j) + at(i, j - 1) + at(i, j + 1);
        return values[k] + RELAXATION * (total / counts[k] - values[k]);
      });
      colour.forEach((k, index) => { values[k] = updates[index]; });
    }
  }
  return values;
}

/**
 * Fill missing cells with a smooth surface that honours the data: gaps take
 * coarser and coarser block means, then `iterations` passes relax them
 * towards a harmonic surface.  Data cells never change.  Matches Python's
 * `fill_gaps`.
 *
 * @param {object} raster
 * @param {object} [options]
 * @param {number|null} [options.maxDistance=null] - Fill only cells within this
 *   many cells of data (diagonal steps count as one); null fills every gap.
 * @param {number} [options.iterations=100] - Smoothing passes; 0 keeps the block-mean fill.
 * @returns {object} With a `{operation: 'fill_gaps', method: 'pyramid_harmonic',
 *   max_distance, iterations, filled_cells}` step.
 */
export function fillGeophysicsGaps(raster, { maxDistance = null, iterations = 100 } = {}) {
  if (maxDistance !== null && maxDistance !== undefined && !(Number.isInteger(maxDistance) && maxDistance >= 0)) {
    throw new RangeError('maxDistance must be a whole number of cells, 0 or more');
  }
  if (!(Number.isInteger(iterations) && iterations >= 0)) throw new RangeError('iterations must be a whole number, 0 or more');
  const normalized = asRaster(raster);
  const { width, height } = normalized;
  let filledCells = 0;
  const data = floatBands(normalized).map((values, bandIndex) => {
    const valid = Uint8Array.from(values, (value) => (Number.isNaN(value) ? 0 : 1));
    if (!valid.some(Boolean)) {
      throw new RangeError(`band ${JSON.stringify(normalized.bandNames[bandIndex])} has no data to fill from`);
    }
    let gaps = valid.map((flag) => 1 - flag);
    if (maxDistance !== null && maxDistance !== undefined) {
      const reach = reachable(valid, width, height, maxDistance);
      gaps = gaps.map((flag, k) => flag & reach[k]);
    }
    const count = gaps.reduce((sum, flag) => sum + flag, 0);
    if (count === 0) return toRows(values, width, height);
    let filled = pyramidFill(values, width, height);
    if (iterations) filled = relax(filled, valid, gaps, width, height, iterations);
    filledCells += count;
    return toRows(values.map((value, k) => (gaps[k] ? filled[k] : value)), width, height);
  });
  return withStep(normalized, data, {
    operation: 'fill_gaps',
    method: 'pyramid_harmonic',
    max_distance: maxDistance ?? null,
    iterations,
    filled_cells: filledCells,
  });
}
