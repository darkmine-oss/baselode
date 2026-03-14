/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';

let _overlayIdCounter = 0;

/**
 * Normalize caller-supplied bounds to the canonical { minX, minY, maxX, maxY } form.
 * Accepts either { minX, minY, maxX, maxY } or { x, y, width, height }.
 *
 * @param {object} bounds
 * @returns {{ minX: number, minY: number, maxX: number, maxY: number }}
 * @throws {Error} if the resulting width or height is zero or negative
 */
export function normalizeBounds(bounds) {
  let minX, minY, maxX, maxY;

  if ('width' in bounds || 'height' in bounds || ('x' in bounds && !('maxX' in bounds))) {
    const x = Number(bounds.x ?? 0);
    const y = Number(bounds.y ?? 0);
    const width = Number(bounds.width ?? 0);
    const height = Number(bounds.height ?? 0);
    minX = x;
    minY = y;
    maxX = x + width;
    maxY = y + height;
  } else {
    minX = Number(bounds.minX);
    minY = Number(bounds.minY);
    maxX = Number(bounds.maxX);
    maxY = Number(bounds.maxY);
  }

  if (maxX - minX <= 0) {
    throw new Error(
      `Invalid raster bounds: width must be positive (got minX=${minX}, maxX=${maxX})`
    );
  }
  if (maxY - minY <= 0) {
    throw new Error(
      `Invalid raster bounds: height must be positive (got minY=${minY}, maxY=${maxY})`
    );
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Load a THREE.Texture from a source descriptor.
 *
 * Supported source types:
 *  - `{ type: 'url', url: string }` – load from a URL or data URI
 *  - `{ type: 'file', file: File }` – load from a browser File object
 *  - `{ type: 'texture', texture: THREE.Texture }` – use a pre-built texture
 *
 * @param {{ type: string, url?: string, file?: File, texture?: THREE.Texture }} source
 * @returns {Promise<THREE.Texture>}
 */
function loadTexture(source) {
  if (source.type === 'texture') {
    return Promise.resolve(source.texture);
  }

  let url;
  let createdObjectUrl = false;

  if (source.type === 'url') {
    url = source.url;
  } else if (source.type === 'file') {
    url = URL.createObjectURL(source.file);
    createdObjectUrl = true;
  } else {
    return Promise.reject(
      new Error(`Unsupported raster source type: "${source.type}"`)
    );
  }

  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (texture) => {
        if (createdObjectUrl) URL.revokeObjectURL(url);
        resolve(texture);
      },
      undefined,
      (err) => {
        if (createdObjectUrl) URL.revokeObjectURL(url);
        reject(
          new Error(
            `Failed to load raster texture from "${url}": ${err?.message ?? err}`
          )
        );
      }
    );
  });
}

/**
 * Create a raster overlay layer from the supplied options.
 *
 * The overlay is returned as a self-contained layer descriptor object. Add it
 * to a scene with addRasterOverlay().
 *
 * Placement: the image is rendered as a flat plane on the X/Y axis at the
 * given elevation. The left edge aligns with minX, the right with maxX, the
 * bottom with minY, and the top with maxY. Image orientation follows
 * THREE.js default texture behaviour (flipY=true), so north-up map images
 * are placed correctly without any additional rotation.
 *
 * @param {object} options
 * @param {string} [options.id] - Unique identifier; auto-generated if omitted
 * @param {string} [options.name] - Human-readable display name
 * @param {{ type: string }} options.source - Image source descriptor
 * @param {object} options.bounds - Placement bounds
 * @param {number} [options.elevation=0] - Z position in scene units
 * @param {number} [options.opacity=1] - Initial opacity [0, 1]; clamped if out of range
 * @param {boolean} [options.visible=true] - Initial visibility
 * @param {number} [options.renderOrder=0] - THREE.js renderOrder for draw-order control
 * @returns {Promise<object>} Raster overlay layer descriptor
 */
