/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Plotly visualization builder for depth-registered core photography.
 *
 * Provides:
 * - buildCorePhotoConfig: strip log track for core box / single-core imagery
 */

import { FROM, TO } from '../data/datamodel.js';

const STRIPLOG_COMPACT_MARGIN = { l: 42, r: 4, t: 4, b: 30 };
const STRIPLOG_AXIS_TICK_FONT_SIZE = 10;
const STRIPLOG_AXIS_TITLE_FONT_SIZE = 12;

function applyStriplogLayoutDefaults(layout = {}) {
  const xTitle = (layout.xaxis && layout.xaxis.title) || {};
  const yTitle = (layout.yaxis && layout.yaxis.title) || {};
  const xTitleObj = typeof xTitle === 'string' ? { text: xTitle } : xTitle;
  const yTitleObj = typeof yTitle === 'string' ? { text: yTitle } : yTitle;
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
        ...xTitleObj,
        font: { ...(xTitleObj.font || {}), size: STRIPLOG_AXIS_TITLE_FONT_SIZE },
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
        ...yTitleObj,
        font: { ...(yTitleObj.font || {}), size: STRIPLOG_AXIS_TITLE_FONT_SIZE },
      },
    },
  };
}

/**
 * Build a Plotly configuration for depth-registered core photography.
 *
 * Places each image at its registered depth interval using Plotly layout
 * images. The resulting config is designed to be placed as a track in a
 * strip log view, with the y-axis depth-registered to other strip log tracks.
 *
 * Supports two image modes (via modeCol):
 * - "core_box" / "core_tray": full tray photograph, displayed at the
 *   registered depth interval.
 * - "single_core": individual core segment photograph, displayed at the
 *   registered depth interval.
 *
 * The mode does not affect rendering; it is stored as metadata and surfaced
 * in hover text.
 *
 * @param {Array<Object>} images - Image records. Each must have from-depth,
 *   to-depth, and an image URL (HTTP URL or base64 data URI).
 * @param {Object} opts
 * @param {string} [opts.fromCol='from'] - From-depth column
 * @param {string} [opts.toCol='to'] - To-depth column
 * @param {string} [opts.urlCol='image_url'] - Image source URL column
 * @param {string} [opts.modeCol='image_mode'] - Image mode column
 *   ("core_box", "core_tray", "single_core"). Defaults to "core_box".
 * @param {[number, number]|null} [opts.depthRange=null] - Optional
 *   [min_depth, max_depth] to fix the y-axis range. Derived from image
 *   intervals when null.
 * @returns {{ data: Array, layout: Object }} Plotly figure config
 */
export function buildCorePhotoConfig(images = [], {
  fromCol = FROM,
  toCol = TO,
  urlCol = 'image_url',
  modeCol = 'image_mode',
  depthRange = null,
} = {}) {
  const valid = [];
  for (const rec of images) {
    const f = Number(rec[fromCol] ?? rec.from_depth);
    const t = Number(rec[toCol] ?? rec.to_depth);
    if (!Number.isFinite(f) || !Number.isFinite(t) || t <= f) continue;
    const url = String(rec[urlCol] ?? rec.url ?? '').trim();
    if (!url) continue;
    const mode = String(rec[modeCol] ?? 'core_box').trim() || 'core_box';
    valid.push({ from: f, to: t, url, mode });
  }

  if (!valid.length) {
    return { data: [], layout: {} };
  }

  valid.sort((a, b) => a.from - b.from);

  const yMin = depthRange ? Number(depthRange[0]) : Math.min(...valid.map((r) => r.from));
  const yMax = depthRange ? Number(depthRange[1]) : Math.max(...valid.map((r) => r.to));

  // Invisible anchor trace to define the depth axis range.
  const data = [{
    type: 'scatter',
    x: [0.5, 0.5],
    y: [yMin, yMax],
    mode: 'markers',
    marker: { size: 0, opacity: 0 },
    showlegend: false,
    hoverinfo: 'skip',
  }];

  const layoutImages = valid.map((rec) => ({
    source: rec.url,
    xref: 'x',
    yref: 'y',
    x: 0,
    y: rec.from,
    sizex: 1,
    sizey: rec.to - rec.from,
    xanchor: 'left',
    yanchor: 'top',
    sizing: 'stretch',
    layer: 'below',
  }));

  const layout = {
    images: layoutImages,
    xaxis: { range: [0, 1], visible: false, fixedrange: true },
    yaxis: { title: 'Depth (m)', autorange: 'reversed' },
    showlegend: false,
  };

  return { data, layout: applyStriplogLayoutDefaults(layout) };
}
