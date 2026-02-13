/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
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

export function setViewState(state, viewState) {
  if (!state.camera || !state.controls || !viewState) return false;
  const camera = viewState.camera || {};
  const target = viewState.target || {};
  const up = viewState.up || {};

  const values = [camera.x, camera.y, camera.z, target.x, target.y, target.z, up.x, up.y, up.z];
  if (!values.every(Number.isFinite)) return false;

  state.camera.position.set(camera.x, camera.y, camera.z);
  state.controls.target.set(target.x, target.y, target.z);
  state.camera.up.set(up.x, up.y, up.z);
  state.camera.lookAt(target.x, target.y, target.z);
  state.controls.update();
  state._lastViewSignature = buildViewSignature(viewState);
  return true;
}

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
  state.camera.lookAt(centerX, centerY, centerZ);
  state.controls.update();
}

export function recenterCameraToOrigin(state, distance = 1000) {
  if (!state.camera || !state.controls) return;
  state.controls.target.set(0, 0, 0);
  state.camera.position.set(distance, distance, distance);
  state.camera.lookAt(0, 0, 0);
  state.controls.update();
}

export function lookDown(state, distance = 2000) {
  if (!state.camera || !state.controls) return;
  state.controls.target.set(0, 0, 0);
  state.camera.position.set(0, 0, distance);
  state.camera.up.set(0, 1, 0);
  state.camera.lookAt(0, 0, 0);
  state.controls.update();
}

export function pan(state, dx = 0, dy = 0) {
  if (!state.controls) return;
  if (typeof state.controls.pan === 'function') {
    state.controls.pan(dx, dy);
    state.controls.update();
  }
}

export function dolly(state, scale = 1.1) {
  if (!state.controls || typeof state.controls.dollyIn !== 'function' || typeof state.controls.dollyOut !== 'function') return;
  if (scale > 1) {
    state.controls.dollyOut(scale);
  } else {
    state.controls.dollyIn(1 / scale);
  }
  state.controls.update();
}

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
  state.camera.lookAt(centerX, centerY, centerZ);
  state.controls.update();
}

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
      state.controls.update();
    }
  }
}