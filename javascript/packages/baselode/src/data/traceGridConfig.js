/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const DEFAULT_TRACE_PLOT_COUNT = 4;

export function reorderHoleIds(ids = [], focusId = '') {
  if (!ids.length) return [];
  if (!focusId) return ids;
  const matchIdx = ids.findIndex((id) => id === focusId);
  if (matchIdx === -1) return ids;
  const selected = ids[matchIdx];
  const rest = ids.filter((_, idx) => idx !== matchIdx);
  return [selected, ...rest];
}

export function coerceChartTypeForProperty({
  property = '',
  chartType = '',
  categoricalProps = [],
  numericDefaultChartType = 'markers+line'
} = {}) {
  if (!property) return chartType || numericDefaultChartType;
  const isCategorical = categoricalProps.includes(property);
  if (isCategorical) return 'categorical';
  if (!chartType || chartType === 'categorical') return numericDefaultChartType;
  return chartType;
}

export function buildTraceConfigsForHoleIds({
  holeIds = [],
  focusedHoleId = '',
  plotCount = DEFAULT_TRACE_PLOT_COUNT,
  defaultProp = '',
  categoricalProps = [],
  numericDefaultChartType = 'markers+line'
} = {}) {
  const ordered = reorderHoleIds(holeIds, focusedHoleId);
  return Array.from({ length: plotCount }).map((_, idx) => {
    const holeId = ordered[idx] || holeIds[idx] || '';
    const chartType = coerceChartTypeForProperty({
      property: defaultProp,
      chartType: '',
      categoricalProps,
      numericDefaultChartType
    });
    return {
      holeId,
      property: defaultProp,
      chartType
    };
  });
}