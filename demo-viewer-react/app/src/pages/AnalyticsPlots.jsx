/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useMemo, useState } from 'react';
import {
  BaselodeScatterPanel,
  BaselodeHistogramPanel,
  BaselodeBoxPanel,
  BaselodeViolinPanel,
  BaselodeTernaryPanel,
  BASELODE_TEMPLATE,
  BASELODE_DARK_TEMPLATE,
  LITHOLOGY_COLOURS,
  detectCategoricalColumns,
} from 'baselode';
import { useDemoData } from '../context/DemoDataContext.jsx';
import './AnalyticsPlots.css';

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

/**
 * Demo of the new BaselodeXPanel wrappers from `baselode`.  Every
 * picker is now bundled with its plot primitive — this page just
 * passes `rows` + a `template`/`colourMap` and the panels render
 * themselves, including X/Y/Group-by dropdowns, log toggles, and
 * (for the histogram) the stack-mode picker.  Compare to the
 * pre-TRK-119 incarnation of this file (~430 lines of inline
 * pickers + per-plot state) to see what the wrappers absorb.
 */
function AnalyticsPlots() {
  const { loading, combinedHoles, errors } = useDemoData();
  const [useDarkTemplate, setUseDarkTemplate] = useState(false);

  const assayRows = useMemo(() => flattenAssayRows(combinedHoles), [combinedHoles]);

  // Only swap to the lithology palette when the data actually carries
  // a lithology categorical — otherwise the panel cycles the
  // BASELODE_COLORWAY for whatever the user picked.
  const colourMap = useMemo(() => {
    const cats = detectCategoricalColumns(assayRows);
    return cats.some((c) => c.toLowerCase().includes('litho')) ? LITHOLOGY_COLOURS : null;
  }, [assayRows]);

  const template = useDarkTemplate ? BASELODE_DARK_TEMPLATE : BASELODE_TEMPLATE;

  return (
    <div className={`analytics-page ${useDarkTemplate ? 'analytics-page--dark' : ''}`}>
      <header className="analytics-page__header">
        <div>
          <h1>Analytics Plots</h1>
          <p>
            Demo of the <code>Baselode*Panel</code> wrappers — each plot bundles its
            own dropdowns + view toggles so the host page just passes <code>rows</code>{' '}
            and a Plotly <code>template</code>.  Lithology-coloured categoricals use the
            built-in <code>LITHOLOGY_COLOURS</code> map; other categoricals cycle the{' '}
            <code>BASELODE_COLORWAY</code>.
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
          <BaselodeScatterPanel
            rows={assayRows}
            colourMap={colourMap}
            template={template}
            description="Analyte vs analyte with optional categorical colour-by."
          />

          <BaselodeHistogramPanel
            rows={assayRows}
            colourMap={colourMap}
            template={template}
            description="Distribution per group overlaid; switch stack mode to compare absolute counts."
          />

          <div className="analytics-grid">
            <BaselodeBoxPanel
              rows={assayRows}
              colourMap={colourMap}
              template={template}
              description="Quartiles per group, outliers shown."
            />
            <BaselodeViolinPanel
              rows={assayRows}
              colourMap={colourMap}
              template={template}
              description="Distribution shape per group, inner box + mean line."
            />
          </div>

          <BaselodeTernaryPanel
            rows={assayRows}
            colourMap={colourMap}
            template={template}
            description="Three-component composition, Plotly auto-normalises to 100."
          />
        </>
      )}
    </div>
  );
}

export default AnalyticsPlots;
