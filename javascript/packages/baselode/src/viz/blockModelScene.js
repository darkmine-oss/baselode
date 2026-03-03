/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { getColorForValue } from '../data/blockModelLoader.js';
import { fitCameraToBounds } from './baselode3dCameraControls.js';
import { syncSelectables } from './sceneSelectables.js';

// Six face definitions. neibDir locates the neighbour in that direction.
// verts are ±1 scale factors of the half-extents (dx/2 etc.).
const FACE_DEFS = [
  { normal: [ 1, 0, 0], neibDir: [ 1, 0, 0], verts: [[ 1,-1,-1],[ 1, 1,-1],[ 1, 1, 1],[ 1,-1, 1]] },
  { normal: [-1, 0, 0], neibDir: [-1, 0, 0], verts: [[-1,-1, 1],[-1, 1, 1],[-1, 1,-1],[-1,-1,-1]] },
  { normal: [ 0, 1, 0], neibDir: [ 0, 1, 0], verts: [[-1, 1, 1],[ 1, 1, 1],[ 1, 1,-1],[-1, 1,-1]] },
  { normal: [ 0,-1, 0], neibDir: [ 0,-1, 0], verts: [[ 1,-1, 1],[-1,-1, 1],[-1,-1,-1],[ 1,-1,-1]] },
  { normal: [ 0, 0, 1], neibDir: [ 0, 0, 1], verts: [[-1,-1, 1],[ 1,-1, 1],[ 1, 1, 1],[-1, 1, 1]] },
  { normal: [ 0, 0,-1], neibDir: [ 0, 0,-1], verts: [[ 1,-1,-1],[-1,-1,-1],[-1, 1,-1],[ 1, 1,-1]] },
];

/**
 * Render block model data as a single merged mesh of exterior faces only.
 *
 * Adjacent blocks' shared faces are skipped so there are no coincident
 * polygons and therefore no z-fighting. Vertex colours are used so the
 * entire model is a single draw call.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {Array<Object>} data - Block rows (canonical column names)
 * @param {string} selectedProperty - Attribute column used for colouring
 * @param {Object} stats - Property statistics
 * @param {Object} [options]
 * @param {Object} [options.offset] - Optional {x, y, z} translation
 * @param {number} [options.opacity=1.0] - Initial material opacity (0–1)
 * @param {boolean} [options.autoCenter=true] - Auto-centre blocks at scene origin
 */
