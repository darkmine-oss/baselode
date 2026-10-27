/* Copyright (C) 2026 Darkmine Pty Ltd — SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import Baselode3DScene from '../src/viz/baselode3dScene.js';

function scene() {
  const result = new Baselode3DScene({ extentBox: true });
  result.scene = new THREE.Scene();
  return result;
}
const bounds = { minX: 0, maxX: 10, minY: -2, maxY: 2, minZ: -100, maxZ: 0 };

describe('explicit scene bounds and extent box', () => {
  it('builds and resizes the extent box including sub-centimetre changes', () => {
    const ctx = scene(); ctx.setSceneBounds(bounds);
    expect(ctx.anchors.extent.visible).toBe(true);
    expect(ctx.anchors.extent.children[0].box.max.x).toBe(10);
    const original = ctx.anchors.extent;
    ctx.setSceneBounds({ ...bounds, maxX: 10.001 });
    expect(ctx.anchors.extent).not.toBe(original);
    expect(ctx.anchors.extent.children[0].box.max.x).toBe(10.001);
    expect(bounds.maxX).toBe(10);
  });
  it('retains visibility choices through bounds updates and clears an empty scene', () => {
    const ctx = scene(); ctx.setExtentBoxVisible(false); ctx.setSceneBounds(bounds);
    expect(ctx.anchors.extent.visible).toBe(false);
    ctx.setExtentBoxVisible(true); expect(ctx.anchors.extent.visible).toBe(true);
    ctx.setSceneBounds(null);
    expect(ctx.lastBounds).toBe(null); expect(ctx.anchors.extent).toBe(null); expect(ctx.anchors.grid).toBe(null);
  });
  it('rejects invalid bounds and copies valid input', () => {
    const ctx = scene(), input = { ...bounds }; ctx.setSceneBounds(input); input.maxX = 99;
    expect(ctx.lastBounds.maxX).toBe(10);
    for (const bad of [{}, { ...bounds, maxX: NaN }, { ...bounds, maxZ: -101 }]) {
      expect(() => ctx.setSceneBounds(bad)).toThrow(/finite ordered/);
    }
    expect(ctx.lastBounds).toEqual(bounds);
  });
});
