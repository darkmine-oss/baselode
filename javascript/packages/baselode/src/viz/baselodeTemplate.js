/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Baselode Plotly template.
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
    paper_bgcolor: 'white',
    plot_bgcolor: 'white',
    colorway: BASELODE_COLORWAY,
    font: {
      family: 'Inter, system-ui, sans-serif',
      size: 12,
      color: '#1e293b',
    },
    title: {
      font: { size: 14, color: '#0f172a' },
      x: 0.05,
    },
    xaxis: {
      gridcolor: '#e8e8e8',
      linecolor: '#d0d0d0',
      zerolinecolor: '#d0d0d0',
      tickfont: { size: 10 },
      title: { font: { size: 12 } },
    },
    yaxis: {
      gridcolor: '#e8e8e8',
      linecolor: '#d0d0d0',
      zerolinecolor: '#d0d0d0',
      tickfont: { size: 10 },
      title: { font: { size: 12 } },
    },
    legend: {
      bgcolor: 'rgba(255,255,255,0.9)',
      bordercolor: '#e2e8f0',
      borderwidth: 1,
      font: { size: 11 },
    },
    hoverlabel: {
      bgcolor: 'white',
      bordercolor: '#cbd5e1',
      font: { size: 12, color: '#1e293b' },
    },
    modebar: {
      remove: ['select2d', 'lasso2d', 'autoScale2d'],
    },
  },
};
