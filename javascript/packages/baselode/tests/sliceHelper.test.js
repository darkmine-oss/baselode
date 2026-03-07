/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SliceHelper } from '../src/viz/helpers/SliceHelper.js';

// ---------------------------------------------------------------------------
// Minimal stubs — avoid requiring a real WebGL context
// ---------------------------------------------------------------------------

function makeVector3(x = 0, y = 0, z = 0) {
  const v = {
    x, y, z,
    set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; return this; },
    copy(other) { this.x = other.x; this.y = other.y; this.z = other.z; return this; },
    clone() { return makeVector3(this.x, this.y, this.z); },
    normalize() {
      const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
      if (len > 0) { this.x /= len; this.y /= len; this.z /= len; }
      return this;
    },
    negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; },
    dot(other) { return this.x * other.x + this.y * other.y + this.z * other.z; },
    length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); },
    add(other) { this.x += other.x; this.y += other.y; this.z += other.z; return this; },
    sub(other) { this.x -= other.x; this.y -= other.y; this.z -= other.z; return this; },
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; },
    crossVectors(a, b) {
      this.x = a.y * b.z - a.z * b.y;
      this.y = a.z * b.x - a.x * b.z;
      this.z = a.x * b.y - a.y * b.x;
      return this;
    },
    unproject(_camera) { /* noop for stub */ return this; }
  };
  return v;
}

function makeRenderer(domWidth = 800, domHeight = 600) {
  return {
    localClippingEnabled: false,
    clippingPlanes: [],
    domElement: { clientWidth: domWidth, clientHeight: domHeight }
  };
}

function makeCamera() {
  return { position: makeVector3(0, 0, 100) };
}

/** Build a real THREE.PerspectiveCamera for tests that exercise unproject(). */
function makeRealCamera() {
  const cam = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 10000);
  cam.position.set(0, 0, 100);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

function makeSceneCtx() {
  return {
    renderer: makeRenderer(),
    camera: makeCamera(),
    scene: {
      _objects: [],
      add(obj) { this._objects.push(obj); },
      remove(obj) { this._objects = this._objects.filter(o => o !== obj); }
    },
    _activeViewingHelper: null
  };
}

// ---------------------------------------------------------------------------
// SliceHelper — enableSliceMode / disableSliceMode
// ---------------------------------------------------------------------------

describe('SliceHelper enableSliceMode', () => {
  let ctx, helper;
  beforeEach(() => {
    ctx = makeSceneCtx();
    helper = new SliceHelper(ctx);
  });

  it('sets _active to true', () => {
    helper.enableSliceMode();
    expect(helper._active).toBe(true);
  });

  it('registers as _activeViewingHelper', () => {
    helper.enableSliceMode();
    expect(ctx._activeViewingHelper).toBe(helper);
  });

  it('enables localClippingEnabled on the renderer', () => {
    helper.enableSliceMode();
    expect(ctx.renderer.localClippingEnabled).toBe(true);
  });

  it('inserts exactly two clipping planes', () => {
    helper.enableSliceMode();
    expect(ctx.renderer.clippingPlanes).toHaveLength(2);
  });
});

