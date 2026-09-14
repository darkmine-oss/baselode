/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  animateCameraTo,
  updateCameraTween,
  cancelCameraTween,
  fitCameraToBounds,
  fitDistanceForRadius,
  focusOnPoint,
  setOrbitDepth,
  viewFromDirection,
  setProjection,
  updateClipPlanes,
  getCameraHeading,
  unitsPerPixel,
  lookDown,
} from '../src/viz/baselode3dCameraControls.js';
import { WalkControls, azimuthPitchFromForward, forwardFromAzimuthPitch } from '../src/viz/walkControls.js';

function makeState() {
  const camera = new THREE.PerspectiveCamera(28, 1.5, 0.1, 1000);
  camera.up.set(0, 0, 1);
  camera.position.set(100, 100, 100);
  const state = {
    camera,
    controls: { target: new THREE.Vector3(0, 0, 0), object: camera, update() { this.updates = (this.updates || 0) + 1; } },
    _tmpDir: new THREE.Vector3(),
  };
  camera.lookAt(state.controls.target);
  return state;
}

const bounds = { minX: -100, maxX: 100, minY: -50, maxY: 50, minZ: -200, maxZ: 0 };

describe('camera tweens', () => {
  it('interpolates position and target with an ease-out and lands exactly', () => {
    const state = makeState();
    animateCameraTo(state, { position: { x: 0, y: -300, z: 50 }, target: { x: 0, y: 0, z: -100 }, durationMs: 100 });
    state._cameraTween.start = 1000.25;
    const start = state._cameraTween.start;
    expect(updateCameraTween(state, start + 50)).toBe(true);
    // ease-out: more than halfway after half the time
    expect(state.camera.position.y).toBeLessThan(-100 - 200 * 0.5);
    expect(updateCameraTween(state, start + 100)).toBe(false);
    expect(state.camera.position.toArray()).toEqual([0, -300, 50]);
    expect(state.controls.target.toArray()).toEqual([0, 0, -100]);
    expect(state.camera.up.z).toBe(1);
    expect(state._cameraTween).toBeNull();
  });

  it('applies immediately when the duration is zero and can be cancelled', () => {
    const state = makeState();
    animateCameraTo(state, { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 }, durationMs: 0 });
    expect(state.camera.position.toArray()).toEqual([1, 2, 3]);
    animateCameraTo(state, { position: { x: 9, y: 9, z: 9 }, target: { x: 0, y: 0, z: 0 }, durationMs: 500 });
    cancelCameraTween(state);
    expect(state._cameraTween).toBeNull();
    expect(updateCameraTween(state, 1e9)).toBe(false);
  });
});

describe('fit and focus', () => {
  it('fitCameraToBounds keeps the view direction and frames the bounding sphere for the FOV', () => {
    const state = makeState();
    const dirBefore = state.camera.position.clone().sub(state.controls.target).normalize();
    fitCameraToBounds(state, bounds, { padding: 1 });
    const centre = new THREE.Vector3(0, 0, -100);
    expect(state.controls.target.distanceTo(centre)).toBeLessThan(1e-6);
    const dirAfter = state.camera.position.clone().sub(centre).normalize();
    expect(dirAfter.dot(dirBefore)).toBeCloseTo(1, 5);
    const radius = 0.5 * Math.sqrt(200 ** 2 + 100 ** 2 + 200 ** 2);
    expect(state.camera.position.distanceTo(centre)).toBeCloseTo(fitDistanceForRadius(state.camera, radius, 1), 4);
  });

  it('fitDistanceForRadius uses the narrower of the vertical and horizontal fields of view', () => {
    const wide = { fov: 28, aspect: 2 };
    const tall = { fov: 28, aspect: 0.5 };
    expect(fitDistanceForRadius(tall, 10)).toBeGreaterThan(fitDistanceForRadius(wide, 10));
  });

  it('focusOnPoint moves the pivot and dollies along the existing direction', () => {
    const state = makeState();
    focusOnPoint(state, { x: 50, y: 0, z: -20 }, { distance: 30 });
    expect(state.controls.target.toArray()).toEqual([50, 0, -20]);
    expect(state.camera.position.distanceTo(state.controls.target)).toBeCloseTo(30, 5);
  });

  it('setOrbitDepth slides the target along the view axis without moving the camera', () => {
    const state = makeState();
    const before = state.camera.position.clone();
    const forward = new THREE.Vector3();
    state.camera.getWorldDirection(forward);
    setOrbitDepth(state, 40);
    expect(state.camera.position.distanceTo(before)).toBe(0);
    expect(state.camera.position.distanceTo(state.controls.target)).toBeCloseTo(40, 5);
    const toTarget = state.controls.target.clone().sub(state.camera.position).normalize();
    expect(toTarget.dot(forward)).toBeCloseTo(1, 5);
  });

  it('lookDown keeps the current target rather than snapping to the origin', () => {
    const state = makeState();
    state.controls.target.set(500, 600, -50);
    lookDown(state, 1000);
    expect(state.camera.position.z).toBeCloseTo(950);
    expect(state.camera.position.y).toBeCloseTo(600);
    expect(state.controls.target.toArray()).toEqual([500, 600, -50]);
  });
});

