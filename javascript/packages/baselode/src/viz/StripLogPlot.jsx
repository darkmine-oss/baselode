/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useMemo } from 'react';
import Plotly from 'plotly.js-dist-min';
import { getChartOptions, DISPLAY_NUMERIC } from '../data/columnMeta.js';
import { buildStripLogPlotConfig, getDefaultPlotlyConfig } from './drillholeViz.js';
import useStripLogConfig from './useStripLogConfig.js';

/**
 * Self-contained strip log plot component.
 * Accepts raw interval rows and renders a Plotly strip log with opinionated defaults.
 * No direct Plotly usage required in the consuming app.
 *
 * **Self-contained (default):** omit `property`/`chartType` — the component manages
 * its own selection state and shows built-in controls:
 * ```jsx
 * <StripLogPlot rows={myRows} />
 * ```
 *
 * **Headless / externally controlled:** pass `mode="plot"` and provide `property` +
 * `chartType` from a `useStripLogConfig` hook paired with a `StripLogControls` component:
 * ```jsx
 * const cfg = useStripLogConfig({ rows });
 * <StripLogControls {...cfg}
 *   onPropertyChange={cfg.setProperty}
 *   onChartTypeChange={cfg.setChartType} />
 * <StripLogPlot rows={rows} property={cfg.property}
 *   chartType={cfg.chartType} mode="plot" />
 * ```
 *
 * @param {Object} props
 * @param {Array<Object>} props.rows - Flat array of interval rows (raw or pre-standardized)
 * @param {string} [props.holeId] - Filter rows to this hole ID
 * @param {string} [props.dataType] - 'assay' | 'geology' | string. 'geology' forces categorical rendering.
 * @param {string} [props.property] - In mode='plot': controlled property. In mode='plot+controls': initial seed.
 * @param {string[]} [props.properties] - Available properties list (inferred from rows if omitted)
 * @param {string|null} [props.defaultProperty] - Initial selected property for uncontrolled use
 * @param {string} [props.chartType] - In mode='plot': controlled chart type. In mode='plot+controls': initial seed.
 * @param {Object} [props.template] - Plotly template override. Defaults to the Baselode template.
 * @param {Object|string|null} [props.colourMap] - Colour map for categorical rendering
 * @param {'plot'|'plot+controls'} [props.mode] - Render mode.
 *   'plot+controls' (default): self-contained with built-in property + chart type selectors.
 *   'plot': headless — only the chart, no controls. Use with StripLogControls + useStripLogConfig.
 * @returns {JSX.Element}
 */
function StripLogPlot({
  rows = [],
  holeId,
  dataType,
  property: propertyProp,
  properties: propertiesProp,
  defaultProperty,
  chartType: chartTypeProp,
  template,
  colourMap,
  mode = 'plot+controls',
}) {
  const containerRef = useRef(null);

  // Internal config state — handles row normalization, column classification,
  // and property/chart-type selection when in self-contained mode.
  const {
    property: internalProperty,
    setProperty,
    chartType: internalChartType,
    setChartType,
    properties,
    standardizedRows,
    columnMeta,
  } = useStripLogConfig({
    rows,
    holeId,
    dataType,
    defaultProperty,
    properties: propertiesProp,
  });

  // In headless mode (mode='plot'), controlled props take precedence.
  // In self-contained mode (mode='plot+controls'), internal state drives everything.
  const isHeadless = mode === 'plot';
  const property = isHeadless && propertyProp !== undefined ? propertyProp : internalProperty;
  const chartType = isHeadless && chartTypeProp !== undefined ? chartTypeProp : internalChartType;

  // Resolve display type from the effective property
  const displayType = useMemo(() => {
    if (dataType === 'geology') return 'categorical';
    return columnMeta[property] || DISPLAY_NUMERIC;
  }, [columnMeta, property, dataType]);

  const chartOptions = getChartOptions(displayType);
  const effectiveChartType = chartOptions.some((o) => o.value === chartType)
    ? chartType
    : (chartOptions[0]?.value || 'markers+line');

  // Render / re-render the Plotly chart
  useEffect(() => {
    const target = containerRef.current;
    if (!target || !property || !standardizedRows.length) return;

    let plotData;
    try {
      plotData = buildStripLogPlotConfig({
        rows: standardizedRows,
        property,
        dataType,
        chartType: effectiveChartType,
        colourMap,
        template,
      });
    } catch (err) {
      console.error('StripLogPlot build error', err);
      return;
    }

    if (!plotData?.data?.length) return;

    try {
      Plotly.react(target, plotData.data, plotData.layout, getDefaultPlotlyConfig());
      requestAnimationFrame(() => {
        if (target?.parentElement) Plotly.Plots.resize(target);
      });
    } catch (err) {
      console.error('StripLogPlot render error', err);
    }

    return () => {
      if (target) {
        try { Plotly.purge(target); } catch (_) {}
      }
    };
  }, [standardizedRows, property, effectiveChartType, dataType, colourMap, template]);

  // Respond to container size changes
  useEffect(() => {
    const target = containerRef.current;
    if (!target || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      try {
        if (target?.data) Plotly.Plots.resize(target);
      } catch (_) {}
    });
    ro.observe(target);
    return () => ro.disconnect();
  }, []);

  if (!standardizedRows.length) {
    return <div className="plot-card empty"><div className="placeholder">No data</div></div>;
  }
  if (!property) {
    return <div className="plot-card empty"><div className="placeholder">No plottable properties</div></div>;
  }

  const showControls = !isHeadless;

  return (
    <div className="plot-card">
      {showControls && (properties.length > 1 || chartOptions.length > 1) && (
        <div className="plot-controls column">
          {properties.length > 1 && (
            <select
              className="plot-select"
              value={internalProperty}
              onChange={(e) => setProperty(e.target.value)}
            >
              {properties.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
          {chartOptions.length > 1 && (
            <select
              className="plot-select"
              value={effectiveChartType}
              onChange={(e) => setChartType(e.target.value)}
            >
              {chartOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}
        </div>
      )}
      <div className="plotly-chart" ref={containerRef} />
    </div>
  );
}

export default StripLogPlot;
