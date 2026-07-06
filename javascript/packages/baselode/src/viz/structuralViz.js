/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Plotly visualization builders for structural measurements.
 *
 * Provides:
 * - buildTadpoleConfig: 1D strip log tadpole plot (dip head + azimuth tail)
 * - buildStructuralStripConfig: categorical interval strip log
 * - buildStrikeDipSymbol: 2D map strike/dip symbol geometry
 */

import { AZIMUTH, COMMENTS, DEPTH, DIP, FROM, TO } from '../data/datamodel.js';
import { BASELODE_TEMPLATE } from './baselodeTemplate.js';
import { MULTI_SERIES_COLORWAY } from './drillholeViz.js';

// Mid-tone hues only — these markers render on both the light and dark
// templates, so near-black slate/navy (invisible on dark) don't belong.
// Mirrors the Python _DEFAULT_TADPOLE_PALETTE.
const DEFAULT_PALETTE = [
  '#0ea5e9', '#d97706', '#7c3aed', '#dc2626', '#16a34a',
  '#db2777', '#65a30d', '#9333ea', '#14b8a6', '#f43f5e',
];

// Point-log category styling — mirrors the Python _DEFAULT_POINT_LOG_PALETTE /
// _DEFAULT_POINT_LOG_SYMBOLS so both languages render identical logs.
const POINT_LOG_PALETTE = [
  '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
  '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
  '#d4a6c8', '#86bcb6',
];

const POINT_LOG_SYMBOLS = [
  'circle', 'square', 'diamond', 'triangle-up', 'triangle-down',
  'cross', 'x', 'star', 'hexagon', 'pentagon', 'bowtie', 'hourglass',
];

// Group label for rows whose colour-by category is missing — mirrored by the
// Python plot_dip_azimuth_log so legends match across languages.
const UNCATEGORISED_LABEL = '(uncategorised)';

/** Trimmed category text, or '' for blank / NaN / None / null sentinels. @private */
function normalizeCategoryLabel(value) {
  const label = `${value ?? ''}`.trim();
  return /^(nan|null|none)$/i.test(label) ? '' : label;
}

/**
 * Empty figure config that still carries the resolved template, so an empty
 * track renders with the correct theme background instead of Plotly's white.
 * @private
 */
function emptyStripLogConfig(template) {
  return { data: [], layout: { template: template === undefined ? BASELODE_TEMPLATE : template } };
}

const STRIPLOG_COMPACT_MARGIN = { l: 42, r: 4, t: 4, b: 36 };
const STRIPLOG_AXIS_TICK_FONT_SIZE = 10;
const STRIPLOG_AXIS_TITLE_FONT_SIZE = 11;
const STRIPLOG_XAXIS_TITLE_STANDOFF = 6;

function applyStriplogLayoutDefaults(layout = {}) {
  return {
    ...layout,
    margin: STRIPLOG_COMPACT_MARGIN,
    // Strip logs read down-hole: hover along depth with a horizontal spike
    // and one unified box (mirrors the numeric tracks). Without this the
    // template's 'x unified' leaks in and draws a vertical spike.
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
        ...((layout.xaxis && layout.xaxis.title) || {}),
        font: {
          ...(((layout.xaxis && layout.xaxis.title && layout.xaxis.title.font) || {})),
          size: STRIPLOG_AXIS_TITLE_FONT_SIZE,
        },
        standoff: (layout.xaxis && layout.xaxis.title && layout.xaxis.title.standoff)
          ?? STRIPLOG_XAXIS_TITLE_STANDOFF,
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
        ...((layout.yaxis && layout.yaxis.title) || {}),
        font: {
          ...(((layout.yaxis && layout.yaxis.title && layout.yaxis.title.font) || {})),
          size: STRIPLOG_AXIS_TITLE_FONT_SIZE,
        },
      },
    },
  };
}

