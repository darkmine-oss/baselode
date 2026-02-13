/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { normalizeFieldName } from './keying.js';

export function normalizeCsvRow(row = {}) {
  const normalized = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    if (!key) return;
    normalized[normalizeFieldName(key)] = value;
  });
  return normalized;
}

export function pickFirstPresent(normalized = {}, keys = [], fallback) {
  for (const key of keys) {
    const value = normalized[key];
    if (value !== undefined && value !== null && `${value}`.trim() !== '') {
      return value;
    }
  }
  return fallback;
}