describe('SliceHelper disableSliceMode', () => {
  let ctx, helper;
  beforeEach(() => {
    ctx = makeSceneCtx();
    helper = new SliceHelper(ctx);
    helper.enableSliceMode();
  });

  it('sets _active to false', () => {
    helper.disableSliceMode();
    expect(helper._active).toBe(false);
  });

  it('removes all clipping planes', () => {
    helper.disableSliceMode();
    expect(ctx.renderer.clippingPlanes).toHaveLength(0);
  });

  it('clears _activeViewingHelper', () => {
    helper.disableSliceMode();
    expect(ctx._activeViewingHelper).toBeNull();
  });

  it('removes the slab indicator from the scene', () => {
    expect(ctx.scene._objects.length).toBeGreaterThan(0);
    helper.disableSliceMode();
    expect(ctx.scene._objects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SliceHelper — setSlicePlane
// ---------------------------------------------------------------------------

describe('SliceHelper setSlicePlane', () => {
  let ctx, helper;
  beforeEach(() => {
    ctx = makeSceneCtx();
    helper = new SliceHelper(ctx);
    helper.enableSliceMode();
  });

  it('updates _distance', () => {
    const n = makeVector3(1, 0, 0);
    helper.setSlicePlane(n, 4500);
    expect(helper._distance).toBe(4500);
  });

  it('normalises the provided normal', () => {
    const n = makeVector3(2, 0, 0); // not unit length
    helper.setSlicePlane(n, 0);
    expect(helper._normal.x).toBeCloseTo(1, 6);
    expect(helper._normal.y).toBeCloseTo(0, 6);
    expect(helper._normal.z).toBeCloseTo(0, 6);
  });
});

// ---------------------------------------------------------------------------
// SliceHelper — setSliceWidth
// ---------------------------------------------------------------------------

describe('SliceHelper setSliceWidth', () => {
  let ctx, helper;
  beforeEach(() => {
    ctx = makeSceneCtx();
    helper = new SliceHelper(ctx);
    helper.enableSliceMode();
  });

  it('updates _width', () => {
    helper.setSliceWidth(100);
    expect(helper.getSliceWidth()).toBe(100);
  });

  it('clamps negative width to zero', () => {
    helper.setSliceWidth(-10);
    expect(helper.getSliceWidth()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SliceHelper — slab plane mathematics
// ---------------------------------------------------------------------------

describe('SliceHelper slab plane maths', () => {
  it('creates correct two-plane slab for a given normal/distance/width', () => {
    const ctx = makeSceneCtx();
    const helper = new SliceHelper(ctx);

    // Manually configure via private fields then trigger _setupClippingPlanes.
    helper._normal = makeVector3(1, 0, 0);
    helper._distance = 100;
    helper._width = 20; // slab: 90 ≤ x ≤ 110

    helper.enableSliceMode(); // calls _setupClippingPlanes

    const [p1, p2] = ctx.renderer.clippingPlanes;

    // Plane1: normal = (+1,0,0), constant = -(100 − 10) = −90
    // distanceToPoint(90) = 1*90 − 90 = 0  → on plane boundary (visible)
    // distanceToPoint(89) = 1*89 − 90 = −1 < 0 → clipped
    expect(p1.normal.x).toBeCloseTo(1, 5);
    expect(p1.constant).toBeCloseTo(-90, 5);

    // Plane2: normal = (−1,0,0), constant = 100 + 10 = 110
    // distanceToPoint(110) = −1*110 + 110 = 0  → on plane boundary (visible)
    // distanceToPoint(111) = −1*111 + 110 = −1 < 0 → clipped
    expect(p2.normal.x).toBeCloseTo(-1, 5);
    expect(p2.constant).toBeCloseTo(110, 5);
  });
});

// ---------------------------------------------------------------------------
// SliceHelper — moveSlice
// ---------------------------------------------------------------------------

describe('SliceHelper moveSlice', () => {
  let ctx, helper;
  beforeEach(() => {
    ctx = makeSceneCtx();
    helper = new SliceHelper(ctx);
    helper.enableSliceMode();
    helper._distance = 0;
    helper._updateClippingPlanes();
  });

  it('increments _distance by positive delta', () => {
    helper.moveSlice(50);
    expect(helper._distance).toBe(50);
  });

  it('decrements _distance with negative delta', () => {
    helper.moveSlice(-30);
    expect(helper._distance).toBe(-30);
  });

  it('updates the plane constants after moving', () => {
    helper.setSliceWidth(20);
    helper._distance = 100;
    helper._updateClippingPlanes();
    helper.moveSlice(10); // distance → 110

    const [p1, p2] = ctx.renderer.clippingPlanes;
    // Plane1 constant = -(110 - 10) = -100
    expect(p1.constant).toBeCloseTo(-100, 5);
    // Plane2 constant = 110 + 10 = 120
    expect(p2.constant).toBeCloseTo(120, 5);
  });
});

// ---------------------------------------------------------------------------
// SliceHelper — getSlicePlane / getSliceWidth
// ---------------------------------------------------------------------------

describe('SliceHelper getters', () => {
  it('getSlicePlane returns a copy of the current normal and distance', () => {
    const ctx = makeSceneCtx();
    const helper = new SliceHelper(ctx);
    helper._normal = makeVector3(0, 1, 0);
    helper._distance = 200;

    const { normal, distance } = helper.getSlicePlane();
    expect(normal.y).toBe(1);
    expect(distance).toBe(200);

    // Mutating the returned normal must not affect the helper's internal state.
    normal.y = 999;
    expect(helper._normal.y).toBe(1);
  });

  it('getSliceWidth returns _width', () => {
    const ctx = makeSceneCtx();
    const helper = new SliceHelper(ctx);
    helper._width = 75;
    expect(helper.getSliceWidth()).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// SliceHelper — createSlicePlaneFromScreenLine
// ---------------------------------------------------------------------------

describe('SliceHelper createSlicePlaneFromScreenLine', () => {
  it('returns null when camera is absent', () => {
    const ctx = makeSceneCtx();
    ctx.camera = null;
    const helper = new SliceHelper(ctx);
    const result = helper.createSlicePlaneFromScreenLine({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(result).toBeNull();
  });

  it('returns null when renderer is absent', () => {
    const ctx = makeSceneCtx();
    ctx.renderer = null;
    const helper = new SliceHelper(ctx);
    const result = helper.createSlicePlaneFromScreenLine({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(result).toBeNull();
  });

  it('returns null for a degenerate (zero-length) line', () => {
    const ctx = makeSceneCtx();
    ctx.camera = makeRealCamera();
    const helper = new SliceHelper(ctx);
    const result = helper.createSlicePlaneFromScreenLine({ x: 50, y: 50 }, { x: 50, y: 50 });
    expect(result).toBeNull();
  });

  it('returns an object with normal and distance for a horizontal screen line', () => {
    const ctx = makeSceneCtx();
    ctx.camera = makeRealCamera();
    const helper = new SliceHelper(ctx);
    // Draw a horizontal line across the full canvas width at mid-height.
    // screen (0, 300) → NDC (-1, 0)
    // screen (800, 300) → NDC (+1, 0)
    // lineDir in XY ≈ (1, 0), so normal ≈ (0, 1, 0) or (0, -1, 0)
    const result = helper.createSlicePlaneFromScreenLine({ x: 0, y: 300 }, { x: 800, y: 300 });
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('normal');
    expect(result).toHaveProperty('distance');
    // Normal must be unit length.
    const len = Math.sqrt(
      result.normal.x ** 2 + result.normal.y ** 2 + result.normal.z ** 2
    );
    expect(len).toBeCloseTo(1, 5);
    // Normal must be horizontal (no Z component).
    expect(result.normal.z).toBeCloseTo(0, 5);
  });
});

// ---------------------------------------------------------------------------
// SliceHelper — mutual exclusion
// ---------------------------------------------------------------------------

describe('SliceHelper mutual exclusion', () => {
  it('disables a previously active helper when a new one is enabled', () => {
    const ctx = makeSceneCtx();
    const helperA = new SliceHelper(ctx);
    const helperB = new SliceHelper(ctx);

    helperA.enableSliceMode();
    expect(ctx._activeViewingHelper).toBe(helperA);

    helperB.enableSliceMode();
    expect(helperA._active).toBe(false);
    expect(ctx._activeViewingHelper).toBe(helperB);
  });

  it('disable() alias works the same as disableSliceMode()', () => {
    const ctx = makeSceneCtx();
    const helper = new SliceHelper(ctx);
    helper.enableSliceMode();
    helper.disable();
    expect(helper._active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SliceHelper — guard clauses
// ---------------------------------------------------------------------------

describe('SliceHelper guard clauses', () => {
  it('does not throw when renderer is null', () => {
    const ctx = makeSceneCtx();
    ctx.renderer = null;
    const helper = new SliceHelper(ctx);
    expect(() => helper.enableSliceMode()).not.toThrow();
    expect(() => helper.disableSliceMode()).not.toThrow();
  });

  it('does not throw when scene is null', () => {
    const ctx = makeSceneCtx();
    ctx.scene = null;
    const helper = new SliceHelper(ctx);
    expect(() => helper.enableSliceMode()).not.toThrow();
    expect(() => helper.disableSliceMode()).not.toThrow();
  });

  it('does not throw on dispose', () => {
    const ctx = makeSceneCtx();
    const helper = new SliceHelper(ctx);
    helper.enableSliceMode();
    expect(() => helper.dispose()).not.toThrow();
    expect(helper._active).toBe(false);
  });
});
