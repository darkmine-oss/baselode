/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Wavelength filters and potential-field enhancements for geophysics rasters.
 * Matches Python's `baselode.geophysics.processing`: distances are in CRS
 * linear units (metres for MGA/UTM grids; reproject geographic grids first) and
 * derivatives are per CRS unit. Every function processes all bands and
 * returns a new raster with `nodata: null`, missing cells null, and the step
 * appended to `metadata.processing` using Python's record names.
 *
 * Before a Fourier transform each band has a best-fit plane removed, missing
 * cells set to that plane, and the grid mirror-padded to a power-of-two size.
 */

import proj4 from 'proj4';
import { normaliseCrs } from '../extent/crs.js';
import { createGeophysicsRaster } from './geophysicsRaster.js';
import { isGeophysicsValue } from '../viz/geophysicsColorScales.js';

export const GEOPHYSICS_FILTER_METHODS = Object.freeze(['gaussian', 'butterworth']);
export const MIN_RTP_INCLINATION = 15;

function asRaster(raster) {
  const normalized = raster?.bandCount ? raster : createGeophysicsRaster(raster);
  coordinateUnit(normalized);
  return normalized;
}

const LINEAR_UNITS = {
  m: 'm', metre: 'm', meter: 'm', ft: 'ft', foot: 'ft', feet: 'ft',
  'us-ft': 'us-ft', us_survey_foot: 'us-ft', 'us survey foot': 'us-ft', foot_us: 'us-ft', foot_intl: 'ft',
  km: 'km', kilometre: 'km', kilometer: 'km',
};

function coordinateUnit(raster) {
  const declared = raster.metadata.crs_units;
  let unit = declared ? LINEAR_UNITS[String(declared).trim().toLowerCase()] : null;
  if (declared && !unit) throw new RangeError('processing requires linear crs_units (m, ft, us-ft or km)');
  if (raster.crs) {
    let projection;
    try {
      projection = new proj4.Proj(normaliseCrs(raster.crs));
    } catch (error) {
      // External readers may supply CRS identifiers/definitions that proj4
      // cannot resolve. Require the caller's explicit linear-unit contract.
      if (!unit) throw new RangeError('unresolved CRS requires explicit linear metadata.crs_units', { cause: error });
      return unit;
    }
    if (['longlat', 'geocent'].includes(projection.projName)) {
      throw new RangeError('processing requires a projected CRS or local Cartesian grid; reproject first');
    }
    const scaleUnits = [[1, 'm'], [0.3048, 'ft'], [1200 / 3937, 'us-ft'], [1000, 'km']];
    const scaledUnit = scaleUnits.find(([scale]) => Math.abs(projection.to_meter - scale) <= 1e-12 * scale)?.[1];
    const axisUnit = projection.units
      ? LINEAR_UNITS[String(projection.units).trim().toLowerCase()]
      : (projection.to_meter == null ? 'm' : scaledUnit);
    if (!axisUnit) throw new RangeError('processing requires supported linear CRS axis units');
    if (unit && unit !== axisUnit) throw new RangeError('metadata crs_units conflicts with the CRS axis units');
    unit = axisUnit;
  }
  return unit ?? 'coordinate_unit';
}

function derivedUnits(raster, step) {
  if (step.operation === 'tilt_derivative') return Array(raster.bandCount).fill('degree');
  if (!['vertical_derivative', 'horizontal_derivative', 'total_horizontal_derivative', 'analytic_signal'].includes(step.operation)) {
    return raster.metadata.units;
  }
  const order = step.order ?? 1;
  const distance = coordinateUnit(raster);
  const denominator = order === 1 ? distance : `${distance}^${order}`;
  return raster.data.map((_, index) => {
    const unit = raster.metadata.units?.[index];
    if (!unit) return null;
    const numerator = /[/^]/.test(unit) ? `(${unit})` : unit;
    return `${numerator}/${denominator}`;
  });
}

