/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { computeVolumeBounds } from '../interpolation/computeVolumeBounds.js';
import { IDWSampler }          from '../interpolation/IDWSampler.js';
import { buildVoxelGrid }      from '../interpolation/buildVoxelGrid.js';
import { IDWVolumeRenderer }   from '../renderers/IDWVolumeRenderer.js';

/**
 * High-level Baselode integration layer that combines:
 *  - IDW scalar-field interpolation
 *  - Voxel grid building
 *  - Three.js volume rendering
 *
 * Typical usage:
 * ```js
 * const layer = new IDWVolumeLayer({
 *   samples,
 *   idw:        { power: 2, searchRadius: 60, maxNeighbors: 16 },
 *   grid:       { dims: [64, 64, 64] },
 *   displayMin: 0,
 *   displayMax: 500,
 *   opacity:    0.4,
 * });
 * await layer.rebuild();
 * scene.add(layer.object3D);
 * ```
 *
 * The `object3D` must be removed from the scene before calling `dispose()`.
 */
export class IDWVolumeLayer {
  /**
   * @param {IDWVolumeLayerOptions} [options]
   */
  constructor(options = {}) {
    const {
      samples       = [],
      attributeName = null,
      bounds        = null,
      boundsPadding = 10,
      idw           = {},
      grid          = {},
      visible       = true,
      opacity       = 0.4,
      displayMin    = 0,
      displayMax    = 1,
      threshold     = null,
      blockMode     = true,
      steps         = 64,
      colorLow      = [0, 0, 1],
      colorHigh     = [1, 0, 0],
    } = options;

    /** @type {import('../interpolation/InterpSamplePoint.js').InterpSamplePoint[]} */
    this._samples       = Array.isArray(samples) ? samples.slice() : [];
    this._attributeName = attributeName;
    this._boundsOverride = bounds ?? null;
    this._boundsPadding  = Number(boundsPadding) || 0;
    this._idwOptions     = { power: 2, searchRadius: 50, ...idw };
    this._gridOptions    = { dims: [32, 32, 32], ...grid };

    this._displayMin = Number(displayMin);
    this._displayMax = Number(displayMax);
    this._opacity    = Number(opacity);
    this._threshold  = threshold;
    this._blockMode  = !!blockMode;
    this._steps      = Number(steps) || 64;
    this._colorLow   = colorLow;
    this._colorHigh  = colorHigh;
    this._visible    = !!visible;

    /** @type {IDWSampler|null} */
    this._sampler  = null;
    /** @type {import('../interpolation/buildVoxelGrid.js').VoxelGrid|null} */
    this._grid     = null;
    /** @type {IDWVolumeRenderer} */
    this._renderer = new IDWVolumeRenderer();
    this._renderer.setVisible(this._visible);

    /**
     * The Three.js Object3D to add to the scene.
     * @type {THREE.Object3D}
     */
    this.object3D = this._renderer.object3D;

    /** @type {{ cancelled: boolean }|null} */
    this._cancellationToken = null;
  }

  // ---------------------------------------------------------------------------
  // Configuration setters
  // ---------------------------------------------------------------------------

  /**
   * Replace the sample set.  Call rebuild() to re-compute the field.
   * @param {import('../interpolation/InterpSamplePoint.js').InterpSamplePoint[]} samples
   */
  setSamples(samples) {
    this._samples = Array.isArray(samples) ? samples.slice() : [];
  }

  /**
   * Set the attribute column name used as the interpolation value.
   * Only relevant when samples are derived at rebuild time from raw rows;
   * if samples already carry `.value`, this can be left null.
   * @param {string|null} name
   */
  setAttribute(name) {
    this._attributeName = name;
  }

  /**
   * Override the auto-computed bounding box.  Pass null to use auto-bounds.
   * @param {import('../interpolation/computeVolumeBounds.js').VolumeBounds|null} bounds
   */
  setBounds(bounds) {
    this._boundsOverride = bounds ?? null;
  }

  /**
   * Update IDW interpolation options.  Call rebuild() to re-compute.
   * @param {Partial<import('../interpolation/IDWSampler.js').IDWOptions>} opts
   */
  setIDWOptions(opts) {
    this._idwOptions = { ...this._idwOptions, ...opts };
  }

  /**
   * Update voxel grid options.  Call rebuild() to re-compute.
   * @param {Partial<import('../interpolation/buildVoxelGrid.js').GridOptions>} opts
   */
  setGridOptions(opts) {
    this._gridOptions = { ...this._gridOptions, ...opts };
  }

  // ---------------------------------------------------------------------------
  // Display setters (no rebuild required)
  // ---------------------------------------------------------------------------

  /** @param {number} min */
  setDisplayMin(min) {
    this._displayMin = Number(min);
    this._renderer.setDisplayOptions({ displayMin: this._displayMin, displayMax: this._displayMax });
  }

