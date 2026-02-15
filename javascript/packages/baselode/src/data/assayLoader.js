/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { ASSAY_NON_VALUE_FIELDS } from './assayFieldSets.js';
import { standardizeColumns } from './keying.js';
import { withDataErrorContext } from './dataErrorUtils.js';
import { HOLE_ID, FROM, TO, PROJECT_ID } from './datamodel.js';

// Shared helpers for parsing assay CSVs with varying column names.
const normalizeRow = (rawRow, sourceColumnMap = null) => standardizeColumns(rawRow, null, sourceColumnMap);

function extractIdFields(row) {
  const holeId = row[HOLE_ID];
  return { holeId };
}

function extractInterval(row, sourceColumnMap = null) {
  const holeIdRaw = row[HOLE_ID];
  const holeId = holeIdRaw !== undefined ? `${holeIdRaw}`.trim() : '';
  if (!holeId) return null;

  const project = row[PROJECT_ID] || row.project || row.project_code;
  const from = Number(row[FROM]);
  const to = Number(row[TO]);
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
    const pointData = {
      z: from,
      from,
      to,
      [HOLE_ID]: holeId,
      [PROJECT_ID]: project,
      ...rest
    };
    points.push(pointData);
    points.push({ ...pointData, z: to });
  });
  return { id: holeId, project: sorted[0]?.project, points };
}

// Quick pass: collect unique hole IDs (collars) without materializing all intervals.
export function parseAssayHoleIds(file, sourceColumnMap = null) {
  return new Promise((resolve, reject) => {
    const holeIds = new Set();
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      step: (results) => {
        const row = normalizeRow(results.data, sourceColumnMap);
        const hid = row[HOLE_ID];
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
export function parseAssayHoleIdsWithAssays(file, sourceColumnMap = null) {
  return new Promise((resolve, reject) => {
    const byHole = new Map();
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      step: (results) => {
        const row = normalizeRow(results.data, sourceColumnMap);
        if (!hasAssayValue(row)) return;
        const ids = extractIdFields(row);
        const hid = ids.holeId;
        if (hid !== undefined && `${hid}`.trim() !== '') {
          const key = `${hid}`.trim();
          if (!byHole.has(key)) {
            byHole.set(key, {
              holeId: key
            });
          }
        }
      },
      complete: () => resolve(Array.from(byHole.values())),
      error: (error) => reject(withDataErrorContext('parseAssayHoleIdsWithAssays', error))
    });
  });
}

// Parse assay CSV with intervals for a single holeId.
export function parseAssayHole(file, holeId, config = null, sourceColumnMap = null) {
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
        const row = normalizeRow(results.data, sourceColumnMap);
        const interval = extractInterval(row, sourceColumnMap);
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
export function parseAssaysCSV(file, config = null, sourceColumnMap = null) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        const byHole = new Map();
        results.data.forEach((rawRow) => {
          const row = normalizeRow(rawRow, sourceColumnMap);
          const interval = extractInterval(row, sourceColumnMap);
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
