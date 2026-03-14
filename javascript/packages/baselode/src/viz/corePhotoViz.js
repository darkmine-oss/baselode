/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Core photo table visualization helpers.
 *
 * Provides depth-ordered layout utilities, LOD image selection, and depth
 * marker generation for the CorePhotoTable component.
 */

/**
 * Default LOD (Level of Detail) breakpoints.
 *
 * At low zoom values small/thumbnail images are loaded; at high zoom values
 * full-resolution images are used. Each entry specifies the minimum zoom level
 * that activates the corresponding LOD key.
 *
 * Photo objects may supply a ``lod_urls`` map keyed by these values. If a
 * photo has no ``lod_urls``, ``image_url`` is used regardless of zoom.
 */
export const DEFAULT_LOD_BREAKPOINTS = [
  { minZoom: 0, lodKey: 'thumb' },
  { minZoom: 4, lodKey: 'medium' },
  { minZoom: 7, lodKey: 'full' },
];

/**
 * Base pixels-per-metre at zoom level 5.  At other zoom levels this value is
 * scaled linearly so that ``pixelsPerMetre = BASE_PIXELS_PER_METRE * zoom / 5``.
 */
export const BASE_PIXELS_PER_METRE = 50;

/**
 * Select the image URL appropriate for the given zoom level.
 *
 * If the photo object contains a ``lod_urls`` map the function returns the
 * URL for the highest LOD whose ``minZoom`` is still ≤ the current zoom
 * level.  If no ``lod_urls`` are present (or the resolved key is missing)
 * the function falls back to ``photo.image_url``.
 *
 * @param {Object} photo - Photo entry. Expected fields: ``image_url`` (string),
 *   ``lod_urls`` (optional object mapping lodKey → URL string).
 * @param {number} zoom - Current zoom level (1–10).
 * @param {Array<{minZoom: number, lodKey: string}>} [lodBreakpoints] - LOD
 *   breakpoints to use. Defaults to {@link DEFAULT_LOD_BREAKPOINTS}.
 * @returns {string} The selected image URL, or an empty string if none found.
 */
export function selectPhotoLodUrl(photo, zoom, lodBreakpoints = DEFAULT_LOD_BREAKPOINTS) {
  const lodUrls = photo.lod_urls;
  if (!lodUrls || typeof lodUrls !== 'object' || Array.isArray(lodUrls)) {
    return photo.image_url || '';
  }

  // Walk breakpoints and keep the last one whose minZoom ≤ zoom.
  let selectedKey = lodBreakpoints[0]?.lodKey ?? 'thumb';
  for (const bp of lodBreakpoints) {
    if (zoom >= bp.minZoom) {
      selectedKey = bp.lodKey;
    }
  }

  return lodUrls[selectedKey] || photo.image_url || '';
}

/**
 * Return a copy of ``photos`` sorted ascending by ``from_depth``.
 *
 * @param {Array<Object>} photos - Array of photo objects, each with a
 *   numeric ``from_depth`` field.
 * @returns {Array<Object>} New sorted array.
 */
export function sortPhotosByDepth(photos) {
  return [...photos].sort((a, b) => (a.from_depth ?? 0) - (b.from_depth ?? 0));
}

/**
 * Group photos by their ``photo_set`` value.
 *
 * Photos without a ``photo_set`` (null, undefined, or empty string) are
 * placed in the ``'default'`` group.  The returned object's keys preserve
 * insertion order (first-seen order within ``photos``).
 *
 * @param {Array<Object>} photos - Array of photo objects.
 * @returns {Object.<string, Array<Object>>} Map of set name → photo array.
 */
export function groupPhotosBySet(photos) {
  /** @type {Object.<string, Array<Object>>} */
  const sets = {};
  for (const photo of photos) {
    const key =
      photo.photo_set != null && photo.photo_set !== ''
        ? String(photo.photo_set)
        : 'default';
    if (!sets[key]) sets[key] = [];
    sets[key].push(photo);
  }
  return sets;
}

/**
 * Build an array of depth marker descriptors at regular intervals.
 *
 * Markers start at the first multiple of ``intervalMetres`` that is ≥
 * ``minDepth`` and continue up to and including ``maxDepth``.
 *
 * @param {number} minDepth - Shallowest depth of the view (m).
 * @param {number} maxDepth - Deepest depth of the view (m).
 * @param {number} [intervalMetres=10] - Spacing between markers in metres.
 * @returns {Array<{depth: number, label: string}>} Ordered marker descriptors.
 */
