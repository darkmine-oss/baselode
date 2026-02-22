/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import { buildPlotConfig } from './drillholeViz.js';
import { buildCommentsConfig, buildTadpoleConfig } from './structuralViz.js';
import { getChartOptions, DISPLAY_COMMENT, DISPLAY_CATEGORICAL, DISPLAY_NUMERIC, DISPLAY_TADPOLE } from '../data/columnMeta.js';

const DEFAULT_NUMERIC_CHART_TYPE = 'markers+line';

/**
 * Resolve chart type from available options.
 * @private
 */
function resolveChartType(displayType, requestedChartType) {
  const chartOptions = getChartOptions(displayType);
  if (chartOptions.some((opt) => opt.value === requestedChartType)) return requestedChartType;
  return chartOptions[0]?.value || DEFAULT_NUMERIC_CHART_TYPE;
}

/**
 * Plotly-based trace plot component for drillhole data.
 * Renders 1D strip logs with chart type options driven by column display type.
 *
 * @param {Object} props
 * @param {Object} props.config - Plot configuration {holeId, property, chartType}
 * @param {Object} props.graph - Graph data {hole, points, displayType, isCategorical, isComment, loading}
 * @param {Array} props.holeOptions - Available holes for dropdown
 * @param {Array} props.propertyOptions - Available properties for dropdown
 * @param {Function} props.onConfigChange - Handler for configuration changes
 * @returns {JSX.Element}
 */
function TracePlot({ config, graph, holeOptions = [], propertyOptions = [], onConfigChange }) {
  const containerRef = useRef(null);
  const hole = graph?.hole;
  const points = graph?.points || [];
  const property = config?.property || '';
  const chartType = config?.chartType || DEFAULT_NUMERIC_CHART_TYPE;
  const selectedHoleId = config?.holeId || '';

  // Derive display type from graph metadata (set by useDrillholeTraceGrid)
  const displayType = graph?.displayType
    || (graph?.isComment ? DISPLAY_COMMENT : (graph?.isCategorical ? DISPLAY_CATEGORICAL : DISPLAY_NUMERIC));

  const chartOptions = getChartOptions(displayType);
  const effectiveChartType = resolveChartType(displayType, chartType);

  const [renderError, setRenderError] = useState('');

  useEffect(() => {
    const isComment = displayType === DISPLAY_COMMENT;
    const isTadpole = displayType === DISPLAY_TADPOLE;
    if (!hole || !property) return;
    // For comment type, allow empty points (empty intervals still draw border boxes)
    // For tadpole, points are raw hole points — allow empty array through so buildTadpoleConfig can return empty gracefully
    if (!isComment && !isTadpole && points.length === 0) return;
    const target = containerRef.current;
    if (!target) return;

    let plotData;
    try {
      if (isComment) {
        plotData = buildCommentsConfig(points, { commentCol: property, fromCol: 'from', toCol: 'to' });
      } else if (isTadpole) {
        plotData = buildTadpoleConfig(points);
      } else {
        plotData = buildPlotConfig({
          points,
          isCategorical: displayType === DISPLAY_CATEGORICAL,
          property,
          chartType: effectiveChartType
        });
      }
    } catch (err) {
      console.error('Plot build error', err);
      setRenderError(err?.message || 'Plot build error');
      return;
    }

    if (!plotData?.data || plotData.data.length === 0) {
      if (!isComment) return;
    }

    const plotConfig = {
      displayModeBar: true,
      responsive: true,
      useResizeHandler: true,
      modeBarButtonsToRemove: ['select2d', 'lasso2d', 'zoom2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d']
    };

    try {
      setRenderError('');
      Plotly.react(target, plotData.data, plotData.layout, plotConfig);
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
  }, [hole, property, effectiveChartType, displayType, points]);

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

  if (displayType !== DISPLAY_COMMENT && displayType !== DISPLAY_TADPOLE && points.length === 0) {
    return (
      <div className="plot-card empty">
        <div className="placeholder">No data</div>
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
        {chartOptions.length > 1 && (
          <select
            className="plot-select"
            value={effectiveChartType}
            onChange={(e) => onConfigChange && onConfigChange({ chartType: e.target.value })}
          >
            {chartOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}
      </div>
      <div className="plotly-chart" ref={containerRef} />
    </div>
  );
}

export default TracePlot;
