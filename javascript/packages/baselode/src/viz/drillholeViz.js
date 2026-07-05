/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
// Shared drillhole 2D visualization helpers for reuse beyond the UI layer.
// These helpers build Plotly-ready data/layout objects based on interval points.

import { getColour, resolveColourMap, COMMODITY_COLOURS } from './colourMap.js';
import { BASELODE_TEMPLATE } from './baselodeTemplate.js';
import { ASSAY_COLOR_PALETTE_10 } from './assayColorScale.js';
import { formatPropertyLabel, resolvePropertyLabelParts } from '../data/propertyLabels.js';

/**
 * Build the hover-tooltip prefix pieces for a property.
 * Returns the value-line label, the unit suffix (e.g. " ppm") and the
 * trailing `Source: …<br>` line — all empty strings when no metadata applies,
 * so callers stay byte-identical to the pre-metadata output.
 * @param {string} property
 * @param {import('../data/propertyLabels.js').PropertyMeta} [meta]
 * @returns {{ label: string, unitSuffix: string, sourceLine: string }}
 */
function buildHoverParts(property, meta) {
  const { label, unit, source } = resolvePropertyLabelParts(property, meta);
  return {
    label,
    unitSuffix: unit ? ` ${unit}` : '',
    sourceLine: source ? `Source: ${source}<br>` : '',
  };
}

/** Default color for numeric line traces */
export const NUMERIC_LINE_COLOR = '#8b1e3f';

/** Default color for numeric markers */
export const NUMERIC_MARKER_COLOR = '#a8324f';

/**
 * Auto-detect a commodity colour for a column name such as "Au_ppm" or "Cu_eq".
 * Splits on `_`, `-`, `/`, or whitespace and checks each token against
 * COMMODITY_COLOURS (exact match first, then case-insensitive).
 * Returns null when no commodity element is recognised.
 * @param {string} property
 * @returns {string|null}
 */
export function commodityColourForProperty(property) {
  if (!property) return null;
  const tokens = property.split(/[_\-/\s]+/);
  for (const token of tokens) {
    if (Object.prototype.hasOwnProperty.call(COMMODITY_COLOURS, token)) {
      return COMMODITY_COLOURS[token];
    }
    const low = token.toLowerCase();
    for (const [key, colour] of Object.entries(COMMODITY_COLOURS)) {
      if (key.toLowerCase() === low) return colour;
    }
  }
  return null;
}

/**
 * Qualitative colorway for multi-assay overlays — used when a series'
 * column name does not resolve to a known commodity colour. Distinct,
 * legible hues that read well against the Baselode dark/light templates.
 */
export const MULTI_SERIES_COLORWAY = [
  '#4e79a7', '#f28e2b', '#59a14f', '#e15759',
  '#b07aa1', '#76b7b2', '#edc948', '#ff9da7',
  '#9c755f', '#bab0ac',
];

/**
 * Pick a stable colour for an assay series: its commodity colour when the
 * column name encodes one (e.g. "Au_ppm" → gold), else a colorway entry.
 * @param {string} property
 * @param {number} index - Series index, used to index the fallback colorway
 * @returns {string}
 */
function seriesColour(property, index) {
  return commodityColourForProperty(property)
    || MULTI_SERIES_COLORWAY[index % MULTI_SERIES_COLORWAY.length];
}

/**
 * Return a colour with the given alpha as an `rgba(...)` string. Accepts a
 * `#rgb`/`#rrggbb` hex; any other input is returned unchanged (already-rgba
 * or named colours pass through).
 * @param {string} colour
 * @param {number} alpha - 0–1 opacity
 * @returns {string}
 */
function withAlpha(colour, alpha) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(`${colour}`.trim());
  if (!hex) return colour;
  let body = hex[1];
  if (body.length === 3) body = body.split('').map((c) => c + c).join('');
  const num = parseInt(body, 16);
  const red = (num >> 16) & 255;
  const green = (num >> 8) & 255;
  const blue = num & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/**
 * Convert a hex colour ramp into a Plotly `colorscale` — an array of
 * `[stop, colour]` pairs with stops evenly spread across `[0, 1]`.
 * @param {Array<string>} palette - Ordered low→high hex colours
 * @returns {Array<[number, string]>}
 */
