/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const Z_UP = Object.freeze({ x: 0, y: 0, z: 1 });
const POLE_ALIGNMENT_LIMIT = 0.999;
const DEFAULT_FOV_DEG = 28;
const DEFAULT_TWEEN_MS = 520;

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

  cancelCameraTween(state);
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

// ---------------------------------------------------------------------------
// Bounds helpers
// ---------------------------------------------------------------------------

/**
 * Centre and bounding-sphere radius of a bounds box.
 */
export function boundsSphere({ minX, maxX, minY, maxY, minZ, maxZ }) {
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
  const radius = Math.max(0.5 * Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2), 0.5);
  return { center, radius };
}

/**
 * Distance at which a sphere of `radius` fills the view for the camera's
 * vertical and horizontal field of view.
 * @param {Object} camera - camera (fov in degrees, aspect); missing values default
 * @param {number} radius
 * @param {number} [padding=1.15]
 * @returns {number}
 */
export function fitDistanceForRadius(camera, radius, padding = 1.15) {
  const fovDeg = Number.isFinite(camera?.fov) ? camera.fov : DEFAULT_FOV_DEG;
  const aspect = Number.isFinite(camera?.aspect) && camera.aspect > 0 ? camera.aspect : 1;
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const fov = Math.min(vFov, hFov);
  return (radius * padding) / Math.sin(Math.max(fov / 2, 1e-4));
}

function viewDirection(state, fallback = { x: 1, y: 1, z: 1 }) {
  const target = state.controls.target;
  const dir = state.camera.position.clone().sub(target);
  const len = dir.length();
  if (!Number.isFinite(len) || len < 1e-9) {
    dir.set(fallback.x, fallback.y, fallback.z);
  }
  return dir.normalize();
}

/**
 * Fit camera to view all content within specified bounds.  Keeps the current
 * viewing direction and honours the camera field of view.
 * @param {Object} state - Baselode3D scene state
 * @param {Object} bounds - Bounding box {minX, maxX, minY, maxY, minZ, maxZ}
 * @param {Object} [opts]
 * @param {boolean} [opts.animate=false]
 * @param {number} [opts.padding=1.15]
 * @param {number} [opts.durationMs]
 */
export function fitCameraToBounds(state, bounds, opts = {}) {
  if (!state.camera || !state.controls || !bounds) return;
  const { center, radius } = boundsSphere(bounds);
  const dir = viewDirection(state);
  const target = state.controls.target.clone().set(center.x, center.y, center.z);
  let distance;
  if (state.camera.isOrthographicCamera) {
    distance = radius * 4;
    const halfHeight = (state.camera.top - state.camera.bottom) / 2;
    const aspect = halfHeight > 0 ? (state.camera.right - state.camera.left) / (2 * halfHeight) : 1;
    const padded = radius * (opts.padding ?? 1.15);
    const zoom = Math.min(halfHeight / padded, (halfHeight * aspect) / padded);
    state.camera.zoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    state.camera.updateProjectionMatrix?.();
  } else {
    distance = fitDistanceForRadius(state.camera, radius, opts.padding ?? 1.15);
  }
  const position = target.clone().addScaledVector(dir, distance);
  moveCamera(state, position, target, opts);
}

/**
 * Recenter camera to origin at specified distance
 * @param {Object} state - Baselode3D scene state
 * @param {number} distance - Distance from origin
 */
export function recenterCameraToOrigin(state, distance = 1000) {
  if (!state.camera || !state.controls) return;
  cancelCameraTween(state);
  state.controls.target.set(0, 0, 0);
  state.camera.position.set(distance, distance, distance);
  applyZUpOrbit(state);
}

/**
 * Recenter on the middle of a bounds box, keeping the current view direction
 * and choosing a distance that shows the whole extent.
 * @param {Object} state
 * @param {Object} bounds
 * @param {Object} [opts] - { animate, padding }
 */
