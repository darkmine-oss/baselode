/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useMemo } from 'react';
import { buildScatterPlotConfig } from '../viz/scatterViz.js';
import { BASELODE_TEMPLATE } from '../viz/baselodeTemplate.js';
import { BASELODE_DARK_TEMPLATE } from '../viz/baselodeDarkTemplate.js';
import { PlotlyChart } from './PlotlyChart.jsx';

function resolveTemplate(template) {
  if (template === 'baselode-dark') return BASELODE_DARK_TEMPLATE;
  if (template === 'plotly-default') return null;
  return BASELODE_TEMPLATE;
}

/**
 * React wrapper around :func:`buildScatterPlotConfig`.  Accepts the same
 * options object the config builder takes, with the addition of
 * `rows` / `template` / `height` / `showModeBar` from the tool-UI schema.
 */
export function BaselodeScatterPlotToolUI({
  rows = [],
  xProp,
  yProp,
  colorBy,
  colourMap,
  markerColor,
  markerSize,
  markerOpacity,
  log,
  title,
  template,
  height = 480,
  showModeBar = false,
}) {
  const { data, layout } = useMemo(
    () => buildScatterPlotConfig(rows, {
      xProp,
      yProp,
      colorBy,
      colourMap,
      markerColor,
      markerSize,
      markerOpacity,
      log,
      title,
      template: resolveTemplate(template),
    }),
    [rows, xProp, yProp, colorBy, colourMap, markerColor, markerSize, markerOpacity, log, title, template],
  );

  return <PlotlyChart data={data} layout={layout} height={height} showModeBar={showModeBar} />;
}
