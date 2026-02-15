/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// --- Data model ---
export {
  HOLE_ID,
  LATITUDE,
  LONGITUDE,
  ELEVATION,
  AZIMUTH,
  DIP,
  FROM,
  TO,
  MID,
  PROJECT_ID,
  EASTING,
  NORTHING,
  CRS,
  DEPTH,
  BASELODE_DATA_MODEL_DRILL_COLLAR,
  BASELODE_DATA_MODEL_DRILL_SURVEY,
  BASELODE_DATA_MODEL_DRILL_ASSAY,
  DEFAULT_COLUMN_MAP
} from './data/datamodel.js';

// --- Data layer ---
export {
  normalizeFieldName,
  standardizeColumns,
  standardizeRowArray
} from './data/keying.js';

export {
  parseAssayHoleIds,
  parseAssayHoleIdsWithAssays,
  parseAssayHole,
  parseAssaysCSV
} from './data/assayLoader.js';

export {
  normalizeCsvRow,
  pickFirstPresent
} from './data/csvRowUtils.js';

export {
  toError,
  withDataErrorContext,
  logDataWarning,
  logDataInfo
} from './data/dataErrorUtils.js';

export {
  ASSAY_NON_VALUE_FIELDS
} from './data/assayFieldSets.js';

export {
  ASSAY_CACHE_KEY,
  ASSAY_CACHE_META_KEY,
  reorderHoleIds,
  deriveAssayProps,
  loadAssayMetadata,
  loadAssayHole,
  buildAssayState,
  loadAssayFile,
  loadCachedAssayState,
  loadCachedAssayMeta,
  saveAssayCache,
  clearAssayCache
} from './data/assayDataLoader.js';

export {
  loadCachedCollars,
  saveCachedSurvey,
  loadCachedSurvey,
  saveCachedDesurveyed,
  loadCachedDesurveyed,
  parseSurveyCSV,
  desurveyTraces
} from './data/desurvey.js';

export {
  minimumCurvatureDesurvey,
  tangentialDesurvey,
  balancedTangentialDesurvey,
  attachAssayPositions,
  buildTraces
} from './data/desurveyMethods.js';

export {
  parseDrillholesCSV
} from './data/drillholeLoader.js';

export {
  loadTable,
  loadCollars,
  loadSurveys,
  loadAssays,
  joinAssaysToTraces,
  filterByProject,
  coerceNumeric,
  assembleDataset
} from './data/datasetLoader.js';

export {
  parseBlockModelCSV,
  calculatePropertyStats,
  getColorForValue
} from './data/blockModelLoader.js';

// --- Visualization layer ---
export {
  NUMERIC_LINE_COLOR,
  NUMERIC_MARKER_COLOR,
  ERROR_COLOR,
  holeHasData,
  buildIntervalPoints,
  buildPlotConfig
} from './viz/drillholeViz.js';

export { default as TracePlot } from './viz/TracePlot.jsx';
export { default as useDrillholeTraceGrid } from './viz/useDrillholeTraceGrid.jsx';

export {
  ASSAY_COLOR_PALETTE_10,
  buildEqualRangeColorScale,
  getEqualRangeBinIndex,
  getEqualRangeColor
} from './viz/assayColorScale.js';

export {
  projectTraceToSection,
  sectionWindow,
  planView,
  sectionView
} from './viz/view2d.js';

export {
  tracesAsSegments,
  intervalsAsTubes,
  annotationsFromIntervals
} from './viz/view3dPayload.js';

export {
  buildViewSignature,
  getViewState,
  setViewState,
  emitViewChangeIfNeeded,
  fitCameraToBounds,
  recenterCameraToOrigin,
  lookDown,
  pan,
  dolly,
  focusOnLastBounds,
  setControlMode
} from './viz/baselode3dCameraControls.js';

export { default as Baselode3DScene } from './viz/baselode3dScene.js';
export { default as Baselode3DControls } from './viz/Baselode3DControls.jsx';
