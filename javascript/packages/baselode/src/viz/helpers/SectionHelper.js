/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';

/**
 * SectionHelper — orthographic cross-section viewing tool.
 *
 * A section is a vertical planar view aligned to a principal axis (X or Y).
 * When active the camera is switched to orthographic projection, rotation is
 * disabled, and a clipping plane hides all geometry **in front of** the
 * section plane (toward the camera) so that only geometry **behind** it is
 * rendered.
 *
 * This replicates the standard cross-section workflow used in professional
 * geological modelling software (Leapfrog, Vulcan, Micromine, Datamine).
 *
 * Coordinate system: X = Easting, Y = Northing, Z = Elevation (Z is up).
 *
 * @example
 * import { SectionHelper } from 'baselode';
 * const helper = new SectionHelper(scene);
 * helper.enableSectionMode('x');
 * helper.setSectionPosition(4500);  // X = 4500 m
 * helper.stepSection(-10);          // step 10 m west
 * helper.disableSectionMode();
 */
class SectionHelper {
  /**
   * @param {object} sceneCtx - Baselode3DScene instance (or compatible context
   *   with `.renderer`, `.camera`, `.controls`, `.scene`, `.gizmo`,
   *   `._composer` properties).
   */
  constructor(sceneCtx) {
    this._ctx = sceneCtx;
    this._active = false;
    /** @type {'x'|'y'} */
    this._axis = 'x';
    /** World-coordinate position of the section plane along its axis. */
    this._distance = 0;
    /** @type {THREE.Plane|null} */
    this._clippingPlane = null;
    /** Saved perspective camera so it can be restored on disable. */
    this._savedCamera = null;
    /** Saved controls state so it can be restored on disable. */
    this._savedControlsState = null;
    /** The orthographic camera created while section mode is active. */
    this._orthoCamera = null;
    /** Optional plane-indicator mesh added to the scene. */
    this._planeIndicator = null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Activate section mode.
   *
   * - Switches the renderer camera to orthographic projection.
   * - Aligns the camera to look along the chosen axis.
   * - Inserts a clipping plane that hides geometry in front of the section.
   * - Disables camera rotation (pan and zoom remain active).
   *
   * Activating section mode automatically deactivates any currently-active
   * SliceHelper registered on the same scene context.
   *
   * If the scene is currently in fly mode, fly mode is automatically suspended
   * for the duration of the section view and restored when
   * {@link disableSectionMode} is called. Section mode requires orbit controls
   * in order to constrain the camera to pan and zoom only.
   *
   * @param {'x'|'y'} axis - Section orientation: `'x'` for an East–West
   *   section (camera looks in −X direction), `'y'` for a North–South section
   *   (camera looks in −Y direction).
   */
  enableSectionMode(axis = 'x') {
    // Mutual exclusion: deactivate any other registered viewing helper.
    if (this._ctx._activeViewingHelper && this._ctx._activeViewingHelper !== this) {
      this._ctx._activeViewingHelper.disable();
    }
    this._ctx._activeViewingHelper = this;

    this._axis = axis === 'y' ? 'y' : 'x';
    this._active = true;

    if (this._ctx.renderer) {
      this._ctx.renderer.localClippingEnabled = true;
    }

    this._setupClippingPlane();
    this._switchToOrthoCamera();
    this._addPlaneIndicator();
  }

  /**
   * Deactivate section mode.
   *
   * Removes the clipping plane, restores the perspective camera, and
   * re-enables rotation.
   */
  disableSectionMode() {
    if (this._ctx._activeViewingHelper === this) {
      this._ctx._activeViewingHelper = null;
    }
    this._active = false;
    this._removeClippingPlane();
    this._restorePerspectiveCamera();
    this._removePlaneIndicator();
  }

  /**
   * Alias for {@link disableSectionMode} — allows uniform `helper.disable()`
   * calls when deactivating from a mutual-exclusion handler.
   */
  disable() { this.disableSectionMode(); }

  /**
   * Move the section plane to an absolute world-coordinate position along
   * the active axis.
   *
   * @param {number} distance - World coordinate along the section axis
   *   (e.g. 4500 for X = 4500 m Easting).
   */
  setSectionPosition(distance) {
    this._distance = distance;
    this._updateClippingPlane();
    this._updatePlaneIndicator();
  }

  /**
   * Step the section plane by a relative offset.
   *
   * @param {number} delta - Distance to move (positive = forward along axis,
   *   negative = backward).
   */
  stepSection(delta) {
    this.setSectionPosition(this._distance + delta);
  }

  /**
   * Return the current section plane position (world coordinate along axis).
   * @returns {number}
   */
  getSectionPosition() {
    return this._distance;
  }

  /**
   * Release all resources (equivalent to calling {@link disableSectionMode}).
   */
  dispose() {
    this.disableSectionMode();
  }

  // ---------------------------------------------------------------------------
  // Private helpers — clipping plane
  // ---------------------------------------------------------------------------

  _setupClippingPlane() {
    // For an X section the camera sits at +X and looks in the −X direction.
    // We want to hide geometry where x > this._distance (between the camera
    // and the section plane) and show geometry where x ≤ this._distance.
    //
    // THREE.Plane clips (hides) fragments where normal·P + constant < 0.
    // With normal = (−1, 0, 0) and constant = D:
    //   distanceToPoint = −x + D
    //   < 0  when x > D  → clipped  ✓
    //   ≥ 0  when x ≤ D  → visible  ✓
    //
    // The same logic applies to the Y axis with normal = (0, −1, 0).
    const normal = this._axis === 'x'
      ? new THREE.Vector3(-1, 0, 0)
      : new THREE.Vector3(0, -1, 0);

    this._clippingPlane = new THREE.Plane(normal, this._distance);
    this._applyClippingPlanes([this._clippingPlane]);
  }

  _updateClippingPlane() {
    if (this._clippingPlane) {
      this._clippingPlane.constant = this._distance;
    }
  }

  _removeClippingPlane() {
    this._applyClippingPlanes([]);
    this._clippingPlane = null;
  }

  _applyClippingPlanes(planes) {
    if (this._ctx.renderer) {
      this._ctx.renderer.clippingPlanes = planes;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers — orthographic camera
  // ---------------------------------------------------------------------------

  _switchToOrthoCamera() {
    const ctx = this._ctx;
    if (!ctx.container || !ctx.camera || !ctx.controls) return;

    // Save all state before making any modifications.
    const savedControlMode = ctx.controlMode ?? 'orbit';
    this._savedCamera = ctx.camera;
    this._savedControlsState = {
      enableRotate: ctx.controls.enableRotate,
      target: ctx.controls.target.clone(),
      controlMode: savedControlMode
    };

    // Section mode requires orbit controls so that only pan and zoom remain
    // active. If the scene is in fly mode, suspend it now and restore on exit.
    if (savedControlMode === 'fly' && typeof ctx.setControlMode === 'function') {
      ctx.setControlMode('orbit');
    }

    const width = ctx.container.clientWidth || 800;
    const height = ctx.container.clientHeight || 600;
    const aspect = width / height;

    // Derive a frustum size that matches the current perspective view so the
    // scene content appears at roughly the same size after switching.
    const dist = ctx.camera.position.distanceTo(ctx.controls.target);
    const fovRad = ((ctx.camera.fov || 28) * Math.PI) / 180;
    const frustumHeight = 2 * dist * Math.tan(fovRad / 2);
    const halfH = frustumHeight / 2;
    const halfW = halfH * aspect;

    const ortho = new THREE.OrthographicCamera(
      -halfW, halfW, halfH, -halfH,
      -100000, 100000
    );
    ortho.up.set(0, 0, 1);

    const target = ctx.controls.target.clone();
    // For orthographic projection the camera position only determines the look
    // direction; the actual distance from the target has no effect on the
    // rendered image. 10 000 m is chosen to be safely within the ±100 000
    // near/far bounds defined above.
    if (this._axis === 'x') {
      // Camera at +X relative to target, looking in −X direction.
      ortho.position.set(target.x + 10000, target.y, target.z);
    } else {
      // Camera at +Y relative to target, looking in −Y direction.
      ortho.position.set(target.x, target.y + 10000, target.z);
    }
    ortho.lookAt(target);

    this._orthoCamera = ortho;
    ctx.camera = ortho;

    // Update orbit controls to use the new camera.
    if (ctx.controls) {
      ctx.controls.object = ortho;
      ctx.controls.enableRotate = false;
      ctx.controls.update();
    }

    // Update the viewport gizmo.
    if (ctx.gizmo) {
      ctx.gizmo.camera = ortho;
    }

    // Update the EffectComposer RenderPass camera if present.
    if (ctx._composer?.passes?.[0]) {
      ctx._composer.passes[0].camera = ortho;
    }
  }

  _restorePerspectiveCamera() {
    const ctx = this._ctx;
    if (!this._savedCamera) return;

    ctx.camera = this._savedCamera;

    if (ctx.controls) {
      ctx.controls.object = this._savedCamera;
      ctx.controls.enableRotate = this._savedControlsState?.enableRotate ?? true;
      if (this._savedControlsState?.target) {
        ctx.controls.target.copy(this._savedControlsState.target);
      }
      ctx.controls.update();
    }

    if (ctx.gizmo) {
      ctx.gizmo.camera = this._savedCamera;
    }

    if (ctx._composer?.passes?.[0]) {
      ctx._composer.passes[0].camera = this._savedCamera;
    }

    // Restore fly mode after the perspective camera is back in place, so that
    // setControlMode can reference the correct ctx.camera.
    const savedMode = this._savedControlsState?.controlMode ?? 'orbit';
    if (savedMode === 'fly' && typeof ctx.setControlMode === 'function') {
      ctx.setControlMode('fly');
    }

    this._savedCamera = null;
    this._savedControlsState = null;
    this._orthoCamera = null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers — plane indicator
  // ---------------------------------------------------------------------------

  _addPlaneIndicator() {
    const ctx = this._ctx;
    if (!ctx.scene) return;
    this._removePlaneIndicator();

    // Semi-transparent rectangle aligned to the section plane.
    const size = 5000;
    const geometry = this._axis === 'x'
      ? new THREE.PlaneGeometry(size, size) // lies in YZ; rotate to YZ plane
      : new THREE.PlaneGeometry(size, size); // lies in XZ; rotate to XZ plane

    const material = new THREE.MeshBasicMaterial({
      color: 0x3399ff,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    // PlaneGeometry by default lies in the XY plane (normal = +Z).
    // Rotate so it aligns with the section axis.
    if (this._axis === 'x') {
      mesh.rotation.y = Math.PI / 2; // rotate to be in the YZ plane
    } else {
      mesh.rotation.x = Math.PI / 2; // rotate to be in the XZ plane
    }
    this._updateIndicatorPosition(mesh);
    ctx.scene.add(mesh);
    this._planeIndicator = mesh;
  }

  _updatePlaneIndicator() {
    if (!this._planeIndicator) return;
    this._updateIndicatorPosition(this._planeIndicator);
  }

  _updateIndicatorPosition(mesh) {
    if (this._axis === 'x') {
      mesh.position.set(this._distance, 0, 0);
    } else {
      mesh.position.set(0, this._distance, 0);
    }
  }

  _removePlaneIndicator() {
    const ctx = this._ctx;
    if (!this._planeIndicator) return;
    if (ctx.scene) ctx.scene.remove(this._planeIndicator);
    this._planeIndicator.geometry?.dispose();
    this._planeIndicator.material?.dispose();
    this._planeIndicator = null;
  }
}

export { SectionHelper };