/**
 * Build a Plotly tadpole log config for structural point measurements.
 *
 * Each measurement renders as a circle (head) at its depth with a tail
 * pointing toward the dip direction. Tail length is proportional to dip magnitude.
 *
 * @param {Array<Object>} points - Structural point rows
 * @param {Object} opts
 * @param {number} [opts.tailScale=0.3] - Controls tail length relative to dip magnitude
 * @param {string|null} [opts.colorBy=null] - Column name to color heads by (e.g. 'defect')
 * @param {string[]} [opts.palette] - Color palette
 * @param {string} [opts.depthCol='depth'] - Column for measured depth
 * @param {string} [opts.dipCol='dip'] - Column for dip angle
 * @param {string} [opts.azCol='azimuth'] - Column for dip direction
 * @param {Object} [opts.template] - Plotly template to apply. Defaults to the Baselode template.
 * @returns {{ data: Array, layout: Object }} Plotly figure config
 */
export function buildTadpoleConfig(points, {
  tailScale = 5,
  colorBy = null,
  palette = DEFAULT_PALETTE,
  depthCol = DEPTH,
  dipCol = DIP,
  azCol = AZIMUTH,
  template = undefined,
} = {}) {
  const valid = points.filter(p =>
    p[depthCol] != null && p[dipCol] != null && p[azCol] != null
  );

  if (!valid.length) {
    return emptyStripLogConfig(template);
  }

  // Build color map for categories
  const colorMap = {};
  if (colorBy) {
    const categories = [...new Set(valid.map(p => p[colorBy]).filter(v => v != null))].sort();
    categories.forEach((cat, i) => { colorMap[cat] = palette[i % palette.length]; });
  }

  // Group by category for legend traces
  const byCat = new Map();
  const shapes = [];

  for (const p of valid) {
    const depth = Number(p[depthCol]);
    const dip = Number(p[dipCol]);
    const az = Number(p[azCol]);
    const cat = colorBy ? (p[colorBy] ?? '_default') : '_default';
    // Uncategorised tadpoles take the shared series colour — a mid-tone that
    // reads on both templates (never a hardcoded dark slate).
    const color = colorBy ? (colorMap[cat] ?? MULTI_SERIES_COLORWAY[0]) : MULTI_SERIES_COLORWAY[0];

    if (!byCat.has(cat)) {
      byCat.set(cat, { xs: [], ys: [], dips: [], azs: [], color });
    }
    const group = byCat.get(cat);
    // Head positioned at x=dip (degrees)
    group.xs.push(dip);
    group.ys.push(depth);
    group.dips.push(dip);
    group.azs.push(az);

    // Tail: starts at (dip, depth), direction encodes azimuth.
    // Length scales with dip magnitude (in degree units on the x-axis).
    const azRad = (az * Math.PI) / 180;
    const length = tailScale * (Math.abs(dip) / 90);
    const dx = Math.sin(azRad) * length;   // x-component (degrees)
    const dy = Math.cos(azRad) * length;   // y-component (degrees, visual only)

    shapes.push({
      type: 'line',
      x0: dip, y0: depth,
      x1: dip + dx, y1: depth + dy,
      line: { color, width: 2 },
    });
  }

  const data = [];
  const showLegend = colorBy && byCat.size > 1;

  for (const [cat, group] of byCat.entries()) {
    data.push({
      type: 'scatter',
      x: group.xs,
      y: group.ys,
      mode: 'markers',
      name: cat !== '_default' ? String(cat) : undefined,
      marker: { size: 8, color: group.color },
      showlegend: showLegend && cat !== '_default',
      customdata: group.dips.map((d, i) => [d, group.azs[i]]),
      hovertemplate: 'Depth: %{y}<br>Dip: %{customdata[0]}<br>Az: %{customdata[1]}<extra></extra>',
    });
  }

  const layout = {
    shapes,
    height: 400,
    margin: { l: 40, r: 10, t: 10, b: 40 },
    xaxis: {
      title: 'Dip (°)',
      autorange: true,
      fixedrange: true,
      zeroline: true,
      tickvals: [-90, -60, -30, 0, 30, 60, 90],
    },
    yaxis: { title: 'Depth (m)', autorange: 'reversed' },
    showlegend: !!showLegend,
    template: template !== undefined ? template : BASELODE_TEMPLATE,
  };

  return { data, layout };
}

/**
 * Build a Plotly categorical strip log config for structural interval measurements.
 *
 * @param {Array<Object>} intervals - Structural interval rows
 * @param {Object} opts
 * @param {string} [opts.labelCol='defect'] - Column for interval label/color
 * @param {string[]} [opts.palette] - Color palette
 * @param {string} [opts.fromCol='from'] - From depth column
 * @param {string} [opts.toCol='to'] - To depth column
 * @param {Object} [opts.template] - Plotly template to apply. Defaults to the Baselode template.
 * @returns {{ data: Array, layout: Object }} Plotly figure config
 */
