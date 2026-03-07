/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { FlyControls } from 'three/examples/jsm/controls/FlyControls';
import { ViewportGizmo } from 'three-viewport-gizmo';
import {
  buildViewSignature,
  emitViewChangeIfNeeded,
  fitCameraToBounds,
  focusOnLastBounds,
  getViewState,
  lookDown,
  pan,
  dolly,
  recenterCameraToOrigin,
  setControlMode,
  setFov,
  setViewState
} from './baselode3dCameraControls.js';
import {
  initSelectionGlow,
  resizeGlow,
  applySelection,
  disposeSelectionGlow
} from './selectionGlow.js';
import { setDrillholes as _setDrillholes, clearDrillholes as _clearDrillholes } from './drillholeScene.js';
import { setBlocks as _setBlocks, clearBlocks as _clearBlocks, setBlockOpacity as _setBlockOpacity } from './blockModelScene.js';
import {
  setStructuralDiscs as _setStructuralDiscs,
  clearStructuralDiscs as _clearStructuralDiscs,
  setStructuralDiscsVisible as _setStructuralDiscsVisible
} from './structuralScene.js';
import { attachCanvasClickHandler as _attachCanvasClickHandler, updateSelectionFromPointer as _updateSelectionFromPointer } from './sceneClickHandler.js';
import { syncSelectables } from './sceneSelectables.js';

/**
 * Baselode 3D Scene Manager
 * Manages THREE.js scene for rendering drillholes and block models in 3D.
 * Supports orbit and fly camera controls, assay coloring, and interactive selection.
 *
 * Rendering logic lives in the domain-specific modules; this class is a thin
 * orchestrator that owns the WebGL context and delegates to those modules.
 */
class Baselode3DScene {
  constructor() {
    this.container = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.flyControls = null;
    this.gizmo = null;
    this.blocks = [];
    this.drillLines = [];
    this.drillMeshes = [];
    this.structuralGroup = null;
    this.structuralMeshes = [];
    this.frameId = null;
    this.clock = new THREE.Clock();
    this.handleCanvasClick = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.drillholeClickHandler = null;
    this.blockClickHandler = null;
    this.controlMode = 'orbit';
    this._tmpDir = new THREE.Vector3();
    this.viewChangeHandler = null;
    this._lastViewSignature = '';
    this._lastViewEmitMs = 0;
    this.selectables = [];
    this._selectedObject = null;
    this._composer = null;
    this._blockHighlightMesh = null;
    this._outlinePass = null;
  }

  init(container) {
    if (!container) return;
    this.container = container;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xffffff);

    // Camera — lower near plane allows ultra-close zoom without clipping
    this.camera = new THREE.PerspectiveCamera(28, width / height, 0.001, 100000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(50, 50, 50);
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(10, 10, 5);
    this.scene.add(directionalLight);

    // Axes helper
    const axesHelper = new THREE.AxesHelper(20);
    this.scene.add(axesHelper);

    // Orbit controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.enableZoom = true;
    this.controls.zoomSpeed = 1.2;
    this.controls.minDistance = 0.003;
    this.controls.maxDistance = 40000;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.PAN
    };
    this.controls.maxPolarAngle = Math.PI;

    // Fly controls (disabled by default)
    this.flyControls = new FlyControls(this.camera, this.renderer.domElement);
    this.flyControls.movementSpeed = 2000;
    this.flyControls.rollSpeed = Math.PI / 12;
    this.flyControls.dragToLook = true;
    this.flyControls.enabled = false;

    // Viewport gizmo
    this.gizmo = new ViewportGizmo(this.camera, this.renderer, {
      container: this.container,
      placement: 'top-right',
      size: 110,
      offset: { top: 12, right: 12 },
      animated: true,
      speed: 1.5
    });
    this.gizmo.attachControls(this.controls);

    _attachCanvasClickHandler(this);

    // Selection glow post-processing
    initSelectionGlow(this);

