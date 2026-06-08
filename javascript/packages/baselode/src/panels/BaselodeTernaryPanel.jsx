/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useMemo } from 'react';
import { buildTernaryPlotConfig } from '../viz/ternaryPlotViz.js';
import { PlotPanel, PropertySelect } from './PanelControls.jsx';
import {
  defaultColorByColumn,
  detectCategoricalColumns,
  detectNumericColumns,
} from './columnDetection.js';
import { useControllable } from './useControllable.js';

/**
 * Interactive ternary-plot panel: A / B / C apex selectors and an
 * optional Colour-by.  No log toggles — the apices are normalised
 * to percentages.
 *
 * State shape: `{ a, b, c, colorBy }`.
 */
export function BaselodeTernaryPanel({
  rows,
  numericColumns,
  categoricalColumns,
  value,
  onChange,
  initialA = '',
  initialB = '',
  initialC = '',
  initialColorBy = '',
  colourMap = null,
  template,
  title = 'Ternary',
  description,
  height = 480,
}) {
  const autoNumeric = useMemo(() => detectNumericColumns(rows), [rows]);
  const autoCategorical = useMemo(() => detectCategoricalColumns(rows), [rows]);
  const numerics = numericColumns ?? autoNumeric;
  const categoricals = categoricalColumns ?? autoCategorical;

  const [state, setState] = useControllable({
    value,
    onChange,
    defaultValue: {
      a: initialA,
      b: initialB,
      c: initialC,
      colorBy: initialColorBy,
    },
  });

  useEffect(() => {
    if (!numerics.length) return;
    const get = (idx) => numerics[Math.min(idx, numerics.length - 1)];
    setState((current) => {
      const patch = {};
      if (!current.a) patch.a = get(0);
      if (!current.b) patch.b = get(1);
      if (!current.c) patch.c = get(2);
      return patch;
    });
  }, [numerics, setState]);

  useEffect(() => {
    if (!categoricals.length) return;
    const defaultColor = defaultColorByColumn(categoricals);
    if (!defaultColor) return;
    setState((current) => (current.colorBy ? {} : { colorBy: defaultColor }));
  }, [categoricals, setState]);

  const config = useMemo(() => buildTernaryPlotConfig(rows || [], {
    aProp: state.a,
    bProp: state.b,
    cProp: state.c,
    colorBy: state.colorBy,
    colourMap,
    template,
  }), [rows, state, colourMap, template]);

  return (
    <PlotPanel
      title={title}
      description={description}
      controls={(
        <>
          <PropertySelect label="A" value={state.a} onChange={(a) => setState({ a })} options={numerics} />
          <PropertySelect label="B" value={state.b} onChange={(b) => setState({ b })} options={numerics} />
          <PropertySelect label="C" value={state.c} onChange={(c) => setState({ c })} options={numerics} />
          <PropertySelect
            label="Colour by"
            value={state.colorBy}
            onChange={(colorBy) => setState({ colorBy })}
            options={categoricals}
            includeBlank
          />
        </>
      )}
      data={config.data}
      layout={config.layout}
      height={height}
    />
  );
}
