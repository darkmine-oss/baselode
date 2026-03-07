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

import { AZIMUTH, DEPTH, DIP, FROM, TO } from '../data/datamodel.js';
import { BASELODE_TEMPLATE } from './baselodeTemplate.js';

const DEFAULT_PALETTE = [
  '#0f172a', '#1e3a5f', '#7c3aed', '#dc2626', '#16a34a',
  '#d97706', '#0ea5e9', '#db2777', '#65a30d', '#9333ea',
];

const STRIPLOG_COMPACT_MARGIN = { l: 42, r: 4, t: 4, b: 30 };
const STRIPLOG_AXIS_TICK_FONT_SIZE = 10;
const STRIPLOG_AXIS_TITLE_FONT_SIZE = 12;

function applyStriplogLayoutDefaults(layout = {}) {
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
        ...((layout.xaxis && layout.xaxis.title) || {}),
        font: {
          ...(((layout.xaxis && layout.xaxis.title && layout.xaxis.title.font) || {})),
          size: STRIPLOG_AXIS_TITLE_FONT_SIZE,
        },
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
    return { data: [], layout: {} };
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
    const color = colorBy ? (colorMap[cat] ?? '#0f172a') : '#0f172a';

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
    return { data: [], layout: {} };
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
  bgColor = '#f1f5f9',
  borderColor = '#cbd5e1',
  textColor = '#1e293b',
  charsPerLine = 18,
  template = undefined,
} = {}) {
  const records = intervals
    .filter(iv => iv[fromCol] != null && iv[toCol] != null && Number(iv[toCol]) > Number(iv[fromCol]))
    .map(iv => {
      const raw = iv[commentCol];
      const comment = (raw != null && String(raw).trim() !== '' && String(raw) !== 'null')
        ? String(raw).trim()
        : '';
      return { from: Number(iv[fromCol]), to: Number(iv[toCol]), comment };
    })
    .sort((a, b) => a.from - b.from);

  if (!records.length) {
    return { data: [], layout: {} };
  }

  const shapes = [];
  const textXs = [];
  const textYs = [];
  const texts = [];
  const hovers = [];

  for (const rec of records) {
    const mid = 0.5 * (rec.from + rec.to);
    const hasComment = !!rec.comment;

    shapes.push({
      type: 'rect',
      xref: 'x', yref: 'y',
      x0: 0, x1: 1,
      y0: rec.from, y1: rec.to,
      fillcolor: hasComment ? bgColor : 'rgba(0,0,0,0)',
      line: { color: borderColor, width: 1 },
      layer: 'below',
    });

    if (hasComment) {
      textXs.push(0.5);
      textYs.push(mid);
      texts.push(wrapComment(rec.comment, charsPerLine));
      hovers.push(`${rec.from.toFixed(3)}–${rec.to.toFixed(3)} m<br>${wrapComment(rec.comment, 40)}`);
    }
  }

  const data = textXs.length ? [{
    type: 'scatter',
    x: textXs,
    y: textYs,
    mode: 'text',
    text: texts,
    textposition: 'middle center',
    textfont: { color: textColor, size: 10 },
    hovertext: hovers,
    hoverinfo: 'text',
    showlegend: false,
  }] : [];

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
