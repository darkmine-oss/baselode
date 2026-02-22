/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { withDataErrorContext } from './dataErrorUtils.js';
import { standardizeColumns as standardizeRow } from './keying.js';
import {
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
  GEOLOGY_CODE,
  GEOLOGY_DESCRIPTION,
  BASELODE_DATA_MODEL_DRILL_COLLAR,
  BASELODE_DATA_MODEL_DRILL_SURVEY,
  BASELODE_DATA_MODEL_DRILL_ASSAY,
  BASELODE_DATA_MODEL_DRILL_GEOLOGY
} from './datamodel.js';

// Re-export for backwards compatibility
export { DEFAULT_COLUMN_MAP } from './datamodel.js';

/**
 * Convert source to array
 * @private
 */
function toArray(source) {
  if (!source) return [];
  if (Array.isArray(source)) return [...source];
  return [];
}

/**
 * Convert value to finite number or undefined
 * @private
 */
function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Sort rows by multiple columns
 * @private
 */
function sortByColumns(rows = [], columns = []) {
  const out = [...rows];
  out.sort((a, b) => {
    for (let i = 0; i < columns.length; i += 1) {
      const col = columns[i];
      const av = a?.[col];
      const bv = b?.[col];
      if (av === bv) continue;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return av - bv;
      return `${av}`.localeCompare(`${bv}`);
    }
    return 0;
  });
  return out;
}

function validateNoOverlappingIntervals(rows = [], label = 'Intervals') {
  if (!rows.length) return;
  const ordered = sortByColumns(rows, [HOLE_ID, FROM, TO]);
  const prevToByHole = new Map();

  ordered.forEach((row) => {
    const holeId = `${row?.[HOLE_ID] ?? ''}`.trim();
    const fromValue = Number(row?.[FROM]);
    const toValue = Number(row?.[TO]);
    if (!holeId || !Number.isFinite(fromValue) || !Number.isFinite(toValue)) return;

    const prevTo = prevToByHole.get(holeId);
    if (Number.isFinite(prevTo) && fromValue < prevTo) {
      throw withDataErrorContext(
        'validateNoOverlappingIntervals',
        new Error(`${label} intervals overlap for hole '${holeId}': from=${fromValue} is less than previous to=${prevTo}`)
      );
    }
    prevToByHole.set(holeId, toValue);
  });
}

/**
 * Parse CSV data using PapaParse
 * @private
 */
function parseCsv(source, papaParseConfig = {}) {
  return new Promise((resolve, reject) => {
    Papa.parse(source, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      ...papaParseConfig,
      complete: (results) => resolve(Array.isArray(results?.data) ? results.data : []),
      error: (error) => reject(withDataErrorContext('loadTable(csv)', error))
    });
  });
}

/**
 * Standardize column names in an array of rows using the baselode data model
 * @param {Array<Object>} rows - Array of row objects
 * @param {Object} [columnMap] - Optional column map (unused, for backwards compatibility)
 * @param {Object} [sourceColumnMap] - Optional source column map for user-provided mappings
 * @returns {Array<Object>} - Array of rows with standardized column names
 */
export function standardizeColumns(rows = [], columnMap = null, sourceColumnMap = null) {
  return rows.map((row) => standardizeRow(row, columnMap, sourceColumnMap));
}

export async function loadTable(source, options = {}) {
  const {
    kind = 'csv',
    columnMap = null,
    sourceColumnMap = null,
    papaParseConfig = {}
  } = options;

  let rows;
  if (Array.isArray(source)) {
    rows = toArray(source);
  } else if (kind === 'csv') {
    rows = await parseCsv(source, papaParseConfig);
  } else if (kind === 'parquet' || kind === 'sql') {
    throw withDataErrorContext('loadTable', new Error(`Unsupported kind in JS runtime: ${kind}`));
  } else {
    throw withDataErrorContext('loadTable', new Error(`Unsupported kind: ${kind}`));
  }

  return standardizeColumns(rows, columnMap, sourceColumnMap);
}

/**
 * Load and validate drillhole collar data
 * Requires hole_id and coordinates (either lat/lng or easting/northing)
 * @param {File|Blob|Array<Object>|string} source - Collar data source
 * @param {Object} options - Loading options
 * @param {string} options.crs - Coordinate reference system (optional)
 * @param {Object} options.sourceColumnMap - Optional user-provided column mappings
 * @param {boolean} options.keepAll - Keep all columns (default: true)
 * @returns {Promise<Array<Object>>} Array of validated collar rows
 * @throws {Error} If required columns or values are missing
 */
