/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { normalizeFieldName, standardizeColumns } from './keying.js';

/**
 * Normalize a CSV row by converting all keys to lowercase with underscores
 * @deprecated Use standardizeColumns from keying.js instead for full data model support
 */
export function normalizeCsvRow(row = {}) {
  const normalized = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    if (!key) return;
    normalized[normalizeFieldName(key)] = value;
  });
  return normalized;
}

/**
 * Pick the first present value from a list of keys in a normalized row
 * @param {Object} normalized - The normalized row object
 * @param {Array<string>} keys - Array of keys to check
 * @param {*} fallback - Fallback value if none found
 * @returns {*} - The first present value or fallback
 */
export function pickFirstPresent(normalized = {}, keys = [], fallback) {
  for (const key of keys) {
    const value = normalized[key];
    if (value !== undefined && value !== null && `${value}`.trim() !== '') {
      return value;
    }
  }
  return fallback;
}