  /** @param {number} max */
  setDisplayMax(max) {
    this._displayMax = Number(max);
    this._renderer.setDisplayOptions({ displayMin: this._displayMin, displayMax: this._displayMax });
  }

  /** @param {number} opacity - [0, 1] */
  setOpacity(opacity) {
    this._opacity = Math.max(0, Math.min(1, Number(opacity)));
    this._renderer.setDisplayOptions({ opacity: this._opacity });
  }

  /** @param {number|null} threshold - Normalised [0, 1] cutoff, or null to disable */
  setThreshold(threshold) {
    this._threshold = threshold;
    this._renderer.setDisplayOptions({ threshold: this._threshold });
  }

  /** @param {boolean} blockMode */
  setBlockMode(blockMode) {
    this._blockMode = !!blockMode;
    this._renderer.setDisplayOptions({ blockMode: this._blockMode });
  }

  /** @param {boolean} visible */
  setVisible(visible) {
    this._visible = !!visible;
    this._renderer.setVisible(this._visible);
  }

  /**
   * Restrict the visible volume to an axis-aligned sub-box.  Bounds
   * are in normalised [0, 1] box-local space.  Default = (0,0,0)
   * → (1,1,1) (no clipping).  Setting any face inward exposes an
   * axis-aligned slice through the interpolated field.
   *
   * @param {[number, number, number]} min - Per-axis lower bound in [0, 1]
   * @param {[number, number, number]} max - Per-axis upper bound in [0, 1]
   */
  setClipBounds(min, max) {
    this._renderer.setClipBounds(min, max);
  }

  // ---------------------------------------------------------------------------
  // Build pipeline
  // ---------------------------------------------------------------------------

  /**
   * Compute bounds, build the spatial index, evaluate the scalar field onto
   * the voxel grid, and upload the result to the GPU.
   *
   * Returns a Promise that resolves once rendering is ready.
   *
   * @param {object} [opts]
   * @param {function} [opts.onProgress] - Progress callback { completed, total }
   * @returns {Promise<void>}
   */
  async rebuild(opts = {}) {
    // Cancel any in-flight build.
    if (this._cancellationToken) {
      this._cancellationToken.cancelled = true;
    }
    const token = { cancelled: false };
    this._cancellationToken = token;

    const samples = this._samples;
    if (!samples.length) {
      // Clear any prior build so a stale volume doesn't keep
      // rendering after the caller emptied the sample set.
      this._sampler = null;
      this._grid = null;
      this._renderer.setVisible(false);
      return;
    }

    // 1. Bounding box
    const bounds = this._boundsOverride ?? computeVolumeBounds(samples, this._boundsPadding);

    // 2. IDW sampler (builds spatial index internally)
    this._sampler = new IDWSampler(samples, this._idwOptions);

    if (token.cancelled) return;

    // 3. Voxel grid dims
    const dims = this._resolveDims(bounds);

    // 4. Build voxel grid (async, with progress)
    this._grid = await buildVoxelGrid(this._sampler, bounds, dims, {
      onProgress:        opts.onProgress,
      cancellationToken: token,
    });

    if (token.cancelled) return;

    // 5. Upload to renderer
    this._renderer.setGrid(this._grid, {
      displayMin: this._displayMin,
      displayMax: this._displayMax,
      opacity:    this._opacity,
      threshold:  this._threshold,
      blockMode:  this._blockMode,
      steps:      this._steps,
      colorLow:   this._colorLow,
      colorHigh:  this._colorHigh,
    });
    this._renderer.setVisible(this._visible);
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  /**
   * Return the IDW-interpolated value at a world point (x, y, z).
   * Returns null if the sampler has not been built yet.
   *
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number|null}
   */
  getValueAt(x, y, z) {
    if (!this._sampler) return null;
    return this._sampler.getValueAt(x, y, z);
  }

  /**
   * Return the current bounding box, or null if not yet computed.
   * @returns {import('../interpolation/computeVolumeBounds.js').VolumeBounds|null}
   */
  getBounds() {
    return this._grid?.bounds ?? null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Dispose all GPU resources.  Remove object3D from the scene before calling
   * this method.
   */
  dispose() {
    if (this._cancellationToken) {
      this._cancellationToken.cancelled = true;
      this._cancellationToken = null;
    }
    this._renderer.dispose();
    this._sampler = null;
    this._grid    = null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** @private */
  _resolveDims(bounds) {
    if (this._gridOptions.dims) {
      return this._gridOptions.dims.map(d => Math.max(1, Math.round(d)));
    }
    if (this._gridOptions.voxelSize) {
      const [vx, vy, vz] = this._gridOptions.voxelSize;
      const [sx, sy, sz] = bounds.size;
      return [
        Math.max(1, Math.round(sx / vx)),
        Math.max(1, Math.round(sy / vy)),
        Math.max(1, Math.round(sz / vz)),
      ];
    }
    return [32, 32, 32];
  }
}