export function recenterOnBounds(state, bounds, opts = {}) {
  if (!bounds) {
    recenterCameraToOrigin(state, opts.distance ?? 1000);
    return;
  }
  fitCameraToBounds(state, bounds, { padding: 1.4, ...opts });
}

/**
 * Position camera looking straight down at the current orbit target.
 * @param {Object} state - Baselode3D scene state
 * @param {number} distance - Height above the target
 * @param {Object} [opts] - { animate }
 */
export function lookDown(state, distance = 2000, opts = {}) {
  if (!state.camera || !state.controls) return;
  const safeDistance = Number.isFinite(distance) && distance > 0 ? distance : 2000;
  const nudge = Math.max(safeDistance * 0.001, 1);
  const target = state.controls.target.clone();
  const position = target.clone();
  position.set(target.x + nudge, target.y, target.z + safeDistance);
  moveCamera(state, position, target, opts);
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
 * @param {Object} [opts] - { animate }
 */
export function focusOnLastBounds(state, padding = 1.2, opts = {}) {
  if (!state.lastBounds) return;
  fitCameraToBounds(state, state.lastBounds, { padding, ...opts });
}

/**
 * Move the orbit target to a point and dolly to a distance, keeping the
 * current view direction.  Double-click focus uses this.
 * @param {Object} state
 * @param {{x:number,y:number,z:number}} point
 * @param {Object} [opts] - { distance, animate }
 */
export function focusOnPoint(state, point, opts = {}) {
  if (!state.camera || !state.controls || !point) return;
  const dir = viewDirection(state);
  const target = state.controls.target.clone().set(point.x, point.y, point.z);
  const current = state.camera.position.distanceTo(state.controls.target);
  let distance = Number.isFinite(opts.distance) && opts.distance > 0 ? opts.distance : current;
  if (state.camera.isOrthographicCamera) {
    // Moving an orthographic camera along its axis changes nothing on screen;
    // express the requested "distance" as a zoom instead and keep the
    // current standoff.
    if (Number.isFinite(opts.distance) && opts.distance > 0) {
      const fovDeg = Number.isFinite(state._perspectiveCamera?.fov) ? state._perspectiveCamera.fov : DEFAULT_FOV_DEG;
      const halfHeight = opts.distance * Math.tan((fovDeg * Math.PI) / 360);
      const zoom = ((state.camera.top - state.camera.bottom) / 2) / Math.max(halfHeight, 1e-6);
      if (Number.isFinite(zoom) && zoom > 0) {
        state.camera.zoom = zoom;
        state.camera.updateProjectionMatrix?.();
      }
    }
    distance = current;
  }
  const position = target.clone().addScaledVector(dir, distance);
  moveCamera(state, position, target, opts);
}

/**
 * Slide the orbit target along the current view axis so it sits at `depth`
 * from the camera.  The view does not change; only the point the camera
 * orbits and pans around does.  Used to orbit around whatever is under the
 * cursor without recentring.
 * @param {Object} state
 * @param {number} depth - distance from camera to the new target
 */
export function setOrbitDepth(state, depth) {
  if (!state.camera || !state.controls || !Number.isFinite(depth) || depth <= 0) return;
  const dir = viewDirection(state).negate(); // camera → target
  const position = state.camera.position;
  state.controls.target.set(position.x + dir.x * depth, position.y + dir.y * depth, position.z + dir.z * depth);
  state.controls.update();
}

/**
 * Snap the view to a cardinal direction while keeping target and distance.
 * @param {Object} state
 * @param {'north'|'south'|'east'|'west'|'top'|'bottom'} name
 * @param {Object} [opts] - { animate }
 */
export function viewFromDirection(state, name, opts = {}) {
  if (!state.camera || !state.controls) return;
  const target = state.controls.target.clone();
  const d = Math.max(state.camera.position.distanceTo(target), 1);
  const nudge = Math.max(d * 0.001, 1);
  const offsets = {
    north: [0, -d, 0],   // camera south of target, looking north
    south: [0, d, 0],
    east: [-d, 0, 0],    // camera west of target, looking east
    west: [d, 0, 0],
    top: [nudge, 0, d],
    bottom: [nudge, 0, -d],
  };
  const o = offsets[name];
  if (!o) return;
  const position = target.clone().set(target.x + o[0], target.y + o[1], target.z + o[2]);
  moveCamera(state, position, target, opts);
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
  if (state.camera.isOrthographicCamera) return false;
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
 * Switch between orbit and first-person ("fly" / "walk") camera modes.
 * @param {Object} state - Baselode3D scene state with orbit and walk controls
 * @param {string} mode - 'orbit' | 'fly' | 'walk'
 */
export function setControlMode(state, mode = 'orbit') {
  state.controlMode = mode === 'fly' || mode === 'walk' ? 'fly' : 'orbit';
  cancelCameraTween(state);
  if (state.controlMode === 'fly') {
    if (state.controls) state.controls.enabled = false;
    if (state.flyControls) {
      state.flyControls.enabled = true;
      state.flyControls.syncFromCamera?.();
      state.flyControls.setSpeedFromBounds?.(state.lastBounds);
    }
  } else {
    if (state.flyControls) state.flyControls.enabled = false;
    if (state.controls) {
      state.controls.enabled = true;
      const resolved = typeof state._resolveForwardTarget === 'function' ? state._resolveForwardTarget() : null;
      if (resolved) {
        state.controls.target.copy(resolved);
      } else {
        state.camera.getWorldDirection(state._tmpDir);
        let depth = 10;
        if (state.lastBounds) {
          const { center, radius } = boundsSphere(state.lastBounds);
          const toCentre = state.camera.position.clone().set(center.x, center.y, center.z).sub(state.camera.position);
          depth = Math.max(toCentre.dot(state._tmpDir), radius * 0.25, 1);
        }
        const target = state.camera.position.clone().addScaledVector(state._tmpDir, depth);
        state.controls.target.copy(target);
      }
      applyZUpOrbit(state);
    }
  }
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * Swap the active camera, keeping every consumer (controls, gizmo, passes)
 * pointed at the new one.
 */
export function replaceActiveCamera(state, camera) {
  state.camera = camera;
  if (state.controls) state.controls.object = camera;
  if (state.flyControls) state.flyControls.object = camera;
  if (state.gizmo) state.gizmo.camera = camera;
  for (const pass of state._composer?.passes || []) {
    if (pass.camera) pass.camera = camera;
    if (pass.renderCamera) pass.renderCamera = camera;
  }
}

/**
 * Toggle between perspective and orthographic projection, preserving the
 * apparent size of the scene at the orbit target.
 * @param {Object} state
 * @param {'perspective'|'orthographic'} mode
 * @param {Object} [opts]
 * @param {Function} [opts.createOrthographic] - (left, right, top, bottom, near, far) => camera
 * @returns {boolean} true if applied
 */
export function setProjection(state, mode, opts = {}) {
  if (!state.camera || !state.controls) return false;
  if (state._baselodeViewingHelper?.active) return false; // section helper owns the camera
  const wantOrtho = mode === 'orthographic';
  const isOrtho = Boolean(state.camera.isOrthographicCamera);
  if (wantOrtho === isOrtho) return true;
  const target = state.controls.target;
  const distance = Math.max(state.camera.position.distanceTo(target), 1e-3);
  const aspect = Number.isFinite(state.camera.aspect) && state.camera.aspect > 0
    ? state.camera.aspect
    : state.camera.isOrthographicCamera
      ? (state.camera.right - state.camera.left) / Math.max(state.camera.top - state.camera.bottom, 1e-9)
      : 1;

  if (wantOrtho) {
    const fov = ((Number.isFinite(state.camera.fov) ? state.camera.fov : DEFAULT_FOV_DEG) * Math.PI) / 180;
    const halfHeight = Math.max(distance * Math.tan(fov / 2), 1e-3);
    const ortho = typeof opts.createOrthographic === 'function'
      ? opts.createOrthographic(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, 0.01, 10_000_000)
      : null;
    if (!ortho) return false;
    ortho.up.set(0, 0, 1);
    ortho.position.copy(state.camera.position);
    ortho.lookAt(target.x, target.y, target.z);
    ortho.updateProjectionMatrix();
    state._perspectiveCamera = state.camera;
    replaceActiveCamera(state, ortho);
    state.projection = 'orthographic';
  } else {
    const persp = state._perspectiveCamera;
    if (!persp) return false;
    const halfHeight = ((state.camera.top - state.camera.bottom) / 2) / (state.camera.zoom || 1);
    const fov = ((Number.isFinite(persp.fov) ? persp.fov : DEFAULT_FOV_DEG) * Math.PI) / 180;
    const newDistance = halfHeight / Math.tan(fov / 2);
    const dir = state.camera.position.clone().sub(target).normalize();
    persp.position.copy(target).addScaledVector(dir, newDistance);
    persp.up.set(0, 0, 1);
    persp.lookAt(target.x, target.y, target.z);
    if (Number.isFinite(aspect)) persp.aspect = aspect;
    persp.updateProjectionMatrix();
    replaceActiveCamera(state, persp);
    state._perspectiveCamera = null;
    state.projection = 'perspective';
  }
  state.controls.update();
  return true;
}

/**
 * Keep a perspective camera's near / far planes tight around the scene so
 * depth precision is spent where the geometry is.
 * @param {Object} state - needs camera and lastBounds
 * @returns {boolean} true when the projection matrix was updated
 */
export function updateClipPlanes(state) {
  const camera = state.camera;
  if (!camera || camera.isOrthographicCamera || !state.lastBounds) return false;
  const { center, radius } = boundsSphere(state.lastBounds);
  const d = camera.position.distanceTo(center);
  const far = Math.max((d + radius) * 3, radius * 6, 10);
  const near = Math.max(far / 200_000, (d - radius) * 0.5, 0.005);
  const nearChanged = Math.abs(near - camera.near) > camera.near * 0.05;
  const farChanged = Math.abs(far - camera.far) > camera.far * 0.05;
  if (!nearChanged && !farChanged) return false;
  camera.near = near;
  camera.far = far;
  camera.updateProjectionMatrix();
  return true;
}

// ---------------------------------------------------------------------------
// Tweening
// ---------------------------------------------------------------------------

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Animate camera position and orbit target to new values.
 * @param {Object} state
 * @param {Object} args
 * @param {{x:number,y:number,z:number}} args.position
 * @param {{x:number,y:number,z:number}} args.target
 * @param {number} [args.durationMs=520]
 * @param {Function} [args.onDone]
 */
export function animateCameraTo(state, { position, target, durationMs = DEFAULT_TWEEN_MS, onDone } = {}) {
  if (!state.camera || !state.controls || !position || !target) return;
  const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  if (!(durationMs > 0)) {
    state.camera.position.set(position.x, position.y, position.z);
    state.controls.target.set(target.x, target.y, target.z);
    applyZUpOrbit(state);
    onDone?.();
    return;
  }
  state._cameraTween = {
    fromPos: state.camera.position.clone(),
    fromTarget: state.controls.target.clone(),
    toPos: { x: position.x, y: position.y, z: position.z },
    toTarget: { x: target.x, y: target.y, z: target.z },
    start: now,
    duration: durationMs,
    onDone,
  };
}

/**
 * Advance the active camera tween.  Call once per frame.
 * @param {Object} state
 * @param {number} nowMs
 * @returns {boolean} true while a tween is running
 */
export function updateCameraTween(state, nowMs) {
  const tw = state._cameraTween;
  if (!tw) return false;
  const elapsed = nowMs - tw.start;
  const t = elapsed >= tw.duration - 1e-6 ? 1 : Math.max(0, elapsed / tw.duration);
  const k = easeOutCubic(t);
  const lerp = (a, b) => a + (b - a) * k;
  state.camera.position.set(lerp(tw.fromPos.x, tw.toPos.x), lerp(tw.fromPos.y, tw.toPos.y), lerp(tw.fromPos.z, tw.toPos.z));
  state.controls.target.set(lerp(tw.fromTarget.x, tw.toTarget.x), lerp(tw.fromTarget.y, tw.toTarget.y), lerp(tw.fromTarget.z, tw.toTarget.z));
  state.camera.up.set(Z_UP.x, Z_UP.y, Z_UP.z);
  state.camera.lookAt(state.controls.target.x, state.controls.target.y, state.controls.target.z);
  if (t >= 1) {
    state._cameraTween = null;
    applyZUpOrbit(state);
    tw.onDone?.();
    return false;
  }
  return true;
}

/** Stop any running camera tween in place. */
export function cancelCameraTween(state) {
  if (state._cameraTween) state._cameraTween = null;
}

/** True while a camera tween is running. */
export function isCameraAnimating(state) {
  return Boolean(state._cameraTween);
}

// ---------------------------------------------------------------------------
// Readouts for HUD overlays
// ---------------------------------------------------------------------------

/**
 * Camera heading as a compass bearing (degrees clockwise from north) and
 * pitch (degrees, negative looks down).
 */
export function getCameraHeading(state) {
  if (!state.camera) return { azimuthDeg: 0, pitchDeg: 0 };
  let dir;
  if (typeof state.camera.getWorldDirection === 'function') {
    // Actual view direction: correct in walk mode too, where the orbit
    // target is not where the camera is looking.
    dir = state.camera.position.clone();
    state.camera.getWorldDirection(dir);
  } else if (state.controls) {
    dir = state.controls.target.clone().sub(state.camera.position);
  } else {
    return { azimuthDeg: 0, pitchDeg: 0 };
  }
  const len = dir.length();
  if (!(len > 0)) return { azimuthDeg: 0, pitchDeg: 0 };
  dir.normalize();
  const azimuth = Math.atan2(dir.x, dir.y);
  const pitch = Math.asin(Math.max(-1, Math.min(1, dir.z)));
  return {
    azimuthDeg: ((azimuth * 180) / Math.PI + 360) % 360,
    pitchDeg: (pitch * 180) / Math.PI,
  };
}

/**
 * Scene units per screen pixel at the orbit target.
 */
export function unitsPerPixel(state, viewportHeight) {
  if (!state.camera || !state.controls || !(viewportHeight > 0)) return 1;
  if (state.camera.isOrthographicCamera) {
    return ((state.camera.top - state.camera.bottom) / (state.camera.zoom || 1)) / viewportHeight;
  }
  const fov = ((Number.isFinite(state.camera.fov) ? state.camera.fov : DEFAULT_FOV_DEG) * Math.PI) / 180;
  const distance = state.camera.position.distanceTo(state.controls.target);
  return (2 * distance * Math.tan(fov / 2)) / viewportHeight;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function moveCamera(state, position, target, opts = {}) {
  // Apply the pole nudge to the destination so animated and immediate moves land identically.
  const nudged = nudgedPosition(position, target);
  if (opts.animate && (opts.durationMs === undefined || opts.durationMs > 0)) {
    animateCameraTo(state, { position: nudged, target, durationMs: opts.durationMs ?? DEFAULT_TWEEN_MS, onDone: opts.onDone });
    return;
  }
  cancelCameraTween(state);
  state.controls.target.set(target.x, target.y, target.z);
  state.camera.position.set(nudged.x, nudged.y, nudged.z);
  applyZUpOrbit(state);
  opts.onDone?.();
}

function nudgedPosition(position, target) {
  const dx = position.x - target.x;
  const dy = position.y - target.y;
  const dz = position.z - target.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!Number.isFinite(distance) || distance <= 0) return { x: position.x, y: position.y, z: position.z };
  const alignment = Math.abs(dz / distance);
  if (alignment <= POLE_ALIGNMENT_LIMIT) return { x: position.x, y: position.y, z: position.z };
  return { x: position.x + Math.max(distance * 0.001, 1), y: position.y, z: position.z };
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
