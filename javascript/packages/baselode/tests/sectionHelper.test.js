/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { SectionHelper } from '../src/viz/helpers/SectionHelper.js';

// ---------------------------------------------------------------------------
// Minimal stubs — avoid requiring a real WebGL context
// ---------------------------------------------------------------------------

function makeVector3(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; return this; },
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; },
    clone() { return makeVector3(this.x, this.y, this.z); },
    distanceTo(v) {
      const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  };
}

function makeCamera() {
  return {
    fov: 28,
    position: makeVector3(50, 50, 50),
    up: makeVector3(0, 0, 1),
    lookAt(_target) {},
    updateProjectionMatrix() {}
  };
}

function makeControls() {
  return {
    object: null,
    target: makeVector3(0, 0, 0),
    enableRotate: true,
    update() {}
  };
}

function makeRenderer() {
  return {
    localClippingEnabled: false,
    clippingPlanes: []
  };
}

function makeSceneCtx() {
  const ctx = {
    renderer: makeRenderer(),
    camera: makeCamera(),
    controls: makeControls(),
    container: { clientWidth: 800, clientHeight: 600 },
    scene: {
      _objects: [],
      add(obj) { this._objects.push(obj); },
      remove(obj) { this._objects = this._objects.filter(o => o !== obj); }
    },
    gizmo: { camera: null },
    _composer: null,
    _activeViewingHelper: null
  };
  ctx.controls.object = ctx.camera;
  return ctx;
}

// ---------------------------------------------------------------------------
// SectionHelper — enableSectionMode / disableSectionMode
// ---------------------------------------------------------------------------

describe('SectionHelper enableSectionMode', () => {
  let ctx, helper;
  beforeEach(() => {
    ctx = makeSceneCtx();
    helper = new SectionHelper(ctx);
  });

  it('sets _active to true and registers as _activeViewingHelper', () => {
    helper.enableSectionMode('x');
    expect(helper._active).toBe(true);
    expect(ctx._activeViewingHelper).toBe(helper);
  });

  it('enables localClippingEnabled on the renderer', () => {
    helper.enableSectionMode('x');
    expect(ctx.renderer.localClippingEnabled).toBe(true);
  });

  it('sets a clipping plane on the renderer', () => {
    helper.enableSectionMode('x');
    expect(ctx.renderer.clippingPlanes).toHaveLength(1);
  });

  it('defaults to x axis when no argument is passed', () => {
    helper.enableSectionMode();
    expect(helper._axis).toBe('x');
  });

  it('accepts y axis', () => {
    helper.enableSectionMode('y');
    expect(helper._axis).toBe('y');
  });

  it('coerces unknown axis to x', () => {
    helper.enableSectionMode('z');
    expect(helper._axis).toBe('x');
  });
});

