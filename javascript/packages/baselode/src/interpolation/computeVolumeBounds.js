/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Axis-aligned 3D bounding volume.
 *
 * @typedef {object} VolumeBounds
 * @property {[number,number,number]} min    - [minX, minY, minZ]
 * @property {[number,number,number]} max    - [maxX, maxY, maxZ]
 * @property {[number,number,number]} size   - [sizeX, sizeY, sizeZ]
 * @property {[number,number,number]} center - [cx, cy, cz]
 */

/**
 * Compute a 3D axis-aligned bounding box that encloses all sample points,
 * then expand it by an optional uniform padding in world units.
 *
 * @param {Array<{x:number,y:number,z:number}>} points - Sample/trace points
 * @param {number} [padding=0] - Extra space (world units) added on every side
 * @returns {VolumeBounds}
 */
export function computeVolumeBounds(points, padding = 0) {
  if (!Array.isArray(points) || points.length === 0) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      size: [0, 0, 0],
      center: [0, 0, 0],
    };
  }

  let minX =  Infinity, minY =  Infinity, minZ =  Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const p of points) {
    const px = Number(p.x), py = Number(p.y), pz = Number(p.z);
    if (!isFinite(px) || !isFinite(py) || !isFinite(pz)) continue;
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
    if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
  }

  if (!isFinite(minX)) {
    // All points were non-finite
    return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0] };
  }

  const pad = isFinite(padding) ? padding : 0;
  minX -= pad; minY -= pad; minZ -= pad;
  maxX += pad; maxY += pad; maxZ += pad;

  return buildVolumeBoundsFromMinMax(minX, minY, minZ, maxX, maxY, maxZ);
}

/**
 * Construct a VolumeBounds object from explicit min/max values.
 *
 * @param {number} minX
 * @param {number} minY
 * @param {number} minZ
 * @param {number} maxX
 * @param {number} maxY
 * @param {number} maxZ
 * @returns {VolumeBounds}
 */
export function buildVolumeBoundsFromMinMax(minX, minY, minZ, maxX, maxY, maxZ) {
  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;
  return {
    min:    [minX, minY, minZ],
    max:    [maxX, maxY, maxZ],
    size:   [sizeX, sizeY, sizeZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
  };
}
