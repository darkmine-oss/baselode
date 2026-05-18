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
} from 'baselode';
import 'baselode/style.css';
import './Drillhole2D.css';
import { createPortal } from 'react-dom';
import { useDemoData } from '../context/DemoDataContext.jsx';

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

function Drillhole2D() {
  const location = useLocation();
  const { combinedHoles } = useDemoData();
  const [useDarkTemplate, setUseDarkTemplate] = useState(false);
  const activeTemplate = useDarkTemplate ? BASELODE_DARK_TEMPLATE : undefined;

  const {
    error,
    setError,
    holeCount,
    setFocusedHoleId,
    labeledHoleOptions,
    traceGraphs,
    handleConfigChange,
  } = useDrillholeTraceGrid({
    initialFocusedHoleId: location.state?.holeId || '',
    extraHoles: combinedHoles,
    plotCount: 4,
  });

  // Per-property unit metadata keyed by the bare property name, derived once
  // from every graph's available properties.
  const propertyMeta = useMemo(() => {
    const map = {};
    traceGraphs.forEach((g) => {
      (g?.propertyOptions || []).forEach((p) => {
        if (p in map) return;
        const m = metaForProperty(p);
        if (m) map[p] = m;
      });
    });
    return map;
  }, [traceGraphs]);

  useEffect(() => {
    const holeIdFromNav = location.state?.holeId;
    if (holeIdFromNav) {
      setFocusedHoleId(holeIdFromNav);
      if (!holeCount) {
        setError((prev) => prev || `Loading data for hole ${holeIdFromNav}.`);
      }
    }
  }, [location.state, holeCount, setError, setFocusedHoleId]);

  return (
    <div className="drillhole2d-container">
      <div className="drillhole2d-header">
        <h2>Drillhole Strip Logs</h2>
        <div className="drillhole2d-controls">
          {error && <span className="error-text">{error}</span>}
          <button
            className={`template-toggle${useDarkTemplate ? ' active' : ''}`}
            onClick={() => setUseDarkTemplate((v) => !v)}
            title={useDarkTemplate ? 'Switch to Baselode Light theme' : 'Switch to Baselode Dark theme'}
          >
            {useDarkTemplate ? 'Dark' : 'Light'}
          </button>
        </div>
      </div>

      <div className="plots-grid">
        {Array.from({ length: 4 }).map((_, idx) => (
          <TracePlot
            key={idx}
            config={traceGraphs[idx]?.config || { holeId: '', property: '', chartType: 'markers+line' }}
            graph={traceGraphs[idx]}
            holeOptions={labeledHoleOptions}
            propertyOptions={traceGraphs[idx]?.propertyOptions || []}
            propertyMeta={propertyMeta}
            onConfigChange={(patch) => handleConfigChange(idx, patch)}
            template={activeTemplate}
          />
        ))}
      </div>
      {(() => {
        const dataSourceTarget = typeof document !== 'undefined' ? document.getElementById('data-source-slot') : null;
        if (!dataSourceTarget) return null;
        const dataSourceInfo = (
          <div className="data-source-text">
            {holeCount > 0 && (
              <div>demo_gswa ({holeCount} holes, assay + structural + geology)</div>
            )}
          </div>
        );
        return createPortal(dataSourceInfo, dataSourceTarget);
      })()}
    </div>
  );
}

export default Drillhole2D;
