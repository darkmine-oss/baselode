/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useMemo } from 'react';
import { buildViolinPlotConfig } from '../viz/violinPlotViz.js';
import { BASELODE_TEMPLATE } from '../viz/baselodeTemplate.js';
import { BASELODE_DARK_TEMPLATE } from '../viz/baselodeDarkTemplate.js';
import { PlotlyChart } from './PlotlyChart.jsx';

function resolveTemplate(template) {
  if (template === 'baselode-dark') return BASELODE_DARK_TEMPLATE;
  if (template === 'plotly-default') return null;
  return BASELODE_TEMPLATE;
}

export function BaselodeViolinPlotToolUI({
  rows = [],
  prop,
  groupBy,
  colourMap,
  markerColor,
  showBox,
  showMeanLine,
  log,
  title,
  template,
  height = 420,
  showModeBar = false,
}) {
  const { data, layout } = useMemo(
    () => buildViolinPlotConfig(rows, {
      prop,
      groupBy,
      colourMap,
      markerColor,
      showBox,
      showMeanLine,
      log,
      title,
      template: resolveTemplate(template),
    }),
    [rows, prop, groupBy, colourMap, markerColor, showBox, showMeanLine, log, title, template],
  );

  return <PlotlyChart data={data} layout={layout} height={height} showModeBar={showModeBar} />;
}