/**
 * Per-cell map gradients `[east, north]` of a band, or null for missing
 * cells. Differences along columns and rows are converted to map axes with
 * the affine transform, so azimuths stay geographic for south-up, west-up
 * and rotated grids (matches Python's processing._map_gradients).
 *
 * @param {Array<Array<number|null>>} band
 * @param {number|null} nodata
 * @param {number[]} transform
 * @param {number} [zFactor=1]
 * @returns {Array<Array<[number, number]|null>>}
 */
export function geophysicsMapGradients(band, nodata, transform, zFactor = 1) {
  const height = band.length;
  const width = band[0].length;
  const [a, b, , d, e] = transform;
  const determinant = a * e - b * d;
  if (determinant === 0) throw new RangeError('raster transform is degenerate');
  const at = (row, column) => {
    if (row < 0 || column < 0 || row >= height || column >= width) return null;
    const value = band[row][column];
    return isGeophysicsValue(value, nodata) ? value : null;
  };
  // Central difference, or one-sided where a neighbour is off the grid or
  // missing (matches Python's processing._difference).
  const difference = (centre, low, high) => {
    const spacing = (low === null ? 0 : 1) + (high === null ? 0 : 1);
    return spacing ? ((high ?? centre) - (low ?? centre)) / spacing : 0;
  };
  return band.map((values, row) => values.map((value, column) => {
    if (!isGeophysicsValue(value, nodata)) return null;
    const perColumn = difference(value, at(row, column - 1), at(row, column + 1));
    const perRow = difference(value, at(row - 1, column), at(row + 1, column));
    const east = (e * perColumn - d * perRow) / determinant;
    const north = (a * perRow - b * perColumn) / determinant;
    return [east * zFactor, north * zFactor];
  }));
}

function cellSize(transform) {
  const [a, b, , d, e] = transform;
  const columnSpacing = Math.hypot(a, d);
  const rowSpacing = Math.hypot(b, e);
  if (Math.abs(a * b + d * e) > 1e-9 * columnSpacing * rowSpacing) {
    throw new RangeError('cell size is undefined for a sheared transform');
  }
  return [columnSpacing, rowSpacing];
}

function derivedRaster(raster, bands, step) {
  const units = derivedUnits(raster, step);
  return createGeophysicsRaster({
    data: bands,
    transform: raster.transform,
    crs: raster.crs,
    nodata: null,
    bandNames: raster.bandNames,
    metadata: { ...raster.metadata, ...(units === undefined ? {} : { units }), processing: [...(raster.metadata.processing ?? []), step] },
  });
}

// --- Fourier core -------------------------------------------------------------

/** Smallest power of two that is at least `size`. */
export function fftSize(size) {
  let result = 1;
  while (result < size) result *= 2;
  return result;
}

/**
 * Source indices that mirror-pad an axis of `size` cells, `before` cells at
 * the start and to `total` cells overall, repeating edge cells (NumPy's
 * `symmetric` mode).
 */
export function symmetricIndices(size, before, total) {
  const period = 2 * size;
  return Array.from({ length: total }, (_, index) => {
    const offset = (((index - before) % period) + period) % period;
    return offset < size ? offset : period - 1 - offset;
  });
}

function padCells(length, spacing, size) {
  const cells = length == null ? Math.floor(size / 2) : Math.ceil(length / spacing);
  return Math.min(Math.max(8, cells), size);
}

/** NumPy `fftfreq(n)[index]`: cycles per sample. */
function fftFrequency(index, n) {
  return (index < Math.ceil(n / 2) ? index : index - n) / n;
}

