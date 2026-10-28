/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
  createGeophysicsRaster,
  geophysicsRasterRange,
  getGeophysicsRasterBand,
} from '../data/geophysicsRaster.js';
import {
  createGeophysicsStretch,
  geophysicsScaleColor,
  isGeophysicsValue,
  sortedPercentile,
} from './geophysicsColorScales.js';

export { GEOPHYSICS_PALETTES } from './geophysicsColorScales.js';

export const DEFAULT_GEOPHYSICS_HILLSHADE = Object.freeze({
  enabled: false,
  azimuth: 315,
  altitude: 45,
  strength: 0.65,
  zFactor: 'auto',
});

/**
 * Resolve an ordered low/high range in data units. Values outside the range
 * take the end colours.
 *
 * Kept for callers of the original API; new code should pass
 * `stretch: { mode: 'absolute', min, max }` to {@link renderGeophysicsRaster}.
 */
export function normalizeGeophysicsClipRange(raster, clipRange = null, band = 1) {
  const range = geophysicsRasterRange(raster, band);
  if (clipRange == null) return range;
  if (!Array.isArray(clipRange) || clipRange.length !== 2) {
    throw new TypeError('clipRange must be a [low, high] tuple.');
  }
  const low = Number(clipRange[0]);
  const high = Number(clipRange[1]);
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) {
    throw new RangeError('clipRange requires two finite values where high is greater than low.');
  }
  return [low, high];
}

function asRaster(raster) {
  return raster?.bandCount ? raster : createGeophysicsRaster(raster);
}

/**
 * Per-cell map gradients `[east, north]` of a band, or null for missing
 * cells. Differences along columns and rows are converted to map axes with
 * the affine transform, so azimuths stay geographic for south-up, west-up
 * and rotated grids (matches Python's processing._gradients).
 */
