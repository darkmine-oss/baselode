/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
  buildCategoricalColourResolver,
  collectNumericValues,
  groupRowsBy,
} from './analyticsViz.js';
import { BASELODE_TEMPLATE } from './baselodeTemplate.js';

/**
 * Build a Plotly box-plot config — distribution quartiles per category.
 *
 * @param {Array<Object>} rows
 * @param {Object} options
 * @param {string} options.prop - Numeric column whose distribution to plot.
 * @param {string} [options.groupBy] - Categorical column; one box per group.
 *   When absent the whole row set becomes one box.
 * @param {string|Object} [options.colourMap]
 * @param {string} [options.markerColor='#475569']
 * @param {boolean} [options.showOutliers=true]
 * @param {boolean} [options.log=false] - Log-scale the value axis.
 * @param {string} [options.title]
 * @param {string} [options.yTitle] - Defaults to prop.
 * @param {Object} [options.template=BASELODE_TEMPLATE]
 * @returns {{ data: Array<Object>, layout: Object }}
 */
export function buildBoxPlotConfig(rows, options = {}) {
  const {
    prop,
    groupBy = null,
    colourMap = null,
    markerColor = '#475569',
    showOutliers = true,
    log = false,
    title = '',
    yTitle,
    template = BASELODE_TEMPLATE,
  } = options;

  if (!prop) {
    return {
      data: [],
      layout: { title: { text: title || '' }, template },
    };
  }

  const data = [];
  const resolveColour = buildCategoricalColourResolver(colourMap, markerColor);

  if (groupBy) {
    const groups = groupRowsBy(rows, groupBy);
    for (const group of groups) {
      const { values } = collectNumericValues(group.rows, prop);
      if (!values.length) continue;
      data.push({
        type: 'box',
        y: values,
        name: group.key,
        boxpoints: showOutliers ? 'outliers' : false,
        marker: { color: resolveColour(group.key) },
        line: { color: resolveColour(group.key) },
      });
    }
  } else {
    const { values } = collectNumericValues(rows, prop);
    if (values.length) {
      data.push({
        type: 'box',
        y: values,
        name: prop,
        boxpoints: showOutliers ? 'outliers' : false,
        marker: { color: markerColor },
        line: { color: markerColor },
      });
    }
  }

  const layout = {
    title: { text: title || '' },
    template,
    xaxis: { title: { text: groupBy || '' } },
    yaxis: { title: { text: yTitle || prop }, type: log ? 'log' : 'linear' },
    legend: { itemclick: 'toggleothers' },
    margin: { l: 60, r: 20, t: title ? 50 : 20, b: 60 },
    showlegend: Boolean(groupBy),
  };

  return { data, layout };
}
