/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useMemo } from 'react';
import { buildViolinPlotConfig } from '../viz/violinPlotViz.js';
import { LogToggle, PlotPanel, PropertySelect } from './PanelControls.jsx';
import {
  defaultColorByColumn,
  detectCategoricalColumns,
  detectNumericColumns,
} from './columnDetection.js';
import { useControllable } from './useControllable.js';

/**
 * Interactive violin-plot panel: same control surface as
 * `BaselodeBoxPanel` (Property + Group-by + log-Y).  Inner box +
 * mean line are on by default per the underlying primitive.
 *
 * State shape: `{ prop, groupBy, logY }`.
 */
export function BaselodeViolinPanel({
  rows,
  numericColumns,
  categoricalColumns,
  value,
  onChange,
  initialProp = '',
  initialGroupBy = '',
  initialLogY = true,
  colourMap = null,
  template,
  title = 'Violin',
  description,
  height = 360,
}) {
  const autoNumeric = useMemo(() => detectNumericColumns(rows), [rows]);
  const autoCategorical = useMemo(() => detectCategoricalColumns(rows), [rows]);
  const numerics = numericColumns ?? autoNumeric;
  const categoricals = categoricalColumns ?? autoCategorical;

  const [state, setState] = useControllable({
    value,
    onChange,
    defaultValue: { prop: initialProp, groupBy: initialGroupBy, logY: initialLogY },
  });

  useEffect(() => {
    if (!numerics.length) return;
    setState((current) => (current.prop ? {} : { prop: numerics[0] }));
  }, [numerics, setState]);

  useEffect(() => {
    if (!categoricals.length) return;
    const defaultColor = defaultColorByColumn(categoricals);
    if (!defaultColor) return;
    setState((current) => (current.groupBy ? {} : { groupBy: defaultColor }));
  }, [categoricals, setState]);

  const config = useMemo(() => buildViolinPlotConfig(rows || [], {
    prop: state.prop,
    groupBy: state.groupBy,
    colourMap,
    log: state.logY,
    template,
  }), [rows, state, colourMap, template]);

  return (
    <PlotPanel
      title={title}
      description={description}
      controls={(
        <>
          <PropertySelect
            label="Property"
            value={state.prop}
            onChange={(prop) => setState({ prop })}
            options={numerics}
          />
          <PropertySelect
            label="Group by"
            value={state.groupBy}
            onChange={(groupBy) => setState({ groupBy })}
            options={categoricals}
            includeBlank
          />
          <LogToggle label="log Y" value={state.logY} onChange={(logY) => setState({ logY })} />
        </>
      )}
      data={config.data}
      layout={config.layout}
      height={height}
    />
  );
}
