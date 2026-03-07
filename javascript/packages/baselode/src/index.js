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
  STRIKE,
  GEOLOGY_CODE,
  GEOLOGY_DESCRIPTION,
  BASELODE_DATA_MODEL_DRILL_COLLAR,
  BASELODE_DATA_MODEL_DRILL_SURVEY,
  BASELODE_DATA_MODEL_DRILL_ASSAY,
  BASELODE_DATA_MODEL_DRILL_GEOLOGY,
  BASELODE_DATA_MODEL_STRUCTURAL_POINT,
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
  reorderHoleIds,
  deriveAssayProps,
  loadAssayMetadata,
  loadAssayHole,
  buildAssayState,
  loadAssayFile
} from './data/assayDataLoader.js';

export {
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
  loadGeology,
  joinAssaysToTraces,
  filterByProject,
  coerceNumeric,
  assembleDataset
} from './data/datasetLoader.js';

export {
  parseBlockModelCSV,
  normalizeBlockRow,
  loadBlockModelMetadata,
  calculatePropertyStats,
  getBlockStats,
  filterBlocks,
  calculateBlockVolume,
  getColorForValue
} from './data/blockModelLoader.js';

export {
  parseStructuralPointsCSV,
  parseStructuralIntervalsCSV,
  parseStructuralCSV,
  validateStructuralPoints,
  groupRowsByHole
} from './data/structuralLoader.js';

export {
  parseAssayCsvTextToHoles,
  parseGeologyCsvText,
  parseUnifiedDataset
} from './data/unifiedLoader.js';

export {
  interpolateTrace,
  alphaBetaToNormal,
  computeStructuralPositions
} from './data/structuralPositions.js';

// --- Column metadata ---
export {
  DISPLAY_NUMERIC,
  DISPLAY_CATEGORICAL,
  DISPLAY_COMMENT,
  DISPLAY_HIDDEN,
  DISPLAY_TADPOLE,
  CHART_OPTIONS,
  HIDDEN_COLUMNS,
  COMMENT_COLUMN_NAMES,
  classifyColumns,
  getChartOptions,
  defaultChartType
} from './data/columnMeta.js';

// --- Visualization layer ---
export {
  NUMERIC_LINE_COLOR,
  NUMERIC_MARKER_COLOR,
  ERROR_COLOR,
  holeHasData,
  buildIntervalPoints,
  buildPlotConfig,
  buildCategoricalStripLogConfig
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
  buildTadpoleConfig,
  buildStructuralStripConfig,
  buildCommentsConfig,
  buildStrikeDipSymbol
} from './viz/structuralViz.js';

export {
  dipAzimuthToNormal,
  buildStructuralDiscs
} from './viz/structuralScene.js';

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
  setControlMode,
  setFov,
  FOV_MIN_DEG,
  FOV_MAX_DEG
} from './viz/baselode3dCameraControls.js';

export {
  getCategoryHexColor,
} from './viz/drillholeScene.js';

export { default as Baselode3DScene } from './viz/baselode3dScene.js';
export { default as Baselode3DControls } from './viz/Baselode3DControls.jsx';
export { default as BlockModelWidget } from './viz/BlockModelWidget.jsx';

// --- Grade blocks ---
export {
  loadGradeBlocksFromJson,
  gradeBlockToThreeGeometry,
  addGradeBlocksToScene,
} from './grade_blocks/gradeBlockLoader.js';

export { SectionHelper } from './viz/helpers/SectionHelper.js';
export { SliceHelper } from './viz/helpers/SliceHelper.js';
