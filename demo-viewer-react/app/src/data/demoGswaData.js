/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { standardizeColumns, HOLE_ID } from 'baselode';

// Module-level cache: url → Promise<string>
// Ensures each CSV is fetched exactly once regardless of how many callers
// request it (including React 18 Strict Mode's double effect invocation).
const _fetchCache = new Map();

function loadDemoCsvText({ url, label }) {
  if (!_fetchCache.has(url)) {
    _fetchCache.set(
      url,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${label} (${r.status})`);
        return r.text();
      }),
    );
  }
  return _fetchCache.get(url);
}

async function loadDemoCsvFile({ url, fileName, label }) {
  const csvText = await loadDemoCsvText({ url, label });
  const blob = new Blob([csvText], { type: 'text/csv' });
  return new File([blob], fileName, { type: 'text/csv' });
}

export async function loadDemoCollarRows({
  url = '/data/gswa/gswa_sample_collars.csv'
} = {}) {
  const csvText = await loadDemoCsvText({ url, label: 'demo collars' });
  return new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data.flatMap((row) => {
          const s = standardizeColumns(row);
          const lat = parseFloat(s.latitude);
          const lng = parseFloat(s.longitude);
          const holeId = (s[HOLE_ID] || '').toString().trim();
          if (!holeId || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
          return [{ lat, lng, project: (s.project_id || s.dataset || 'Unknown').toString().trim(), holeId }];
        });
        resolve(rows);
      },
      error: reject,
    });
  });
}

export function loadDemoGswaAssayFile({
  url = '/data/gswa/gswa_sample_assays.csv',
  fileName = 'gswa_sample_assays.csv'
} = {}) {
  return loadDemoCsvFile({ url, fileName, label: 'demo assays' });
}

export function loadDemoGswaAssayCsvText({
  url = '/data/gswa/gswa_sample_assays.csv'
} = {}) {
  return loadDemoCsvText({ url, label: 'demo assays' });
}

export function loadDemoGswaGeologyFile({
  url = '/data/gswa/gswa_sample_geology.csv',
  fileName = 'gswa_sample_geology.csv'
} = {}) {
  return loadDemoCsvFile({ url, fileName, label: 'demo geology' });
}

export function loadDemoGswaGeologyCsvText({
  url = '/data/gswa/gswa_sample_geology.csv'
} = {}) {
  return loadDemoCsvText({ url, label: 'demo geology' });
}

export function loadDemoPrecomputedDesurveyFile({
  url = '/data/gswa/demo_gswa_precomputed_desurveyed.csv',
  fileName = 'demo_gswa_precomputed_desurveyed.csv'
} = {}) {
  return loadDemoCsvFile({ url, fileName, label: 'precomputed desurvey data' });
}

export function loadDemoSurveyCsvText({
  url = '/data/gswa/gswa_sample_survey.csv'
} = {}) {
  return loadDemoCsvText({ url, label: 'demo survey data' });
}

export function loadDemoStructuralCsvText({
  url = '/data/gswa/gswa_sample_structure.csv'
} = {}) {
  return loadDemoCsvText({ url, label: 'demo structural' });
}
