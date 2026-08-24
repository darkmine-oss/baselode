/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  createTerrainSurface,
  setTerrain,
  clearTerrain,
  setTerrainOpacity,
  setTerrainVisibility,
  getTerrain,
} from '../src/viz/terrainScene.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flatGrid(width, height, elevation = 100) {
  return { width, height, elevations: new Array(width * height).fill(elevation) };
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
    terrain: null,
  };
}

const BOUNDS = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

// ---------------------------------------------------------------------------
// createTerrainSurface — bounds/grid validation
// ---------------------------------------------------------------------------

describe('createTerrainSurface — validation', () => {
  it('throws when grid is missing', () => {
    expect(() => createTerrainSurface({ bounds: BOUNDS })).toThrow(/grid/);
  });

  it('throws when bounds is missing', () => {
    expect(() => createTerrainSurface({ grid: flatGrid(4, 4) })).toThrow(/bounds/);
  });

  it('throws when bounds width is zero', () => {
    expect(() =>
      createTerrainSurface({ grid: flatGrid(4, 4), bounds: { minX: 5, minY: 0, maxX: 5, maxY: 10 } })
    ).toThrow(/invalid bounds/);
  });

  it('throws when flat elevations length does not match width*height', () => {
    expect(() =>
      createTerrainSurface({
        grid: { width: 4, height: 4, elevations: [1, 2, 3] },
        bounds: BOUNDS,
      })
    ).toThrow(/does not match/);
  });

  it('accepts a nested number[][] grid and infers width/height', () => {
    const layer = createTerrainSurface({
      grid: { elevations: [[1, 2, 3], [4, 5, 6]] },
      bounds: BOUNDS,
    });
    expect(layer.empty).toBe(false);
    expect(layer.mesh).not.toBeNull();
  });

  it('throws on a ragged nested grid instead of silently truncating rows', () => {
    expect(() =>
      createTerrainSurface({
        grid: { elevations: [[1, 2, 3], [4, 5]] },
        bounds: BOUNDS,
      })
    ).toThrow(/ragged/);
  });
});

// ---------------------------------------------------------------------------
// createTerrainSurface — geometry
// ---------------------------------------------------------------------------