export async function createRasterOverlay(options) {
  const { source, bounds, elevation = 0, visible = true, renderOrder = 0 } = options;

  const id = options.id ?? `raster-overlay-${++_overlayIdCounter}`;
  const name = options.name ?? id;

  let opacity = options.opacity ?? 1;
  if (opacity < 0 || opacity > 1) {
    console.warn(
      `[baselode] raster overlay "${id}": opacity ${opacity} is outside [0, 1] — clamped`
    );
    opacity = Math.max(0, Math.min(1, opacity));
  }

  if (!source) throw new Error('raster overlay: options.source is required');
  if (!bounds) throw new Error('raster overlay: options.bounds is required');

  const normalizedBounds = normalizeBounds(bounds);
  const { minX, minY, maxX, maxY } = normalizedBounds;

  const width = maxX - minX;
  const height = maxY - minY;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const texture = await loadTexture(source);

  // PlaneGeometry lies in the XY plane by default. THREE.js TextureLoader sets
  // flipY=true, which means the image top-row maps to world maxY and the
  // image bottom-row maps to world minY — correct for north-up map images.
  const geometry = new THREE.PlaneGeometry(width, height);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(centerX, centerY, elevation);
  mesh.renderOrder = renderOrder;
  mesh.visible = visible;

  return { id, name, mesh, texture, bounds: normalizedBounds, elevation, opacity, visible };
}

// ---------------------------------------------------------------------------
// Scene-level helpers — all operate on a Baselode3DScene instance
// ---------------------------------------------------------------------------

/**
 * Add a raster overlay layer to the scene.
 *
 * The layer must have been created with createRasterOverlay(). Duplicate ids
 * replace the existing entry (the old mesh is removed and disposed first).
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {object} layer - Layer returned by createRasterOverlay()
 */
export function addRasterOverlay(sceneCtx, layer) {
  if (!sceneCtx.scene) return;
  if (sceneCtx.rasterOverlays.has(layer.id)) {
    removeRasterOverlay(sceneCtx, layer.id);
  }
  sceneCtx.rasterOverlays.set(layer.id, layer);
  sceneCtx.scene.add(layer.mesh);
}

/**
 * Remove a raster overlay from the scene and dispose its GPU resources.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {string} id - Overlay id
 */
export function removeRasterOverlay(sceneCtx, id) {
  const layer = sceneCtx.rasterOverlays.get(id);
  if (!layer) return;
  sceneCtx.scene?.remove(layer.mesh);
  layer.mesh.geometry.dispose();
  layer.mesh.material.dispose();
  if (layer.texture) layer.texture.dispose();
  sceneCtx.rasterOverlays.delete(id);
}

/**
 * Set the opacity of a raster overlay at runtime without recreating geometry.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {string} id - Overlay id
 * @param {number} opacity - New opacity [0, 1]; clamped if out of range
 */
export function setRasterOverlayOpacity(sceneCtx, id, opacity) {
  const layer = sceneCtx.rasterOverlays.get(id);
  if (!layer) return;
  const clamped = Math.max(0, Math.min(1, Number(opacity)));
  layer.opacity = clamped;
  layer.mesh.material.opacity = clamped;
  layer.mesh.material.needsUpdate = true;
}

/**
 * Show or hide a raster overlay without destroying it.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {string} id - Overlay id
 * @param {boolean} visible
 */
export function setRasterOverlayVisibility(sceneCtx, id, visible) {
  const layer = sceneCtx.rasterOverlays.get(id);
  if (!layer) return;
  layer.visible = Boolean(visible);
  layer.mesh.visible = layer.visible;
}

/**
 * Update the elevation (Z position) of a raster overlay at runtime.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {string} id - Overlay id
 * @param {number} elevation
 */
export function setRasterOverlayElevation(sceneCtx, id, elevation) {
  const layer = sceneCtx.rasterOverlays.get(id);
  if (!layer) return;
  layer.elevation = Number(elevation);
  layer.mesh.position.setZ(layer.elevation);
}

/**
 * Get a raster overlay by id, or undefined if not found.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {string} id
 * @returns {object|undefined}
 */
export function getRasterOverlay(sceneCtx, id) {
  return sceneCtx.rasterOverlays.get(id);
}

/**
 * Return all raster overlay layers in insertion order.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @returns {object[]}
 */
export function listRasterOverlays(sceneCtx) {
  return Array.from(sceneCtx.rasterOverlays.values());
}

/**
 * Remove all raster overlays from the scene and dispose all GPU resources.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 */
export function clearRasterOverlays(sceneCtx) {
  for (const id of [...sceneCtx.rasterOverlays.keys()]) {
    removeRasterOverlay(sceneCtx, id);
  }
}