export function buildStructuralStripConfig(intervals, {
  labelCol = 'structure_type',
  palette = DEFAULT_PALETTE,
  fromCol = FROM,
  toCol = TO,
  template = undefined,
} = {}) {
  const records = intervals
    .filter(iv => iv[fromCol] != null && iv[toCol] != null && Number(iv[toCol]) > Number(iv[fromCol]))
    .filter(iv => {
      const lv = iv[labelCol];
      if (lv == null) return false;
      const s = String(lv).trim();
      return s !== '' && !/^(nan|null|none)$/i.test(s);
    })
    .map(iv => ({ from: Number(iv[fromCol]), to: Number(iv[toCol]), label: String(iv[labelCol]).trim() }))
    .sort((a, b) => a.from - b.from);

  if (!records.length) {
    return emptyStripLogConfig(template);
  }

  const shapes = [];
  const textY = [];
  const texts = [];

  records.forEach((rec, idx) => {
    shapes.push({
      type: 'rect',
      xref: 'x', yref: 'y',
      x0: 0, x1: 1,
      y0: rec.from, y1: rec.to,
      fillcolor: palette[idx % palette.length],
      line: { width: 0 },
      layer: 'below',
    });
    textY.push(0.5 * (rec.from + rec.to));
    texts.push(rec.label);
  });

  const data = [{
    type: 'scatter',
    x: Array(texts.length).fill(0.5),
    y: textY,
    mode: 'text',
    text: texts,
    textposition: 'middle center',
    showlegend: false,
    hoverinfo: 'text',
  }];

  const layout = {
    shapes,
    height: 400,
    xaxis: { range: [0, 1], visible: false, fixedrange: true },
    yaxis: { title: 'Depth (m)', autorange: 'reversed' },
    showlegend: false,
    template: template !== undefined ? template : BASELODE_TEMPLATE,
  };

  return { data, layout: applyStriplogLayoutDefaults(layout) };
}

/**
 * Word-wrap text at word boundaries, inserting Plotly HTML line breaks.
 * @private
 * @param {string} text
 * @param {number} charsPerLine
 * @returns {string}
 */
function wrapComment(text, charsPerLine) {
  if (!text) return '';
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (current && current.length + 1 + word.length > charsPerLine) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.join('<br>');
}

/**
 * Build a Plotly comments log config — depth intervals with text annotations overlaid.
 *
 * Each interval is drawn as a lightly shaded rectangle spanning its from/to depth.
 * Non-empty comments are word-wrapped and centered inside the rectangle.
 * Intervals with no comment show a thin border only.
 *
 * @param {Array<Object>} intervals - Interval rows (must have from, to, and a comment column)
 * @param {Object} opts
 * @param {string} [opts.commentCol='comments'] - Column containing comment text
 * @param {string} [opts.fromCol='from'] - From depth column
 * @param {string} [opts.toCol='to'] - To depth column
 * @param {string} [opts.bgColor='#f1f5f9'] - Fill color for intervals with a comment
 * @param {string} [opts.borderColor='#cbd5e1'] - Rectangle border color
 * @param {string} [opts.textColor='#1e293b'] - Comment text color
 * @param {number} [opts.charsPerLine=18] - Characters before word-wrapping
 * @param {Object} [opts.template] - Plotly template to apply. Defaults to the Baselode template.
 * @returns {{ data: Array, layout: Object }} Plotly figure config
 */
