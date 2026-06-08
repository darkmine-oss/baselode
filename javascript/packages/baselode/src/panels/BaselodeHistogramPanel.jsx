/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useMemo } from 'react';
import { buildHistogramPlotConfig } from '../viz/histogramViz.js';
import {
  BarmodeSelect,
  LogToggle,
  PlotPanel,
  PropertySelect,
} from './PanelControls.jsx';
import {
  defaultColorByColumn,
  detectCategoricalColumns,
  detectNumericColumns,
} from './columnDetection.js';
import { useControllable } from './useControllable.js';

/**
 * Interactive histogram panel.
 *
 * Property + Group-by selectors, log-Y toggle, and a 3-way stack
 * mode picker (overlay / stack / side-by-side) that only renders
 * when a group-by is selected.  Histogram X log is intentionally
 * omitted — it would log-scale the binned analyte axis, which is
 * almost never useful.
 *
 * Uncontrolled by default; controlled-mode via `{ value, onChange }`.
 * State shape: `{ prop, groupBy, logY, barmode }`.
 */
export function BaselodeHistogramPanel({
  rows,
  numericColumns,
  categoricalColumns,
  value,
  onChange,
  initialProp = '',
  initialGroupBy = '',
  initialLogY = true,
  initialBarmode = 'overlay',
  colourMap = null,
  template,
  title = 'Histogram',
  description,
  height = 380,
}) {
  const autoNumeric = useMemo(() => detectNumericColumns(rows), [rows]);
  const autoCategorical = useMemo(() => detectCategoricalColumns(rows), [rows]);
  const numerics = numericColumns ?? autoNumeric;
  const categoricals = categoricalColumns ?? autoCategorical;

  const [state, setState] = useControllable({
    value,
    onChange,
    defaultValue: {
      prop: initialProp,
      groupBy: initialGroupBy,
      logY: initialLogY,
      barmode: initialBarmode,
    },
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

  const config = useMemo(() => buildHistogramPlotConfig(rows || [], {
    prop: state.prop,
    groupBy: state.groupBy,
    colourMap,
    log: state.logY,
    barmode: state.barmode,
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
          {state.groupBy && (
            <BarmodeSelect
              value={state.barmode}
              onChange={(barmode) => setState({ barmode })}
            />
          )}
        </>
      )}
      data={config.data}
      layout={config.layout}
      height={height}
    />
  );
}