export function buildPlotlyColorscale(palette = ASSAY_COLOR_PALETTE_10) {
  const colors = Array.isArray(palette) && palette.length ? palette : ASSAY_COLOR_PALETTE_10;
  if (colors.length === 1) return [[0, colors[0]], [1, colors[0]]];
  const last = colors.length - 1;
  return colors.map((colour, idx) => [idx / last, colour]);
}

/**
 * Assign each numeric interval point the category of the colour-by segment
 * that contains its mid-depth. Segments are `{ from, to, val }` interval
 * rows (e.g. lithology) for the same hole. Points with no containing
 * segment get `null`.
 * @param {Array<Object>} points - Numeric interval points (with `z` mid-depth)
 * @param {Array<Object>} segments - Categorical interval rows `{ from, to, val }`
 * @returns {Array<string|null>} Category per point, index-aligned with `points`
 */
export function assignCategoriesByDepth(points = [], segments = []) {
  const safe = (segments || [])
    .filter((s) => Number.isFinite(s?.from) && Number.isFinite(s?.to) && s.to >= s.from)
    .map((s) => ({ from: s.from, to: s.to, val: `${s.val ?? ''}`.trim() }))
    .filter((s) => s.val !== '' && !/^(nan|null|none)$/i.test(s.val))
    .sort((a, b) => a.from - b.from);
  return points.map((p) => {
    const depth = Number.isFinite(p?.z) ? p.z : (p.from + p.to) / 2;
    const hit = safe.find((s) => depth >= s.from && depth <= s.to);
    return hit ? hit.val : null;
  });
}

/** Color for error bars */
export const ERROR_COLOR = '#6b7280';

/** Default compact strip-log margins */
export const STRIPLOG_COMPACT_MARGIN = { l: 42, r: 4, t: 4, b: 36 };

/** Default strip-log axis tick size */
export const STRIPLOG_AXIS_TICK_FONT_SIZE = 10;

/** Default strip-log axis title size */
export const STRIPLOG_AXIS_TITLE_FONT_SIZE = 11;

/** Spacing between the base x-axis tick labels and its title (pixels) */
export const STRIPLOG_XAXIS_TITLE_STANDOFF = 6;

function normalizeAxisTitle(t) {
  if (!t) return {};
  return typeof t === 'string' ? { text: t } : t;
}

function applyStriplogLayoutDefaults(layout = {}) {
  const xTitle = normalizeAxisTitle(layout.xaxis && layout.xaxis.title);
  const yTitle = normalizeAxisTitle(layout.yaxis && layout.yaxis.title);
  return {
    ...layout,
    // Respect an explicit margin (e.g. widened right gutter for a colour bar);
    // otherwise fall back to the compact strip-log default.
    margin: layout.margin || STRIPLOG_COMPACT_MARGIN,
    // Strip logs read down-hole, so hover horizontally along depth: a spike line
    // at the hovered depth and a single unified box listing every trace's value
    // there. Depth is the shared Y axis, hence unify on Y.
    hovermode: layout.hovermode || 'y unified',
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
        standoff: xTitle.standoff ?? STRIPLOG_XAXIS_TITLE_STANDOFF,
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
 * @param {Object|string|null} [colourMap] - Optional semantic colour map (object or built-in name)
 * @param {Object} [template] - Plotly template to include in layout
 * @param {import('../data/propertyLabels.js').PropertyMeta} [meta] - Optional per-property metadata
 * @returns {{data: Array, layout: Object}} Plotly data and layout configuration
 */
function buildCategoricalConfig(points, property, colourMap, template, meta) {
  if (!points.length) return { data: [], layout: {} };
  const safe = points
    .filter((point) => Number.isFinite(point?.from) && Number.isFinite(point?.to) && point.to > point.from)
    .map((point) => ({ ...point, category: `${point?.val ?? ''}`.trim() }))
    .filter((point) => point.category !== '' && !/^(nan|null|none)$/i.test(point.category))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  if (!safe.length) return { data: [], layout: {} };

  const resolvedCmap = resolveColourMap(colourMap);

  const fallbackPalette = [
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

  function pickColour(cat, idx) {
    if (resolvedCmap && Object.keys(resolvedCmap).length > 0) {
      const c = getColour(cat, resolvedCmap, null);
      if (c !== null) return c;
    }
    return fallbackPalette[idx % fallbackPalette.length];
  }

  const colorByCategory = new Map(
    uniqueCategories.map((category, idx) => [category, pickColour(category, idx)])
  );

  const hover = buildHoverParts(property, meta);

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
      hovertemplate: `${hover.label}: ${cat}<br>${hover.sourceLine}from: %{customdata[0]:.3f} to: %{customdata[1]:.3f}<extra></extra>`,
    };
  });

  const layout = {
    barmode: 'overlay',
    bargap: 0,
    xaxis: { range: [0, 1], visible: false, fixedrange: true },
    yaxis: { title: 'Depth (m)', autorange: 'reversed', zeroline: false },
    showlegend: false,
    title: formatPropertyLabel(property, meta) || undefined,
    template: template !== undefined ? template : BASELODE_TEMPLATE,
  };

  return { data: traces, layout: applyStriplogLayoutDefaults(layout) };
}

