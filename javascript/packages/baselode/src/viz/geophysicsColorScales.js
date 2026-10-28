/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import scalesDoc from '../data/geophysics_color_scales.json';

/**
 * Named colour scales: ordered RGB stops from low to high values. The same
 * stops ship in Python as `baselode.geophysics.colour_scales.COLOUR_SCALES`.
 */
export const GEOPHYSICS_COLOR_SCALES = Object.freeze(scalesDoc.scales);

export const GEOPHYSICS_PALETTES = Object.freeze(Object.keys(GEOPHYSICS_COLOR_SCALES));

/**
 * How data values map onto a colour scale:
 * - `relative`: percentile clip (`low`/`high`, default 2/98), follows the data.
 * - `absolute`: fixed `min`/`max` in data units, for comparing grids.
 * - `equalize`: histogram equalisation; each colour covers an equal share of cells.
 */
export const GEOPHYSICS_STRETCH_MODES = Object.freeze(['relative', 'absolute', 'equalize']);

export const DEFAULT_GEOPHYSICS_STRETCH = Object.freeze({ mode: 'relative', low: 2, high: 98 });

/**
 * Validate a stretch object and fill in defaults.
 *
 * @param {object} [stretch]
 * @returns {{mode: string, low?: number, high?: number, min?: number, max?: number}}
 */
export function normalizeGeophysicsStretch(stretch) {
  const value = stretch ?? DEFAULT_GEOPHYSICS_STRETCH;
  if (!GEOPHYSICS_STRETCH_MODES.includes(value.mode)) {
    throw new RangeError(`stretch mode must be one of ${GEOPHYSICS_STRETCH_MODES.join(', ')}.`);
  }
  if (value.mode === 'relative') {
    const low = Number(value.low ?? 2);
    const high = Number(value.high ?? 98);
    if (!(low >= 0 && low < high && high <= 100)) {
      throw new RangeError('relative stretch needs 0 <= low < high <= 100 (percentiles).');
    }
    return { mode: 'relative', low, high };
  }
  if (value.mode === 'absolute') {
    const min = Number(value.min);
    const max = Number(value.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < max)) {
      throw new RangeError('absolute stretch needs finite min < max in data units.');
    }
    return { mode: 'absolute', min, max };
  }
  return { mode: 'equalize' };
}

/**
 * Linear-interpolated percentile of a sorted array (NumPy's default method).
 *
 * @param {number[]|Float64Array} sorted
 * @param {number} percent - 0..100
 * @returns {number}
 */
export function sortedPercentile(sorted, percent) {
  const position = (percent / 100) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function searchSorted(sorted, value, right) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (right ? sorted[middle] <= value : sorted[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Build a value -> colour-position mapping for one band.
 *
 * @param {Iterable<number|null>} values - Band cells (any iteration order).
 * @param {object} [stretch] - See {@link normalizeGeophysicsStretch}.
 * @param {number|null} [nodata]
 * @returns {{stretch: object, limits: [number, number], toRatio: (value: number) => number, valueAt: (ratio: number) => number}}
 *   `toRatio` returns 0..1 (NaN for missing values); `valueAt` inverts it
 *   for colour-bar ticks.
 */
export function createGeophysicsStretch(values, stretch, nodata = null) {
  const normalized = normalizeGeophysicsStretch(stretch);
  const finite = [];
  for (const value of values) {
    if (isGeophysicsValue(value, nodata)) finite.push(value);
  }
  if (finite.length === 0) throw new RangeError('Raster band contains no finite values.');
  const sorted = Float64Array.from(finite).sort();

  if (normalized.mode === 'equalize') {
    const last = sorted.length - 1;
    return {
      stretch: normalized,
      limits: [sorted[0], sorted[last]],
      toRatio: (value) => {
        if (!isGeophysicsValue(value, nodata)) return NaN;
        if (last === 0) return 0.5;
        // Mid-rank: tied values share one colour.
        const left = searchSorted(sorted, value, false);
        const right = searchSorted(sorted, value, true);
        return (left + right - 1) / 2 / last;
      },
      valueAt: (ratio) => sortedPercentile(sorted, ratio * 100),
    };
  }

  const [low, high] = normalized.mode === 'relative'
    ? [sortedPercentile(sorted, normalized.low), sortedPercentile(sorted, normalized.high)]
    : [normalized.min, normalized.max];
  const span = high - low;
  return {
    stretch: normalized,
    limits: [low, high],
    toRatio: (value) => {
      if (!isGeophysicsValue(value, nodata)) return NaN;
      if (!(span > 0)) return 0.5;
      return Math.max(0, Math.min(1, (value - low) / span));
    },
    valueAt: (ratio) => low + ratio * span,
  };
}

/**
 * Interpolate an RGB colour for a 0..1 position.
 *
 * @param {string} palette - Name in {@link GEOPHYSICS_COLOR_SCALES}.
 * @param {number} ratio
 * @param {boolean} [reverse=false]
 * @returns {[number, number, number]} 0-255 channels.
 */
export function geophysicsScaleColor(palette, ratio, reverse = false) {
  const stops = GEOPHYSICS_COLOR_SCALES[palette];
  if (!stops) throw new RangeError(`Unknown geophysics palette: ${palette}`);
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const position = (reverse ? 1 - clamped : clamped) * (stops.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(stops.length - 1, lower + 1);
  const portion = position - lower;
  // Round half to even, as NumPy does, so Python and browser renders agree.
  return stops[lower].map((channel, index) => roundHalfEven(channel + (stops[upper][index] - channel) * portion));
}

/**
 * CSS `linear-gradient` for a colour bar.
 *
 * @param {string} palette
 * @param {boolean} [reverse=false]
 * @returns {string}
 */
export function geophysicsColorGradient(palette, reverse = false) {
  const stops = GEOPHYSICS_COLOR_SCALES[palette];
  if (!stops) throw new RangeError(`Unknown geophysics palette: ${palette}`);
  const ordered = reverse ? [...stops].reverse() : stops;
  const parts = ordered.map(([r, g, b], index) => `rgb(${r}, ${g}, ${b}) ${(index / (ordered.length - 1)) * 100}%`);
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

export function isGeophysicsValue(value, nodata) {
  return typeof value === 'number' && Number.isFinite(value) && value !== nodata;
}

function roundHalfEven(value) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}
