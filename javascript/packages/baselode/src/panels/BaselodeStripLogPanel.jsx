/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import TracePlot from '../viz/TracePlot.jsx';
import useDrillholeTraceGrid from '../viz/useDrillholeTraceGrid.jsx';
import { useEffect } from 'react';

/**
 * Interactive strip-log panel for a single track.
 *
 * Wraps `useDrillholeTraceGrid` + `TracePlot` into one drop-in
 * component so an embedding app doesn't have to wire the hook +
 * picker plumbing itself.  `TracePlot` already ships interactive
 * hole / property / chart-type dropdowns, so this panel's job is
 * really just to spin up the hook with sensible defaults and pass
 * its state into the existing picker UI.
 *
 * For a multi-panel grid, render the panel N times — each one owns
 * its own hook instance with `plotCount=1`, which keeps the
 * controlled-state story simple per panel.
 *
 * @param {Object} props
 * @param {Array<Object>} props.holes - Pre-parsed hole data from a
 *   baselode loader (each hole carries `id` + `points`).
 * @param {string} [props.initialHoleId] - Hole to focus on first
 *   render.  Defaults to the first hole in `holes`.
 * @param {Object} [props.holeSelector] - Passed through to
 *   `TracePlot` for project / domain grouping (`{ kind:
 *   'group+hole', groupBy, groupLabel, ... }`).  When omitted, the
 *   default flat hole dropdown renders.
 * @param {Object} [props.template] - Plotly template.
 * @param {number} [props.height=380] - Chart height in pixels.
 */
export function BaselodeStripLogPanel({
  holes,
  initialHoleId = '',
  holeSelector,
  propertyMeta,
  template,
  height = 380,
}) {
  const {
    setFocusedHoleId,
    labeledHoleOptions,
    traceGraphs,
    handleConfigChange,
  } = useDrillholeTraceGrid({
    initialFocusedHoleId: initialHoleId,
    extraHoles: holes || [],
    plotCount: 1,
  });

  // If the caller updates `initialHoleId` after mount (e.g. routes
  // change), push it through.  Mirrors the existing Drillhole2D
  // pattern.
  useEffect(() => {
    if (initialHoleId) setFocusedHoleId(initialHoleId);
  }, [initialHoleId, setFocusedHoleId]);

  const graph = traceGraphs[0];
  return (
    <TracePlot
      config={graph?.config || { holeId: '', property: '', chartType: 'markers+line' }}
      graph={graph}
      holeOptions={labeledHoleOptions}
      holeSelector={holeSelector}
      propertyOptions={graph?.propertyOptions || []}
      propertyMeta={propertyMeta}
      onConfigChange={(patch) => handleConfigChange(0, patch)}
      template={template}
      height={height}
    />
  );
}
