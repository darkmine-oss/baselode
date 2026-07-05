/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import {
  DISPLAY_CATEGORICAL,
  classifyColumns,
  defaultChartType,
  getChartOptions,
} from '../data/columnMeta.js';
import {
  BASELODE_TEMPLATE,
} from '../viz/baselodeTemplate.js';
import {
  BASELODE_DARK_TEMPLATE,
} from '../viz/baselodeDarkTemplate.js';
import {
  buildIntervalPoints,
  buildPlotConfig,
} from '../viz/drillholeViz.js';
import {
  DEFAULT_ATTRIBUTE_COLUMN,
  DEFAULT_UNIT_COLUMN,
  derivePropertyMeta,
  formatPropertyLabel,
} from '../data/propertyLabels.js';
import { getToolUiThemeName, getToolUiThemeStyle } from './theme.js';

function resolveTemplate(template) {
  if (template === 'baselode-dark') return BASELODE_DARK_TEMPLATE;
  if (template === 'plotly-default') return null;
  return BASELODE_TEMPLATE;
}

function normalizeDepthRange(range) {
  if (!Array.isArray(range) || range.length !== 2) return null;
  const start = Number(range[0]);
  const end = Number(range[1]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start === end) return null;
  return start < end ? [start, end] : [end, start];
}

function toPlotlyDepthRange(range) {
  if (!range) return undefined;
  return [range[1], range[0]];
}

function extractDepthRange(update) {
  if (!update || typeof update !== 'object') return null;
  const arrayRange = update['yaxis.range'];
  if (Array.isArray(arrayRange) && arrayRange.length === 2) {
    return normalizeDepthRange(arrayRange);
  }
  const start = update['yaxis.range[0]'];
  const end = update['yaxis.range[1]'];
  if (start !== undefined && end !== undefined) {
    return normalizeDepthRange([start, end]);
  }
  return null;
}

function isCustomTrackLabel(label, property) {
  return Boolean(label && label !== property);
}

function getSelectableProperties(classified, explicitOptions) {
  const builtin = [...classified.numericCols, ...classified.categoricalCols];
  if (!explicitOptions?.length) return builtin;

  const allowed = new Set(builtin);
  return explicitOptions.filter((property) => allowed.has(property));
}

function normalizeTrackConfig(track, {
  trackIndex = 0,
  selectableProperties,
  classified,
  allowPropertySelection,
  allowChartTypeSelection,
  showLegend,
}) {
  const propertyOptions = getSelectableProperties(classified, track.propertyOptions ?? selectableProperties);
  const property = propertyOptions.includes(track.property)
    ? track.property
    : propertyOptions[0] ?? track.property;
  const inferredDisplayType = classified.byType[property] === DISPLAY_CATEGORICAL
    ? DISPLAY_CATEGORICAL
    : 'numeric';
  const displayType = track.chartType === 'categorical' || track.displayType === DISPLAY_CATEGORICAL
    ? DISPLAY_CATEGORICAL
    : inferredDisplayType;
  const chartOptions = getChartOptions(displayType);
  const chartType = chartOptions.some((option) => option.value === track.chartType)
    ? track.chartType
    : defaultChartType(displayType);

  return {
    ...track,
    id: track.id || `${property}-${trackIndex + 1}`,
    property,
    label: isCustomTrackLabel(track.label, track.property) ? track.label : undefined,
    displayType,
    chartType,
    propertyOptions,
    allowPropertySelection: track.allowPropertySelection ?? allowPropertySelection ?? false,
    allowChartTypeSelection: track.allowChartTypeSelection ?? allowChartTypeSelection ?? false,
    showLegend: track.showLegend ?? showLegend ?? displayType === DISPLAY_CATEGORICAL,
    logScale: track.logScale ?? false,
    usePatterns: track.usePatterns ?? false,
  };
}

function getLegendItems(plotData) {
  if (!Array.isArray(plotData) || !plotData.length) return [];

  return plotData
    .map((trace) => {
      const colour = trace?.marker?.color;
      const label = trace?.name;
      if (!label || typeof colour !== 'string') return null;
      return { label, color: colour };
    })
    .filter(Boolean);
}