/** Build the shared `customdata` ([fromDepth, toDepth]) array for numeric points. */
function numericCustomdata(points) {
  return points.map((p) => [Math.min(p.from, p.to), Math.max(p.from, p.to)]);
}

/** Build the shared numeric layout (depth axis reversed, value axis titled). */
function numericLayout(property, meta, template, extraXaxis) {
  return {
    xaxis: { title: formatPropertyLabel(property, meta), zeroline: false, ...extraXaxis },
    yaxis: { title: 'Depth (m)', autorange: 'reversed', zeroline: false },
    barmode: 'overlay',
    showlegend: false,
    template: template !== undefined ? template : BASELODE_TEMPLATE,
  };
}

/**
 * Graded (value-coloured) line: a thin neutral connecting line with markers
 * coloured by the assay value on a sequential ramp, plus a slim colour bar.
 * @private
 */
function buildGradedLineConfig(points, property, template, meta) {
  const vals = points.map((p) => p.val);
  const cmin = Math.min(...vals);
  const cmax = Math.max(...vals);
  const hover = buildHoverParts(property, meta);

  const trace = {
    x: vals,
    y: points.map((p) => p.z),
    customdata: numericCustomdata(points),
    hovertemplate: `${hover.label}: %{x}${hover.unitSuffix}<br>${hover.sourceLine}from: %{customdata[0]:.3f} to: %{customdata[1]:.3f}<extra></extra>`,
    type: 'scatter',
    mode: 'lines+markers',
    line: { color: 'rgba(136,136,136,0.45)', width: 1 },
    marker: {
      size: 8,
      color: vals,
      colorscale: buildPlotlyColorscale(ASSAY_COLOR_PALETTE_10),
      cmin,
      cmax,
      showscale: true,
      colorbar: { thickness: 8, len: 0.92, x: 1.02, xanchor: 'left', tickfont: { size: 9 } },
    },
  };

  const layout = numericLayout(property, meta, template);
  // Widen the right gutter so the colour bar has room outside the plot area.
  layout.margin = { ...STRIPLOG_COMPACT_MARGIN, r: 30 };
  return { data: [trace], layout: applyStriplogLayoutDefaults(layout) };
}

/**
 * Colour a numeric track by a separate categorical column. Each numeric
 * point is assigned the category of the colour-by interval covering its
 * mid-depth; one trace per category gives a legend. For `bar` the categories
 * become coloured horizontal bars; otherwise a neutral connecting line is
 * drawn under per-category markers.
 * @private
 */