export async function loadCollars(source, options = {}) {
  const {
    crs = null,
    sourceColumnMap = null,
    keepAll = true,
    ...tableOptions
  } = options;
  
  const standardized = await loadTable(source, { ...tableOptions, sourceColumnMap });

  // Check for hole_id
  const hasHoleId = standardized.some(row => HOLE_ID in row);
  if (!hasHoleId) {
    throw withDataErrorContext('loadCollars', new Error(`Collar table missing column: ${HOLE_ID}`));
  }

  // Check for required coordinate columns
  const hasXY = standardized.some(row => EASTING in row && NORTHING in row);
  const hasLatLon = standardized.some(row => LATITUDE in row && LONGITUDE in row);

  if (!hasXY && !hasLatLon) {
    throw withDataErrorContext('loadCollars', new Error('Collar table missing coordinate columns (need easting/northing or latitude/longitude)'));
  }

  const normalized = standardized.map((row) => {
    const result = { ...row };
    
    // Ensure hole_id is a string
    if (HOLE_ID in result) {
      const val = result[HOLE_ID];
      result[HOLE_ID] = val === undefined || val === null ? '' : `${val}`.trim();
    }
    
    // Convert coordinates to numbers
    if (LATITUDE in result) result[LATITUDE] = toNumber(result[LATITUDE]);
    if (LONGITUDE in result) result[LONGITUDE] = toNumber(result[LONGITUDE]);
    if (ELEVATION in result) result[ELEVATION] = toNumber(result[ELEVATION]);
    if (EASTING in result) result[EASTING] = toNumber(result[EASTING]);
    if (NORTHING in result) result[NORTHING] = toNumber(result[NORTHING]);

    // If datasource_hole_id is missing, copy from hole_id
    if (!('datasource_hole_id' in result) && HOLE_ID in result) {
      result.datasource_hole_id = result[HOLE_ID];
    }

    return result;
  });

  // Validate required fields
  const required = normalized.every((row) => {
    if (!row[HOLE_ID]) return false;
    if (hasLatLon && (!Number.isFinite(row[LATITUDE]) || !Number.isFinite(row[LONGITUDE]))) {
      return false;
    }
    if (hasXY && !hasLatLon && (!Number.isFinite(row[EASTING]) || !Number.isFinite(row[NORTHING]))) {
      return false;
    }
    return true;
  });

  if (!required) {
    throw withDataErrorContext('loadCollars', new Error('Collar table has missing required values'));
  }

  return normalized;
}

/**
 * Load and validate drillhole survey data
 * Requires hole_id, depth, azimuth, and dip columns
 * @param {File|Blob|Array<Object>|string} source - Survey data source
 * @param {Object} options - Loading options
 * @param {Object} options.sourceColumnMap - Optional user-provided column mappings
 * @param {boolean} options.keepAll - Keep all columns (default: true)
 * @returns {Promise<Array<Object>>} Array of validated survey rows, sorted by hole_id and depth
 * @throws {Error} If required columns or values are missing
 */
export async function loadSurveys(source, options = {}) {
  const {
    sourceColumnMap = null,
    keepAll = true,
    ...tableOptions
  } = options;
  
  const standardized = await loadTable(source, { ...tableOptions, sourceColumnMap });

  // Validate required columns
  const required = [HOLE_ID, DEPTH, AZIMUTH, DIP];
  for (const col of required) {
    const hasColumn = standardized.some(row => col in row);
    if (!hasColumn) {
      throw withDataErrorContext('loadSurveys', new Error(`Survey table missing column: ${col}`));
    }
  }

  const normalized = standardized.map((row) => {
    const result = { ...row };
    
    // Ensure hole_id is a string
    if (HOLE_ID in result) {
      const val = result[HOLE_ID];
      result[HOLE_ID] = val === undefined || val === null ? '' : `${val}`.trim();
    }
    
    // Convert numeric fields
    if (DEPTH in result) result[DEPTH] = toNumber(result[DEPTH]);
    if (TO in result) result[TO] = toNumber(result[TO]);
    if (AZIMUTH in result) result[AZIMUTH] = toNumber(result[AZIMUTH]);
    if (DIP in result) result[DIP] = toNumber(result[DIP]);
    
    return result;
  });

  // Validate required values
  const allValid = normalized.every((row) => {
    if (!row[HOLE_ID]) return false;
    if (!Number.isFinite(row[DEPTH])) return false;
    if (!Number.isFinite(row[AZIMUTH])) return false;
    if (!Number.isFinite(row[DIP])) return false;
    return true;
  });

  if (!allValid) {
    throw withDataErrorContext('loadSurveys', new Error('Survey table has missing required values'));
  }

  return sortByColumns(normalized, [HOLE_ID, DEPTH]);
}

