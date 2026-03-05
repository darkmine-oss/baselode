/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Column display type classification for strip log visualization.
 *
 * Every loaded column is assigned a display type that drives:
 * - which columns appear in strip log property dropdowns
 * - which chart type options are offered for a given column
 */

/** Numeric measurement column — rendered as bar, marker, or line */
export const DISPLAY_NUMERIC = 'numeric';

/** Categorical string column — rendered as coloured interval bands */
export const DISPLAY_CATEGORICAL = 'categorical';

/** Free-text comment column — rendered as labelled interval boxes */
export const DISPLAY_COMMENT = 'comment';

/** Hidden column — not shown in strip log dropdowns */
export const DISPLAY_HIDDEN = 'hidden';

/** Tadpole log — dip head + azimuth tail, shows both dip and azimuth */
export const DISPLAY_TADPOLE = 'tadpole';

/**
 * Available chart type options for each display type.
 * Used to populate the chart-type dropdown in TracePlot.
 */
export const CHART_OPTIONS = {
  [DISPLAY_NUMERIC]: [
    { value: 'bar', label: 'Bars' },
    { value: 'markers', label: 'Markers' },
    { value: 'markers+line', label: 'Markers + Line' },
    { value: 'line', label: 'Line only' },
  ],
  [DISPLAY_CATEGORICAL]: [
    { value: 'categorical', label: 'Categorical bands' },
  ],
  [DISPLAY_COMMENT]: [
    { value: 'comment', label: 'Comments' },
  ],
  [DISPLAY_TADPOLE]: [
    { value: 'tadpole', label: 'Tadpole' },
  ],
  [DISPLAY_HIDDEN]: [],
};

/**
 * Column names (lowercased) that are always hidden from strip log views.
 * Covers hole IDs, project codes, coordinates, depth/interval fields, and geometry.
 */
export const HIDDEN_COLUMNS = new Set([
  // Hole identifiers
  'hole_id', 'holeid', 'id', 'holetype',
  'datasource_hole_id',
  'anumber', 'collarid', 'companyholeid', 'company_hole_id', 'company_id',
  // Project codes
  'project_id', 'project_code', 'project', 'projectcode', 'projectid',
  // Geographic coordinates
  'latitude', 'longitude', 'lat', 'lon', 'lng',
  'easting', 'northing', 'x', 'y', 'z',
  'elevation', 'elev', 'rl',
  // Depth / interval columns
  'from', 'to', 'mid', 'depth', 'md',
  'samp_from', 'samp_to', 'sample_from', 'sample_to',
  'depth_from', 'depth_to', 'fromdepth', 'todepth',
  // Geometry / CRS
  'shape', 'geometry', 'crs', 'epsg',
  // Internal / synthetic columns
  'data_source', '_hole_key', '_hole_id_key',
]);

/**
 * Column names (lowercased) that map to the comment display type.
 * These are free-text description columns rendered as labelled interval boxes.
 */
export const COMMENT_COLUMN_NAMES = new Set([
  'comments', 'comment', 'notes', 'note',
  'description', 'remarks', 'remark',
  'log_description', 'struct_comment', 'structcomment',
  'geology_description',
]);

/**
 * Classify columns in a dataset by their display type.
 *
 * Rules applied in order:
 * 1. Columns in HIDDEN_COLUMNS → DISPLAY_HIDDEN
 * 2. Columns in COMMENT_COLUMN_NAMES with ≥1 non-empty value → DISPLAY_COMMENT
 * 3. All-null/empty columns → DISPLAY_HIDDEN (silently dropped)
 * 4. Columns with at least one finite number → DISPLAY_NUMERIC
 * 5. Remaining non-empty columns → DISPLAY_CATEGORICAL
 *
 * @param {Array<Object>} rows - Flat array of row objects (assay or structural points)
 * @returns {{
 *   byType: Object<string, string>,
 *   numericCols: string[],
 *   categoricalCols: string[],
 *   commentCols: string[],
 * }}
 */
export function classifyColumns(rows) {
  if (!rows?.length) {
    return { byType: {}, numericCols: [], categoricalCols: [], commentCols: [] };
  }

  // Collect all column names across all rows
  const allCols = new Set(rows.flatMap((r) => Object.keys(r || {})));
  const byType = {};

  for (const col of allCols) {
    const normalized = col.toLowerCase().trim();

    // Always hidden: ID / coordinate / depth columns
    if (HIDDEN_COLUMNS.has(normalized) || HIDDEN_COLUMNS.has(col)) {
      byType[col] = DISPLAY_HIDDEN;
      continue;
    }

    // Comment-type: named text-description columns
    if (COMMENT_COLUMN_NAMES.has(normalized)) {
      const hasValue = rows.some((r) => {
        const v = r[col];
        return v != null && String(v).trim() !== '' && String(v) !== 'null';
      });
      byType[col] = hasValue ? DISPLAY_COMMENT : DISPLAY_HIDDEN;
      continue;
    }

    // Classify by content: all-empty → hidden; numeric → numeric; else → categorical
    let hasNumeric = false;
    let hasValue = false;
    for (const r of rows) {
      const v = r[col];
      if (v == null || (typeof v === 'string' && v.trim() === '')) continue;
      hasValue = true;
      if (typeof v === 'number' && Number.isFinite(v)) {
        hasNumeric = true;
        break;
      }
    }

    if (!hasValue) {
      byType[col] = DISPLAY_HIDDEN;
    } else if (hasNumeric) {
      byType[col] = DISPLAY_NUMERIC;
    } else {
      byType[col] = DISPLAY_CATEGORICAL;
    }
  }

  return {
    byType,
    numericCols: Object.entries(byType).filter(([, t]) => t === DISPLAY_NUMERIC).map(([k]) => k),
    categoricalCols: Object.entries(byType).filter(([, t]) => t === DISPLAY_CATEGORICAL).map(([k]) => k),
    commentCols: Object.entries(byType).filter(([, t]) => t === DISPLAY_COMMENT).map(([k]) => k),
  };
}

/**
 * Get the available chart type options for a given display type.
 * Returns NUMERIC options as a fallback for unknown types.
 *
 * @param {string} displayType - One of the DISPLAY_* constants
 * @returns {Array<{value: string, label: string}>}
 */
export function getChartOptions(displayType) {
  return CHART_OPTIONS[displayType] ?? CHART_OPTIONS[DISPLAY_NUMERIC];
}

/**
 * Get the default chart type value for a display type.
 *
 * @param {string} displayType
 * @returns {string}
 */
export function defaultChartType(displayType) {
  const opts = getChartOptions(displayType);
  if (!opts.length) return 'markers+line';
  if (displayType === DISPLAY_NUMERIC) return 'line';
  return opts[0].value;
}
