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
 * Build a Plotly scatter-plot config (data + layout) for analyte-vs-analyte
 * exploration.
 *
 * When *colorBy* is set the rows are partitioned by that property and
 * one scatter trace per group is emitted so the Plotly legend can
 * toggle each category independently.  Without *colorBy* a single
 * trace is emitted using *markerColor* (default blue-grey).
 *
 * @param {Array<Object>} rows - Source rows.
 * @param {Object} options
 * @param {string} options.xProp - Column for the x-axis.
 * @param {string} options.yProp - Column for the y-axis.
 * @param {string} [options.colorBy] - Categorical column to colour by.
 * @param {string|Object} [options.colourMap] - Built-in map name
 *   (`commodity`, `lithology`) or an explicit `{category: cssColour}` object.
 * @param {string} [options.markerColor='#475569'] - Used when colorBy is absent.
 * @param {number} [options.markerSize=6]
 * @param {number} [options.markerOpacity=0.7]
 * @param {{ x?: boolean, y?: boolean }} [options.log] - Log-scale per axis.
 * @param {string} [options.title]
 * @param {string} [options.xTitle] - Defaults to xProp.
 * @param {string} [options.yTitle] - Defaults to yProp.
 * @param {Object} [options.template=BASELODE_TEMPLATE] - Plotly template.
 * @returns {{ data: Array<Object>, layout: Object }}
 */
export function buildScatterPlotConfig(rows, options = {}) {
  const {
    xProp,
    yProp,
    colorBy = null,
    colourMap = null,
    markerColor = '#475569',
    markerSize = 6,
    markerOpacity = 0.7,
    log = {},
    title = '',
    xTitle,
    yTitle,
    template = BASELODE_TEMPLATE,
  } = options;

  if (!xProp || !yProp) {
    return {
      data: [],
      layout: { title: { text: title || '' }, template },
    };
  }

  const data = [];
  const resolveColour = buildCategoricalColourResolver(colourMap, markerColor);

  if (colorBy) {
    const groups = groupRowsBy(rows, colorBy);
    for (const group of groups) {
      const xs = [];
      const ys = [];
      const hoverTexts = [];
      for (const row of group.rows) {
        const x = asNumeric(row[xProp]);
        const y = asNumeric(row[yProp]);
        if (x == null || y == null) continue;
        xs.push(x);
        ys.push(y);
        hoverTexts.push(group.key);
      }
      if (!xs.length) continue;
      data.push({
        type: 'scattergl',
        mode: 'markers',
        x: xs,
        y: ys,
        name: group.key,
        text: hoverTexts,
        hovertemplate: `${xProp}: %{x}<br>${yProp}: %{y}<br>${colorBy}: %{text}<extra></extra>`,
        marker: {
          size: markerSize,
          opacity: markerOpacity,
          color: resolveColour(group.key),
        },
      });
    }
  } else {
    const xs = [];
    const ys = [];
    for (const row of rows || []) {
      if (!row) continue;
      const x = asNumeric(row[xProp]);
      const y = asNumeric(row[yProp]);
      if (x == null || y == null) continue;
      xs.push(x);
      ys.push(y);
    }
    if (xs.length) {
      data.push({
        type: 'scattergl',
        mode: 'markers',
        x: xs,
        y: ys,
        name: yProp,
        hovertemplate: `${xProp}: %{x}<br>${yProp}: %{y}<extra></extra>`,
        marker: { size: markerSize, opacity: markerOpacity, color: markerColor },
      });
    }
  }

  const layout = {
    title: { text: title || '' },
    template,
    xaxis: { title: { text: xTitle || xProp }, type: log.x ? 'log' : 'linear' },
    yaxis: { title: { text: yTitle || yProp }, type: log.y ? 'log' : 'linear' },
    legend: { itemclick: 'toggleothers' },
    margin: { l: 60, r: 20, t: title ? 50 : 20, b: 60 },
  };

  return { data, layout };
}
