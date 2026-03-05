/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
// Shared drillhole 2D visualization helpers for reuse beyond the UI layer.
// These helpers build Plotly-ready data/layout objects based on interval points.

/** Default color for numeric line traces */
export const NUMERIC_LINE_COLOR = '#8b1e3f';

/** Default color for numeric markers */
export const NUMERIC_MARKER_COLOR = '#a8324f';

/** Color for error bars */
export const ERROR_COLOR = '#6b7280';

/** Default compact strip-log margins */
export const STRIPLOG_COMPACT_MARGIN = { l: 42, r: 4, t: 4, b: 30 };

/** Default strip-log axis tick size */
export const STRIPLOG_AXIS_TICK_FONT_SIZE = 10;

/** Default strip-log axis title size */
export const STRIPLOG_AXIS_TITLE_FONT_SIZE = 12;

function normalizeAxisTitle(t) {
  if (!t) return {};
  return typeof t === 'string' ? { text: t } : t;
}

function applyStriplogLayoutDefaults(layout = {}) {
  const xTitle = normalizeAxisTitle(layout.xaxis && layout.xaxis.title);
  const yTitle = normalizeAxisTitle(layout.yaxis && layout.yaxis.title);
  return {
    ...layout,
    margin: STRIPLOG_COMPACT_MARGIN,
    autosize: true,
    width: undefined,
    xaxis: {
      ...(layout.xaxis || {}),
      tickfont: {
        ...((layout.xaxis && layout.xaxis.tickfont) || {}),
        size: STRIPLOG_AXIS_TICK_FONT_SIZE,
      },
      title: {
        ...xTitle,
        font: { ...(xTitle.font || {}), size: STRIPLOG_AXIS_TITLE_FONT_SIZE },
      },
    },
    yaxis: {
      ...(layout.yaxis || {}),
      automargin: true,
      tickfont: {
        ...((layout.yaxis && layout.yaxis.tickfont) || {}),
        size: STRIPLOG_AXIS_TICK_FONT_SIZE,
      },
      title: {
        ...yTitle,
        font: { ...(yTitle.font || {}), size: STRIPLOG_AXIS_TITLE_FONT_SIZE },
      },
    },
  };
}

/**
 * Check if a hole has data for a specific property
 * @param {Object} hole - Hole object with points array
 * @param {string} property - Property name to check
 * @returns {boolean} True if hole has at least one valid value for the property
 */
export function holeHasData(hole, property) {
  if (!hole || !property) return false;
  const pts = hole.points || [];
  for (let i = 0; i < pts.length; i += 1) {
    const value = pts[i]?.[property];
    if (value === undefined || value === null) continue;
    if (typeof value === 'number' && Number.isFinite(value)) return true;
    if (typeof value === 'string' && value.trim() !== '') return true;
  }
  return false;
}

/**
 * Build array of interval points for visualization from hole data
 * Extracts depth intervals and property values, deduplicates, and sorts by depth
 * @param {Object} hole - Hole object with points array
 * @param {string} property - Property name to extract
 * @param {boolean} isCategorical - Whether property is categorical (vs numeric)
 * @returns {Array<{z: number, val: *, from: number, to: number, errorPlus: number, errorMinus: number}>} Array of interval points
 */