export function setBlocks(sceneCtx, data, selectedProperty, stats, options = {}) {
  if (!sceneCtx.scene) return;

  clearBlocks(sceneCtx);

  if (!data || !selectedProperty || !stats) return;

  const { autoCenter = true, opacity = 1.0 } = options;

  let rawMinX = Infinity, rawMaxX = -Infinity;
  let rawMinY = Infinity, rawMaxY = -Infinity;
  let rawMinZ = Infinity, rawMaxZ = -Infinity;

  data.forEach((row) => {
    const x = Number(row.x ?? row.center_x ?? 0);
    const y = Number(row.y ?? row.center_y ?? 0);
    const z = Number(row.z ?? row.center_z ?? 0);
    const dx = Number(row.dx ?? row.size_x ?? 1);
    const dy = Number(row.dy ?? row.size_y ?? 1);
    const dz = Number(row.dz ?? row.size_z ?? 1);
    rawMinX = Math.min(rawMinX, x - dx / 2);
    rawMaxX = Math.max(rawMaxX, x + dx / 2);
    rawMinY = Math.min(rawMinY, y - dy / 2);
    rawMaxY = Math.max(rawMaxY, y + dy / 2);
    rawMinZ = Math.min(rawMinZ, z - dz / 2);
    rawMaxZ = Math.max(rawMaxZ, z + dz / 2);
  });

  let offX = 0, offY = 0, offZ = 0;
  if (options.offset) {
    offX = Number(options.offset.x ?? 0);
    offY = Number(options.offset.y ?? 0);
    offZ = Number(options.offset.z ?? 0);
  } else if (autoCenter) {
    offX = -((rawMinX + rawMaxX) / 2);
    offY = -((rawMinY + rawMaxY) / 2);
    offZ = -((rawMinZ + rawMaxZ) / 2);
  }

  const minX = rawMinX + offX, maxX = rawMaxX + offX;
  const minY = rawMinY + offY, maxY = rawMaxY + offY;
  const minZ = rawMinZ + offZ, maxZ = rawMaxZ + offZ;

  const bkey = (x, y, z) => `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
  const blockSet = new Set(
    data.map(row => bkey(Number(row.x ?? 0), Number(row.y ?? 0), Number(row.z ?? 0)))
  );

  const positions = [];
  const normals   = [];
  const colors    = [];
  const indices   = [];
  const quadToBlock = [];
  let vi = 0;

  data.forEach((row) => {
    const bx = Number(row.x ?? row.center_x ?? 0);
    const by = Number(row.y ?? row.center_y ?? 0);
    const bz = Number(row.z ?? row.center_z ?? 0);
    const dx = Number(row.dx ?? row.size_x ?? 1);
    const dy = Number(row.dy ?? row.size_y ?? 1);
    const dz = Number(row.dz ?? row.size_z ?? 1);
    const cx = bx + offX, cy = by + offY, cz = bz + offZ;

    const color = getColorForValue(row[selectedProperty], stats, THREE);
    const { r, g, b } = color;

    FACE_DEFS.forEach((face) => {
      const nbx = bx + face.neibDir[0] * dx;
      const nby = by + face.neibDir[1] * dy;
      const nbz = bz + face.neibDir[2] * dz;
      if (blockSet.has(bkey(nbx, nby, nbz))) return;

      const vBase = vi;
      face.verts.forEach(([sx, sy, sz]) => {
        positions.push(cx + sx * dx / 2, cy + sy * dy / 2, cz + sz * dz / 2);
        normals.push(face.normal[0], face.normal[1], face.normal[2]);
        colors.push(r, g, b);
        vi++;
      });
      indices.push(vBase, vBase + 1, vBase + 2, vBase, vBase + 2, vBase + 3);
      quadToBlock.push(row);
    });
  });

  if (positions.length === 0) return;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
  geometry.setAttribute('color',    new THREE.Float32BufferAttribute(colors,    3));
  geometry.setIndex(indices);

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData._isMergedBlocks = true;
  mesh.userData._quadToBlock = quadToBlock;
  mesh.userData._offset = { x: offX, y: offY, z: offZ };
  sceneCtx.scene.add(mesh);
  sceneCtx.blocks.push(mesh);
  syncSelectables(sceneCtx);

  if (sceneCtx.camera && sceneCtx.controls) {
    sceneCtx.lastBounds = { minX, maxX, minY, maxY, minZ, maxZ };
    fitCameraToBounds(sceneCtx, { minX, maxX, minY, maxY, minZ, maxZ });
  }
}

/**
 * Remove all block meshes (and the highlight ghost mesh) from the scene.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 */
export function clearBlocks(sceneCtx) {
  sceneCtx.blocks.forEach((block) => {
    sceneCtx.scene.remove(block);
    block.geometry.dispose();
    block.material.dispose();
  });
  sceneCtx.blocks = [];
  if (sceneCtx._blockHighlightMesh) {
    sceneCtx.scene?.remove(sceneCtx._blockHighlightMesh);
    sceneCtx._blockHighlightMesh.geometry.dispose();
    sceneCtx._blockHighlightMesh.material.dispose();
    sceneCtx._blockHighlightMesh = null;
  }
  syncSelectables(sceneCtx);
}

/**
 * Update the opacity of all currently rendered blocks.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {number} opacity - New opacity value between 0 and 1
 */
export function setBlockOpacity(sceneCtx, opacity) {
  const clamped = Math.max(0, Math.min(1, Number(opacity)));
  sceneCtx.blocks.forEach((block) => {
    if (block.material) {
      block.material.opacity = clamped;
      block.material.transparent = clamped < 1;
      block.material.needsUpdate = true;
    }
  });
}

/**
 * Return (creating on first use) an invisible ghost box mesh positioned and
 * scaled to exactly cover one block. The OutlinePass uses its geometry
 * shape to draw the per-block glow; the box itself is invisible to the
 * normal render.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {object} blockRow - Block data row
 * @param {object} offset - Scene offset {x, y, z}
 * @returns {THREE.Mesh}
 */
export function getBlockHighlightMesh(sceneCtx, blockRow, offset) {
  const offX = offset?.x ?? 0;
  const offY = offset?.y ?? 0;
  const offZ = offset?.z ?? 0;
  const cx = Number(blockRow.x ?? blockRow.center_x ?? 0) + offX;
  const cy = Number(blockRow.y ?? blockRow.center_y ?? 0) + offY;
  const cz = Number(blockRow.z ?? blockRow.center_z ?? 0) + offZ;
  const dx = Number(blockRow.dx ?? blockRow.size_x ?? 1);
  const dy = Number(blockRow.dy ?? blockRow.size_y ?? 1);
  const dz = Number(blockRow.dz ?? blockRow.size_z ?? 1);
  if (!sceneCtx._blockHighlightMesh) {
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    sceneCtx._blockHighlightMesh = new THREE.Mesh(geom, mat);
    sceneCtx.scene.add(sceneCtx._blockHighlightMesh);
  }
  sceneCtx._blockHighlightMesh.position.set(cx, cy, cz);
  sceneCtx._blockHighlightMesh.scale.set(dx, dy, dz);
  return sceneCtx._blockHighlightMesh;
}