describe('view presets and heading', () => {
  it('viewFromDirection keeps the orbit distance and reports the matching heading', () => {
    const state = makeState();
    const d = state.camera.position.distanceTo(state.controls.target);
    viewFromDirection(state, 'north');
    expect(state.camera.position.distanceTo(state.controls.target)).toBeCloseTo(d, 5);
    expect(getCameraHeading(state).azimuthDeg).toBeCloseTo(0, 5);
    viewFromDirection(state, 'east');
    expect(getCameraHeading(state).azimuthDeg).toBeCloseTo(90, 5);
    viewFromDirection(state, 'top');
    expect(getCameraHeading(state).pitchDeg).toBeLessThan(-89);
    expect(state.camera.up.z).toBe(1);
  });

  it('unitsPerPixel matches the frustum height at the target', () => {
    const state = makeState();
    const dist = state.camera.position.distanceTo(state.controls.target);
    const expected = (2 * dist * Math.tan(THREE.MathUtils.degToRad(28) / 2)) / 600;
    expect(unitsPerPixel(state, 600)).toBeCloseTo(expected, 8);
  });
});

describe('projection and clip planes', () => {
  it('swaps to an orthographic camera preserving apparent size, and back', () => {
    const state = makeState();
    state.gizmo = { camera: state.camera };
    state._composer = { passes: [{ camera: state.camera }, { renderCamera: state.camera }] };
    const create = (l, r, t, b, n, f) => new THREE.OrthographicCamera(l, r, t, b, n, f);
    const dist = state.camera.position.distanceTo(state.controls.target);
    expect(setProjection(state, 'orthographic', { createOrthographic: create })).toBe(true);
    expect(state.camera.isOrthographicCamera).toBe(true);
    expect(state.gizmo.camera).toBe(state.camera);
    expect(state._composer.passes[1].renderCamera).toBe(state.camera);
    const halfHeight = dist * Math.tan(THREE.MathUtils.degToRad(14));
    expect(state.camera.top).toBeCloseTo(halfHeight, 5);
    expect(setProjection(state, 'perspective', { createOrthographic: create })).toBe(true);
    expect(state.camera.isPerspectiveCamera).toBe(true);
    expect(state.camera.position.distanceTo(state.controls.target)).toBeCloseTo(dist, 4);
  });

  it('refuses to change projection while a section helper owns the camera', () => {
    const state = makeState();
    state._baselodeViewingHelper = { active: true };
    expect(setProjection(state, 'orthographic', { createOrthographic: () => new THREE.OrthographicCamera() })).toBe(false);
  });

  it('updateClipPlanes tightens near/far around the scene bounds', () => {
    const state = makeState();
    state.lastBounds = bounds;
    expect(updateClipPlanes(state)).toBe(true);
    expect(state.camera.far).toBeGreaterThan(state.camera.position.distanceTo(new THREE.Vector3(0, 0, -100)));
    expect(state.camera.near).toBeGreaterThan(0);
    expect(state.camera.far / state.camera.near).toBeLessThan(1e6);
    expect(updateClipPlanes(state)).toBe(false); // no change second time
  });
});

describe('walk controls', () => {
  it('round-trips azimuth / pitch through a Z-up forward vector', () => {
    const f = forwardFromAzimuthPitch(THREE.MathUtils.degToRad(90), THREE.MathUtils.degToRad(-30));
    expect(f.x).toBeCloseTo(Math.cos(THREE.MathUtils.degToRad(30)), 6);
    expect(f.y).toBeCloseTo(0, 6);
    expect(f.z).toBeCloseTo(-0.5, 6);
    const back = azimuthPitchFromForward(f);
    expect(THREE.MathUtils.radToDeg(back.azimuth)).toBeCloseTo(90, 5);
    expect(THREE.MathUtils.radToDeg(back.pitch)).toBeCloseTo(-30, 5);
  });

  it('moves along the look direction without rolling and scales speed with the scene', () => {
    const el = makeFakeElement();
    const camera = new THREE.PerspectiveCamera();
    camera.up.set(0, 0, 1);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 1, 0);
    const walk = new WalkControls(camera, el);
    walk.enabled = true;
    walk.syncFromCamera();
    walk.setSpeedFromBounds(bounds);
    expect(walk.movementSpeed).toBe(50);
    walk._keys.add('forward');
    walk.update(0.5);
    expect(camera.position.y).toBeCloseTo(25, 5);
    expect(camera.position.z).toBeCloseTo(0, 5);
    expect(camera.up.toArray()).toEqual([0, 0, 1]);
    walk._keys.clear();
    walk._keys.add('up');
    walk.update(0.1);
    expect(camera.position.z).toBeCloseTo(5, 5);
    walk.dispose();
  });
});

function makeFakeElement() {
  return {
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    removeEventListener(type) { delete this.listeners[type]; },
  };
}
