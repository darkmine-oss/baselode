/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, beforeEach } from 'vitest';

import {
  initSelectionGlow,
  resizeGlow,
  applySelection,
  disposeSelectionGlow
} from '../src/viz/selectionGlow.js';

// ---------------------------------------------------------------------------
// Minimal stubs for Three.js and EffectComposer / OutlinePass
// ---------------------------------------------------------------------------

/** Stub THREE.Color with enough of the API used by selectionGlow */
function makeColor() {
  return { _hex: null, set(h) { this._hex = h; return this; } };
}

/** Stub OutlinePass */
function makeOutlinePass() {
  return {
    visibleEdgeColor: makeColor(),
    hiddenEdgeColor: makeColor(),
    edgeStrength: 0,
    edgeThickness: 0,
    edgeGlow: 0,
    pulsePeriod: -1,
    selectedObjects: null,
    resolution: { set(w, h) { this.w = w; this.h = h; } }
  };
}

/** Stub EffectComposer */
function makeComposer() {
  return {
    passes: [],
    _size: { w: 0, h: 0 },
    _disposed: false,
    addPass(p) { this.passes.push(p); },
    setSize(w, h) { this._size = { w, h }; },
    dispose() { this._disposed = true; }
  };
}

/**
 * Build a minimal sceneCtx that mirrors the fields selectionGlow operates on.
 * We bypass the real Three.js / postprocessing modules by pre-populating the
 * stubs rather than importing them via ES modules (which would need a DOM/WebGL
 * environment).
 */
function makeSceneCtx({ withComposer = true } = {}) {
  const ctx = {
    renderer: {},
    scene: {},
    camera: {},
    container: { clientWidth: 800, clientHeight: 600 },
    _composer: null,
    _outlinePass: null,
    _selectedObject: null,
    selectables: []
  };

  if (withComposer) {
    const outlinePass = makeOutlinePass();
    const composer = makeComposer();
    composer.passes.push({ _isRenderPass: true }); // pretend RenderPass was added
    composer.passes.push(outlinePass);
    ctx._composer = composer;
    ctx._outlinePass = outlinePass;
  }

  return ctx;
}

// ---------------------------------------------------------------------------
// applySelection
// ---------------------------------------------------------------------------

describe('applySelection', () => {
  let ctx;
  beforeEach(() => { ctx = makeSceneCtx(); });

  it('sets selectedObjects to [object] when an object is provided', () => {
    const obj = { isMesh: true };
    applySelection(ctx, obj);
    expect(ctx._outlinePass.selectedObjects).toEqual([obj]);
    expect(ctx._selectedObject).toBe(obj);
  });

  it('clears selectedObjects when null is passed', () => {
    const obj = { isMesh: true };
    applySelection(ctx, obj);
    applySelection(ctx, null);
    expect(ctx._outlinePass.selectedObjects).toEqual([]);
    expect(ctx._selectedObject).toBeNull();
  });

  it('clears selectedObjects when undefined is passed', () => {
    applySelection(ctx, undefined);
    expect(ctx._outlinePass.selectedObjects).toEqual([]);
    expect(ctx._selectedObject).toBeNull();
  });

  it('is a no-op when _outlinePass is null', () => {
    ctx._outlinePass = null;
    expect(() => applySelection(ctx, {})).not.toThrow();
  });

  it('replaces a previously selected object', () => {
    const a = { name: 'a' };
    const b = { name: 'b' };
    applySelection(ctx, a);
    applySelection(ctx, b);
    expect(ctx._outlinePass.selectedObjects).toEqual([b]);
    expect(ctx._selectedObject).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// resizeGlow
// ---------------------------------------------------------------------------

describe('resizeGlow', () => {
  let ctx;
  beforeEach(() => { ctx = makeSceneCtx(); });

  it('updates composer size', () => {
    resizeGlow(ctx, 1920, 1080);
    expect(ctx._composer._size).toEqual({ w: 1920, h: 1080 });
  });

  it('updates outlinePass resolution', () => {
    resizeGlow(ctx, 1024, 768);
    expect(ctx._outlinePass.resolution.w).toBe(1024);
    expect(ctx._outlinePass.resolution.h).toBe(768);
  });

  it('is a no-op when _composer is null', () => {
    ctx._composer = null;
    expect(() => resizeGlow(ctx, 1920, 1080)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// disposeSelectionGlow
// ---------------------------------------------------------------------------

describe('disposeSelectionGlow', () => {
  it('calls dispose on the composer', () => {
    const ctx = makeSceneCtx();
    const composer = ctx._composer;
    disposeSelectionGlow(ctx);
    expect(composer._disposed).toBe(true);
    expect(ctx._composer).toBeNull();
  });

  it('nulls _outlinePass and _selectedObject', () => {
    const ctx = makeSceneCtx();
    ctx._selectedObject = { isMesh: true };
    disposeSelectionGlow(ctx);
    expect(ctx._outlinePass).toBeNull();
    expect(ctx._selectedObject).toBeNull();
  });

  it('clears the selectables array', () => {
    const ctx = makeSceneCtx();
    ctx.selectables = [{ isMesh: true }];
    disposeSelectionGlow(ctx);
    expect(ctx.selectables).toEqual([]);
  });

  it('is safe to call when already disposed (null _composer)', () => {
    const ctx = makeSceneCtx({ withComposer: false });
    expect(() => disposeSelectionGlow(ctx)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// initSelectionGlow – unit test with patched imports
// ---------------------------------------------------------------------------

describe('initSelectionGlow guard clauses', () => {
  it('is a no-op when renderer is missing', () => {
    const ctx = {
      renderer: null, scene: {}, camera: {},
      container: { clientWidth: 800, clientHeight: 600 },
      _composer: null, _outlinePass: null
    };
    // initSelectionGlow imports real Three.js classes; in unit tests we just
    // verify the guard clause: if renderer is null the function returns early
    // without throwing and leaves _composer null.
    initSelectionGlow(ctx);
    expect(ctx._composer).toBeNull();
  });

  it('is a no-op when scene is missing', () => {
    const ctx = {
      renderer: {}, scene: null, camera: {},
      container: { clientWidth: 800, clientHeight: 600 },
      _composer: null, _outlinePass: null
    };
    initSelectionGlow(ctx);
    expect(ctx._composer).toBeNull();
  });

  it('is a no-op when camera is missing', () => {
    const ctx = {
      renderer: {}, scene: {}, camera: null,
      container: { clientWidth: 800, clientHeight: 600 },
      _composer: null, _outlinePass: null
    };
    initSelectionGlow(ctx);
    expect(ctx._composer).toBeNull();
  });
});