function buildCategoryColouredNumericConfig(points, property, chartType, colorBy, template, meta) {
  const categories = assignCategoriesByDepth(points, colorBy.segments);
  const resolvedCmap = resolveColourMap(colorBy.colourMap);
  const hover = buildHoverParts(property, meta);
  const colorByLabel = colorBy.label || colorBy.property || 'category';
  const customdata = points.map((p, i) => [
    Math.min(p.from, p.to),
    Math.max(p.from, p.to),
    categories[i] ?? '—',
  ]);
  const hovertemplate = `${hover.label}: %{x}${hover.unitSuffix}<br>${hover.sourceLine}${colorByLabel}: %{customdata[2]}<br>from: %{customdata[0]:.3f} to: %{customdata[1]:.3f}<extra></extra>`;

  const uniqueCats = [...new Set(categories.filter((c) => c != null))];
  const fallbackPalette = MULTI_SERIES_COLORWAY;
  const colourForCat = new Map(
    uniqueCats.map((cat, idx) => {
      const mapped = resolvedCmap && Object.keys(resolvedCmap).length > 0
        ? getColour(cat, resolvedCmap, null)
        : null;
      return [cat, mapped || fallbackPalette[idx % fallbackPalette.length]];
    })
  );
  const UNCATEGORISED = '#9ca3af';

  const isBar = chartType === 'bar';
  const includeLine = !isBar && chartType !== 'markers';
  const data = [];

  // A single neutral connecting line keeps the downhole trend readable
  // across category changes (only for line-bearing chart types).
  if (includeLine) {
    data.push({
      x: points.map((p) => p.val),
      y: points.map((p) => p.z),
      type: 'scatter',
      mode: 'lines',
      line: { color: 'rgba(136,136,136,0.5)', width: 1.5 },
      hoverinfo: 'skip',
      showlegend: false,
    });
  }

  // One trace per category so the legend lists the colour-by values.
  const groups = [...uniqueCats, null];
  groups.forEach((cat) => {
    const idxs = points.map((_, i) => i).filter((i) => categories[i] === cat);
    if (!idxs.length) return;
    const colour = cat == null ? UNCATEGORISED : colourForCat.get(cat);
    const common = {
      x: idxs.map((i) => points[i].val),
      y: idxs.map((i) => points[i].z),
      customdata: idxs.map((i) => customdata[i]),
      hovertemplate,
      name: cat == null ? 'Uncategorised' : cat,
      showlegend: true,
    };
    if (isBar) {
      data.push({
        ...common,
        type: 'bar',
        orientation: 'h',
        // Horizontal bar: length = value (x, from 0), positioned at the
        // interval mid-depth (y) with thickness = interval length so adjacent
        // intervals form a continuous column coloured by category.
        width: idxs.map((i) => Math.max(Math.abs(points[i].to - points[i].from), 0.01)),
        marker: { color: colour },
      });
    } else {
      data.push({
        ...common,
        type: 'scatter',
        mode: 'markers',
        marker: { size: 8, color: colour },
      });
    }
  });

  const layout = numericLayout(property, meta, template);
  layout.showlegend = true;
  layout.legend = { orientation: 'h', y: 1.02, yanchor: 'bottom', x: 0, font: { size: 9 } };
  if (isBar) layout.barmode = 'overlay';
  return { data, layout: applyStriplogLayoutDefaults(layout) };
}

/**
 * Build Plotly configuration for numeric property visualization
 * @private
 * @param {Array<Object>} points - Interval points array
 * @param {string} property - Property name for axis label
 * @param {string} chartType - Chart type ('bar', 'markers', 'line', 'markers+line', 'colored-line')
 * @param {string} [color] - Override colour for line/markers (e.g. commodity colour)
 * @param {Object} [template] - Plotly template to include in layout
 * @param {import('../data/propertyLabels.js').PropertyMeta} [meta] - Optional per-property metadata
 * @param {Object} [colorBy] - Optional colour-by-category spec
 *   `{ property, label?, segments: [{from,to,val}], colourMap? }`. When present,
 *   the track is coloured by category instead of by the assay value.
 * @returns {{data: Array, layout: Object}} Plotly data and layout configuration
 */
