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
    const holeId = hole?.id ?? hole?.hole_id;
    for (const row of hole?.rows || []) {
      if (!row || row._source !== 'assay') continue;
      flattened.push({ hole_id: holeId, ...row });
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

function PlotPanel({ title, description, data, layout, height = 380 }) {
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
      <div ref={containerRef} className="plot-panel__chart" style={{ height: `${height}px` }} />
    </section>
  );
}

function PropertySelect({ label, value, onChange, options }) {
  return (
    <label className="prop-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function AnalyticsPlots() {
  const { loading, combinedHoles, errors } = useDemoData();
  const [useDarkTemplate, setUseDarkTemplate] = useState(false);

  const assayRows = useMemo(() => flattenAssayRows(combinedHoles), [combinedHoles]);
  const numericColumns = useMemo(() => detectNumericColumns(assayRows), [assayRows]);
  const categoricalColumns = useMemo(() => detectCategoricalColumns(assayRows), [assayRows]);

  const defaultColorBy = useMemo(() => {
    if (!categoricalColumns.length) return undefined;
    return categoricalColumns.find((column) => column.toLowerCase().includes('litho'))
      || categoricalColumns[0];
  }, [categoricalColumns]);

  const [xProp, setXProp] = useState('');
  const [yProp, setYProp] = useState('');
  const [distProp, setDistProp] = useState('');
  const [groupBy, setGroupBy] = useState('');
  const [aProp, setAProp] = useState('');
  const [bProp, setBProp] = useState('');
  const [cProp, setCProp] = useState('');

  useEffect(() => {
    if (!numericColumns.length) return;
    if (!xProp) setXProp(numericColumns[0]);
    if (!yProp) setYProp(numericColumns[Math.min(1, numericColumns.length - 1)] || numericColumns[0]);
    if (!distProp) setDistProp(numericColumns[0]);
    if (!aProp) setAProp(numericColumns[0]);
    if (!bProp) setBProp(numericColumns[Math.min(1, numericColumns.length - 1)] || numericColumns[0]);
    if (!cProp) setCProp(numericColumns[Math.min(2, numericColumns.length - 1)] || numericColumns[0]);
  }, [numericColumns, xProp, yProp, distProp, aProp, bProp, cProp]);

  useEffect(() => {
    if (!groupBy && defaultColorBy) setGroupBy(defaultColorBy);
  }, [defaultColorBy, groupBy]);

  const template = useDarkTemplate ? BASELODE_DARK_TEMPLATE : BASELODE_TEMPLATE;
  const colourMap = categoricalColumns.some((column) => column.toLowerCase().includes('litho'))
    ? LITHOLOGY_COLOURS
    : null;

  const scatter = useMemo(() => buildScatterPlotConfig(assayRows, {
    xProp, yProp, colorBy: groupBy, colourMap, log: { x: true, y: true }, template,
  }), [assayRows, xProp, yProp, groupBy, colourMap, template]);

  const histogram = useMemo(() => buildHistogramPlotConfig(assayRows, {
    prop: distProp, groupBy, colourMap, log: true, template,
  }), [assayRows, distProp, groupBy, colourMap, template]);

  const box = useMemo(() => buildBoxPlotConfig(assayRows, {
    prop: distProp, groupBy, colourMap, log: true, template,
  }), [assayRows, distProp, groupBy, colourMap, template]);

  const violin = useMemo(() => buildViolinPlotConfig(assayRows, {
    prop: distProp, groupBy, colourMap, log: true, template,
  }), [assayRows, distProp, groupBy, colourMap, template]);

  const ternary = useMemo(() => buildTernaryPlotConfig(assayRows, {
    aProp, bProp, cProp, colorBy: groupBy, colourMap, template,
  }), [assayRows, aProp, bProp, cProp, groupBy, colourMap, template]);

  return (
    <div className={`analytics-page ${useDarkTemplate ? 'analytics-page--dark' : ''}`}>
      <header className="analytics-page__header">
        <div>
          <h1>Analytics Plots</h1>
          <p>
            Demos of the non-tool-UI plot primitives —{' '}
            <code>buildScatterPlotConfig</code>, <code>buildHistogramPlotConfig</code>,{' '}
            <code>buildBoxPlotConfig</code>, <code>buildViolinPlotConfig</code>, and{' '}
            <code>buildTernaryPlotConfig</code> — each rendered straight into Plotly with the
            built-in <code>LITHOLOGY_COLOURS</code> map.
          </p>
        </div>
        <label className="dark-toggle">
          <input
            type="checkbox"
            checked={useDarkTemplate}
            onChange={(event) => setUseDarkTemplate(event.target.checked)}
          />
          <span>Dark template</span>
        </label>
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
          <div className="analytics-controls">
            <PropertySelect label="Scatter X" value={xProp} onChange={setXProp} options={numericColumns} />
            <PropertySelect label="Scatter Y" value={yProp} onChange={setYProp} options={numericColumns} />
            <PropertySelect
              label="Distribution prop"
              value={distProp}
              onChange={setDistProp}
              options={numericColumns}
            />
            {categoricalColumns.length > 0 && (
              <PropertySelect
                label="Group / colour by"
                value={groupBy}
                onChange={setGroupBy}
                options={categoricalColumns}
              />
            )}
            <PropertySelect label="Ternary A" value={aProp} onChange={setAProp} options={numericColumns} />
            <PropertySelect label="Ternary B" value={bProp} onChange={setBProp} options={numericColumns} />
            <PropertySelect label="Ternary C" value={cProp} onChange={setCProp} options={numericColumns} />
            <span className="analytics-rowcount">{assayRows.length.toLocaleString()} assay rows loaded</span>
          </div>

          <PlotPanel
            title={`Scatter — ${xProp} vs ${yProp}`}
            description={`buildScatterPlotConfig with colorBy="${groupBy || '(none)'}", log axes on both X and Y.`}
            data={scatter.data}
            layout={scatter.layout}
          />

          <PlotPanel
            title={`Histogram — ${distProp}`}
            description={`buildHistogramPlotConfig, overlay grouped by "${groupBy || '(none)'}", log Y.`}
            data={histogram.data}
            layout={histogram.layout}
          />

          <div className="analytics-grid">
            <PlotPanel
              title={`Box — ${distProp} per ${groupBy || '(set)'}`}
              description="buildBoxPlotConfig with outliers, log Y."
              data={box.data}
              layout={box.layout}
              height={360}
            />
            <PlotPanel
              title={`Violin — ${distProp} per ${groupBy || '(set)'}`}
              description="buildViolinPlotConfig with inner box + mean line, log Y."
              data={violin.data}
              layout={violin.layout}
              height={360}
            />
          </div>

          <PlotPanel
            title={`Ternary — ${aProp} · ${bProp} · ${cProp}`}
            description={`buildTernaryPlotConfig, colorBy="${groupBy || '(none)'}". Plotly auto-normalises components to 100.`}
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