export function buildCommentsConfig(intervals, {
  commentCol = 'comments',
  fromCol = FROM,
  toCol = TO,
  // Translucent neutral fills read on both the light and dark templates;
  // text colour is inherited from the template font unless overridden.
  bgColor = 'rgba(148, 163, 184, 0.15)',
  borderColor = 'rgba(148, 163, 184, 0.4)',
  textColor = undefined,
  charsPerLine = 18,
  template = undefined,
} = {}) {
  // Only intervals that actually carry a comment render. Unified per-hole
  // datasets mix assay / structural / geology rows in one points array, so
  // drawing every interval would bury the handful of commented ones under
  // hundreds of empty overlapping boxes from the other sources.
  const records = intervals
    .filter(iv => iv[fromCol] != null && iv[toCol] != null && Number(iv[toCol]) > Number(iv[fromCol]))
    .map(iv => {
      const raw = iv[commentCol];
      const comment = (raw != null && String(raw).trim() !== '' && String(raw) !== 'null')
        ? String(raw).trim()
        : '';
      return { from: Number(iv[fromCol]), to: Number(iv[toCol]), comment };
    })
    .filter((rec) => rec.comment)
    .sort((a, b) => a.from - b.from);

  if (!records.length) {
    return emptyStripLogConfig(template);
  }

  // Inline text is budgeted by each interval's share of the track: a track
  // renders roughly this many 10px text lines top to bottom, so an interval
  // covering a fraction of the depth span fits that fraction of lines.
  // Comments that don't fit are truncated with an ellipsis — the hover bar
  // always carries the full text.
  const TEXT_LINES_PER_TRACK = 36;
  const totalSpan = records[records.length - 1].to - records[0].from;

  const shapes = [];
  const textXs = [];
  const textYs = [];
  const texts = [];

  for (const rec of records) {
    shapes.push({
      type: 'rect',
      xref: 'x', yref: 'y',
      x0: 0, x1: 1,
      y0: rec.from, y1: rec.to,
      fillcolor: bgColor,
      line: { color: borderColor, width: 1 },
      layer: 'below',
    });

    if (totalSpan <= 0) continue;
    const lineBudget = Math.floor(((rec.to - rec.from) / totalSpan) * TEXT_LINES_PER_TRACK);
    if (lineBudget < 1) continue;
    const wrappedLines = wrapComment(rec.comment, charsPerLine).split('<br>');
    const shownLines = wrappedLines.slice(0, lineBudget);
    if (wrappedLines.length > lineBudget) {
      shownLines[shownLines.length - 1] = `${shownLines[shownLines.length - 1]}…`;
    }
    textXs.push(0.5);
    textYs.push(0.5 * (rec.from + rec.to));
    texts.push(shownLines.join('<br>'));
  }

  const data = [];
  // Invisible full-width bar per interval: the hover target covers the whole
  // box (any depth within it), instead of one exact mid-depth text point.
  data.push({
    type: 'bar',
    orientation: 'h',
    x: records.map(() => 1),
    base: 0,
    y: records.map((rec) => 0.5 * (rec.from + rec.to)),
    width: records.map((rec) => Math.max(rec.to - rec.from, 0.01)),
    marker: { color: 'rgba(0,0,0,0)' },
    hovertext: records.map((rec) => (
      `${rec.from.toFixed(3)}–${rec.to.toFixed(3)} m<br>${wrapComment(rec.comment, 40)}`
    )),
    hoverinfo: 'text',
    showlegend: false,
  });
  if (textXs.length) {
    data.push({
      type: 'scatter',
      x: textXs,
      y: textYs,
      mode: 'text',
      text: texts,
      textposition: 'middle center',
      // Without an explicit colour the text inherits the template font, so it
      // stays legible on both the light and dark themes.
      textfont: { size: 10, ...(textColor ? { color: textColor } : {}) },
      hoverinfo: 'skip',
      showlegend: false,
    });
  }

  const layout = {
    shapes,
    height: 400,
    bargap: 0,
    xaxis: { range: [0, 1], visible: false, fixedrange: true },
    yaxis: { title: 'Depth (m)', autorange: 'reversed' },
    showlegend: false,
    template: template !== undefined ? template : BASELODE_TEMPLATE,
  };

  return { data, layout: applyStriplogLayoutDefaults(layout) };
}

