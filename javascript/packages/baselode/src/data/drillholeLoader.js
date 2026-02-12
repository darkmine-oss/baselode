/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';

// Expect CSV columns: hole_id / holeID / HoleId (case-insensitive), project_code, x, y, z, order (optional) plus any attributes per point
export function parseDrillholesCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        const normalizeRow = (row) => {
          const normalized = {};
          Object.entries(row || {}).forEach(([key, value]) => {
            if (!key) return;
            const normKey = key.trim().toLowerCase().replace(/\s+/g, '_');
            normalized[normKey] = value;
          });
          return normalized;
        };

        const pick = (normalized, keys, fallback) => {
          for (const key of keys) {
            if (normalized[key] !== undefined && normalized[key] !== null && `${normalized[key]}`.trim() !== '') {
              return normalized[key];
            }
          }
          return fallback;
        };

        const byHole = new Map();
        results.data.forEach((rawRow, idx) => {
          const row = normalizeRow(rawRow);
          const holeIdRaw = pick(row, ['hole_id', 'holeid', 'holeid', 'id'], undefined);
          const holeId = holeIdRaw !== undefined ? `${holeIdRaw}`.trim() : '';
          const x = pick(row, ['x'], null);
          const y = pick(row, ['y'], null);
          const z = pick(row, ['z'], null);
          const order = pick(row, ['order'], idx);

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
      error: (error) => reject(error)
    });
  });
}
