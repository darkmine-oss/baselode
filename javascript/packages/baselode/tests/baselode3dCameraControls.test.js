/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import {
  fitCameraToBounds,
  getViewState,
  lookDown,
  recenterCameraToOrigin,
  setViewState,
} from '../src/viz/baselode3dCameraControls.js';

function makeVector(x = 0, y = 0, z = 0) {
  return {
    x,
    y,
    z,
    set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; return this; },
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; },
    clone() { return makeVector(this.x, this.y, this.z); },
    sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; },
    addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; },
    length() { return Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2); },
    normalize() {
      const len = this.length();
      if (len > 0) {
        this.x /= len;
        this.y /= len;
        this.z /= len;
      }
      return this;
    },
    dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; },
    distanceTo(v) {
      return Math.sqrt((this.x - v.x) ** 2 + (this.y - v.y) ** 2 + (this.z - v.z) ** 2);
    },
  };
}

function makeSceneState() {
  const state = {
    camera: {
      position: makeVector(10, 20, 30),
      up: makeVector(0, 1, 0),
      lookAtTarget: null,
      lookAt(x, y, z) { this.lookAtTarget = { x, y, z }; },
    },
    controls: {
      target: makeVector(0, 0, 0),
      updateCount: 0,
      update() { this.updateCount += 1; },
    },
  };
  return state;
}

function expectZUp(state) {
  expect(state.camera.up).toMatchObject({ x: 0, y: 0, z: 1 });
}

describe('baselode3dCameraControls z-up orbit invariant', () => {
  it('lookDown keeps Z as the orbit up axis and avoids the exact Z pole', () => {
    const state = makeSceneState();

    lookDown(state, 3000);

    expectZUp(state);
    expect(state.camera.position.z).toBe(3000);
    expect(state.camera.position.x).toBeGreaterThan(0);
    expect(state.camera.lookAtTarget).toEqual({ x: 0, y: 0, z: 0 });
    expect(state.controls.updateCount).toBe(1);
  });

  it('setViewState restores camera and target but normalizes legacy Y-up views to Z-up', () => {
    const state = makeSceneState();

    const applied = setViewState(state, {
      camera: { x: 1, y: 2, z: 3 },
      target: { x: 4, y: 5, z: 6 },
      up: { x: 0, y: 1, z: 0 },
    });

    expect(applied).toBe(true);
    expect(state.camera.position).toMatchObject({ x: 1, y: 2, z: 3 });
    expect(state.controls.target).toMatchObject({ x: 4, y: 5, z: 6 });
    expectZUp(state);
    expect(getViewState(state).up).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('fit and recenter helpers leave controls in Z-up orbit mode', () => {
    const state = makeSceneState();

    fitCameraToBounds(state, {
      minX: 10,
      maxX: 20,
      minY: 30,
      maxY: 50,
      minZ: -5,
      maxZ: 5,
    });
    expectZUp(state);
    expect(state.camera.lookAtTarget).toEqual({ x: 15, y: 40, z: 0 });

    state.camera.up.set(0, 1, 0);
    recenterCameraToOrigin(state, 100);
    expectZUp(state);
    expect(state.camera.lookAtTarget).toEqual({ x: 0, y: 0, z: 0 });
  });
});
