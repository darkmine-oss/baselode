/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildDrillholeTubeGeometry, defaultTubeRadius, updateTubeRadius } from '../src/viz/drillholeTubeGeometry.js';

const holes = [
  { id: 'DDH001', project: 'P', points: [
    { x: 0, y: 0, z: 100, md: 0 },
    { x: 0, y: 0, z: 50, md: 50 },
    { x: 5, y: 0, z: 0, md: 100.2 },
  ] },
  { id: 'DDH002', points: [{ x: 100, y: 0, z: 100, md: 0 }, { x: 100, y: 0, z: 0, md: 100 }] },
  { id: 'SINGLE', points: [{ x: 200, y: 0, z: 100, md: 0 }] },
  { id: 'BAD', points: [{ x: 'nope', y: 0, z: 0 }] },
];

describe('buildDrillholeTubeGeometry', () => {
  it('packs every multi-station hole into one geometry with per-hole ranges', () => {
    const { geometry, holes: meta, singlePointHoles, bounds } = buildDrillholeTubeGeometry(holes, { radialSegments: 6, radius: 2 });
    expect(geometry).toBeInstanceOf(THREE.BufferGeometry);
    expect(meta).toHaveLength(2);
    expect(singlePointHoles.map((h) => h.id)).toEqual(['SINGLE']);
    expect(bounds).toMatchObject({ minX: 0, maxX: 200, minZ: 0, maxZ: 100 });

    // 3 rings + 2 caps for hole 1, 2 rings + 2 caps for hole 2
    const expectedVerts = (3 * 6 + 2 * 7) + (2 * 6 + 2 * 7);
    expect(geometry.getAttribute('position').count).toBe(expectedVerts);
    const expectedIndices = (2 * 6 * 6 + 2 * 6 * 3) + (1 * 6 * 6 + 2 * 6 * 3);
    expect(geometry.index.count).toBe(expectedIndices);

    const [a, b] = meta;
    expect(a.indexStart).toBe(0);
    expect(a.indexStart + a.indexCount).toBe(b.indexStart);
    expect(b.indexStart + b.indexCount).toBe(geometry.index.count);
    expect(a.mdMin).toBe(0);
    expect(a.mdMax).toBeCloseTo(100.2);
  });

  it('writes hole index and normalised depth per vertex', () => {
    const { geometry, holes: meta } = buildDrillholeTubeGeometry(holes, { radialSegments: 4 });
    const holeAttr = geometry.getAttribute('aHole');
    const mdAttr = geometry.getAttribute('aMdNorm');
    const second = meta[1];
    for (let i = second.vertexStart; i < second.vertexStart + second.vertexCount; i += 1) {
      expect(holeAttr.getX(i)).toBe(1);
      expect(mdAttr.getX(i)).toBeGreaterThanOrEqual(0);
      expect(mdAttr.getX(i)).toBeLessThanOrEqual(1);
    }
    // first ring of the first hole is at the collar → depth 0
    expect(mdAttr.getX(0)).toBe(0);
  });

  it('keeps the baked position equal to centre + radial * radius, and updates on radius change', () => {
    const { geometry } = buildDrillholeTubeGeometry(holes, { radialSegments: 8, radius: 3 });
    const pos = geometry.getAttribute('position');
    const centre = geometry.getAttribute('aCentre');
    const radial = geometry.getAttribute('aRadial');
    for (let i = 0; i < pos.count; i += 1) {
      const r = Math.hypot(radial.getX(i), radial.getY(i), radial.getZ(i));
      expect(r === 0 || Math.abs(r - 1) < 1e-6).toBe(true);
      expect(pos.getX(i)).toBeCloseTo(centre.getX(i) + radial.getX(i) * 3, 5);
    }
    updateTubeRadius(geometry, 1.5);
    const pos2 = geometry.getAttribute('position');
    for (let i = 0; i < pos2.count; i += 1) {
      expect(pos2.getZ(i)).toBeCloseTo(centre.getZ(i) + radial.getZ(i) * 1.5, 5);
    }
    expect(geometry.userData.radius).toBe(1.5);
  });

  it('falls back to cumulative distance when measured depth is missing', () => {
    const { holes: meta } = buildDrillholeTubeGeometry([
      { id: 'X', points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: -25 }] },
    ]);
    expect(meta[0].mds).toEqual([0, 10, 25]);
    expect(meta[0].length).toBe(25);
  });

  it('returns no geometry when nothing is renderable', () => {
    const out = buildDrillholeTubeGeometry([{ id: 'Z', points: [] }]);
    expect(out.geometry).toBeNull();
    expect(out.holes).toEqual([]);
  });
});

describe('defaultTubeRadius', () => {
  it('scales with the scene extent and stays within sane limits', () => {
    expect(defaultTubeRadius(null)).toBe(1);
    expect(defaultTubeRadius({ minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 10 })).toBeCloseTo(0.05);
    expect(defaultTubeRadius({ minX: 0, maxX: 5000, minY: 0, maxY: 500, minZ: 0, maxZ: 300 })).toBeCloseTo(9);
    expect(defaultTubeRadius({ minX: 0, maxX: 1e6, minY: 0, maxY: 1, minZ: 0, maxZ: 1 })).toBe(25);
    // Regional scene with short holes: the hole length wins so tubes stay slim close up.
    expect(defaultTubeRadius({ minX: 0, maxX: 30000, minY: 0, maxY: 30000, minZ: -1000, maxZ: 0 }, 200)).toBeCloseTo(2.4);
  });
});
