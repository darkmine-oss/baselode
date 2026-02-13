/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  TracePlot,
  useDrillholeTraceGrid
} from 'baselode';
import './Drillhole2D.css';
import { useDrillConfig } from '../context/DrillConfigContext.jsx';
import { loadDemoGswaAssayFile } from '../data/demoGswaData.js';

function Drillhole2D() {
  const location = useLocation();
  const { config: drillConfig } = useDrillConfig();
  const [demoGswaAssayFile, setDemoGswaAssayFile] = useState(null);

  useEffect(() => {
    let isCancelled = false;
    loadDemoGswaAssayFile()
      .then((file) => {
        if (!isCancelled) setDemoGswaAssayFile(file);
      })
      .catch((err) => {
        console.info('Auto-load of GSWA assays skipped:', err.message);
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
    drillConfig,
    initialFocusedHoleId: location.state?.holeId || '',
    sourceFile: demoGswaAssayFile,
    plotCount: 4
  });

  useEffect(() => {
    const holeIdFromNav = location.state?.holeId;
    if (holeIdFromNav) {
      setFocusedHoleId(holeIdFromNav);
      if (!holeCount) {
        setError((prev) => prev || `Loading assays for hole ${holeIdFromNav}.`);
      }
    }
  }, [location.state, holeCount, setError, setFocusedHoleId]);

  return (
    <div className="drillhole2d-container">
      <div className="drillhole2d-header">
        <h1>Drillhole 2D Traces</h1>
        <div className="drillhole2d-controls">
          <span className="drillhole-info">Data source: demo_gswa_sample_assays.csv (cached)</span>
          {holeCount > 0 && (
            <span className="drillhole-info">{holeCount} collars with assays</span>
          )}

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
    </div>
  );
}

export default Drillhole2D;