/**
 * Build a Plotly point-log config: categorical point measurements at depth,
 * with a distinct x slot, colour, and marker symbol per category.
 *
 * JS port of the Python `plot_point_log`. Unlike the interval strip log this
 * accepts point measurements indexed only by depth; each unique category is
 * assigned an evenly spaced x position, a palette colour, and a marker symbol
 * (all cycling), with one trace per category so the legend is fully functional.
 *
 * @param {Object} options
 * @param {Object} [options.hole] - Hole object with a points array (alternative to `rows`)
 * @param {Array<Object>} [options.rows] - Point measurement rows
 * @param {string} [options.depthKey='depth'] - Column holding measured depth
 * @param {string} [options.categoryKey='defect'] - Column holding the categorical value
 * @param {string[]} [options.palette] - Hex colours, one per category (cycles)
 * @param {string[]} [options.markerSymbols] - Plotly marker symbols, one per category (cycles)
 * @param {number} [options.markerSize=8] - Marker size in pixels
 * @param {string} [options.title] - Optional layout title
 * @param {Object} [options.template] - Plotly template to apply. Defaults to the Baselode template.
 * @returns {{ data: Array, layout: Object }} Plotly figure config
 */
export function buildPointLogConfig({
  hole,
  rows,
  depthKey = DEPTH,
  categoryKey = 'defect',
  palette = POINT_LOG_PALETTE,
  markerSymbols = POINT_LOG_SYMBOLS,
  markerSize = 8,
  title,
  template = undefined,
} = {}) {
  const sourceRows = Array.isArray(rows) ? rows : (hole?.points || []);
  const records = sourceRows
    .map((row) => ({ depth: Number(row?.[depthKey]), category: `${row?.[categoryKey] ?? ''}`.trim() }))
    .filter((rec) => Number.isFinite(rec.depth)
      && rec.category !== ''
      && !/^(nan|null|none)$/i.test(rec.category));

  if (!records.length) {
    return emptyStripLogConfig(template);
  }

  // Stable ordering: sort alphabetically so colours are reproducible.
  const uniqueCats = [...new Set(records.map((rec) => rec.category))].sort();

  const data = uniqueCats.map((cat, catIndex) => {
    const depths = records.filter((rec) => rec.category === cat).map((rec) => rec.depth);
    return {
      type: 'scatter',
      x: depths.map(() => catIndex),
      y: depths,
      mode: 'markers',
      name: cat,
      marker: {
        symbol: markerSymbols[catIndex % markerSymbols.length],
        color: palette[catIndex % palette.length],
        size: markerSize,
        line: { width: 0.5, color: 'rgba(0,0,0,0.3)' },
      },
      hovertemplate: `${cat}<br>depth: %{y:.1f} m<extra></extra>`,
    };
  });

  const layout = {
    xaxis: {
      tickvals: uniqueCats.map((_, catIndex) => catIndex),
      ticktext: uniqueCats,
      tickangle: -45,
      tickfont: { size: 9 },
      zeroline: false,
      showgrid: false,
      fixedrange: true,
      range: [-0.5, uniqueCats.length - 0.5],
    },
    yaxis: { title: 'Depth (m)', autorange: 'reversed', zeroline: false },
    legend: { title: categoryKey, font: { size: 9 } },
    showlegend: true,
    title: title || undefined,
    template: template !== undefined ? template : BASELODE_TEMPLATE,
  };

  return { data, layout: applyStriplogLayoutDefaults(layout) };
}

/**
 * Word-truncate text to roughly `maxChars`, appending an ellipsis.
 * @private
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function truncateAnnotationText(text, maxChars) {
  const trimmed = String(text).trim();
  if (trimmed.length <= maxChars) return trimmed;
  const head = trimmed.slice(0, maxChars);
  const lastSpace = head.lastIndexOf(' ');
  return `${(lastSpace > 0 ? head.slice(0, lastSpace) : head).trimEnd()}…`;
}

/**
 * Build a Plotly depth-pinned annotations config — free text pinned to point
 * depths, rendered as a small left-edge tick marker with the text to its right.
 *
 * Long text is word-truncated to ~40 characters; the full text lives in the
 * hover. The layout composes with the multi-track strip-log machinery so the
 * annotations can sit beside other tracks.
 *
 * @param {Object} options
 * @param {Array<Object>} options.rows - Point rows with a depth and a text column
 * @param {string} [options.depthKey='depth'] - Column holding measured depth
 * @param {string} [options.textKey='comments'] - Column holding the annotation text
 * @param {string} [options.markerColor='#475569'] - Colour of the depth tick marker
 * @param {number} [options.maxChars=40] - Characters before word-truncating the label
 * @param {string} [options.title] - Optional layout title
 * @param {Object} [options.template] - Plotly template to apply. Defaults to the Baselode template.
 * @returns {{ data: Array, layout: Object }} Plotly figure config
 */
