/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { standardizeColumns, HOLE_ID } from 'baselode';

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

export async function loadDemoGswaAssayFile({
  url = '/data/gswa/gswa_sample_assays.csv',
  fileName = 'gswa_sample_assays.csv'
} = {}) {
  return loadDemoCsvFile({ url, fileName, label: 'demo assays' });
}

export async function loadDemoGswaAssayCsvText({
  url = '/data/gswa/gswa_sample_assays.csv'
} = {}) {
  return loadDemoCsvText({ url, label: 'demo assays' });
}

export async function loadDemoGswaGeologyFile({
  url = '/data/gswa/gswa_sample_geology.csv',
  fileName = 'gswa_sample_geology.csv'
} = {}) {
  return loadDemoCsvFile({ url, fileName, label: 'demo geology' });
}

export async function loadDemoGswaGeologyCsvText({
  url = '/data/gswa/gswa_sample_geology.csv'
} = {}) {
  return loadDemoCsvText({ url, label: 'demo geology' });
}

export async function loadDemoPrecomputedDesurveyFile({
  url = '/data/gswa/demo_gswa_precomputed_desurveyed.csv',
  fileName = 'demo_gswa_precomputed_desurveyed.csv'
} = {}) {
  return loadDemoCsvFile({ url, fileName, label: 'precomputed desurvey data' });
}

export async function loadDemoSurveyCsvText({
  url = '/data/gswa/gswa_sample_survey.csv'
} = {}) {
  return loadDemoCsvText({ url, label: 'demo survey data' });
}

export async function loadDemoStructuralCsvText({
  url = '/data/gswa/gswa_sample_structure.csv'
} = {}) {
  return loadDemoCsvText({ url, label: 'demo structural' });
}

async function loadDemoCsvFile({ url, fileName, label }) {
  const csvText = await loadDemoCsvText({ url, label });
  const blob = new Blob([csvText], { type: 'text/csv' });
  return new File([blob], fileName, { type: 'text/csv' });
}

async function loadDemoCsvText({ url, label }) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${label} (${response.status})`);
  }
  return response.text();
}
