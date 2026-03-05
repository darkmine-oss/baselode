/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { standardizeColumns } from './keying.js';
import { HOLE_ID, FROM, TO, MID, DEPTH, DIP, AZIMUTH } from './datamodel.js';
import { parseStructuralCSV, groupRowsByHole } from './structuralLoader.js';


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
  return new Promise((resolve) => {
    Papa.parse(csvText, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        const byHole = new Map();
        for (const rawRow of results.data) {
          const row = standardizeColumns(rawRow);
          const holeId = row[HOLE_ID] != null ? `${row[HOLE_ID]}`.trim() : '';
          if (!holeId) continue;
          const from = Number(row[FROM]);
          const to = Number(row[TO]);
          if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
          const mid = (from + to) / 2;
          // Strip structural-domain columns that some assay exports (e.g. GSWA) include
          // as per-interval hole-orientation values — these are borehole survey attributes,
          // not structural plane measurements, and must not appear as selectable properties
          // alongside true structural data.
          // eslint-disable-next-line no-unused-vars
          const { [DIP]: _dip, [AZIMUTH]: _az, ...rowWithoutStructural } = row;
          const point = {
            ...rowWithoutStructural,
            [HOLE_ID]: holeId,
            [FROM]: from,
            [TO]: to,
            [MID]: mid,
            [DEPTH]: mid, // unified depth field for y-axis rendering
            _source: 'assay',
          };
          if (!byHole.has(holeId)) byHole.set(holeId, []);
          byHole.get(holeId).push(point);
        }
        const holes = Array.from(byHole.entries()).map(([holeId, points]) => ({
          holeId,
          points: points.sort((a, b) => a[FROM] - b[FROM]),
        }));
        resolve(holes);
      },
    });
  });
}

/**
 * Parse geology CSV text into an array of hole objects, keyed by hole_id.
 *
 * @param {string} csvText - Geology CSV content as a text string
 * @returns {Promise<{holes: Array<{holeId: string, points: Array<Object>}>}>}
 */
export function parseGeologyCsvText(csvText) {
  return new Promise((resolve) => {
    Papa.parse(csvText, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        const byHole = new Map();
        for (const rawRow of results.data) {
          const row = standardizeColumns(rawRow);
          const holeId = (row[HOLE_ID] ?? '').toString().trim();
          if (!holeId) continue;
          const from = Number(row[FROM]);
          const to = Number(row[TO]);
          if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
          const mid = (from + to) / 2;
          // eslint-disable-next-line no-unused-vars
          const { [DIP]: _dip, [AZIMUTH]: _az, ...rest } = row;
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
        resolve({
          holes: Array.from(byHole.entries()).map(([holeId, points]) => ({
            holeId,
            points: points.sort((a, b) => a[FROM] - b[FROM]),
          })),
        });
      },
    });
  });
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
 * @returns {Promise<{holes: Array<{holeId: string, points: Array<Object>}>}>}
 */
export async function parseUnifiedDataset({ assayCsv, structuralCsv, geologyCsv } = {}) {
  const [assayHoles, structuralHoles, geologyHoles] = await Promise.all([
    assayCsv ? parseAssayCsvTextToHoles(assayCsv) : Promise.resolve([]),
    structuralCsv
      ? parseStructuralCSV(structuralCsv).then(({ rows }) =>
          groupRowsByHole(rows.map((r) => ({ ...r, _source: 'structural' })))
        )
      : Promise.resolve([]),
    geologyCsv ? parseGeologyCsvText(geologyCsv).then(({ holes }) => holes) : Promise.resolve([]),
  ]);

  // Merge holes from all sources by holeId
  const byId = new Map(assayHoles.map((h) => [h.holeId, { ...h, points: [...h.points] }]));
  for (const sh of [...structuralHoles, ...geologyHoles]) {
    const id = sh.holeId;
    if (!id) continue;
    if (byId.has(id)) {
      const existing = byId.get(id);
      byId.set(id, { ...existing, points: [...existing.points, ...(sh.points || [])] });
    } else {
      byId.set(id, sh);
    }
  }

  return { holes: Array.from(byId.values()) };
}