function applyDepthRange(layout, depthRange) {
  if (!depthRange) return layout;

  return {
    ...layout,
    yaxis: {
      ...(layout.yaxis || {}),
      autorange: false,
      range: toPlotlyDepthRange(depthRange),
    },
  };
}

function StripLogTrack({
  hole,
  track,
  classified,
  propertyMeta,
  height,
  template,
  showModeBar,
  depthRange,
  onTrackChange,
  onIntervalClick,
  onDepthRangeChange,
}) {
  const ref = useRef(null);
  const chartType = track.chartType || (track.displayType === DISPLAY_CATEGORICAL ? 'categorical' : 'markers+line');
  const isMulti = chartType === 'multi-line' || chartType === 'multi-stacked';
  const isCategorical = track.displayType === DISPLAY_CATEGORICAL || chartType === 'categorical';
  const meta = propertyMeta?.[track.property];
  const trackLabel = formatPropertyLabel(track.label || track.property, meta);
  const numericCols = classified?.numericCols || [];
  const categoricalCols = classified?.categoricalCols || [];
  const points = useMemo(
    () => buildIntervalPoints(hole, track.property, isCategorical),
    [hole, isCategorical, track.property]
  );

  // Multi-assay: one numeric series per selected column, seeded from the track
  // property + other numeric columns when `multiProps` is not supplied.
  const series = useMemo(() => {
    if (!isMulti) return null;
    const requested = Array.isArray(track.multiProps)
      ? track.multiProps.filter((property) => numericCols.includes(property))
      : [];
    const seed = numericCols.includes(track.property) ? [track.property] : [];
    const properties = requested.length ? requested : [...new Set([...seed, ...numericCols])].slice(0, 3);
    return properties
      .map((property) => ({ property, points: buildIntervalPoints(hole, property, false) }))
      .filter((entry) => entry.points.length);
  }, [hole, isMulti, numericCols, track.multiProps, track.property]);

  // Colour-by: join the numeric track to a separate categorical column's
  // intervals at their mid-depths. Only for single numeric tracks.
  const colorBy = useMemo(() => {
    if (isMulti || isCategorical) return null;
    const column = track.colorBy && categoricalCols.includes(track.colorBy) ? track.colorBy : '';
    if (!column) return null;
    const segments = buildIntervalPoints(hole, column, true);
    return segments.length ? { property: column, segments } : null;
  }, [hole, isMulti, isCategorical, categoricalCols, track.colorBy]);

  const plotConfig = useMemo(() => {
    const nextConfig = buildPlotConfig({
      points,
      isCategorical,
      property: track.label || track.property,
      chartType,
      colourMap: track.colourMap,
      template: resolveTemplate(template),
      meta,
      colorBy,
      series,
      metaByProperty: propertyMeta,
      logScale: track.logScale === true,
      // Hatch categorical bands with the built-in lithology patterns on opt-in.
      patternMap: isCategorical && track.usePatterns === true ? 'lithology' : undefined,
    });
    return {
      data: nextConfig.data,
      layout: applyDepthRange(nextConfig.layout, depthRange),
    };
  }, [chartType, colorBy, depthRange, isCategorical, meta, points, propertyMeta, series, template, track.colourMap, track.label, track.logScale, track.property, track.usePatterns]);
  const legendItems = useMemo(
    () => (track.showLegend && isCategorical ? getLegendItems(plotConfig.data) : []),
    [isCategorical, plotConfig.data, track.showLegend]
  );
  const chartOptions = useMemo(
    () => getChartOptions(track.displayType),
    [track.displayType]
  );

  useEffect(() => {
    const target = ref.current;
    if (!target) return undefined;

    if (!plotConfig.data.length) {
      target.replaceChildren(document.createTextNode(`No data for ${trackLabel}`));
      return undefined;
    }

    const handleClick = (event) => {
      const point = event?.points?.[0];
      if (!point || !onIntervalClick) return;
      const cd = Array.isArray(point.customdata) ? point.customdata : [];
      // Multi-assay traces store customdata as [trueValue, from, to] (one series
      // per assay); every other track stores [from, to, ...]. Read from/to and
      // the reported value accordingly, and report the clicked assay's property.
      const from = isMulti ? cd[1] : cd[0];
      const to = isMulti ? cd[2] : cd[1];
      const value = isMulti ? cd[0] : (isCategorical ? point.data?.name : point.x);
      onIntervalClick({
        trackId: track.id || track.property,
        property: isMulti ? (point.data?.name || track.property) : track.property,
        value,
        from: Number(from),
        to: Number(to),
        pointIndex: point.pointIndex,
      });
    };

    const handleRelayout = (update) => {
      const nextRange = extractDepthRange(update);
      if (nextRange && onDepthRangeChange) {
        onDepthRangeChange({
          trackId: track.id || track.property,
          depthRange: nextRange,
        });
      }
    };

    target.removeAllListeners?.('plotly_click');
    target.removeAllListeners?.('plotly_relayout');

    Plotly.react(
      target,
      plotConfig.data,
      {
        ...plotConfig.layout,
        height,
        title: undefined,
        margin: { ...plotConfig.layout.margin, t: 12 },
      },
      {
        displayModeBar: showModeBar,
        responsive: true,
      }
    );

    if (onIntervalClick) {
      target.on?.('plotly_click', handleClick);
    }
    if (onDepthRangeChange) {
      target.on?.('plotly_relayout', handleRelayout);
    }

    return () => {
      Plotly.purge(target);
    };
  }, [
    height,
    onDepthRangeChange,
    onIntervalClick,
    plotConfig.data,
    plotConfig.layout,
    showModeBar,
    track.id,
    track.property,
    trackLabel,
    isCategorical,
    isMulti,
  ]);

  return (
    <section className="baselode-tool-strip-log__track" aria-label={trackLabel}>
      <div className="baselode-tool-strip-log__track-title">{trackLabel}</div>

      {(track.allowPropertySelection || (track.allowChartTypeSelection && chartOptions.length > 1)) && (
        <div className="baselode-tool-strip-log__controls">
          {track.allowPropertySelection && track.propertyOptions.length > 0 && (
            <label className="baselode-tool-strip-log__control">
              <span>Property</span>
              <select
                value={track.property}
                onChange={(event) => {
                  onTrackChange?.({
                    ...track,
                    property: event.target.value,
                  });
                }}
              >
                {track.propertyOptions.map((option) => (
                  <option key={option} value={option}>
                    {formatPropertyLabel(option, propertyMeta?.[option])}
                  </option>
                ))}
              </select>
            </label>
          )}

          {track.allowChartTypeSelection && chartOptions.length > 1 && (
            <label className="baselode-tool-strip-log__control">
              <span>Chart</span>
              <select
                value={track.chartType}
                onChange={(event) => {
                  onTrackChange?.({
                    ...track,
                    chartType: event.target.value,
                  });
                }}
              >
                {chartOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <div className="baselode-tool-strip-log__plot" ref={ref} />

      {legendItems.length > 0 && (
        <div className="baselode-tool-strip-log__legend">
          {legendItems.map((item) => (
            <div key={item.label} className="baselode-tool-strip-log__legend-row">
              <span
                className="baselode-tool-strip-log__legend-swatch"
                style={{ backgroundColor: item.color }}
              />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function BaselodeStripLogToolUI({
  id,
  title,
  subtitle,
  hole,
  tracks,
  height = 420,
  template = 'baselode',
  showModeBar = false,
  propertyOptions,
  propertyMeta,
  deriveMetaFromRows = false,
  allowPropertySelection = false,
  allowChartTypeSelection = false,
  showLegend,
  depthRange,
  defaultDepthRange,
  onPropertyChange,
  onTrackChange,
  onIntervalClick,
  onDepthRangeChange,
}) {
  const classified = useMemo(
    () => classifyColumns(hole?.points || []),
    [hole]
  );
  const selectableProperties = useMemo(
    () => getSelectableProperties(classified, propertyOptions),
    [classified, propertyOptions]
  );
  // Per-property unit / source metadata. Explicit `propertyMeta` always wins;
  // when `deriveMetaFromRows` is enabled, keys absent from `propertyMeta` are
  // back-filled from the rows' `analysis_uom` / `analyte_attribute` columns.
  // With neither supplied, output is identical to the pre-metadata behaviour.
  const resolvedPropertyMeta = useMemo(() => {
    const explicit = (propertyMeta && typeof propertyMeta === 'object') ? propertyMeta : null;
    if (!deriveMetaFromRows) return explicit ?? undefined;
    // Exclude the row-level metadata columns themselves so they don't count as
    // populated "measurement" properties when derivePropertyMeta checks each
    // row for a single unambiguous target.
    const allProperties = [...classified.numericCols, ...classified.categoricalCols]
      .filter((property) => property !== DEFAULT_UNIT_COLUMN && property !== DEFAULT_ATTRIBUTE_COLUMN);
    const derived = derivePropertyMeta(hole?.points || [], allProperties);
    if (!explicit) return derived;
    const merged = { ...derived };
    Object.entries(explicit).forEach(([key, value]) => {
      merged[key] = { ...derived[key], ...value };
    });
    return merged;
  }, [propertyMeta, deriveMetaFromRows, classified, hole]);
  const normalizedInitialTracks = useMemo(
    () => tracks.map((track, trackIndex) => normalizeTrackConfig(track, {
      trackIndex,
      selectableProperties,
      classified,
      allowPropertySelection,
      allowChartTypeSelection,
      showLegend,
    })),
    [allowChartTypeSelection, allowPropertySelection, classified, selectableProperties, showLegend, tracks]
  );
  const controlledDepthRange = normalizeDepthRange(depthRange);
  const initialDepthRange = controlledDepthRange ?? normalizeDepthRange(defaultDepthRange);
  const [trackState, setTrackState] = useState(normalizedInitialTracks);
  const [localDepthRange, setLocalDepthRange] = useState(initialDepthRange);

  useEffect(() => {
    setTrackState(normalizedInitialTracks);
  }, [normalizedInitialTracks]);

  useEffect(() => {
    if (controlledDepthRange) {
      setLocalDepthRange(controlledDepthRange);
    }
  }, [controlledDepthRange?.[0], controlledDepthRange?.[1]]);

  const resolvedDepthRange = controlledDepthRange ?? localDepthRange;

  function handleTrackChange(nextTrack) {
    const nextState = trackState.map((track) => {
      if ((track.id || track.property) !== (nextTrack.id || nextTrack.property)) {
        return track;
      }

      const property = nextTrack.property ?? track.property;
      const nextDisplayType = classified.byType[property] === DISPLAY_CATEGORICAL
        ? DISPLAY_CATEGORICAL
        : 'numeric';
      const normalized = normalizeTrackConfig({
        ...track,
        ...nextTrack,
        property,
        displayType: nextTrack.chartType === 'categorical' ? DISPLAY_CATEGORICAL : nextDisplayType,
        chartType: nextTrack.property && nextTrack.property !== track.property
          ? defaultChartType(nextDisplayType)
          : nextTrack.chartType ?? track.chartType,
        label: isCustomTrackLabel(track.label, track.property) ? track.label : undefined,
      }, {
        selectableProperties,
        classified,
        allowPropertySelection,
        allowChartTypeSelection,
        showLegend,
      });
      onTrackChange?.(normalized);
      if (property !== track.property) {
        onPropertyChange?.({
          trackId: normalized.id || normalized.property,
          property: normalized.property,
          displayType: normalized.displayType,
          chartType: normalized.chartType,
        });
      }
      return normalized;
    });

    setTrackState(nextState);
  }

  return (
    <article
      className="baselode-tool-strip-log"
      data-tool-ui-id={id}
      data-baselode-theme={getToolUiThemeName(template)}
      style={getToolUiThemeStyle(template)}
    >
      <header className="baselode-tool-strip-log__header">
        <div>
          <div className="baselode-tool-strip-log__eyebrow">{hole.id}</div>
          <h3>{title || 'Strip log'}</h3>
        </div>
        {subtitle && <p>{subtitle}</p>}
      </header>
      <div className="baselode-tool-strip-log__tracks">
        {trackState.map((track) => (
          <StripLogTrack
            key={track.id || track.property}
            hole={hole}
            track={track}
            classified={classified}
            propertyMeta={resolvedPropertyMeta}
            height={height}
            template={template}
            showModeBar={showModeBar}
            depthRange={resolvedDepthRange}
            onTrackChange={handleTrackChange}
            onIntervalClick={onIntervalClick}
            onDepthRangeChange={(event) => {
              if (!controlledDepthRange && event?.depthRange) {
                setLocalDepthRange(event.depthRange);
              }
              onDepthRangeChange?.(event);
            }}
          />
        ))}
      </div>
    </article>
  );
}
