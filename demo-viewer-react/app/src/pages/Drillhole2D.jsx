/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  TracePlot,
  useDrillholeTraceGrid,
  BASELODE_DARK_TEMPLATE,
  BASELODE_TEMPLATE,
} from 'baselode';
import 'baselode/style.css';
import './Drillhole2D.css';
import { createPortal } from 'react-dom';
import { useDemoData } from '../context/DemoDataContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { loadDemoGeophysicsCsvText } from '../data/demoGswaData.js';
import { parseGeophysicsIntervalHoles } from '../data/geophysicsHoles.js';

const PLOT_COUNT = 4;

// The demo GSWA assay columns encode the unit as a trailing token, e.g.
// "Au_PPM". Split that into a clean label + unit so the strip-log axes and
// tooltips read "Au (ppm)" rather than the raw "Au_PPM" — otherwise a column
// shown as bare "Au" would leave the reader guessing at the units. Production
// datasets supply this through per-row `analysis_uom` metadata instead.
const UNIT_SUFFIXES = {
  ppm: 'ppm',
  ppb: 'ppb',
  pct: '%',
  gpt: 'g/t',
  oz: 'oz/t',
};

function titleCase(token) {
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function metaForProperty(property) {
  if (typeof property !== 'string') return null;
  const tokens = property.split(/[_\-/\s]+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const unit = UNIT_SUFFIXES[tokens[tokens.length - 1].toLowerCase()];
  if (!unit) return null;
  // Element symbols (Au, Cu, …) read best title-cased regardless of source casing.
  return { label: tokens.slice(0, -1).map(titleCase).join(' '), unit };
}

/**
 * Build a propertyMeta map by inspecting every row's keys.  Cheap
 * enough to do once per render given the dataset is fixed for the
 * demo; production code would use upstream `analysis_uom` instead.
 */
function buildPropertyMeta(combinedHoles) {
  const map = {};
  for (const hole of combinedHoles || []) {
    const points = hole?.points || hole?.rows || [];
    for (const row of points) {
      for (const key of Object.keys(row || {})) {
        if (key in map) continue;
        const meta = metaForProperty(key);
        if (meta) map[key] = meta;
      }
    }
  }
  return map;
}

function Drillhole2D() {
  const location = useLocation();
  const { combinedHoles } = useDemoData();
  const { theme } = useTheme();
  const template = theme === 'dark' ? BASELODE_DARK_TEMPLATE : BASELODE_TEMPLATE;

  // Geophysics probe logs (resistivity, gamma, density, mag-sus) join the
  // grid as extra interval holes so their channels show up as ordinary
  // numeric properties — the natural data for the log-scale toggle below.
  const [geophysicsHoles, setGeophysicsHoles] = useState([]);
  useEffect(() => {
    let cancelled = false;
    loadDemoGeophysicsCsvText()
      .then((csvText) => parseGeophysicsIntervalHoles(csvText))
      .then((holes) => {
        if (!cancelled) setGeophysicsHoles(holes);
      })
      .catch((err) => console.warn('Geophysics demo data load failed:', err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const gridHoles = useMemo(
    () => [...(combinedHoles || []), ...geophysicsHoles],
    [combinedHoles, geophysicsHoles]
  );
  const holeCount = gridHoles.length;

  const propertyMeta = useMemo(() => buildPropertyMeta(gridHoles), [gridHoles]);

  const {
    setFocusedHoleId,
    labeledHoleOptions,
    traceGraphs,
    handleConfigChange,
  } = useDrillholeTraceGrid({
    initialFocusedHoleId: location.state?.holeId || '',
    extraHoles: gridHoles,
    plotCount: PLOT_COUNT,
  });

  // Push later initialHoleId changes (route nav, parent re-render)
  // through to the hook.
  useEffect(() => {
    if (location.state?.holeId) setFocusedHoleId(location.state.holeId);
  }, [location.state?.holeId, setFocusedHoleId]);

  // Per-track log-scale state lives here (not in the hook's trace configs)
  // because `useDrillholeTraceGrid` rebuilds each graph's config from its
  // own fields — the page owns the toggle and folds it into the config
  // passed to TracePlot.
  const [trackLogScale, setTrackLogScale] = useState(() => Array(PLOT_COUNT).fill(false));
  const [trackPatterns, setTrackPatterns] = useState(() => Array(PLOT_COUNT).fill(false));
  const [trackStepped, setTrackStepped] = useState(() => Array(PLOT_COUNT).fill(false));
  const [trackFillArea, setTrackFillArea] = useState(() => Array(PLOT_COUNT).fill(false));

  const gridStyle = { gridTemplateColumns: `repeat(${PLOT_COUNT}, minmax(0, 1fr))` };

  return (
    <div className="drillhole2d-container">
      <div className="drillhole2d-header">
        <h2>Drillhole Strip Logs</h2>
      </div>

      <div className="baselode-strip-log-grid drillhole2d-grid" style={gridStyle}>
        {Array.from({ length: PLOT_COUNT }).map((_, trackIndex) => {
          const graph = traceGraphs[trackIndex];
          const config = {
            ...(graph?.config || { holeId: '', property: '', chartType: 'markers+line' }),
            logScale: trackLogScale[trackIndex],
            usePatterns: trackPatterns[trackIndex],
            stepped: trackStepped[trackIndex],
            fillArea: trackFillArea[trackIndex],
          };
          const setTrackFlag = (setter, next) => setter((prev) => prev.map(
            (current, stateIndex) => (stateIndex === trackIndex ? next : current)
          ));
          return (
            <TracePlot
              key={trackIndex}
              config={config}
              graph={graph}
              holeOptions={labeledHoleOptions}
              propertyOptions={graph?.propertyOptions || []}
              propertyMeta={propertyMeta}
              onConfigChange={(patch) => {
                // The display toggles render inside TracePlot; they live in
                // page state, everything else flows to the trace-grid hook.
                const { logScale, usePatterns, stepped, fillArea, ...gridPatch } = patch;
                if (logScale !== undefined) setTrackFlag(setTrackLogScale, logScale);
                if (usePatterns !== undefined) setTrackFlag(setTrackPatterns, usePatterns);
                if (stepped !== undefined) setTrackFlag(setTrackStepped, stepped);
                if (fillArea !== undefined) setTrackFlag(setTrackFillArea, fillArea);
                if (Object.keys(gridPatch).length) handleConfigChange(trackIndex, gridPatch);
              }}
              template={template}
            />
          );
        })}
      </div>

      {(() => {
        const dataSourceTarget = typeof document !== 'undefined' ? document.getElementById('data-source-slot') : null;
        if (!dataSourceTarget) return null;
        const dataSourceInfo = (
          <div className="data-source-text">
            {holeCount > 0 && (
              <div>demo_gswa ({holeCount} holes, assay + structural + geology + geophysics)</div>
            )}
          </div>
        );
        return createPortal(dataSourceInfo, dataSourceTarget);
      })()}
    </div>
  );
}

export default Drillhole2D;