export function buildDepthMarkers(minDepth, maxDepth, intervalMetres = 10) {
  const markers = [];
  if (minDepth >= maxDepth || intervalMetres <= 0) return markers;

  const first = Math.ceil(minDepth / intervalMetres) * intervalMetres;
  // Guard against floating-point drift with a small epsilon.
  const epsilon = intervalMetres * 1e-9;
  for (let d = first; d <= maxDepth + epsilon; d += intervalMetres) {
    const rounded = Math.round(d * 1e6) / 1e6;
    markers.push({ depth: rounded, label: `${rounded} m` });
  }
  return markers;
}

/**
 * Choose an appropriate depth-marker interval (in metres) for the given zoom
 * level so that labels are legible without overcrowding.
 *
 * @param {number} zoom - Current zoom level (1–10).
 * @returns {number} Interval in metres.
 */
export function depthMarkerInterval(zoom) {
  if (zoom >= 9) return 1;
  if (zoom >= 7) return 2;
  if (zoom >= 5) return 5;
  if (zoom >= 3) return 10;
  return 20;
}

/**
 * Default filename generator used by {@link buildTrayPhotos}.
 *
 * @param {number} index - Zero-based tray index.
 * @returns {string}
 */
export function defaultTrayFilename(index) {
  return `tray_${String(index).padStart(3, '0')}.jpg`;
}

/**
 * Build a CorePhotoTable-compatible photos array from tray depth intervals
 * and a pair of image base URLs.
 *
 * This is the same transform performed internally by CorePhotoViewer; it is
 * exported so callers that need to combine multiple datasets (e.g. two
 * concurrent scan runs for the same hole) can build the array themselves and
 * pass it directly to CorePhotoTable.
 *
 * @param {string} holeId - Drillhole identifier stored on every photo entry.
 * @param {Array<{
 *   fromDepth: number,
 *   toDepth:   number,
 *   filename?: string,
 *   photoSet?: string
 * }>} trays - One entry per image, in any depth order.
 * @param {string} thumbBaseUrl - URL prefix for thumbnail images.
 * @param {string} fullBaseUrl  - URL prefix for full-resolution images.
 * @param {string} [photoSet='Tray Images'] - Default column label; overridden
 *   per-tray via ``tray.photoSet``.
 * @param {function} [getFilename] - ``(index: number) => string`` filename
 *   generator. ``index`` is the zero-based position in ``trays``.  Defaults to
 *   {@link defaultTrayFilename} (``tray_000.jpg``, ``tray_001.jpg``, …).
 * @returns {Array<Object>} Photos array suitable for ``CorePhotoTable.photos``.
 */
export function buildTrayPhotos(
  holeId,
  trays,
  thumbBaseUrl,
  fullBaseUrl,
  photoSet = 'Tray Images',
  getFilename = defaultTrayFilename,
) {
  const thumb = (thumbBaseUrl ?? '').replace(/\/$/, '');
  const full  = (fullBaseUrl  ?? '').replace(/\/$/, '');
  return trays.map((tray, index) => {
    const filename = tray.filename ?? getFilename(index);
    const set      = tray.photoSet ?? photoSet;
    return {
      hole_id:    holeId,
      from_depth: tray.fromDepth,
      to_depth:   tray.toDepth,
      photo_set:  set,
      image_url:  `${thumb}/${filename}`,
      lod_urls: {
        thumb: `${thumb}/${filename}`,
        full:  `${full}/${filename}`,
      },
    };
  });
}

/**
 * Convert a depth interval in metres to a pixel height for the given zoom.
 *
 * Uses a linear scale so that the displayed height is always proportional to
 * the physical depth span, enabling correct alignment across photo columns.
 *
 * @param {number} depthInterval - Depth span in metres (``to_depth - from_depth``).
 * @param {number} zoom - Current zoom level (1–10).
 * @param {number} [basePixelsPerMetre] - Pixels per metre at zoom 5.
 *   Defaults to {@link BASE_PIXELS_PER_METRE}.
 * @returns {number} Pixel height (always ≥ 1).
 */
export function depthIntervalToPixels(depthInterval, zoom, basePixelsPerMetre = BASE_PIXELS_PER_METRE) {
  const scale = zoom / 5;
  return Math.max(1, Math.round(depthInterval * basePixelsPerMetre * scale));
}
