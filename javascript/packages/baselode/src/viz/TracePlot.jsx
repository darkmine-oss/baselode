/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import { buildPlotConfig } from './drillholeViz.js';
import { formatPropertyLabel } from '../data/propertyLabels.js';
import {
  buildCommentsConfig,
  buildTadpoleConfig,
  buildPointLogConfig,
  buildDepthAnnotationsConfig,
  buildDipAzimuthConfig,
} from './structuralViz.js';
import {
  getChartOptions,
  isMultiPropertyChartType,
  DISPLAY_COMMENT,
  DISPLAY_CATEGORICAL,
  DISPLAY_NUMERIC,
  DISPLAY_TADPOLE,
} from '../data/columnMeta.js';
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

/**
 * Standalone renderer for a `group+hole` selector's group select.
 * Returns just the group dropdown — the matching hole select is
 * rendered separately by `renderHoleSelect` so the two can live on
 * their own rows in the controls layout.
 */
function renderGroupSelect({ selector }) {
  const groupValue = selector.groupValue ?? '';
  const groupLabel = selector.groupLabel || 'Group';
  const groupOptions = selector.groupOptions || [];
  return (
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
  );
}

function renderFieldSelect({ selector }) {
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

function renderHoleSelect({ selector, holeOptions, selectedHoleId, onConfigChange }) {
  const kind = selector?.kind || 'hole';
  // `group+hole` filters the hole list by the picked group;
  // `hole` (default) shows every hole.
  const visibleHoles = kind === 'group+hole'
    ? filterHolesByGroup(holeOptions, selector.groupBy, selector.groupValue ?? '')
    : holeOptions;
  const enabled = visibleHoles.length > 0;
  return (
    <select
      className="plot-select plot-select--hole"
      value={selectedHoleId}
      onChange={(e) => onConfigChange && onConfigChange({ holeId: e.target.value })}
      disabled={!enabled}
      aria-label="Hole"
    >
      {!enabled && <option value="">{kind === 'group+hole' ? 'No holes' : 'No holes loaded'}</option>}
      {!selectedHoleId && enabled && (
        <option value="" disabled hidden>Select a hole</option>
      )}
      {visibleHoles.map((h) => {
        const [v, l] = holeOptionAsTuple(h);
        return <option key={v} value={v}>{l}</option>;
      })}
    </select>
  );
}

function resolveGroupOptions(selector, holeOptions) {
  if (!selector || selector.kind !== 'group+hole') return selector;
  // Materialise group options once so `renderGroupSelect` doesn't
  // re-derive them on every render.
  if (selector.groupOptions) return selector;
  return { ...selector, groupOptions: groupValuesFromHoles(holeOptions, selector.groupBy) };
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
 * @param {Object} [props.propertyMeta] - Optional per-property metadata map
 *   (`{ [property]: { label?, unit?, sourceAttribute? } }`). When the selected
 *   property has an entry, its unit / source attribute are folded into the
 *   axis title, hover tooltip and property dropdown label — e.g. "Au (ppm)".
 *   The bare property key is still used for selection and `onConfigChange`.
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
  propertyMeta,
  onConfigChange,
  template,
  showHoleSelect = true,
  showPropertySelect = true,
  showChartTypeSelect = true,
  holeSelector,
}) {
  const bodyRef = useRef(null);
  const containerRef = useRef(null);
  const hole = graph?.hole;
  const points = graph?.points || [];
  const property = config?.property || '';
  const meta = propertyMeta?.[property];
  const chartType = config?.chartType || DEFAULT_NUMERIC_CHART_TYPE;
  const selectedHoleId = config?.holeId || '';

  // Derive display type from graph metadata (set by useDrillholeTraceGrid)
  const displayType = graph?.displayType
    || (graph?.isComment ? DISPLAY_COMMENT : (graph?.isCategorical ? DISPLAY_CATEGORICAL : DISPLAY_NUMERIC));

  const chartOptions = getChartOptions(displayType);
  const effectiveChartType = resolveChartType(displayType, chartType);

  // Colour-by + multi-assay state (supplied by useDrillholeTraceGrid).
  // Multi chart types (multi-line / multi-stacked / two-curve / composition)
  // swap the property picker for the multi-select and hide colour-by.
  const isMultiChart = isMultiPropertyChartType(effectiveChartType);
  const colorBy = graph?.colorBy || null;
  const multiSeries = graph?.multiSeries || null;
  const numericOptions = graph?.numericOptions || [];
  const colorByOptions = graph?.colorByOptions || [];
  const selectedColorBy = config?.colorBy || '';
  const selectedMultiProps = config?.multiProps || [];

  const [renderError, setRenderError] = useState('');
  const [plotSize, setPlotSize] = useState({ width: 0, height: 0 });

  // Multi-assay charts draw from `multiSeries`, not the primary `points`, so
  // gate the body on the first series when in a multi chart type.
  const bodyPoints = isMultiChart && multiSeries?.length ? multiSeries[0].points : points;
  const bodyState = resolveTracePlotBody({
    holeId: selectedHoleId,
    hole,
    holeOptions,
    property,
    propertyOptions,
    displayType,
    points: bodyPoints,
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
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === 'undefined') return undefined;

    let frame = 0;
    const updatePlotSize = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = Math.max(0, Math.floor(body.clientWidth));
        const height = Math.max(0, Math.floor(body.clientHeight));
        setPlotSize((prev) => (
          prev.width === width && prev.height === height ? prev : { width, height }
        ));
      });
    };

    updatePlotSize();
    const observer = new ResizeObserver(updatePlotSize);
    observer.observe(body);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (bodyState.kind !== 'chart') return;
    const target = containerRef.current;
    if (!target) return;
    if (plotSize.width <= 0 || plotSize.height <= 0) return;

    const isComment = displayType === DISPLAY_COMMENT;
    const isTadpole = displayType === DISPLAY_TADPOLE;

    let plotData;
    try {
      if (isComment) {
        // Comment tracks offer two chart types: labelled interval boxes
        // (default) or depth-pinned annotations at each interval mid.
        plotData = effectiveChartType === 'annotations'
          ? buildDepthAnnotationsConfig({
              rows: points.map((p) => ({ ...p, mid: (p.from + p.to) / 2 })),
              depthKey: 'mid',
              textKey: property,
              template,
            })
          : buildCommentsConfig(points, { commentCol: property, fromCol: 'from', toCol: 'to' });
      } else if (isTadpole) {
        // Structural tracks: tadpole (default) or split dip / azimuth log.
        // Both read the raw structural rows (depth / dip / azimuth keys).
        plotData = effectiveChartType === 'dip-azimuth'
          ? buildDipAzimuthConfig({ rows: points, template })
          : buildTadpoleConfig(points, { template });
      } else if (displayType === DISPLAY_CATEGORICAL && effectiveChartType === 'point-log') {
        // Categorical interval points carry the category in `val` and the
        // interval mid-depth in `z`.
        plotData = buildPointLogConfig({ rows: points, depthKey: 'z', categoryKey: 'val', template });
      } else {
        plotData = buildPlotConfig({
          points,
          isCategorical: displayType === DISPLAY_CATEGORICAL,
          property,
          chartType: effectiveChartType,
          template,
          meta,
          colorBy,
          series: multiSeries,
          metaByProperty: propertyMeta,
          logScale: config?.logScale === true,
          patternMap: config?.usePatterns === true ? 'lithology' : config?.patternMap ?? null,
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
      responsive: false,
      modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d']
    };
    const layout = {
      ...plotData.layout,
      autosize: false,
      width: plotSize.width,
      height: plotSize.height,
    };

    try {
      setRenderError('');
      Plotly.react(target, plotData.data, layout, plotConfig);
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
  }, [
    bodyState.kind,
    hole,
    property,
    meta,
    effectiveChartType,
    displayType,
    points,
    colorBy,
    multiSeries,
    propertyMeta,
    template,
    config?.logScale,
    config?.usePatterns,
    config?.patternMap,
    plotSize.width,
    plotSize.height,
  ]);

  useEffect(() => {
    const target = containerRef.current;
    if (!target || typeof ResizeObserver === 'undefined') return undefined;
    const resizeObserver = new ResizeObserver(() => {
      try {
        if (target && target.data) {
          const width = Math.max(0, Math.floor(target.clientWidth));
          const height = Math.max(0, Math.floor(target.clientHeight));
          if (width > 0 && height > 0) {
            Plotly.relayout(target, { width, height, autosize: false });
          }
        }
      } catch (err) {
        console.warn('Plot resize error', err);
      }
    });
    resizeObserver.observe(target);
    return () => resizeObserver.disconnect();
  }, [bodyState.kind]);

  // Resolve a `group+hole` selector once per render so the group
  // options + filtered hole list are computed identically by both
  // the group row and the hole row below.
  const resolvedSelector = resolveGroupOptions(holeSelector, holeOptions);
  const holeKind = resolvedSelector?.kind || 'hole';

  return (
    <div className={`plot-card${isPlaceholder ? ' empty' : ''}`}>
      <header className="plot-card__controls">
        {/* Row 1: optional group / project selector when the caller
            opts into `group+hole`.  Skipped otherwise. */}
        {visibility.hole && holeKind === 'group+hole' && (
          <div className="plot-card__row plot-card__row--group">
            {renderGroupSelect({ selector: resolvedSelector })}
          </div>
        )}
        {/* Row 1 (alt): a fully-custom `field` selector replaces the
            hole picker entirely.  Caller-controlled, no hole list. */}
        {visibility.hole && holeKind === 'field' && (
          <div className="plot-card__row plot-card__row--field">
            {renderFieldSelect({ selector: resolvedSelector })}
          </div>
        )}
        {/* Row 2: hole picker — always takes a full row of its own
            so a long composite hole_id never has to negotiate with
            the property / chart-type pickers. */}
        {visibility.hole && holeKind !== 'field' && (
          <div className="plot-card__row plot-card__row--hole">
            {renderHoleSelect({
              selector: resolvedSelector,
              holeOptions,
              selectedHoleId,
              onConfigChange,
            })}
          </div>
        )}
        {/* Row 3: property + chart-type, split 50/50.  When only
            one is visible it fills the whole row.  For multi-assay
            chart types the property slot becomes a scrollable
            multi-select bound to the assays plotted in the track, so
            the primary picker always matches the graph. */}
        {(visibility.property || visibility.chartType) && (
          <div className={`plot-card__row plot-card__row--split${isMultiChart ? ' plot-card__row--split-multi' : ''}`}>
            {visibility.property && isMultiChart && (
              <select
                multiple
                className="plot-select plot-select--property plot-select--multi"
                value={selectedMultiProps}
                onChange={(e) => {
                  const vals = Array.from(e.target.selectedOptions, (o) => o.value);
                  onConfigChange && onConfigChange({ multiProps: vals });
                }}
                aria-label="Assays"
                size={Math.min(Math.max(numericOptions.length, 2), 6)}
              >
                {numericOptions.map((p) => (
                  <option key={p} value={p}>{formatPropertyLabel(p, propertyMeta?.[p])}</option>
                ))}
              </select>
            )}
            {visibility.property && !isMultiChart && (
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
                  <option key={p} value={p}>{formatPropertyLabel(p, propertyMeta?.[p])}</option>
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
        {/* Row 4a: colour a single numeric track by value (default) or by a
            categorical column (lithology, alteration, …). Only for numeric,
            non-multi chart types when categorical columns are available.
            filled-line / step-line / heat-strip don't compose with colour-by
            (their geometry or colour already encodes the value). */}
        {visibility.property && !isMultiChart && displayType === DISPLAY_NUMERIC && colorByOptions.length > 0
          && !['filled-line', 'step-line', 'heat-strip'].includes(effectiveChartType) && (
          <div className="plot-card__row plot-card__row--colorby">
            <select
              className="plot-select plot-select--colorby"
              value={selectedColorBy}
              onChange={(e) => onConfigChange && onConfigChange({ colorBy: e.target.value })}
              aria-label="Colour by"
            >
              <option value="">Colour: by value</option>
              {colorByOptions.map((c) => (
                <option key={c} value={c}>{`Colour: ${formatPropertyLabel(c, propertyMeta?.[c])}`}</option>
              ))}
            </select>
          </div>
        )}
      </header>
      <div className="plot-card__body" ref={bodyRef}>
        {bodyState.kind === 'chart'
          ? <div className="plotly-chart" ref={containerRef} />
          : <div className="placeholder">{bodyState.text}</div>
        }
      </div>
    </div>
  );
}

export default TracePlot;
