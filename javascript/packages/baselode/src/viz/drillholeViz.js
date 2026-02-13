/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
// Shared drillhole 2D visualization helpers for reuse beyond the UI layer.
// These helpers build Plotly-ready data/layout objects based on interval points.

export const NUMERIC_LINE_COLOR = '#8b1e3f';
export const NUMERIC_MARKER_COLOR = '#a8324f';
export const ERROR_COLOR = '#6b7280';

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

export function buildIntervalPoints(hole, property, isCategorical) {
  if (!hole || !property) return [];
  const rawPoints = hole?.points || [];
  const out = [];
  const seen = new Set();
  rawPoints.forEach((p) => {
    const fromVal = Number(
      p.from ??
      p.samp_from ??
      p.sample_from ??
      p.fromdepth ??
      p.from_depth ??
      p.depth_from
    );
    const toVal = Number(
      p.to ??
      p.samp_to ??
      p.sample_to ??
      p.todepth ??
      p.to_depth ??
      p.depth_to
    );
    const rawVal = p?.[property];
    if (!Number.isFinite(fromVal) || !Number.isFinite(toVal) || toVal <= fromVal) return;
    if (rawVal === undefined || rawVal === null || rawVal === '') return;
    const key = `${property}:${fromVal}-${toVal}`;
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

function buildCategoricalConfig(points, property) {
  if (!points.length) return { data: [], layout: {} };
  const sorted = [...points].sort((a, b) => b.z - a.z);
  const segments = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    const y0 = curr.z;
    const y1 = next ? next.z : curr.z - 20;
    if (y1 === y0) continue;
    segments.push({ y0, y1, category: curr.val || 'unknown' });
  }

  const palette = ['#8b1e3f', '#a8324f', '#b84c68', '#d16587', '#e07ba0', '#f091b6', '#f7a7c8', '#fbcfe8'];

  const shapes = segments.map((seg, idx) => ({
    type: 'rect',
    xref: 'x',
    yref: 'y',
    x0: 0,
    x1: 1,
    y0: seg.y0,
    y1: seg.y1,
    fillcolor: palette[idx % palette.length],
    line: { width: 0 }
  }));

  const textTrace = {
    x: segments.map(() => 0.5),
    y: segments.map((s) => (s.y0 + s.y1) / 2),
    mode: 'text',
    text: segments.map((s) => s.category),
    textposition: 'middle center',
    showlegend: false,
    hoverinfo: 'text',
    customdata: segments.map((s) => [s.y0, s.y1]),
    hovertemplate: `Category: %{text}<br>from: %{customdata[0]} to %{customdata[1]}<extra></extra>`
  };

  const layout = {
    height: 260,
    margin: { l: 50, r: 10, t: 10, b: 30 },
    xaxis: { range: [0, 1], visible: false, fixedrange: true },
    yaxis: { title: 'Depth (m)', autorange: 'reversed', zeroline: false },
    shapes,
    showlegend: false,
    title: property || undefined
  };

  return { data: [textTrace], layout };
}

function buildNumericConfig(points, property, chartType) {
  if (!points.length) return { data: [], layout: {} };
  const isBar = chartType === 'bar';
  const isMarkersOnly = chartType === 'markers';
  const isLineOnly = chartType === 'line';

  const baseTrace = {
    x: points.map((p) => p.val),
    y: points.map((p) => p.z),
    hovertemplate: `${property}: %{x}<br>from: %{customdata[0]} to %{customdata[1]}<extra></extra>`,
    customdata: points.map((p) => [p.from, p.to])
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
    height: 260,
    margin: { l: 50, r: 10, t: 10, b: 30 },
    xaxis: { title: property, zeroline: false },
    yaxis: { title: 'Depth (m)', autorange: 'reversed', zeroline: false },
    barmode: 'overlay',
    showlegend: false
  };

  return { data: [trace], layout };
}

export function buildPlotConfig({ points, isCategorical, property, chartType }) {
  if (!points || !points.length || !property) return { data: [], layout: {} };
  if (isCategorical || chartType === 'categorical') {
    return buildCategoricalConfig(points, property);
  }
  return buildNumericConfig(points, property, chartType);
}
