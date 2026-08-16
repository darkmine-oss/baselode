/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';

function axisNormal(axis) {
  return axis === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
}

function replaceCamera(ctx, camera) {
  ctx.camera = camera;
  if (ctx.controls) ctx.controls.object = camera;
  if (ctx.flyControls) ctx.flyControls.object = camera;
  if (ctx.gizmo) ctx.gizmo.camera = camera;
  for (const pass of ctx._composer?.passes || []) {
    if (pass.camera) pass.camera = camera;
  }
}

/**
 * Orthographic X/Y cross-section viewer.
 *
 * The helper adds only its own clipping plane to the renderer and restores the
 * original camera and interaction settings when disabled.  It does not own or
 * replace clipping planes added by the host application.
 */
export class SectionHelper {
  constructor(sceneCtx) {
    this.ctx = sceneCtx;
    this.active = false;
    this.axis = 'x';
    this.position = 0;
    this.plane = null;
    this.saved = null;
    this.savedLocalClippingEnabled = false;
    this.sectionTarget = null;
    this.sectionCameraDistance = 1;
  }

  enable(axis = 'x', position = this.position) {
    if (this.active) this.disable();
    if (this.ctx._baselodeViewingHelper && this.ctx._baselodeViewingHelper !== this) {
      this.ctx._baselodeViewingHelper.disable();
    }
    this.axis = axis === 'y' ? 'y' : 'x';
    this.position = Number.isFinite(position) ? position : 0;
    this.ctx._baselodeViewingHelper = this;
    this.savedLocalClippingEnabled = this.ctx.renderer?.localClippingEnabled || false;
    this._saveAndUseOrthographicCamera();
    this.plane = new THREE.Plane(axisNormal(this.axis).negate(), this.position);
    this._setSectionViewPosition();
    this._addPlanes([this.plane]);
    this.active = true;
    return this;
  }

  setPosition(position) {
    if (!Number.isFinite(position)) return this;
    this.position = position;
    if (this.plane) this.plane.constant = position;
    this._setSectionViewPosition();
    return this;
  }

  step(delta) { return this.setPosition(this.position + (Number(delta) || 0)); }

  disable() {
    if (!this.active && !this.saved) return this;
    this._removePlanes([this.plane]);
    if (this.saved) {
      replaceCamera(this.ctx, this.saved.camera);
      if (this.ctx.controls) {
        this.ctx.controls.enableRotate = this.saved.enableRotate;
        this.ctx.controls.enabled = this.saved.controlsEnabled;
        this.ctx.controls.target.copy(this.saved.target);
        this.ctx.controls.update();
      }
      if (this.ctx.flyControls) this.ctx.flyControls.enabled = this.saved.flyEnabled;
      this.ctx.controlMode = this.saved.controlMode;
      this.saved = null;
    }
    if (this.ctx._baselodeViewingHelper === this) this.ctx._baselodeViewingHelper = null;
    this.plane = null;
    this.sectionTarget = null;
    this.active = false;
    return this;
  }

  dispose() { return this.disable(); }

  _saveAndUseOrthographicCamera() {
    const { camera, controls, container } = this.ctx;
    if (!camera || !controls) return;
    this.saved = {
      camera,
      enableRotate: controls.enableRotate,
      controlsEnabled: controls.enabled,
      target: controls.target.clone(),
      flyEnabled: this.ctx.flyControls?.enabled || false,
      controlMode: this.ctx.controlMode,
    };
    const aspect = (container?.clientWidth || 1) / (container?.clientHeight || 1);
    const distance = camera.position.distanceTo(controls.target);
    const height = camera.isPerspectiveCamera
      ? 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
      : (camera.top - camera.bottom) / (camera.zoom || 1);
    const halfHeight = Math.max(height / 2, 1);
    const ortho = new THREE.OrthographicCamera(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, 0.01, 10_000_000);
    const target = controls.target.clone();
    const direction = axisNormal(this.axis);
    this.sectionTarget = target.clone();
    this.sectionCameraDistance = Math.max(distance, 1);
    ortho.up.set(0, 0, 1);
    ortho.position.copy(target).addScaledVector(direction, this.sectionCameraDistance);
    ortho.lookAt(target);
    ortho.updateProjectionMatrix();
    replaceCamera(this.ctx, ortho);
    controls.enableRotate = false;
    controls.enabled = true;
    if (this.ctx.flyControls) this.ctx.flyControls.enabled = false;
    this.ctx.controlMode = 'orbit';
    controls.update();
  }

