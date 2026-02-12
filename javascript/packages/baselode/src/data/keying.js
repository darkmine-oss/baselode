/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export function normalizeFieldName(name) {
  return (name || '').toString().trim().toLowerCase().replace(/\s+/g, '_');
}

export function primaryFieldFromConfig(config = { primaryKey: 'companyHoleId', customKey: '' }) {
  if (!config) return 'companyholeid';
  const key = (config.primaryKey || '').toString();
  if (key === 'custom') {
    const custom = normalizeFieldName(config.customKey);
    return custom || 'companyholeid';
  }
  if (key === 'holeId') return 'holeid';
  if (key === 'collarId') return 'collarid';
  if (key === 'anumber') return 'anumber';
  return 'companyholeid';
}

export function resolvePrimaryId(normalizedRow = {}, primaryField = 'companyholeid') {
  const normalizedPrimary = normalizeFieldName(primaryField || 'companyholeid');
  const candidates = [normalizedPrimary, 'companyholeid', 'company_hole_id', 'holeid', 'hole_id', 'collarid', 'collar_id', 'anumber', 'id'];
  for (const key of candidates) {
    const val = normalizedRow[key];
    if (val === undefined || val === null) continue;
    const str = `${val}`.trim();
    if (str !== '') return str;
  }
  return '';
}

export function buildPrimaryKeyedRow(rawRow = {}, primaryField = 'companyholeid') {
  const normalized = {};
  Object.entries(rawRow).forEach(([key, value]) => {
    if (!key) return;
    normalized[normalizeFieldName(key)] = value;
  });
  const primaryId = resolvePrimaryId(normalized, primaryField);
  return { normalized, primaryId };
}
