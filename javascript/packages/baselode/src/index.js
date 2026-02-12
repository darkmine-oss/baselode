/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// --- Data layer ---
export {
  normalizeFieldName,
  primaryFieldFromConfig,
  resolvePrimaryId,
  buildPrimaryKeyedRow
} from './data/keying.js';

export {
  parseAssayHoleIds,
  parseAssayHoleIdsWithAssays,
  parseAssayHole,
  parseAssaysCSV
} from './data/assayLoader.js';

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
  parseDrillholesCSV
} from './data/drillholeLoader.js';

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
  buildIntervalPoints,
  buildPlotConfig
} from './viz/drillholeViz.js';

export { default as Baselode3DScene } from './viz/baselode3dScene.js';
export { default as Baselode3DControls } from './viz/Baselode3DControls.jsx';
