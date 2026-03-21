/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { getChartOptions, DISPLAY_NUMERIC } from '../data/columnMeta.js';

/**
 * Standalone, fully-controlled controls panel for a strip log plot.
 * Renders a property selector and a chart-type selector whose options automatically
 * adapt to the display type of the selected property.
 *
 * Designed to be placed in a separate div from the plot. Connect it to a
 * StripLogPlot via shared parent state (or useStripLogConfig):
 *
 * @example
 * // Using useStripLogConfig to drive both controls and plot:
 * const cfg = useStripLogConfig({ rows });
 * <StripLogControls
 *   property={cfg.property}
 *   chartType={cfg.chartType}
 *   properties={cfg.properties}
 *   displayType={cfg.displayType}
 *   onPropertyChange={cfg.setProperty}
 *   onChartTypeChange={cfg.setChartType}
 * />
 * <StripLogPlot rows={rows} property={cfg.property} chartType={cfg.chartType} mode="plot" />
 *
 * @example
 * // Using your own state:
 * const [prop, setProp] = useState('Au_ppm');
 * const [ct, setCt]     = useState('markers+line');
 * <StripLogControls
 *   property={prop}   chartType={ct}
 *   properties={['Au_ppm', 'Cu_ppm']}
 *   columnMeta={columnMeta}
 *   onPropertyChange={setProp}
 *   onChartTypeChange={setCt}
 * />
 * <StripLogPlot rows={rows} property={prop} chartType={ct} mode="plot" />
 *
 * @param {Object} props
 * @param {string} props.property - Currently selected property (controlled)
 * @param {string} props.chartType - Currently selected chart type (controlled)
 * @param {string[]} props.properties - Available properties to show in the dropdown
 * @param {Function} props.onPropertyChange - Called with new property string when user changes selection
 * @param {Function} props.onChartTypeChange - Called with new chart type string when user changes selection
 * @param {string} [props.displayType] - Display type of the current property ('numeric'|'categorical'|'comment'|'tadpole').
 *   Drives the chart-type options. Inferred from columnMeta[property] if omitted.
 * @param {Object<string, string>} [props.columnMeta] - byType map from classifyColumns / useStripLogConfig.
 *   Used to infer displayType when displayType prop is not provided.
 * @param {string} [props.className] - Extra CSS class for the wrapper element
 * @returns {JSX.Element|null}
 */
function StripLogControls({
  property = '',
  chartType = 'markers+line',
  properties = [],
  onPropertyChange,
  onChartTypeChange,
  displayType: displayTypeProp,
  columnMeta,
  className,
}) {
  // Resolve display type: explicit prop > infer from columnMeta > default to numeric
  const displayType = displayTypeProp
    || (columnMeta && property ? columnMeta[property] : null)
    || DISPLAY_NUMERIC;

  const chartOptions = getChartOptions(displayType);

  // Resolve chart type to a valid option for this display type
  const effectiveChartType = chartOptions.some((o) => o.value === chartType)
    ? chartType
    : (chartOptions[0]?.value || 'markers+line');

  if (!properties.length && chartOptions.length <= 1) return null;

  return (
    <div className={`strip-log-controls${className ? ` ${className}` : ''}`}>
      {properties.length > 0 && (
        <select
          className="plot-select"
          value={property}
          onChange={(e) => onPropertyChange?.(e.target.value)}
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
          onChange={(e) => onChartTypeChange?.(e.target.value)}
        >
          {chartOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}

export default StripLogControls;
