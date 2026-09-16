/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { ASSAY_COLOR_PALETTE_10, buildEqualRangeColorScale, getEqualRangeBinIndex } from './assayColorScale.js';

/** Default colour for depths with no interval data */
export const NO_DATA_COLOR = '#9ca3af';
/** Colour used by the "has assay data" presence mode */
export const PRESENCE_COLOR = '#ff8c42';
/** Default number of texels per hole row in the interval texture */
export const DEFAULT_DEPTH_TEXELS = 1024;
/** Width of the colour ramp texture */
export const RAMP_WIDTH = 256;

/**
 * Produce a deterministic float in [0, 1) from an input string (FNV-1a hash)
 */
export function seededUnit(input) {
  const text = `${input ?? ''}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

/**
 * Get a deterministic hex colour for a categorical value using FNV-1a hash → HSL
 */
export function getCategoryHexColor(category) {
  if (!category || !String(category).trim()) return NO_DATA_COLOR;
  const h = seededUnit(String(category).toLowerCase().trim());
  return '#' + new THREE.Color().setHSL(h, 0.70, 0.50).getHexString();
}

/**
 * Base colour for a hole when no attribute is selected: golden-angle hue walk
 * so neighbouring holes are always distinguishable.
 * @param {number} index
 * @returns {THREE.Color}
 */
export function holeBaseColor(index) {
  const hue = ((index * 137.5) % 360) / 360;
  return new THREE.Color().setHSL(hue, 0.62, 0.52);
}

/**
 * Normalise hole key to lowercase trimmed string for case-insensitive matching
 */
export function normalizeHoleKey(value) {
  return `${value ?? ''}`.trim().toLowerCase();
}

/**
 * Find the interval list for a hole, matching on the exact id first and the
 * normalised id second.
 */
export function resolveIntervalsForHole(holeId, intervalsByHole) {
  if (!intervalsByHole || holeId == null) return [];
  const exact = intervalsByHole[holeId];
  if (Array.isArray(exact) && exact.length) return exact;
  const normalized = normalizeHoleKey(holeId);
  const byNormalized = normalized ? intervalsByHole[normalized] : null;
  if (Array.isArray(byNormalized) && byNormalized.length) return byNormalized;
  // Fall back to a case-insensitive scan of the map's own keys.
  for (const key of Object.keys(intervalsByHole)) {
    if (normalizeHoleKey(key) === normalized) {
      const list = intervalsByHole[key];
      if (Array.isArray(list) && list.length) return list;
    }
  }
  return [];
}

/**
 * Build a normalised-key lookup once so per-hole resolution is O(1) even
 * when the caller's keys are not normalised.
 */
function makeIntervalResolver(intervalsByHole) {
  if (!intervalsByHole) return () => [];
  const byNorm = new Map();
  Object.keys(intervalsByHole).forEach((key) => {
    const list = intervalsByHole[key];
    if (Array.isArray(list) && list.length) byNorm.set(normalizeHoleKey(key), list);
  });
  return (holeId) => {
    const exact = intervalsByHole[holeId];
    if (Array.isArray(exact) && exact.length) return exact;
    return byNorm.get(normalizeHoleKey(holeId)) || [];
  };
}

/**
 * Work out which colouring mode a set of render options implies.
 * @returns {'none'|'presence'|'numeric'|'categorical'}
 */
export function resolveColorMode({ selectedAssayVariable = '', isCategoricalVariable = false } = {}) {
  if (!selectedAssayVariable) return 'none';
  if (selectedAssayVariable === '__HAS_ASSAY__') return 'presence';
  return isCategoricalVariable ? 'categorical' : 'numeric';
}

/**
 * Parse a CSS hex colour into [r, g, b] bytes.
 */
export function hexToRgbBytes(hex) {
  const s = String(hex || '').trim().replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  const n = parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [156, 163, 175];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Build everything needed to colour the merged drillhole mesh for one
 * attribute: a float interval texture (one row per hole, x = normalised
 * measured depth), a 256-wide colour ramp, and a legend that matches.
 *
 * @param {Array<object>} holesMeta - hole metadata from buildDrillholeTubeGeometry
 * @param {object} options
 * @param {'none'|'presence'|'numeric'|'categorical'} [options.mode]
 * @param {object|null} [options.intervalsByHole] - { holeId: [{from, to, value}] }
 * @param {string[]} [options.palette] - hex colours for numeric ramps
 * @param {'quantile'|'linear'|'log'} [options.scaleMode='quantile']
 * @param {boolean} [options.continuous=false] - smooth ramp (linear/log only)
 * @param {number} [options.bins] - bin count for binned numeric modes (default palette length)
 * @param {object|null} [options.categoryColorMap] - { category: hex }
 * @param {string[]} [options.categoryOrder] - explicit category ordering
 * @param {number} [options.depthTexels=1024]
 * @param {string} [options.variable] - label for the legend
 * @returns {object} colour layer descriptor
 */
export function buildDrillholeColorLayer(holesMeta, options = {}) {
  const mode = options.mode || 'none';
  const width = Math.max(16, Math.floor(options.depthTexels || DEFAULT_DEPTH_TEXELS));
  const height = Math.max(1, holesMeta.length);
  const palette = Array.isArray(options.palette) && options.palette.length ? options.palette : ASSAY_COLOR_PALETTE_10;

  const layer = {
    mode,
    variable: options.variable || '',
    width,
    height,
    intervalData: null,
    rampBytes: null,
    rampContinuous: false,
    legend: { mode, variable: options.variable || '', entries: [] },
    scale: null,
    categories: [],
    noDataColor: NO_DATA_COLOR,
  };

  if (mode === 'none') {
    layer.legend.entries = [];
    return layer;
  }

  const data = new Float32Array(width * height).fill(-1);
  layer.intervalData = data;
  const intervalsFor = makeIntervalResolver(options.intervalsByHole);

  if (mode === 'presence') {
    holesMeta.forEach((hole) => {
      const intervals = intervalsFor(hole.id);
      paintIntervals(data, hole, width, intervals, () => 1);
    });
    layer.rampBytes = solidRamp(PRESENCE_COLOR);
    layer.legend.entries = [
      { color: PRESENCE_COLOR, label: 'Has assay data' },
      { color: NO_DATA_COLOR, label: 'No assay data' },
    ];
    return layer;
  }

  if (mode === 'categorical') {
    const seen = new Set();
    const perHole = holesMeta.map((hole) => {
      const intervals = intervalsFor(hole.id);
      intervals.forEach((iv) => {
        const v = iv?.value;
        if (v != null && String(v).trim() !== '') seen.add(String(v).trim());
      });
      return intervals;
    });
    const categories = Array.isArray(options.categoryOrder) && options.categoryOrder.length
      ? options.categoryOrder.filter((c) => seen.has(c)).concat([...seen].filter((c) => !options.categoryOrder.includes(c)).sort())
      : [...seen].sort();
    const catIndex = new Map(categories.map((c, i) => [c, i]));
    const count = Math.max(1, categories.length);
    holesMeta.forEach((hole, i) => {
      paintIntervals(data, hole, width, perHole[i], (iv) => {
        const key = iv?.value == null ? '' : String(iv.value).trim();
        const idx = catIndex.get(key);
        return idx === undefined ? -1 : (idx + 0.5) / count;
      });
    });
    const colours = categories.map((c) => options.categoryColorMap?.[c] || getCategoryHexColor(c));
    layer.categories = categories;
    layer.rampBytes = steppedRamp(colours);
    layer.legend.entries = categories.map((c, i) => ({ color: colours[i], label: c, category: c }));
    return layer;
  }

  // numeric
  const values = [];
  const perHole = holesMeta.map((hole) => {
    const intervals = intervalsFor(hole.id);
    intervals.forEach((iv) => {
      const v = Number(iv?.value);
      if (Number.isFinite(v)) values.push(v);
    });
    return intervals;
  });
  let scaleMode = options.scaleMode || 'quantile';
  // A log scale needs at least one positive value; otherwise fall back to
  // linear rather than producing NaN texels and an empty legend.
  if (scaleMode === 'log' && !values.some((v) => v > 0)) scaleMode = 'linear';
  const continuous = Boolean(options.continuous) && scaleMode !== 'quantile';
  const binCount = Math.max(2, Math.floor(options.bins || palette.length));
  const binColours = resamplePalette(palette, binCount);

  if (!values.length) {
    layer.rampBytes = steppedRamp(binColours);
    layer.legend.entries = [{ color: NO_DATA_COLOR, label: 'No data' }];
    return layer;
  }

  let min = Infinity, max = -Infinity;
  values.forEach((v) => { if (v < min) min = v; if (v > max) max = v; });

  let toNorm;
  if (scaleMode === 'quantile') {
    const scale = buildEqualRangeColorScale(values, binColours);
    layer.scale = scale;
    toNorm = (v) => {
      const bin = getEqualRangeBinIndex(v, scale);
      return bin < 0 ? -1 : (bin + 0.5) / binCount;
    };
    layer.rampBytes = steppedRamp(binColours);
    layer.legend.entries = scale.bins.map((bin, i) => ({ color: binColours[i], label: bin.label, min: bin.min, max: bin.max }));
  } else if (scaleMode === 'log') {
    let floor = Infinity;
    values.forEach((v) => { if (v > 0 && v < floor) floor = v; });
    if (floor >= max) floor = max / 10; // a single positive value still gets a usable range
    const lo = Math.log10(floor);
    const hi = Math.log10(Math.max(max, floor * 10));
    const span = Math.max(hi - lo, 1e-9);
    toNorm = (v) => clamp01((Math.log10(Math.max(v, floor)) - lo) / span);
    layer.scale = { min: floor, max, mode: 'log' };
    layer.legend.scaleMode = 'log';
    layer.rampBytes = continuous ? interpolatedRamp(palette) : steppedRamp(binColours);
    layer.rampContinuous = continuous;
    layer.legend.entries = logLegend(floor, max, binCount, binColours, continuous, palette);
  } else {
    const span = Math.max(max - min, 1e-12);
    toNorm = (v) => clamp01((v - min) / span);
    layer.scale = { min, max, mode: 'linear' };
    layer.legend.scaleMode = 'linear';
    layer.rampBytes = continuous ? interpolatedRamp(palette) : steppedRamp(binColours);
    layer.rampContinuous = continuous;
    layer.legend.entries = linearLegend(min, max, binCount, binColours, continuous, palette);
  }

  holesMeta.forEach((hole, i) => {
    paintIntervals(data, hole, width, perHole[i], (iv) => {
      const v = Number(iv?.value);
      return Number.isFinite(v) ? toNorm(v) : -1;
    });
  });
  return layer;
}

/**
 * Create the GPU texture for a colour layer's interval data.
 * @param {object} layer - from buildDrillholeColorLayer
 * @returns {THREE.DataTexture|null}
 */
export function createIntervalTexture(layer) {
  if (!layer?.intervalData) return null;
  const tex = new THREE.DataTexture(layer.intervalData, layer.width, layer.height, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Create the GPU texture for a colour layer's ramp.
 * @param {object} layer - from buildDrillholeColorLayer
 * @returns {THREE.DataTexture}
 */
export function createRampTexture(layer) {
  const bytes = layer?.rampBytes || solidRamp(NO_DATA_COLOR);
  const tex = new THREE.DataTexture(bytes, RAMP_WIDTH, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = layer?.rampContinuous ? THREE.LinearFilter : THREE.NearestFilter;
  tex.minFilter = tex.magFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Per-hole RGBA float texture: rgb = base colour (linear), a = visible flag.
 * @param {Array<object>} holesMeta
 * @param {object} [opts]
 * @param {Set<string>|null} [opts.visibleIds] - null means everything visible
 * @param {Map<string,string>|object|null} [opts.baseColors] - optional explicit hex per hole id
 * @returns {Float32Array}
 */
export function buildHoleTextureData(holesMeta, opts = {}) {
  const count = Math.max(1, holesMeta.length);
  const data = new Float32Array(count * 4);
  const visible = opts.visibleIds instanceof Set ? opts.visibleIds : null;
  holesMeta.forEach((hole, i) => {
    const custom = opts.baseColors instanceof Map ? opts.baseColors.get(hole.id) : opts.baseColors?.[hole.id];
    const c = custom ? new THREE.Color(custom) : holeBaseColor(i);
    data[i * 4] = c.r;
    data[i * 4 + 1] = c.g;
    data[i * 4 + 2] = c.b;
    data[i * 4 + 3] = visible === null || visible.has(hole.id) || visible.has(normalizeHoleKey(hole.id)) ? 1 : 0;
  });
  return data;
}

/**
 * Create the per-hole GPU texture.
 * @param {Float32Array} data - from buildHoleTextureData
 * @param {number} count - hole count
 */
export function createHoleTexture(data, count) {
  const tex = new THREE.DataTexture(data, Math.max(1, count), 1, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * CPU-side colour lookup that mirrors the shader exactly.  Used by the
 * fat-line level of detail so the two representations never disagree.
 * @param {object} layer - colour layer
 * @param {number} holeIndex
 * @param {number} mdNorm - normalised depth in [0, 1]
 * @param {THREE.Color} [fallback] - base colour for mode 'none'
 * @returns {[number, number, number]} rgb bytes
 */
export function sampleLayerColorBytes(layer, holeIndex, mdNorm, fallback) {
  if (!layer || layer.mode === 'none' || !layer.intervalData) {
    const c = fallback || holeBaseColor(holeIndex);
    return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
  }
  const x = Math.min(layer.width - 1, Math.max(0, Math.floor(mdNorm * layer.width)));
  const t = layer.intervalData[holeIndex * layer.width + x];
  if (t < 0) return hexToRgbBytes(NO_DATA_COLOR);
  const ri = Math.min(RAMP_WIDTH - 1, Math.max(0, Math.floor(t * RAMP_WIDTH)));
  return [layer.rampBytes[ri * 4], layer.rampBytes[ri * 4 + 1], layer.rampBytes[ri * 4 + 2]];
}

/**
 * Enumerate constant-colour runs along a hole row of the interval texture.
 * Returns [{ start, end, value }] in normalised depth.
 */
export function intervalRunsForHole(layer, holeIndex) {
  const runs = [];
  if (!layer?.intervalData) return [{ start: 0, end: 1, value: -1 }];
  const w = layer.width;
  const base = holeIndex * w;
  let runStart = 0;
  let current = layer.intervalData[base];
  for (let x = 1; x <= w; x += 1) {
    const v = x < w ? layer.intervalData[base + x] : NaN;
    if (x === w || v !== current) {
      runs.push({ start: runStart / w, end: x / w, value: current });
      runStart = x;
      current = v;
    }
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function paintIntervals(data, hole, width, intervals, valueOf) {
  if (!intervals?.length) return;
  const base = hole.index * width;
  const { mdMin, length } = hole;
  for (let i = 0; i < intervals.length; i += 1) {
    const iv = intervals[i];
    const from = Number(iv?.from);
    const to = Number(iv?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    const v = valueOf(iv);
    if (!Number.isFinite(v)) continue;
    let x0 = Math.floor(((from - mdMin) / length) * width);
    let x1 = Math.ceil(((to - mdMin) / length) * width);
    if (x1 <= x0) x1 = x0 + 1;
    x0 = Math.max(0, x0);
    x1 = Math.min(width, x1);
    for (let x = x0; x < x1; x += 1) data[base + x] = v;
  }
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function solidRamp(hex) {
  const [r, g, b] = hexToRgbBytes(hex);
  const bytes = new Uint8Array(RAMP_WIDTH * 4);
  for (let i = 0; i < RAMP_WIDTH; i += 1) {
    bytes[i * 4] = r; bytes[i * 4 + 1] = g; bytes[i * 4 + 2] = b; bytes[i * 4 + 3] = 255;
  }
  return bytes;
}

function steppedRamp(colours) {
  if (!colours?.length) return solidRamp(NO_DATA_COLOR);
  const n = colours.length;
  const rgb = colours.map(hexToRgbBytes);
  const bytes = new Uint8Array(RAMP_WIDTH * 4);
  for (let i = 0; i < RAMP_WIDTH; i += 1) {
    const idx = Math.min(n - 1, Math.floor((i / RAMP_WIDTH) * n));
    const [r, g, b] = rgb[idx];
    bytes[i * 4] = r; bytes[i * 4 + 1] = g; bytes[i * 4 + 2] = b; bytes[i * 4 + 3] = 255;
  }
  return bytes;
}

function interpolatedRamp(colours) {
  if (!colours?.length) return solidRamp(NO_DATA_COLOR);
  const rgb = colours.map(hexToRgbBytes);
  const bytes = new Uint8Array(RAMP_WIDTH * 4);
  const segs = Math.max(1, rgb.length - 1);
  for (let i = 0; i < RAMP_WIDTH; i += 1) {
    const t = (i / (RAMP_WIDTH - 1)) * segs;
    const k = Math.min(segs - 1, Math.floor(t));
    const f = t - k;
    const a = rgb[k], b = rgb[Math.min(rgb.length - 1, k + 1)];
    bytes[i * 4] = Math.round(a[0] + (b[0] - a[0]) * f);
    bytes[i * 4 + 1] = Math.round(a[1] + (b[1] - a[1]) * f);
    bytes[i * 4 + 2] = Math.round(a[2] + (b[2] - a[2]) * f);
    bytes[i * 4 + 3] = 255;
  }
  return bytes;
}

function resamplePalette(palette, count) {
  if (palette.length === count) return palette.slice();
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : (i / (count - 1)) * (palette.length - 1);
    const k = Math.min(palette.length - 1, Math.round(t));
    out.push(palette[k]);
  }
  return out;
}

function fmt(v) {
  if (!Number.isFinite(v)) return 'n/a';
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  if (Math.abs(v) >= 0.1) return v.toFixed(2);
  return v.toFixed(3);
}

function linearLegend(min, max, binCount, binColours, continuous, palette) {
  if (continuous) {
    return palette.map((c, i) => ({ color: c, label: fmt(min + ((max - min) * i) / (palette.length - 1)), continuous: true }));
  }
  const step = (max - min) / binCount;
  return binColours.map((c, i) => ({ color: c, label: `${fmt(min + step * i)} – ${fmt(i === binCount - 1 ? max : min + step * (i + 1))}`, min: min + step * i, max: min + step * (i + 1) }));
}

function logLegend(floor, max, binCount, binColours, continuous, palette) {
  const lo = Math.log10(floor);
  const hi = Math.log10(Math.max(max, floor * 10));
  const at = (t) => Math.pow(10, lo + (hi - lo) * t);
  if (continuous) {
    return palette.map((c, i) => ({ color: c, label: fmt(at(i / (palette.length - 1))), continuous: true }));
  }
  return binColours.map((c, i) => ({ color: c, label: `${fmt(at(i / binCount))} – ${fmt(at((i + 1) / binCount))}`, min: at(i / binCount), max: at((i + 1) / binCount) }));
}
