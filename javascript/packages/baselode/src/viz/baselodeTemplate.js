/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Baselode Light Plotly template.
 *
 * Defines the Baselode visual identity for Plotly charts. Apply this template
 * by including it in the layout object passed to Plotly:
 *
 * ```js
 * import { BASELODE_TEMPLATE } from 'baselode';
 * Plotly.react(el, data, { ...layout, template: BASELODE_TEMPLATE });
 * ```
 *
 * Baselode plotting helpers apply this template by default. Pass a different
 * template as an option to override the visual style.
 */

/** @type {string} Name of the Baselode Plotly template. */
export const BASELODE_TEMPLATE_NAME = 'baselode';

/** @type {string} Alias for the Baselode Light template name. */
export const BASELODE_LIGHT_TEMPLATE_NAME = BASELODE_TEMPLATE_NAME;

/** @type {string[]} Default colorway used across Baselode charts. */
export const BASELODE_COLORWAY = [
  '#8b1e3f',
  '#2563eb',
  '#16a34a',
  '#f59e0b',
  '#7c3aed',
  '#0ea5e9',
  '#ef4444',
  '#10b981',
  '#f97316',
  '#8b5cf6',
];

/** @type {Object} Baselode Light colour palette. */
export const BASELODE_LIGHT = {
  bg:       '#ffffff',
  panel:    '#f8fafc',
  ink:      '#1e293b',
  ink_soft: '#64748b',
  grid:     '#e8e8e8',
  line:     '#d0d0d0',
  accent:   '#f59e0b',
  accent_2: '#fcd34d',
  muted_1:  '#94a3b8',
  muted_2:  '#cbd5e1',
  muted_3:  '#e2e8f0',
  primary:  '#8b1e3f',
  primary_2: '#a8324f',
};

/**
 * Baselode Plotly template object.
 *
 * This object can be passed directly as the ``template`` property of a Plotly
 * layout to apply Baselode's default visual style. Baselode plotting helpers
 * include this template in their returned layout objects automatically.
 *
 * @type {Object}
 */
export const BASELODE_TEMPLATE = {
  layout: {
    paper_bgcolor: BASELODE_LIGHT.bg,
    plot_bgcolor: BASELODE_LIGHT.bg,
    colorway: BASELODE_COLORWAY,
    font: {
      family: 'Inter, system-ui, sans-serif',
      size: 12,
      color: BASELODE_LIGHT.ink,
    },
    title: {
      font: { size: 14, color: BASELODE_LIGHT.ink },
      x: 0.05,
    },
    hovermode: 'x unified',
    hoverlabel: {
      bgcolor: BASELODE_LIGHT.bg,
      bordercolor: BASELODE_LIGHT.line,
      font: { size: 12, color: BASELODE_LIGHT.ink },
    },
    legend: {
      bgcolor: 'rgba(255,255,255,0.9)',
      bordercolor: BASELODE_LIGHT.muted_3,
      borderwidth: 1,
      font: { size: 11, color: BASELODE_LIGHT.ink },
      orientation: 'h',
      yanchor: 'bottom',
      y: 1.02,
      xanchor: 'left',
      x: 0.0,
    },
    xaxis: {
      showline: true,
      linewidth: 1,
      linecolor: BASELODE_LIGHT.line,
      mirror: false,
      ticks: 'outside',
      tickwidth: 1,
      tickcolor: BASELODE_LIGHT.line,
      ticklen: 4,
      showgrid: true,
      gridcolor: BASELODE_LIGHT.grid,
      gridwidth: 1,
      zeroline: false,
      title_font: { color: BASELODE_LIGHT.ink, size: 12 },
      tickfont: { color: BASELODE_LIGHT.ink_soft, size: 10 },
    },
    yaxis: {
      showline: true,
      linewidth: 1,
      linecolor: BASELODE_LIGHT.line,
      mirror: false,
      ticks: 'outside',
      tickwidth: 1,
      tickcolor: BASELODE_LIGHT.line,
      ticklen: 4,
      showgrid: true,
      gridcolor: BASELODE_LIGHT.grid,
      gridwidth: 1,
      zeroline: false,
      title_font: { color: BASELODE_LIGHT.ink, size: 12 },
      tickfont: { color: BASELODE_LIGHT.ink_soft, size: 10 },
    },
    modebar: {
      remove: ['select2d', 'lasso2d', 'autoScale2d'],
    },
    bargap: 0.18,
    bargroupgap: 0.08,
  },
  data: {
    scatter: [{
      mode: 'lines+markers',
      line: { width: 2, color: BASELODE_LIGHT.primary },
      marker: {
        size: 7,
        color: BASELODE_LIGHT.primary_2,
        line: { width: 1.5, color: BASELODE_LIGHT.bg },
      },
    }],
    bar: [{
      marker: {
        color: BASELODE_LIGHT.primary,
        line: { color: BASELODE_LIGHT.bg, width: 0 },
      },
    }],
    histogram: [{
      marker: {
        color: BASELODE_LIGHT.primary,
        line: { color: BASELODE_LIGHT.bg, width: 0 },
      },
    }],
    box: [{
      fillcolor: BASELODE_LIGHT.accent,
      line: { color: BASELODE_LIGHT.ink, width: 1.5 },
      marker: { color: BASELODE_LIGHT.ink },
    }],
    violin: [{
      fillcolor: BASELODE_LIGHT.accent,
      line: { color: BASELODE_LIGHT.ink, width: 1.5 },
      marker: { color: BASELODE_LIGHT.ink },
    }],
    heatmap: [{
      colorscale: [
        [0.00, '#ffffff'],
        [0.20, '#f1f5f9'],
        [0.40, '#cbd5e1'],
        [0.60, '#94a3b8'],
        [0.80, '#475569'],
        [1.00, '#1e293b'],
      ],
      colorbar: {
        outlinecolor: BASELODE_LIGHT.line,
        tickcolor: BASELODE_LIGHT.line,
        tickfont: { color: BASELODE_LIGHT.ink_soft },
      },
    }],
    contour: [{
      colorscale: [
        [0.00, '#ffffff'],
        [0.25, '#fef3c7'],
        [0.50, '#f59e0b'],
        [0.75, '#92400e'],
        [1.00, '#1e293b'],
      ],
      colorbar: {
        outlinecolor: BASELODE_LIGHT.line,
        tickcolor: BASELODE_LIGHT.line,
        tickfont: { color: BASELODE_LIGHT.ink_soft },
      },
    }],
  },
};

/** @type {Object} Alias for {@link BASELODE_TEMPLATE} — the Baselode Light theme. */
export const BASELODE_LIGHT_TEMPLATE = BASELODE_TEMPLATE;
