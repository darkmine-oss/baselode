/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  PlotPanel,
  TracePlot,
  PropertySelect,
  LogToggle,
  BASELODE_TEMPLATE,
  BASELODE_DARK_TEMPLATE,
  CHART_OPTIONS,
  DISPLAY_NUMERIC,
  DISPLAY_CATEGORICAL,
  DISPLAY_COMMENT,
  DISPLAY_TADPOLE,
  GRADED_COLOR_BY,
  isMultiPropertyChartType,
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
import { BaselodeStripLogToolUI } from 'baselode/tool-ui';
import 'baselode/tool-ui/style.css';
import './StripLogGallery.css';
import { useDemoData } from '../context/DemoDataContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { loadDemoGeophysicsCsvText, loadDemoSurveyCsvText } from '../data/demoGswaData.js';
import { parseGeophysicsIntervalHoles } from '../data/geophysicsHoles.js';
import { buildSurveyStationIndex, resolveDipAzimuthRows } from '../data/structuralOrientation.js';
import snapshotManifest from '../../visual-baselines/strip-log-manifest.json';

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
const CAPTURE_DEPTH_RANGE = [260, 300];

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

function snapshotKeyForNumericChart(chartType) {
  return `numeric-${chartType.replaceAll('+', '-')}`;
}

function SnapshotPanel({ snapshotKey, children }) {
  return (
    <div className="striplog-gallery__snapshot" data-snapshot-key={snapshotKey}>
      {children}
    </div>
  );
}

function cropHoleToDepthRange(hole, depthRange) {
  if (!hole) return null;
  const [start, end] = depthRange;
  const points = (hole.points || []).filter((point) => {
    const from = Number(point[FROM] ?? point.from ?? point.depth);
    const to = Number(point[TO] ?? point.to ?? point.depth);
    return Number.isFinite(from) && Number.isFinite(to) && to >= start && from <= end;
  });
  return {
    ...hole,
    id: hole.id || hole.holeId,
    holeId: hole.holeId || hole.id,
    points,
  };
}

function StandardStripLogSnapshot({ entry, template }) {
  return (
    <SnapshotPanel snapshotKey={entry.id}>
      <TracePlot
        config={entry.config}
        graph={entry.graph}
        holeOptions={[{ holeId: entry.config.holeId, label: entry.config.holeId }]}
        propertyOptions={entry.propertyOptions}
        onConfigChange={() => {}}
        template={template}
      />
    </SnapshotPanel>
  );
}