/** In-place iterative radix-2 FFT of `re`/`im` (length a power of two). */
function fft(re, im, inverse, cosTable, sinTable) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  const sign = inverse ? 1 : -1;
  for (let length = 2; length <= n; length *= 2) {
    const half = length / 2;
    const step = n / length;
    for (let start = 0; start < n; start += length) {
      for (let k = 0; k < half; k += 1) {
        const wr = cosTable[k * step];
        const wi = sign * sinTable[k * step];
        const p = start + k;
        const q = p + half;
        const xr = re[q] * wr - im[q] * wi;
        const xi = re[q] * wi + im[q] * wr;
        re[q] = re[p] - xr;
        im[q] = im[p] - xi;
        re[p] += xr;
        im[p] += xi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i += 1) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function twiddles(n) {
  const cosTable = new Float64Array(n / 2 || 1);
  const sinTable = new Float64Array(n / 2 || 1);
  for (let k = 0; k < n / 2; k += 1) {
    cosTable[k] = Math.cos((2 * Math.PI * k) / n);
    sinTable[k] = Math.sin((2 * Math.PI * k) / n);
  }
  return [cosTable, sinTable];
}

/** 2-D FFT of row-major `re`/`im` grids, rows then columns. */
function fft2(re, im, rows, columns, inverse) {
  const rowTables = twiddles(columns);
  const rowRe = new Float64Array(columns);
  const rowIm = new Float64Array(columns);
  for (let row = 0; row < rows; row += 1) {
    const offset = row * columns;
    rowRe.set(re.subarray(offset, offset + columns));
    rowIm.set(im.subarray(offset, offset + columns));
    fft(rowRe, rowIm, inverse, ...rowTables);
    re.set(rowRe, offset);
    im.set(rowIm, offset);
  }
  const columnTables = twiddles(rows);
  const columnRe = new Float64Array(rows);
  const columnIm = new Float64Array(rows);
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      columnRe[row] = re[row * columns + column];
      columnIm[row] = im[row * columns + column];
    }
    fft(columnRe, columnIm, inverse, ...columnTables);
    for (let row = 0; row < rows; row += 1) {
      re[row * columns + column] = columnRe[row];
      im[row * columns + column] = columnIm[row];
    }
  }
}

/**
 * Best-fit plane over valid cells in centred cell indices (the same surface
 * as a plane in map coordinates, and well conditioned).
 */
function plane(values, valid, rows, columns) {
  const centreRow = (rows - 1) / 2;
  const centreColumn = (columns - 1) / 2;
  // Normal equations for value = p * column + q * row + s.
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const v = [0, 0, 0];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      if (!valid[index]) continue;
      const basis = [column - centreColumn, row - centreRow, 1];
      for (let i = 0; i < 3; i += 1) {
        v[i] += basis[i] * values[index];
        for (let j = 0; j < 3; j += 1) m[i][j] += basis[i] * basis[j];
      }
    }
  }
  const solution = solve3(m, v);
  // Too few independent cells for a plane (all in one line): use the mean.
  if (!solution) return null;
  const [p, q, s] = solution;
  return (row, column) => p * (column - centreColumn) + q * (row - centreRow) + s;
}

function solve3(matrix, vector) {
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < 3; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < 3; row += 1) {
      if (Math.abs(a[row][pivot]) > Math.abs(a[best][pivot])) best = row;
    }
    [a[pivot], a[best]] = [a[best], a[pivot]];
    if (Math.abs(a[pivot][pivot]) < 1e-12) return null;
    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) continue;
      const factor = a[row][pivot] / a[pivot][pivot];
      for (let column = pivot; column < 4; column += 1) a[row][column] -= factor * a[pivot][column];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

/**
 * Apply a Fourier-domain response to every band.
 *
 * @param {object} raster
 * @param {(east: number, north: number) => number|[number, number]} response -
 *   Real multiplier, or `[re, im]`, for wavenumbers in cycles per CRS unit.
 * @param {{keepTrend?: boolean, padLength?: number|null, detrend?: boolean}} [options]
 * @returns {Array<Array<Array<number|null>>>} Bands with null for missing cells.
 */