function buildNumericConfig(points, property, chartType, color, template, meta, colorBy) {
  if (!points.length) return { data: [], layout: {} };

  if (colorBy && Array.isArray(colorBy.segments) && colorBy.segments.length) {
    return buildCategoryColouredNumericConfig(points, property, chartType, colorBy, template, meta);
  }
  if (chartType === 'colored-line') {
    return buildGradedLineConfig(points, property, template, meta);
  }

  const isBar = chartType === 'bar';
  const isMarkersOnly = chartType === 'markers';
  const isLineOnly = chartType === 'line';

  const lineColor = color || NUMERIC_LINE_COLOR;
  const markerColor = color || NUMERIC_MARKER_COLOR;

  const hover = buildHoverParts(property, meta);

  const baseTrace = {
    x: points.map((p) => p.val),
    y: points.map((p) => p.z),
    hovertemplate: `${hover.label}: %{x}${hover.unitSuffix}<br>${hover.sourceLine}from: %{customdata[0]:.3f} to: %{customdata[1]:.3f}<extra></extra>`,
    customdata: numericCustomdata(points)
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
        // Each bar spans its own down-hole interval (thickness = to − from),
        // so the interval extent is shown by the bar itself — no error bars.
        width: points.map((p) => Math.max(Math.abs(p.to - p.from), 0.01)),
        marker: { color: lineColor }
      }
    : {
        ...baseTrace,
        type: 'scatter',
        mode: isMarkersOnly ? 'markers' : isLineOnly ? 'lines' : 'lines+markers',
        line: { color: lineColor, width: 2 },
        marker: { size: 7, color: markerColor },
        error_y: isLineOnly ? undefined : errorConfig
      };

  return { data: [trace], layout: applyStriplogLayoutDefaults(numericLayout(property, meta, template)) };
}

/**
 * Build a Plotly config that plots several numeric assays in one track.
 *
 * Two modes:
 * - `'multi-line'` (default): one line per assay. Each assay is normalised to
 *   its own [min,max] so curves with different magnitudes are comparable on a
 *   shared 0–1 axis; the true value is preserved in the hover tooltip.
 * - `'multi-stacked'`: horizontal bars per interval, stacked across assays
 *   (`barmode:'stack'`), so each interval shows the assays' additive contribution.
 *
 * @param {Object} options
 * @param {Array<{property: string, points: Array<Object>, color?: string}>} options.series
 *   One entry per assay; `points` are interval points from {@link buildIntervalPoints}.
 * @param {string} [options.mode='multi-line'] - `'multi-line'` or `'multi-stacked'`
 * @param {Object} [options.template] - Plotly template (defaults to the Baselode template)
 * @param {Object<string, import('../data/propertyLabels.js').PropertyMeta>} [options.metaByProperty]
 *   Optional per-property metadata map used for legend labels and hover units.
 * @returns {{data: Array, layout: Object}} Plotly data and layout configuration
 */
export function buildMultiAssayConfig({ series = [], mode = 'multi-line', template, metaByProperty = {} } = {}) {
  const usable = (series || []).filter((s) => s && s.property && Array.isArray(s.points) && s.points.length);
  if (!usable.length) return { data: [], layout: {} };

  const stacked = mode === 'multi-stacked';

  const data = usable.map((s, idx) => {
    const meta = metaByProperty?.[s.property];
    const hover = buildHoverParts(s.property, meta);
    const colour = s.color || seriesColour(s.property, idx);
    const name = formatPropertyLabel(s.property, meta) || s.property;
    const vals = s.points.map((p) => p.val);

    if (stacked) {
      return {
        type: 'bar',
        orientation: 'h',
        // Floor bar length at 0: a stacked column shows additive contribution,
        // so a below-detection assay (negative sentinel, e.g. -2 = "below 2 ppm")
        // must contribute nothing rather than stack leftward of zero. The true
        // reported value is preserved in the hover via customdata[0].
        x: vals.map((v) => Math.max(v, 0)),
        y: s.points.map((p) => p.z),
        width: s.points.map((p) => Math.max(Math.abs(p.to - p.from), 0.01)),
        marker: { color: colour },
        name,
        showlegend: true,
        // [trueValue, fromDepth, toDepth] — hover shows the real reported value.
        customdata: s.points.map((p) => [p.val, Math.min(p.from, p.to), Math.max(p.from, p.to)]),
        // Depth-unified hover: the shared depth is the box header, so drop the
        // per-row from/to. Keep the element label in the body — in unified mode
        // `<extra></extra>` hides the trace name, so the label must be inline or
        // the row would show only a colour swatch and a bare value.
        hovertemplate: `${hover.label}: %{customdata[0]}${hover.unitSuffix}<extra></extra>`,
      };
    }

    // Stack the raw assay values as cumulative filled areas (Plotly
    // `stackgroup`, horizontal) instead of overlapping lines. Below-detection
    // sentinels (negative, e.g. -2 = "below 2 ppm") are floored at 0 so they
    // add nothing to the stack; the true reported value stays in the hover.
    return {
      type: 'scatter',
      mode: 'lines',
      stackgroup: 'assays',
      orientation: 'h',
      x: vals.map((v) => Math.max(v, 0)),
      y: s.points.map((p) => p.z),
      line: { color: colour, width: 1.5 },
      fillcolor: withAlpha(colour, 0.5),
      name,
      showlegend: true,
      // [trueValue, fromDepth, toDepth] — hover shows the real reported value.
      customdata: s.points.map((p) => [p.val, Math.min(p.from, p.to), Math.max(p.from, p.to)]),
      // Depth-unified hover: the shared depth is the box header, so drop the
      // per-row from/to. Keep the element label in the body — in unified mode
      // `<extra></extra>` hides the trace name, so the label must be inline or
      // the row would show only a colour swatch and a bare value.
      hovertemplate: `${hover.label}: %{customdata[0]}${hover.unitSuffix}<extra></extra>`,
    };
  });

  const layout = {
    xaxis: { title: 'Value (stacked)', zeroline: false },
    yaxis: { title: 'Depth (m)', autorange: 'reversed', zeroline: false },
    barmode: stacked ? 'stack' : 'overlay',
    showlegend: true,
    legend: { orientation: 'h', y: 1.02, yanchor: 'bottom', x: 0, font: { size: 9 } },
    template: template !== undefined ? template : BASELODE_TEMPLATE,
  };

  return { data, layout: applyStriplogLayoutDefaults(layout) };
}

