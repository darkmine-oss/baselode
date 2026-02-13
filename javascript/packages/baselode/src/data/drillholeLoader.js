/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { normalizeCsvRow, pickFirstPresent } from './csvRowUtils.js';
import { withDataErrorContext } from './dataErrorUtils.js';

// Expect CSV columns: hole_id / holeID / HoleId (case-insensitive), project_code, x, y, z, order (optional) plus any attributes per point
export function parseDrillholesCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        const byHole = new Map();
        results.data.forEach((rawRow, idx) => {
          const row = normalizeCsvRow(rawRow);
          const holeIdRaw = pickFirstPresent(row, ['hole_id', 'holeid', 'id'], undefined);
          const holeId = holeIdRaw !== undefined ? `${holeIdRaw}`.trim() : '';
          const x = pickFirstPresent(row, ['x'], null);
          const y = pickFirstPresent(row, ['y'], null);
          const z = pickFirstPresent(row, ['z'], null);
          const order = pickFirstPresent(row, ['order'], idx);

          if (!holeId || x === null || y === null || z === null) return;

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
