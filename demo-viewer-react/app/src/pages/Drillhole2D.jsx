/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  TracePlot,
  useDrillholeTraceGrid,
  BASELODE_DARK_TEMPLATE,
} from 'baselode';
import './Drillhole2D.css';
import { createPortal } from 'react-dom';
import { useDemoData } from '../context/DemoDataContext.jsx';

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
