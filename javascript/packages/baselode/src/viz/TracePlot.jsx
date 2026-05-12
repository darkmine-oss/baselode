/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import { buildPlotConfig } from './drillholeViz.js';
import { buildCommentsConfig, buildTadpoleConfig } from './structuralViz.js';
import { buildCorePhotoConfig } from './corePhotoViz.js';
import { getChartOptions, DISPLAY_COMMENT, DISPLAY_CATEGORICAL, DISPLAY_NUMERIC, DISPLAY_PHOTO, DISPLAY_TADPOLE } from '../data/columnMeta.js';
import {
  resolveTracePlotBody,
  resolveTracePlotSelectVisibility,
  deriveGroupValue,
  groupValuesFromHoles,
  filterHolesByGroup,
} from './tracePlotState.js';
import './TracePlot.css';

export {
  resolveTracePlotBody,
  resolveTracePlotSelectVisibility,
  deriveGroupValue,
  groupValuesFromHoles,
  filterHolesByGroup,
};

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

function holeOptionAsTuple(h) {
  const value = typeof h === 'string' ? h : h.holeId;
  const label = typeof h === 'string' ? h : (h.label || h.holeId);
  return [value, label];
}

function genericOptionAsTuple(o) {
  const value = typeof o === 'string' ? o : o.value;
  const label = typeof o === 'string' ? o : (o.label ?? o.value);
  return [value, label];
}