describe('createTerrainSurface — geometry', () => {
  it('builds a mesh for a fully valid flat grid', () => {
    const layer = createTerrainSurface({ grid: flatGrid(5, 5, 42), bounds: BOUNDS });
    expect(layer.empty).toBe(false);
    expect(layer.mesh).not.toBeNull();
    expect(layer.elevationRange).toEqual({ min: 42, max: 42 });
  });

  it('computes vertex normals', () => {
    const layer = createTerrainSurface({ grid: flatGrid(5, 5), bounds: BOUNDS });
    expect(layer.mesh.geometry.getAttribute('normal')).toBeDefined();
  });

  it('respects vertexBudget by decimating large grids', () => {
    const grid = flatGrid(1000, 1000);
    const layer = createTerrainSurface({ grid, bounds: BOUNDS, vertexBudget: 50 });
    const positionCount = layer.mesh.geometry.getAttribute('position').count;
    // decimated grid's longest dimension should be close to the budget, not 1000
    expect(Math.sqrt(positionCount)).toBeLessThan(100);
  });

  it('decimated grids still span the full declared bounds edge-to-edge', () => {
    // Non-round dimensions that don't divide evenly into the vertex budget —
    // a fixed-stride decimation under-runs the far edge here.
    const width = 37, height = 41;
    const grid = { width, height, elevations: new Array(width * height).fill(5) };
    const layer = createTerrainSurface({ grid, bounds: BOUNDS, vertexBudget: 6 });
    const position = layer.mesh.geometry.getAttribute('position');
    let minXSeen = Infinity, maxXSeen = -Infinity, minYSeen = Infinity, maxYSeen = -Infinity;
    for (let i = 0; i < position.count; i++) {
      minXSeen = Math.min(minXSeen, position.getX(i));
      maxXSeen = Math.max(maxXSeen, position.getX(i));
      minYSeen = Math.min(minYSeen, position.getY(i));
      maxYSeen = Math.max(maxYSeen, position.getY(i));
    }
    expect(minXSeen).toBeCloseTo(BOUNDS.minX);
    expect(maxXSeen).toBeCloseTo(BOUNDS.maxX);
    expect(minYSeen).toBeCloseTo(BOUNDS.minY);
    expect(maxYSeen).toBeCloseTo(BOUNDS.maxY);
  });

  it('applies verticalExaggeration explicitly to Z, and defaults to 1 (no silent exaggeration)', () => {
    const flat = createTerrainSurface({ grid: flatGrid(3, 3, 10), bounds: BOUNDS });
    const flatZ = flat.mesh.geometry.getAttribute('position').getZ(0);
    expect(flatZ).toBe(10);

    const exaggerated = createTerrainSurface({
      grid: flatGrid(3, 3, 10),
      bounds: BOUNDS,
      verticalExaggeration: 3,
    });
    const exaggeratedZ = exaggerated.mesh.geometry.getAttribute('position').getZ(0);
    expect(exaggeratedZ).toBe(30);
  });

  it('omits quads touching a NoData cell instead of producing a spike', () => {
    const width = 3, height = 3;
    const elevations = [
      0, 0, 0,
      0, NaN, 0,
      0, 0, 0,
    ];
    const layer = createTerrainSurface({ grid: { width, height, elevations }, bounds: BOUNDS });
    // all 4 quads touch the centre NoData cell -> no triangles at all
    expect(layer.empty).toBe(true);
    expect(layer.mesh).toBeNull();
  });

  it('converts the declared nodata sentinel value to holes', () => {
    const width = 2, height = 2;
    const elevations = [-3.4e38, -3.4e38, -3.4e38, -3.4e38];
    const layer = createTerrainSurface({
      grid: { width, height, elevations, nodata: -3.4e38 },
      bounds: BOUNDS,
    });
    expect(layer.empty).toBe(true);
    expect(layer.mesh).toBeNull();
  });

  it('returns an empty (non-crashing) layer for an all-NoData grid', () => {
    const layer = createTerrainSurface({
      grid: { width: 4, height: 4, elevations: new Array(16).fill(NaN) },
      bounds: BOUNDS,
    });
    expect(layer.empty).toBe(true);
    expect(layer.mesh).toBeNull();
    expect(layer.elevationRange).toBeNull();
  });

  it('adds skirt geometry beyond the base grid when skirt is requested', () => {
    const withoutSkirt = createTerrainSurface({ grid: flatGrid(4, 4, 10), bounds: BOUNDS });
    const withSkirt = createTerrainSurface({ grid: flatGrid(4, 4, 10), bounds: BOUNDS, skirt: true });
    const baseVerts = withoutSkirt.mesh.geometry.getAttribute('position').count;
    const skirtVerts = withSkirt.mesh.geometry.getAttribute('position').count;
    expect(skirtVerts).toBeGreaterThan(baseVerts);
  });

  it('clamps out-of-range opacity with a warning, not a throw', () => {
    const layer = createTerrainSurface({ grid: flatGrid(3, 3), bounds: BOUNDS, opacity: 5 });
    expect(layer.opacity).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Scene-level lifecycle
// ---------------------------------------------------------------------------

describe('setTerrain / clearTerrain', () => {
  let ctx;
  beforeEach(() => { ctx = makeSceneCtx(); });

  it('adds the layer mesh to the scene and stores it on the context', () => {
    const layer = createTerrainSurface({ grid: flatGrid(3, 3), bounds: BOUNDS });
    setTerrain(ctx, layer);
    expect(ctx.scene._added).toContain(layer.mesh);
    expect(getTerrain(ctx)).toBe(layer);
  });

  it('does not add anything to the scene for an empty layer', () => {
    const layer = createTerrainSurface({ grid: { width: 2, height: 2, elevations: [NaN, NaN, NaN, NaN] }, bounds: BOUNDS });
    setTerrain(ctx, layer);
    expect(ctx.scene._added).toHaveLength(0);
    expect(getTerrain(ctx)).toBe(layer);
  });

  it('replaces and disposes the previous terrain layer', () => {
    const first = createTerrainSurface({ grid: flatGrid(3, 3), bounds: BOUNDS });
    const second = createTerrainSurface({ grid: flatGrid(3, 3), bounds: BOUNDS });
    setTerrain(ctx, first);
    setTerrain(ctx, second);
    expect(getTerrain(ctx)).toBe(second);
    expect(ctx.scene._removed).toContain(first.mesh);
  });

  it('clearTerrain removes and disposes the mesh', () => {
    const layer = createTerrainSurface({ grid: flatGrid(3, 3), bounds: BOUNDS });
    setTerrain(ctx, layer);
    clearTerrain(ctx);
    expect(ctx.scene._removed).toContain(layer.mesh);
    expect(getTerrain(ctx)).toBeNull();
  });

  it('clearTerrain on an empty context is a no-op', () => {
    expect(() => clearTerrain(ctx)).not.toThrow();
  });
});

describe('setTerrainOpacity / setTerrainVisibility', () => {
  let ctx;
  beforeEach(() => { ctx = makeSceneCtx(); });

  it('updates material opacity and clamps out-of-range values', () => {
    const layer = createTerrainSurface({ grid: flatGrid(3, 3), bounds: BOUNDS });
    setTerrain(ctx, layer);
    setTerrainOpacity(ctx, 0.5);
    expect(layer.mesh.material.opacity).toBe(0.5);
    setTerrainOpacity(ctx, 4);
    expect(layer.mesh.material.opacity).toBe(1);
  });

  it('is a no-op when there is no terrain layer', () => {
    expect(() => setTerrainOpacity(ctx, 0.5)).not.toThrow();
  });

  it('toggles mesh visibility', () => {
    const layer = createTerrainSurface({ grid: flatGrid(3, 3), bounds: BOUNDS });
    setTerrain(ctx, layer);
    setTerrainVisibility(ctx, false);
    expect(layer.mesh.visible).toBe(false);
    setTerrainVisibility(ctx, true);
    expect(layer.mesh.visible).toBe(true);
  });
});
