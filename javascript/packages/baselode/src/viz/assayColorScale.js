/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Default 10-color palette for assay visualization (blue to red gradient) */
export const ASSAY_COLOR_PALETTE_10 = [
  '#313695',
  '#4575b4',
  '#74add1',
  '#abd9e9',
  '#e0f3f8',
  '#fee090',
  '#fdae61',
  '#f46d43',
  '#d73027',
  '#a50026'
];

/**
 * Build an equal-range color scale from numeric values
 * Uses percentile-based binning for better distribution with outliers
 * @param {Array<number>} values - Array of numeric values to analyze
 * @param {Array<string>} colors - Array of color hex strings to use for bins
 * @returns {{min: number|null, max: number|null, step: number|null, bins: Array<{index: number, min: number, max: number, label: string}>, colors: Array<string>}} Color scale object
 */
export function buildEqualRangeColorScale(values = [], colors = ASSAY_COLOR_PALETTE_10) {
  // Filter to finite values and sort
  const finiteValues = values.filter((v) => Number.isFinite(v));
  
  if (!finiteValues.length) {
    return {
      min: null,
      max: null,
      step: null,
      bins: [],
      colors
    };
  }

  const sorted = finiteValues.slice().sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const binCount = colors.length;

  if (max === min) {
    const bins = colors.map((_, index) => ({
      index,
      min,
      max,
      label: `${min}`
    }));
    return {
      min,
      max,
      step: 0,
      bins,
      colors
    };
  }

  // Use percentile-based binning for better distribution
  const bins = colors.map((_, index) => {
    const percentileLow = index / binCount;
    const percentileHigh = (index + 1) / binCount;
    const idxLow = Math.floor(percentileLow * sorted.length);
    const idxHigh = Math.min(sorted.length - 1, Math.floor(percentileHigh * sorted.length));
    const lower = sorted[idxLow];
    const upper = index === binCount - 1 ? max : sorted[idxHigh];
    
    return {
      index,
      min: lower,
      max: upper,
      label: formatBinLabel(lower, upper)
    };
  });

  const step = (max - min) / binCount;

  return {
    min,
    max,
    step,
    bins,
    colors
  };
}

/**
 * Format bin label with appropriate precision
 * @private
 */
function formatBinLabel(min, max) {
  const formatVal = (v) => {
    if (!Number.isFinite(v)) return 'n/a';
    if (Math.abs(v) >= 1000) return v.toFixed(0);
    if (Math.abs(v) >= 10) return v.toFixed(1);
    if (Math.abs(v) >= 0.1) return v.toFixed(2);
    return v.toFixed(3);
  };
  return `${formatVal(min)} – ${formatVal(max)}`;
}

/**
 * Get the bin index for a value in a color scale
 * @param {number} value - Value to find bin for
 * @param {Object} scale - Color scale object from buildEqualRangeColorScale
 * @returns {number} Bin index (0 to bins.length-1) or -1 if invalid
 */
export function getEqualRangeBinIndex(value, scale) {
  if (!Number.isFinite(value) || !scale || !Array.isArray(scale.bins) || !scale.bins.length) {
    return -1;
  }

  if (scale.max === scale.min) {
    return value === scale.min ? 0 : -1;
  }

  // Find the bin that contains this value
  for (let i = 0; i < scale.bins.length; i += 1) {
    const bin = scale.bins[i];
    if (value >= bin.min && (value <= bin.max || i === scale.bins.length - 1)) {
      return i;
    }
  }

  // Value is out of range
  return -1;
}

/**
 * Get the color for a value using an equal-range color scale
 * @param {number} value - Value to get color for
 * @param {Object} scale - Color scale object from buildEqualRangeColorScale
 * @param {string} fallbackColor - Color to use if value is invalid or out of range
 * @returns {string} Color hex string
 */
export function getEqualRangeColor(value, scale, fallbackColor = '#8b1e3f') {
  const index = getEqualRangeBinIndex(value, scale);
  if (index < 0) return fallbackColor;
  return scale.colors[index] || fallbackColor;
}
