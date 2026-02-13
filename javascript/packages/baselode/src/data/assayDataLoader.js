/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { parseAssayHole, parseAssayHoleIdsWithAssays, parseAssaysCSV } from './assayLoader.js';
import { ASSAY_NON_VALUE_FIELDS } from './assayFieldSets.js';
import { logDataInfo, logDataWarning } from './dataErrorUtils.js';
import { buildTraceConfigsForHoleIds, reorderHoleIds } from './traceGridConfig.js';

export const ASSAY_CACHE_KEY = 'baselode-assays-cache-v1';
export const ASSAY_CACHE_META_KEY = 'baselode-assays-meta-v1';
let cacheDisabled = false;
export { reorderHoleIds };

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

export async function loadAssayMetadata(file, config) {
  const holeIds = await parseAssayHoleIdsWithAssays(file, config);
  return holeIds;
}

export async function loadAssayHole(file, holeId, config) {
  const hole = await parseAssayHole(file, holeId, config);
  return hole;
}

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

export async function loadAssayFile(file, focusedHoleId = '', config) {
  const { holes } = await parseAssaysCSV(file, config);
  const state = buildAssayState(holes, focusedHoleId);
  if (!state) throw new Error('No valid assay intervals found.');
  return state;
}

export function loadCachedAssayState(focusedHoleId = '') {
  try {
    const raw = localStorage.getItem(ASSAY_CACHE_KEY);
    if (!raw) return null;
    const cachedHoles = JSON.parse(raw);
    const state = buildAssayState(Array.isArray(cachedHoles) ? cachedHoles : [], focusedHoleId);
    return state;
  } catch (e) {
    logDataWarning('Failed to load cached assays', e);
    return null;
  }
}

export function loadCachedAssayMeta() {
  try {
    const raw = localStorage.getItem(ASSAY_CACHE_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { numericProps = [], categoricalProps = [], defaultProp = '', holeCount = 0, updatedAt = 0 } = parsed;
    return { numericProps, categoricalProps, defaultProp, holeCount, updatedAt };
  } catch (e) {
    logDataWarning('Failed to load cached assay meta', e);
    return null;
  }
}

export function saveAssayCache(holes = [], meta = null, options = {}) {
  if (cacheDisabled) return false;
  const fallbackToMetaOnly = options?.fallbackToMetaOnly || false;
  try {
    localStorage.setItem(ASSAY_CACHE_KEY, JSON.stringify(holes));
    if (meta) {
      const payload = {
        numericProps: meta.numericProps || [],
        categoricalProps: meta.categoricalProps || [],
        defaultProp: meta.defaultProp || '',
        holeCount: Array.isArray(meta.holes) ? meta.holes.length : holes.length,
        updatedAt: Date.now()
      };
      localStorage.setItem(ASSAY_CACHE_META_KEY, JSON.stringify(payload));
    }
    return true;
  } catch (e) {
    if (e?.name === 'QuotaExceededError') {
      logDataInfo('Assay cache skipped due to storage quota. Popup will still work this session.');
      if (fallbackToMetaOnly && meta) {
        try {
          const payload = {
            numericProps: meta.numericProps || [],
            categoricalProps: meta.categoricalProps || [],
            defaultProp: meta.defaultProp || '',
            holeCount: Array.isArray(meta.holes) ? meta.holes.length : holes.length,
            updatedAt: Date.now()
          };
          localStorage.setItem(ASSAY_CACHE_META_KEY, JSON.stringify(payload));
        } catch (metaErr) {
          logDataWarning('Assay meta cache also failed due to quota', metaErr);
        }
      }
      // Do not permanently disable caching; allow retry after user clears storage.
    } else {
      logDataWarning('Failed to cache assays', e);
    }
    return false;
  }
}

export function clearAssayCache() {
  try {
    localStorage.removeItem(ASSAY_CACHE_KEY);
    localStorage.removeItem(ASSAY_CACHE_META_KEY);
  } catch (e) {
    logDataWarning('Failed to clear assay cache', e);
  }
}
