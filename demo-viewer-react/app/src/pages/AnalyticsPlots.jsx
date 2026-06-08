/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import {
  buildScatterPlotConfig,
  buildHistogramPlotConfig,
  buildBoxPlotConfig,
  buildViolinPlotConfig,
  buildTernaryPlotConfig,
  BASELODE_TEMPLATE,
  BASELODE_DARK_TEMPLATE,
  LITHOLOGY_COLOURS,
} from 'baselode';
import { useDemoData } from '../context/DemoDataContext.jsx';
import './AnalyticsPlots.css';

const RESERVED = new Set(['hole_id', 'from', 'to', 'mid', 'depth', '_source']);

function flattenAssayRows(combinedHoles) {
  const flattened = [];
  for (const hole of combinedHoles || []) {
    // parseUnifiedDataset returns `{ holeId, points }` per hole, with
    // each point tagged `_source: 'assay' | 'structural' | 'geology'`.
    const holeId = hole?.holeId ?? hole?.id ?? hole?.hole_id;
    const points = hole?.points ?? hole?.rows ?? [];
    for (const row of points) {
      if (!row || row._source !== 'assay') continue;
      // Spread first then set hole_id, so any hole_id already on the
      // row can't override the value normalized from the hole.
      flattened.push({ ...row, hole_id: holeId });
    }
  }
  return flattened;
}

function detectNumericColumns(rows) {
  if (!rows.length) return [];
  const counts = new Map();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (RESERVED.has(key)) continue;
      // Skip nullish + blanks explicitly: Number('') is 0, which would
      // falsely classify blank-string columns as numeric.
      if (value == null) continue;
      if (typeof value === 'string' && value.trim() === '') continue;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  // Sort by frequency desc — most-populated analytes first.
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
}

function detectCategoricalColumns(rows) {
  if (!rows.length) return [];
  const candidates = new Map();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (RESERVED.has(key)) continue;
      if (value == null || value === '') continue;
      if (Number.isFinite(Number(value))) continue;
      if (!candidates.has(key)) candidates.set(key, new Set());
      candidates.get(key).add(String(value));
    }
  }
  return [...candidates.entries()]
    .filter(([, distinct]) => distinct.size > 1 && distinct.size <= 40)
    .sort((a, b) => a[1].size - b[1].size)
    .map(([key]) => key);
}

function PlotPanel({ title, description, controls, data, layout, height = 380 }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    Plotly.react(container, data || [], { autosize: true, ...layout, height }, {
      responsive: true,
      displayModeBar: 'hover',
    });
    return () => {
      try { Plotly.purge(container); } catch (_) { /* unmounted */ }
    };
  }, [data, layout, height]);

  return (
    <section className="plot-panel">
      <header className="plot-panel__header">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      {controls && <div className="plot-panel__controls">{controls}</div>}
      <div ref={containerRef} className="plot-panel__chart" style={{ height: `${height}px` }} />
    </section>
  );
}

