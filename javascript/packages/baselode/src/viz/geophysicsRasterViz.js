/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
  createGeophysicsRaster,
  geophysicsRasterRange,
  getGeophysicsRasterBand,
} from '../data/geophysicsRaster.js';

const PALETTES = Object.freeze({
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  terrain: [[30, 60, 35], [88, 125, 55], [191, 171, 105], [238, 233, 196], [255, 255, 255]],
  grayscale: [[0, 0, 0], [255, 255, 255]],
  magnetic: [[21, 32, 90], [37, 105, 172], [242, 235, 199], [205, 81, 56], [91, 24, 48]],
});

export const GEOPHYSICS_PALETTES = Object.freeze(Object.keys(PALETTES));

/**
 * Resolve an ordered low/high range for rendering.  Values outside the range
 * are clipped, rather than discarded, which is the conventional raster
 * display meaning of low/high pass controls.
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

/**
 * Compute an illuminated-relief factor for one band. Azimuth is degrees
 * clockwise from north; altitude is degrees above the horizon.
 */
export function geophysicsHillshade(raster, options = {}) {
  const normalized = raster?.bandCount ? raster : createGeophysicsRaster(raster);
  const band = getGeophysicsRasterBand(normalized, options.band ?? 1);
  const azimuth = Number(options.azimuth ?? 315);
  const altitude = Number(options.altitude ?? 45);
  const [a, , , , e] = normalized.transform;
  const cellX = Math.abs(a) || 1;
  const cellY = Math.abs(e) || 1;
  const zenith = (90 - altitude) * Math.PI / 180;
  const azimuthRadians = (360 - azimuth + 90) * Math.PI / 180;
  const output = band.map((row, rowIndex) => row.map((value, columnIndex) => {
    if (!isRenderable(value, normalized.nodata)) return 0;
    const left = neighbour(band, rowIndex, columnIndex - 1, value, normalized.nodata);
    const right = neighbour(band, rowIndex, columnIndex + 1, value, normalized.nodata);
    const up = neighbour(band, rowIndex - 1, columnIndex, value, normalized.nodata);
    const down = neighbour(band, rowIndex + 1, columnIndex, value, normalized.nodata);
    const dzdx = (right - left) / (2 * cellX);
    const dzdy = (down - up) / (2 * cellY);
    const slope = Math.atan(Math.hypot(dzdx, dzdy));
    const aspect = Math.atan2(dzdy, -dzdx);
    const intensity = Math.cos(zenith) * Math.cos(slope)
      + Math.sin(zenith) * Math.sin(slope) * Math.cos(azimuthRadians - aspect);
    return Math.max(0, Math.min(1, intensity));
  }));
  return output;
}

/**
 * Convert a numeric raster band into Canvas ImageData-compatible RGBA bytes.
 */
export function renderGeophysicsRaster(raster, options = {}) {
  const normalized = raster?.bandCount ? raster : createGeophysicsRaster(raster);
  const bandIndex = options.band ?? 1;
  const band = getGeophysicsRasterBand(normalized, bandIndex);
  const palette = PALETTES[options.palette ?? 'viridis'];
  if (!palette) throw new RangeError(`Unknown geophysics palette: ${options.palette}`);
  const range = normalizeGeophysicsClipRange(normalized, options.clipRange, bandIndex);
  const hillshadeOptions = options.hillshade ?? {};
  const shade = hillshadeOptions.enabled
    ? geophysicsHillshade(normalized, { ...hillshadeOptions, band: bandIndex })
    : null;
  const strength = Math.max(0, Math.min(1, Number(hillshadeOptions.strength ?? 0.65)));
  const pixels = new Uint8ClampedArray(normalized.width * normalized.height * 4);

  for (let row = 0; row < normalized.height; row += 1) {
    for (let column = 0; column < normalized.width; column += 1) {
      const offset = (row * normalized.width + column) * 4;
      const value = band[row][column];
      if (!isRenderable(value, normalized.nodata)) {
        pixels[offset + 3] = 0;
        continue;
      }
      const ratio = Math.max(0, Math.min(1, (value - range[0]) / (range[1] - range[0] || 1)));
      const color = interpolatePalette(palette, ratio);
      const illumination = shade ? (1 - strength) + strength * shade[row][column] : 1;
      pixels[offset] = color[0] * illumination;
      pixels[offset + 1] = color[1] * illumination;
      pixels[offset + 2] = color[2] * illumination;
      pixels[offset + 3] = 255;
    }
  }

  return { data: pixels, width: normalized.width, height: normalized.height, range };
}

function isRenderable(value, nodata) {
  return Number.isFinite(value) && value !== nodata;
}

function neighbour(band, row, column, fallback, nodata) {
  const value = band[Math.max(0, Math.min(band.length - 1, row))][Math.max(0, Math.min(band[0].length - 1, column))];
  return isRenderable(value, nodata) ? value : fallback;
}

function interpolatePalette(palette, ratio) {
  const position = ratio * (palette.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(palette.length - 1, lower + 1);
  const portion = position - lower;
  return palette[lower].map((channel, index) => Math.round(channel + (palette[upper][index] - channel) * portion));
}
