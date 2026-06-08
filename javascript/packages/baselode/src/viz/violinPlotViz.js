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
 * Build a Plotly violin-plot config — distribution shape per category.
 *
 * Mirrors :func:`buildBoxPlotConfig` shape; the only difference is the
 * Plotly trace type and the inner-box default.
 *
 * @param {Array<Object>} rows
 * @param {Object} options
 * @param {string} options.prop
 * @param {string} [options.groupBy]
 * @param {string|Object} [options.colourMap]
 * @param {string} [options.markerColor='#475569']
 * @param {boolean} [options.showBox=true] - Inner-box marker.
 * @param {boolean} [options.showMeanLine=true]
 * @param {boolean} [options.log=false]
 * @param {string} [options.title]
 * @param {string} [options.yTitle]
 * @param {Object} [options.template=BASELODE_TEMPLATE]
 * @returns {{ data: Array<Object>, layout: Object }}
 */
export function buildViolinPlotConfig(rows, options = {}) {
  const {
    prop,
    groupBy = null,
    colourMap = null,
    markerColor = '#475569',
    showBox = true,
    showMeanLine = true,
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
  const baseTrace = {
    type: 'violin',
    box: { visible: showBox },
    meanline: { visible: showMeanLine },
    points: 'outliers',
  };

  if (groupBy) {
    const groups = groupRowsBy(rows, groupBy);
    for (const group of groups) {
      const { values } = collectNumericValues(group.rows, prop);
      if (!values.length) continue;
      const colour = resolveColour(group.key);
      data.push({
        ...baseTrace,
        y: values,
        name: group.key,
        marker: { color: colour },
        line: { color: colour },
      });
    }
  } else {
    const { values } = collectNumericValues(rows, prop);
    if (values.length) {
      data.push({
        ...baseTrace,
        y: values,
        name: prop,
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
    violingap: 0.2,
    violinmode: 'group',
  };

  return { data, layout };
}
