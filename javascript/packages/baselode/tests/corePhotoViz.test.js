/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import {
  BASE_PIXELS_PER_METRE,
  DEFAULT_LOD_BREAKPOINTS,
  buildDepthMarkers,
  buildTrayPhotos,
  defaultTrayFilename,
  depthIntervalToPixels,
  depthMarkerInterval,
  groupPhotosBySet,
  selectPhotoLodUrl,
  sortPhotosByDepth,
} from '../src/viz/corePhotoViz.js';


// ── DEFAULT_LOD_BREAKPOINTS ───────────────────────────────────────────────

describe('DEFAULT_LOD_BREAKPOINTS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(DEFAULT_LOD_BREAKPOINTS)).toBe(true);
    expect(DEFAULT_LOD_BREAKPOINTS.length).toBeGreaterThan(0);
  });

  it('every entry has minZoom and lodKey', () => {
    for (const bp of DEFAULT_LOD_BREAKPOINTS) {
      expect(typeof bp.minZoom).toBe('number');
      expect(typeof bp.lodKey).toBe('string');
    }
  });

  it('first entry starts at minZoom 0', () => {
    expect(DEFAULT_LOD_BREAKPOINTS[0].minZoom).toBe(0);
  });
});


// ── selectPhotoLodUrl ─────────────────────────────────────────────────────

describe('selectPhotoLodUrl', () => {
  const photo = {
    image_url: 'https://example.com/photo.jpg',
    lod_urls: {
      thumb: 'https://example.com/photo_thumb.jpg',
      medium: 'https://example.com/photo_medium.jpg',
      full: 'https://example.com/photo_full.jpg',
    },
  };

  it('returns thumb at low zoom (1)', () => {
    expect(selectPhotoLodUrl(photo, 1)).toBe(photo.lod_urls.thumb);
  });

  it('returns medium at zoom 4', () => {
    expect(selectPhotoLodUrl(photo, 4)).toBe(photo.lod_urls.medium);
  });

  it('returns full at zoom 7', () => {
    expect(selectPhotoLodUrl(photo, 7)).toBe(photo.lod_urls.full);
  });

  it('returns full at zoom 10', () => {
    expect(selectPhotoLodUrl(photo, 10)).toBe(photo.lod_urls.full);
  });

  it('falls back to image_url when no lod_urls present', () => {
    const simple = { image_url: 'https://example.com/photo.jpg' };
    expect(selectPhotoLodUrl(simple, 5)).toBe(simple.image_url);
  });

  it('falls back to image_url when lod_urls is null', () => {
    const p = { image_url: 'fallback.jpg', lod_urls: null };
    expect(selectPhotoLodUrl(p, 5)).toBe('fallback.jpg');
  });

  it('falls back to image_url when lod_urls is an array', () => {
    const p = { image_url: 'fallback.jpg', lod_urls: ['a', 'b'] };
    expect(selectPhotoLodUrl(p, 5)).toBe('fallback.jpg');
  });

  it('returns empty string when no image_url and no lod_urls', () => {
    expect(selectPhotoLodUrl({}, 5)).toBe('');
  });

  it('falls back to image_url when the resolved lod key is missing', () => {
    const p = {
      image_url: 'fallback.jpg',
      lod_urls: { thumb: 'thumb.jpg' },
    };
    expect(selectPhotoLodUrl(p, 7)).toBe('fallback.jpg');
  });
});


// ── sortPhotosByDepth ─────────────────────────────────────────────────────

describe('sortPhotosByDepth', () => {
  it('returns a new array sorted by from_depth ascending', () => {
    const photos = [
      { from_depth: 30 },
      { from_depth: 10 },
      { from_depth: 20 },
    ];
    const sorted = sortPhotosByDepth(photos);
    expect(sorted.map((p) => p.from_depth)).toEqual([10, 20, 30]);
  });

  it('does not mutate the input array', () => {
    const photos = [{ from_depth: 5 }, { from_depth: 2 }];
    const original = [...photos];
    sortPhotosByDepth(photos);
    expect(photos).toEqual(original);
  });

  it('treats missing from_depth as 0', () => {
    const photos = [{ from_depth: 5 }, {}, { from_depth: 1 }];
    const sorted = sortPhotosByDepth(photos);
    expect(sorted[0].from_depth).toBeUndefined(); // treated as 0
    expect(sorted[1].from_depth).toBe(1);
    expect(sorted[2].from_depth).toBe(5);
  });

  it('returns empty array for empty input', () => {
    expect(sortPhotosByDepth([])).toEqual([]);
  });
});


// ── groupPhotosBySet ──────────────────────────────────────────────────────

