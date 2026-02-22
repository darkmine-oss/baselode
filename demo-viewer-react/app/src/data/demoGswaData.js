/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export async function loadDemoGswaAssayFile({
  url = '/data/gswa/gswa_sample_assays.csv',
  fileName = 'gswa_sample_assays.csv'
} = {}) {
  return loadDemoCsvFile({ url, fileName, label: 'demo assays' });
}

export async function loadDemoGswaGeologyFile({
  url = '/data/gswa/gswa_sample_geology.csv',
  fileName = 'gswa_sample_geology.csv'
} = {}) {
  return loadDemoCsvFile({ url, fileName, label: 'demo geology' });
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
