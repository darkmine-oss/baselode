/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { withDataErrorContext } from './dataErrorUtils.js';
import { normalizeFieldName } from './keying.js';

export const DEFAULT_COLUMN_MAP = {
  holeid: 'hole_id',
  hole_id: 'hole_id',
  collarid: 'collar_id',
  collar_id: 'collar_id',
  companyholeid: 'company_hole_id',
  company_hole_id: 'company_hole_id',
  project: 'project_id',
  projectid: 'project_id',
  project_id: 'project_id',
  project_code: 'project_code',
  from: 'from',
  to: 'to',
  depth_from: 'from',
  depth_to: 'to',
  fromdepth: 'from',
  todepth: 'to',
  samp_from: 'from',
  samp_to: 'to',
  sample_from: 'from',
  sample_to: 'to',
  easting: 'x',
  northing: 'y',
  surveydepth: 'from',
  depth: 'from',
  latitude: 'lat',
  lat: 'lat',
  longitude: 'lon',
  lon: 'lon',
  elevation: 'z',
  rl: 'z',
  azimuth: 'azimuth',
  dip: 'dip',
  declination: 'declination'
};

function toArray(source) {
  if (!source) return [];
  if (Array.isArray(source)) return [...source];
  return [];
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

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

function resolveHoleIdColumn(rows = [], requestedHoleIdCol = 'hole_id') {
  const requested = normalizeFieldName(requestedHoleIdCol || 'hole_id');
  const alias = DEFAULT_COLUMN_MAP[requested] || requested;
  const columns = new Set(rows.flatMap((row) => Object.keys(row || {})));

  if (columns.has(requested)) return requested;
  if (columns.has(alias)) return alias;
  if (columns.has('hole_id')) return 'hole_id';

  throw new Error(`hole id column '${requestedHoleIdCol}' not found; available: ${Array.from(columns).join(', ')}`);
}

export function standardizeColumns(rows = [], columnMap = DEFAULT_COLUMN_MAP) {
  return rows.map((row) => {
    const standardized = {};
    Object.entries(row || {}).forEach(([key, value]) => {
      const normalized = normalizeFieldName(key);
      const renamed = columnMap?.[normalized] || normalized;
      standardized[renamed] = value;
    });
    return standardized;
  });
}

export async function loadTable(source, options = {}) {
  const {
    kind = 'csv',
    columnMap = DEFAULT_COLUMN_MAP,
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

  return standardizeColumns(rows, columnMap);
}

function canonicalizeHoleId(rows = [], holeIdCol = 'hole_id') {
  const resolvedHoleIdCol = resolveHoleIdColumn(rows, holeIdCol);
  const withHoleId = rows.map((row) => {
    const value = row?.[resolvedHoleIdCol];
    return {
      ...row,
      hole_id: value === undefined || value === null ? '' : `${value}`.trim()
    };
  });
  return { rows: withHoleId, holeIdCol: resolvedHoleIdCol };
}

export async function loadCollars(source, options = {}) {
  const {
    holeIdCol = null,
    ...tableOptions
  } = options;
  const standardized = await loadTable(source, tableOptions);
  const { rows } = canonicalizeHoleId(standardized, holeIdCol || 'hole_id');

  const normalized = rows.map((row) => {
    const lat = toNumber(row.lat);
    const lon = toNumber(row.lon);
    const x = toNumber(row.x ?? lon);
    const y = toNumber(row.y ?? lat);
    return {
      ...row,
      lat,
      lon,
      x,
      y
    };
  });

  const required = ['hole_id', 'x', 'y'];
  required.forEach((col) => {
    const missing = normalized.some((row) => {
      if (col === 'hole_id') return !row.hole_id;
      return !Number.isFinite(row[col]);
    });
    if (missing) {
      throw withDataErrorContext('loadCollars', new Error(`Collar table missing column: ${col}`));
    }
  });

  return normalized;
}

export async function loadSurveys(source, options = {}) {
  const {
    holeIdCol = null,
    ...tableOptions
  } = options;
  const standardized = await loadTable(source, tableOptions);
  const { rows } = canonicalizeHoleId(standardized, holeIdCol || 'hole_id');
  const normalized = rows.map((row) => ({
    ...row,
    from: toNumber(row.from),
    azimuth: toNumber(row.azimuth),
    dip: toNumber(row.dip)
  }));

  const required = ['hole_id', 'from', 'azimuth', 'dip'];
  required.forEach((col) => {
    const missing = normalized.some((row) => {
      if (col === 'hole_id') return !row.hole_id;
      return !Number.isFinite(row[col]);
    });
    if (missing) {
      throw withDataErrorContext('loadSurveys', new Error(`Survey table missing column: ${col}`));
    }
  });

  return sortByColumns(normalized, ['hole_id', 'from']);
}

export async function loadAssays(source, options = {}) {
  const {
    holeIdCol = null,
    ...tableOptions
  } = options;
  const standardized = await loadTable(source, tableOptions);
  const { rows } = canonicalizeHoleId(standardized, holeIdCol || 'hole_id');
  const normalized = rows.map((row) => ({
    ...row,
    from: toNumber(row.from),
    to: toNumber(row.to)
  }));

  const required = ['hole_id', 'from', 'to'];
  required.forEach((col) => {
    const missing = normalized.some((row) => {
      if (col === 'hole_id') return !row.hole_id;
      return !Number.isFinite(row[col]);
    });
    if (missing) {
      throw withDataErrorContext('loadAssays', new Error(`Assay table missing column: ${col}`));
    }
  });

  return sortByColumns(normalized, ['hole_id', 'from', 'to']);
}

export function joinAssaysToTraces(assays = [], traces = [], options = {}) {
  const onCols = Array.isArray(options.onCols) && options.onCols.length ? options.onCols : ['hole_id'];
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

export function filterByProject(rows = [], projectId = null) {
  if (projectId === null || projectId === undefined) return [...rows];
  return rows.filter((row) => row?.project_id === projectId);
}

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

export function assembleDataset({
  collars = [],
  surveys = [],
  assays = [],
  structures = [],
  metadata = {}
} = {}) {
  return {
    collars: toArray(collars),
    surveys: toArray(surveys),
    assays: toArray(assays),
    structures: toArray(structures),
    metadata: metadata || {}
  };
}