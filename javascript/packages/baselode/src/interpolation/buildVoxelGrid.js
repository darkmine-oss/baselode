/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A regular 3D voxel grid storing a scalar field.
 *
 * @typedef {object} VoxelGrid
 * @property {import('./computeVolumeBounds.js').VolumeBounds} bounds - World bounding box
 * @property {[number,number,number]} dims      - [nx, ny, nz] — number of voxels per axis
 * @property {[number,number,number]} voxelSize - [vx, vy, vz] — voxel dimensions in world units
 * @property {Float32Array} values              - Flat array (length = nx*ny*nz), indexed as
 *                                               ix + nx*(iy + ny*iz)
 * @property {Uint8Array}   nodataMask          - 1 = no-data, 0 = has value (same indexing)
 */

/**
 * Grid generation options.
 *
 * @typedef {object} GridOptions
 * @property {[number,number,number]} [dims]      - [nx, ny, nz] voxel counts (mutually exclusive with voxelSize)
 * @property {[number,number,number]} [voxelSize] - Voxel size in world units (mutually exclusive with dims)
 */

/**
 * Progress callback.
 * @callback BuildProgressCallback
 * @param {{ completed: number, total: number }} progress
 */

/**
 * Build a {@link VoxelGrid} by evaluating a scalar-field sampler at the center
 * of every voxel cell.
 *
 * The implementation uses asynchronous yielding (via `Promise`/micro-task
 * chunking) to avoid completely blocking the main thread for large grids.
 * Callers running in a Web Worker can pass `{ sync: true }` to disable
 * yielding.
 *
 * Memory guidance:
 *   64^3  ≈   1 MB  (Float32 + Uint8)
 *   128^3 ≈   8 MB
 *   256^3 ≈  64 MB  — use with caution
 *
 * @param {import('./IDWSampler.js').IDWSampler} sampler
 * @param {import('./computeVolumeBounds.js').VolumeBounds} bounds
 * @param {[number,number,number]} dims - [nx, ny, nz]
 * @param {object} [options]
 * @param {boolean} [options.sync=false] - Disable async yielding (for worker use)
 * @param {BuildProgressCallback} [options.onProgress] - Called after each XZ slab
 * @param {{ cancelled: boolean }} [options.cancellationToken] - Set .cancelled=true to abort
 * @returns {Promise<VoxelGrid>}
 */
export async function buildVoxelGrid(sampler, bounds, dims, options = {}) {
  const { sync = false, onProgress, cancellationToken } = options;

  const [nx, ny, nz] = dims.map(d => Math.max(1, Math.round(d)));

  const [minX, minY, minZ] = bounds.min;
  const [sizeX, sizeY, sizeZ] = bounds.size;

  const vx = nx > 0 ? sizeX / nx : 0;
  const vy = ny > 0 ? sizeY / ny : 0;
  const vz = nz > 0 ? sizeZ / nz : 0;

  const total = nx * ny * nz;
  const values    = new Float32Array(total);
  const nodataMask = new Uint8Array(total);

  // Recognise the sampler's own no-data sentinel (default NaN, but
  // callers can configure a finite sentinel like `-9999`).  Without
  // this, a finite sentinel would be written to `values` as a valid
  // datum and downstream rendering would treat it as a real value.
  const sentinel = sampler && typeof sampler.nodataValue === 'number'
    ? sampler.nodataValue
    : NaN;
  const sentinelIsFinite = Number.isFinite(sentinel);

  const YIELD_EVERY = 4096; // voxels between async yields
  let cursor = 0;

  for (let iz = 0; iz < nz; iz++) {
    if (cancellationToken?.cancelled) break;

    const wz = minZ + (iz + 0.5) * vz;

    for (let iy = 0; iy < ny; iy++) {
      const wy = minY + (iy + 0.5) * vy;

      for (let ix = 0; ix < nx; ix++) {
        const wx = minX + (ix + 0.5) * vx;
        const idx = ix + nx * (iy + ny * iz);

        const v = sampler.getValueAt(wx, wy, wz);
        const isNoData = (
          v === null
          || (typeof v === 'number' && !isFinite(v))
          || (sentinelIsFinite && v === sentinel)
        );
        if (isNoData) {
          nodataMask[idx] = 1;
          values[idx] = 0;
        } else {
          values[idx] = v;
          nodataMask[idx] = 0;
        }
        cursor++;

        // Yield to the event loop periodically to avoid main-thread freezes
        if (!sync && cursor % YIELD_EVERY === 0) {
          await _yield();
        }
      }
    }

    if (onProgress) {
      onProgress({ completed: cursor, total });
    }
  }

  return {
    bounds,
    dims:      [nx, ny, nz],
    voxelSize: [vx, vy, vz],
    values,
    nodataMask,
  };
}

/**
 * Compute voxel dimensions and total count from a bounds + dims pair.
 *
 * @param {import('./computeVolumeBounds.js').VolumeBounds} bounds
 * @param {[number,number,number]} dims
 * @returns {{ voxelSize: [number,number,number], total: number }}
 */
export function voxelGridStats(bounds, dims) {
  const [nx, ny, nz] = dims.map(d => Math.max(1, Math.round(d)));
  const [sizeX, sizeY, sizeZ] = bounds.size;
  return {
    voxelSize: [sizeX / nx, sizeY / ny, sizeZ / nz],
    total: nx * ny * nz,
  };
}

/** @private */
function _yield() {
  return new Promise(resolve => setTimeout(resolve, 0));
}