/**
 * Build complete Plotly configuration for property visualization
 * @param {Object} options - Configuration options
 * @param {Array<Object>} options.points - Interval points to visualize
 * @param {boolean} options.isCategorical - Whether property is categorical
 * @param {string} options.property - Property name
 * @param {string} options.chartType - Chart type ('bar', 'markers', 'line', 'categorical', etc.)
 * @param {Object|string|null} [options.colourMap] - Optional semantic colour map (object or built-in name)
 * @param {Object} [options.template] - Plotly template to apply. Defaults to the Baselode template.
 * @param {import('../data/propertyLabels.js').PropertyMeta} [options.meta] - Optional per-property
 *   metadata (unit / source attribute) used for axis titles and hover tooltips.
 * @param {Object} [options.colorBy] - Optional colour-by-category spec for numeric tracks
 *   `{ property, label?, segments: [{from,to,val}], colourMap? }`.
 * @param {Array<Object>} [options.series] - Multi-assay series for `multi-line`/`multi-stacked`
 *   chart types; `[{ property, points, color? }]`. When present, overrides the single-property path.
 * @param {Object} [options.metaByProperty] - Per-property metadata map for multi-assay legends/hover.
 * @returns {{data: Array, layout: Object}} Complete Plotly configuration
 */
export function buildPlotConfig({
  points, isCategorical, property, chartType, colourMap, template, meta, colorBy, series, metaByProperty,
}) {
  // Multi-assay path: render several assays in one track when a series is supplied.
  if ((chartType === 'multi-line' || chartType === 'multi-stacked') && Array.isArray(series) && series.length) {
    return buildMultiAssayConfig({ series, mode: chartType, template, metaByProperty });
  }
  if (!points || !points.length || !property) return { data: [], layout: {} };
  if (isCategorical || chartType === 'categorical') {
    return buildCategoricalConfig(points, property, colourMap, template, meta);
  }
  const colour = commodityColourForProperty(property);
  return buildNumericConfig(points, property, chartType, colour, template, meta, colorBy);
}

/**
 * Build a categorical strip-log Plotly config directly from interval rows.
 * @param {Array<Object>} rows - Interval rows (e.g. geology)
 * @param {Object} options - Field mapping options
 * @param {string} options.fromCol - From-depth column
 * @param {string} options.toCol - To-depth column
 * @param {string} options.categoryCol - Category label column
 * @param {Object|string|null} [options.colourMap] - Optional semantic colour map (object or built-in name)
 * @param {Object} [options.template] - Plotly template to apply. Defaults to the Baselode template.
 * @returns {{data: Array, layout: Object}} Plotly configuration for strip-log rendering
 */
export function buildCategoricalStripLogConfig(
  rows = [],
  {
    fromCol = 'from',
    toCol = 'to',
    categoryCol = 'geology_code',
    colourMap = null,
    template = undefined,
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
    chartType: 'categorical',
    colourMap,
    template,
  });
}