function fourierBands(raster, response, { keepTrend = false, padLength = null, detrend = true } = {}) {
  const { width: columns, height: rows, transform } = raster;
  const [cellX, cellY] = cellSize(transform);
  // Round each padded axis up to a power of two and split the padding
  // evenly, so isotropic operations stay symmetric.
  const totalRows = fftSize(rows + 2 * padCells(padLength, cellY, rows));
  const totalColumns = fftSize(columns + 2 * padCells(padLength, cellX, columns));
  const padRows = Math.floor((totalRows - rows) / 2);
  const padColumns = Math.floor((totalColumns - columns) / 2);
  const rowIndex = symmetricIndices(rows, padRows, totalRows);
  const columnIndex = symmetricIndices(columns, padColumns, totalColumns);
  const paddedRows = rowIndex.length;
  const paddedColumns = columnIndex.length;

  const [a, b, , d, e] = transform;
  const determinant = a * e - b * d;
  if (determinant === 0) throw new RangeError('raster transform is degenerate');
  const multiplierRe = new Float64Array(paddedRows * paddedColumns);
  const multiplierIm = new Float64Array(paddedRows * paddedColumns);
  for (let row = 0; row < paddedRows; row += 1) {
    const perRow = fftFrequency(row, paddedRows);
    for (let column = 0; column < paddedColumns; column += 1) {
      const perColumn = fftFrequency(column, paddedColumns);
      const east = (e * perColumn - d * perRow) / determinant;
      const north = (a * perRow - b * perColumn) / determinant;
      const value = response(east, north);
      const index = row * paddedColumns + column;
      if (Array.isArray(value)) {
        [multiplierRe[index], multiplierIm[index]] = value;
      } else {
        multiplierRe[index] = value;
      }
    }
  }

  return raster.data.map((band) => {
    const values = new Float64Array(rows * columns);
    const valid = new Uint8Array(rows * columns);
    let count = 0;
    let sum = 0;
    band.forEach((cells, row) => cells.forEach((value, column) => {
      if (!isGeophysicsValue(value, raster.nodata)) return;
      values[row * columns + column] = value;
      valid[row * columns + column] = 1;
      count += 1;
      sum += value;
    }));
    if (count === 0) return band.map((cells) => cells.map(() => null));
    const mean = sum / count;
    const fitted = detrend && count >= 3 ? plane(values, valid, rows, columns) : null;
    const trend = fitted ?? (() => mean);

    const re = new Float64Array(paddedRows * paddedColumns);
    const im = new Float64Array(paddedRows * paddedColumns);
    for (let row = 0; row < paddedRows; row += 1) {
      const sourceRow = rowIndex[row];
      for (let column = 0; column < paddedColumns; column += 1) {
        const sourceColumn = columnIndex[column];
        const source = sourceRow * columns + sourceColumn;
        re[row * paddedColumns + column] = valid[source] ? values[source] - trend(sourceRow, sourceColumn) : 0;
      }
    }
    fft2(re, im, paddedRows, paddedColumns, false);
    for (let index = 0; index < re.length; index += 1) {
      const real = re[index] * multiplierRe[index] - im[index] * multiplierIm[index];
      im[index] = re[index] * multiplierIm[index] + im[index] * multiplierRe[index];
      re[index] = real;
    }
    fft2(re, im, paddedRows, paddedColumns, true);
    return band.map((cells, row) => cells.map((_, column) => {
      if (!valid[row * columns + column]) return null;
      const filtered = re[(row + padRows) * paddedColumns + column + padColumns];
      return keepTrend ? filtered + trend(row, column) : filtered;
    }));
  });
}

// --- wavelength filters -------------------------------------------------------

function lowResponse(wavenumber, cutoffWavelength, method, order) {
  const ratio = wavenumber * cutoffWavelength;
  if (method === 'gaussian') return Math.exp(-Math.LN2 * ratio ** 2);
  return 1 / (1 + ratio ** (2 * order));
}

function checkFilter(method, order, ...wavelengths) {
  if (!GEOPHYSICS_FILTER_METHODS.includes(method)) {
    throw new RangeError(`method must be one of ${GEOPHYSICS_FILTER_METHODS.join(', ')}, not '${method}'`);
  }
  if (!(Number.isInteger(order) && order >= 1)) throw new RangeError('order must be a positive integer');
  if (!wavelengths.every((wavelength) => Number.isFinite(wavelength) && wavelength > 0)) {
    throw new RangeError('cut-off wavelengths must be positive');
  }
}

function applyFilter(raster, response, keepTrend, longestWavelength, step, detrend) {
  const bands = fourierBands(raster, (east, north) => response(Math.hypot(east, north)), {
    keepTrend,
    padLength: longestWavelength,
    detrend,
  });
  return derivedRaster(raster, bands, { ...step, detrend: Boolean(detrend) });
}

