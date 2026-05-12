/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Default number of trace plots in a grid */
export const DEFAULT_TRACE_PLOT_COUNT = 4;

/**
 * Reorder hole IDs to place a focused hole first
 * @param {Array<string>} ids - Array of hole IDs
 * @param {string} focusId - Hole ID to place first
 * @returns {Array<string>} Reordered array with focusId first if found
 */
export function reorderHoleIds(ids = [], focusId = '') {
  if (!ids.length) return [];
  if (!focusId) return ids;
  const matchIdx = ids.findIndex((id) => id === focusId);
  if (matchIdx === -1) return ids;
  const selected = ids[matchIdx];
  const rest = ids.filter((_, idx) => idx !== matchIdx);
  return [selected, ...rest];
}

/**
 * Determine appropriate chart type for a property.
 * Photo / comment / categorical / tadpole columns each have a single chart type;
 * numeric columns use the requested type or the default.
 *
 * @param {Object} options - Configuration options
 * @param {string} options.property - Property name
 * @param {string} options.chartType - Requested chart type
 * @param {Array<string>} options.categoricalProps - List of categorical property names
 * @param {Array<string>} options.commentProps - List of comment property names
 * @param {Array<string>} options.photoProps - List of photo property names
 * @param {string} options.numericDefaultChartType - Default chart type for numeric properties
 * @returns {string} Coerced chart type ('photo', 'comment', 'categorical', 'line', 'markers+line', etc.)
 */
export function coerceChartTypeForProperty({
  property = '',
  chartType = '',
  categoricalProps = [],
  commentProps = [],
  photoProps = [],
  numericDefaultChartType = 'markers+line'
} = {}) {
  if (!property) return chartType || numericDefaultChartType;
  if (photoProps.includes(property)) return 'photo';
  if (commentProps.includes(property)) return 'comment';
  if (categoricalProps.includes(property)) return 'categorical';
  if (property === 'dip') return 'tadpole';
  if (!chartType || chartType === 'categorical' || chartType === 'comment' || chartType === 'tadpole' || chartType === 'photo') return numericDefaultChartType;
  return chartType;
}

/**
 * Build trace plot configuration objects for a grid of hole IDs
 * @param {Object} options - Configuration options
 * @param {Array<string>} options.holeIds - Array of hole IDs
 * @param {string} options.focusedHoleId - Hole ID to focus (place first)
 * @param {number} options.plotCount - Number of plots in grid
 * @param {string} options.defaultProp - Default property to display
 * @param {Array<string>} options.categoricalProps - List of categorical properties
 * @param {Array<string>} options.commentProps - List of comment properties
 * @param {Array<string>} options.photoProps - List of photo properties
 * @param {string} options.numericDefaultChartType - Default chart type for numeric props
 * @returns {Array<{holeId: string, property: string, chartType: string}>} Array of trace configurations
 */
export function buildTraceConfigsForHoleIds({
  holeIds = [],
  focusedHoleId = '',
  plotCount = DEFAULT_TRACE_PLOT_COUNT,
  defaultProp = '',
  categoricalProps = [],
  commentProps = [],
  photoProps = [],
  numericDefaultChartType = 'markers+line'
} = {}) {
  const ordered = reorderHoleIds(holeIds, focusedHoleId);
  return Array.from({ length: plotCount }).map((_, idx) => {
    const holeId = ordered[idx] || holeIds[idx] || '';
    const chartType = coerceChartTypeForProperty({
      property: defaultProp,
      chartType: '',
      categoricalProps,
      commentProps,
      photoProps,
      numericDefaultChartType
    });
    return {
      holeId,
      property: defaultProp,
      chartType
    };
  });
}