/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  normalizeBounds,
  addRasterOverlay,
  removeRasterOverlay,
  setRasterOverlayOpacity,
  setRasterOverlayVisibility,
  setRasterOverlayElevation,
  getRasterOverlay,
  listRasterOverlays,
  clearRasterOverlays,
} from '../src/viz/rasterOverlayScene.js';

// ---------------------------------------------------------------------------
// Minimal stubs — avoid real WebGL/DOM dependencies
// ---------------------------------------------------------------------------

function makePosition(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; },
    setZ(nz) { this.z = nz; },
  };
}

function makeMesh(id = 'mesh') {
  return {
    _id: id,
    position: makePosition(),
    material: { opacity: 1, needsUpdate: false, dispose() { this._disposed = true; }, _disposed: false },
    geometry: { dispose() { this._disposed = true; }, _disposed: false },
    visible: true,
    renderOrder: 0,
  };
}

function makeTexture() {
  return { dispose() { this._disposed = true; }, _disposed: false };
}

function makeLayer(id = 'test-layer', overrides = {}) {
  return {
    id,
    name: id,
    mesh: makeMesh(id),
    texture: makeTexture(),
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    elevation: 0,
    opacity: 1,
    visible: true,
    ...overrides,
  };
}

function makeSceneCtx() {
  const added = [];
  const removed = [];
  return {
    scene: {
      _added: added,
      _removed: removed,
      add(obj) { added.push(obj); },
      remove(obj) { removed.push(obj); },
    },
    rasterOverlays: new Map(),
  };
}

// ---------------------------------------------------------------------------
// normalizeBounds
// ---------------------------------------------------------------------------

describe('normalizeBounds — explicit bounds form', () => {
  it('accepts { minX, minY, maxX, maxY }', () => {
    const b = normalizeBounds({ minX: 100, minY: 200, maxX: 110, maxY: 220 });
    expect(b).toEqual({ minX: 100, minY: 200, maxX: 110, maxY: 220 });
  });

  it('coerces string values to numbers', () => {
    const b = normalizeBounds({ minX: '0', minY: '0', maxX: '5', maxY: '5' });
    expect(b.maxX).toBe(5);
    expect(typeof b.maxX).toBe('number');
  });

  it('throws when width is zero', () => {
    expect(() => normalizeBounds({ minX: 5, minY: 0, maxX: 5, maxY: 10 })).toThrow(/width must be positive/);
  });

  it('throws when width is negative', () => {
    expect(() => normalizeBounds({ minX: 10, minY: 0, maxX: 5, maxY: 10 })).toThrow(/width must be positive/);
  });

  it('throws when height is zero', () => {
    expect(() => normalizeBounds({ minX: 0, minY: 5, maxX: 10, maxY: 5 })).toThrow(/height must be positive/);
  });

  it('throws when height is negative', () => {
    expect(() => normalizeBounds({ minX: 0, minY: 10, maxX: 10, maxY: 5 })).toThrow(/height must be positive/);
  });

  it('supports negative coordinates', () => {
    const b = normalizeBounds({ minX: -500, minY: -200, maxX: -490, maxY: -190 });
    expect(b).toEqual({ minX: -500, minY: -200, maxX: -490, maxY: -190 });
  });
});

describe('normalizeBounds — origin plus size form', () => {
  it('accepts { x, y, width, height }', () => {
    const b = normalizeBounds({ x: 100, y: 200, width: 50, height: 30 });
    expect(b).toEqual({ minX: 100, minY: 200, maxX: 150, maxY: 230 });
  });

  it('throws when width is zero', () => {
    expect(() => normalizeBounds({ x: 0, y: 0, width: 0, height: 10 })).toThrow(/width must be positive/);
  });

  it('throws when height is zero', () => {
    expect(() => normalizeBounds({ x: 0, y: 0, width: 10, height: 0 })).toThrow(/height must be positive/);
  });

  it('handles large project coordinates', () => {
    const b = normalizeBounds({ x: 500000, y: 7420000, width: 5000, height: 5000 });
    expect(b).toEqual({ minX: 500000, minY: 7420000, maxX: 505000, maxY: 7425000 });
  });
});

// ---------------------------------------------------------------------------
// addRasterOverlay
// ---------------------------------------------------------------------------