export function buildDepthAnnotationsConfig({
  rows = [],
  depthKey = DEPTH,
  textKey = COMMENTS,
  markerColor = '#475569',
  maxChars = 40,
  title,
  template = undefined,
} = {}) {
  const records = rows
    .map((row) => ({ depth: Number(row?.[depthKey]), text: `${row?.[textKey] ?? ''}`.trim() }))
    .filter((rec) => Number.isFinite(rec.depth)
      && rec.text !== ''
      && !/^(nan|null|none)$/i.test(rec.text))
    .sort((first, second) => first.depth - second.depth);

  if (!records.length) {
    return emptyStripLogConfig(template);
  }

  const data = [{
    type: 'scatter',
    x: records.map(() => 0),
    y: records.map((rec) => rec.depth),
    mode: 'markers+text',
    marker: { symbol: 'line-ew-open', size: 9, color: markerColor, line: { width: 1.5 } },
    text: records.map((rec) => truncateAnnotationText(rec.text, maxChars)),
    textposition: 'middle right',
    textfont: { size: 9 },
    hovertext: records.map((rec) => `${rec.depth.toFixed(3)} m<br>${rec.text}`),
    hoverinfo: 'text',
    showlegend: false,
  }];

  const layout = {
    xaxis: { range: [0, 1], visible: false, fixedrange: true },
    yaxis: { title: 'Depth (m)', autorange: 'reversed', zeroline: false },
    showlegend: false,
    title: title || undefined,
    template: template !== undefined ? template : BASELODE_TEMPLATE,
  };

  return { data, layout: applyStriplogLayoutDefaults(layout) };
}

/**
 * Build a Plotly split dip-magnitude / dip-azimuth log: two shared-depth
 * tracks — dip markers on a fixed [0, 90] axis and azimuth markers on a fixed
 * [0, 360] axis (ticks every 90°) — using xaxis / xaxis2 domains.
 *
 * @param {Object} options
 * @param {Array<Object>} options.rows - Structural point rows
 * @param {string} [options.depthKey='depth'] - Column for measured depth
 * @param {string} [options.dipKey='dip'] - Column for dip magnitude
 * @param {string} [options.azimuthKey='azimuth'] - Column for dip azimuth
 * @param {string|null} [options.colorBy=null] - Categorical column (e.g. defect type);
 *   one legend entry per category shared across both tracks via legendgroup
 * @param {string[]} [options.palette] - Colour palette for colorBy categories
 * @param {string} [options.title] - Optional layout title
 * @param {Object} [options.template] - Plotly template to apply. Defaults to the Baselode template.
 * @returns {{ data: Array, layout: Object }} Plotly figure config
 */
