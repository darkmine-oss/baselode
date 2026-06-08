/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useMemo } from 'react';
import { buildScatterPlotConfig } from '../viz/scatterViz.js';
import { PlotPanel, PropertySelect, LogToggle } from './PanelControls.jsx';
import {
  defaultColorByColumn,
  detectCategoricalColumns,
  detectNumericColumns,
} from './columnDetection.js';
import { useControllable } from './useControllable.js';

/**
 * Interactive scatter panel: data + dropdowns in one drop-in
 * component.
 *
 * Wraps `buildScatterPlotConfig` with X / Y / Colour-by selectors
 * and per-axis log toggles.  Auto-detects numeric + categorical
 * columns from `rows` if the caller doesn't pass them.
 *
 * **Uncontrolled mode (default)**: state is held internally; the
 * panel seeds picks the first time columns are known and otherwise
 * leaves them alone.  Use `initialX` / `initialY` / `initialColorBy`
 * / `initialLogX` / `initialLogY` to override the seed.
 *
 * **Controlled mode**: pass `value` (`{ x, y, colorBy, logX, logY }`)
 * + `onChange(next)`.  The caller owns the state; the panel just
 * renders and reports.
 *
 * @param {Object} props
 * @param {Array<Object>} props.rows - Plot data; each row is an
 *   object keyed by column name.
 * @param {Array<string>} [props.numericColumns] - Override the
 *   auto-detected numeric column list.
 * @param {Array<string>} [props.categoricalColumns] - Override the
 *   auto-detected categorical column list (for the Colour-by
 *   dropdown).
 * @param {Object} [props.value] - Controlled state object (see above).
 * @param {Function} [props.onChange] - Controlled-mode setter.
 * @param {string} [props.initialX]
 * @param {string} [props.initialY]
 * @param {string} [props.initialColorBy]
 * @param {boolean} [props.initialLogX=true]
 * @param {boolean} [props.initialLogY=true]
 * @param {string|Object} [props.colourMap] - Passed straight to the
 *   config builder.
 * @param {Object} [props.template] - Plotly template.
 * @param {string} [props.title='Scatter']
 * @param {string} [props.description]
 * @param {number} [props.height=380]
 */
export function BaselodeScatterPanel({
  rows,
  numericColumns,
  categoricalColumns,
  value,
  onChange,
  initialX = '',
  initialY = '',
  initialColorBy = '',
  initialLogX = true,
  initialLogY = true,
  colourMap = null,
  template,
  title = 'Scatter',
  description,
  height = 380,
}) {
  // Auto-detect once when caller doesn't supply column lists.  The
  // hooks always fire so we don't break the Rules of Hooks; the
  // override is just a `??` away.
  const autoNumeric = useMemo(() => detectNumericColumns(rows), [rows]);
  const autoCategorical = useMemo(() => detectCategoricalColumns(rows), [rows]);
  const numerics = numericColumns ?? autoNumeric;
  const categoricals = categoricalColumns ?? autoCategorical;

  const [state, setState] = useControllable({
    value,
    onChange,
    defaultValue: {
      x: initialX,
      y: initialY,
      colorBy: initialColorBy,
      logX: initialLogX,
      logY: initialLogY,
    },
  });

  // Seed empty picks once columns are known.  Functional form means
  // we never overwrite a user's explicit pick — even after a
  // column-list change.
  useEffect(() => {
    if (!numerics.length) return;
    const get = (idx) => numerics[Math.min(idx, numerics.length - 1)];
    setState((current) => {
      const patch = {};
      if (!current.x) patch.x = get(0);
      if (!current.y) patch.y = numerics.length > 1 ? get(1) : get(0);
      return patch;
    });
  }, [numerics, setState]);

  useEffect(() => {
    if (!categoricals.length) return;
    const defaultColor = defaultColorByColumn(categoricals);
    if (!defaultColor) return;
    setState((current) => (current.colorBy ? {} : { colorBy: defaultColor }));
  }, [categoricals, setState]);

  const config = useMemo(() => buildScatterPlotConfig(rows || [], {
    xProp: state.x,
    yProp: state.y,
    colorBy: state.colorBy,
    colourMap,
    log: { x: state.logX, y: state.logY },
    template,
  }), [rows, state, colourMap, template]);

  return (
    <PlotPanel
      title={title}
      description={description}
      controls={(
        <>
          <PropertySelect
            label="X"
            value={state.x}
            onChange={(x) => setState({ x })}
            options={numerics}
          />
          <PropertySelect
            label="Y"
            value={state.y}
            onChange={(y) => setState({ y })}
            options={numerics}
          />
          <PropertySelect
            label="Colour by"
            value={state.colorBy}
            onChange={(colorBy) => setState({ colorBy })}
            options={categoricals}
            includeBlank
          />
          <LogToggle label="log X" value={state.logX} onChange={(logX) => setState({ logX })} />
          <LogToggle label="log Y" value={state.logY} onChange={(logY) => setState({ logY })} />
        </>
      )}
      data={config.data}
      layout={config.layout}
      height={height}
    />
  );
}
