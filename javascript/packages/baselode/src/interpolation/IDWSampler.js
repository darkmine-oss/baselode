/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { SpatialHash3D } from './SpatialHash3D.js';

/**
 * IDW interpolation options.
 *
 * @typedef {object} IDWOptions
 * @property {number}  [power=2]          - Distance exponent (higher = more local influence)
 * @property {number}  [searchRadius=50]  - Search radius in world units
 * @property {number}  [maxNeighbors]     - Maximum neighbours to use
 * @property {number}  [minNeighbors=1]   - Minimum neighbours required to produce a value
 * @property {number}  [nodataValue=NaN]  - Value returned when no neighbours are found
 * @property {number}  [epsilon=1e-10]    - Distance threshold for exact-hit detection
 * @property {number}  [cellSize]         - Hash cell size passed to SpatialHash3D
 */

/**
 * Inverse-distance weighting scalar-field sampler.
 *
 * Implements ScalarFieldSampler:
 *   getValueAt(x, y, z) → number | null
 *
 * The interpolation kernel is independent of any rendering library and can
 * therefore be reused by voxel builders, slice/section tools, and probe
 * utilities.
 *
 * @example
 * const sampler = new IDWSampler(samples, { power: 2, searchRadius: 60 });
 * const v = sampler.getValueAt(123.4, 456.7, -89.0);
 */
export class IDWSampler {
  /**
   * @param {import('./InterpSamplePoint.js').InterpSamplePoint[]} samples
   * @param {IDWOptions} [options]
   */
  constructor(samples, options = {}) {
    const {
      power        = 2,
      searchRadius = 50,
      maxNeighbors,
      minNeighbors = 1,
      nodataValue  = NaN,
      epsilon      = 1e-10,
      cellSize,
    } = options;

    this._power        = Math.max(0, Number(power));
    this._searchRadius = Math.max(0, Number(searchRadius));
    this._maxNeighbors = (maxNeighbors != null && maxNeighbors > 0) ? Math.round(maxNeighbors) : null;
    this._minNeighbors = Math.max(1, Math.round(Number(minNeighbors) || 1));
    this._nodataValue  = isFinite(nodataValue) ? nodataValue : NaN;
    this._epsilon      = Math.max(0, Number(epsilon));

    /** @type {import('./SpatialHash3D.js').SpatialHash3D} */
    this._index = new SpatialHash3D({ cellSize: cellSize ?? this._searchRadius });
    this._index.build(Array.isArray(samples) ? samples : []);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Return the IDW-interpolated value at (x, y, z), or `nodataValue` (default
   * NaN) when no neighbours are found within the search radius.
   *
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number|null}
   */
  getValueAt(x, y, z) {
    let candidates = this._index.queryRadius(x, y, z, this._searchRadius);
    if (candidates.length === 0) return this._nodataValue;

    // Cap to maxNeighbors nearest, if requested
    if (this._maxNeighbors !== null && candidates.length > this._maxNeighbors) {
      candidates = _sortByDistance(candidates, x, y, z).slice(0, this._maxNeighbors);
    }

    if (candidates.length < this._minNeighbors) return this._nodataValue;

    // IDW kernel
    let weightSum = 0;
    let valueSum  = 0;
    for (const pt of candidates) {
      const dx = pt.x - x, dy = pt.y - y, dz = pt.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const d  = Math.sqrt(d2);

      if (d < this._epsilon) {
        // Exact or near-exact hit — return sample value immediately
        return pt.value;
      }

      const w = 1.0 / Math.pow(d, this._power);
      weightSum += w;
      valueSum  += w * pt.value;
    }

    if (weightSum === 0) return this._nodataValue;
    return valueSum / weightSum;
  }

  // ---------------------------------------------------------------------------
  // Configuration accessors (allow runtime updates without rebuild)
  // ---------------------------------------------------------------------------

  /** @param {number} power */
  setPower(power) { this._power = Math.max(0, Number(power)); }

  /** @param {number} radius */
  setSearchRadius(radius) {
    this._searchRadius = Math.max(0, Number(radius));
  }

  /** @param {number|null} max */
  setMaxNeighbors(max) {
    this._maxNeighbors = (max != null && max > 0) ? Math.round(max) : null;
  }

  /**
   * Replace all samples and rebuild the spatial index.
   * @param {import('./InterpSamplePoint.js').InterpSamplePoint[]} samples
   */
  setSamples(samples) {
    this._index.build(Array.isArray(samples) ? samples : []);
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * @private
 * Sort an array of {x,y,z} objects by distance to (qx,qy,qz), ascending.
 */
function _sortByDistance(pts, qx, qy, qz) {
  return pts.slice().sort((a, b) => {
    const dxa = a.x - qx, dya = a.y - qy, dza = a.z - qz;
    const dxb = b.x - qx, dyb = b.y - qy, dzb = b.z - qz;
    return (dxa * dxa + dya * dya + dza * dza) - (dxb * dxb + dyb * dyb + dzb * dzb);
  });
}
