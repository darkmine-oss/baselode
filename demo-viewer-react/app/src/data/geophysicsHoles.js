/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { standardizeColumns, HOLE_ID, FROM, TO, MID, DEPTH } from 'baselode';

// The GSWA geophysics extract mixes null sentinels per channel: -999.25
// (the LAS convention, `GEOPHYSICS_NULL`) plus a -999.0 variant used by the
// Density_Best column.  Anything at or below this ceiling is "no reading".
const GEOPHYSICS_SENTINEL_CEILING = -999;

/**
 * Parse an interval-schema geophysics CSV (FromDepth/ToDepth plus one column
 * per probe channel) into `{ holeId, points }` hole objects — the same shape
 * as the assay/structural holes consumed by `useDrillholeTraceGrid` and
 * `buildIntervalPoints`, so geophysics channels (resistivity, gamma, density,
 * magnetic susceptibility) appear as ordinary numeric strip-log properties.
 *
 * Non-numeric columns and sentinel readings are dropped per-cell rather than
 * per-row, so an interval keeps whichever channels actually recorded a value.
 *
 * @param {string} csvText - Raw geophysics CSV text
 * @returns {Promise<Array<{holeId: string, points: Array<Object>}>>}
 */
export function parseGeophysicsIntervalHoles(csvText) {
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
          const fromDepth = Number(row[FROM]);
          const toDepth = Number(row[TO]);
          if (!Number.isFinite(fromDepth) || !Number.isFinite(toDepth) || toDepth <= fromDepth) continue;
          const midDepth = (fromDepth + toDepth) / 2;

          const point = {
            [HOLE_ID]: holeId,
            [FROM]: fromDepth,
            [TO]: toDepth,
            [MID]: midDepth,
            [DEPTH]: midDepth,
            _source: 'geophysics',
          };
          for (const [column, value] of Object.entries(row)) {
            if (column === HOLE_ID || column === FROM || column === TO) continue;
            if (typeof value !== 'number' || !Number.isFinite(value)) continue;
            if (value <= GEOPHYSICS_SENTINEL_CEILING) continue;
            point[column] = value;
          }

          if (!byHole.has(holeId)) byHole.set(holeId, []);
          byHole.get(holeId).push(point);
        }

        resolve(Array.from(byHole.entries()).map(([holeId, points]) => ({
          holeId,
          points: points.sort((first, second) => first[FROM] - second[FROM]),
        })));
      },
    });
  });
}