    // Animation loop
    const animate = () => {
      this.frameId = requestAnimationFrame(animate);
      const delta = this.clock.getDelta();
      this.renderer.clear();
      if (this.controlMode === 'fly' && this.flyControls?.enabled) {
        this.flyControls.update(delta);
      } else if (this.controls) {
        this.controls.update();
      }
      this._emitViewChangeIfNeeded();
      if (this._composer) {
        this._composer.render(delta);
      } else {
        this.renderer.render(this.scene, this.camera);
      }
      if (this.gizmo) this.gizmo.render();
    };
    animate();
  }

  resize() {
    if (!this.container || !this.camera || !this.renderer) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (this.gizmo) this.gizmo.update();
    resizeGlow(this, width, height);
  }

  dispose() {
    if (this.frameId) cancelAnimationFrame(this.frameId);
    if (this.renderer && this.handleCanvasClick) {
      this.renderer.domElement.removeEventListener('click', this.handleCanvasClick);
    }
    if (this.gizmo) {
      this.gizmo.dispose();
      this.gizmo = null;
    }
    this.viewChangeHandler = null;
    _clearBlocks(this);
    _clearDrillholes(this);
    _clearStructuralDiscs(this);
    disposeSelectionGlow(this);
    if (this.controls) this.controls.dispose();
    if (this.flyControls) this.flyControls.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      if (this.container && this.renderer.domElement) {
        this.container.removeChild(this.renderer.domElement);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Data renderers — delegate to domain modules
  // ---------------------------------------------------------------------------

  setDrillholes(holes, options = {}) { _setDrillholes(this, holes, options); }

  /**
   * Render block model data as a single merged mesh of exterior faces only.
   * @param {Array<Object>} data - Block rows (canonical column names)
   * @param {string} selectedProperty - Attribute column used for colouring
   * @param {Object} stats - Property statistics
   * @param {Object} [options]
   */
  setBlocks(data, selectedProperty, stats, options = {}) { _setBlocks(this, data, selectedProperty, stats, options); }

  /**
   * Update the opacity of all currently rendered blocks.
   * @param {number} opacity - New opacity value between 0 and 1
   */
  setBlockOpacity(opacity) { _setBlockOpacity(this, opacity); }

  setStructuralDiscs(structures, holes, opts = {}) { _setStructuralDiscs(this, structures, holes, opts); }

  setStructuralDiscsVisible(visible) { _setStructuralDiscsVisible(this, visible); }

  // ---------------------------------------------------------------------------
  // Click handlers
  // ---------------------------------------------------------------------------

  setDrillholeClickHandler(handler) {
    this.drillholeClickHandler = handler;
  }

  /**
   * Register a click handler for block selection.
   * @param {Function|null} handler - Callback ``(blockData) => void``, or null to clear
   */
  setBlockClickHandler(handler) {
    this.blockClickHandler = typeof handler === 'function' ? handler : null;
  }

  // ---------------------------------------------------------------------------
  // Camera controls — delegate to baselode3dCameraControls
  // ---------------------------------------------------------------------------

  setViewChangeHandler(handler) {
    this.viewChangeHandler = typeof handler === 'function' ? handler : null;
  }

  getViewState() { return getViewState(this); }
  setViewState(viewState) { return setViewState(this, viewState); }

  _buildViewSignature(viewState) { return buildViewSignature(viewState); }
  _emitViewChangeIfNeeded() { emitViewChangeIfNeeded(this); }

  _fitCameraToBounds({ minX, maxX, minY, maxY, minZ, maxZ }) {
    fitCameraToBounds(this, { minX, maxX, minY, maxY, minZ, maxZ });
  }

  recenterCameraToOrigin(distance = 1000) { recenterCameraToOrigin(this, distance); }
  lookDown(distance = 2000) { lookDown(this, distance); }
  pan(dx = 0, dy = 0) { pan(this, dx, dy); }
  dolly(scale = 1.1) { dolly(this, scale); }
  focusOnLastBounds(padding = 1.2) { focusOnLastBounds(this, padding); }

  /**
   * Change the camera field-of-view while keeping the visible scene the same apparent size.
   * @param {number} fovDeg - Desired FOV in degrees
   */
  setCameraFov(fovDeg) { setFov(this, fovDeg); }

  setControlMode(mode = 'orbit') { setControlMode(this, mode); }

  // ---------------------------------------------------------------------------
  // Selection glow public API
  // ---------------------------------------------------------------------------

  _syncSelectables() { syncSelectables(this); }

  /**
   * Register the objects that are candidates for click-select glow.
   * @param {THREE.Object3D[]} objects
   */
  setSelectableObjects(objects) {
    this.selectables = Array.isArray(objects) ? objects.slice() : [];
  }

  /**
   * Programmatically select an object (or pass null to clear).
   * @param {THREE.Object3D|null} object
   */
  selectObject(object) { applySelection(this, object || null); }

  /**
   * Return the currently selected object, or null if nothing is selected.
   * @returns {THREE.Object3D|null}
   */
  getSelectedObject() { return this._selectedObject || null; }

  /**
   * Dispose the effect composer and all GPU resources used by the selection glow.
   */
  disposeGlow() { disposeSelectionGlow(this); }

  /** @private */
  _updateSelectionFromPointer() { _updateSelectionFromPointer(this); }
}

export default Baselode3DScene;