export function buildIntervalPoints(hole, property, isCategorical) {
  if (!hole || !property) return [];
  const rawPoints = hole?.points || [];
  const out = [];
  const seen = new Set();
  rawPoints.forEach((p) => {
    let fromVal = Number(
      p.from ??
      p.samp_from ??
      p.sample_from ??
      p.fromdepth ??
      p.from_depth ??
      p.depth_from
    );
    let toVal = Number(
      p.to ??
      p.samp_to ??
      p.sample_to ??
      p.todepth ??
      p.to_depth ??
      p.depth_to
    );
    // Fall back to depth for point-schema data (e.g. structural measurements)
    if (!Number.isFinite(fromVal) || !Number.isFinite(toVal)) {
      const depthVal = Number(p.depth ?? p.md);
      if (Number.isFinite(depthVal)) {
        fromVal = depthVal;
        toVal = depthVal;
      }
    }
    const rawVal = p?.[property];
    if (!Number.isFinite(fromVal) || !Number.isFinite(toVal) || toVal < fromVal) return;
    if (rawVal === undefined || rawVal === null || rawVal === '') return;
    if (isCategorical && typeof rawVal === 'string' && /^(nan|null|none)$/i.test(rawVal.trim())) return;
    const key = `${property}:${fromVal}-${toVal}:${String(rawVal)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const mid = (fromVal + toVal) / 2;
    const val = isCategorical ? rawVal : Number(rawVal);
    if (!isCategorical && !Number.isFinite(val)) return;
    out.push({
      z: mid,
      val,
      from: fromVal,
      to: toVal,
      errorPlus: toVal - mid,
      errorMinus: mid - fromVal
    });
  });
  return out.sort((a, b) => b.z - a.z);
}

/**
 * Build Plotly configuration for categorical property visualization
 * @private
 * @param {Array<Object>} points - Interval points array
 * @param {string} property - Property name for title
 * @returns {{data: Array, layout: Object}} Plotly data and layout configuration
 */
function buildCategoricalConfig(points, property) {
  if (!points.length) return { data: [], layout: {} };
  const safe = points
    .filter((point) => Number.isFinite(point?.from) && Number.isFinite(point?.to) && point.to > point.from)
    .map((point) => ({ ...point, category: `${point?.val ?? ''}`.trim() }))
    .filter((point) => point.category !== '' && !/^(nan|null|none)$/i.test(point.category))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  if (!safe.length) return { data: [], layout: {} };

  const palette = [
    '#1f77b4', // blue
    '#ff7f0e', // orange
    '#2ca02c', // green
    '#d62728', // red
    '#9467bd', // purple
    '#17becf', // cyan
    '#bcbd22', // olive
    '#e377c2', // pink
    '#8c564b', // brown
    '#393b79', // indigo
    '#e6550d', // deep orange
    '#31a354', // deep green
    '#756bb1', // violet
    '#636363', // dark gray
  ];
  const uniqueCategories = [...new Set(safe.map((point) => point.category))];
  const colorByCategory = new Map(uniqueCategories.map((category, idx) => [category, palette[idx % palette.length]]));

  // One bar trace per unique category. Each bar starts at `base` (from depth)
  // and has height (to - from). barmode:'overlay' lets non-overlapping intervals
  // from different traces coexist at the same x position.
  const traces = uniqueCategories.map((cat) => {
    const intervals = safe.filter((seg) => seg.category === cat);
    return {
      type: 'bar',
      x: intervals.map(() => 0.5),
      y: intervals.map((s) => s.to - s.from),
      base: intervals.map((s) => s.from),
      width: 1,
      marker: { color: colorByCategory.get(cat), line: { width: 0 } },
      name: cat,
      showlegend: false,
      customdata: intervals.map((s) => [s.from, s.to]),
      hovertemplate: `${property}: ${cat}<br>from: %{customdata[0]:.3f} to: %{customdata[1]:.3f}<extra></extra>`,
    };
  });

  const layout = {
    barmode: 'overlay',
    bargap: 0,
    xaxis: { range: [0, 1], visible: false, fixedrange: true },
    yaxis: { title: 'Depth (m)', autorange: 'reversed', zeroline: false },
    showlegend: false,
    title: property || undefined
  };

  return { data: traces, layout: applyStriplogLayoutDefaults(layout) };
}

/**
 * Build Plotly configuration for numeric property visualization
 * @private
 * @param {Array<Object>} points - Interval points array
 * @param {string} property - Property name for axis label
 * @param {string} chartType - Chart type ('bar', 'markers', 'line', 'markers+line')
 * @returns {{data: Array, layout: Object}} Plotly data and layout configuration
 */
function buildNumericConfig(points, property, chartType) {
  if (!points.length) return { data: [], layout: {} };
  const isBar = chartType === 'bar';
  const isMarkersOnly = chartType === 'markers';
  const isLineOnly = chartType === 'line';

  const baseTrace = {
    x: points.map((p) => p.val),
    y: points.map((p) => p.z),
    hovertemplate: `${property}: %{x}<br>from: %{customdata[0]:.3f} to: %{customdata[1]:.3f}<extra></extra>`,
    customdata: points.map((p) => [Math.min(p.from, p.to), Math.max(p.from, p.to)])
  };

  const errorConfig = {
    type: 'data',
    symmetric: false,
    array: points.map((p) => p.errorPlus),
    arrayminus: points.map((p) => p.errorMinus),
    thickness: 1.5,
    width: 2,
    color: ERROR_COLOR
  };

  const trace = isBar
    ? {
        ...baseTrace,
        type: 'bar',
        orientation: 'h',
        marker: { color: NUMERIC_LINE_COLOR },
        error_y: errorConfig
      }
    : {
        ...baseTrace,
        type: 'scatter',
        mode: isMarkersOnly ? 'markers' : isLineOnly ? 'lines' : 'lines+markers',
        line: { color: NUMERIC_LINE_COLOR, width: 2 },
        marker: { size: 7, color: NUMERIC_MARKER_COLOR },
        error_y: isLineOnly ? undefined : errorConfig
      };

  const layout = {
    xaxis: { title: property, zeroline: false },
    yaxis: { title: 'Depth (m)', autorange: 'reversed', zeroline: false },
    barmode: 'overlay',
    showlegend: false
  };

  return { data: [trace], layout: applyStriplogLayoutDefaults(layout) };
}

/**
 * Build complete Plotly configuration for property visualization
 * @param {Object} options - Configuration options
 * @param {Array<Object>} options.points - Interval points to visualize
 * @param {boolean} options.isCategorical - Whether property is categorical
 * @param {string} options.property - Property name
 * @param {string} options.chartType - Chart type ('bar', 'markers', 'line', 'categorical', etc.)
 * @returns {{data: Array, layout: Object}} Complete Plotly configuration
 */
export function buildPlotConfig({ points, isCategorical, property, chartType }) {
  if (!points || !points.length || !property) return { data: [], layout: {} };
  if (isCategorical || chartType === 'categorical') {
    return buildCategoricalConfig(points, property);
  }
  return buildNumericConfig(points, property, chartType);
}

/**
 * Build a categorical strip-log Plotly config directly from interval rows.
 * @param {Array<Object>} rows - Interval rows (e.g. geology)
 * @param {Object} options - Field mapping options
 * @param {string} options.fromCol - From-depth column
 * @param {string} options.toCol - To-depth column
 * @param {string} options.categoryCol - Category label column
 * @returns {{data: Array, layout: Object}} Plotly configuration for strip-log rendering
 */
export function buildCategoricalStripLogConfig(
  rows = [],
  {
    fromCol = 'from',
    toCol = 'to',
    categoryCol = 'geology_code'
  } = {}
) {
  const points = [];
  rows.forEach((row) => {
    const from = Number(row?.[fromCol]);
    const to = Number(row?.[toCol]);
    const category = row?.[categoryCol];
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
    if (category === undefined || category === null || `${category}`.trim() === '') return;
    const mid = (from + to) / 2;
    points.push({
      z: mid,
      val: `${category}`,
      from,
      to,
      errorPlus: to - mid,
      errorMinus: mid - from
    });
  });

  points.sort((a, b) => b.z - a.z);
  return buildPlotConfig({
    points,
    isCategorical: true,
    property: categoryCol,
    chartType: 'categorical'
  });
}