describe('SectionHelper disableSectionMode', () => {
  let ctx, helper;
  beforeEach(() => {
    ctx = makeSceneCtx();
    helper = new SectionHelper(ctx);
    helper.enableSectionMode('x');
  });

  it('sets _active to false', () => {
    helper.disableSectionMode();
    expect(helper._active).toBe(false);
  });

  it('clears the clipping planes from the renderer', () => {
    helper.disableSectionMode();
    expect(ctx.renderer.clippingPlanes).toHaveLength(0);
  });

  it('clears _activeViewingHelper', () => {
    helper.disableSectionMode();
    expect(ctx._activeViewingHelper).toBeNull();
  });

  it('removes the plane indicator from the scene', () => {
    expect(ctx.scene._objects.length).toBeGreaterThan(0);
    helper.disableSectionMode();
    expect(ctx.scene._objects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SectionHelper — position helpers
// ---------------------------------------------------------------------------

describe('SectionHelper setSectionPosition', () => {
  let ctx, helper;
  beforeEach(() => {
    ctx = makeSceneCtx();
    helper = new SectionHelper(ctx);
    helper.enableSectionMode('x');
  });

  it('updates _distance', () => {
    helper.setSectionPosition(1000);
    expect(helper._distance).toBe(1000);
  });

  it('updates the clipping plane constant', () => {
    helper.setSectionPosition(500);
    expect(helper._clippingPlane.constant).toBe(500);
  });
});

describe('SectionHelper stepSection', () => {
  let ctx, helper;
  beforeEach(() => {
    ctx = makeSceneCtx();
    helper = new SectionHelper(ctx);
    helper.enableSectionMode('x');
    helper.setSectionPosition(100);
  });

  it('increments position by delta', () => {
    helper.stepSection(25);
    expect(helper.getSectionPosition()).toBe(125);
  });

  it('decrements position with negative delta', () => {
    helper.stepSection(-50);
    expect(helper.getSectionPosition()).toBe(50);
  });

  it('getSectionPosition returns the current distance', () => {
    helper.setSectionPosition(750);
    expect(helper.getSectionPosition()).toBe(750);
  });
});

// ---------------------------------------------------------------------------
// SectionHelper — clipping plane direction
// ---------------------------------------------------------------------------

describe('SectionHelper clipping plane normal', () => {
  let ctx;
  beforeEach(() => { ctx = makeSceneCtx(); });

  it('uses −X normal for x section (hides x > distance)', () => {
    const helper = new SectionHelper(ctx);
    helper.enableSectionMode('x');
    const plane = helper._clippingPlane;
    expect(plane.normal.x).toBe(-1);
    expect(plane.normal.y).toBe(0);
    expect(plane.normal.z).toBe(0);
  });

  it('uses −Y normal for y section (hides y > distance)', () => {
    const helper = new SectionHelper(ctx);
    helper.enableSectionMode('y');
    const plane = helper._clippingPlane;
    expect(plane.normal.x).toBe(0);
    expect(plane.normal.y).toBe(-1);
    expect(plane.normal.z).toBe(0);
  });

  it('sets constant equal to the section distance', () => {
    const helper = new SectionHelper(ctx);
    helper.enableSectionMode('x');
    helper.setSectionPosition(1234);
    expect(helper._clippingPlane.constant).toBe(1234);
  });
});

// ---------------------------------------------------------------------------
// SectionHelper — mutual exclusion
// ---------------------------------------------------------------------------

describe('SectionHelper mutual exclusion', () => {
  it('disables a previously active helper when a new one is enabled', () => {
    const ctx = makeSceneCtx();
    const helperA = new SectionHelper(ctx);
    const helperB = new SectionHelper(ctx);

    helperA.enableSectionMode('x');
    expect(ctx._activeViewingHelper).toBe(helperA);

    helperB.enableSectionMode('y');
    // helperA should have been disabled automatically
    expect(helperA._active).toBe(false);
    expect(ctx._activeViewingHelper).toBe(helperB);
  });

  it('disable() alias works the same as disableSectionMode()', () => {
    const ctx = makeSceneCtx();
    const helper = new SectionHelper(ctx);
    helper.enableSectionMode('x');
    helper.disable();
    expect(helper._active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SectionHelper — dispose
// ---------------------------------------------------------------------------

describe('SectionHelper dispose', () => {
  it('clears everything', () => {
    const ctx = makeSceneCtx();
    const helper = new SectionHelper(ctx);
    helper.enableSectionMode('x');
    helper.dispose();
    expect(helper._active).toBe(false);
    expect(ctx.renderer.clippingPlanes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SectionHelper — guard clauses (no renderer / no camera)
// ---------------------------------------------------------------------------

describe('SectionHelper guard clauses', () => {
  it('does not throw when renderer is null', () => {
    const ctx = makeSceneCtx();
    ctx.renderer = null;
    const helper = new SectionHelper(ctx);
    expect(() => helper.enableSectionMode('x')).not.toThrow();
    expect(() => helper.disableSectionMode()).not.toThrow();
  });

  it('does not throw when controls are null', () => {
    const ctx = makeSceneCtx();
    ctx.controls = null;
    const helper = new SectionHelper(ctx);
    expect(() => helper.enableSectionMode('x')).not.toThrow();
  });

  it('does not throw when scene is null', () => {
    const ctx = makeSceneCtx();
    ctx.scene = null;
    const helper = new SectionHelper(ctx);
    expect(() => helper.enableSectionMode('x')).not.toThrow();
    expect(() => helper.disableSectionMode()).not.toThrow();
  });
});
