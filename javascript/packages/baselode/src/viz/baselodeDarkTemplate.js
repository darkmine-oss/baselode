/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Baselode Dark Plotly template.
 *
 * Applies the Baselode Dark visual identity: dark warm backgrounds, Lexend
 * typography, subtle warm grid lines, and light ink primary colours accented
 * with the signature highlight yellow.
 *
 * ```js
 * import { BASELODE_DARK_TEMPLATE } from 'baselode';
 * Plotly.react(el, data, { ...layout, template: BASELODE_DARK_TEMPLATE });
 * ```
 */

/** @type {Object} Baselode Dark colour palette. */
export const BASELODE_DARK = {
  bg:       '#1b1b1f',
  panel:    '#25252a',
  ink:      '#f0f0e4',
  ink_soft: '#c8c8b8',
  grid:     '#2a2a26',
  line:     '#3a3a34',
  accent:   '#ffffbb',
  accent_2: '#f3ef9b',
  muted_1:  '#8a8a80',
  muted_2:  '#5e5e56',
  muted_3:  '#3a3a34',
};

/** @type {string} Name key for the Baselode Dark template. */
export const BASELODE_DARK_TEMPLATE_NAME = 'baselode-dark';

/**
 * Baselode Dark Plotly template object.
 *
 * Pass directly as the ``template`` property of a Plotly layout to apply
 * the Baselode Dark visual style.
 *
 * @type {Object}
 */
export const BASELODE_DARK_TEMPLATE = {
  layout: {
    font: {
      family: 'Inter, Arial, sans-serif',
      color: BASELODE_DARK.ink,
      size: 14,
    },
    title: {
      x: 0.02,
      xanchor: 'left',
      font: {
        family: 'Inter, Arial, sans-serif',
        size: 22,
        color: BASELODE_DARK.ink,
      },
    },
    paper_bgcolor: BASELODE_DARK.bg,
    plot_bgcolor: BASELODE_DARK.bg,
    colorway: [
      BASELODE_DARK.ink,
      BASELODE_DARK.accent,
      BASELODE_DARK.muted_1,
      BASELODE_DARK.accent_2,
      BASELODE_DARK.muted_2,
      BASELODE_DARK.muted_3,
    ],
    margin: { l: 70, r: 30, t: 70, b: 60 },
    hovermode: 'x unified',
    hoverlabel: {
      bgcolor: BASELODE_DARK.panel,
      bordercolor: BASELODE_DARK.accent,
      font: {
        family: 'Inter, Arial, sans-serif',
        color: BASELODE_DARK.ink,
        size: 13,
      },
    },
    legend: {
      bgcolor: 'rgba(37,37,42,0.88)',
      bordercolor: BASELODE_DARK.line,
      borderwidth: 1,
      font: {
        family: 'Inter, Arial, sans-serif',
        color: BASELODE_DARK.ink,
        size: 12,
      },
      orientation: 'h',
      yanchor: 'bottom',
      y: 1.02,
      xanchor: 'left',
      x: 0.0,
    },
    xaxis: {
      showline: false,
      ticks: 'outside',
      tickwidth: 1,
      tickcolor: BASELODE_DARK.muted_1,
      ticklen: 6,
      showgrid: true,
      gridcolor: BASELODE_DARK.grid,
      gridwidth: 1,
      zeroline: false,
      title_font: { color: BASELODE_DARK.ink },
      tickfont: { color: BASELODE_DARK.ink_soft },
    },
    yaxis: {
      showline: false,
      ticks: 'outside',
      tickwidth: 1,
      tickcolor: BASELODE_DARK.muted_1,
      ticklen: 6,
      showgrid: true,
      gridcolor: BASELODE_DARK.grid,
      gridwidth: 1,
      zeroline: false,
      title_font: { color: BASELODE_DARK.ink },
      tickfont: { color: BASELODE_DARK.ink_soft },
    },
    bargap: 0.18,
    bargroupgap: 0.08,
  },
  data: {
    scatter: [{
      mode: 'lines+markers',
      line: { width: 2.5, color: BASELODE_DARK.ink },
      marker: {
        size: 7,
        color: BASELODE_DARK.ink,
        line: { width: 1.5, color: BASELODE_DARK.bg },
      },
    }],
    bar: [{
      marker: {
        color: BASELODE_DARK.ink,
        line: { color: BASELODE_DARK.bg, width: 0 },
      },
    }],
    histogram: [{
      marker: {
        color: BASELODE_DARK.ink,
        line: { color: BASELODE_DARK.bg, width: 0 },
      },
    }],
    box: [{
      fillcolor: BASELODE_DARK.accent,
      line: { color: BASELODE_DARK.ink, width: 1.5 },
      marker: { color: BASELODE_DARK.ink },
    }],
    violin: [{
      fillcolor: BASELODE_DARK.accent,
      line: { color: BASELODE_DARK.ink, width: 1.5 },
      marker: { color: BASELODE_DARK.ink },
    }],
    heatmap: [{
      colorscale: [
        [0.00, '#1b1b1f'],
        [0.20, '#2e2e28'],
        [0.40, '#5e5e50'],
        [0.60, '#c8c89a'],
        [0.80, '#f3ef9b'],
        [1.00, '#ffffbb'],
      ],
      colorbar: {
        outlinecolor: BASELODE_DARK.ink,
        tickcolor: BASELODE_DARK.ink,
        tickfont: { color: BASELODE_DARK.ink_soft },
      },
    }],
    contour: [{
      colorscale: [
        [0.00, '#1b1b1f'],
        [0.25, '#2e2e28'],
        [0.50, '#6b6b50'],
        [0.75, '#f3ef9b'],
        [1.00, '#ffffbb'],
      ],
      colorbar: {
        outlinecolor: BASELODE_DARK.ink,
        tickcolor: BASELODE_DARK.ink,
        tickfont: { color: BASELODE_DARK.ink_soft },
      },
    }],
  },
};