/**
 * Keep features longer than `wavelength` (regional field). Matches Python's
 * `baselode.geophysics.low_pass`.
 *
 * @param {object} raster
 * @param {{wavelength: number, method?: 'gaussian'|'butterworth', order?: number, detrend?: boolean}} options
 *   `wavelength` is the cut-off in CRS units (response 0.5). Butterworth is
 *   sharper, with steepness set by `order` (default 4). `detrend` (default
 *   true) removes a best-fit plane and restores it afterwards.
 * @returns {object}
 */
export function geophysicsLowPass(raster, { wavelength, method = 'gaussian', order = 4, detrend = true } = {}) {
  const normalized = asRaster(raster);
  checkFilter(method, order, wavelength);
  return applyFilter(
    normalized,
    (k) => lowResponse(k, wavelength, method, order),
    true,
    wavelength,
    { operation: 'low_pass', wavelength, method, order },
    detrend,
  );
}

/**
 * Keep features shorter than `wavelength` (residual field); the removed
 * plane is not restored. Matches Python's `baselode.geophysics.high_pass`.
 *
 * @param {object} raster
 * @param {{wavelength: number, method?: string, order?: number, detrend?: boolean}} options
 * @returns {object}
 */
export function geophysicsHighPass(raster, { wavelength, method = 'gaussian', order = 4, detrend = true } = {}) {
  const normalized = asRaster(raster);
  checkFilter(method, order, wavelength);
  return applyFilter(
    normalized,
    (k) => 1 - lowResponse(k, wavelength, method, order),
    false,
    wavelength,
    { operation: 'high_pass', wavelength, method, order },
    detrend,
  );
}

/**
 * Keep wavelengths between `shortWavelength` and `longWavelength`. Matches
 * Python's `baselode.geophysics.band_pass`.
 *
 * @param {object} raster
 * @param {{longWavelength: number, shortWavelength: number, method?: string, order?: number, detrend?: boolean}} options
 * @returns {object}
 */
export function geophysicsBandPass(raster, {
  longWavelength, shortWavelength, method = 'gaussian', order = 4, detrend = true,
} = {}) {
  const normalized = asRaster(raster);
  checkFilter(method, order, longWavelength, shortWavelength);
  if (!(shortWavelength < longWavelength)) throw new RangeError('shortWavelength must be less than longWavelength');
  return applyFilter(
    normalized,
    (k) => (1 - lowResponse(k, longWavelength, method, order)) * lowResponse(k, shortWavelength, method, order),
    false,
    longWavelength,
    {
      operation: 'band_pass',
      long_wavelength: longWavelength,
      short_wavelength: shortWavelength,
      method,
      order,
    },
    detrend,
  );
}

// --- potential-field enhancements --------------------------------------------

function verticalDerivativeBands(raster, order) {
  return fourierBands(raster, (east, north) => (2 * Math.PI * Math.hypot(east, north)) ** order);
}

function gradientBands(raster) {
  return raster.data.map((band) => geophysicsMapGradients(band, raster.nodata, raster.transform));
}

function combineBands(raster, ...sources) {
  const [combine] = sources.splice(-1);
  return raster.data.map((band, bandIndex) => band.map((cells, row) => cells.map((_, column) => {
    const values = sources.map((source) => source[bandIndex][row][column]);
    return values.some((value) => value === null) ? null : combine(...values);
  })));
}

/**
 * Vertical derivative (1VD, 2VD, ...) in the Fourier domain. Matches
 * Python's `baselode.geophysics.vertical_derivative`.
 *
 * @param {object} raster
 * @param {{order?: number}} [options]
 * @returns {object} Data units per CRS unit to the power `order`.
 */
export function geophysicsVerticalDerivative(raster, { order = 1 } = {}) {
  const normalized = asRaster(raster);
  if (!(Number.isInteger(order) && order >= 1)) throw new RangeError('order must be a positive integer');
  return derivedRaster(normalized, verticalDerivativeBands(normalized, order), {
    operation: 'vertical_derivative',
    order,
  });
}

