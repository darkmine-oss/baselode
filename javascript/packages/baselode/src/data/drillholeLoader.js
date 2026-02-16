/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { standardizeColumns } from './keying.js';
import { withDataErrorContext } from './dataErrorUtils.js';
import { HOLE_ID, EASTING, NORTHING, ELEVATION } from './datamodel.js';

/**
 * Parse drillholes CSV with desurveyed trace points
 * Expect CSV columns: hole_id, x (easting), y (northing), z (elevation), order (optional) plus any attributes per point
 * @param {File|Blob|string} file - CSV file or data
 * @param {Object} [sourceColumnMap] - Optional user-provided column mappings
 * @returns {Promise<{holes: Array}>} - Parsed drillhole data
 */
export function parseDrillholesCSV(file, sourceColumnMap = null) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        const byHole = new Map();
        results.data.forEach((rawRow, idx) => {
          const row = standardizeColumns(rawRow, null, sourceColumnMap);
          
          const holeIdRaw = row[HOLE_ID];
          const holeId = holeIdRaw !== undefined ? `${holeIdRaw}`.trim() : '';
          const x = row[EASTING] ?? row.x;
          const y = row[NORTHING] ?? row.y;
          const z = row[ELEVATION] ?? row.z;
          const order = row.order ?? idx;

          if (!holeId || x === null || x === undefined || y === null || y === undefined || z === null || z === undefined) return;

          if (!byHole.has(holeId)) byHole.set(holeId, []);
          byHole.get(holeId).push({
            ...row,
            holeId,
            order,
            x: Number(x) ?? 0,
            y: Number(y) ?? 0,
            z: Number(z) ?? 0
          });
        });

        const holes = Array.from(byHole.entries()).map(([holeId, pts]) => ({
          id: holeId,
          points: pts
            .sort((a, b) => a.order - b.order)
            .map((p) => ({
              ...p,
              x: Number(p.x) || 0,
              y: Number(p.y) || 0,
              z: Number(p.z) || 0
            }))
        }));

        resolve({ holes });
      },
      error: (error) => reject(withDataErrorContext('parseDrillholesCSV', error))
    });
  });
}
