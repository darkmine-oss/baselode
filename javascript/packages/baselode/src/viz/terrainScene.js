/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';

const DEFAULT_MAX_DIMENSION = 300;

let _terrainIdCounter = 0;

/**
 * Normalize a caller-supplied elevation grid to a flat row-major Float32Array
 * plus width/height, with NoData cells converted to NaN.
 *
 * Accepts either a flat row-major array (grid.elevations + grid.width/height)
 * or a nested number[][] (grid.elevations as rows of columns; width/height
 * inferred from its shape). Row 0 is the north edge (maps to bounds.maxY),
 * matching createRasterOverlay's image-top-row-is-north convention.
 *
 * This module has no CRS awareness — bounds and grid coordinates must already
 * be in the same projected/local units the rest of the scene uses.
 *
 * @param {object} grid
 * @returns {{ width: number, height: number, elevations: Float32Array }}
 */
function normalizeGrid(grid) {
  if (!grid || !grid.elevations) {
    throw new Error('terrain surface: grid.elevations is required');
  }

  let width, height, source;
  if (Array.isArray(grid.elevations) && Array.isArray(grid.elevations[0])) {
    height = grid.elevations.length;
    width = grid.elevations[0].length;
    if (width < 2 || height < 2) {
      throw new Error('terrain surface: grid.elevations must have at least 2 rows and 2 columns');
    }
    source = new Float32Array(width * height);
    for (let row = 0; row < height; row++) {
      const rowValues = grid.elevations[row];
      if (!Array.isArray(rowValues) || rowValues.length !== width) {
        throw new Error(
          `terrain surface: grid.elevations is ragged — row ${row} has length ${rowValues?.length}, expected ${width}`
        );
      }
      for (let col = 0; col < width; col++) {
        source[row * width + col] = Number(rowValues[col]);
      }
    }
  } else {
    width = Number(grid.width);
    height = Number(grid.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
      throw new Error('terrain surface: grid.width/grid.height must be integers >= 2 for a flat elevations array');
    }
    source = Float32Array.from(grid.elevations, Number);
    if (source.length !== width * height) {
      throw new Error(
        `terrain surface: grid.elevations length (${source.length}) does not match width*height (${width * height})`
      );
    }
  }

  // Compare against the nodata sentinel rounded to float32 — `source` is a
  // Float32Array, so a float64 sentinel (e.g. -3.4e38) can silently fail to
  // exact-match the already-rounded stored value otherwise.
  const nodata = grid.nodata;
  const nodataIsFinite = Number.isFinite(nodata);
  const nodataF32 = nodataIsFinite ? Math.fround(nodata) : NaN;
  for (let i = 0; i < source.length; i++) {
    const value = source[i];
    if (!Number.isFinite(value) || (nodataIsFinite && value === nodataF32)) {
      source[i] = NaN;
    }
  }

  return { width, height, elevations: source };
}

/**
 * Decimate a grid to keep its longest dimension within maxDimension, using
 * nearest-neighbour striding. Nearest-neighbour (rather than averaging) means
 * a NoData source cell stays NoData in the output instead of being blended
 * into a fabricated elevation.
 *
 * @param {{ width: number, height: number, elevations: Float32Array }} source
 * @param {number} maxDimension
 * @returns {{ width: number, height: number, elevations: Float32Array }}
 */
function decimateGrid({ width, height, elevations }, maxDimension) {
  const longest = Math.max(width, height);
  if (!maxDimension || longest <= maxDimension) {
    return { width, height, elevations };
  }

  const scale = maxDimension / longest;
  const outWidth = Math.max(2, Math.round(width * scale));
  const outHeight = Math.max(2, Math.round(height * scale));
  const out = new Float32Array(outWidth * outHeight);

  // Evenly spaced source indices spanning the FULL source extent (0..dim-1),
  // not a fixed stride — a fixed stride under-runs the far edge (e.g. a
  // 1000-cell dimension with stride 4 stops at source cell 996), which
  // stretches/misaligns the terrain against its declared bounds.
  for (let row = 0; row < outHeight; row++) {
    const srcRow = outHeight > 1 ? Math.round((row * (height - 1)) / (outHeight - 1)) : 0;
    for (let col = 0; col < outWidth; col++) {
      const srcCol = outWidth > 1 ? Math.round((col * (width - 1)) / (outWidth - 1)) : 0;
      out[row * outWidth + col] = elevations[srcRow * width + srcCol];
    }
  }

  return { width: outWidth, height: outHeight, elevations: out };
}

/**
 * Append a vertical wall around the grid's outer rectangular perimeter,
 * dropping from each valid perimeter vertex down to `skirtZ` (already scaled
 * by verticalExaggeration). This is a render-only fill so the terrain sheet
 * doesn't look paper-thin from a low camera angle at the survey window's
 * edge — it is not sampled elevation data. It does not attempt to close
 * interior NoData holes, only the outer rectangle.
 */