/**
 * Horizontal derivative along a map direction. Matches Python's
 * `baselode.geophysics.horizontal_derivative`.
 *
 * @param {object} raster
 * @param {{direction?: 'east'|'north'}} [options]
 * @returns {object} Data units per CRS unit.
 */
export function geophysicsHorizontalDerivative(raster, { direction = 'east' } = {}) {
  const normalized = asRaster(raster);
  if (direction !== 'east' && direction !== 'north') {
    throw new RangeError(`direction must be 'east' or 'north', not '${direction}'`);
  }
  const component = direction === 'east' ? 0 : 1;
  const bands = gradientBands(normalized).map((band) => band.map((row) => row.map(
    (gradient) => (gradient ? gradient[component] : null),
  )));
  return derivedRaster(normalized, bands, { operation: 'horizontal_derivative', direction });
}

function totalHorizontalBands(raster) {
  return gradientBands(raster).map((band) => band.map((row) => row.map(
    (gradient) => (gradient ? Math.hypot(gradient[0], gradient[1]) : null),
  )));
}

/**
 * Magnitude of the horizontal gradient (THD). Matches Python's
 * `baselode.geophysics.total_horizontal_derivative`.
 *
 * @param {object} raster
 * @returns {object}
 */
export function geophysicsTotalHorizontalDerivative(raster) {
  const normalized = asRaster(raster);
  return derivedRaster(normalized, totalHorizontalBands(normalized), { operation: 'total_horizontal_derivative' });
}

const GRADIENT_RELATIVE_TOLERANCE = 1e-10;

/**
 * Per-band gradient below which values are rounding error: the largest
 * absolute cell value over the smallest cell spacing (matches Python's
 * processing._gradient_tolerance).
 */
function gradientTolerances(raster) {
  const smallestCell = Math.min(...cellSize(raster.transform));
  return raster.data.map((band) => {
    let largest = 0;
    for (const row of band) {
      for (const value of row) {
        if (isGeophysicsValue(value, raster.nodata)) largest = Math.max(largest, Math.abs(value));
      }
    }
    return (GRADIENT_RELATIVE_TOLERANCE * largest) / smallestCell;
  });
}

/**
 * Tilt derivative `atan2(1VD, THD)` in degrees (-90..90). Gradients too
 * small to distinguish from rounding error count as zero, so a flat field
 * has zero tilt. Matches Python's `baselode.geophysics.tilt_derivative`.
 *
 * @param {object} raster
 * @returns {object}
 */
export function geophysicsTiltDerivative(raster) {
  const normalized = asRaster(raster);
  const tolerances = gradientTolerances(normalized);
  const vertical = verticalDerivativeBands(normalized, 1);
  const horizontal = totalHorizontalBands(normalized);
  const bands = vertical.map((band, bandIndex) => band.map((row, rowIndex) => row.map((value, column) => {
    const across = horizontal[bandIndex][rowIndex][column];
    if (value === null || across === null) return null;
    const tolerance = tolerances[bandIndex];
    const up = Math.abs(value) < tolerance ? 0 : value;
    const flat = across < tolerance ? 0 : across;
    return (Math.atan2(up, flat) * 180) / Math.PI;
  })));
  return derivedRaster(normalized, bands, { operation: 'tilt_derivative' });
}

/**
 * Analytic signal amplitude `sqrt(dx² + dy² + dz²)`. Matches Python's
 * `baselode.geophysics.analytic_signal`.
 *
 * @param {object} raster
 * @returns {object}
 */
export function geophysicsAnalyticSignal(raster) {
  const normalized = asRaster(raster);
  const bands = combineBands(
    normalized,
    verticalDerivativeBands(normalized, 1),
    totalHorizontalBands(normalized),
    (vertical, horizontal) => Math.sqrt(horizontal ** 2 + vertical ** 2),
  );
  return derivedRaster(normalized, bands, { operation: 'analytic_signal' });
}

/**
 * Upward continuation by `height` CRS units; the removed plane is restored.
 * Matches Python's `baselode.geophysics.upward_continuation`.
 *
 * @param {object} raster
 * @param {{height: number}} options
 * @returns {object}
 */
