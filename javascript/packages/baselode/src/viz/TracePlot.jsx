/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import { buildPlotConfig } from './drillholeViz.js';

const DEFAULT_NUMERIC_CHART_TYPE = 'markers+line';
const CATEGORICAL_CHART_OPTIONS = [{ value: 'categorical', label: 'Categorical bands' }];
const NUMERIC_CHART_OPTIONS = [
  { value: 'bar', label: 'Bars' },
  { value: 'markers', label: 'Markers' },
  { value: DEFAULT_NUMERIC_CHART_TYPE, label: 'Markers + Line' },
  { value: 'line', label: 'Line only' }
];

function resolveChartType(chartOptions, requestedChartType) {
  if (chartOptions.some((opt) => opt.value === requestedChartType)) return requestedChartType;
  return chartOptions[0]?.value || DEFAULT_NUMERIC_CHART_TYPE;
}

function TracePlot({ config, graph, holeOptions = [], propertyOptions = [], onConfigChange }) {
  const containerRef = useRef(null);
  const hole = graph?.hole;
  const points = graph?.points || [];
  const property = config?.property || '';
  const chartType = config?.chartType || DEFAULT_NUMERIC_CHART_TYPE;
  const selectedHoleId = config?.holeId || '';
  const isCategorical = graph?.isCategorical || false;

  const chartOptions = isCategorical ? CATEGORICAL_CHART_OPTIONS : NUMERIC_CHART_OPTIONS;

  const effectiveChartType = resolveChartType(chartOptions, chartType);

  const [renderError, setRenderError] = useState('');

  useEffect(() => {
    if (!hole || !property || points.length === 0) return;
    const target = containerRef.current;
    if (!target) return;
    const { data, layout } = buildPlotConfig({ points, isCategorical, property, chartType: effectiveChartType });
    if (!data || data.length === 0) return;
    const plotConfig = {
      displayModeBar: true,
      responsive: true,
      useResizeHandler: true,
      modeBarButtonsToRemove: ['select2d', 'lasso2d', 'zoom2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d']
    };

    try {
      setRenderError('');
      Plotly.react(target, data, layout, plotConfig);
      requestAnimationFrame(() => {
        if (target && target.parentElement) {
          Plotly.Plots.resize(target);
        }
      });
    } catch (err) {
      console.error('Plot render error', err);
      setRenderError(err?.message || 'Plot render error');
    }

    return () => {
      if (target) {
        try {
          Plotly.purge(target);
        } catch (err) {
          console.warn('Plot purge error', err);
        }
      }
    };
  }, [hole, property, effectiveChartType, isCategorical, points]);

  useEffect(() => {
    const target = containerRef.current;
    if (!target || typeof ResizeObserver === 'undefined') return undefined;
    const resizeObserver = new ResizeObserver(() => {
      try {
        if (target && target.data) {
          Plotly.Plots.resize(target);
        }
      } catch (err) {
        console.warn('Plot resize error', err);
      }
    });
    resizeObserver.observe(target);
    return () => resizeObserver.disconnect();
  }, []);

  if (!hole || !property) {
    return (
      <div className="plot-card empty">
        <div className="placeholder">{config?.holeId ? (graph?.loading ? `Loading ${config.holeId}...` : 'Select a property') : 'Loading demo data...'}</div>
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="plot-card empty">
        <div className="placeholder">No numeric data for {property}</div>
      </div>
    );
  }

  if (renderError) {
    return (
      <div className="plot-card empty">
        <div className="placeholder">Plot error: {renderError}</div>
      </div>
    );
  }

  return (
    <div className="plot-card">
      <div className="plot-title">
        <select
          className="plot-select"
          value={selectedHoleId}
          onChange={(e) => onConfigChange && onConfigChange({ holeId: e.target.value })}
        >
          {holeOptions.map((h) => {
            const holeId = typeof h === 'string' ? h : h.holeId;
            const label = typeof h === 'string' ? h : h.label || h.holeId;
            return (
              <option key={holeId} value={holeId}>{label}</option>
            );
          })}
        </select>
      </div>
      <div className="plot-controls column">
        {propertyOptions.length > 0 && (
          <select
            className="plot-select"
            value={property}
            onChange={(e) => onConfigChange && onConfigChange({ property: e.target.value })}
          >
            {propertyOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}
        <select
          className="plot-select"
          value={effectiveChartType}
          onChange={(e) => onConfigChange && onConfigChange({ chartType: e.target.value })}
        >
          {chartOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div className="plotly-chart" ref={containerRef} />
    </div>
  );
}

export default TracePlot;