function appendPerimeterSkirt({ width, height, isValid, vertexIndex }, positions, indices, skirtZ) {
  let nextIndex = positions.length / 3;

  const addWallSegment = (row1, col1, row2, col2) => {
    if (!isValid(row1, col1) || !isValid(row2, col2)) return;
    const i1 = vertexIndex(row1, col1);
    const i2 = vertexIndex(row2, col2);
    const x1 = positions[i1 * 3], y1 = positions[i1 * 3 + 1];
    const x2 = positions[i2 * 3], y2 = positions[i2 * 3 + 1];

    const skirtA = nextIndex++;
    positions.push(x1, y1, skirtZ);
    const skirtB = nextIndex++;
    positions.push(x2, y2, skirtZ);

    indices.push(i1, i2, skirtB, i1, skirtB, skirtA);
  };

  for (let col = 0; col < width - 1; col++) {
    addWallSegment(0, col, 0, col + 1);
    addWallSegment(height - 1, col, height - 1, col + 1);
  }
  for (let row = 0; row < height - 1; row++) {
    addWallSegment(row, 0, row + 1, 0);
    addWallSegment(row, width - 1, row + 1, width - 1);
  }
}

/**
 * Build a THREE.BufferGeometry height-grid surface from a decimated,
 * NoData-nulled elevation grid.
 *
 * Quads with any NaN corner are omitted entirely — real holes in the mesh,
 * not fake elevations. Returns { geometry: null, elevationRange: null } when
 * the grid has no valid data at all (e.g. a window entirely outside DEM
 * coverage), so the caller can produce an empty terrain layer instead of
 * throwing or rendering a garbage surface.
 */
function buildGeometry(gridData, bounds, { verticalExaggeration, skirt, skirtDepth }) {
  const { width, height, elevations } = gridData;
  const { minX, minY, maxX, maxY } = bounds;
  const stepX = width > 1 ? (maxX - minX) / (width - 1) : 0;
  const stepY = height > 1 ? (maxY - minY) / (height - 1) : 0;

  const vertexIndex = (row, col) => row * width + col;
  const isValid = (row, col) => Number.isFinite(elevations[vertexIndex(row, col)]);

  const positions = [];
  const indices = [];
  let min = Infinity, max = -Infinity;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const elevation = elevations[vertexIndex(row, col)];
      const x = minX + col * stepX;
      // Row 0 is the north edge -> maps to maxY (matches createRasterOverlay's
      // image-top-row-is-north convention).
      const y = maxY - row * stepY;
      const z = Number.isFinite(elevation) ? elevation * verticalExaggeration : 0;
      positions.push(x, y, z);
      if (Number.isFinite(elevation)) {
        min = Math.min(min, elevation);
        max = Math.max(max, elevation);
      }
    }
  }

  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      if (!isValid(row, col) || !isValid(row, col + 1) || !isValid(row + 1, col + 1) || !isValid(row + 1, col)) {
        continue;
      }
      const a = vertexIndex(row, col);
      const b = vertexIndex(row, col + 1);
      const c = vertexIndex(row + 1, col + 1);
      const d = vertexIndex(row + 1, col);
      indices.push(a, b, c, a, c, d);
    }
  }

  if (indices.length === 0 || !Number.isFinite(min)) {
    return { geometry: null, elevationRange: null };
  }

  if (skirt) {
    const depth = Number.isFinite(skirtDepth) ? skirtDepth : min - Math.max(max - min, 1) * 0.1;
    appendPerimeterSkirt({ width, height, isValid, vertexIndex }, positions, indices, depth * verticalExaggeration);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return { geometry, elevationRange: { min, max } };
}

/**
 * Create a terrain surface layer from a sampled elevation grid.
 *
 * The grid and bounds must already be in the same projected/local scene
 * units as the rest of the scene (drillholes, blocks, etc.) — this package
 * has no CRS awareness and does not reproject anything. Callers windowing a
 * DEM COG must reproject and NoData-null the samples themselves before
 * calling this.
 *
 * @param {object} options
 * @param {string} [options.id] - Unique identifier; auto-generated if omitted
 * @param {string} [options.name] - Human-readable display name
 * @param {object} options.grid - { width, height, elevations, nodata } or { elevations: number[][], nodata }
 * @param {object} options.bounds - { minX, minY, maxX, maxY } in scene units
 * @param {number} [options.verticalExaggeration=1] - Explicit Z scale factor; never applied silently by this module
 * @param {number} [options.vertexBudget] - Max vertices along the grid's longest dimension (default 300)
 * @param {boolean} [options.skirt=false] - Add a render-only wall around the outer valid-data perimeter
 * @param {number} [options.skirtDepth] - Absolute elevation for the skirt base; defaults to just below the sampled minimum
 * @param {number} [options.opacity=1] - Initial opacity [0, 1]; clamped if out of range
 * @param {boolean} [options.visible=true] - Initial visibility
 * @param {number} [options.renderOrder=-1] - THREE.js renderOrder; terrain defaults to drawing before other layers
 * @returns {object} Terrain surface layer descriptor. `mesh` is null (and `empty` is true) when the window has no valid data.
 */