export function geophysicsUpwardContinuation(raster, { height } = {}) {
  const normalized = asRaster(raster);
  const distance = Number(height);
  if (!(Number.isFinite(distance) && distance > 0)) throw new RangeError('height must be positive');
  const bands = fourierBands(
    normalized,
    (east, north) => Math.exp(-2 * Math.PI * Math.hypot(east, north) * distance),
    { keepTrend: true },
  );
  return derivedRaster(normalized, bands, { operation: 'upward_continuation', height: distance });
}

/**
 * Reduce total magnetic intensity to the pole for induced magnetisation.
 * Matches Python's `baselode.geophysics.reduce_to_pole`.
 *
 * @param {object} raster
 * @param {{inclination: number, declination: number}} options - Field
 *   inclination (degrees, positive down) and declination (degrees east of
 *   true north) for the survey date and location.
 * @returns {object}
 */
export function geophysicsReduceToPole(raster, { inclination, declination } = {}) {
  const normalized = asRaster(raster);
  const fieldInclination = Number(inclination);
  const fieldDeclination = Number(declination);
  if (!(Number.isFinite(fieldInclination) && Math.abs(fieldInclination) <= 90)) {
    throw new RangeError('inclination must be between -90 and 90 degrees');
  }
  if (!Number.isFinite(fieldDeclination)) throw new RangeError('declination must be finite');
  if (Math.abs(fieldInclination) < MIN_RTP_INCLINATION) {
    throw new RangeError(
      `reduction to the pole is unstable for inclinations within ${MIN_RTP_INCLINATION} degrees of `
      + 'the magnetic equator; use the analytic signal instead',
    );
  }
  const radians = Math.PI / 180;
  const sinI = Math.sin(fieldInclination * radians);
  const cosI = Math.cos(fieldInclination * radians);
  const eastCosine = cosI * Math.sin(fieldDeclination * radians);
  const northCosine = cosI * Math.cos(fieldDeclination * radians);
  const bands = fourierBands(normalized, (east, north) => {
    const magnitude = Math.hypot(east, north);
    if (magnitude === 0) return 1;
    // |k|² / θ² with θ = sin(I)|k| + i (eastCosine kE + northCosine kN).
    const real = sinI * magnitude;
    const imaginary = eastCosine * east + northCosine * north;
    const squareRe = real * real - imaginary * imaginary;
    const squareIm = 2 * real * imaginary;
    const scale = (magnitude * magnitude) / (squareRe * squareRe + squareIm * squareIm);
    return [squareRe * scale, -squareIm * scale];
  }, { keepTrend: true });
  return derivedRaster(normalized, bands, {
    operation: 'reduce_to_pole',
    inclination: fieldInclination,
    declination: fieldDeclination,
  });
}

const OPERATIONS = {
  low_pass: geophysicsLowPass,
  high_pass: geophysicsHighPass,
  band_pass: geophysicsBandPass,
  vertical_derivative: geophysicsVerticalDerivative,
  horizontal_derivative: geophysicsHorizontalDerivative,
  total_horizontal_derivative: geophysicsTotalHorizontalDerivative,
  tilt_derivative: geophysicsTiltDerivative,
  analytic_signal: geophysicsAnalyticSignal,
  upward_continuation: geophysicsUpwardContinuation,
  reduce_to_pole: geophysicsReduceToPole,
};

/** Operation names accepted by {@link processGeophysicsRaster}. */
export const GEOPHYSICS_OPERATIONS = Object.freeze(Object.keys(OPERATIONS));

/**
 * Apply one operation by name, as recorded in `metadata.processing`.
 *
 * @param {object} raster
 * @param {string} operation - One of {@link GEOPHYSICS_OPERATIONS}.
 * @param {object} [options] - The operation's options (camelCase).
 * @returns {object}
 */
export function processGeophysicsRaster(raster, operation, options = {}) {
  const apply = OPERATIONS[operation];
  if (!apply) throw new RangeError(`Unknown geophysics operation '${operation}'.`);
  return apply(raster, options);
}
