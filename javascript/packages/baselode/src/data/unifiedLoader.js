/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { standardizeColumns } from './keying.js';
import { HOLE_ID, FROM, TO, MID, DEPTH, DIP, AZIMUTH } from './datamodel.js';
import {
  parseStructuralCSV,
  parseStructuralFromRows,
  groupRowsByHole,
} from './structuralLoader.js';

function parseCsvRows(csvText) {
  return new Promise((resolve) => {
    Papa.parse(csvText, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data || []),
    });
  });
}

function holesFromPoints(byHole) {
  return Array.from(byHole.entries()).map(([holeId, points]) => ({
    holeId,
    points: points.sort((a, b) => a[FROM] - b[FROM]),
  }));
}

function structuralHolesFromRows(rows) {
  if (!rows.length) return [];
  return groupRowsByHole(
    parseStructuralFromRows(rows).rows.map(
      (row) => ({ ...row, _source: 'structural' }),
    ),
  );
}

function mergeUnifiedHoles(assayHoles, structuralHoles, geologyHoles) {
  const byId = new Map(
    assayHoles.map((hole) => [hole.holeId, { ...hole, points: [...hole.points] }]),
  );
  for (const hole of [...structuralHoles, ...geologyHoles]) {
    const id = hole.holeId;
    if (!id) continue;
    if (byId.has(id)) {
      const existing = byId.get(id);
      byId.set(id, { ...existing, points: [...existing.points, ...(hole.points || [])] });
    } else {
      byId.set(id, hole);
    }
  }
  return { holes: Array.from(byId.values()) };
}

/**
 * Convert already-parsed assay rows into unified hole records.
 *
 * @param {Array<Object>} rows - Parsed assay row objects
 * @returns {Array<{holeId: string, points: Array<Object>}>}
 */
export function parseAssayHolesFromRows(rows) {
  const byHole = new Map();
  for (const rawRow of rows || []) {
    const row = standardizeColumns(rawRow);
    const holeId = row[HOLE_ID] != null ? `${row[HOLE_ID]}`.trim() : '';
    if (!holeId) continue;
    const from = Number(row[FROM]);
    const to = Number(row[TO]);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    const mid = (from + to) / 2;
    // These describe borehole orientation in some assay exports, not a
    // structural measurement that should become a selectable property.
    // eslint-disable-next-line no-unused-vars
    const { [DIP]: _dip, [AZIMUTH]: _azimuth, ...rest } = row;
    const point = {
      ...rest,
      [HOLE_ID]: holeId,
      [FROM]: from,
      [TO]: to,
      [MID]: mid,
      [DEPTH]: mid,
      _source: 'assay',
    };
    if (!byHole.has(holeId)) byHole.set(holeId, []);
    byHole.get(holeId).push(point);
  }
  return holesFromPoints(byHole);
}

/**
 * Convert already-parsed geology rows into unified hole records.
 *
 * @param {Array<Object>} rows - Parsed geology row objects
 * @returns {{holes: Array<{holeId: string, points: Array<Object>}>}}
 */
export function parseGeologyFromRows(rows) {
  const byHole = new Map();
  for (const rawRow of rows || []) {
    const row = standardizeColumns(rawRow);
    const holeId = row[HOLE_ID] != null ? `${row[HOLE_ID]}`.trim() : '';
    if (!holeId) continue;
    const from = Number(row[FROM]);
    const to = Number(row[TO]);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    const mid = (from + to) / 2;
    // eslint-disable-next-line no-unused-vars
    const { [DIP]: _dip, [AZIMUTH]: _azimuth, ...rest } = row;
    const point = {
      ...rest,
      [HOLE_ID]: holeId,
      [FROM]: from,
      [TO]: to,
      [MID]: mid,
      [DEPTH]: mid,
      _source: 'geology',
    };
    if (!byHole.has(holeId)) byHole.set(holeId, []);
    byHole.get(holeId).push(point);
  }
  return { holes: holesFromPoints(byHole) };
}


