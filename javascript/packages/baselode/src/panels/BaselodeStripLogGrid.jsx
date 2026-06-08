/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect } from 'react';
import TracePlot from '../viz/TracePlot.jsx';
import useDrillholeTraceGrid from '../viz/useDrillholeTraceGrid.jsx';
import './panels.css';

/**
 * N-up grid of strip-log panels sharing a single `useDrillholeTraceGrid`
 * hook instance.
 *
 * Unlike rendering N independent `BaselodeStripLogPanel`s, this
 * grid keeps a single shared focused-hole + column-classification
 * pass so the panels behave like one strip log split across tracks
 * rather than N disconnected mini-charts.  This is the right primitive
 * for the multi-track viewer pattern.
 *
 * For a single track (e.g. an embedded preview), use
 * `BaselodeStripLogPanel` — it's simpler and doesn't fight with
 * caller-owned layout.
 *
 * @param {Object} props
 * @param {Array<Object>} props.holes - Pre-parsed hole data; each
 *   hole carries `id` + `points`.
 * @param {number} [props.plotCount=4] - Number of tracks in the
 *   grid.  Capped 1..16 to match the hook's expectations.
 * @param {string} [props.initialHoleId] - Hole to focus on first
 *   render.
 * @param {Object} [props.holeSelector] - Passed through to every
 *   `TracePlot` in the grid for project / domain grouping.
 * @param {Object} [props.propertyMeta] - Per-property metadata map
 *   (`{ [property]: { label, unit, sourceAttribute } }`).  Passed
 *   through to each `TracePlot` so the axis titles + tooltips can
 *   render "Au (ppm)" instead of "Au_PPM".
 * @param {Object} [props.template] - Plotly template.
 * @param {number} [props.columns] - Override the grid column count.
 *   Defaults to `plotCount` for a single row, capped at 4 so wider
 *   layouts wrap.  Set explicitly for a 2x2 / 2x4 etc.
 * @param {string} [props.className] - Extra class on the grid
 *   container.
 */
export function BaselodeStripLogGrid({
  holes,
  plotCount = 4,
  initialHoleId = '',
  holeSelector,
  propertyMeta,
  template,
  columns,
  className = '',
}) {
  const {
    setFocusedHoleId,
    labeledHoleOptions,
    traceGraphs,
    handleConfigChange,
  } = useDrillholeTraceGrid({
    initialFocusedHoleId: initialHoleId,
    extraHoles: holes || [],
    plotCount,
  });

  // Push later initialHoleId changes (route nav, parent re-render)
  // through to the hook.  Mirrors the demo viewer's existing pattern.
  useEffect(() => {
    if (initialHoleId) setFocusedHoleId(initialHoleId);
  }, [initialHoleId, setFocusedHoleId]);

  // Default to one row of `plotCount`, capped at 4 columns so wider
  // grids wrap to a 4×(N/4) layout.
  const effectiveColumns = columns ?? Math.min(plotCount, 4);
  const gridStyle = {
    gridTemplateColumns: `repeat(${effectiveColumns}, minmax(0, 1fr))`,
  };

  return (
    <div className={`baselode-strip-log-grid ${className}`.trim()} style={gridStyle}>
      {Array.from({ length: plotCount }).map((_, idx) => {
        const graph = traceGraphs[idx];
        return (
          <TracePlot
            key={idx}
            config={graph?.config || { holeId: '', property: '', chartType: 'markers+line' }}
            graph={graph}
            holeOptions={labeledHoleOptions}
            holeSelector={holeSelector}
            propertyOptions={graph?.propertyOptions || []}
            propertyMeta={propertyMeta}
            onConfigChange={(patch) => handleConfigChange(idx, patch)}
            template={template}
          />
        );
      })}
    </div>
  );
}
