/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * @module grade_blocks
 *
 * Loading and Three.js rendering of 3D polygonal grade block meshes.
 *
 * A grade block is a closed polyhedral mesh defined by:
 *   - An array of 3-D vertices  [[x,y,z], ...]
 *   - An array of triangle indices  [[i,j,k], ...]
 *   - Optional attributes and material hints
 *
 * Schema version "1.0" is the only version supported.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Data model helpers
// ---------------------------------------------------------------------------

/**
 * Parse and validate a raw JSON object (or JSON string) and return a
 * GradeBlockSet plain object.
 *
 * @param {object|string} input - Parsed JSON object or a JSON string.
 * @returns {{ schema_version: string, units: string, blocks: GradeBlock[] }}
 * @throws {Error} If schema_version is not "1.0" or required fields are missing.
 */
export function loadGradeBlocksFromJson(input) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;

  if (data.schema_version !== '1.0') {
    throw new Error(
      `Unsupported schema_version: ${JSON.stringify(data.schema_version)}. Expected "1.0".`
    );
  }

  if (!Array.isArray(data.blocks)) {
    throw new Error('"blocks" must be a JSON array.');
  }

  const blocks = data.blocks.map((raw, i) => {
    if (raw.id == null) throw new Error(`Block at index ${i} is missing required field "id".`);
    if (raw.name == null) throw new Error(`Block "${raw.id}" is missing required field "name".`);
    if (!Array.isArray(raw.vertices)) throw new Error(`Block "${raw.id}" is missing required field "vertices".`);
    if (!Array.isArray(raw.triangles)) throw new Error(`Block "${raw.id}" is missing required field "triangles".`);

    return {
      id: raw.id,
      name: raw.name,
      vertices: raw.vertices,
      triangles: raw.triangles,
      attributes: raw.attributes ?? {},
      material: raw.material ?? {},
    };
  });

  return {
    schema_version: data.schema_version,
    units: data.units ?? '',
    blocks,
  };
}

// ---------------------------------------------------------------------------
// Three.js geometry
// ---------------------------------------------------------------------------

/**
 * Convert a grade block to a Three.js BufferGeometry.
 *
 * @param {object} block - A grade block object (from loadGradeBlocksFromJson).
 * @returns {THREE.BufferGeometry}
 */
export function gradeBlockToThreeGeometry(block) {
  const geometry = new THREE.BufferGeometry();

  // Flatten vertices: [[x,y,z], ...] -> Float32Array
  const positionData = new Float32Array(block.vertices.length * 3);
  block.vertices.forEach(([x, y, z], i) => {
    positionData[i * 3] = x;
    positionData[i * 3 + 1] = y;
    positionData[i * 3 + 2] = z;
  });
  geometry.setAttribute('position', new THREE.BufferAttribute(positionData, 3));

  // Flatten triangles: [[i,j,k], ...] -> Uint32Array
  const indexData = new Uint32Array(block.triangles.length * 3);
  block.triangles.forEach(([a, b, c], i) => {
    indexData[i * 3] = a;
    indexData[i * 3 + 1] = b;
    indexData[i * 3 + 2] = c;
  });
  geometry.setIndex(new THREE.BufferAttribute(indexData, 1));

  geometry.computeVertexNormals();

  return geometry;
}

// ---------------------------------------------------------------------------
// Scene helpers
// ---------------------------------------------------------------------------

/**
 * Create Three.js meshes for all blocks and add them to the scene.
 *
 * @param {THREE.Scene} scene
 * @param {{ blocks: object[] }} blockSet - Result of loadGradeBlocksFromJson.
 * @param {object} [options]
 * @param {number} [options.defaultOpacity=1.0] - Fallback opacity when not set per block.
 * @returns {THREE.Group}
 */
export function addGradeBlocksToScene(scene, blockSet, options = {}) {
  const { defaultOpacity = 1.0 } = options;
  const group = new THREE.Group();

  blockSet.blocks.forEach((block) => {
    const geometry = gradeBlockToThreeGeometry(block);

    const color = block.material?.color ?? '#888888';
    const opacity = block.material?.opacity ?? defaultOpacity;
    const transparent = opacity < 1.0;

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      opacity,
      transparent,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = {
      id: block.id,
      attributes: block.attributes,
    };

    group.add(mesh);
  });

  scene.add(group);
  return group;
}
