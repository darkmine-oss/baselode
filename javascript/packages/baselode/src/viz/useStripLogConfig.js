/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useMemo, useState, useEffect } from 'react';
import { classifyColumns, getChartOptions, defaultChartType, DISPLAY_NUMERIC } from '../data/columnMeta.js';
import { standardizeRowArray } from '../data/keying.js';

/**
 * Derive and manage strip log selection state from raw interval rows.
 *
 * Use this hook when you want to place StripLogControls and StripLogPlot in
 * separate parts of the UI. The hook owns the property/chart-type state so
 * both components stay in sync.
 *
 * @example
 * const config = useStripLogConfig({ rows });
 * // Sidebar:
 * <StripLogControls {...config}
 *   onPropertyChange={config.setProperty}
 *   onChartTypeChange={config.setChartType} />
 * // Main area:
 * <StripLogPlot rows={rows} property={config.property}
 *   chartType={config.chartType} mode="plot" />
 *
 * @param {Object} options
 * @param {Array<Object>} [options.rows=[]] - Raw interval rows (standardized internally)
 * @param {string} [options.holeId] - Filter rows to this hole ID
 * @param {string} [options.dataType] - 'assay' | 'geology' | string
 * @param {string} [options.defaultProperty] - Initial selected property
 * @param {string[]} [options.properties] - Explicit available-property list (inferred if omitted)
 * @returns {{
 *   property: string,
 *   setProperty: (p: string) => void,
 *   chartType: string,
 *   setChartType: (t: string) => void,
 *   properties: string[],
 *   displayType: string,
 *   columnMeta: Object<string, string>,
 *   standardizedRows: Array<Object>,
 * }}
 */
export default function useStripLogConfig({
  rows = [],
  holeId,
  dataType,
  defaultProperty,
  properties: propertiesProp,
} = {}) {
  const standardizedRows = useMemo(() => {
    if (!rows?.length) return [];
    const std = standardizeRowArray(rows);
    if (!holeId) return std;
    return std.filter((r) => String(r.hole_id ?? r.holeid ?? r.id ?? '') === String(holeId));
  }, [rows, holeId]);

  const { byType, numericCols, categoricalCols } = useMemo(
    () => classifyColumns(standardizedRows),
    [standardizedRows]
  );

  const properties = useMemo(() => {
    if (propertiesProp?.length) return propertiesProp;
    if (dataType === 'geology') return categoricalCols;
    if (dataType === 'assay') return numericCols;
    return [...numericCols, ...categoricalCols];
  }, [propertiesProp, dataType, numericCols, categoricalCols]);

  const [property, setProperty] = useState(() => defaultProperty ?? '');
  const [chartType, setChartType] = useState('markers+line');

  const displayType = useMemo(() => {
    if (dataType === 'geology') return 'categorical';
    return byType[property] || DISPLAY_NUMERIC;
  }, [byType, property, dataType]);

  // Seed / re-seed property when the derived list first resolves or the current selection becomes invalid
  useEffect(() => {
    if (!property && properties.length > 0) {
      setProperty(
        defaultProperty && properties.includes(defaultProperty) ? defaultProperty : properties[0]
      );
    } else if (property && properties.length > 0 && !properties.includes(property)) {
      setProperty(
        defaultProperty && properties.includes(defaultProperty) ? defaultProperty : properties[0]
      );
    }
  }, [properties, defaultProperty]);

  // Reset chart type when display type changes and current choice is no longer valid
  useEffect(() => {
    const opts = getChartOptions(displayType);
    if (!opts.some((o) => o.value === chartType)) {
      setChartType(opts[0]?.value || defaultChartType(displayType));
    }
  }, [displayType]);

  return {
    property,
    setProperty,
    chartType,
    setChartType,
    properties,
    displayType,
    columnMeta: byType,
    standardizedRows,
  };
}
