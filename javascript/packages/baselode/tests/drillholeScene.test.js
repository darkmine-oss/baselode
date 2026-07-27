import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { splitCategoricalSegment } from '../src/viz/drillholeScene.js';

describe('splitCategoricalSegment', () => {
  it('subdivides a sparse survey segment at every geology boundary', () => {
    const p1 = new THREE.Vector3(0, 0, 0); p1.md = 0;
    const p2 = new THREE.Vector3(0, 0, -126); p2.md = 126;
    const slices = splitCategoricalSegment(p1, p2, [
      { from: 0, to: 60, value: 'CLAY' },
      { from: 60, to: 100, value: 'SAND' },
      { from: 100, to: 126, value: 'SAPROLITE' },
    ]);

    expect(slices.map((slice) => [slice.p1.md, slice.p2.md, slice.category])).toEqual([
      [0, 60, 'CLAY'],
      [60, 100, 'SAND'],
      [100, 126, 'SAPROLITE'],
    ]);
    expect(slices.map((slice) => slice.p2.z)).toEqual([-60, -100, -126]);
  });

  it('keeps the correct physical direction when measured depth decreases between points', () => {
    const p1 = new THREE.Vector3(0, 0, -126); p1.md = 126;
    const p2 = new THREE.Vector3(0, 0, 0); p2.md = 0;
    const slices = splitCategoricalSegment(p1, p2, [{ from: 0, to: 126, value: 'CLAY' }]);
    expect(slices).toHaveLength(1);
    expect(slices[0].p1.z).toBe(-126);
    expect(slices[0].p2.z).toBe(0);
  });

  it('merges adjacent source intervals with the same category', () => {
    const p1 = new THREE.Vector3(0, 0, 0); p1.md = 0;
    const p2 = new THREE.Vector3(0, 0, -30); p2.md = 30;
    const slices = splitCategoricalSegment(p1, p2, [
      { from: 0, to: 10, value: 'CLAY' },
      { from: 10, to: 20, value: 'CLAY' },
      { from: 20, to: 30, value: 'SAND' },
    ]);
    expect(slices.map((slice) => [slice.p1.md, slice.p2.md, slice.category])).toEqual([
      [0, 20, 'CLAY'],
      [20, 30, 'SAND'],
    ]);
  });
});
