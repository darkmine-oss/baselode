/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { buildCorePhotoConfig } from '../src/viz/corePhotoViz.js';

describe('buildCorePhotoConfig', () => {
  it('returns empty config for empty images array', () => {
    const { data, layout } = buildCorePhotoConfig([]);
    expect(data).toHaveLength(0);
    expect(layout).toEqual({});
  });

  it('places layout images at registered depth intervals', () => {
    const images = [
      { from: 0, to: 10, image_url: 'https://example.com/tray1.jpg', image_mode: 'core_box' },
      { from: 10, to: 20, image_url: 'https://example.com/tray2.jpg', image_mode: 'core_tray' },
    ];
    const { data, layout } = buildCorePhotoConfig(images);
    expect(data).toHaveLength(1); // anchor trace
    expect(layout.images).toHaveLength(2);
    expect(layout.images[0].y).toBe(0);
    expect(layout.images[0].sizey).toBe(10);
    expect(layout.images[1].y).toBe(10);
    expect(layout.images[1].sizey).toBe(10);
  });

  it('skips records with inverted depth intervals', () => {
    const images = [
      { from: 10, to: 5, image_url: 'https://example.com/bad.jpg' },
      { from: 0, to: 10, image_url: 'https://example.com/good.jpg' },
    ];
    const { layout } = buildCorePhotoConfig(images);
    expect(layout.images).toHaveLength(1);
  });

  it('skips records with missing URL', () => {
    const images = [
      { from: 0, to: 10, image_url: '' },
      { from: 10, to: 20, image_url: 'https://example.com/valid.jpg' },
    ];
    const { layout } = buildCorePhotoConfig(images);
    expect(layout.images).toHaveLength(1);
  });

  it('uses depthRange option to fix axis extent', () => {
    const images = [{ from: 5, to: 15, image_url: 'https://example.com/core.jpg' }];
    const { data } = buildCorePhotoConfig(images, { depthRange: [0, 50] });
    expect(data[0].y).toContain(0);
    expect(data[0].y).toContain(50);
  });

  it('supports single_core mode without changing layout structure', () => {
    const images = [
      { from: 0, to: 10, image_url: 'https://example.com/single.jpg', image_mode: 'single_core' },
    ];
    const { layout } = buildCorePhotoConfig(images);
    expect(layout.images).toHaveLength(1);
    expect(layout.images[0].source).toBe('https://example.com/single.jpg');
  });

  it('sets reversed y-axis for depth-downward convention', () => {
    const images = [{ from: 0, to: 10, image_url: 'https://example.com/core.jpg' }];
    const { layout } = buildCorePhotoConfig(images);
    expect(layout.yaxis.autorange).toBe('reversed');
  });

  it('hides the x-axis (strip log track convention)', () => {
    const images = [{ from: 0, to: 10, image_url: 'https://example.com/core.jpg' }];
    const { layout } = buildCorePhotoConfig(images);
    expect(layout.xaxis.visible).toBe(false);
  });

  it('accepts custom column names', () => {
    const images = [
      { depth_from: 0, depth_to: 10, src: 'https://example.com/core.jpg' },
    ];
    const { layout } = buildCorePhotoConfig(images, {
      fromCol: 'depth_from',
      toCol: 'depth_to',
      urlCol: 'src',
    });
    expect(layout.images).toHaveLength(1);
    expect(layout.images[0].source).toBe('https://example.com/core.jpg');
  });

  it('sorts images by from-depth', () => {
    const images = [
      { from: 20, to: 30, image_url: 'https://example.com/c.jpg' },
      { from: 0, to: 10, image_url: 'https://example.com/a.jpg' },
      { from: 10, to: 20, image_url: 'https://example.com/b.jpg' },
    ];
    const { layout } = buildCorePhotoConfig(images);
    expect(layout.images[0].y).toBe(0);
    expect(layout.images[1].y).toBe(10);
    expect(layout.images[2].y).toBe(20);
  });

  it('sets image anchor and sizing correctly', () => {
    const images = [{ from: 0, to: 10, image_url: 'https://example.com/core.jpg' }];
    const { layout } = buildCorePhotoConfig(images);
    const img = layout.images[0];
    expect(img.xanchor).toBe('left');
    expect(img.yanchor).toBe('top');
    expect(img.sizing).toBe('stretch');
    expect(img.xref).toBe('x');
    expect(img.yref).toBe('y');
  });
});
