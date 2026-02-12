/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { parseAssayHole, parseAssayHoleIdsWithAssays, parseAssaysCSV } from './assayLoader';

export const ASSAY_CACHE_KEY = 'baselode-assays-cache-v1';
export const ASSAY_CACHE_META_KEY = 'baselode-assays-meta-v1';
let cacheDisabled = false;

export function reorderHoleIds(ids = [], focusId = '') {
  if (!ids.length) return [];
  if (!focusId) return ids;
  const matchIdx = ids.findIndex((id) => id === focusId);
  if (matchIdx === -1) return ids;
  const selected = ids[matchIdx];
  const rest = ids.filter((_, idx) => idx !== matchIdx);
  return [selected, ...rest];
}

export function deriveAssayProps(holes = []) {
  const exclude = new Set([
    'hole_id',
    'holeid',
    'id',
    'holeId',
    'project_code',
    'project',
    'latitude',
    'longitude',
    'lat',
    'lng',
    'elevation',
    'dip',
    'azimuth',
    'holetype',
    'shape',
    'anumber',
    'collarid',
    'companyholeid',
    'company_hole_id',
    'samp_from',
    'samp_to',
    'sample_from',
    'sample_to',
    'from',
    'to',
    'depth_from',
    'depth_to',
    'fromdepth',
    'todepth',
    'comment',
    'z'
  ]);

  const points = holes.flatMap((h) => h.points || []);
  const candidates = new Set();
  points.forEach((p) => {
    Object.keys(p || {}).forEach((k) => {
      if (!exclude.has(k)) candidates.add(k);
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

function buildInitialTraceConfigs(holes = [], defaultProp = '', categoricalProps = [], focusedHoleId = '') {
  const holeIds = holes.map((h) => h.id || h.holeId).filter(Boolean);
  const ordered = reorderHoleIds(holeIds, focusedHoleId).slice(0, 4);
  const defaultChartType = defaultProp && categoricalProps.includes(defaultProp) ? 'categorical' : 'line';
  return Array.from({ length: 4 }).map((_, idx) => ({
    holeId: ordered[idx] || holeIds[idx] || '',
    property: defaultProp,
    chartType: defaultChartType
  }));
}

export function buildAssayState(holes = [], focusedHoleId = '') {
  if (!holes.length) return null;
  const { numericProps, categoricalProps, defaultProp } = deriveAssayProps(holes);
  const traceConfigs = buildInitialTraceConfigs(holes, defaultProp, categoricalProps, focusedHoleId);
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
    console.warn('Failed to load cached assays', e);
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
    console.warn('Failed to load cached assay meta', e);
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
      console.info('Assay cache skipped due to storage quota. Popup will still work this session.');
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
          console.warn('Assay meta cache also failed due to quota', metaErr);
        }
      }
      // Do not permanently disable caching; allow retry after user clears storage.
    } else {
      console.warn('Failed to cache assays', e);
    }
    return false;
  }
}

export function clearAssayCache() {
  try {
    localStorage.removeItem(ASSAY_CACHE_KEY);
    localStorage.removeItem(ASSAY_CACHE_META_KEY);
  } catch (e) {
    console.warn('Failed to clear assay cache', e);
  }
}