describe('groupPhotosBySet', () => {
  it('groups photos by photo_set', () => {
    const photos = [
      { photo_set: 'wet', from_depth: 0 },
      { photo_set: 'dry', from_depth: 0 },
      { photo_set: 'wet', from_depth: 10 },
    ];
    const groups = groupPhotosBySet(photos);
    expect(Object.keys(groups)).toEqual(['wet', 'dry']);
    expect(groups.wet).toHaveLength(2);
    expect(groups.dry).toHaveLength(1);
  });

  it('places photos without photo_set in "default" group', () => {
    const photos = [{ from_depth: 0 }, { photo_set: null, from_depth: 5 }];
    const groups = groupPhotosBySet(photos);
    expect(groups).toHaveProperty('default');
    expect(groups.default).toHaveLength(2);
  });

  it('places photos with empty string photo_set in "default" group', () => {
    const photos = [{ photo_set: '', from_depth: 0 }];
    const groups = groupPhotosBySet(photos);
    expect(groups).toHaveProperty('default');
  });

  it('coerces photo_set to string', () => {
    const photos = [{ photo_set: 42, from_depth: 0 }];
    const groups = groupPhotosBySet(photos);
    expect(groups).toHaveProperty('42');
  });

  it('returns empty object for empty input', () => {
    expect(groupPhotosBySet([])).toEqual({});
  });
});


// ── buildDepthMarkers ─────────────────────────────────────────────────────

describe('buildDepthMarkers', () => {
  it('produces markers at regular intervals', () => {
    const markers = buildDepthMarkers(0, 30, 10);
    expect(markers.map((m) => m.depth)).toEqual([0, 10, 20, 30]);
  });

  it('starts at first multiple of interval ≥ minDepth', () => {
    const markers = buildDepthMarkers(5, 25, 10);
    expect(markers[0].depth).toBe(10);
    expect(markers.map((m) => m.depth)).toEqual([10, 20]);
  });

  it('includes maxDepth when it is exactly on an interval boundary', () => {
    const markers = buildDepthMarkers(0, 20, 10);
    expect(markers.map((m) => m.depth)).toEqual([0, 10, 20]);
  });

  it('returns empty array when minDepth >= maxDepth', () => {
    expect(buildDepthMarkers(10, 10, 5)).toEqual([]);
    expect(buildDepthMarkers(20, 10, 5)).toEqual([]);
  });

  it('returns empty array for non-positive interval', () => {
    expect(buildDepthMarkers(0, 100, 0)).toEqual([]);
    expect(buildDepthMarkers(0, 100, -5)).toEqual([]);
  });

  it('each marker has a label string', () => {
    const markers = buildDepthMarkers(0, 10, 5);
    for (const m of markers) {
      expect(typeof m.label).toBe('string');
      expect(m.label.length).toBeGreaterThan(0);
    }
  });
});


// ── depthMarkerInterval ───────────────────────────────────────────────────

describe('depthMarkerInterval', () => {
  it('returns 20 at zoom 1', () => {
    expect(depthMarkerInterval(1)).toBe(20);
  });

  it('returns 10 at zoom 3', () => {
    expect(depthMarkerInterval(3)).toBe(10);
  });

  it('returns 5 at zoom 5', () => {
    expect(depthMarkerInterval(5)).toBe(5);
  });

  it('returns 2 at zoom 7', () => {
    expect(depthMarkerInterval(7)).toBe(2);
  });

  it('returns 1 at zoom 9', () => {
    expect(depthMarkerInterval(9)).toBe(1);
  });

  it('returns 1 at zoom 10', () => {
    expect(depthMarkerInterval(10)).toBe(1);
  });
});


// ── depthIntervalToPixels ─────────────────────────────────────────────────

describe('depthIntervalToPixels', () => {
  it('uses BASE_PIXELS_PER_METRE at zoom 5', () => {
    expect(depthIntervalToPixels(1, 5)).toBe(BASE_PIXELS_PER_METRE);
  });

  it('doubles height when zoom doubles (5 → 10)', () => {
    const h5  = depthIntervalToPixels(1, 5);
    const h10 = depthIntervalToPixels(1, 10);
    expect(h10).toBe(h5 * 2);
  });

  it('halves height when zoom halves (5 → 2.5)', () => {
    const h5   = depthIntervalToPixels(10, 5);
    const h2_5 = depthIntervalToPixels(10, 2.5);
    expect(h2_5 / h5).toBeCloseTo(0.5, 1);
  });

  it('returns at least 1 for tiny intervals', () => {
    expect(depthIntervalToPixels(0, 5)).toBeGreaterThanOrEqual(1);
    expect(depthIntervalToPixels(-5, 5)).toBeGreaterThanOrEqual(1);
  });

  it('respects a custom basePixelsPerMetre', () => {
    expect(depthIntervalToPixels(1, 5, 40)).toBe(40);
  });
});