/**
 * Parse assay CSV text into an array of hole objects.
 *
 * Each interval row gets a pre-computed `mid` field (= (from + to) / 2) stored
 * under both the `mid` and `depth` keys so it can serve as the unified y-axis
 * depth value when rendered alongside structural point data.
 *
 * @param {string} csvText - Assay CSV content as a text string
 * @returns {Promise<Array<{holeId: string, points: Array<Object>}>>}
 */
export function parseAssayCsvTextToHoles(csvText) {
  return parseCsvRows(csvText).then(parseAssayHolesFromRows);
}

/**
 * Parse geology CSV text into an array of hole objects, keyed by hole_id.
 *
 * @param {string} csvText - Geology CSV content as a text string
 * @returns {Promise<{holes: Array<{holeId: string, points: Array<Object>}>}>}
 */
export function parseGeologyCsvText(csvText) {
  return parseCsvRows(csvText).then(parseGeologyFromRows);
}

/**
 * Build a unified drillhole dataset directly from parsed row objects.
 *
 * @param {Object} options
 * @param {Array<Object>} [options.assayRows]
 * @param {Array<Object>} [options.structuralRows]
 * @param {Array<Object>} [options.geologyRows]
 * @returns {{holes: Array<{holeId: string, points: Array<Object>}>}}
 */
export function parseUnifiedDatasetFromRows({
  assayRows = [],
  structuralRows = [],
  geologyRows = [],
} = {}) {
  const assayHoles = parseAssayHolesFromRows(assayRows);
  const structuralHoles = structuralHolesFromRows(structuralRows);
  const geologyHoles = parseGeologyFromRows(geologyRows).holes;
  return mergeUnifiedHoles(assayHoles, structuralHoles, geologyHoles);
}

/**
 * Build a unified drillhole dataset by merging assay intervals and structural
 * point/interval measurements from their respective CSV text sources.
 *
 * The result is a flat, holeId-keyed collection of hole objects.  Each hole's
 * `points` array contains rows from both sources:
 *  - Assay rows carry all geochemical columns; `depth` is set to the interval
 *    midpoint ((from + to) / 2) pre-computed at load time.
 *  - Structural rows carry dip/azimuth/description columns; `depth` comes
 *    directly from the structural CSV (point schema) or the interval midpoint
 *    (interval schema).
 *  - Rows from each source are tagged with `_source: 'assay'|'structural'`.
 *
 * The returned holes can be passed directly to `useDrillholeTraceGrid` as
 * `extraHoles` (without a `sourceFile`) since all data is eager-loaded.
 *
 * @param {Object} options
 * @param {string} [options.assayCsv]      - Assay CSV text
 * @param {string} [options.structuralCsv] - Structural CSV text
 * @param {string} [options.geologyCsv]    - Geology CSV text
 * @param {Array<Object>} [options.assayRows]      - Parsed assay rows (takes precedence)
 * @param {Array<Object>} [options.structuralRows] - Parsed structural rows (takes precedence)
 * @param {Array<Object>} [options.geologyRows]    - Parsed geology rows (takes precedence)
 * @returns {Promise<{holes: Array<{holeId: string, points: Array<Object>}>}>}
 */
export async function parseUnifiedDataset({
  assayCsv,
  structuralCsv,
  geologyCsv,
  assayRows,
  structuralRows,
  geologyRows,
} = {}) {
  const [assayHoles, structuralHoles, geologyHoles] = await Promise.all([
    assayRows !== undefined
      ? Promise.resolve(parseAssayHolesFromRows(assayRows))
      : (assayCsv ? parseAssayCsvTextToHoles(assayCsv) : Promise.resolve([])),
    structuralRows !== undefined
      ? Promise.resolve(structuralHolesFromRows(structuralRows))
      : (structuralCsv
          ? parseStructuralCSV(structuralCsv).then(({ rows }) => groupRowsByHole(
              rows.map((row) => ({ ...row, _source: 'structural' })),
            ))
          : Promise.resolve([])),
    geologyRows !== undefined
      ? Promise.resolve(parseGeologyFromRows(geologyRows).holes)
      : (geologyCsv
          ? parseGeologyCsvText(geologyCsv).then(({ holes }) => holes)
          : Promise.resolve([])),
  ]);
  return mergeUnifiedHoles(assayHoles, structuralHoles, geologyHoles);
}