export function buildDipAzimuthConfig({
  rows = [],
  depthKey = DEPTH,
  dipKey = DIP,
  azimuthKey = AZIMUTH,
  colorBy = null,
  // Same series colours as the Python plot_dip_azimuth_log, which draws its
  // groups from MULTI_SERIES_COLORWAY.
  palette = MULTI_SERIES_COLORWAY,
  title,
  template = undefined,
} = {}) {
  const valid = rows
    .map((row) => ({
      depth: Number(row?.[depthKey]),
      dip: Number(row?.[dipKey]),
      azimuth: Number(row?.[azimuthKey]),
      // Rows with valid angles but a missing category still plot, under an
      // explicit group, instead of being dropped or legend-less.
      category: colorBy ? (normalizeCategoryLabel(row?.[colorBy]) || UNCATEGORISED_LABEL) : '',
    }))
    .filter((rec) => Number.isFinite(rec.depth) && Number.isFinite(rec.dip) && Number.isFinite(rec.azimuth));

  if (!valid.length) {
    return emptyStripLogConfig(template);
  }

  // One group per category when colouring; a single anonymous group otherwise.
  const groups = colorBy
    ? [...new Set(valid.map((rec) => rec.category))].sort()
    : [''];
  const showLegend = Boolean(colorBy) && groups.length > 0;

  const data = [];
  groups.forEach((groupName, groupIndex) => {
    const groupRecords = colorBy
      ? valid.filter((rec) => rec.category === groupName)
      : valid;
    if (!groupRecords.length) return;
    const colour = colorBy ? palette[groupIndex % palette.length] : MULTI_SERIES_COLORWAY[0];
    const legendName = groupName || undefined;
    const shared = {
      type: 'scatter',
      mode: 'markers',
      y: groupRecords.map((rec) => rec.depth),
      marker: { size: 7, color: colour },
      name: legendName,
      legendgroup: legendName,
    };
    // Left track: dip magnitude. Carries the legend entry for the group.
    data.push({
      ...shared,
      x: groupRecords.map((rec) => rec.dip),
      xaxis: 'x',
      showlegend: showLegend,
      hovertemplate: 'Dip: %{x}°<extra></extra>',
    });
    // Right track: azimuth. Same legendgroup so both toggle together.
    data.push({
      ...shared,
      x: groupRecords.map((rec) => rec.azimuth),
      xaxis: 'x2',
      showlegend: false,
      hovertemplate: 'Azimuth: %{x}°<extra></extra>',
    });
  });

  const layout = applyStriplogLayoutDefaults({
    xaxis: {
      title: 'Dip (°)',
      domain: [0, 0.46],
      range: [0, 90],
      fixedrange: true,
      zeroline: false,
      tickvals: [0, 30, 60, 90],
    },
    yaxis: { title: 'Depth (m)', autorange: 'reversed', zeroline: false },
    hovermode: 'y unified',
    showlegend: showLegend,
    legend: { orientation: 'h', y: 1.02, yanchor: 'bottom', x: 0, font: { size: 9 } },
    title: title || undefined,
    template: template !== undefined ? template : BASELODE_TEMPLATE,
  });
  // applyStriplogLayoutDefaults only knows the base axes; style the second
  // track's axis to match.
  layout.xaxis2 = {
    title: { text: 'Azimuth (°)', font: { size: STRIPLOG_AXIS_TITLE_FONT_SIZE } },
    domain: [0.54, 1],
    range: [0, 360],
    dtick: 90,
    fixedrange: true,
    zeroline: false,
    tickfont: { size: STRIPLOG_AXIS_TICK_FONT_SIZE },
  };

  return { data, layout };
}

/**
 * Compute 2D map strike/dip symbol geometry for a single structural measurement.
 *
 * Returns the geometry needed to draw a strike line and dip tick on a map.
 *
 * @param {Object} point - Structural measurement with x, y, dip, azimuth
 * @param {Object} opts
 * @param {number} [opts.symbolSize=10] - Strike line half-length in map units
 * @param {string} [opts.xCol='easting'] - X coordinate column
 * @param {string} [opts.yCol='northing'] - Y coordinate column
 * @returns {{ strike: number, dipValue: number, x: number, y: number,
 *             strikeX0: number, strikeY0: number, strikeX1: number, strikeY1: number,
 *             tickX1: number, tickY1: number } | null}
 */
export function buildStrikeDipSymbol(point, {
  symbolSize = 10,
  xCol = 'easting',
  yCol = 'northing',
} = {}) {
  const x = point[xCol] != null ? Number(point[xCol]) : null;
  const y = point[yCol] != null ? Number(point[yCol]) : null;
  const dip = point[DIP] != null ? Number(point[DIP]) : null;
  const az = point[AZIMUTH] != null ? Number(point[AZIMUTH]) : null;

  if (x === null || y === null || dip === null || az === null) return null;

  const strike = ((az - 90) + 360) % 360;
  const strikeRad = (strike * Math.PI) / 180;
  const azRad = (az * Math.PI) / 180;

  // Strike line half-endpoints
  const dxS = symbolSize * Math.sin(strikeRad);
  const dyS = symbolSize * Math.cos(strikeRad);

  // Dip tick from center (length scaled by dip magnitude)
  const tickLen = symbolSize * 0.4 * (dip / 90);
  const dxD = tickLen * Math.sin(azRad);
  const dyD = tickLen * Math.cos(azRad);

  return {
    strike,
    dipValue: dip,
    x,
    y,
    strikeX0: x - dxS,
    strikeY0: y - dyS,
    strikeX1: x + dxS,
    strikeY1: y + dyS,
    tickX1: x + dxD,
    tickY1: y + dyD,
  };
}
