/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { parseAssayHole, parseAssayHoleIdsWithAssays, parseAssaysCSV } from './assayLoader.js';
import { ASSAY_NON_VALUE_FIELDS } from './assayFieldSets.js';
import { buildTraceConfigsForHoleIds, reorderHoleIds } from './traceGridConfig.js';

export { reorderHoleIds };

/**
 * Derive numeric and categorical property names from assay hole data
 * @param {Array<Object>} holes - Array of hole objects with points containing assay data
 * @returns {{numericProps: Array<string>, categoricalProps: Array<string>, defaultProp: string}} Property classification
 */
export function deriveAssayProps(holes = []) {
  const points = holes.flatMap((h) => h.points || []);
  const candidates = new Set();
  points.forEach((p) => {
    Object.keys(p || {}).forEach((k) => {
      if (!ASSAY_NON_VALUE_FIELDS.has(k)) candidates.add(k);
    });
  });

  const numericProps = [];
  const categoricalProps = [];

  candidates.forEach((key) => {
    let hasNumber = false;
    let hasValue = false;
    for (let i = 0; i < points.length; i += 1) {
      const v = points[i]?.[key];
      if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) continue;
      hasValue = true;
      if (typeof v === 'number' && Number.isFinite(v)) {
        hasNumber = true;
        break;
      }
    }
    if (hasNumber) {
      numericProps.push(key);
    } else if (hasValue) {
      categoricalProps.push(key);
    }
  });

  const defaultProp = numericProps[0] || categoricalProps[0] || '';

  return { numericProps, categoricalProps, defaultProp };
}

/**
 * Load metadata (hole IDs) from an assay CSV file
 * @param {File|Blob} file - Assay CSV file
 * @param {Object|null} config - Optional configuration (unused, for backwards compatibility)
 * @returns {Promise<Array<{holeId: string}>>} Array of hole IDs with assay data
 */
export async function loadAssayMetadata(file, config = null) {
  const holeIds = await parseAssayHoleIdsWithAssays(file);
  return holeIds;
}

/**
 * Load assay intervals for a specific hole from CSV file
 * @param {File|Blob} file - Assay CSV file
 * @param {string} holeId - Hole identifier to load
 * @param {Object|null} config - Optional configuration (unused, for backwards compatibility)
 * @returns {Promise<Object|null>} Hole object with assay intervals or null if not found
 */
export async function loadAssayHole(file, holeId, config = null) {
  const hole = await parseAssayHole(file, holeId);
  return hole;
}

/**
 * Build complete assay state from hole data including property analysis and trace configs
 * @param {Array<Object>} holes - Array of hole objects with assay data
 * @param {string} focusedHoleId - Hole ID to focus on (will be first in trace configs)
 * @returns {Object|null} Assay state object with holes, properties, and trace configs
 */
export function buildAssayState(holes = [], focusedHoleId = '') {
  if (!holes.length) return null;
  const { numericProps, categoricalProps, defaultProp } = deriveAssayProps(holes);
  const holeIds = holes.map((h) => h.id || h.holeId).filter(Boolean);
  const traceConfigs = buildTraceConfigsForHoleIds({
    holeIds,
    focusedHoleId,
    plotCount: 4,
    defaultProp,
    categoricalProps,
    numericDefaultChartType: 'line'
  });
  return {
    holes,
    numericProps,
    categoricalProps,
    defaultProp,
    traceConfigs
  };
}

/**
 * Load and parse complete assay CSV file into state object
 * @param {File|Blob} file - Assay CSV file
 * @param {string} focusedHoleId - Hole ID to focus on
 * @param {Object|null} sourceColumnMap - Optional column name mappings
 * @returns {Promise<Object>} Complete assay state
 * @throws {Error} If no valid assay intervals found
 */
export async function loadAssayFile(file, focusedHoleId = '', sourceColumnMap = null) {
  const { holes } = await parseAssaysCSV(file, sourceColumnMap);
  const state = buildAssayState(holes, focusedHoleId);
  if (!state) throw new Error('No valid assay intervals found.');
  return state;
}
