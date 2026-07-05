/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
// Shared drillhole 2D visualization helpers for reuse beyond the UI layer.
// These helpers build Plotly-ready data/layout objects based on interval points.

import { getColour, resolveColourMap, resolvePatternMap, COMMODITY_COLOURS } from './colourMap.js';
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
 * @param {Object|string|null} [patternMap] - Optional hatch-pattern map (object or built-in name,
 *   e.g. `'lithology'`) of category → Plotly pattern shape; unmapped categories render solid
 * @returns {{data: Array, layout: Object}} Plotly data and layout configuration
 */
function buildCategoricalConfig(points, property, colourMap, template, meta, patternMap) {
  if (!points.length) return { data: [], layout: {} };
  const safe = points
    .filter((point) => Number.isFinite(point?.from) && Number.isFinite(point?.to) && point.to > point.from)
    .map((point) => ({ ...point, category: `${point?.val ?? ''}`.trim() }))
    .filter((point) => point.category !== '' && !/^(nan|null|none)$/i.test(point.category))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  if (!safe.length) return { data: [], layout: {} };

  const resolvedCmap = resolveColourMap(colourMap);
  const resolvedPmap = resolvePatternMap(patternMap);

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
    const bandColour = colorByCategory.get(cat);
    // Optional hatch overlay: a white pattern at low solidity over the band
    // colour, so the fill still reads as the category colour. Categories with
    // no mapped shape emit no pattern dict — byte-identical to the solid path.
    const patternShape = getColour(cat, resolvedPmap, '');
    const marker = { color: bandColour, line: { width: 0 } };
    if (patternShape) {
      marker.pattern = {
        shape: patternShape,
        solidity: 0.3,
        fgcolor: '#ffffff',
        bgcolor: bandColour,
        size: 6,
      };
    }
    return {
      type: 'bar',
      x: intervals.map(() => 0.5),
      y: intervals.map((s) => s.to - s.from),
      base: intervals.map((s) => s.from),
      width: 1,
      marker,
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
 * Filled line: the `line` chart type with the area between the curve and
 * x=0 shaded in the series colour at low alpha. Interval mids, no error bars.
 * @private
 */
function buildFilledLineConfig(points, property, color, template, meta, logScale) {
  const lineColor = color || NUMERIC_LINE_COLOR;
  const hover = buildHoverParts(property, meta);

  const trace = {
    x: points.map((p) => p.val),
    y: points.map((p) => p.z),
    customdata: numericCustomdata(points),
    hovertemplate: `${hover.label}: %{x}${hover.unitSuffix}<br>${hover.sourceLine}from: %{customdata[0]:.3f} to: %{customdata[1]:.3f}<extra></extra>`,
    type: 'scatter',
    mode: 'lines',
    // Value is on x, so fill toward x=0 ("tozerox"), not the y baseline.
    fill: 'tozerox',
    fillcolor: withAlpha(lineColor, 0.35),
    line: { color: lineColor, width: 2 },
  };

  const layout = numericLayout(property, meta, template, logScale ? { type: 'log' } : undefined);
  return { data: [trace], layout: applyStriplogLayoutDefaults(layout) };
}

/**
 * Stepped line: honours interval extents (blocked/composited assays). Each
 * interval contributes two vertices — (val, from) and (val, to) — sorted
 * shallow→deep in one polyline, so consecutive intervals join with a vertical
 * jump at the shared boundary. Gaps between intervals stay connected (no
 * nulls); the extent is explicit in the step, so no error bars.
 * @private
 */
function buildStepLineConfig(points, property, color, template, meta, logScale) {
  const lineColor = color || NUMERIC_LINE_COLOR;
  const hover = buildHoverParts(property, meta);

  const ordered = [...points].sort((a, b) => a.z - b.z);
  const xVals = [];
  const yVals = [];
  const customdata = [];
  ordered.forEach((point) => {
    const fromDepth = Math.min(point.from, point.to);
    const toDepth = Math.max(point.from, point.to);
    xVals.push(point.val, point.val);
    yVals.push(fromDepth, toDepth);
    customdata.push([fromDepth, toDepth], [fromDepth, toDepth]);
  });

  const trace = {
    x: xVals,
    y: yVals,
    customdata,
    hovertemplate: `${hover.label}: %{x}${hover.unitSuffix}<br>${hover.sourceLine}from: %{customdata[0]:.3f} to: %{customdata[1]:.3f}<extra></extra>`,
    type: 'scatter',
    mode: 'lines',
    line: { color: lineColor, width: 2 },
  };

  const layout = numericLayout(property, meta, template, logScale ? { type: 'log' } : undefined);
  return { data: [trace], layout: applyStriplogLayoutDefaults(layout) };
}

/**
 * Heat strip: continuous grade display. One full-width horizontal bar per
 * interval, coloured by the assay value on the sequential ramp, with a slim
 * colour bar. The dummy bar length (x=1) never reaches the hover — the
 * template reports the value and from–to interval instead.
 * @private
 */
function buildHeatStripConfig(points, property, template, meta) {
  const vals = points.map((p) => p.val);
  const cmin = Math.min(...vals);
  const cmax = Math.max(...vals);
  const hover = buildHoverParts(property, meta);

  const trace = {
    type: 'bar',
    orientation: 'h',
    x: points.map(() => 1),
    base: 0,
    y: points.map((p) => p.z),
    width: points.map((p) => Math.max(Math.abs(p.to - p.from), 0.01)),
    marker: {
      color: vals,
      colorscale: buildPlotlyColorscale(ASSAY_COLOR_PALETTE_10),
      cmin,
      cmax,
      showscale: true,
      colorbar: { thickness: 8, len: 0.92, x: 1.02, xanchor: 'left', tickfont: { size: 9 } },
      line: { width: 0 },
    },
    customdata: points.map((p) => [Math.min(p.from, p.to), Math.max(p.from, p.to), p.val]),
    hovertemplate: `${hover.label}: %{customdata[2]}${hover.unitSuffix}<br>${hover.sourceLine}from: %{customdata[0]:.3f} to: %{customdata[1]:.3f}<extra></extra>`,
    showlegend: false,
  };

  const layout = numericLayout(property, meta, template, {
    range: [0, 1],
    fixedrange: true,
    showticklabels: false,
    ticks: '',
    title: '',
  });
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
  const isLine = chartType === 'line';
  const nameForCat = (cat) => (cat == null ? 'Uncategorised' : cat);
  const colourForCatOrNull = (cat) => (cat == null ? UNCATEGORISED : colourForCat.get(cat));
  const data = [];

  if (isLine) {
    // "Line only": colour the line itself by category. One segment per
    // consecutive category run (no markers), each bridged to the next point so
    // the downhole line stays continuous across category boundaries.
    const seenLegend = new Set();
    let start = 0;
    while (start < points.length) {
      let end = start;
      while (end + 1 < points.length && categories[end + 1] === categories[start]) end += 1;
      const runIdxs = [];
      for (let i = start; i <= end; i += 1) runIdxs.push(i);
      if (end + 1 < points.length) runIdxs.push(end + 1); // bridge to the next run
      const name = nameForCat(categories[start]);
      const showlegend = !seenLegend.has(name);
      seenLegend.add(name);
      data.push({
        x: runIdxs.map((i) => points[i].val),
        y: runIdxs.map((i) => points[i].z),
        customdata: runIdxs.map((i) => customdata[i]),
        hovertemplate,
        type: 'scatter',
        mode: 'lines',
        line: { color: colourForCatOrNull(categories[start]), width: 2 },
        name,
        legendgroup: name,
        showlegend,
      });
      start = end + 1;
    }
  } else {
    // A single neutral connecting line keeps the downhole trend readable
    // across category changes (markers+line only; markers/bar draw none).
    if (chartType === 'markers+line') {
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
      const colour = colourForCatOrNull(cat);
      const common = {
        x: idxs.map((i) => points[i].val),
        y: idxs.map((i) => points[i].z),
        customdata: idxs.map((i) => customdata[i]),
        hovertemplate,
        name: nameForCat(cat),
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
  }

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
 *   the track is coloured by category instead of by the assay value. Ignored
 *   for filled-line / step-line / heat-strip, whose geometry or colour already
 *   encodes the value.
 * @param {Object} [options] - Extra numeric-track options. `logScale` (default
 *   false) puts the value axis on a log scale for bar / markers / markers+line /
 *   line / filled-line / step-line; other chart types ignore it.
 * @returns {{data: Array, layout: Object}} Plotly data and layout configuration
 */
function buildNumericConfig(points, property, chartType, color, template, meta, colorBy, options = {}) {
  if (!points.length) return { data: [], layout: {} };

  const logScale = options.logScale === true;

  // Colour-by only composes with the chart types the category-coloured
  // builder implements; filled-line / step-line keep their geometry and
  // heat-strip's colour already encodes the value, so those types win.
  const chartTypeOverridesColorBy = chartType === 'filled-line'
    || chartType === 'step-line'
    || chartType === 'heat-strip';
  if (colorBy && !chartTypeOverridesColorBy && Array.isArray(colorBy.segments) && colorBy.segments.length) {
    const colouredConfig = buildCategoryColouredNumericConfig(points, property, chartType, colorBy, template, meta);
    if (logScale && ['bar', 'markers', 'markers+line', 'line'].includes(chartType)) {
      colouredConfig.layout = {
        ...colouredConfig.layout,
        xaxis: { ...colouredConfig.layout?.xaxis, type: 'log' },
      };
    }
    return colouredConfig;
  }
  if (chartType === 'colored-line') {
    return buildGradedLineConfig(points, property, template, meta);
  }
  if (chartType === 'filled-line') {
    return buildFilledLineConfig(points, property, color, template, meta, logScale);
  }
  if (chartType === 'step-line') {
    return buildStepLineConfig(points, property, color, template, meta, logScale);
  }
  if (chartType === 'heat-strip') {
    return buildHeatStripConfig(points, property, template, meta);
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

  const layout = numericLayout(property, meta, template, logScale ? { type: 'log' } : undefined);
  return { data: [trace], layout: applyStriplogLayoutDefaults(layout) };
}

/**
 * Align several assay series onto a shared depth grid (the union of every
 * series' intervals, keyed by from/to). Assays are sampled on the same
 * intervals but individual cells may be blank, so each series carries a
 * different subset of points; a stacked area/bar densifies onto the union of
 * depths, and any densified point without a matching row loses its hover
 * `customdata`. Filling every series across the full grid (missing cells → 0,
 * which is also how below-detection is treated) keeps the arrays index-aligned
 * so every hover row resolves.
 * @private
 * @param {Array<{property: string, points: Array<Object>}>} series
 * @returns {Array<{property: string, points: Array<Object>}>} Series with points over the shared grid
 */
function alignSeriesToCommonDepths(series) {
  const gridByKey = new Map();
  series.forEach((s) => s.points.forEach((p) => {
    const key = `${p.from}|${p.to}`;
    if (!gridByKey.has(key)) gridByKey.set(key, { z: p.z, from: p.from, to: p.to });
  }));
  // Deep → shallow, matching the order buildIntervalPoints emits.
  const grid = [...gridByKey.values()].sort((a, b) => b.z - a.z);
  return series.map((s) => {
    const byKey = new Map(s.points.map((p) => [`${p.from}|${p.to}`, p]));
    const points = grid.map((cell) => byKey.get(`${cell.from}|${cell.to}`)
      || { z: cell.z, from: cell.from, to: cell.to, val: 0 });
    return { ...s, points };
  });
}

/**
 * Build a Plotly config that plots several numeric assays in one track.
 *
 * Two modes:
 * - `'multi-line'` (default): a stacked area per assay (Plotly `stackgroup`),
 *   plotting raw values; below-detection sentinels are floored at 0.
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
  // Stack/densify onto a shared depth grid so every hover row has customdata.
  const aligned = alignSeriesToCommonDepths(usable);

  const data = aligned.map((s, idx) => {
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
        hovertemplate: `${hover.label}: %{customdata[0]:.4~r}${hover.unitSuffix}<extra></extra>`,
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
      hovertemplate: `${hover.label}: %{customdata[0]:.4~r}${hover.unitSuffix}<extra></extra>`,
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
 * @param {boolean} [options.logScale=false] - Log-scale the numeric value axis. Applies to the
 *   bar / markers / markers+line / line / filled-line / step-line chart types; ignored otherwise.
 * @param {Object|string|null} [options.patternMap] - Optional hatch-pattern map for categorical
 *   bands (object or built-in name, e.g. `'lithology'`).
 * @returns {{data: Array, layout: Object}} Complete Plotly configuration
 */
export function buildPlotConfig({
  points, isCategorical, property, chartType, colourMap, template, meta, colorBy, series, metaByProperty,
  logScale, patternMap,
}) {
  // Multi-assay path: render several assays in one track when a series is supplied.
  if ((chartType === 'multi-line' || chartType === 'multi-stacked') && Array.isArray(series) && series.length) {
    return buildMultiAssayConfig({ series, mode: chartType, template, metaByProperty });
  }
  if (!points || !points.length || !property) return { data: [], layout: {} };
  if (isCategorical || chartType === 'categorical') {
    return buildCategoricalConfig(points, property, colourMap, template, meta, patternMap);
  }
  const colour = commodityColourForProperty(property);
  // Fall back to the track's `colourMap` for the colour-by categories so a
  // configured semantic map (e.g. lithology) drives the legend colours; an
  // explicit `colorBy.colourMap` still wins.
  const resolvedColorBy = colorBy && colorBy.colourMap == null && colourMap != null
    ? { ...colorBy, colourMap }
    : colorBy;
  return buildNumericConfig(points, property, chartType, colour, template, meta, resolvedColorBy, { logScale });
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

/**
 * Linearly interpolate a series of interval points onto arbitrary depths.
 * Depths outside the series' span clamp to the nearest end value so the
 * result is always finite.
 * @private
 * @param {Array<Object>} points - Interval points (uses `z` mid-depth and `val`)
 * @param {Array<number>} depths - Target depths
 * @returns {Array<number>} Interpolated values, index-aligned with `depths`
 */
function interpolateSeriesAtDepths(points, depths) {
  const ordered = [...points].sort((a, b) => a.z - b.z);
  const depthsAsc = ordered.map((point) => point.z);
  const valsAsc = ordered.map((point) => point.val);
  const lastIndex = depthsAsc.length - 1;
  return depths.map((depth) => {
    if (depth <= depthsAsc[0]) return valsAsc[0];
    if (depth >= depthsAsc[lastIndex]) return valsAsc[lastIndex];
    let upper = 1;
    while (depthsAsc[upper] < depth) upper += 1;
    const lower = upper - 1;
    const span = depthsAsc[upper] - depthsAsc[lower];
    const fraction = span === 0 ? 0 : (depth - depthsAsc[lower]) / span;
    return valsAsc[lower] + fraction * (valsAsc[upper] - valsAsc[lower]);
  });
}

/**
 * Build a two-curve fill (cross-plot) track: two numeric curves down the hole
 * with the region between them shaded, flipping colour exactly at each
 * crossover — the classic neutron–density display.
 *
 * Both properties are sampled onto the union of their interval mid-depths
 * (linear interpolation), crossing depths are computed by linear interpolation
 * and the fill is split there: where A > B the band is colour A at alpha 0.4,
 * where B > A it is colour B. Fill runs are drawn as an invisible anchor trace
 * plus a `fill: "tonextx"` trace (`hoverinfo: "skip"`); hover lives on the two
 * main curves.
 *
 * @param {Object} options
 * @param {Object} options.hole - Hole object with a points array
 * @param {string} options.propertyA - First numeric property
 * @param {string} options.propertyB - Second numeric property
 * @param {string} [options.colorA] - Curve A colour (defaults to its commodity
 *   colour or MULTI_SERIES_COLORWAY[0])
 * @param {string} [options.colorB] - Curve B colour (defaults to its commodity
 *   colour or MULTI_SERIES_COLORWAY[1])
 * @param {boolean} [options.logScale=false] - Log-scale the value axis
 * @param {string} [options.title] - Optional layout title
 * @param {Object} [options.template] - Plotly template (defaults to the Baselode template)
 * @returns {{data: Array, layout: Object}} Plotly data and layout configuration
 */
export function buildTwoCurveFillConfig({
  hole, propertyA, propertyB, colorA, colorB, logScale = false, title, template,
} = {}) {
  const pointsA = buildIntervalPoints(hole, propertyA, false);
  const pointsB = buildIntervalPoints(hole, propertyB, false);
  if (!pointsA.length || !pointsB.length) return { data: [], layout: {} };

  const curveColourA = colorA || seriesColour(propertyA, 0);
  const curveColourB = colorB || seriesColour(propertyB, 1);

  // Union depth grid (ascending) with both curves interpolated onto it.
  const depths = [...new Set([...pointsA, ...pointsB].map((point) => point.z))].sort(
    (first, second) => first - second
  );
  const valsA = interpolateSeriesAtDepths(pointsA, depths);
  const valsB = interpolateSeriesAtDepths(pointsB, depths);

  // Augment the sampled polylines with the exact crossing points so the fill
  // colour flips precisely where the curves intersect.
  const augmented = [];
  for (let index = 0; index < depths.length; index += 1) {
    augmented.push({ depth: depths[index], valA: valsA[index], valB: valsB[index] });
    if (index === depths.length - 1) break;
    const diffHere = valsA[index] - valsB[index];
    const diffNext = valsA[index + 1] - valsB[index + 1];
    if (diffHere * diffNext < 0) {
      const fraction = diffHere / (diffHere - diffNext);
      const crossDepth = depths[index] + fraction * (depths[index + 1] - depths[index]);
      const crossVal = valsA[index] + fraction * (valsA[index + 1] - valsA[index]);
      augmented.push({ depth: crossDepth, valA: crossVal, valB: crossVal });
    }
  }

  // Split into constant-sign runs. Crossing points carry sign 0 and terminate
  // the current run while seeding the next, so adjacent fills share the vertex.
  const runs = [];
  let runPoints = [augmented[0]];
  let runSign = Math.sign(augmented[0].valA - augmented[0].valB);
  for (let index = 1; index < augmented.length; index += 1) {
    const sample = augmented[index];
    const sampleSign = Math.sign(sample.valA - sample.valB);
    runPoints.push(sample);
    if (runSign === 0) runSign = sampleSign;
    if (sampleSign === 0 && index < augmented.length - 1) {
      runs.push({ points: runPoints, sign: runSign });
      runPoints = [sample];
      runSign = 0;
    }
  }
  runs.push({ points: runPoints, sign: runSign });

  const data = [];
  runs.forEach((run) => {
    if (run.sign === 0 || run.points.length < 2) return;
    const fillColour = run.sign > 0
      ? withAlpha(curveColourA, 0.4)
      : withAlpha(curveColourB, 0.4);
    // Invisible anchor along curve B, then curve A filled back to it.
    data.push({
      type: 'scatter',
      mode: 'lines',
      x: run.points.map((sample) => sample.valB),
      y: run.points.map((sample) => sample.depth),
      line: { width: 0 },
      hoverinfo: 'skip',
      showlegend: false,
    });
    data.push({
      type: 'scatter',
      mode: 'lines',
      x: run.points.map((sample) => sample.valA),
      y: run.points.map((sample) => sample.depth),
      line: { width: 0 },
      fill: 'tonextx',
      fillcolor: fillColour,
      hoverinfo: 'skip',
      showlegend: false,
    });
  });

  // The two visible curves carry the hover and the legend.
  data.push({
    type: 'scatter',
    mode: 'lines',
    x: valsA,
    y: depths,
    line: { color: curveColourA, width: 2 },
    name: propertyA,
    showlegend: true,
    hovertemplate: `${propertyA}: %{x}<br>depth: %{y:.3f}<extra></extra>`,
  });
  data.push({
    type: 'scatter',
    mode: 'lines',
    x: valsB,
    y: depths,
    line: { color: curveColourB, width: 2 },
    name: propertyB,
    showlegend: true,
    hovertemplate: `${propertyB}: %{x}<br>depth: %{y:.3f}<extra></extra>`,
  });

  const layout = {
    xaxis: {
      title: `${propertyA} / ${propertyB}`,
      zeroline: false,
      ...(logScale ? { type: 'log' } : {}),
    },
    yaxis: { title: 'Depth (m)', autorange: 'reversed', zeroline: false },
    showlegend: true,
    legend: { orientation: 'h', y: 1.02, yanchor: 'bottom', x: 0, font: { size: 9 } },
    title: title || undefined,
    template: template !== undefined ? template : BASELODE_TEMPLATE,
  };

  return { data, layout: applyStriplogLayoutDefaults(layout) };
}

/**
 * Build a percent-composition track: divided horizontal stacked bars per
 * interval, one trace per component (legend + stack order follow the
 * `properties` order).
 *
 * With `normalize` (default) each interval's components are scaled to
 * fractions of their sum, the x-axis is fixed to [0, 1] titled "Fraction" and
 * formatted as percentages; otherwise raw values are stacked on an autoranged
 * axis. Intervals whose components are all null/zero are skipped; negative
 * values are clamped to 0 for the bar while the raw value stays in the hover
 * (same convention as the multi-assay below-detection handling).
 *
 * @param {Object} options
 * @param {Object} options.hole - Hole object with a points array
 * @param {Array<string>} options.properties - Component columns, in stack order
 * @param {Object|string|null} [options.colourMap] - Optional semantic colour map
 *   (object or built-in name); components missing from it fall back to
 *   MULTI_SERIES_COLORWAY
 * @param {boolean} [options.normalize=true] - Scale each interval to fractions of its sum
 * @param {string} [options.title] - Optional layout title
 * @param {Object} [options.template] - Plotly template (defaults to the Baselode template)
 * @returns {{data: Array, layout: Object}} Plotly data and layout configuration
 */
export function buildCompositionConfig({
  hole, properties = [], colourMap = null, normalize = true, title, template,
} = {}) {
  const usable = properties.filter((property) => typeof property === 'string' && property);
  if (!usable.length) return { data: [], layout: {} };

  const series = usable.map((property) => ({
    property,
    points: buildIntervalPoints(hole, property, false),
  }));
  if (series.every((entry) => !entry.points.length)) return { data: [], layout: {} };

  // Shared interval grid across all components (missing cells fill with 0).
  const aligned = alignSeriesToCommonDepths(series);
  const grid = aligned[0].points;

  // Clamp negatives to 0 for the stack (raw value stays in the hover), then
  // skip intervals whose components sum to nothing.
  const clamped = aligned.map((entry) => entry.points.map((point) => Math.max(point.val, 0)));
  const sums = grid.map((_, cellIndex) => clamped.reduce(
    (total, componentVals) => total + componentVals[cellIndex], 0
  ));
  const keptCells = grid.map((_, cellIndex) => cellIndex).filter((cellIndex) => sums[cellIndex] > 0);
  if (!keptCells.length) return { data: [], layout: {} };

  const resolvedCmap = resolveColourMap(colourMap);

  const data = aligned.map((entry, componentIndex) => {
    const mapped = Object.keys(resolvedCmap).length > 0
      ? getColour(entry.property, resolvedCmap, null)
      : null;
    const colour = mapped || MULTI_SERIES_COLORWAY[componentIndex % MULTI_SERIES_COLORWAY.length];
    return {
      type: 'bar',
      orientation: 'h',
      x: keptCells.map((cellIndex) => (normalize
        ? clamped[componentIndex][cellIndex] / sums[cellIndex]
        : clamped[componentIndex][cellIndex])),
      y: keptCells.map((cellIndex) => grid[cellIndex].z),
      width: keptCells.map((cellIndex) => Math.max(Math.abs(grid[cellIndex].to - grid[cellIndex].from), 0.01)),
      marker: { color: colour, line: { width: 0 } },
      name: entry.property,
      showlegend: true,
      // [rawValue, percentage, fromDepth, toDepth] — hover reports the raw
      // value and its share of the interval regardless of normalisation.
      customdata: keptCells.map((cellIndex) => [
        entry.points[cellIndex].val,
        (100 * clamped[componentIndex][cellIndex]) / sums[cellIndex],
        Math.min(grid[cellIndex].from, grid[cellIndex].to),
        Math.max(grid[cellIndex].from, grid[cellIndex].to),
      ]),
      hovertemplate: `${entry.property}: %{customdata[0]:.4~r} (%{customdata[1]:.1f}%)<br>`
        + 'from: %{customdata[2]:.3f} to: %{customdata[3]:.3f}<extra></extra>',
    };
  });

  const layout = {
    barmode: 'stack',
    bargap: 0,
    xaxis: normalize
      ? { title: 'Fraction', range: [0, 1], tickformat: '.0%', zeroline: false }
      : { title: 'Value', zeroline: false },
    yaxis: { title: 'Depth (m)', autorange: 'reversed', zeroline: false },
    showlegend: true,
    legend: { orientation: 'h', y: 1.02, yanchor: 'bottom', x: 0, font: { size: 9 } },
    title: title || undefined,
    template: template !== undefined ? template : BASELODE_TEMPLATE,
  };

  return { data, layout: applyStriplogLayoutDefaults(layout) };
}
