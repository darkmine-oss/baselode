/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A uniform 3D spatial hash grid for efficient radius-based and k-nearest
 * neighbour queries on static point sets.
 *
 * Implements the SpatialIndex3D interface:
 *   build(points)
 *   queryRadius(x, y, z, radius) → T[]
 *   queryKNearest(x, y, z, k) → T[]
 *
 * Points must expose numeric `.x`, `.y`, `.z` properties.
 *
 * @template T
 */
export class SpatialHash3D {
  /**
   * @param {object} [options]
   * @param {number} [options.cellSize=25] - Hash cell size in world units.
   *   Choose a value roughly equal to your expected search radius for best
   *   performance; smaller cells reduce redundant distance checks but
   *   increase cell count.
   */
  constructor(options = {}) {
    this._cellSize = Math.abs(Number(options.cellSize) || 25);
    /** @type {Map<string, T[]>} */
    this._cells = new Map();
    /** @type {T[]} */
    this._points = [];
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  /**
   * Insert all points and build the spatial hash.
   * Calling build() again replaces the previous index.
   *
   * @param {T[]} points - Objects with numeric x, y, z fields
   */
  build(points) {
    this._cells = new Map();
    this._points = Array.isArray(points) ? points.slice() : [];
    for (const pt of this._points) {
      const key = this._cellKey(pt.x, pt.y, pt.z);
      let cell = this._cells.get(key);
      if (!cell) { cell = []; this._cells.set(key, cell); }
      cell.push(pt);
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Return all inserted points within `radius` world units of (x, y, z).
   *
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} radius - Search radius in world units
   * @returns {T[]}
   */
  queryRadius(x, y, z, radius) {
    const cs = this._cellSize;
    const r2 = radius * radius;
    const cellRadius = Math.ceil(radius / cs);

    const cx0 = Math.floor(x / cs);
    const cy0 = Math.floor(y / cs);
    const cz0 = Math.floor(z / cs);

    const result = [];

    for (let ix = cx0 - cellRadius; ix <= cx0 + cellRadius; ix++) {
      for (let iy = cy0 - cellRadius; iy <= cy0 + cellRadius; iy++) {
        for (let iz = cz0 - cellRadius; iz <= cz0 + cellRadius; iz++) {
          const cell = this._cells.get(`${ix},${iy},${iz}`);
          if (!cell) continue;
          for (const pt of cell) {
            const dx = pt.x - x, dy = pt.y - y, dz = pt.z - z;
            if (dx * dx + dy * dy + dz * dz <= r2) {
              result.push(pt);
            }
          }
        }
      }
    }
    return result;
  }

  /**
   * Return the `k` nearest points to (x, y, z) across all inserted points.
   *
   * For large datasets this performs a global scan — use queryRadius for
   * performance-critical paths.
   *
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} k
   * @returns {T[]}
   */
  queryKNearest(x, y, z, k) {
    if (this._points.length === 0 || k <= 0) return [];
    const scored = this._points.map(pt => {
      const dx = pt.x - x, dy = pt.y - y, dz = pt.z - z;
      return { pt, d2: dx * dx + dy * dy + dz * dz };
    });
    scored.sort((a, b) => a.d2 - b.d2);
    return scored.slice(0, k).map(s => s.pt);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** @private */
  _cellKey(x, y, z) {
    const cs = this._cellSize;
    return `${Math.floor(x / cs)},${Math.floor(y / cs)},${Math.floor(z / cs)}`;
  }

  /** Number of points currently indexed */
  get size() { return this._points.length; }
}
