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

import { AZIMUTH, DEPTH, DIP, STRUCTURE_TYPE, FROM, TO } from '../data/datamodel.js';

const DEFAULT_PALETTE = [
  '#0f172a', '#1e3a5f', '#7c3aed', '#dc2626', '#16a34a',
  '#d97706', '#0ea5e9', '#db2777', '#65a30d', '#9333ea',
];

/**
 * Build a Plotly tadpole log config for structural point measurements.
 *
 * Each measurement renders as a circle (head) at its depth with a tail
 * pointing toward the dip direction. Tail length is proportional to dip magnitude.
 *
 * @param {Array<Object>} points - Structural point rows
 * @param {Object} opts
 * @param {number} [opts.tailScale=0.3] - Controls tail length relative to dip magnitude
 * @param {string|null} [opts.colorBy=null] - Column name to color heads by (e.g. 'structure_type')
 * @param {string[]} [opts.palette] - Color palette
 * @param {string} [opts.depthCol='depth'] - Column for measured depth
 * @param {string} [opts.dipCol='dip'] - Column for dip angle
 * @param {string} [opts.azCol='azimuth'] - Column for dip direction
 * @returns {{ data: Array, layout: Object }} Plotly figure config
 */
export function buildTadpoleConfig(points, {
  tailScale = 0.3,
  colorBy = null,
  palette = DEFAULT_PALETTE,
  depthCol = DEPTH,
  dipCol = DIP,
  azCol = AZIMUTH,
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
    group.xs.push(0);
    group.ys.push(depth);
    group.dips.push(dip);
    group.azs.push(az);

    // Tail
    const azRad = (az * Math.PI) / 180;
    const length = tailScale * (Math.abs(dip) / 90);
    const dx = Math.sin(azRad) * length;
    const dy = Math.cos(azRad) * length;

    shapes.push({
      type: 'line',
      x0: 0, y0: depth,
      x1: dx, y1: depth + dy,
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
    xaxis: { range: [-0.5, 0.5], visible: false, fixedrange: true },
    yaxis: { title: 'Depth (m)', autorange: 'reversed' },
    showlegend: !!showLegend,
  };

  return { data, layout };
}

/**
 * Build a Plotly categorical strip log config for structural interval measurements.
 *
 * @param {Array<Object>} intervals - Structural interval rows
 * @param {Object} opts
 * @param {string} [opts.labelCol='structure_type'] - Column for interval label/color
 * @param {string[]} [opts.palette] - Color palette
 * @param {string} [opts.fromCol='from'] - From depth column
 * @param {string} [opts.toCol='to'] - To depth column
 * @returns {{ data: Array, layout: Object }} Plotly figure config
 */
export function buildStructuralStripConfig(intervals, {
  labelCol = STRUCTURE_TYPE,
  palette = DEFAULT_PALETTE,
  fromCol = FROM,
  toCol = TO,
} = {}) {
  const records = intervals
    .filter(iv => iv[fromCol] != null && iv[toCol] != null && Number(iv[toCol]) > Number(iv[fromCol]))
    .map(iv => ({ from: Number(iv[fromCol]), to: Number(iv[toCol]), label: String(iv[labelCol] ?? '') }))
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
    margin: { l: 40, r: 10, t: 10, b: 40 },
    xaxis: { range: [0, 1], visible: false, fixedrange: true },
    yaxis: { title: 'Depth (m)', autorange: 'reversed' },
    showlegend: false,
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
