/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { ASSAY_NON_VALUE_FIELDS } from './assayFieldSets.js';
import { normalizeCsvRow, pickFirstPresent } from './csvRowUtils.js';
import { withDataErrorContext } from './dataErrorUtils.js';
import { primaryFieldFromConfig } from './keying.js';

// Shared helpers for parsing assay CSVs with varying column names.
const normalizeRow = normalizeCsvRow;
const pick = (normalized, keys) => pickFirstPresent(normalized, keys, undefined);

function deriveHoleId(row, config) {
  const primaryField = primaryFieldFromConfig(config);
  const primary = row[primaryField];
  if (primary !== undefined && primary !== null && `${primary}`.trim() !== '') {
    return primary;
  }
  return pick(row, [
    'collarid',
    'collar_id',
    'companyholeid',
    'company_hole_id',
    'hole_id',
    'holeid',
    'anumber',
    'id'
  ]);
}

function extractIdFields(row, config) {
  const collarId = pick(row, ['collarid', 'collar_id']);
  const companyHoleId = pick(row, ['companyholeid', 'company_hole_id']);
  const preferred = deriveHoleId(row, config);
  return { holeId: preferred, collarId, companyHoleId };
}

function extractInterval(row, config) {
  const holeIdRaw = deriveHoleId(row, config);
  const holeId = holeIdRaw !== undefined ? `${holeIdRaw}`.trim() : '';
  if (!holeId) return null;

  const project = pick(row, ['project_code', 'project']);
  const from = Number(pick(row, ['samp_from', 'sample_from', 'from', 'depth_from', 'fromdepth', 'from_depth']));
  const to = Number(pick(row, ['samp_to', 'sample_to', 'to', 'depth_to', 'todepth', 'to_depth']));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;

  return {
    holeId,
    project,
    from,
    to,
    ...row
  };
}

function intervalsToHole(holeId, intervals) {
  const sorted = intervals.sort((a, b) => a.from - b.from);
  const points = [];
  sorted.forEach((iv) => {
    const { from, to, project, ...rest } = iv;
    points.push({ z: from, from, to, hole_id: holeId, project_code: project, ...rest });
    points.push({ z: to, from, to, hole_id: holeId, project_code: project, ...rest });
  });
  return { id: holeId, project: sorted[0]?.project, points };
}

// Quick pass: collect unique hole IDs (collars) without materializing all intervals.
export function parseAssayHoleIds(file, config) {
  return new Promise((resolve, reject) => {
    const holeIds = new Set();
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      step: (results) => {
        const row = normalizeRow(results.data);
        const hid = deriveHoleId(row, config);
        if (hid !== undefined && `${hid}`.trim() !== '') {
          holeIds.add(`${hid}`.trim());
        }
      },
      complete: () => resolve(Array.from(holeIds)),
      error: (error) => reject(withDataErrorContext('parseAssayHoleIds', error))
    });
  });
}

function hasAssayValue(row) {
  return Object.entries(row || {}).some(([k, v]) => {
    if (ASSAY_NON_VALUE_FIELDS.has(k)) return false;
    if (v === undefined || v === null) return false;
    if (typeof v === 'string' && v.trim() === '') return false;
    return true;
  });
}

// Quick pass: hole IDs that have at least one non-null assay value.
export function parseAssayHoleIdsWithAssays(file, config) {
  return new Promise((resolve, reject) => {
    const byHole = new Map();
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      step: (results) => {
        const row = normalizeRow(results.data);
        if (!hasAssayValue(row)) return;
        const ids = extractIdFields(row, config);
        const hid = ids.holeId;
        if (hid !== undefined && `${hid}`.trim() !== '') {
          const key = `${hid}`.trim();
          if (!byHole.has(key)) {
            byHole.set(key, {
              holeId: key,
              collarId: ids.collarId ? `${ids.collarId}`.trim() : undefined,
              companyHoleId: ids.companyHoleId ? `${ids.companyHoleId}`.trim() : undefined
            });
          } else {
            const curr = byHole.get(key);
            if (!curr.collarId && ids.collarId) curr.collarId = `${ids.collarId}`.trim();
            if (!curr.companyHoleId && ids.companyHoleId) curr.companyHoleId = `${ids.companyHoleId}`.trim();
          }
        }
      },
      complete: () => resolve(Array.from(byHole.values())),
      error: (error) => reject(withDataErrorContext('parseAssayHoleIdsWithAssays', error))
    });
  });
}

// Parse assay CSV with intervals for a single holeId.
export function parseAssayHole(file, holeId, config) {
  return new Promise((resolve, reject) => {
    const wanted = `${holeId}`.trim();
    if (!wanted) {
      reject(withDataErrorContext('parseAssayHole', new Error('Missing hole id')));
      return;
    }
    const intervals = [];
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      step: (results) => {
        const row = normalizeRow(results.data);
        const interval = extractInterval(row, config);
        if (!interval) return;
        if (`${interval.holeId}`.trim() !== wanted) return;
        intervals.push(interval);
      },
      complete: () => {
        if (!intervals.length) {
          resolve(null);
          return;
        }
        const hole = intervalsToHole(wanted, intervals);
        resolve(hole);
      },
      error: (error) => reject(withDataErrorContext('parseAssayHole', error))
    });
  });
}

// Parse assay CSV with intervals for all holes (eager load).
export function parseAssaysCSV(file, config) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        const byHole = new Map();
        results.data.forEach((rawRow) => {
          const row = normalizeRow(rawRow);
          const interval = extractInterval(row, config);
          if (!interval) return;
          if (!byHole.has(interval.holeId)) byHole.set(interval.holeId, []);
          byHole.get(interval.holeId).push(interval);
        });

        const holes = Array.from(byHole.entries()).map(([hid, intervals]) => intervalsToHole(hid, intervals));
        resolve({ holes });
      },
      error: (error) => reject(withDataErrorContext('parseAssaysCSV', error))
    });
  });
}