function ToolUiStripLogSnapshot({ entry }) {
  return (
    <SnapshotPanel snapshotKey={entry.id}>
      <BaselodeStripLogToolUI
        id={entry.id}
        title={entry.title}
        subtitle="TRK-241 GSWA fixture"
        hole={entry.hole}
        tracks={[entry.track]}
        height={420}
        propertyOptions={entry.propertyOptions}
        allowPropertySelection
        allowChartTypeSelection
      />
    </SnapshotPanel>
  );
}

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
  const captureMode = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('capture') === '1';

  useEffect(() => {
    document.documentElement.classList.toggle('striplog-snapshot-mode', captureMode);
    return () => document.documentElement.classList.remove('striplog-snapshot-mode');
  }, [captureMode]);

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
      const isMulti = isMultiPropertyChartType(option.value);
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

  const numericToggleVariants = useMemo(() => {
    if (!assayHole || !activeAssayProperty) return [];
    const points = buildIntervalPoints(assayHole, activeAssayProperty, false);
    return [
      {
        id: 'variant-graded-line',
        title: 'Graded line',
        description: 'line + graded: true',
        config: buildPlotConfig({
          points, isCategorical: false, property: activeAssayProperty,
          chartType: 'line', graded: true, template,
        }),
      },
      {
        id: 'variant-filled-line',
        title: 'Filled line',
        description: 'line + fillArea: true',
        config: buildPlotConfig({
          points, isCategorical: false, property: activeAssayProperty,
          chartType: 'line', fillArea: true, template,
        }),
      },
      {
        id: 'variant-stepped-line',
        title: 'Stepped line',
        description: 'line + stepped: true',
        config: buildPlotConfig({
          points, isCategorical: false, property: activeAssayProperty,
          chartType: 'line', stepped: true, template,
        }),
      },
    ];
  }, [assayHole, activeAssayProperty, template]);

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

  const standardSnapshotCases = useMemo(() => {
    const assayCaptureHole = cropHoleToDepthRange(assayHole, CAPTURE_DEPTH_RANGE);
    if (!assayCaptureHole || !activeAssayProperty) return [];

    const holeId = assayCaptureHole.id;
    const points = buildIntervalPoints(assayCaptureHole, activeAssayProperty, false);
    const multiSeries = multiTrackProperties
      .map((property) => ({ property, points: buildIntervalPoints(assayCaptureHole, property, false) }))
      .filter((series) => series.points.length);
    const numericGraph = {
      hole: assayCaptureHole,
      points,
      displayType: DISPLAY_NUMERIC,
      numericOptions: numericColumns,
      colorByOptions: [],
      propertyOptions: numericColumns,
      multiSeries,
      label: holeId,
    };
    const numericCases = CHART_OPTIONS[DISPLAY_NUMERIC].map((option) => ({
      id: `standard-${snapshotKeyForNumericChart(option.value)}`,
      title: option.label,
      config: {
        holeId,
        property: activeAssayProperty,
        chartType: option.value,
        multiProps: multiTrackProperties,
      },
      graph: numericGraph,
      propertyOptions: numericColumns,
    }));

    const geologyCapturePoints = lithologyPoints.map((point) => ({
      from: point.from,
      to: point.to,
      lithology: point.val,
    }));
    const geologyCaptureHole = {
      id: activeGeologyHoleId,
      holeId: activeGeologyHoleId,
      points: geologyCapturePoints,
    };
    const geologyGraph = {
      hole: geologyCaptureHole,
      points: buildIntervalPoints(geologyCaptureHole, 'lithology', true),
      displayType: DISPLAY_CATEGORICAL,
      isCategorical: true,
      propertyOptions: ['lithology'],
      numericOptions: [],
      colorByOptions: ['lithology'],
      label: activeGeologyHoleId,
    };

    const commentProperty = GEOLOGY_DESCRIPTION;
    const commentPoints = (geologyHole?.points || [])
      .map((point) => ({
        from: Number(point[FROM]),
        to: Number(point[TO]),
        [commentProperty]: point[commentProperty] || '',
      }))
      .filter((point) => Number.isFinite(point.from) && Number.isFinite(point.to) && point[commentProperty]);
    const commentGraph = {
      hole: geologyHole,
      points: commentPoints,
      displayType: DISPLAY_COMMENT,
      isComment: true,
      propertyOptions: [commentProperty],
      numericOptions: [],
      colorByOptions: [],
      label: activeGeologyHoleId,
    };

    const structureCaptureHole = {
      id: activeStructureHoleId,
      holeId: activeStructureHoleId,
      points: orientation.rows,
    };
    const structuralGraph = {
      hole: structureCaptureHole,
      points: orientation.rows,
      displayType: DISPLAY_TADPOLE,
      isTadpole: true,
      propertyOptions: ['dip'],
      numericOptions: [],
      colorByOptions: [],
      label: activeStructureHoleId,
    };

    const geophysicsId = geophysicsHole?.holeId || geophysicsHole?.id || '';
    const geophysicsGraph = {
      hole: geophysicsHole,
      points: buildIntervalPoints(geophysicsHole, activeGeophysicsChannel, false),
      displayType: DISPLAY_NUMERIC,
      propertyOptions: geophysicsChannels,
      numericOptions: geophysicsChannels,
      colorByOptions: [],
      label: geophysicsId,
    };

    return [
      ...numericCases,
      {
        id: 'standard-variant-graded-line',
        config: { holeId, property: activeAssayProperty, chartType: 'markers+line', colorBy: GRADED_COLOR_BY },
        graph: numericGraph,
        propertyOptions: numericColumns,
      },
      {
        id: 'standard-variant-filled-line',
        config: { holeId, property: activeAssayProperty, chartType: 'line', fillArea: true },
        graph: numericGraph,
        propertyOptions: numericColumns,
      },
      {
        id: 'standard-variant-stepped-line',
        config: { holeId, property: activeAssayProperty, chartType: 'line', stepped: true },
        graph: numericGraph,
        propertyOptions: numericColumns,
      },
      {
        id: 'standard-variant-log-scale',
        config: { holeId: geophysicsId, property: activeGeophysicsChannel, chartType: 'line', logScale: true },
        graph: geophysicsGraph,
        propertyOptions: geophysicsChannels,
      },
      {
        id: 'standard-categorical-patterns',
        config: { holeId: activeGeologyHoleId, property: 'lithology', chartType: 'categorical', usePatterns: true },
        graph: geologyGraph,
        propertyOptions: ['lithology'],
      },
      {
        id: 'standard-point-log',
        config: { holeId: activeGeologyHoleId, property: 'lithology', chartType: 'point-log' },
        graph: geologyGraph,
        propertyOptions: ['lithology'],
      },
      {
        id: 'standard-comments',
        config: { holeId: activeGeologyHoleId, property: commentProperty, chartType: 'comment' },
        graph: commentGraph,
        propertyOptions: [commentProperty],
      },
      {
        id: 'standard-annotations',
        config: { holeId: activeGeologyHoleId, property: commentProperty, chartType: 'annotations' },
        graph: commentGraph,
        propertyOptions: [commentProperty],
      },
      {
        id: 'standard-tadpole',
        config: { holeId: activeStructureHoleId, property: 'dip', chartType: 'tadpole' },
        graph: structuralGraph,
        propertyOptions: ['dip'],
      },
      {
        id: 'standard-dip-azimuth',
        config: { holeId: activeStructureHoleId, property: 'dip', chartType: 'dip-azimuth' },
        graph: structuralGraph,
        propertyOptions: ['dip'],
      },
    ];
  }, [
    activeAssayProperty,
    activeGeologyHoleId,
    activeGeophysicsChannel,
    activeStructureHoleId,
    assayHole,
    geologyHole,
    geophysicsChannels,
    geophysicsHole,
    lithologyPoints,
    multiTrackProperties,
    numericColumns,
    orientation.rows,
  ]);

  const toolUiSnapshotCases = useMemo(() => {
    const hole = cropHoleToDepthRange(assayHole, CAPTURE_DEPTH_RANGE);
    if (!hole || !activeAssayProperty) return [];
    const numericCases = CHART_OPTIONS[DISPLAY_NUMERIC].map((option) => ({
      id: `toolui-${snapshotKeyForNumericChart(option.value)}`,
      title: option.label,
      hole,
      propertyOptions: numericColumns,
      track: {
        id: option.value,
        property: activeAssayProperty,
        displayType: DISPLAY_NUMERIC,
        chartType: option.value,
        multiProps: multiTrackProperties,
      },
    }));
    const geologyCaptureHole = {
      id: activeGeologyHoleId,
      holeId: activeGeologyHoleId,
      points: lithologyPoints.map((point) => ({
        from: point.from,
        to: point.to,
        lithology: point.val,
      })),
    };
    return [
      ...numericCases,
      {
        id: 'toolui-variant-filled-line',
        title: 'Filled line',
        hole,
        propertyOptions: numericColumns,
        track: { id: 'filled-line', property: activeAssayProperty, chartType: 'line', fillArea: true },
      },
      {
        id: 'toolui-variant-stepped-line',
        title: 'Stepped line',
        hole,
        propertyOptions: numericColumns,
        track: { id: 'stepped-line', property: activeAssayProperty, chartType: 'line', stepped: true },
      },
      {
        id: 'toolui-variant-log-scale',
        title: 'Log scale',
        hole,
        propertyOptions: numericColumns,
        track: { id: 'log-scale', property: activeAssayProperty, chartType: 'line', logScale: true },
      },
      {
        id: 'toolui-categorical-patterns',
        title: 'Categorical patterns',
        hole: geologyCaptureHole,
        propertyOptions: ['lithology'],
        track: { id: 'categorical', property: 'lithology', displayType: DISPLAY_CATEGORICAL, chartType: 'categorical', usePatterns: true },
      },
      {
        id: 'toolui-point-log',
        title: 'Point log',
        hole: geologyCaptureHole,
        propertyOptions: ['lithology'],
        track: { id: 'point-log', property: 'lithology', displayType: DISPLAY_CATEGORICAL, chartType: 'point-log' },
      },
    ];
  }, [activeAssayProperty, activeGeologyHoleId, assayHole, lithologyPoints, multiTrackProperties, numericColumns]);

  const snapshotReady = !loading
    && numericVariants.length > 0
    && numericToggleVariants.length > 0
    && [
      logScaleConfig,
      categoricalConfig,
      twoCurveConfig,
      compositionConfig,
      pointLogConfig,
      depthAnnotationsConfig,
      dipAzimuthConfig,
      tadpoleConfig,
    ].every((config) => config.data?.length > 0);

  if (captureMode) {
    const renderedSnapshotIds = new Set([
      ...standardSnapshotCases.map((entry) => entry.id),
      ...toolUiSnapshotCases.map((entry) => entry.id),
    ]);
    const manifestCoverageReady = snapshotManifest.every((entry) => renderedSnapshotIds.has(entry.id));
    const productionReady = snapshotReady
      && standardSnapshotCases.length > 0
      && toolUiSnapshotCases.length > 0;
    return (
      <div
        className="striplog-gallery striplog-gallery--capture"
        data-snapshot-gallery-ready={productionReady ? 'true' : 'false'}
        data-snapshot-manifest-covered={manifestCoverageReady ? 'true' : 'false'}
      >
        <section className="striplog-gallery__capture-matrix" aria-label="Standard TracePlot snapshots">
          {standardSnapshotCases.map((entry) => (
            <StandardStripLogSnapshot key={entry.id} entry={entry} template={template} />
          ))}
        </section>
        <section className="striplog-gallery__capture-matrix" aria-label="Tool UI snapshots">
          {toolUiSnapshotCases.map((entry) => (
            <ToolUiStripLogSnapshot key={entry.id} entry={entry} />
          ))}
        </section>
      </div>
    );
  }

  return (
    <div
      className={`striplog-gallery ${useDarkTemplate ? 'striplog-gallery--dark' : ''} ${captureMode ? 'striplog-gallery--capture' : ''}`}
      data-snapshot-gallery-ready={snapshotReady ? 'true' : 'false'}
    >
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
                <SnapshotPanel key={option.value} snapshotKey={snapshotKeyForNumericChart(option.value)}>
                  <PlotPanel
                    title={option.label}
                    description={`chartType: '${option.value}'`}
                    data={config.data}
                    layout={config.layout}
                    height={VARIANT_PANEL_HEIGHT}
                  />
                </SnapshotPanel>
              ))}
              {numericToggleVariants.map((variant) => (
                <SnapshotPanel key={variant.id} snapshotKey={variant.id}>
                  <PlotPanel
                    title={variant.title}
                    description={variant.description}
                    data={variant.config.data}
                    layout={variant.config.layout}
                    height={VARIANT_PANEL_HEIGHT}
                  />
                </SnapshotPanel>
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
              <SnapshotPanel snapshotKey="variant-log-scale">
                <PlotPanel
                  title="Log scale"
                  description={`${activeGeophysicsChannel} · logarithmic value axis`}
                  data={logScaleConfig.data}
                  layout={logScaleConfig.layout}
                  height={SECTION_PANEL_HEIGHT}
                />
              </SnapshotPanel>
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
              <SnapshotPanel snapshotKey="categorical-patterns">
                <PlotPanel
                  title="Categorical bands + hatch patterns"
                  description="GSWA Lith1 condensed to Baselode lithology families"
                  data={categoricalConfig.data}
                  layout={categoricalConfig.layout}
                  height={SECTION_PANEL_HEIGHT}
                />
              </SnapshotPanel>
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
              <SnapshotPanel snapshotKey="two-curve-fill">
                <PlotPanel
                  title="Two-curve fill"
                  description={`${activeTwoCurveA} / ${activeTwoCurveB}`}
                  data={twoCurveConfig.data}
                  layout={twoCurveConfig.layout}
                  height={SECTION_PANEL_HEIGHT}
                />
              </SnapshotPanel>
            </section>

            <section className="striplog-gallery__section">
              <h2>Composition (synthetic)</h2>
              <p>
                <code>buildCompositionConfig</code> — synthetic composition demo:{' '}
                {compositionProperties.join(' / ') || 'assay'} values normalised to
                fractions of their per-interval sum. The GSWA sample carries no
                true modal composition data.
              </p>
              <SnapshotPanel snapshotKey="composition-normalized">
                <PlotPanel
                  title="Composition"
                  description={`${compositionProperties.join(' / ')} · normalized`}
                  data={compositionConfig.data}
                  layout={compositionConfig.layout}
                  height={SECTION_PANEL_HEIGHT}
                />
              </SnapshotPanel>
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
              <SnapshotPanel snapshotKey="structural-point-log">
                <PlotPanel
                  title="Point log"
                  description="buildPointLogConfig — defect type by depth"
                  data={pointLogConfig.data}
                  layout={pointLogConfig.layout}
                  height={SECTION_PANEL_HEIGHT}
                />
              </SnapshotPanel>
              <SnapshotPanel snapshotKey="structural-depth-annotations">
                <PlotPanel
                  title="Depth annotations"
                  description="buildDepthAnnotationsConfig — logged descriptions pinned to depth"
                  data={depthAnnotationsConfig.data}
                  layout={depthAnnotationsConfig.layout}
                  height={SECTION_PANEL_HEIGHT}
                />
              </SnapshotPanel>
              <SnapshotPanel snapshotKey="structural-dip-azimuth">
                <PlotPanel
                  title="Dip / azimuth"
                  description="buildDipAzimuthConfig — split dip + azimuth tracks"
                  data={dipAzimuthConfig.data}
                  layout={dipAzimuthConfig.layout}
                  height={SECTION_PANEL_HEIGHT}
                />
              </SnapshotPanel>
              <SnapshotPanel snapshotKey="structural-tadpole">
                <PlotPanel
                  title="Tadpole"
                  description="buildTadpoleConfig — dip head + azimuth tail, coloured by defect"
                  data={tadpoleConfig.data}
                  layout={tadpoleConfig.layout}
                  height={SECTION_PANEL_HEIGHT}
                />
              </SnapshotPanel>
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
