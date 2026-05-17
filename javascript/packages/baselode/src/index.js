/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// --- Data model ---
export {
  // Drilling and sampling primitives
  DATASOURCE,
  HOLE_ID,
  COLLAR_ID,
  DATASOURCE_HOLE_ID,
  HOLE_TYPE,
  MAX_DEPTH,
  SURFACE_SAMPLE_ID,
  SURFACE_SAMPLE_TYPE,
  DATASOURCE_SURFACE_SAMPLE_ID,
  PROJECT_ID,
  REPORT_NUMBER,
  // Collar / surface-sample locations
  LATITUDE,
  LONGITUDE,
  ELEVATION,
  EASTING,
  NORTHING,
  CRS,
  DATE_START,
  DATE_END,
  // Drilling survey primitives
  AZIMUTH,
  DIP,
  SURVEY_TYPE,
  // Sampling primitives
  SAMPLE_ID,
  DATASOURCE_SAMPLE_ID,
  FROM,
  TO,
  MID,
  DEPTH,
  // Structural geology primitives
  STRIKE,
  ALPHA,
  BETA,
  GEOLOGY_CODE,
  GEOLOGY_DESCRIPTION,
  // Generics
  COMMENTS,
  EXTRA,
  // Constants and defaults
  GEOPHYSICS_NULL,
  GEOPHYSICS_NULL_SENTINEL,
  // Schemas
  BASELODE_DATA_MODEL_DRILL_COLLAR,
  BASELODE_DATA_MODEL_DRILL_SURVEY,
  BASELODE_DATA_MODEL_DRILL_ASSAY,
  BASELODE_DATA_MODEL_DRILL_GEOLOGY,
  BASELODE_DATA_MODEL_STRUCTURAL_POINT,
  BASELODE_DATA_MODEL_GEOPHYSICS,
  BASELODE_DATA_MODEL_SURFACE_SAMPLE,
  // Column-name normalisation
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
  significantIntercepts
} from './data/intercepts.js';

export {
  parseGeophysicsCSV,
  geophysicsToStripLogs,
} from './data/geophysicsLoader.js';

export {
  parseLasFile,
} from './data/lasLoader.js';

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
  BASELODE_TEMPLATE_NAME,
  BASELODE_TEMPLATE,
  BASELODE_COLORWAY,
  BASELODE_LIGHT,
  BASELODE_LIGHT_TEMPLATE_NAME,
  BASELODE_LIGHT_TEMPLATE,
} from './viz/baselodeTemplate.js';

export {
  BASELODE_DARK,
  BASELODE_DARK_TEMPLATE_NAME,
  BASELODE_DARK_TEMPLATE,
} from './viz/baselodeDarkTemplate.js';

export {
  NUMERIC_LINE_COLOR,
  NUMERIC_MARKER_COLOR,
  ERROR_COLOR,
  holeHasData,
  buildIntervalPoints,
  buildPlotConfig,
  buildCategoricalStripLogConfig
} from './viz/drillholeViz.js';

export {
  DEFAULT_UNIT_COLUMN,
  DEFAULT_ATTRIBUTE_COLUMN,
  formatPropertyLabel,
  resolvePropertyLabelParts,
  derivePropertyMeta
} from './data/propertyLabels.js';

export { default as TracePlot } from './viz/TracePlot.jsx';
export { default as useDrillholeTraceGrid } from './viz/useDrillholeTraceGrid.jsx';

export {
  ASSAY_COLOR_PALETTE_10,
  buildEqualRangeColorScale,
  getEqualRangeBinIndex,
  getEqualRangeColor
} from './viz/assayColorScale.js';

export {
  FALLBACK_COLOUR,
  COMMODITY_COLOURS,
  LITHOLOGY_COLOURS,
  BUILTIN_COLOUR_MAPS,
  getColour,
  resolveColourMap
} from './viz/colourMap.js';

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
  createRasterOverlay,
  normalizeBounds,
  addRasterOverlay,
  removeRasterOverlay,
  setRasterOverlayOpacity,
  setRasterOverlayVisibility,
  setRasterOverlayElevation,
  getRasterOverlay,
  listRasterOverlays,
  clearRasterOverlays,
} from './viz/rasterOverlayScene.js';

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

export {
  STRIP_LOG_DEFAULT_PANEL_WIDTH,
  STRIP_LOG_DEFAULT_LATERAL_OFFSET,
  STRIP_LOG_DEFAULT_COLOR,
  normalizeStripLogOptions,
  getHoleVerticalExtent,
  buildStripLogLinePoints,
  buildStripLogGroup,
  setStripLogs,
  clearStripLogs,
} from './viz/stripLogScene.js';

export { default as Baselode3DScene } from './viz/baselode3dScene.js';
export { default as Baselode3DControls } from './viz/Baselode3DControls.jsx';
export { default as BlockModelWidget } from './viz/BlockModelWidget.jsx';

export {
  DEFAULT_LOD_BREAKPOINTS,
  BASE_PIXELS_PER_METRE,
  selectPhotoLodUrl,
  sortPhotosByDepth,
  groupPhotosBySet,
  buildDepthMarkers,
  depthMarkerInterval,
  depthIntervalToPixels,
  buildTrayPhotos,
  defaultTrayFilename,
} from './viz/corePhotoViz.js';

export { default as CorePhotoTable } from './viz/CorePhotoTable.jsx';
export { CorePhotoViewer } from './viz/CorePhotoViewer.jsx';

// --- Grade blocks ---
export {
  loadGradeBlocksFromJson,
  gradeBlockToThreeGeometry,
  addGradeBlocksToScene,
} from './grade_blocks/gradeBlockLoader.js';
