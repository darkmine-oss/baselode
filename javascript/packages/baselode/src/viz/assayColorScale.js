/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

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

export function buildEqualRangeColorScale(values = [], colors = ASSAY_COLOR_PALETTE_10) {
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
    count += 1;
  }

  if (!count) {
    return {
      min: null,
      max: null,
      step: null,
      bins: [],
      colors
    };
  }

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

  const step = (max - min) / binCount;
  const bins = colors.map((_, index) => {
    const lower = min + (step * index);
    const upper = index === binCount - 1 ? max : min + (step * (index + 1));
    return {
      index,
      min: lower,
      max: upper,
      label: `${lower.toFixed(3)} - ${upper.toFixed(3)}`
    };
  });

  return {
    min,
    max,
    step,
    bins,
    colors
  };
}

export function getEqualRangeBinIndex(value, scale) {
  if (!Number.isFinite(value) || !scale || !Array.isArray(scale.bins) || !scale.bins.length) {
    return -1;
  }

  if (scale.max === scale.min) {
    return value === scale.min ? 0 : -1;
  }

  const step = scale.step;
  if (!Number.isFinite(step) || step <= 0) return -1;
  const rawIndex = Math.floor((value - scale.min) / step);
  return Math.max(0, Math.min(scale.bins.length - 1, rawIndex));
}

export function getEqualRangeColor(value, scale, fallbackColor = '#8b1e3f') {
  const index = getEqualRangeBinIndex(value, scale);
  if (index < 0) return fallbackColor;
  return scale.colors[index] || fallbackColor;
}
