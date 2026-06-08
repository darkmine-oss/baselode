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
 * Build a Plotly histogram config — distribution of a single column.
 *
 * Without *groupBy* a single histogram trace is emitted.  With *groupBy*
 * one overlaid (`barmode: 'overlay'`) histogram per group is emitted so
 * the user can compare shapes across categories.
 *
 * @param {Array<Object>} rows
 * @param {Object} options
 * @param {string} options.prop - Column whose distribution to plot.
 * @param {string} [options.groupBy] - Categorical column for per-group overlay.
 * @param {string|Object} [options.colourMap]
 * @param {string} [options.markerColor='#475569']
 * @param {number} [options.bins=30] - Approximate bin count via `nbinsx`.
 * @param {number} [options.opacity=0.65] - Per-trace opacity; opaque single trace.
 * @param {(boolean|{x?: boolean, y?: boolean})} [options.log=false] -
 *   Log-scale the axes.  Pass a boolean for backward-compat (Y-only)
 *   or `{ x, y }` to control each axis independently.
 * @param {string} [options.title]
 * @param {string} [options.xTitle] - Defaults to prop.
 * @param {Object} [options.template=BASELODE_TEMPLATE]
 * @returns {{ data: Array<Object>, layout: Object }}
 */
export function buildHistogramPlotConfig(rows, options = {}) {
  const {
    prop,
    groupBy = null,
    colourMap = null,
    markerColor = '#475569',
    bins = 30,
    opacity = 0.65,
    log = false,
    title = '',
    xTitle,
    template = BASELODE_TEMPLATE,
  } = options;

  const xLog = typeof log === 'object' && log !== null ? Boolean(log.x) : false;
  const yLog = typeof log === 'object' && log !== null ? Boolean(log.y) : Boolean(log);

  if (!prop) {
    return {
      data: [],
      layout: { title: { text: title || '' }, template },
    };
  }

  const data = [];
  const resolveColour = buildCategoricalColourResolver(colourMap, markerColor);

  if (groupBy) {
    // Collect every group's values up front so we can compute a shared
    // bin grid.  Plotly's per-trace `nbinsx` autobins each group
    // independently, which means the bars don't line up between groups
    // — they appear offset rather than stacked at the same x position.
    const groups = groupRowsBy(rows, groupBy);
    const perGroup = [];
    let globalMin = Infinity;
    let globalMax = -Infinity;
    for (const group of groups) {
      const { values } = collectNumericValues(group.rows, prop);
      if (!values.length) continue;
      perGroup.push({ key: group.key, values });
      for (const value of values) {
        if (value < globalMin) globalMin = value;
        if (value > globalMax) globalMax = value;
      }
    }

    // Shared xbins: one start/end/size used by every trace so the bin
    // edges line up exactly.  `size = (max - min) / bins`, but guarded
    // against zero-width ranges (every value identical → one bin).
    let xbins;
    if (perGroup.length && Number.isFinite(globalMin) && Number.isFinite(globalMax)) {
      const span = globalMax - globalMin;
      const size = span > 0 ? span / bins : 1;
      xbins = { start: globalMin, end: globalMax + size, size };
    }

    for (const group of perGroup) {
      data.push({
        type: 'histogram',
        x: group.values,
        name: group.key,
        opacity,
        marker: { color: resolveColour(group.key) },
        ...(xbins ? { xbins, autobinx: false } : { nbinsx: bins }),
      });
    }
  } else {
    const { values } = collectNumericValues(rows, prop);
    if (values.length) {
      data.push({
        type: 'histogram',
        x: values,
        name: prop,
        opacity: 1,
        marker: { color: markerColor },
        nbinsx: bins,
      });
    }
  }

  // Counts are integers — force integer tick labels on the Y axis.
  // Plotly's auto-tick will pick fractional steps (eg. 0.2) when the
  // max bar height is tiny, producing "1.2 / 1.4 / 1.6" labels that
  // make no sense for counts.  For small datasets we additionally
  // pin `dtick: 1` to prevent integer-formatted dupes ("1 1 1 2").
  const maxPossibleCount = data.reduce((max, trace) => Math.max(max, trace.x.length), 0);
  const yaxis = {
    title: { text: 'count' },
    type: yLog ? 'log' : 'linear',
    tickformat: ',d',
  };
  if (!yLog && maxPossibleCount > 0 && maxPossibleCount <= 50) {
    yaxis.dtick = 1;
  }

  const layout = {
    title: { text: title || '' },
    template,
    barmode: groupBy ? 'overlay' : 'group',
    xaxis: { title: { text: xTitle || prop }, type: xLog ? 'log' : 'linear' },
    yaxis,
    legend: { itemclick: 'toggleothers' },
    margin: { l: 60, r: 20, t: title ? 50 : 20, b: 60 },
  };

  return { data, layout };
}