// ── defaultTrayFilename ───────────────────────────────────────────────────

describe('defaultTrayFilename', () => {
  it('generates zero-padded three-digit filenames', () => {
    expect(defaultTrayFilename(0)).toBe('tray_000.jpg');
    expect(defaultTrayFilename(1)).toBe('tray_001.jpg');
    expect(defaultTrayFilename(99)).toBe('tray_099.jpg');
    expect(defaultTrayFilename(100)).toBe('tray_100.jpg');
  });
});


// ── buildTrayPhotos ───────────────────────────────────────────────────────

describe('buildTrayPhotos', () => {
  const trays = [
    { fromDepth: 0.0, toDepth: 3.4 },
    { fromDepth: 3.4, toDepth: 6.8 },
  ];

  it('returns one photo entry per tray', () => {
    const photos = buildTrayPhotos('DDH-001', trays, '/thumb', '/full');
    expect(photos).toHaveLength(2);
  });

  it('sets hole_id, from_depth, and to_depth correctly', () => {
    const [p0, p1] = buildTrayPhotos('DDH-001', trays, '/thumb', '/full');
    expect(p0.hole_id).toBe('DDH-001');
    expect(p0.from_depth).toBe(0.0);
    expect(p0.to_depth).toBe(3.4);
    expect(p1.from_depth).toBe(3.4);
  });

  it('builds thumb and full URLs using default filename pattern', () => {
    const [p0, p1] = buildTrayPhotos('DDH-001', trays, '/thumb', '/full');
    expect(p0.lod_urls.thumb).toBe('/thumb/tray_000.jpg');
    expect(p0.lod_urls.full).toBe('/full/tray_000.jpg');
    expect(p1.lod_urls.thumb).toBe('/thumb/tray_001.jpg');
    expect(p1.lod_urls.full).toBe('/full/tray_001.jpg');
  });

  it('strips trailing slashes from base URLs', () => {
    const [p0] = buildTrayPhotos('DDH-001', trays, '/thumb/', '/full/');
    expect(p0.lod_urls.thumb).toBe('/thumb/tray_000.jpg');
    expect(p0.lod_urls.full).toBe('/full/tray_000.jpg');
  });

  it('sets image_url to the thumb URL', () => {
    const [p0] = buildTrayPhotos('DDH-001', trays, '/thumb', '/full');
    expect(p0.image_url).toBe('/thumb/tray_000.jpg');
  });

  it('uses the default photoSet when none supplied', () => {
    const [p0] = buildTrayPhotos('DDH-001', trays, '/thumb', '/full');
    expect(p0.photo_set).toBe('Tray Images');
  });

  it('uses a custom photoSet when supplied', () => {
    const [p0] = buildTrayPhotos('DDH-001', trays, '/thumb', '/full', 'Wet');
    expect(p0.photo_set).toBe('Wet');
  });

  it('overrides photoSet per tray via tray.photoSet', () => {
    const mixed = [
      { fromDepth: 0, toDepth: 3.4, photoSet: 'Dry' },
      { fromDepth: 3.4, toDepth: 6.8 },
    ];
    const [p0, p1] = buildTrayPhotos('DDH-001', mixed, '/thumb', '/full', 'Wet');
    expect(p0.photo_set).toBe('Dry');
    expect(p1.photo_set).toBe('Wet');
  });

  it('uses per-tray filename override when tray.filename is set', () => {
    const custom = [{ fromDepth: 0, toDepth: 3.4, filename: 'box_001.jpg' }];
    const [p0] = buildTrayPhotos('DDH-001', custom, '/thumb', '/full');
    expect(p0.lod_urls.thumb).toBe('/thumb/box_001.jpg');
    expect(p0.lod_urls.full).toBe('/full/box_001.jpg');
  });

  it('accepts a custom getFilename generator', () => {
    const [p0, p1] = buildTrayPhotos(
      'DDH-001', trays, '/thumb', '/full', 'Tray Images',
      (i) => `mosaic_${String(i).padStart(3, '0')}.jpg`,
    );
    expect(p0.lod_urls.thumb).toBe('/thumb/mosaic_000.jpg');
    expect(p1.lod_urls.thumb).toBe('/thumb/mosaic_001.jpg');
  });

  it('returns an empty array for empty trays input', () => {
    expect(buildTrayPhotos('DDH-001', [], '/thumb', '/full')).toEqual([]);
  });
});