function renderHoleSelector({ selector, holeOptions, selectedHoleId, onConfigChange }) {
  const kind = selector?.kind || 'hole';

  if (kind === 'field') {
    const value = selector.value ?? '';
    const opts = selector.options || [];
    const label = selector.label || 'Selection';
    return (
      <select
        className="plot-select plot-select--field"
        value={value}
        onChange={(e) => selector.onChange && selector.onChange(e.target.value)}
        disabled={opts.length === 0}
        aria-label={label}
      >
        {opts.length === 0 && <option value="">—</option>}
        {!value && opts.length > 0 && (
          <option value="" disabled hidden>{`Select ${label.toLowerCase()}`}</option>
        )}
        {opts.map((o) => {
          const [v, l] = genericOptionAsTuple(o);
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
    );
  }

  if (kind === 'group+hole') {
    const groupBy = selector.groupBy;
    const groupValue = selector.groupValue ?? '';
    const groupLabel = selector.groupLabel || 'Group';
    const groupOptions = selector.groupOptions
      || groupValuesFromHoles(holeOptions, groupBy);
    const visibleHoles = filterHolesByGroup(holeOptions, groupBy, groupValue);
    return (
      <>
        <select
          className="plot-select plot-select--group"
          value={groupValue}
          onChange={(e) => selector.onGroupChange && selector.onGroupChange(e.target.value)}
          disabled={groupOptions.length === 0}
          aria-label={groupLabel}
        >
          {groupOptions.length === 0 && <option value="">No {groupLabel.toLowerCase()}s</option>}
          {!groupValue && groupOptions.length > 0 && (
            <option value="" disabled hidden>{`Select ${groupLabel.toLowerCase()}`}</option>
          )}
          {groupOptions.map((g) => {
            const [v, l] = genericOptionAsTuple(g);
            return <option key={v} value={v}>{l}</option>;
          })}
        </select>
        <select
          className="plot-select plot-select--hole"
          value={selectedHoleId}
          onChange={(e) => onConfigChange && onConfigChange({ holeId: e.target.value })}
          disabled={visibleHoles.length === 0}
          aria-label="Hole"
        >
          {visibleHoles.length === 0 && <option value="">No holes</option>}
          {!selectedHoleId && visibleHoles.length > 0 && (
            <option value="" disabled hidden>Select a hole</option>
          )}
          {visibleHoles.map((h) => {
            const [v, l] = holeOptionAsTuple(h);
            return <option key={v} value={v}>{l}</option>;
          })}
        </select>
      </>
    );
  }

  // kind === 'hole' (default)
  const enabled = holeOptions.length > 0;
  return (
    <select
      className="plot-select plot-select--hole"
      value={selectedHoleId}
      onChange={(e) => onConfigChange && onConfigChange({ holeId: e.target.value })}
      disabled={!enabled}
      aria-label="Hole"
    >
      {!enabled && <option value="">No holes loaded</option>}
      {!selectedHoleId && enabled && (
        <option value="" disabled hidden>Select a hole</option>
      )}
      {holeOptions.map((h) => {
        const [v, l] = holeOptionAsTuple(h);
        return <option key={v} value={v}>{l}</option>;
      })}
    </select>
  );
}

/**
 * Plotly-based trace plot component for drillhole data.
 *
 * Hole / property / chart-type selects render in every state — including
 * the empty, loading, no-data and error states — so the user can always
 * change selection.  The body switches between the Plotly chart and a
 * placeholder message; the controls do not move.
 *
 * @param {Object} props
 * @param {Object} props.config - Plot configuration {holeId, property, chartType}
 * @param {Object} props.graph - Graph data {hole, points, displayType, isCategorical, isComment, loading}
 * @param {Array} props.holeOptions - Available holes for dropdown
 * @param {Array} props.propertyOptions - Available properties for dropdown
 * @param {Function} props.onConfigChange - Handler for configuration changes
 * @param {Object} [props.template] - Plotly template to apply. Defaults to the Baselode template.
 * @param {boolean} [props.showHoleSelect=true] - Render the hole selector area.
 * @param {boolean} [props.showPropertySelect=true] - Render the property select.
 * @param {boolean} [props.showChartTypeSelect=true] - Render the chart-type select (when >1 option).
 * @param {Object} [props.holeSelector] - Shape of the hole selector area.
 *   Defaults to `{ kind: 'hole' }` (single hole dropdown).
 *   - `{ kind: 'hole' }` — one dropdown over `holeOptions`, value = `config.holeId`.
 *   - `{ kind: 'group+hole', groupBy, groupValue, onGroupChange, groupLabel?, groupOptions? }` —
 *     a group dropdown plus a hole dropdown filtered to that group. `groupBy` is
 *     either a string key on each hole option or a `(holeOption) => value` function.
 *   - `{ kind: 'field', value, options, onChange, label? }` — a single dropdown
 *     bound to an arbitrary field, fully controlled by the caller.
 * @returns {JSX.Element}
 */
function TracePlot({
  config,
  graph,
  holeOptions = [],
  propertyOptions = [],
  onConfigChange,
  template,
  showHoleSelect = true,
  showPropertySelect = true,
  showChartTypeSelect = true,
  holeSelector,
}) {
  const containerRef = useRef(null);
  const hole = graph?.hole;
  const points = graph?.points || [];
  const property = config?.property || '';
  const chartType = config?.chartType || DEFAULT_NUMERIC_CHART_TYPE;
  const selectedHoleId = config?.holeId || '';

  // Derive display type from graph metadata (set by useDrillholeTraceGrid)
  const displayType = graph?.displayType
    || (graph?.isPhoto ? DISPLAY_PHOTO : (graph?.isComment ? DISPLAY_COMMENT : (graph?.isCategorical ? DISPLAY_CATEGORICAL : DISPLAY_NUMERIC)));

  const chartOptions = getChartOptions(displayType);
  const effectiveChartType = resolveChartType(displayType, chartType);

  const [renderError, setRenderError] = useState('');

  const bodyState = resolveTracePlotBody({
    holeId: selectedHoleId,
    hole,
    holeOptions,
    property,
    propertyOptions,
    displayType,
    points,
    renderError,
  });
  const isPlaceholder = bodyState.kind !== 'chart';

  const visibility = resolveTracePlotSelectVisibility({
    chartOptions,
    showHoleSelect,
    showPropertySelect,
    showChartTypeSelect,
  });
  const propertySelectEnabled = propertyOptions.length > 0;

  useEffect(() => {
    if (bodyState.kind !== 'chart') return;
    const target = containerRef.current;
    if (!target) return;

    const isComment = displayType === DISPLAY_COMMENT;
    const isTadpole = displayType === DISPLAY_TADPOLE;
    const isPhoto = displayType === DISPLAY_PHOTO;

    let plotData;
    try {
      if (isPhoto) {
        plotData = buildCorePhotoConfig(points, { fromCol: 'from', toCol: 'to', urlCol: property, modeCol: 'image_mode' });
      } else if (isComment) {
        plotData = buildCommentsConfig(points, { commentCol: property, fromCol: 'from', toCol: 'to' });
      } else if (isTadpole) {
        plotData = buildTadpoleConfig(points);
      } else {
        plotData = buildPlotConfig({
          points,
          isCategorical: displayType === DISPLAY_CATEGORICAL,
          property,
          chartType: effectiveChartType,
          template,
        });
      }
    } catch (err) {
      console.error('Plot build error', err);
      setRenderError(err?.message || 'Plot build error');
      return;
    }

    if (!plotData?.data || plotData.data.length === 0) {
      if (!isComment && !isPhoto) return;
    }

    const plotConfig = {
      displayModeBar: true,
      responsive: true,
      useResizeHandler: true,
      modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d']
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
  }, [bodyState.kind, hole, property, effectiveChartType, displayType, points, template]);

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
  }, [bodyState.kind]);

  return (
    <div className={`plot-card${isPlaceholder ? ' empty' : ''}`}>
      <header className="plot-card__controls">
        {visibility.hole && (
          <div className="plot-title">
            {renderHoleSelector({
              selector: holeSelector,
              holeOptions,
              selectedHoleId,
              onConfigChange,
            })}
          </div>
        )}
        {(visibility.property || visibility.chartType) && (
          <div className="plot-controls column">
            {visibility.property && (
              <select
                className="plot-select plot-select--property"
                value={property}
                onChange={(e) => onConfigChange && onConfigChange({ property: e.target.value })}
                disabled={!propertySelectEnabled}
                aria-label="Property"
              >
                {!propertySelectEnabled && (
                  <option value="">—</option>
                )}
                {!property && propertySelectEnabled && (
                  <option value="" disabled hidden>Select a property</option>
                )}
                {propertyOptions.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            )}
            {visibility.chartType && (
              <select
                className="plot-select plot-select--chart-type"
                value={effectiveChartType}
                onChange={(e) => onConfigChange && onConfigChange({ chartType: e.target.value })}
                aria-label="Chart type"
              >
                {chartOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}
          </div>
        )}
      </header>
      <div className="plot-card__body">
        {bodyState.kind === 'chart'
          ? <div className="plotly-chart" ref={containerRef} />
          : <div className="placeholder">{bodyState.text}</div>
        }
      </div>
    </div>
  );
}

export default TracePlot;