function mapGradients(band, nodata, transform, zFactor = 1) {
  const height = band.length;
  const width = band[0].length;
  const [a, b, , d, e] = transform;
  const determinant = a * e - b * d;
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

/**
 * Automatic vertical exaggeration: scales the 95th-percentile gradient to a
 * 45° slope so relief is comparable whatever the data units (nT, mGal, m).
 * Matches Python's `baselode.geophysics.hillshade_z_factor`.
 *
 * @param {object} raster
 * @param {number} [band=1]
 * @returns {number}
 */
export function geophysicsHillshadeZFactor(raster, band = 1) {
  const normalized = asRaster(raster);
  const magnitudes = [];
  for (const row of mapGradients(getGeophysicsRasterBand(normalized, band), normalized.nodata, normalized.transform)) {
    for (const gradient of row) if (gradient) magnitudes.push(Math.hypot(gradient[0], gradient[1]));
  }
  if (magnitudes.length === 0) return 1;
  const reference = sortedPercentile(Float64Array.from(magnitudes).sort(), 95);
  return reference > 0 ? 1 / reference : 1;
}

/**
 * Compute an illumination grid (0..1) for one band. Azimuth is degrees
 * clockwise from north; altitude is degrees above the horizon; `zFactor` is
 * a vertical exaggeration or `'auto'`. Missing cells are NaN.
 *
 * @param {object} raster
 * @param {{band?: number, azimuth?: number, altitude?: number, zFactor?: number|'auto'}} [options]
 * @returns {number[][]}
 */
export function geophysicsHillshade(raster, options = {}) {
  const normalized = asRaster(raster);
  const bandIndex = options.band ?? 1;
  const azimuth = Number(options.azimuth ?? DEFAULT_GEOPHYSICS_HILLSHADE.azimuth);
  const altitude = Number(options.altitude ?? DEFAULT_GEOPHYSICS_HILLSHADE.altitude);
  if (!(altitude > 0 && altitude <= 90)) throw new RangeError('altitude must be greater than 0 and at most 90 degrees.');
  const requested = options.zFactor ?? DEFAULT_GEOPHYSICS_HILLSHADE.zFactor;
  const zFactor = requested === 'auto' ? geophysicsHillshadeZFactor(normalized, bandIndex) : Number(requested);
  if (!(zFactor > 0)) throw new RangeError("zFactor must be positive or 'auto'.");
  const zenith = (90 - altitude) * Math.PI / 180;
  const azimuthRadians = (360 - azimuth + 90) * Math.PI / 180;
  const band = getGeophysicsRasterBand(normalized, bandIndex);
  return mapGradients(band, normalized.nodata, normalized.transform, zFactor).map((row) => row.map((gradient) => {
    if (!gradient) return NaN;
    // Horn/ESRI convention: dz/dy is measured southwards.
    const [dzdx, north] = gradient;
    const dzdy = -north;
    const slope = Math.atan(Math.hypot(dzdx, dzdy));
    const aspect = Math.atan2(dzdy, -dzdx);
    const intensity = Math.cos(zenith) * Math.cos(slope)
      + Math.sin(zenith) * Math.sin(slope) * Math.cos(azimuthRadians - aspect);
    return Math.max(0, Math.min(1, intensity));
  }));
}

/**
 * Convert one raster band into Canvas ImageData-compatible RGBA bytes.
 *
 * @param {object} raster
 * @param {object} [options]
 * @param {number} [options.band=1]
 * @param {string} [options.palette='viridis']
 * @param {boolean} [options.reversePalette=false]
 * @param {object} [options.stretch] - `{mode: 'relative', low, high}` (default 2/98),
 *   `{mode: 'absolute', min, max}` or `{mode: 'equalize'}`.
 * @param {[number, number]} [options.clipRange] - Legacy absolute range; used when
 *   `stretch` is absent.
 * @param {object} [options.hillshade] - `{enabled, azimuth, altitude, strength, zFactor}`.
 * @returns {{data: Uint8ClampedArray, width: number, height: number, range: [number, number],
 *   scale: object, zFactor: number|null}}
 *   `range` is the data values at the ends of the colour scale; `scale` maps
 *   values to colour positions and back (for colour bars).
 */
export function renderGeophysicsRaster(raster, options = {}) {
  const normalized = asRaster(raster);
  const bandIndex = options.band ?? 1;
  const band = getGeophysicsRasterBand(normalized, bandIndex);
  const palette = options.palette ?? 'viridis';
  const reverse = Boolean(options.reversePalette);
  geophysicsScaleColor(palette, 0);
  let stretch = options.stretch;
  if (!stretch && options.clipRange) {
    const [min, max] = normalizeGeophysicsClipRange(normalized, options.clipRange, bandIndex);
    stretch = { mode: 'absolute', min, max };
  }
  const scale = createGeophysicsStretch(band.flat(), stretch, normalized.nodata);
  const hillshade = { ...DEFAULT_GEOPHYSICS_HILLSHADE, ...(options.hillshade ?? {}) };
  let zFactor = null;
  let shade = null;
  if (hillshade.enabled) {
    zFactor = hillshade.zFactor === 'auto' ? geophysicsHillshadeZFactor(normalized, bandIndex) : Number(hillshade.zFactor);
    shade = geophysicsHillshade(normalized, { ...hillshade, zFactor, band: bandIndex });
  }
  const strength = Math.max(0, Math.min(1, Number(hillshade.strength)));
  const pixels = new Uint8ClampedArray(normalized.width * normalized.height * 4);

  for (let row = 0; row < normalized.height; row += 1) {
    for (let column = 0; column < normalized.width; column += 1) {
      const offset = (row * normalized.width + column) * 4;
      const ratio = scale.toRatio(band[row][column]);
      if (Number.isNaN(ratio)) continue;
      const color = geophysicsScaleColor(palette, ratio, reverse);
      const illumination = shade ? (1 - strength) + strength * shade[row][column] : 1;
      pixels[offset] = color[0] * illumination;
      pixels[offset + 1] = color[1] * illumination;
      pixels[offset + 2] = color[2] * illumination;
      pixels[offset + 3] = 255;
    }
  }

  return {
    data: pixels,
    width: normalized.width,
    height: normalized.height,
    range: scale.limits,
    scale,
    zFactor,
  };
}