export function createTerrainSurface(options = {}) {
  const { grid, bounds } = options;
  if (!grid) throw new Error('terrain surface: options.grid is required');
  if (!bounds) throw new Error('terrain surface: options.bounds is required');

  const minX = Number(bounds.minX);
  const minY = Number(bounds.minY);
  const maxX = Number(bounds.maxX);
  const maxY = Number(bounds.maxY);
  if (!(maxX - minX > 0) || !(maxY - minY > 0)) {
    throw new Error(
      `terrain surface: invalid bounds (minX=${minX}, maxX=${maxX}, minY=${minY}, maxY=${maxY})`
    );
  }

  const id = options.id ?? `terrain-surface-${++_terrainIdCounter}`;
  const name = options.name ?? id;
  const verticalExaggeration = options.verticalExaggeration ?? 1;
  const maxDimension = options.vertexBudget ?? DEFAULT_MAX_DIMENSION;
  const skirt = options.skirt ?? false;
  const visible = options.visible ?? true;
  const renderOrder = options.renderOrder ?? -1;

  let opacity = options.opacity ?? 1;
  if (opacity < 0 || opacity > 1) {
    console.warn(
      `[baselode] terrain surface "${id}": opacity ${opacity} is outside [0, 1] — clamped`
    );
    opacity = Math.max(0, Math.min(1, opacity));
  }

  const normalized = normalizeGrid(grid);
  const decimated = decimateGrid(normalized, maxDimension);
  const { geometry, elevationRange } = buildGeometry(
    decimated,
    { minX, minY, maxX, maxY },
    { verticalExaggeration, skirt, skirtDepth: options.skirtDepth }
  );

  const boundsOut = { minX, minY, maxX, maxY };

  if (!geometry) {
    // Window entirely outside DEM coverage / all-NoData: an empty layer, not
    // a crash or a fabricated flat surface.
    return {
      id, name, mesh: null, bounds: boundsOut, elevationRange: null,
      verticalExaggeration, opacity, visible, empty: true,
    };
  }

  const material = new THREE.MeshLambertMaterial({
    color: 0x8a8a7a,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = visible;
  mesh.renderOrder = renderOrder;

  return {
    id, name, mesh, bounds: boundsOut, elevationRange,
    verticalExaggeration, opacity, visible, empty: false,
  };
}

// ---------------------------------------------------------------------------
// Scene-level helpers — all operate on a Baselode3DScene instance.
// A scene has a single active terrain layer (v1); setting a new one replaces
// and disposes the previous one, mirroring rasterOverlayScene's same-id
// replace behaviour.
// ---------------------------------------------------------------------------

/**
 * Set the scene's terrain layer, replacing and disposing any existing one.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {object} layer - Layer returned by createTerrainSurface()
 */
export function setTerrain(sceneCtx, layer) {
  if (!sceneCtx.scene) return;
  clearTerrain(sceneCtx);
  sceneCtx.terrain = layer ?? null;
  if (layer?.mesh) {
    sceneCtx.scene.add(layer.mesh);
  }
}

/**
 * Remove the scene's terrain layer (if any) and dispose its GPU resources.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 */
export function clearTerrain(sceneCtx) {
  const layer = sceneCtx.terrain;
  if (layer?.mesh) {
    sceneCtx.scene?.remove(layer.mesh);
    layer.mesh.geometry.dispose();
    layer.mesh.material.dispose();
  }
  sceneCtx.terrain = null;
}

/**
 * Set the terrain layer's opacity at runtime without recreating geometry.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {number} opacity - New opacity [0, 1]; clamped if out of range
 */
export function setTerrainOpacity(sceneCtx, opacity) {
  const layer = sceneCtx.terrain;
  if (!layer?.mesh) return;
  const clamped = Math.max(0, Math.min(1, Number(opacity)));
  layer.opacity = clamped;
  layer.mesh.material.opacity = clamped;
  layer.mesh.material.transparent = clamped < 1;
  layer.mesh.material.needsUpdate = true;
}

/**
 * Show or hide the terrain layer without destroying it.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {boolean} visible
 */
export function setTerrainVisibility(sceneCtx, visible) {
  const layer = sceneCtx.terrain;
  if (!layer) return;
  layer.visible = Boolean(visible);
  if (layer.mesh) layer.mesh.visible = layer.visible;
}

/**
 * Return the scene's current terrain layer, or null if none is set.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @returns {object|null}
 */
export function getTerrain(sceneCtx) {
  return sceneCtx.terrain ?? null;
}