describe('addRasterOverlay', () => {
  let ctx;
  beforeEach(() => { ctx = makeSceneCtx(); });

  it('adds the layer mesh to the scene', () => {
    const layer = makeLayer('a');
    addRasterOverlay(ctx, layer);
    expect(ctx.scene._added).toContain(layer.mesh);
  });

  it('stores the layer in rasterOverlays map', () => {
    const layer = makeLayer('a');
    addRasterOverlay(ctx, layer);
    expect(ctx.rasterOverlays.get('a')).toBe(layer);
  });

  it('replaces an existing layer with the same id', () => {
    const old = makeLayer('a');
    const fresh = makeLayer('a');
    addRasterOverlay(ctx, old);
    addRasterOverlay(ctx, fresh);
    expect(ctx.rasterOverlays.get('a')).toBe(fresh);
    // old mesh removed and disposed
    expect(ctx.scene._removed).toContain(old.mesh);
    expect(old.mesh.geometry._disposed).toBe(true);
    expect(old.mesh.material._disposed).toBe(true);
    expect(old.texture._disposed).toBe(true);
  });

  it('is a no-op when scene is null', () => {
    ctx.scene = null;
    const layer = makeLayer('a');
    expect(() => addRasterOverlay(ctx, layer)).not.toThrow();
    expect(ctx.rasterOverlays.size).toBe(0);
  });

  it('supports multiple layers with different ids', () => {
    addRasterOverlay(ctx, makeLayer('a'));
    addRasterOverlay(ctx, makeLayer('b'));
    expect(ctx.rasterOverlays.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// removeRasterOverlay
// ---------------------------------------------------------------------------

describe('removeRasterOverlay', () => {
  let ctx;
  beforeEach(() => { ctx = makeSceneCtx(); });

  it('removes the mesh from the scene', () => {
    const layer = makeLayer('x');
    addRasterOverlay(ctx, layer);
    removeRasterOverlay(ctx, 'x');
    expect(ctx.scene._removed).toContain(layer.mesh);
  });

  it('disposes geometry, material, and texture', () => {
    const layer = makeLayer('x');
    addRasterOverlay(ctx, layer);
    removeRasterOverlay(ctx, 'x');
    expect(layer.mesh.geometry._disposed).toBe(true);
    expect(layer.mesh.material._disposed).toBe(true);
    expect(layer.texture._disposed).toBe(true);
  });

  it('removes the layer from rasterOverlays map', () => {
    const layer = makeLayer('x');
    addRasterOverlay(ctx, layer);
    removeRasterOverlay(ctx, 'x');
    expect(ctx.rasterOverlays.has('x')).toBe(false);
  });

  it('is a no-op for an unknown id', () => {
    expect(() => removeRasterOverlay(ctx, 'does-not-exist')).not.toThrow();
  });

  it('handles null texture gracefully', () => {
    const layer = makeLayer('x');
    layer.texture = null;
    addRasterOverlay(ctx, layer);
    expect(() => removeRasterOverlay(ctx, 'x')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// setRasterOverlayOpacity
// ---------------------------------------------------------------------------

describe('setRasterOverlayOpacity', () => {
  let ctx;
  beforeEach(() => { ctx = makeSceneCtx(); });

  it('updates material opacity', () => {
    const layer = makeLayer('a');
    addRasterOverlay(ctx, layer);
    setRasterOverlayOpacity(ctx, 'a', 0.5);
    expect(layer.mesh.material.opacity).toBe(0.5);
  });

  it('updates layer.opacity', () => {
    const layer = makeLayer('a');
    addRasterOverlay(ctx, layer);
    setRasterOverlayOpacity(ctx, 'a', 0.3);
    expect(layer.opacity).toBe(0.3);
  });

  it('sets needsUpdate on the material', () => {
    const layer = makeLayer('a');
    addRasterOverlay(ctx, layer);
    setRasterOverlayOpacity(ctx, 'a', 0.7);
    expect(layer.mesh.material.needsUpdate).toBe(true);
  });

  it('clamps opacity below 0 to 0', () => {
    const layer = makeLayer('a');
    addRasterOverlay(ctx, layer);
    setRasterOverlayOpacity(ctx, 'a', -0.5);
    expect(layer.mesh.material.opacity).toBe(0);
    expect(layer.opacity).toBe(0);
  });

  it('clamps opacity above 1 to 1', () => {
    const layer = makeLayer('a');
    addRasterOverlay(ctx, layer);
    setRasterOverlayOpacity(ctx, 'a', 1.5);
    expect(layer.mesh.material.opacity).toBe(1);
    expect(layer.opacity).toBe(1);
  });

  it('is a no-op for an unknown id', () => {
    expect(() => setRasterOverlayOpacity(ctx, 'nope', 0.5)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// setRasterOverlayVisibility
// ---------------------------------------------------------------------------

describe('setRasterOverlayVisibility', () => {
  let ctx;
  beforeEach(() => { ctx = makeSceneCtx(); });

  it('hides the mesh', () => {
    const layer = makeLayer('a');
    addRasterOverlay(ctx, layer);
    setRasterOverlayVisibility(ctx, 'a', false);
    expect(layer.mesh.visible).toBe(false);
    expect(layer.visible).toBe(false);
  });

  it('shows the mesh', () => {
    const layer = makeLayer('a', { visible: false });
    layer.mesh.visible = false;
    addRasterOverlay(ctx, layer);
    setRasterOverlayVisibility(ctx, 'a', true);
    expect(layer.mesh.visible).toBe(true);
    expect(layer.visible).toBe(true);
  });

  it('is a no-op for an unknown id', () => {
    expect(() => setRasterOverlayVisibility(ctx, 'nope', false)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// setRasterOverlayElevation
// ---------------------------------------------------------------------------

describe('setRasterOverlayElevation', () => {
  let ctx;
  beforeEach(() => { ctx = makeSceneCtx(); });

  it('updates the mesh Z position', () => {
    const layer = makeLayer('a');
    addRasterOverlay(ctx, layer);
    setRasterOverlayElevation(ctx, 'a', 150);
    expect(layer.mesh.position.z).toBe(150);
  });

  it('updates layer.elevation', () => {
    const layer = makeLayer('a');
    addRasterOverlay(ctx, layer);
    setRasterOverlayElevation(ctx, 'a', -50);
    expect(layer.elevation).toBe(-50);
  });

  it('accepts negative elevation', () => {
    const layer = makeLayer('a');
    addRasterOverlay(ctx, layer);
    setRasterOverlayElevation(ctx, 'a', -1000);
    expect(layer.mesh.position.z).toBe(-1000);
  });

  it('is a no-op for an unknown id', () => {
    expect(() => setRasterOverlayElevation(ctx, 'nope', 100)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getRasterOverlay / listRasterOverlays
// ---------------------------------------------------------------------------

describe('getRasterOverlay', () => {
  it('returns the layer by id', () => {
    const ctx = makeSceneCtx();
    const layer = makeLayer('x');
    addRasterOverlay(ctx, layer);
    expect(getRasterOverlay(ctx, 'x')).toBe(layer);
  });

  it('returns undefined for an unknown id', () => {
    const ctx = makeSceneCtx();
    expect(getRasterOverlay(ctx, 'missing')).toBeUndefined();
  });
});

describe('listRasterOverlays', () => {
  it('returns an empty array when no layers are present', () => {
    const ctx = makeSceneCtx();
    expect(listRasterOverlays(ctx)).toEqual([]);
  });

  it('returns all layers in insertion order', () => {
    const ctx = makeSceneCtx();
    const a = makeLayer('a');
    const b = makeLayer('b');
    addRasterOverlay(ctx, a);
    addRasterOverlay(ctx, b);
    const list = listRasterOverlays(ctx);
    expect(list).toHaveLength(2);
    expect(list[0]).toBe(a);
    expect(list[1]).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// clearRasterOverlays
// ---------------------------------------------------------------------------

describe('clearRasterOverlays', () => {
  it('removes all layers from the map', () => {
    const ctx = makeSceneCtx();
    addRasterOverlay(ctx, makeLayer('a'));
    addRasterOverlay(ctx, makeLayer('b'));
    clearRasterOverlays(ctx);
    expect(ctx.rasterOverlays.size).toBe(0);
  });

  it('disposes GPU resources for all layers', () => {
    const ctx = makeSceneCtx();
    const a = makeLayer('a');
    const b = makeLayer('b');
    addRasterOverlay(ctx, a);
    addRasterOverlay(ctx, b);
    clearRasterOverlays(ctx);
    expect(a.mesh.geometry._disposed).toBe(true);
    expect(b.mesh.material._disposed).toBe(true);
    expect(a.texture._disposed).toBe(true);
  });

  it('is safe to call on an empty map', () => {
    const ctx = makeSceneCtx();
    expect(() => clearRasterOverlays(ctx)).not.toThrow();
  });
});
