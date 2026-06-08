/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
  asNumeric,
  buildCategoricalColourResolver,
  groupRowsBy,
} from './analyticsViz.js';
import { BASELODE_TEMPLATE } from './baselodeTemplate.js';

/**
 * Build a Plotly ternary scatter config for three-analyte composition plots.
 *
 * Each row contributes one point on the ternary diagram with axes
 * proportional to the three component values.  Plotly's `scatterternary`
 * renormalises so the three components sum to 100, so the caller doesn't
 * have to pre-normalise; rows where any of the three values is missing
 * or non-numeric are skipped.
 *
 * @param {Array<Object>} rows
 * @param {Object} options
 * @param {string} options.aProp - Top apex.
 * @param {string} options.bProp - Lower-left apex.
 * @param {string} options.cProp - Lower-right apex.
 * @param {string} [options.colorBy] - Categorical column to colour by.
 * @param {string|Object} [options.colourMap]
 * @param {string} [options.markerColor='#475569'] - Used when colorBy absent.
 * @param {number} [options.markerSize=7]
 * @param {number} [options.markerOpacity=0.7]
 * @param {string} [options.title]
 * @param {Object} [options.template=BASELODE_TEMPLATE]
 * @returns {{ data: Array<Object>, layout: Object }}
 */
export function buildTernaryPlotConfig(rows, options = {}) {
  const {
    aProp,
    bProp,
    cProp,
    colorBy = null,
    colourMap = null,
    markerColor = '#475569',
    markerSize = 7,
    markerOpacity = 0.7,
    title = '',
    template = BASELODE_TEMPLATE,
  } = options;

  if (!aProp || !bProp || !cProp) {
    return {
      data: [],
      layout: { title: { text: title || '' }, template },
    };
  }

  const resolveColour = buildCategoricalColourResolver(colourMap, markerColor);

  const buildTrace = (groupRows, name, colour) => {
    const aValues = [];
    const bValues = [];
    const cValues = [];
    const hoverTexts = [];
    for (const row of groupRows) {
      if (!row) continue;
      const a = asNumeric(row[aProp]);
      const b = asNumeric(row[bProp]);
      const c = asNumeric(row[cProp]);
      if (a == null || b == null || c == null) continue;
      // Ternary components must be non-negative; Plotly will otherwise
      // either error or render at the opposite apex.
      if (a < 0 || b < 0 || c < 0) continue;
      if (a + b + c <= 0) continue;
      aValues.push(a);
      bValues.push(b);
      cValues.push(c);
      hoverTexts.push(name);
    }
    if (!aValues.length) return null;
    return {
      type: 'scatterternary',
      mode: 'markers',
      a: aValues,
      b: bValues,
      c: cValues,
      text: hoverTexts,
      name,
      hovertemplate: (
        `${aProp}: %{a}<br>${bProp}: %{b}<br>${cProp}: %{c}<br>`
        + (colorBy ? `${colorBy}: %{text}<br>` : '')
        + '<extra></extra>'
      ),
      marker: {
        size: markerSize,
        opacity: markerOpacity,
        color: colour,
      },
    };
  };

  const data = [];
  if (colorBy) {
    for (const group of groupRowsBy(rows, colorBy)) {
      const trace = buildTrace(group.rows, group.key, resolveColour(group.key));
      if (trace) data.push(trace);
    }
  } else {
    const trace = buildTrace(rows || [], `${aProp} · ${bProp} · ${cProp}`, markerColor);
    if (trace) data.push(trace);
  }

  const layout = {
    title: { text: title || '' },
    template,
    ternary: {
      sum: 100,
      aaxis: { title: { text: aProp } },
      baxis: { title: { text: bProp } },
      caxis: { title: { text: cProp } },
    },
    legend: { itemclick: 'toggleothers' },
    margin: { l: 60, r: 60, t: title ? 50 : 20, b: 60 },
  };

  return { data, layout };
}
