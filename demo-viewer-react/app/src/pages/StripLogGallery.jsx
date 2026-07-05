/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  PlotPanel,
  PropertySelect,
  LogToggle,
  BASELODE_TEMPLATE,
  BASELODE_DARK_TEMPLATE,
  CHART_OPTIONS,
  DISPLAY_NUMERIC,
  classifyColumns,
  buildIntervalPoints,
  buildPlotConfig,
  buildTwoCurveFillConfig,
  buildCompositionConfig,
  buildPointLogConfig,
  buildDepthAnnotationsConfig,
  buildDipAzimuthConfig,
  buildTadpoleConfig,
  parseSurveyCSV,
  HOLE_ID,
  FROM,
  TO,
  DEPTH,
  GEOLOGY_CODE,
  GEOLOGY_DESCRIPTION,
} from 'baselode';
import 'baselode/style.css';
import './StripLogGallery.css';
import { useDemoData } from '../context/DemoDataContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { loadDemoGeophysicsCsvText, loadDemoSurveyCsvText } from '../data/demoGswaData.js';
import { parseGeophysicsIntervalHoles } from '../data/geophysicsHoles.js';
import { buildSurveyStationIndex, resolveDipAzimuthRows } from '../data/structuralOrientation.js';

// Preferred demo defaults — holes / columns picked for dense coverage in the
// GSWA sample extract, with fallbacks when a preference is absent.
const DEFAULT_ASSAY_HOLE = '97253ForrestaniaNMD140';
const DEFAULT_ASSAY_PROPERTY = 'ni_ppm';
const DEFAULT_TWO_CURVE_A = 'al_ppm';
const DEFAULT_TWO_CURVE_B = 'mg_ppm';
const COMPOSITION_PROPERTIES = ['al_ppm', 'fe_ppm', 'mg_ppm'];
const MULTI_TRACK_PROPERTIES = ['ni_ppm', 'cu_ppm', 'zn_ppm'];
const DEFAULT_GEOLOGY_HOLE = '72183ForrestaniaFFD162W4';
const DEFAULT_STRUCTURE_HOLE = '74719ForrestaniaFFD163W10W2W1';
const DEFAULT_GEOPHYSICS_HOLE = '82655KararaMKC435';
const DEFAULT_GEOPHYSICS_CHANNEL = 'gamma';

const MIN_ASSAY_INTERVALS = 40;
const MIN_GEOLOGY_INTERVALS = 30;
const MIN_STRUCTURE_POINTS = 50;
const MAX_HOLE_OPTIONS = 30;

const VARIANT_PANEL_HEIGHT = 420;
const SECTION_PANEL_HEIGHT = 480;

// GSWA WAROX-style Lith1 codes ("Gqzfdbi", "Utrch", …) are condensed to a
// coarse lithology family by their leading group letter, purely so the demo
// categories match keys in the library's built-in `'lithology'` colour and
// pattern maps.  A demo-only simplification, not a geological interpretation
// of the full code.
const GSWA_LITH1_FAMILIES = {
  G: 'granite',
  M: 'schist',
  U: 'peridotite',
  S: 'sandstone',
  V: 'basalt',
  D: 'gabbro',
  $: 'vein',
};

function lithologyFamilyForCode(code) {
  const text = code != null ? `${code}`.trim() : '';
  if (!text) return '';
  return GSWA_LITH1_FAMILIES[text.charAt(0)] || 'unknown';
}

/** Pick `preferred` when available, otherwise the first option. @private */
function preferredOr(options, selected, preferred) {
  if (selected && options.includes(selected)) return selected;
  if (preferred && options.includes(preferred)) return preferred;
  return options[0] || '';
}

/** Hole IDs with at least `minPoints` rows passing `pointFilter`, densest first. @private */
function denseHoleOptions(holes, pointFilter, minPoints) {
  return (holes || [])
    .map((hole) => ({
      holeId: hole.holeId || hole.id,
      count: (hole.points || []).filter(pointFilter).length,
    }))
    .filter((entry) => entry.holeId && entry.count >= minPoints)
    .sort((first, second) => second.count - first.count)
    .slice(0, MAX_HOLE_OPTIONS)
    .map((entry) => entry.holeId);
}

const EMPTY_CONFIG = { data: [], layout: {} };

/**
 * One panel per strip-log variant shipped by the `baselode` package.
 *
 * The numeric grid iterates the package's own `CHART_OPTIONS` so newly added
 * chart types appear here without demo changes; the standalone builders
 * (two-curve fill, composition, point log, depth annotations, dip/azimuth,
 * tadpole) get their own sections since they take two properties or
 * non-column data and therefore never appear in the per-column dropdown.
 */
