/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useMemo } from 'react';
import { buildHistogramPlotConfig } from '../viz/histogramViz.js';
import { BASELODE_TEMPLATE } from '../viz/baselodeTemplate.js';
import { BASELODE_DARK_TEMPLATE } from '../viz/baselodeDarkTemplate.js';
import { PlotlyChart } from './PlotlyChart.jsx';

function resolveTemplate(template) {
  if (template === 'baselode-dark') return BASELODE_DARK_TEMPLATE;
  if (template === 'plotly-default') return null;
  return BASELODE_TEMPLATE;
}

export function BaselodeHistogramPlotToolUI({
  rows = [],
  prop,
  groupBy,
  colourMap,
  markerColor,
  bins,
  opacity,
  log,
  title,
  template,
  height = 420,
  showModeBar = false,
}) {
  const { data, layout } = useMemo(
    () => buildHistogramPlotConfig(rows, {
      prop,
      groupBy,
      colourMap,
      markerColor,
      bins,
      opacity,
      log,
      title,
      template: resolveTemplate(template),
    }),
    [rows, prop, groupBy, colourMap, markerColor, bins, opacity, log, title, template],
  );

  return <PlotlyChart data={data} layout={layout} height={height} showModeBar={showModeBar} />;
}