function PropertySelect({ label, value, onChange, options, includeBlank = false }) {
  // Render the dropdown alphabetically (case-insensitive) so the list is
  // scannable.  The unsorted ordering is preserved upstream for default
  // picking via column frequency.
  const sortedOptions = [...options].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { sensitivity: 'base' })
  );
  return (
    <label className="prop-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {includeBlank && <option value="">(none)</option>}
        {sortedOptions.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

/**
 * Stable per-plot state — the user can configure each chart independently.
 * Defaults are derived from the discovered numeric / categorical columns
 * the first time they become available; later changes don't auto-reset.
 */
function useDefaultColumn(value, columns, fallbackIdx = 0) {
  useEffect(() => {
    if (value || !columns.length) return;
    // Caller will hand back a setter via the returned function below.
  }, [value, columns, fallbackIdx]);
}

function AnalyticsPlots() {
  const { loading, combinedHoles, errors } = useDemoData();
  const [useDarkTemplate, setUseDarkTemplate] = useState(false);

  const assayRows = useMemo(() => flattenAssayRows(combinedHoles), [combinedHoles]);
  const numericColumns = useMemo(() => detectNumericColumns(assayRows), [assayRows]);
  const categoricalColumns = useMemo(() => detectCategoricalColumns(assayRows), [assayRows]);

  const defaultColorBy = useMemo(() => {
    if (!categoricalColumns.length) return '';
    return categoricalColumns.find((column) => column.toLowerCase().includes('litho'))
      || categoricalColumns[0];
  }, [categoricalColumns]);

  // Per-plot state — scatter
  const [scatterX, setScatterX] = useState('');
  const [scatterY, setScatterY] = useState('');
  const [scatterColorBy, setScatterColorBy] = useState('');

  // Per-plot state — histogram
  const [histProp, setHistProp] = useState('');
  const [histGroupBy, setHistGroupBy] = useState('');

  // Per-plot state — box
  const [boxProp, setBoxProp] = useState('');
  const [boxGroupBy, setBoxGroupBy] = useState('');

  // Per-plot state — violin
  const [violinProp, setViolinProp] = useState('');
  const [violinGroupBy, setViolinGroupBy] = useState('');

  // Per-plot state — ternary
  const [aProp, setAProp] = useState('');
  const [bProp, setBProp] = useState('');
  const [cProp, setCProp] = useState('');
  const [ternaryColorBy, setTernaryColorBy] = useState('');

  // Seed all the per-plot column selections from the discovered columns
  // the first time they're available.  Subsequent column changes don't
  // overwrite a user's explicit pick.
  useEffect(() => {
    if (!numericColumns.length) return;
    const get = (idx) => numericColumns[Math.min(idx, numericColumns.length - 1)];
    setScatterX((current) => current || get(0));
    setScatterY((current) => current || get(1));
    setHistProp((current) => current || get(0));
    setBoxProp((current) => current || get(0));
    setViolinProp((current) => current || get(0));
    setAProp((current) => current || get(0));
    setBProp((current) => current || get(1));
    setCProp((current) => current || get(2));
  }, [numericColumns]);

  useEffect(() => {
    if (!defaultColorBy) return;
    setScatterColorBy((current) => current || defaultColorBy);
    setHistGroupBy((current) => current || defaultColorBy);
    setBoxGroupBy((current) => current || defaultColorBy);
    setViolinGroupBy((current) => current || defaultColorBy);
    setTernaryColorBy((current) => current || defaultColorBy);
  }, [defaultColorBy]);

  const template = useDarkTemplate ? BASELODE_DARK_TEMPLATE : BASELODE_TEMPLATE;
  const colourMap = categoricalColumns.some((column) => column.toLowerCase().includes('litho'))
    ? LITHOLOGY_COLOURS
    : null;

  const scatter = useMemo(() => buildScatterPlotConfig(assayRows, {
    xProp: scatterX, yProp: scatterY, colorBy: scatterColorBy, colourMap,
    log: { x: true, y: true }, template,
  }), [assayRows, scatterX, scatterY, scatterColorBy, colourMap, template]);

  const histogram = useMemo(() => buildHistogramPlotConfig(assayRows, {
    prop: histProp, groupBy: histGroupBy, colourMap, log: true, template,
  }), [assayRows, histProp, histGroupBy, colourMap, template]);

  const box = useMemo(() => buildBoxPlotConfig(assayRows, {
    prop: boxProp, groupBy: boxGroupBy, colourMap, log: true, template,
  }), [assayRows, boxProp, boxGroupBy, colourMap, template]);

  const violin = useMemo(() => buildViolinPlotConfig(assayRows, {
    prop: violinProp, groupBy: violinGroupBy, colourMap, log: true, template,
  }), [assayRows, violinProp, violinGroupBy, colourMap, template]);

  const ternary = useMemo(() => buildTernaryPlotConfig(assayRows, {
    aProp, bProp, cProp, colorBy: ternaryColorBy, colourMap, template,
  }), [assayRows, aProp, bProp, cProp, ternaryColorBy, colourMap, template]);

  const hasCategoricals = categoricalColumns.length > 0;

  return (
    <div className={`analytics-page ${useDarkTemplate ? 'analytics-page--dark' : ''}`}>
      <header className="analytics-page__header">
        <div>
          <h1>Analytics Plots</h1>
          <p>
            Demos of the non-tool-UI plot primitives —{' '}
            <code>buildScatterPlotConfig</code>, <code>buildHistogramPlotConfig</code>,{' '}
            <code>buildBoxPlotConfig</code>, <code>buildViolinPlotConfig</code>, and{' '}
            <code>buildTernaryPlotConfig</code> — each rendered straight into Plotly.
            Lithology-coloured categoricals use the built-in <code>LITHOLOGY_COLOURS</code> map;
            other categoricals cycle the <code>BASELODE_COLORWAY</code>.
          </p>
        </div>
        <div className="analytics-page__meta">
          <label className="dark-toggle">
            <input
              type="checkbox"
              checked={useDarkTemplate}
              onChange={(event) => setUseDarkTemplate(event.target.checked)}
            />
            <span>Dark template</span>
          </label>
          {assayRows.length > 0 && (
            <span className="analytics-rowcount">{assayRows.length.toLocaleString()} assay rows</span>
          )}
        </div>
      </header>

      {loading && <p className="analytics-status">Loading GSWA sample data…</p>}
      {errors?.unified && (
        <p className="analytics-status analytics-status--error">
          Failed to load demo data: {errors.unified}
        </p>
      )}

      {!loading && !assayRows.length && (
        <p className="analytics-status">No assay rows found in the demo dataset.</p>
      )}

      {!loading && assayRows.length > 0 && (
        <>
          <PlotPanel
            title="Scatter"
            description="buildScatterPlotConfig — analyte vs analyte, optional categorical colour-by, log axes."
            controls={(
              <>
                <PropertySelect label="X" value={scatterX} onChange={setScatterX} options={numericColumns} />
                <PropertySelect label="Y" value={scatterY} onChange={setScatterY} options={numericColumns} />
                {hasCategoricals && (
                  <PropertySelect
                    label="Colour by"
                    value={scatterColorBy}
                    onChange={setScatterColorBy}
                    options={categoricalColumns}
                    includeBlank
                  />
                )}
              </>
            )}
            data={scatter.data}
            layout={scatter.layout}
          />

          <PlotPanel
            title="Histogram"
            description="buildHistogramPlotConfig — distribution per group overlaid, log Y."
            controls={(
              <>
                <PropertySelect label="Property" value={histProp} onChange={setHistProp} options={numericColumns} />
                {hasCategoricals && (
                  <PropertySelect
                    label="Group by"
                    value={histGroupBy}
                    onChange={setHistGroupBy}
                    options={categoricalColumns}
                    includeBlank
                  />
                )}
              </>
            )}
            data={histogram.data}
            layout={histogram.layout}
          />

          <div className="analytics-grid">
            <PlotPanel
              title="Box"
              description="buildBoxPlotConfig — quartiles per group, outliers shown, log Y."
              controls={(
                <>
                  <PropertySelect label="Property" value={boxProp} onChange={setBoxProp} options={numericColumns} />
                  {hasCategoricals && (
                    <PropertySelect
                      label="Group by"
                      value={boxGroupBy}
                      onChange={setBoxGroupBy}
                      options={categoricalColumns}
                      includeBlank
                    />
                  )}
                </>
              )}
              data={box.data}
              layout={box.layout}
              height={360}
            />
            <PlotPanel
              title="Violin"
              description="buildViolinPlotConfig — distribution shape per group, inner box + mean line, log Y."
              controls={(
                <>
                  <PropertySelect label="Property" value={violinProp} onChange={setViolinProp} options={numericColumns} />
                  {hasCategoricals && (
                    <PropertySelect
                      label="Group by"
                      value={violinGroupBy}
                      onChange={setViolinGroupBy}
                      options={categoricalColumns}
                      includeBlank
                    />
                  )}
                </>
              )}
              data={violin.data}
              layout={violin.layout}
              height={360}
            />
          </div>

          <PlotPanel
            title="Ternary"
            description="buildTernaryPlotConfig — three-component composition, Plotly auto-normalises to 100."
            controls={(
              <>
                <PropertySelect label="A" value={aProp} onChange={setAProp} options={numericColumns} />
                <PropertySelect label="B" value={bProp} onChange={setBProp} options={numericColumns} />
                <PropertySelect label="C" value={cProp} onChange={setCProp} options={numericColumns} />
                {hasCategoricals && (
                  <PropertySelect
                    label="Colour by"
                    value={ternaryColorBy}
                    onChange={setTernaryColorBy}
                    options={categoricalColumns}
                    includeBlank
                  />
                )}
              </>
            )}
            data={ternary.data}
            layout={ternary.layout}
            height={480}
          />
        </>
      )}
    </div>
  );
}

export default AnalyticsPlots;
