/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const Z_UP = Object.freeze({ x: 0, y: 0, z: 1 });
const POLE_ALIGNMENT_LIMIT = 0.999;

/**
 * Build a string signature from view state for comparison (to detect changes)
 * @param {Object} viewState - View state object with camera, target, up vectors
 * @returns {string} String signature representing the view state
 */
export function buildViewSignature(viewState) {
  if (!viewState) return '';
  const toNum = (v) => Number.isFinite(v) ? v.toFixed(3) : 'nan';
  return [
    toNum(viewState.camera?.x),
    toNum(viewState.camera?.y),
    toNum(viewState.camera?.z),
    toNum(viewState.target?.x),
    toNum(viewState.target?.y),
    toNum(viewState.target?.z),
    toNum(viewState.up?.x),
    toNum(viewState.up?.y),
    toNum(viewState.up?.z)
  ].join('|');
}

/**
 * Extract current view state from 3D scene state
 * @param {Object} state - Baselode3D scene state with camera and controls
 * @returns {Object|null} View state object or null if state invalid
 */
export function getViewState(state) {
  if (!state.camera || !state.controls) return null;
  return {
    camera: {
      x: state.camera.position.x,
      y: state.camera.position.y,
      z: state.camera.position.z
    },
    target: {
      x: state.controls.target.x,
      y: state.controls.target.y,
      z: state.controls.target.z
    },
    up: {
      x: state.camera.up.x,
      y: state.camera.up.y,
      z: state.camera.up.z
    }
  };
}

/**
 * Apply a view state to the 3D scene camera and controls
 * @param {Object} state - Baselode3D scene state
 * @param {Object} viewState - View state to apply
 * @returns {boolean} True if successfully applied
 */
export function setViewState(state, viewState) {
  if (!state.camera || !state.controls || !viewState) return false;
  const camera = viewState.camera || {};
  const target = viewState.target || {};

  const values = [camera.x, camera.y, camera.z, target.x, target.y, target.z];
  if (!values.every(Number.isFinite)) return false;

  state.camera.position.set(camera.x, camera.y, camera.z);
  state.controls.target.set(target.x, target.y, target.z);
  applyZUpOrbit(state);
  state._lastViewSignature = buildViewSignature(getViewState(state));
  return true;
}

/**
 * Emit view change event if view has changed (throttled to 250ms)
 * @param {Object} state - Baselode3D scene state with viewChangeHandler
 */
export function emitViewChangeIfNeeded(state) {
  if (!state.viewChangeHandler) return;
  const now = Date.now();
  if (now - state._lastViewEmitMs < 250) return;
  const viewState = getViewState(state);
  if (!viewState) return;
  const signature = buildViewSignature(viewState);
  if (signature === state._lastViewSignature) return;
  state._lastViewSignature = signature;
  state._lastViewEmitMs = now;
  state.viewChangeHandler(viewState);
}

/**
 * Fit camera to view all content within specified bounds
 * @param {Object} state - Baselode3D scene state
 * @param {Object} bounds - Bounding box {minX, maxX, minY, maxY, minZ, maxZ}
 */
export function fitCameraToBounds(state, { minX, maxX, minY, maxY, minZ, maxZ }) {
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;
  const maxDim = Math.max(sizeX, sizeY, sizeZ, 1);
  const distance = maxDim * 2;

  state.controls.target.set(centerX, centerY, centerZ);
  state.camera.position.set(centerX + distance, centerY + distance, centerZ + distance);
  applyZUpOrbit(state);
}

/**
 * Recenter camera to origin at specified distance
 * @param {Object} state - Baselode3D scene state
 * @param {number} distance - Distance from origin
 */
export function recenterCameraToOrigin(state, distance = 1000) {
  if (!state.camera || !state.controls) return;
  state.controls.target.set(0, 0, 0);
  state.camera.position.set(distance, distance, distance);
  applyZUpOrbit(state);
}

/**
 * Position camera looking straight down from above
 * @param {Object} state - Baselode3D scene state
 * @param {number} distance - Distance above origin
 */
export function lookDown(state, distance = 2000) {
  if (!state.camera || !state.controls) return;
  const safeDistance = Number.isFinite(distance) && distance > 0 ? distance : 2000;
  const nudge = Math.max(safeDistance * 0.001, 1);
  state.controls.target.set(0, 0, 0);
  state.camera.position.set(nudge, 0, safeDistance);
  applyZUpOrbit(state);
}

/**
 * Pan the camera view by screen-space delta
 * @param {Object} state - Baselode3D scene state
 * @param {number} dx - Horizontal pan delta
 * @param {number} dy - Vertical pan delta
 */