/**
 * Load and validate assay/interval data
 * Requires hole_id, from, and to columns. Calculates mid depth automatically.
 * @param {File|Blob|Array<Object>|string} source - Assay data source
 * @param {Object} options - Loading options
 * @param {Object} options.sourceColumnMap - Optional user-provided column mappings
 * @param {boolean} options.keepAll - Keep all columns (default: true)
 * @returns {Promise<Array<Object>>} Array of validated assay rows, sorted by hole_id, from, to
 * @throws {Error} If required columns or values are missing
 */
export async function loadAssays(source, options = {}) {
  const {
    sourceColumnMap = null,
    keepAll = true,
    ...tableOptions
  } = options;
  
  const standardized = await loadTable(source, { ...tableOptions, sourceColumnMap });

  // Validate required columns
  const required = [HOLE_ID, FROM, TO];
  for (const col of required) {
    const hasColumn = standardized.some(row => col in row);
    if (!hasColumn) {
      throw withDataErrorContext('loadAssays', new Error(`Assay table missing column: ${col}`));
    }
  }

  const normalized = standardized.map((row) => {
    const result = { ...row };
    
    // Ensure hole_id is a string
    if (HOLE_ID in result) {
      const val = result[HOLE_ID];
      result[HOLE_ID] = val === undefined || val === null ? '' : `${val}`.trim();
    }
    
    // Convert numeric fields
    if (FROM in result) result[FROM] = toNumber(result[FROM]);
    if (TO in result) result[TO] = toNumber(result[TO]);
    
    // Calculate midpoint
    if (FROM in result && TO in result && Number.isFinite(result[FROM]) && Number.isFinite(result[TO])) {
      result[MID] = 0.5 * (result[FROM] + result[TO]);
    }
    
    return result;
  });

  // Validate required values
  const allValid = normalized.every((row) => {
    if (!row[HOLE_ID]) return false;
    if (!Number.isFinite(row[FROM])) return false;
    if (!Number.isFinite(row[TO])) return false;
    if (!(row[TO] > row[FROM])) return false;
    return true;
  });

  if (!allValid) {
    throw withDataErrorContext('loadAssays', new Error('Assay table has missing required values'));
  }

  return sortByColumns(normalized, [HOLE_ID, FROM, TO]);
}

/**
 * Load and validate geology interval data for categorical strip-log plotting.
 * Requires hole_id, from, to and at least one geology categorical field.
 * @param {File|Blob|Array<Object>|string} source - Geology data source
 * @param {Object} options - Loading options
 * @param {Object} options.sourceColumnMap - Optional user-provided column mappings
 * @returns {Promise<Array<Object>>} Array of validated geology rows, sorted by hole_id, from, to
 */
export async function loadGeology(source, options = {}) {
  const {
    sourceColumnMap = null,
    keepAll = true,
    ...tableOptions
  } = options;

  const standardized = await loadTable(source, { ...tableOptions, sourceColumnMap });

  const required = [HOLE_ID, FROM, TO];
  for (const col of required) {
    const hasColumn = standardized.some((row) => col in row);
    if (!hasColumn) {
      throw withDataErrorContext('loadGeology', new Error(`Geology table missing column: ${col}`));
    }
  }

  const normalized = standardized.map((row) => {
    const result = { ...row };

    if (HOLE_ID in result) {
      const val = result[HOLE_ID];
      result[HOLE_ID] = val === undefined || val === null ? '' : `${val}`.trim();
    }

    if (FROM in result) result[FROM] = toNumber(result[FROM]);
    if (TO in result) result[TO] = toNumber(result[TO]);

    if (FROM in result && TO in result && Number.isFinite(result[FROM]) && Number.isFinite(result[TO])) {
      result[MID] = 0.5 * (result[FROM] + result[TO]);
    }

    const hasCode = result[GEOLOGY_CODE] !== undefined && result[GEOLOGY_CODE] !== null && `${result[GEOLOGY_CODE]}`.trim() !== '';
    const hasDescription = result[GEOLOGY_DESCRIPTION] !== undefined && result[GEOLOGY_DESCRIPTION] !== null && `${result[GEOLOGY_DESCRIPTION]}`.trim() !== '';
    if (!hasCode && hasDescription) {
      result[GEOLOGY_CODE] = result[GEOLOGY_DESCRIPTION];
    }
    if (hasCode && !hasDescription) {
      result[GEOLOGY_DESCRIPTION] = result[GEOLOGY_CODE];
    }

    return result;
  });

  const allValid = normalized.every((row) => {
    if (!row[HOLE_ID]) return false;
    if (!Number.isFinite(row[FROM])) return false;
    if (!Number.isFinite(row[TO])) return false;
    return true;
  });

  if (!allValid) {
    throw withDataErrorContext('loadGeology', new Error('Geology table has missing required values'));
  }

  const hasCategory = normalized.some((row) => {
    const code = row[GEOLOGY_CODE];
    const description = row[GEOLOGY_DESCRIPTION];
    return (code !== undefined && code !== null && `${code}`.trim() !== '') ||
      (description !== undefined && description !== null && `${description}`.trim() !== '');
  });

  if (!hasCategory) {
    throw withDataErrorContext('loadGeology', new Error(`Geology table missing categorical columns: ${GEOLOGY_CODE} or ${GEOLOGY_DESCRIPTION}`));
  }

  validateNoOverlappingIntervals(normalized, 'Geology');

  if (!keepAll) {
    const keep = new Set(Object.keys(BASELODE_DATA_MODEL_DRILL_GEOLOGY));
    return sortByColumns(
      normalized.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => keep.has(k)))),
      [HOLE_ID, FROM, TO]
    );
  }

  return sortByColumns(normalized, [HOLE_ID, FROM, TO]);
}

