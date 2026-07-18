/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useRef } from 'react';
import Plotly from 'plotly.js-dist-min';
import {
  createPlotlyDrawLifecycle,
  observePlotlyResize,
} from '../viz/plotlyDrawLifecycle.js';

import './panels.css';

/**
 * Plotly chart in a card layout, shared by every analytics panel.
 *
 * Mounts a Plotly chart in a sized container and re-renders via
 * `Plotly.react` whenever the data / layout / height props change.
 * The `controls` slot renders an interactive control row between
 * the header and the chart so each panel can own its own pickers
 * without the page above needing to know about them.
 *
 * @param {Object} props
 * @param {string} [props.title]
 * @param {string} [props.description]
 * @param {React.ReactNode} [props.controls] - Picker / toggle row
 *   rendered above the chart.
 * @param {Array<Object>} props.data - Plotly trace data.
 * @param {Object} props.layout - Plotly layout config.
 * @param {number} [props.height=380] - Chart height in pixels.
 * @param {string} [props.className] - Extra class on the outer
 *   `<section>` so callers can theme individual panels.
 */
export function PlotPanel({
  title, description, controls, data, layout, height = 380, className = '',
}) {
  const containerRef = useRef(null);
  const plotLifecycleRef = useRef(null);
  if (!plotLifecycleRef.current) {
    plotLifecycleRef.current = createPlotlyDrawLifecycle();
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const plotEpoch = plotLifecycleRef.current.begin();
    try {
      plotLifecycleRef.current.track(Plotly.react(
        container,
        data || [],
        { autosize: true, ...layout, height },
        {
          responsive: false,
          displayModeBar: 'hover',
        }
      ));
    } catch (error) {
      console.warn('Plot render error', error);
    }
    return () => {
      plotLifecycleRef.current.purgeWhenIdle(container, Plotly, plotEpoch);
    };
  }, [data, layout, height]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    return observePlotlyResize(container, Plotly, plotLifecycleRef.current);
  }, []);

  return (
    <section className={`baselode-plot-panel ${className}`.trim()}>
      {(title || description) && (
        <header className="baselode-plot-panel__header">
          {title && <h2>{title}</h2>}
          {description && <p>{description}</p>}
        </header>
      )}
      {controls && <div className="baselode-plot-panel__controls">{controls}</div>}
      <div
        ref={containerRef}
        className="baselode-plot-panel__chart"
        style={{ height: `${height}px` }}
      />
    </section>
  );
}

/**
 * Property dropdown used everywhere a panel needs an X / Y / Group-
 * by / etc. selector.
 *
 * Options are rendered alphabetically (case-insensitive) for scannability;
 * upstream column ordering is preserved for default picking via
 * column frequency.  Pass `includeBlank` to surface a `(none)`
 * option — useful for the "no colour-by" case.
 */
export function PropertySelect({ label, value, onChange, options, includeBlank = false }) {
  const sortedOptions = [...(options || [])].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }),
  );
  return (
    <label className="baselode-prop-select">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
        {includeBlank && <option value="">(none)</option>}
        {sortedOptions.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

/**
 * Log-scale checkbox used wherever a panel needs an axis-scale toggle.
 */
export function LogToggle({ label, value, onChange }) {
  return (
    <label className="baselode-log-toggle">
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

/**
 * Histogram bar-stacking selector.
 *
 * Three modes correspond to Plotly's `barmode`:
 * - `'overlay'` — bars from different groups z-stacked at the same x
 *   with transparency (default in the histogram primitive).
 * - `'stack'` — bars y-stacked so the bin height is the sum of group
 *   counts.
 * - `'group'` — bars side-by-side.
 */
export function BarmodeSelect({ value, onChange }) {
  return (
    <label className="baselode-prop-select">
      <span>stack</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="overlay">in z (overlay)</option>
        <option value="stack">in y (stacked)</option>
        <option value="group">side-by-side</option>
      </select>
    </label>
  );
}
