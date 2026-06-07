/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useMemo } from 'react';
import { buildTernaryPlotConfig } from '../viz/ternaryPlotViz.js';
import { BASELODE_TEMPLATE } from '../viz/baselodeTemplate.js';
import { BASELODE_DARK_TEMPLATE } from '../viz/baselodeDarkTemplate.js';
import { PlotlyChart } from './PlotlyChart.jsx';

function resolveTemplate(template) {
  if (template === 'baselode-dark') return BASELODE_DARK_TEMPLATE;
  if (template === 'plotly-default') return null;
  return BASELODE_TEMPLATE;
}

export function BaselodeTernaryPlotToolUI({
  rows = [],
  aProp,
  bProp,
  cProp,
  colorBy,
  colourMap,
  markerColor,
  markerSize,
  markerOpacity,
  title,
  template,
  height = 520,
  showModeBar = false,
}) {
  const { data, layout } = useMemo(
    () => buildTernaryPlotConfig(rows, {
      aProp,
      bProp,
      cProp,
      colorBy,
      colourMap,
      markerColor,
      markerSize,
      markerOpacity,
      title,
      template: resolveTemplate(template),
    }),
    [rows, aProp, bProp, cProp, colorBy, colourMap, markerColor, markerSize, markerOpacity, title, template],
  );

  return <PlotlyChart data={data} layout={layout} height={height} showModeBar={showModeBar} />;
}