export function pan(state, dx = 0, dy = 0) {
  if (!state.controls) return;
  if (typeof state.controls.pan === 'function') {
    state.controls.pan(dx, dy);
    state.controls.update();
  }
}

/**
 * Zoom camera in or out by scale factor
 * @param {Object} state - Baselode3D scene state
 * @param {number} scale - Scale factor (>1 zooms out, <1 zooms in)
 */
export function dolly(state, scale = 1.1) {
  if (!state.controls || typeof state.controls.dollyIn !== 'function' || typeof state.controls.dollyOut !== 'function') return;
  if (scale > 1) {
    state.controls.dollyOut(scale);
  } else {
    state.controls.dollyIn(1 / scale);
  }
  state.controls.update();
}

/**
 * Focus camera on last computed bounds with optional padding
 * @param {Object} state - Baselode3D scene state with lastBounds property
 * @param {number} padding - Padding multiplier for bounds (1.2 = 20% larger view)
 */
export function focusOnLastBounds(state, padding = 1.2) {
  if (!state.lastBounds) return;
  const {
    minX, maxX, minY, maxY, minZ, maxZ
  } = state.lastBounds;
  const sizeX = (maxX - minX) * padding;
  const sizeY = (maxY - minY) * padding;
  const sizeZ = (maxZ - minZ) * padding;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const maxDim = Math.max(sizeX, sizeY, sizeZ, 1);
  const distance = maxDim * 2;
  state.controls.target.set(centerX, centerY, centerZ);
  state.camera.position.set(centerX + distance, centerY + distance, centerZ + distance);
  applyZUpOrbit(state);
}

/** Minimum and maximum permitted camera FOV in degrees. */
export const FOV_MIN_DEG = 1;
export const FOV_MAX_DEG = 120;

/**
 * Change the camera field-of-view while keeping the visible scene the same apparent size.
 * Adjusts camera distance so the frustum height at the orbit target is preserved.
 * FOV is clamped to [FOV_MIN_DEG, FOV_MAX_DEG] to avoid numerical issues near 0° or 180°.
 * @param {Object} state - Baselode3D scene state with camera and controls
 * @param {number} fovDeg - Desired FOV in degrees
 * @returns {boolean} True if the FOV was applied, false if state is invalid
 */
export function setFov(state, fovDeg) {
  if (!state.camera || !state.controls) return false;
  if (!Number.isFinite(fovDeg)) return false;
  const clampedFov = Math.min(FOV_MAX_DEG, Math.max(FOV_MIN_DEG, fovDeg));

  const target = state.controls.target;
  const currentDist = state.camera.position.distanceTo(target);
  const currentFovRad = (state.camera.fov * Math.PI) / 180;
  const frustumHeight = 2 * currentDist * Math.tan(currentFovRad / 2);

  const newFovRad = (clampedFov * Math.PI) / 180;
  const newDist = frustumHeight / (2 * Math.tan(newFovRad / 2));

  const dir = state.camera.position.clone().sub(target).normalize();
  state.camera.position.copy(target).addScaledVector(dir, newDist);
  state.camera.fov = clampedFov;
  state.camera.updateProjectionMatrix();
  state.controls.update();
  return true;
}

/**
 * Switch between orbit and fly camera control modes
 * @param {Object} state - Baselode3D scene state with orbit and fly controls
 * @param {string} mode - Control mode ('orbit' or 'fly')
 */
export function setControlMode(state, mode = 'orbit') {
  state.controlMode = mode === 'fly' ? 'fly' : 'orbit';
  if (state.controlMode === 'fly') {
    if (state.controls) state.controls.enabled = false;
    if (state.flyControls) state.flyControls.enabled = true;
  } else {
    if (state.flyControls) state.flyControls.enabled = false;
    if (state.controls) {
      state.controls.enabled = true;
      state.camera.getWorldDirection(state._tmpDir);
      const target = state.camera.position.clone().addScaledVector(state._tmpDir, 10);
      state.controls.target.copy(target);
      applyZUpOrbit(state);
    }
  }
}

function applyZUpOrbit(state) {
  if (!state.camera || !state.controls) return false;
  const target = state.controls.target;
  nudgeOffZPole(state, target);
  state.camera.up.set(Z_UP.x, Z_UP.y, Z_UP.z);
  state.camera.lookAt(target.x, target.y, target.z);
  state.controls.update();
  return true;
}

function nudgeOffZPole(state, target) {
  const offset = state.camera.position.clone().sub(target);
  const distance = offset.length();
  if (!Number.isFinite(distance) || distance <= 0) return;
  const alignment = Math.abs(offset.normalize().dot(Z_UP));
  if (alignment <= POLE_ALIGNMENT_LIMIT) return;
  state.camera.position.x += Math.max(distance * 0.001, 1);
}