  _setSectionViewPosition() {
    const { camera, controls } = this.ctx;
    if (!camera?.isOrthographicCamera || !controls || !this.sectionTarget) return;
    this.sectionTarget[this.axis] = this.position;
    const direction = axisNormal(this.axis);
    controls.target.copy(this.sectionTarget);
    camera.position.copy(this.sectionTarget).addScaledVector(direction, this.sectionCameraDistance);
    camera.lookAt(this.sectionTarget);
    controls.update();
  }

  _addPlanes(planes) {
    const renderer = this.ctx.renderer;
    if (!renderer) return;
    renderer.clippingPlanes = [...(renderer.clippingPlanes || []), ...planes];
    renderer.localClippingEnabled = true;
  }

  _removePlanes(planes) {
    const renderer = this.ctx.renderer;
    if (!renderer) return;
    const removed = new Set(planes.filter(Boolean));
    renderer.clippingPlanes = (renderer.clippingPlanes || []).filter((plane) => !removed.has(plane));
    if (!renderer.clippingPlanes.length) renderer.localClippingEnabled = this.savedLocalClippingEnabled;
  }
}

/**
 * Movable finite slab aligned to the X or Y axis.
 *
 * Slider changes mutate two existing clipping planes, avoiding geometry
 * creation, data re-rendering, and shader recompilation during interaction.
 */
export class SliceHelper {
  constructor(sceneCtx) {
    this.ctx = sceneCtx;
    this.active = false;
    this.axis = 'x';
    this.position = 0;
    this.width = 50;
    this.planes = [];
    this.savedLocalClippingEnabled = false;
  }

  enable(axis = 'x', position = this.position, width = this.width) {
    if (this.active) this.disable();
    if (this.ctx._baselodeViewingHelper && this.ctx._baselodeViewingHelper !== this) {
      this.ctx._baselodeViewingHelper.disable();
    }
    this.axis = axis === 'y' ? 'y' : 'x';
    this.position = Number.isFinite(position) ? position : 0;
    this.width = Math.max(0.001, Number(width) || 50);
    const normal = axisNormal(this.axis);
    this.planes = [new THREE.Plane(), new THREE.Plane()];
    this._updatePlanes(normal);
    const renderer = this.ctx.renderer;
    if (renderer) {
      this.savedLocalClippingEnabled = renderer.localClippingEnabled;
      renderer.clippingPlanes = [...(renderer.clippingPlanes || []), ...this.planes];
      renderer.localClippingEnabled = true;
    }
    this.ctx._baselodeViewingHelper = this;
    this.active = true;
    return this;
  }

  setPosition(position) {
    if (!Number.isFinite(position)) return this;
    this.position = position;
    if (this.planes.length) this._updatePlanes(axisNormal(this.axis));
    return this;
  }

  setWidth(width) {
    if (!Number.isFinite(width)) return this;
    this.width = Math.max(0.001, width);
    if (this.planes.length) this._updatePlanes(axisNormal(this.axis));
    return this;
  }

  step(delta) { return this.setPosition(this.position + (Number(delta) || 0)); }

  disable() {
    const renderer = this.ctx.renderer;
    const removed = new Set(this.planes);
    if (renderer) {
      renderer.clippingPlanes = (renderer.clippingPlanes || []).filter((plane) => !removed.has(plane));
      if (!renderer.clippingPlanes.length) renderer.localClippingEnabled = this.savedLocalClippingEnabled;
    }
    if (this.ctx._baselodeViewingHelper === this) this.ctx._baselodeViewingHelper = null;
    this.planes = [];
    this.active = false;
    return this;
  }

  dispose() { return this.disable(); }

  _updatePlanes(normal) {
    const halfWidth = this.width / 2;
    this.planes[0].set(normal, -(this.position - halfWidth));
    this.planes[1].set(normal.clone().negate(), this.position + halfWidth);
  }
}
