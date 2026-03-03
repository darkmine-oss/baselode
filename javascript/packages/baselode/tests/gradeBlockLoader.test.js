/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import {
  loadGradeBlocksFromJson,
  gradeBlockToThreeGeometry,
  addGradeBlocksToScene,
} from '../src/grade_blocks/gradeBlockLoader.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal valid grade block set matching the spec example mesh. */
const EXAMPLE_JSON = {
  schema_version: '1.0',
  units: 'm',
  blocks: [
    {
      id: 'LG',
      name: 'Low grade',
      attributes: { grade_class: 'LG' },
      material: { color: '#1FA44A', opacity: 1.0 },
      vertices: [
        [0, 10, 2], [10, 10, 2], [10, 7, 2], [0, 6, 2],
        [0, 10, 0], [10, 10, 0], [10, 7, 0], [0, 6, 0],
      ],
      triangles: [
        [0,1,2], [0,2,3],
        [5,4,7], [5,7,6],
        [4,5,1], [4,1,0],
        [5,6,2], [5,2,1],
        [6,7,3], [6,3,2],
        [7,4,0], [7,0,3],
      ],
    },
    {
      id: 'HG',
      name: 'High grade',
      attributes: { grade_class: 'HG' },
      material: { color: '#B02020', opacity: 1.0 },
      vertices: [
        [0, 6, 2], [10, 7, 2], [10, 0, 2], [0, 0, 2],
        [0, 6, 0], [10, 7, 0], [10, 0, 0], [0, 0, 0],
      ],
      triangles: [
        [0,1,2], [0,2,3],
        [5,4,7], [5,7,6],
        [4,5,1], [4,1,0],
        [5,6,2], [5,2,1],
        [6,7,3], [6,3,2],
        [7,4,0], [7,0,3],
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// loadGradeBlocksFromJson
// ---------------------------------------------------------------------------

describe('loadGradeBlocksFromJson', () => {
  it('parses a valid object and returns schema_version, units, blocks', () => {
    const result = loadGradeBlocksFromJson(EXAMPLE_JSON);
    expect(result.schema_version).toBe('1.0');
    expect(result.units).toBe('m');
    expect(result.blocks).toHaveLength(2);
  });

  it('parses a JSON string', () => {
    const result = loadGradeBlocksFromJson(JSON.stringify(EXAMPLE_JSON));
    expect(result.blocks).toHaveLength(2);
  });

  it('sets block id, name, vertices, triangles, attributes, material', () => {
    const { blocks } = loadGradeBlocksFromJson(EXAMPLE_JSON);
    const lg = blocks[0];
    expect(lg.id).toBe('LG');
    expect(lg.name).toBe('Low grade');
    expect(lg.vertices).toHaveLength(8);
    expect(lg.triangles).toHaveLength(12);
    expect(lg.attributes).toEqual({ grade_class: 'LG' });
    expect(lg.material.color).toBe('#1FA44A');
  });

  it('defaults attributes to {} when absent', () => {
    const input = {
      schema_version: '1.0',
      units: 'm',
      blocks: [{
        id: 'X', name: 'X',
        vertices: [[0,0,0],[1,0,0],[0,1,0]],
        triangles: [[0,1,2]],
      }],
    };
    const { blocks } = loadGradeBlocksFromJson(input);
    expect(blocks[0].attributes).toEqual({});
    expect(blocks[0].material).toEqual({});
  });

  it('throws on unsupported schema_version', () => {
    expect(() => loadGradeBlocksFromJson({ schema_version: '2.0', blocks: [] })).toThrow();
  });

  it('throws when blocks is not an array', () => {
    expect(() => loadGradeBlocksFromJson({ schema_version: '1.0', blocks: null })).toThrow();
  });

  it('throws when a block is missing id', () => {
    expect(() => loadGradeBlocksFromJson({
      schema_version: '1.0', blocks: [{ name: 'X', vertices: [], triangles: [] }],
    })).toThrow(/id/);
  });

  it('throws when a block is missing vertices', () => {
    expect(() => loadGradeBlocksFromJson({
      schema_version: '1.0', blocks: [{ id: 'X', name: 'X', triangles: [] }],
    })).toThrow(/vertices/);
  });
});

// ---------------------------------------------------------------------------
// gradeBlockToThreeGeometry  (Three.js is a peer dependency – use real import)
// ---------------------------------------------------------------------------

describe('gradeBlockToThreeGeometry', () => {
  it('returns a BufferGeometry with position and index attributes', () => {
    const { blocks } = loadGradeBlocksFromJson(EXAMPLE_JSON);
    const geo = gradeBlockToThreeGeometry(blocks[0]);
    expect(geo.getAttribute('position')).toBeDefined();
    expect(geo.getIndex()).toBeDefined();
  });

  it('position buffer has 3 × vertex count floats', () => {
    const { blocks } = loadGradeBlocksFromJson(EXAMPLE_JSON);
    const geo = gradeBlockToThreeGeometry(blocks[0]);
    expect(geo.getAttribute('position').count).toBe(8); // 8 vertices
  });

  it('index buffer has 3 × triangle count entries', () => {
    const { blocks } = loadGradeBlocksFromJson(EXAMPLE_JSON);
    const geo = gradeBlockToThreeGeometry(blocks[0]);
    expect(geo.getIndex().count).toBe(36); // 12 triangles × 3
  });

  it('computes vertex normals (normal attribute present)', () => {
    const { blocks } = loadGradeBlocksFromJson(EXAMPLE_JSON);
    const geo = gradeBlockToThreeGeometry(blocks[0]);
    expect(geo.getAttribute('normal')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// addGradeBlocksToScene
// ---------------------------------------------------------------------------

describe('addGradeBlocksToScene', () => {
  it('returns a THREE.Group', () => {
    const scene = { add: vi.fn() };
    const blockSet = loadGradeBlocksFromJson(EXAMPLE_JSON);
    const group = addGradeBlocksToScene(scene, blockSet);
    expect(group).toBeInstanceOf(THREE.Group);
    expect(scene.add).toHaveBeenCalledWith(group);
  });

  it('adds one mesh per block', () => {
    const scene = { add: vi.fn() };
    const blockSet = loadGradeBlocksFromJson(EXAMPLE_JSON);
    const group = addGradeBlocksToScene(scene, blockSet);
    expect(group.children).toHaveLength(2);
    group.children.forEach((child) => expect(child).toBeInstanceOf(THREE.Mesh));
  });

  it('sets mesh.userData with id and attributes', () => {
    const scene = { add: vi.fn() };
    const blockSet = loadGradeBlocksFromJson(EXAMPLE_JSON);
    const group = addGradeBlocksToScene(scene, blockSet);
    const lgMesh = group.children[0];
    expect(lgMesh.userData.id).toBe('LG');
    expect(lgMesh.userData.attributes).toEqual({ grade_class: 'LG' });
  });

  it('applies correct material color', () => {
    const scene = { add: vi.fn() };
    const blockSet = loadGradeBlocksFromJson(EXAMPLE_JSON);
    const group = addGradeBlocksToScene(scene, blockSet);
    // Material color is a THREE.Color; its getHexString() should match
    const lgMesh = group.children[0];
    expect(lgMesh.material.color.getHexString()).toBe('1fa44a');
  });
});
