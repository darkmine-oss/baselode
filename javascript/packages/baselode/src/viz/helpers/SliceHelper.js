/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';

/**
 * SliceHelper — arbitrary-plane slab-slice viewing tool.
 *
 * A slice (sometimes called a *slab slice*) renders only geometry within a
 * finite thickness around a plane.  Unlike a section, a slice shows geometry
 * on **both sides** of the central plane — only geometry outside the defined
 * half-width is hidden.
 *
 * Two THREE.js clipping planes form a bounded slab:
 *
 * ```
 * Plane1: normal,  constant = -(distance − width/2)   → visible where n·P ≥ distance − width/2
 * Plane2: −normal, constant =   distance + width/2     → visible where n·P ≤ distance + width/2
 * ```
 *
 * Coordinate system: X = Easting, Y = Northing, Z = Elevation (Z is up).
 *
 * @example
 * import { SliceHelper } from 'baselode';
 * const helper = new SliceHelper(scene);
 * helper.enableSliceMode();
 * helper.setSlicePlane(new THREE.Vector3(1, 0, 0), 4500);  // YZ plane at X=4500
 * helper.setSliceWidth(50);                                 // ±25 m slab
 * helper.moveSlice(10);                                     // advance 10 m
 * helper.disableSliceMode();
 */
