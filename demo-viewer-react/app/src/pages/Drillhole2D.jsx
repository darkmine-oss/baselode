/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  TracePlot,
  useDrillholeTraceGrid,
  parseUnifiedDataset,
} from 'baselode';
import './Drillhole2D.css';
import { loadDemoGswaAssayCsvText, loadDemoStructuralCsvText } from '../data/demoGswaData.js';
import { createPortal } from 'react-dom';

function Drillhole2D() {
  const location = useLocation();
  // Eagerly-loaded combined holes: assay intervals + structural points merged by holeId
  const [combinedHoles, setCombinedHoles] = useState([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadDemoGswaAssayCsvText(),
      loadDemoStructuralCsvText(),
    ])
      .then(([assayCsv, structuralCsv]) => parseUnifiedDataset({ assayCsv, structuralCsv }))
      .then(({ holes }) => {
        if (!cancelled) setCombinedHoles(holes);
      })
      .catch((err) => {
        console.info('Auto-load of demo data skipped:', err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    // No sourceFile — all data is pre-loaded eagerly and passed as extraHoles
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
          />
        ))}
      </div>
      {(() => {
        const dataSourceTarget = typeof document !== 'undefined' ? document.getElementById('data-source-slot') : null;
        if (!dataSourceTarget) return null;
        const dataSourceInfo = (
          <div className="data-source-text">
            {holeCount > 0 && (
              <div>demo_gswa ({holeCount} holes, assay + structural)</div>
            )}
          </div>
        );
        return createPortal(dataSourceInfo, dataSourceTarget);
      })()}
    </div>
  );
}

export default Drillhole2D;