/**
 * Join assay data to desurveyed trace data by matching key columns
 * Adds trace fields to assay rows, suffixing with '_trace' if field already exists
 * @param {Array<Object>} assays - Array of assay rows
 * @param {Array<Object>} traces - Array of trace/desurvey rows
 * @param {Object} options - Join options
 * @param {Array<string>} options.onCols - Columns to join on (default: [hole_id])
 * @returns {Array<Object>} Assay rows enriched with trace data
 */
export function joinAssaysToTraces(assays = [], traces = [], options = {}) {
  const onCols = Array.isArray(options.onCols) && options.onCols.length ? options.onCols : [HOLE_ID];
  if (!traces.length) return [...assays];

  const keyOf = (row) => onCols.map((col) => `${row?.[col] ?? ''}`).join('|');
  const tracesByKey = new Map();
  traces.forEach((trace) => {
    tracesByKey.set(keyOf(trace), trace);
  });

  return assays.map((assay) => {
    const trace = tracesByKey.get(keyOf(assay));
    if (!trace) return { ...assay };
    const merged = { ...assay };
    Object.entries(trace).forEach(([key, value]) => {
      if (onCols.includes(key)) return;
      if (Object.prototype.hasOwnProperty.call(merged, key)) {
        merged[`${key}_trace`] = value;
      } else {
        merged[key] = value;
      }
    });
    return merged;
  });
}

/**
 * Filter rows by project ID
 * @param {Array<Object>} rows - Array of rows with project_id field
 * @param {string|null} projectId - Project ID to filter by (null returns all rows)
 * @returns {Array<Object>} Filtered rows
 */
export function filterByProject(rows = [], projectId = null) {
  if (projectId === null || projectId === undefined) return [...rows];
  if (!rows.length) return [];
  
  // Check if rows have project_id column
  const hasProjectId = rows.some(row => PROJECT_ID in row);
  if (!hasProjectId) return [...rows];
  
  return rows.filter((row) => row?.[PROJECT_ID] === projectId);
}

/**
 * Coerce specified columns to numeric (finite number or undefined)
 * @param {Array<Object>} rows - Array of rows
 * @param {Array<string>} columns - Column names to coerce to numeric
 * @returns {Array<Object>} Rows with coerced numeric columns
 */
export function coerceNumeric(rows = [], columns = []) {
  return rows.map((row) => {
    const next = { ...row };
    columns.forEach((column) => {
      if (!(column in next)) return;
      const n = toNumber(next[column]);
      next[column] = n;
    });
    return next;
  });
}

/**
 * Assemble a complete drillhole dataset from component tables
 * @param {Object} components - Dataset components
 * @param {Array<Object>} components.collars - Collar data
 * @param {Array<Object>} components.surveys - Survey data
 * @param {Array<Object>} components.assays - Assay data
 * @param {Array<Object>} components.geology - Geology interval data
 * @param {Array<Object>} components.structures - Structural data (optional)
 * @param {Object} components.metadata - Dataset metadata (optional)
 * @returns {{collars: Array, surveys: Array, assays: Array, geology: Array, structures: Array, metadata: Object}} Complete dataset
 */
export function assembleDataset({
  collars = [],
  surveys = [],
  assays = [],
  geology = [],
  structures = [],
  metadata = {}
} = {}) {
  return {
    collars: toArray(collars),
    surveys: toArray(surveys),
    assays: toArray(assays),
    geology: toArray(geology),
    structures: toArray(structures),
    metadata: metadata || {}
  };
}