class SliceHelper {
  /**
   * @param {object} sceneCtx - Baselode3DScene instance (or compatible context
   *   with `.renderer`, `.camera`, `.scene` properties).
   */
  constructor(sceneCtx) {
    this._ctx = sceneCtx;
    this._active = false;
    /** Unit normal of the slice plane in world space. */
    this._normal = new THREE.Vector3(1, 0, 0);
    /** Signed distance from origin to the slice plane along the normal. */
    this._distance = 0;
    /** Total thickness of the slice slab (visible region = distance ± width/2). */
    this._width = 50;
    /** @type {THREE.Plane|null} positive-side clipping plane */
    this._plane1 = null;
    /** @type {THREE.Plane|null} negative-side clipping plane */
    this._plane2 = null;
    /** Optional slab-indicator mesh added to the scene. */
    this._slabIndicator = null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Activate slice mode.
   *
   * Enables `renderer.localClippingEnabled` and inserts two clipping planes
   * that form a slab centred on the current slice plane.
   *
   * Activating slice mode automatically deactivates any currently-active
   * SectionHelper registered on the same scene context.
   */
  enableSliceMode() {
    // Mutual exclusion: deactivate any other registered viewing helper.
    if (this._ctx._activeViewingHelper && this._ctx._activeViewingHelper !== this) {
      this._ctx._activeViewingHelper.disable();
    }
    this._ctx._activeViewingHelper = this;

    this._active = true;

    if (this._ctx.renderer) {
      this._ctx.renderer.localClippingEnabled = true;
    }

    this._setupClippingPlanes();
    this._addSlabIndicator();
  }

  /**
   * Deactivate slice mode and remove all clipping planes.
   */
  disableSliceMode() {
    if (this._ctx._activeViewingHelper === this) {
      this._ctx._activeViewingHelper = null;
    }
    this._active = false;
    this._removeClippingPlanes();
    this._removeSlabIndicator();
  }

  /**
   * Alias for {@link disableSliceMode} — allows uniform `helper.disable()`
   * calls when deactivating from a mutual-exclusion handler.
   */
  disable() { this.disableSliceMode(); }

  /**
   * Set the slice plane.
   *
   * The plane is defined by a unit normal and a signed distance from the
   * origin (`distance = normal · point_on_plane`).
   *
   * @param {THREE.Vector3} normal - Plane normal (will be normalised).
   * @param {number} distance - Signed distance from origin.
   */
  setSlicePlane(normal, distance) {
    this._normal.copy(normal).normalize();
    this._distance = distance;
    this._updateClippingPlanes();
    this._updateSlabIndicator();
  }

  /**
   * Set the total thickness (width) of the visible slab.
   *
   * Geometry within `distance ± width/2` of the slice plane will be
   * rendered; everything else is clipped.
   *
   * @param {number} width - Slab thickness in world units (e.g. metres).
   */
  setSliceWidth(width) {
    this._width = Math.max(0, width);
    this._updateClippingPlanes();
    this._updateSlabIndicator();
  }

  /**
   * Translate the slice plane along its normal by `delta` world units.
   *
   * @param {number} delta - Distance to move (positive = along normal,
   *   negative = against normal).
   */
  moveSlice(delta) {
    this._distance += delta;
    this._updateClippingPlanes();
    this._updateSlabIndicator();
  }

  /**
   * Return the current slice plane as `{ normal: THREE.Vector3, distance: number }`.
   * @returns {{ normal: THREE.Vector3, distance: number }}
   */
  getSlicePlane() {
    return { normal: this._normal.clone(), distance: this._distance };
  }

  /**
   * Return the current slab thickness.
   * @returns {number}
   */
  getSliceWidth() {
    return this._width;
  }

  /**
   * Derive a vertical slice plane from two screen-space points representing a
   * drawn knife line.
   *
   * Workflow:
   * 1. Unproject both screen points into world space (at mid-depth).
   * 2. Compute the horizontal line direction (XY only, Z discarded).
   * 3. The slice-plane normal is the horizontal vector perpendicular to the
   *    line (i.e. `Z × lineDir`, projected to XY and normalised).
   * 4. The plane's `distance` is `normal · midpoint`.
   *
   * The plane is vertical (its normal has no Z component), and it passes
   * through the midpoint of the two screen points projected into the scene.
   *
   * @param {{ x: number, y: number }} startScreen - Start of the drawn line
   *   in **pixel** coordinates (origin at top-left of the canvas).
   * @param {{ x: number, y: number }} endScreen - End of the drawn line in
   *   pixel coordinates.
   * @returns {{ normal: THREE.Vector3, distance: number }|null} The derived
   *   plane, or `null` when the line is degenerate (zero-length) or a valid
   *   camera is unavailable.
   */
  createSlicePlaneFromScreenLine(startScreen, endScreen) {
    const ctx = this._ctx;
    if (!ctx.camera || !ctx.renderer) return null;

    const domEl = ctx.renderer.domElement;
    const w = domEl.clientWidth || domEl.width || 1;
    const h = domEl.clientHeight || domEl.height || 1;

    // Convert pixel coordinates → Normalised Device Coordinates (NDC).
    const toNDC = (px, py) => new THREE.Vector3(
      (px / w) * 2 - 1,
      -(py / h) * 2 + 1,
      0.5   // mid-depth in NDC
    );

    const startNDC = toNDC(startScreen.x, startScreen.y);
    const endNDC = toNDC(endScreen.x, endScreen.y);

    // Unproject into world space.
    startNDC.unproject(ctx.camera);
    endNDC.unproject(ctx.camera);

    // Project both world points to the horizontal (XY) plane to obtain a
    // truly vertical slice plane regardless of camera tilt.
    const startXY = new THREE.Vector3(startNDC.x, startNDC.y, 0);
    const endXY = new THREE.Vector3(endNDC.x, endNDC.y, 0);

    const lineDir = endXY.clone().sub(startXY);
    if (lineDir.length() < 1e-6) return null; // degenerate line
    lineDir.normalize();

    // Normal is perpendicular to the line in the XY plane.
    // Cross(Z_up × lineDir) gives a vector 90° CCW in XY.
    const zUp = new THREE.Vector3(0, 0, 1);
    const normal = new THREE.Vector3().crossVectors(zUp, lineDir).normalize();

    if (normal.length() < 1e-6) return null; // lineDir was exactly Z

    // Distance from origin to the midpoint projected onto the normal.
    const midpoint = startXY.clone().add(endXY).multiplyScalar(0.5);
    const distance = normal.dot(midpoint);

    return { normal, distance };
  }

  /**
   * Release all resources (equivalent to calling {@link disableSliceMode}).
   */
  dispose() {
    this.disableSliceMode();
  }

  // ---------------------------------------------------------------------------
  // Private helpers — clipping planes
  // ---------------------------------------------------------------------------

  /**
   * Compute the two THREE.Plane instances that bound the slab.
   *
   * For a plane Plane(n, d) and half-width hw = width/2:
   *   Plane1: n,  -(d − hw)   → visible when n·P ≥ d − hw
   *   Plane2: -n,  d + hw     → visible when n·P ≤ d + hw
   *
   * A fragment is rendered only when it satisfies **both** planes.
   */
  _computePlanes() {
    const hw = this._width / 2;
    const d = this._distance;
    const n = this._normal;

    const plane1 = new THREE.Plane(n.clone(), -(d - hw));
    const plane2 = new THREE.Plane(n.clone().negate(), d + hw);
    return [plane1, plane2];
  }

  _setupClippingPlanes() {
    const [p1, p2] = this._computePlanes();
    this._plane1 = p1;
    this._plane2 = p2;
    this._applyClippingPlanes([p1, p2]);
  }

  _updateClippingPlanes() {
    if (!this._plane1 || !this._plane2) return;
    const hw = this._width / 2;
    const d = this._distance;
    const n = this._normal;

    // Update in-place to avoid GC churn.
    this._plane1.normal.copy(n);
    this._plane1.constant = -(d - hw);

    this._plane2.normal.copy(n).negate();
    this._plane2.constant = d + hw;
  }

  _removeClippingPlanes() {
    this._applyClippingPlanes([]);
    this._plane1 = null;
    this._plane2 = null;
  }

  _applyClippingPlanes(planes) {
    if (this._ctx.renderer) {
      this._ctx.renderer.clippingPlanes = planes;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers — slab indicator
  // ---------------------------------------------------------------------------

  _addSlabIndicator() {
    const ctx = this._ctx;
    if (!ctx.scene) return;
    this._removeSlabIndicator();

    const size = 5000;
    const geometry = new THREE.PlaneGeometry(size, size);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff9900,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    this._orientIndicator(mesh);
    ctx.scene.add(mesh);
    this._slabIndicator = mesh;
  }

  _updateSlabIndicator() {
    if (!this._slabIndicator) return;
    this._orientIndicator(this._slabIndicator);
  }

  /**
   * Orient and position the indicator mesh to lie on the slice plane.
   * @param {THREE.Mesh} mesh
   */
  _orientIndicator(mesh) {
    // The default PlaneGeometry normal is (0, 0, 1).  Rotate the mesh so its
    // face aligns with the slice-plane normal.
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._normal);
    mesh.setRotationFromQuaternion(quaternion);

    // Centre the indicator on the slice plane.
    mesh.position.copy(this._normal).multiplyScalar(this._distance);
  }

  _removeSlabIndicator() {
    const ctx = this._ctx;
    if (!this._slabIndicator) return;
    if (ctx.scene) ctx.scene.remove(this._slabIndicator);
    this._slabIndicator.geometry?.dispose();
    this._slabIndicator.material?.dispose();
    this._slabIndicator = null;
  }
}

export { SliceHelper };