function StripLogGallery() {
  const { loading, errors, combinedHoles, geologyHoles, structureRows } = useDemoData();
  const { theme } = useTheme();
  const useDarkTemplate = theme === 'dark';
  const template = useDarkTemplate ? BASELODE_DARK_TEMPLATE : BASELODE_TEMPLATE;

  // Survey + geophysics load lazily here (matching the 3D page's idiom for
  // survey data) — the shared context only eager-loads what every page needs.
  const [surveyRows, setSurveyRows] = useState([]);
  const [geophysicsHoles, setGeophysicsHoles] = useState([]);
  useEffect(() => {
    let cancelled = false;
    loadDemoSurveyCsvText()
      .then((csvText) => parseSurveyCSV(csvText))
      .then((rows) => {
        if (!cancelled) setSurveyRows(rows);
      })
      .catch((err) => console.warn('Survey demo data load failed:', err.message));
    loadDemoGeophysicsCsvText()
      .then((csvText) => parseGeophysicsIntervalHoles(csvText))
      .then((holes) => {
        if (!cancelled) setGeophysicsHoles(holes);
      })
      .catch((err) => console.warn('Geophysics demo data load failed:', err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Assay hole + property selection ------------------------------------
  const [assayHoleId, setAssayHoleId] = useState('');
  const [assayProperty, setAssayProperty] = useState('');
  const [twoCurvePropertyA, setTwoCurvePropertyA] = useState('');
  const [twoCurvePropertyB, setTwoCurvePropertyB] = useState('');

  const assayHoleOptions = useMemo(
    () => denseHoleOptions(combinedHoles, (point) => point?._source === 'assay', MIN_ASSAY_INTERVALS),
    [combinedHoles]
  );
  const activeAssayHoleId = preferredOr(assayHoleOptions, assayHoleId, DEFAULT_ASSAY_HOLE);
  const assayHole = useMemo(
    () => (combinedHoles || []).find((hole) => hole.holeId === activeAssayHoleId) || null,
    [combinedHoles, activeAssayHoleId]
  );
  const numericColumns = useMemo(() => {
    if (!assayHole) return [];
    const assayPoints = (assayHole.points || []).filter((point) => point?._source === 'assay');
    return classifyColumns(assayPoints).numericCols;
  }, [assayHole]);

  const activeAssayProperty = preferredOr(numericColumns, assayProperty, DEFAULT_ASSAY_PROPERTY);
  const activeTwoCurveA = preferredOr(numericColumns, twoCurvePropertyA, DEFAULT_TWO_CURVE_A);
  const activeTwoCurveB = preferredOr(
    numericColumns.filter((column) => column !== activeTwoCurveA),
    twoCurvePropertyB,
    DEFAULT_TWO_CURVE_B
  );

  const multiTrackProperties = useMemo(() => {
    const preferred = MULTI_TRACK_PROPERTIES.filter((column) => numericColumns.includes(column));
    return preferred.length >= 2 ? preferred : numericColumns.slice(0, 3);
  }, [numericColumns]);

  const compositionProperties = useMemo(() => {
    const preferred = COMPOSITION_PROPERTIES.filter((column) => numericColumns.includes(column));
    return preferred.length === COMPOSITION_PROPERTIES.length ? preferred : numericColumns.slice(0, 3);
  }, [numericColumns]);

  // --- Numeric chart-type variants (from the package's CHART_OPTIONS) -----
  const numericVariants = useMemo(() => {
    if (!assayHole || !activeAssayProperty) return [];
    const points = buildIntervalPoints(assayHole, activeAssayProperty, false);
    const series = multiTrackProperties
      .map((column) => ({ property: column, points: buildIntervalPoints(assayHole, column, false) }))
      .filter((entry) => entry.points.length);
    return CHART_OPTIONS[DISPLAY_NUMERIC].map((option) => {
      const isMulti = option.value === 'multi-line' || option.value === 'multi-stacked';
      return {
        option,
        config: buildPlotConfig({
          points,
          isCategorical: false,
          property: activeAssayProperty,
          chartType: option.value,
          series: isMulti ? series : undefined,
          template,
        }),
      };
    });
  }, [assayHole, activeAssayProperty, multiTrackProperties, template]);

  // --- Log scale (geophysics channels) ------------------------------------
  const [geophysicsHoleId, setGeophysicsHoleId] = useState('');
  const [geophysicsChannel, setGeophysicsChannel] = useState('');
  const [logScale, setLogScale] = useState(true);

  const geophysicsHoleOptions = useMemo(
    () => geophysicsHoles.map((hole) => hole.holeId),
    [geophysicsHoles]
  );
  const activeGeophysicsHoleId = preferredOr(geophysicsHoleOptions, geophysicsHoleId, DEFAULT_GEOPHYSICS_HOLE);
  const geophysicsHole = useMemo(
    () => geophysicsHoles.find((hole) => hole.holeId === activeGeophysicsHoleId) || null,
    [geophysicsHoles, activeGeophysicsHoleId]
  );
  const geophysicsChannels = useMemo(
    () => (geophysicsHole ? classifyColumns(geophysicsHole.points).numericCols : []),
    [geophysicsHole]
  );
  const activeGeophysicsChannel = preferredOr(geophysicsChannels, geophysicsChannel, DEFAULT_GEOPHYSICS_CHANNEL);

  const logScaleConfig = useMemo(() => {
    if (!geophysicsHole || !activeGeophysicsChannel) return EMPTY_CONFIG;
    return buildPlotConfig({
      points: buildIntervalPoints(geophysicsHole, activeGeophysicsChannel, false),
      isCategorical: false,
      property: activeGeophysicsChannel,
      chartType: 'line',
      logScale,
      template,
    });
  }, [geophysicsHole, activeGeophysicsChannel, logScale, template]);

  // --- Categorical bands + hatch patterns (geology Lith1) ------------------
  const [geologyHoleId, setGeologyHoleId] = useState('');
  const [hatchPatterns, setHatchPatterns] = useState(true);

  const geologyHoleOptions = useMemo(
    () => denseHoleOptions(
      geologyHoles,
      (point) => `${point?.[GEOLOGY_CODE] ?? ''}`.trim() !== '',
      MIN_GEOLOGY_INTERVALS
    ),
    [geologyHoles]
  );
  const activeGeologyHoleId = preferredOr(geologyHoleOptions, geologyHoleId, DEFAULT_GEOLOGY_HOLE);
  const geologyHole = useMemo(
    () => (geologyHoles || []).find((hole) => hole.holeId === activeGeologyHoleId) || null,
    [geologyHoles, activeGeologyHoleId]
  );
  const lithologyPoints = useMemo(() => {
    if (!geologyHole) return [];
    return (geologyHole.points || [])
      .map((point) => ({
        from: Number(point[FROM]),
        to: Number(point[TO]),
        val: lithologyFamilyForCode(point[GEOLOGY_CODE]),
      }))
      .filter((point) => Number.isFinite(point.from) && Number.isFinite(point.to) && point.val !== '');
  }, [geologyHole]);

  const categoricalConfig = useMemo(() => buildPlotConfig({
    points: lithologyPoints,
    isCategorical: true,
    property: 'lithology',
    chartType: 'categorical',
    colourMap: 'lithology',
    patternMap: hatchPatterns ? 'lithology' : null,
    template,
  }), [lithologyPoints, hatchPatterns, template]);

  // --- Two-curve fill + synthetic composition ------------------------------
  const twoCurveConfig = useMemo(() => {
    if (!assayHole || !activeTwoCurveA || !activeTwoCurveB) return EMPTY_CONFIG;
    return buildTwoCurveFillConfig({
      hole: assayHole,
      propertyA: activeTwoCurveA,
      propertyB: activeTwoCurveB,
      template,
    });
  }, [assayHole, activeTwoCurveA, activeTwoCurveB, template]);

  const compositionConfig = useMemo(() => {
    if (!assayHole || compositionProperties.length < 2) return EMPTY_CONFIG;
    return buildCompositionConfig({
      hole: assayHole,
      properties: compositionProperties,
      normalize: true,
      template,
    });
  }, [assayHole, compositionProperties, template]);

  // --- Structural tracks (point log, annotations, dip/azimuth, tadpole) ----
  const [structureHoleId, setStructureHoleId] = useState('');

  const structureHoles = useMemo(() => {
    const byHole = new Map();
    for (const row of structureRows || []) {
      const holeId = row[HOLE_ID] != null ? `${row[HOLE_ID]}`.trim() : '';
      if (!holeId) continue;
      if (!byHole.has(holeId)) byHole.set(holeId, { holeId, points: [] });
      byHole.get(holeId).points.push(row);
    }
    return Array.from(byHole.values());
  }, [structureRows]);

  const structureHoleOptions = useMemo(
    () => denseHoleOptions(structureHoles, () => true, MIN_STRUCTURE_POINTS),
    [structureHoles]
  );
  const activeStructureHoleId = preferredOr(structureHoleOptions, structureHoleId, DEFAULT_STRUCTURE_HOLE);
  const structurePoints = useMemo(
    () => structureHoles.find((hole) => hole.holeId === activeStructureHoleId)?.points || [],
    [structureHoles, activeStructureHoleId]
  );

  const surveyIndex = useMemo(() => buildSurveyStationIndex(surveyRows), [surveyRows]);
  const orientation = useMemo(
    () => resolveDipAzimuthRows(structurePoints, surveyIndex.get(activeStructureHoleId)),
    [structurePoints, surveyIndex, activeStructureHoleId]
  );

  const pointLogConfig = useMemo(() => buildPointLogConfig({
    rows: structurePoints,
    depthKey: DEPTH,
    categoryKey: 'defect',
    template,
  }), [structurePoints, template]);

  const depthAnnotationsConfig = useMemo(() => buildDepthAnnotationsConfig({
    rows: structurePoints,
    depthKey: DEPTH,
    textKey: GEOLOGY_DESCRIPTION,
    template,
  }), [structurePoints, template]);

  const dipAzimuthConfig = useMemo(() => buildDipAzimuthConfig({
    rows: orientation.rows,
    template,
  }), [orientation, template]);

  const tadpoleConfig = useMemo(() => buildTadpoleConfig(orientation.rows, {
    colorBy: 'defect',
    template,
  }), [orientation, template]);

  const orientationSummary = orientation.rows.length
    ? `${orientation.measuredCount} measured · ${orientation.derivedCount} derived from α/β via alphaBetaToDipAzimuth`
    : 'No orientation data for this hole';

  return (
    <div className={`striplog-gallery ${useDarkTemplate ? 'striplog-gallery--dark' : ''}`}>
      <header className="striplog-gallery__header">
        <div>
          <h1>Strip Log Gallery</h1>
          <p>
            One example of every strip-log variant in <code>baselode</code> — the numeric
            chart types from <code>CHART_OPTIONS</code> plus the standalone builders
            (<code>buildTwoCurveFillConfig</code>, <code>buildCompositionConfig</code>,{' '}
            <code>buildPointLogConfig</code>, <code>buildDepthAnnotationsConfig</code>,{' '}
            <code>buildDipAzimuthConfig</code>, <code>buildTadpoleConfig</code>).
          </p>
        </div>
      </header>

      {loading && <p className="striplog-gallery__status">Loading GSWA sample data…</p>}
      {errors?.unified && (
        <p className="striplog-gallery__status striplog-gallery__status--error">
          Failed to load demo data: {errors.unified}
        </p>
      )}

      {!loading && (
        <>
          <section className="striplog-gallery__section">
            <h2>Numeric chart types</h2>
            <p>
              Every numeric chart type offered by the per-column dropdown, rendered
              via <code>buildPlotConfig</code> for one assay column.
            </p>
            <div className="striplog-gallery__controls">
              <PropertySelect label="hole" value={activeAssayHoleId} onChange={setAssayHoleId} options={assayHoleOptions} />
              <PropertySelect label="property" value={activeAssayProperty} onChange={setAssayProperty} options={numericColumns} />
            </div>
            <div className="striplog-gallery__grid">
              {numericVariants.map(({ option, config }) => (
                <PlotPanel
                  key={option.value}
                  title={option.label}
                  description={`chartType: '${option.value}'`}
                  data={config.data}
                  layout={config.layout}
                  height={VARIANT_PANEL_HEIGHT}
                />
              ))}
            </div>
          </section>

          <div className="striplog-gallery__grid striplog-gallery__grid--wide">
            <section className="striplog-gallery__section">
              <h2>Log scale</h2>
              <p>
                Geophysics probe channels as a numeric track with the{' '}
                <code>logScale</code> option. Resistivity is flat (a constant
                4000 Ω·m cap) in this GSWA extract, so gamma is the default —
                switch channels to compare.
              </p>
              <div className="striplog-gallery__controls">
                <PropertySelect label="hole" value={activeGeophysicsHoleId} onChange={setGeophysicsHoleId} options={geophysicsHoleOptions} />
                <PropertySelect label="channel" value={activeGeophysicsChannel} onChange={setGeophysicsChannel} options={geophysicsChannels} />
                <LogToggle label="Log scale" value={logScale} onChange={setLogScale} />
              </div>
              <PlotPanel
                data={logScaleConfig.data}
                layout={logScaleConfig.layout}
                height={SECTION_PANEL_HEIGHT}
              />
            </section>

            <section className="striplog-gallery__section">
              <h2>Categorical bands + hatch patterns</h2>
              <p>
                Geology Lith1 intervals as categorical bands. The toggle passes{' '}
                <code>patternMap: 'lithology'</code>; GSWA codes are condensed to
                coarse families (granite, schist, …) so the built-in map has
                matching keys.
              </p>
              <div className="striplog-gallery__controls">
                <PropertySelect label="hole" value={activeGeologyHoleId} onChange={setGeologyHoleId} options={geologyHoleOptions} />
                <LogToggle label="Hatch patterns" value={hatchPatterns} onChange={setHatchPatterns} />
              </div>
              <PlotPanel
                data={categoricalConfig.data}
                layout={categoricalConfig.layout}
                height={SECTION_PANEL_HEIGHT}
              />
            </section>

            <section className="striplog-gallery__section">
              <h2>Two-curve fill</h2>
              <p>
                <code>buildTwoCurveFillConfig</code> — two assay curves on a shared
                depth axis with the region between them shaded, flipping colour at
                each crossover.
              </p>
              <div className="striplog-gallery__controls">
                <PropertySelect label="curve A" value={activeTwoCurveA} onChange={setTwoCurvePropertyA} options={numericColumns} />
                <PropertySelect label="curve B" value={activeTwoCurveB} onChange={setTwoCurvePropertyB} options={numericColumns.filter((column) => column !== activeTwoCurveA)} />
              </div>
              <PlotPanel
                data={twoCurveConfig.data}
                layout={twoCurveConfig.layout}
                height={SECTION_PANEL_HEIGHT}
              />
            </section>

            <section className="striplog-gallery__section">
              <h2>Composition (synthetic)</h2>
              <p>
                <code>buildCompositionConfig</code> — synthetic composition demo:{' '}
                {compositionProperties.join(' / ') || 'assay'} values normalised to
                fractions of their per-interval sum. The GSWA sample carries no
                true modal composition data.
              </p>
              <PlotPanel
                data={compositionConfig.data}
                layout={compositionConfig.layout}
                height={SECTION_PANEL_HEIGHT}
              />
            </section>
          </div>

          <section className="striplog-gallery__section">
            <h2>Structural tracks</h2>
            <p>
              Point measurements from the structure CSV. Sparse measured
              dip/azimuth values are completed from oriented-core α/β angles
              using the hole's survey orientation at each depth —{' '}
              {orientationSummary}.
            </p>
            <div className="striplog-gallery__controls">
              <PropertySelect label="hole" value={activeStructureHoleId} onChange={setStructureHoleId} options={structureHoleOptions} />
            </div>
            <div className="striplog-gallery__grid striplog-gallery__grid--wide">
              <PlotPanel
                title="Point log"
                description="buildPointLogConfig — defect type by depth"
                data={pointLogConfig.data}
                layout={pointLogConfig.layout}
                height={SECTION_PANEL_HEIGHT}
              />
              <PlotPanel
                title="Depth annotations"
                description="buildDepthAnnotationsConfig — logged descriptions pinned to depth"
                data={depthAnnotationsConfig.data}
                layout={depthAnnotationsConfig.layout}
                height={SECTION_PANEL_HEIGHT}
              />
              <PlotPanel
                title="Dip / azimuth"
                description="buildDipAzimuthConfig — split dip + azimuth tracks"
                data={dipAzimuthConfig.data}
                layout={dipAzimuthConfig.layout}
                height={SECTION_PANEL_HEIGHT}
              />
              <PlotPanel
                title="Tadpole"
                description="buildTadpoleConfig — dip head + azimuth tail, coloured by defect"
                data={tadpoleConfig.data}
                layout={tadpoleConfig.layout}
                height={SECTION_PANEL_HEIGHT}
              />
            </div>
          </section>
        </>
      )}

      {(() => {
        const dataSourceTarget = typeof document !== 'undefined' ? document.getElementById('data-source-slot') : null;
        if (!dataSourceTarget) return null;
        const dataSourceInfo = (
          <div className="data-source-text">
            <div>demo_gswa (assay + geology + structure + survey + geophysics)</div>
          </div>
        );
        return createPortal(dataSourceInfo, dataSourceTarget);
      })()}
    </div>
  );
}

export default StripLogGallery;
