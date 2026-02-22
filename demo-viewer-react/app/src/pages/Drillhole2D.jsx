/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  TracePlot,
  useDrillholeTraceGrid
} from 'baselode';
import './Drillhole2D.css';
import { loadDemoGswaGeologyFile } from '../data/demoGswaData.js';
import { createPortal } from 'react-dom';

function Drillhole2D() {
  const location = useLocation();
  const [demoGswaGeologyFile, setDemoGswaGeologyFile] = useState(null);

  useEffect(() => {
    let isCancelled = false;
    loadDemoGswaGeologyFile()
      .then((file) => {
        if (!isCancelled) setDemoGswaGeologyFile(file);
      })
      .catch((err) => {
        console.info('Auto-load of GSWA geology skipped:', err.message);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  const {
    error,
    setError,
    holeCount,
    setFocusedHoleId,
    propertyOptions,
    labeledHoleOptions,
    traceGraphs,
    handleConfigChange
  } = useDrillholeTraceGrid({
    initialFocusedHoleId: location.state?.holeId || '',
    sourceFile: demoGswaGeologyFile,
    plotCount: 4
  });

  useEffect(() => {
    const holeIdFromNav = location.state?.holeId;
    if (holeIdFromNav) {
      setFocusedHoleId(holeIdFromNav);
      if (!holeCount) {
        setError((prev) => prev || `Loading geology for hole ${holeIdFromNav}.`);
      }
    }
  }, [location.state, holeCount, setError, setFocusedHoleId]);

  return (
    <div className="drillhole2d-container">
      <div className="drillhole2d-header">
        <h1>Drillhole 2D Strip Logs</h1>
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
            propertyOptions={propertyOptions}
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
              <div>demo_gswa ({holeCount} geology holes)</div>
            )}
          </div>
        );
        return createPortal(dataSourceInfo, dataSourceTarget);
      })()}
    </div>
  );
}

export default Drillhole2D;
