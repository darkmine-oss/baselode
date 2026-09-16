/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';

const Z_UP = new THREE.Vector3(0, 0, 1);
const MAX_PITCH = THREE.MathUtils.degToRad(89);

/**
 * Compute a Z-up forward vector from an azimuth (radians, clockwise from
 * north / +Y) and a pitch (radians, positive looks up).
 * @param {number} azimuth
 * @param {number} pitch
 * @param {THREE.Vector3} [out]
 * @returns {THREE.Vector3}
 */
export function forwardFromAzimuthPitch(azimuth, pitch, out = new THREE.Vector3()) {
  const cp = Math.cos(pitch);
  return out.set(Math.sin(azimuth) * cp, Math.cos(azimuth) * cp, Math.sin(pitch));
}

/**
 * Recover azimuth / pitch from a Z-up forward vector.
 * @param {THREE.Vector3} forward
 * @returns {{azimuth: number, pitch: number}}
 */
export function azimuthPitchFromForward(forward) {
  const f = forward.clone().normalize();
  const pitch = Math.asin(THREE.MathUtils.clamp(f.z, -1, 1));
  const azimuth = Math.atan2(f.x, f.y);
  return { azimuth, pitch: THREE.MathUtils.clamp(pitch, -MAX_PITCH, MAX_PITCH) };
}

/**
 * First-person "walk" controller that never rolls the camera.
 *
 *   - drag any mouse button / one finger to look around
 *   - W A S D or arrow keys to move, Q / E (or R / F) to move down / up
 *   - hold Shift to move four times faster
 *   - wheel adjusts movement speed
 *
 * `movementSpeed` is in scene units per second; call setSpeedFromBounds so a
 * 50 m pit and a 20 km tenement both feel right.
 */
export class WalkControls {
  constructor(camera, domElement) {
    this.object = camera;
    this.domElement = domElement;
    this.enabled = false;
    this.movementSpeed = 50;
    this.lookSpeed = 0.0032;
    this.sprintMultiplier = 4;
    this.azimuth = 0;
    this.pitch = 0;
    this._keys = new Set();
    this._dragging = false;
    this._pointerId = null;
    this._last = { x: 0, y: 0 };
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._move = new THREE.Vector3();

    this._onPointerDown = (e) => {
      if (!this.enabled) return;
      this._dragging = true;
      this._pointerId = e.pointerId;
      this._last = { x: e.clientX, y: e.clientY };
      try { this.domElement.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    };
    this._onPointerMove = (e) => {
      if (!this.enabled || !this._dragging || e.pointerId !== this._pointerId) return;
      const dx = e.clientX - this._last.x;
      const dy = e.clientY - this._last.y;
      this._last = { x: e.clientX, y: e.clientY };
      this.azimuth += dx * this.lookSpeed;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * this.lookSpeed, -MAX_PITCH, MAX_PITCH);
      this._applyOrientation();
    };
    this._onPointerUp = (e) => {
      if (e.pointerId !== this._pointerId) return;
      this._dragging = false;
      this._pointerId = null;
      try { this.domElement.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    };
    this._onKeyDown = (e) => {
      if (!this.enabled || isTypingTarget(e.target)) return;
      const key = normaliseKey(e);
      if (!key) return;
      this._keys.add(key);
      e.preventDefault();
    };
    this._onKeyUp = (e) => {
      const key = normaliseKey(e);
      if (key) this._keys.delete(key);
    };
    this._onWheel = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const factor = Math.pow(1.15, -Math.sign(e.deltaY));
      this.movementSpeed = THREE.MathUtils.clamp(this.movementSpeed * factor, 0.01, 1e6);
    };
    this._onBlur = () => { this._keys.clear(); };

    domElement.addEventListener('pointerdown', this._onPointerDown);
    domElement.addEventListener('pointermove', this._onPointerMove);
    domElement.addEventListener('pointerup', this._onPointerUp);
    domElement.addEventListener('pointercancel', this._onPointerUp);
    domElement.addEventListener('wheel', this._onWheel, { passive: false });
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);
      window.addEventListener('blur', this._onBlur);
    }
  }

  /** Read azimuth / pitch from the camera's current orientation. */
  syncFromCamera() {
    const dir = new THREE.Vector3();
    this.object.getWorldDirection(dir);
    const { azimuth, pitch } = azimuthPitchFromForward(dir);
    this.azimuth = azimuth;
    this.pitch = pitch;
    this._applyOrientation();
  }

  /** Scale the movement speed to the size of the scene. */
  setSpeedFromBounds(bounds) {
    if (!bounds) return;
    const maxDim = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ, 1);
    this.movementSpeed = maxDim / 4;
  }

  /** Current forward direction (unit vector, Z-up). */
  getForward(out = new THREE.Vector3()) {
    return forwardFromAzimuthPitch(this.azimuth, this.pitch, out);
  }

  update(dt) {
    if (!this.enabled || !(dt > 0)) return;
    const k = this._keys;
    if (k.size === 0) return;
    this.getForward(this._forward);
    // Right vector on the horizontal plane so strafing never climbs.
    this._right.set(Math.cos(this.azimuth), -Math.sin(this.azimuth), 0);
    this._move.set(0, 0, 0);
    if (k.has('forward')) this._move.add(this._forward);
    if (k.has('back')) this._move.sub(this._forward);
    if (k.has('right')) this._move.add(this._right);
    if (k.has('left')) this._move.sub(this._right);
    if (k.has('up')) this._move.add(Z_UP);
    if (k.has('down')) this._move.sub(Z_UP);
    if (this._move.lengthSq() === 0) return;
    this._move.normalize();
    const speed = this.movementSpeed * (k.has('sprint') ? this.sprintMultiplier : 1);
    this.object.position.addScaledVector(this._move, speed * dt);
    this._applyOrientation();
  }

  _applyOrientation() {
    const target = this.getForward(new THREE.Vector3()).add(this.object.position);
    this.object.up.copy(Z_UP);
    this.object.lookAt(target);
  }

  dispose() {
    const el = this.domElement;
    el.removeEventListener('pointerdown', this._onPointerDown);
    el.removeEventListener('pointermove', this._onPointerMove);
    el.removeEventListener('pointerup', this._onPointerUp);
    el.removeEventListener('pointercancel', this._onPointerUp);
    el.removeEventListener('wheel', this._onWheel);
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('keyup', this._onKeyUp);
      window.removeEventListener('blur', this._onBlur);
    }
  }
}

function normaliseKey(e) {
  const code = e.code || '';
  switch (code) {
    case 'KeyW': case 'ArrowUp': return 'forward';
    case 'KeyS': case 'ArrowDown': return 'back';
    case 'KeyA': case 'ArrowLeft': return 'left';
    case 'KeyD': case 'ArrowRight': return 'right';
    case 'KeyE': case 'KeyR': case 'PageUp': return 'up';
    case 'KeyQ': case 'KeyF': case 'PageDown': return 'down';
    case 'ShiftLeft': case 'ShiftRight': return 'sprint';
    default: return null;
  }
}

/** True when a key event originates from an editable element. */
export function isTypingTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const tag = String(target.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = String(target.type || 'text').toLowerCase();
    // Buttons, checkboxes and sliders keep focus after a click but are not
    // text entry; viewport hotkeys should still work with them focused.
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file'].includes(type);
  }
  return Boolean(target.isContentEditable);
}
