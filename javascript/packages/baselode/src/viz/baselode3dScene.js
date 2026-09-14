/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ViewportGizmo } from 'three-viewport-gizmo';
import {
  buildViewSignature,
  emitViewChangeIfNeeded,
  fitCameraToBounds,
  focusOnLastBounds,
  focusOnPoint,
  getViewState,
  lookDown,
  pan,
  dolly,
  recenterCameraToOrigin,
  recenterOnBounds,
  setControlMode,
  setFov,
  setViewState,
  setOrbitDepth,
  setProjection,
  viewFromDirection,
  updateCameraTween,
  cancelCameraTween,
  isCameraAnimating,
  updateClipPlanes,
  boundsSphere,
  fitDistanceForRadius,
  getCameraHeading,
  unitsPerPixel,
} from './baselode3dCameraControls.js';
import {
  initSelectionGlow,
  resizeGlow,
  applySelection,
  disposeSelectionGlow
} from './selectionGlow.js';
import {
  setDrillholes as _setDrillholes,
  clearDrillholes as _clearDrillholes,
  setDrillholeColorBy as _setDrillholeColorBy,
  setDrillholeRadius as _setDrillholeRadius,
  setDrillholeFilter as _setDrillholeFilter,
  setSelectedDrillhole as _setSelectedDrillhole,
  getSelectedDrillhole as _getSelectedDrillhole,
  getDrillholeLegend as _getDrillholeLegend,
  getDrillholeMeta as _getDrillholeMeta,
  setDrillholeAnnotations as _setDrillholeAnnotations,
  setDrillholeLod as _setDrillholeLod,
  setDrillholeDatum as _setDrillholeDatum,
  setDrillholeGhostColor as _setDrillholeGhostColor,
  rebuildDrillholeAnnotations as _rebuildDrillholeAnnotations,
  updateDrillholeFrame as _updateDrillholeFrame,
} from './drillholeScene.js';
import { setStripLogs as _setStripLogs, clearStripLogs as _clearStripLogs } from './stripLogScene.js';
import { setBlocks as _setBlocks, clearBlocks as _clearBlocks, setBlockOpacity as _setBlockOpacity } from './blockModelScene.js';
import {
  setStructuralDiscs as _setStructuralDiscs,
  clearStructuralDiscs as _clearStructuralDiscs,
  setStructuralDiscsVisible as _setStructuralDiscsVisible
} from './structuralScene.js';
import {
  attachCanvasClickHandler as _attachCanvasClickHandler,
  updateSelectionFromPointer as _updateSelectionFromPointer,
  primeRaycasterFromEvent,
  pickScene,
} from './sceneClickHandler.js';
import { syncSelectables } from './sceneSelectables.js';
import {
  addRasterOverlay as _addRasterOverlay,
  removeRasterOverlay as _removeRasterOverlay,
  setRasterOverlayOpacity as _setRasterOverlayOpacity,
  setRasterOverlayVisibility as _setRasterOverlayVisibility,
  setRasterOverlayElevation as _setRasterOverlayElevation,
  getRasterOverlay as _getRasterOverlay,
  listRasterOverlays as _listRasterOverlays,
  clearRasterOverlays as _clearRasterOverlays,
} from './rasterOverlayScene.js';
import {
  setTerrain as _setTerrain,
  clearTerrain as _clearTerrain,
  setTerrainOpacity as _setTerrainOpacity,
  setTerrainVisibility as _setTerrainVisibility,
  getTerrain as _getTerrain,
} from './terrainScene.js';
import {
  createExtentBox,
  createGroundGrid,
  createPivotIndicator,
  describeGrid,
  disposeAnchor,
  updateExtentLabels,
  updatePivotIndicator,
} from './sceneAnchors.js';
import { WalkControls, isTypingTarget } from './walkControls.js';

const ACCENT = 0x8c2981;
const HOVER_THROTTLE_MS = 40;

/**
 * Baselode 3D Scene Manager
 * Manages THREE.js scene for rendering drillholes and block models in 3D.
 * Supports orbit and first-person walk camera controls, attribute colouring
 * that never rebuilds geometry, interactive selection, and a set of spatial
 * anchors (ground grid, extent box, orbit pivot marker).
 *
 * Rendering logic lives in the domain-specific modules; this class is a thin
 * orchestrator that owns the WebGL context and delegates to those modules.
 */
class Baselode3DScene {
  constructor(options = {}) {
    this.options = {
      gizmo: options.gizmo !== false,
      environment: options.environment !== false,
      groundGrid: options.groundGrid !== false,
      extentBox: Boolean(options.extentBox),
      pivotIndicator: options.pivotIndicator !== false,
      keyboard: options.keyboard !== false,
      accent: options.accent ?? ACCENT,
      gizmoSize: Number.isFinite(options.gizmoSize) && options.gizmoSize > 0 ? options.gizmoSize : 132,
    };
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
    this.drillholeLayer = null;
    this.structuralGroup = null;
    this.structuralMeshes = [];
    this.stripLogGroups = [];
    this.frameId = null;
    this.clock = new THREE.Clock();
    this.handleCanvasClick = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.drillholeClickHandler = null;
    this.blockClickHandler = null;
    this.hoverHandler = null;
    this.emptyClickHandler = null;
    this.escapeHandler = null;
    this.controlMode = 'orbit';
    this.projection = 'perspective';
    this.isDarkBackground = false;
    this._tmpDir = new THREE.Vector3();
    this.viewChangeHandler = null;
    this._lastViewSignature = '';
    this._lastViewEmitMs = 0;
    this.selectables = [];
    this._selectedObject = null;
    this._composer = null;
    this._blockHighlightMesh = null;
    this._outlinePass = null;
    this.rasterOverlays = new Map();
    this.terrain = null;
    this.lastBounds = null;
    this.anchors = { grid: null, extent: null, pivot: null, gridInfo: null, boundsKey: '' };
    this.anchorVisibility = { grid: this.options.groundGrid, extent: this.options.extentBox };
    this.fogEnabled = false;
    this._hover = null;
    this._hoverStampMs = 0;
    this._interacting = false;
    this._lastInteractionMs = 0;
    this._pointerInside = false;
    this._pmrem = null;
    this._environment = null;
    this._listeners = [];
  }

  init(container) {
    if (!container) return;
    this.container = container;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xffffff);
    this._ghostColor = new THREE.Color(0xffffff);

    // Camera. Near / far are retuned every frame from the scene bounds
    // (see updateClipPlanes) so depth precision is spent on the geometry.
    this.camera = new THREE.PerspectiveCamera(28, width / height, 0.05, 1_000_000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(50, 50, 50);
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.autoClear = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.style.outline = 'none';
    container.appendChild(this.renderer.domElement);

    // Lighting: hemisphere + key light, and an image-based environment so
    // PBR tubes read as polished core rather than flat prisms.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8f8fa8, 0.55);
    hemi.position.set(0, 0, 1);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(1, 0.7, 1.6).multiplyScalar(1000);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-1, -0.5, 0.4).multiplyScalar(1000);
    this.scene.add(fill);
    if (this.options.environment) {
      try {
        this._pmrem = new THREE.PMREMGenerator(this.renderer);
        this._environment = this._pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.scene.environment = this._environment;
      } catch (err) {
        console.warn('Baselode3DScene: environment map unavailable', err);
      }
    }

    // Orbit controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.screenSpacePanning = true;
    this.controls.enableZoom = true;
    this.controls.zoomToCursor = true;
    this.controls.zoomSpeed = 1.2;
    this.controls.rotateSpeed = 0.9;
    this.controls.minDistance = 0.0001;
    this.controls.maxDistance = 5_000_000;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN
    };
    this.controls.maxPolarAngle = Math.PI;
    this.controls.keyPanSpeed = 14;
    if (typeof this.controls.listenToKeyEvents === 'function') this.controls.listenToKeyEvents(window);
    this.controls.addEventListener('start', () => {
      cancelCameraTween(this);
      this._interacting = true;
    });
    this.controls.addEventListener('end', () => {
      this._interacting = false;
      this._lastInteractionMs = nowMs();
    });

    // First-person walk controls (disabled by default)
    this.flyControls = new WalkControls(this.camera, this.renderer.domElement);
    this.flyControls.enabled = false;
    this._resolveForwardTarget = () => {
      if (!this.camera) return null;
      this.camera.getWorldDirection(this._tmpDir);
      this.raycaster.set(this.camera.position, this._tmpDir);
      const hit = pickScene(this);
      return hit ? hit.point.clone() : null;
    };

    // Viewport gizmo (cube)
    if (this.options.gizmo) this._createGizmo();

    _attachCanvasClickHandler(this);
    this._attachPointerHandlers();
    if (this.options.keyboard) this._attachKeyboard();

    // On macOS, Chrome latches wheel events to whichever element is under the
    // cursor at the start of a gesture.  If that element is an overlaid UI panel
    // (zoom slider, controls buttons) rather than the canvas, OrbitControls never
    // receives the event.  Relay any wheel event that bubbles up to the container
    // but did NOT originate from the canvas itself.
    this._wheelRelay = (e) => {
      if (e.target === this.renderer.domElement) return; // already going to OrbitControls
      if (isTypingTarget(e.target) || e.target?.closest?.('[data-baselode-scroll]')) return;
      e.preventDefault();
      this.renderer.domElement.dispatchEvent(new WheelEvent('wheel', {
        clientX: e.clientX,
        clientY: e.clientY,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaZ: e.deltaZ,
        deltaMode: e.deltaMode,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        bubbles: false,
      }));
    };
    this.container.addEventListener('wheel', this._wheelRelay, { passive: false });

    // Selection glow post-processing (blocks and structural discs)
    initSelectionGlow(this);

    // Orbit pivot marker
    if (this.options.pivotIndicator) {
      this.anchors.pivot = createPivotIndicator({ color: hexToCss(this.options.accent) });
      if (this.anchors.pivot) this.scene.add(this.anchors.pivot);
    }

    // Animation loop
    const animate = () => {
      this.frameId = requestAnimationFrame(animate);
      const delta = this.clock.getDelta();
      const now = nowMs();
      const tweening = updateCameraTween(this, now);
      if (this.controlMode === 'fly' && this.flyControls?.enabled) {
        this.flyControls.update(delta);
      } else if (this.controls && !tweening) {
        this.controls.update();
      }
      updateClipPlanes(this);
      this._emitViewChangeIfNeeded();
      const viewportHeight = this.container?.clientHeight || 1;
      _updateDrillholeFrame(this, { dt: delta, viewportHeight });
      this._updateAnchorsFrame(delta, viewportHeight, tweening);
      this.renderer.clear();
      const useComposer = this._composer && this._outlinePass && this._outlinePass.selectedObjects?.length > 0;
      if (useComposer) {
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
    if (this.camera.isOrthographicCamera) {
      const halfHeight = (this.camera.top - this.camera.bottom) / 2;
      const halfWidth = halfHeight * (width / height);
      this.camera.left = -halfWidth;
      this.camera.right = halfWidth;
    } else {
      this.camera.aspect = width / height;
    }
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
    this._listeners.forEach(({ target, type, fn, opts }) => target.removeEventListener(type, fn, opts));
    this._listeners = [];
    if (this.gizmo) {
      this.gizmo.dispose();
      this.gizmo = null;
    }
    this.viewChangeHandler = null;
    this.hoverHandler = null;
    _clearBlocks(this);
    _clearDrillholes(this);
    _clearStripLogs(this);
    _clearStructuralDiscs(this);
    _clearRasterOverlays(this);
    _clearTerrain(this);
    disposeSelectionGlow(this);
    this._disposeAnchors();
    if (this.anchors.pivot) { this.scene?.remove(this.anchors.pivot); disposeAnchor(this.anchors.pivot); this.anchors.pivot = null; }
    if (this.container && this._wheelRelay) {
      this.container.removeEventListener('wheel', this._wheelRelay);
    }
    if (this.controls) this.controls.dispose();
    if (this.flyControls) this.flyControls.dispose();
    this._environment?.dispose?.();
    this._pmrem?.dispose?.();
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

  /**
   * Render drillholes as one merged tube mesh.
   * @param {Array<object>} holes - desurveyed holes with `points`
   * @param {object} [options] - see normalizeDrillholeRenderOptions in drillholeScene.js
   */
  setDrillholes(holes, options = {}) {
    _setDrillholes(this, holes, options);
    this._syncAnchors();
  }

  clearDrillholes() { _clearDrillholes(this); }

  /**
   * Recolour the drillholes by a different attribute without rebuilding
   * geometry.  Accepts the same colour options as setDrillholes.
   * @returns {object|null} legend
   */
  setDrillholeColorBy(options = {}) { return _setDrillholeColorBy(this, options); }

  /** Tube radius (scene units) or `{ radius, screenPixels }` for constant pixel width. */
  setDrillholeRadius(value) { _setDrillholeRadius(this, value); }

  /** Ghost every hole whose id is not in the iterable; null shows all. */
  setDrillholeFilter(visibleIds) { _setDrillholeFilter(this, visibleIds); }

  /** Highlight a hole (null clears). */
  setSelectedDrillhole(holeId) { return _setSelectedDrillhole(this, holeId); }
  getSelectedDrillhole() { return _getSelectedDrillhole(this); }

  /** Legend entries matching the current drillhole colouring. */
  getDrillholeLegend() { return _getDrillholeLegend(this); }
  getDrillholeMeta() { return _getDrillholeMeta(this); }

  /** Toggle hole labels, collar markers and collar drop lines. */
  setDrillholeAnnotations(flags) { _setDrillholeAnnotations(this, flags); }

  /** Configure the far level of detail. */
  setDrillholeLod(opts) { _setDrillholeLod(this, opts); }

  /**
   * Add floating 2D strip log panels beside drillholes in the 3D scene.
   * @param {Array<object>} holes - Hole objects (same array as passed to setDrillholes)
   * @param {Array<object>} stripLogs - Strip log definitions (see stripLogScene.js)
   */
  setStripLogs(holes, stripLogs) { _setStripLogs(this, holes, stripLogs); }

  /** Remove all strip log panels from the scene and free GPU resources. */
  clearStripLogs() { _clearStripLogs(this); }

  /**
   * Render block model data as a single merged mesh of exterior faces only.
   */
  setBlocks(data, selectedProperty, stats, options = {}) {
    _setBlocks(this, data, selectedProperty, stats, options);
    this._syncAnchors();
  }

  setBlockOpacity(opacity) { _setBlockOpacity(this, opacity); }

  setStructuralDiscs(structures, holes, opts = {}) { _setStructuralDiscs(this, structures, holes, opts); }

  setStructuralDiscsVisible(visible) { _setStructuralDiscsVisible(this, visible); }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  setDrillholeClickHandler(handler) {
    this.drillholeClickHandler = typeof handler === 'function' ? handler : null;
  }

  setBlockClickHandler(handler) {
    this.blockClickHandler = typeof handler === 'function' ? handler : null;
  }

  /** Called with hover info ({ type, x, y, z, holeId?, md? } or null) as the pointer moves. */
  setHoverHandler(handler) {
    this.hoverHandler = typeof handler === 'function' ? handler : null;
  }

  /** Called when the user clicks empty space. */
  setEmptyClickHandler(handler) {
    this.emptyClickHandler = typeof handler === 'function' ? handler : null;
  }

  /** Called when Escape is pressed over the viewport (after the scene clears its own selection). */
  setEscapeHandler(handler) {
    this.escapeHandler = typeof handler === 'function' ? handler : null;
  }

  /** Last hover info, or null. */
  getHover() { return this._hover; }

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

  _fitCameraToBounds(bounds, opts) {
    fitCameraToBounds(this, bounds, opts);
  }

  recenterCameraToOrigin(distance = 1000) { recenterCameraToOrigin(this, distance); }

  /** Recentre on the scene extent, keeping the viewing direction. */
  recenter(opts = {}) { recenterOnBounds(this, this.lastBounds, { animate: true, ...opts }); }

  lookDown(distance, opts = {}) {
    let d = distance;
    if (!Number.isFinite(d) || d <= 0) {
      d = this.lastBounds ? fitDistanceForRadius(this.camera, boundsSphere(this.lastBounds).radius, 1.2) : 2000;
    }
    lookDown(this, d, { animate: true, ...opts });
  }

  pan(dx = 0, dy = 0) { pan(this, dx, dy); }
  dolly(scale = 1.1) { dolly(this, scale); }
  focusOnLastBounds(padding = 1.2, opts = {}) { focusOnLastBounds(this, padding, { animate: true, ...opts }); }

  /** Frame everything (animated). */
  fitAll(opts = {}) { focusOnLastBounds(this, 1.15, { animate: true, ...opts }); }

  /** Move the orbit target to a point and dolly to it. */
  focusOnPoint(point, opts = {}) { focusOnPoint(this, point, { animate: true, ...opts }); }

  /** Snap to a cardinal view: 'north' | 'south' | 'east' | 'west' | 'top' | 'bottom'. */
  viewFrom(name, opts = {}) { viewFromDirection(this, name, { animate: true, ...opts }); }

  /** Frame the selected hole, or everything when nothing is selected. */
  frameSelection() {
    const holeId = _getSelectedDrillhole(this);
    const meta = holeId != null ? _getDrillholeMeta(this).find((h) => h.id === holeId) : null;
    if (!meta) { this.fitAll(); return; }
    const centre = {
      x: (meta.collar.x + meta.eoh.x) / 2,
      y: (meta.collar.y + meta.eoh.y) / 2,
      z: (meta.collar.z + meta.eoh.z) / 2,
    };
    const span = Math.max(meta.length, 1) * 0.55;
    focusOnPoint(this, centre, { distance: fitDistanceForRadius(this.camera, span, 1.25), animate: true });
  }

  /** Move the orbit pivot to the selected hole without changing distance. */
  pivotToSelection() {
    const holeId = _getSelectedDrillhole(this);
    const meta = holeId != null ? _getDrillholeMeta(this).find((h) => h.id === holeId) : null;
    if (!meta) return;
    focusOnPoint(this, {
      x: (meta.collar.x + meta.eoh.x) / 2,
      y: (meta.collar.y + meta.eoh.y) / 2,
      z: (meta.collar.z + meta.eoh.z) / 2,
    }, { animate: true });
  }

  /**
   * Change the camera field-of-view while keeping the visible scene the same apparent size.
   * @param {number} fovDeg - Desired FOV in degrees
   */
  setCameraFov(fovDeg) { setFov(this, fovDeg); }

  /** Switch projection: 'perspective' | 'orthographic'. */
  setProjection(mode) {
    const applied = setProjection(this, mode, {
      createOrthographic: (l, r, t, b, n, f) => new THREE.OrthographicCamera(l, r, t, b, n, f),
    });
    if (applied) this.projection = this.camera.isOrthographicCamera ? 'orthographic' : 'perspective';
    return applied;
  }

  getProjection() { return this.camera?.isOrthographicCamera ? 'orthographic' : 'perspective'; }

  toggleProjection() {
    return this.setProjection(this.getProjection() === 'orthographic' ? 'perspective' : 'orthographic');
  }

  /**
   * Set the scene background colour.
   * @param {'white'|'black'|string} colour
   */
  setBackground(colour) {
    if (!this.scene) return;
    const c = new THREE.Color(colour === 'black' ? 0x000000 : colour === 'white' ? 0xffffff : colour);
    const wasDark = this.isDarkBackground;
    this.scene.background = c;
    this.isDarkBackground = relativeLuminance(c) < 0.4;
    this._ghostColor = c.clone();
    _setDrillholeGhostColor(this, c);
    if (this.scene.fog) this.scene.fog.color.copy(c);
    if (wasDark !== this.isDarkBackground) {
      if (this.options.gizmo) this._createGizmo();
      _rebuildDrillholeAnnotations(this);
      this._rebuildAnchors();
    }
  }

  setControlMode(mode = 'orbit') {
    setControlMode(this, mode);
  }

  getControlMode() { return this.controlMode; }

  // ---------------------------------------------------------------------------
  // Anchors and atmosphere
  // ---------------------------------------------------------------------------

  setGroundGridVisible(visible) {
    this.anchorVisibility.grid = Boolean(visible);
    if (this.anchors.grid) this.anchors.grid.visible = this.anchorVisibility.grid;
  }

  setExtentBoxVisible(visible) {
    this.anchorVisibility.extent = Boolean(visible);
    if (this.anchors.extent) this.anchors.extent.visible = this.anchorVisibility.extent;
  }

  /** Datum elevation for the ground grid and collar drop lines. */
  setGridElevation(elevation) {
    if (!Number.isFinite(elevation)) return;
    this._gridElevation = elevation;
    this._rebuildAnchors();
    _setDrillholeDatum(this, elevation);
  }

  getGridInfo() {
    const info = this.anchors.gridInfo;
    return info ? { spacing: info.spacing, elevation: info.elevation } : null;
  }

  setFogEnabled(enabled) {
    this.fogEnabled = Boolean(enabled);
    if (!this.scene) return;
    if (!this.fogEnabled || !this.lastBounds) {
      this.scene.fog = null;
      return;
    }
    const { radius } = boundsSphere(this.lastBounds);
    const bg = this.scene.background instanceof THREE.Color ? this.scene.background : new THREE.Color(0xffffff);
    this.scene.fog = new THREE.FogExp2(bg.getHex(), 1.1 / (radius * 9));
  }

  // ---------------------------------------------------------------------------
  // HUD readouts
  // ---------------------------------------------------------------------------

  /**
   * Snapshot of everything a heads-up display needs: heading, scale, pivot,
   * bounds, grid, projection and the frustum footprint on the grid plane.
   */
  getHudState() {
    if (!this.camera || !this.controls) return null;
    const heading = getCameraHeading(this);
    const viewportHeight = this.container?.clientHeight || 1;
    const grid = this.anchors.gridInfo;
    const target = this.controls.target;
    return {
      azimuthDeg: heading.azimuthDeg,
      pitchDeg: heading.pitchDeg,
      unitsPerPixel: unitsPerPixel(this, viewportHeight),
      target: { x: target.x, y: target.y, z: target.z },
      camera: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      bounds: this.lastBounds ? { ...this.lastBounds } : null,
      gridSpacing: grid?.spacing ?? null,
      gridElevation: grid?.elevation ?? null,
      projection: this.getProjection(),
      controlMode: this.controlMode,
      animating: isCameraAnimating(this),
      selectedHoleId: _getDrillholeSelected(this),
      lodActive: Boolean(this.drillholeLayer?.lod?.active),
      footprint: this._frustumFootprint(grid?.elevation ?? this.lastBounds?.maxZ ?? 0),
      walkSpeed: this.flyControls?.movementSpeed ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Selection glow public API
  // ---------------------------------------------------------------------------

  _syncSelectables() { syncSelectables(this); }

  setSelectableObjects(objects) {
    this.selectables = Array.isArray(objects) ? objects.slice() : [];
  }

  selectObject(object) { applySelection(this, object || null); }

  getSelectedObject() { return this._selectedObject || null; }

  disposeGlow() { disposeSelectionGlow(this); }

  /** @private */
  _updateSelectionFromPointer() { _updateSelectionFromPointer(this); }

  // ---------------------------------------------------------------------------
  // Raster overlay API — delegate to rasterOverlayScene
  // ---------------------------------------------------------------------------

  addRasterOverlay(layer) { _addRasterOverlay(this, layer); }
  removeRasterOverlay(id) { _removeRasterOverlay(this, id); }
  setRasterOverlayOpacity(id, opacity) { _setRasterOverlayOpacity(this, id, opacity); }
  setRasterOverlayVisibility(id, visible) { _setRasterOverlayVisibility(this, id, visible); }
  setRasterOverlayElevation(id, elevation) { _setRasterOverlayElevation(this, id, elevation); }
  getRasterOverlay(id) { return _getRasterOverlay(this, id); }
  listRasterOverlays() { return _listRasterOverlays(this); }

  // ---------------------------------------------------------------------------
  // Terrain surface API — delegate to terrainScene
  // ---------------------------------------------------------------------------

  setTerrain(layer) { _setTerrain(this, layer); }
  clearTerrain() { _clearTerrain(this); }
  setTerrainOpacity(opacity) { _setTerrainOpacity(this, opacity); }
  setTerrainVisible(visible) { _setTerrainVisibility(this, visible); }
  getTerrain() { return _getTerrain(this); }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  _createGizmo() {
    if (!this.renderer || !this.camera) return;
    if (this.gizmo) { this.gizmo.dispose(); this.gizmo = null; }
    const dark = this.isDarkBackground;
    const accent = this.options.accent;
    const size = this.options.gizmoSize;
    const face = (label) => ({
      label,
      color: dark ? 0x3a3a4e : 0xe6e4ee,
      labelColor: dark ? 0xe9e8f1 : 0x23223a,
      border: { size: 1.5, color: dark ? 0x5a5970 : 0x9b99b3 },
      // Hover: a soft tint of the accent and an accent border, no scaling, so
      // the face stays inside the cube silhouette.
      hover: {
        color: dark ? 0x4a2c47 : 0xf1dfee,
        labelColor: dark ? 0xf3c9ee : 0x6d1f65,
        border: { size: 2, color: accent },
      },
    });
    // three-viewport-gizmo lays out its faces and labels for whatever
    // THREE.Object3D.DEFAULT_UP is at construction time, and converts drag /
    // click coordinates through it at runtime.  Our scene is Z-up, so build
    // the widget under a temporary Z-up default (restored immediately, so the
    // rest of the app is untouched) and pin the runtime conversion to Z-up.
    const savedUp = THREE.Object3D.DEFAULT_UP.clone();
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    try {
      this.gizmo = new ViewportGizmo(this.camera, this.renderer, {
        container: this.container,
        type: 'cube',
        size,
        placement: 'top-right',
        offset: { top: 14, right: 14 },
        animated: true,
        speed: 2,
        resolution: 256,
        lineWidth: 2,
        font: { family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', weight: 600 },
        // A faint disc behind the cube shows the whole widget is a drag target;
        // it brightens on hover.
        background: {
          enabled: true,
          color: dark ? 0xffffff : 0x1c1b2e,
          opacity: dark ? 0.06 : 0.04,
          hover: { color: dark ? 0xffffff : 0x1c1b2e, opacity: dark ? 0.12 : 0.09 },
        },
        // Edge and corner targets have large invisible hit zones that swallow
        // face clicks, which is what made the cube feel random.  Faces only:
        // a click always means a cardinal view; 45° views live on the keys.
        edges: { enabled: false },
        corners: { enabled: false },
        x: face('E'), nx: face('W'),
        y: face('N'), ny: face('S'),
        z: face('UP'), nz: face('DOWN'),
      });
      pinGizmoToZUp(this.gizmo);
      this.gizmo.attachControls(this.controls);
    } catch (err) {
      console.warn('Baselode3DScene: cube gizmo unavailable, falling back to sphere', err);
      this.gizmo = new ViewportGizmo(this.camera, this.renderer, {
        container: this.container, placement: 'top-right', size, offset: { top: 14, right: 14 },
      });
      pinGizmoToZUp(this.gizmo);
      this.gizmo.attachControls(this.controls);
    } finally {
      THREE.Object3D.DEFAULT_UP.copy(savedUp);
    }
  }

  _listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push({ target, type, fn, opts });
  }

  _attachPointerHandlers() {
    const canvas = this.renderer.domElement;
    this._listen(canvas, 'pointerdown', (e) => {
      cancelCameraTween(this);
      this._lastInteractionMs = nowMs();
      try { canvas.focus({ preventScroll: true }); } catch { /* ignore */ }
      if (this.controlMode !== 'orbit' || !this.controls?.enabled) return;
      if (!primeRaycasterFromEvent(this, e)) return;
      // Orbit / pan around whatever is under the cursor: move the target to
      // that depth along the view axis so the view itself does not jump.
      const hit = pickScene(this);
      if (hit && Number.isFinite(hit.distance) && hit.distance > 0) setOrbitDepth(this, hit.distance);
    });
    this._listen(canvas, 'dblclick', (e) => {
      if (this.controlMode !== 'orbit') return;
      if (!primeRaycasterFromEvent(this, e)) return;
      const hit = pickScene(this);
      if (!hit) { this.fitAll(); return; }
      let distance = this.camera.position.distanceTo(this.controls.target) * 0.45;
      if (hit.type === 'drillhole') {
        const meta = this.drillholeLayer?.holes?.[hit.holeIndex];
        if (meta) distance = fitDistanceForRadius(this.camera, Math.max(meta.length, 1) * 0.55, 1.25);
      }
      focusOnPoint(this, hit.point, { distance, animate: true });
    });
    this._listen(canvas, 'pointermove', (e) => {
      const now = nowMs();
      if (now - this._hoverStampMs < HOVER_THROTTLE_MS) return;
      this._hoverStampMs = now;
      if (this._interacting || e.buttons) return;
      if (!primeRaycasterFromEvent(this, e)) return;
      const hit = pickScene(this);
      let hover = null;
      if (hit) {
        hover = { type: hit.type, x: hit.point.x, y: hit.point.y, z: hit.point.z };
        if (hit.type === 'drillhole') { hover.holeId = hit.holeId; hover.md = hit.md; hover.project = hit.project; }
        if (hit.type === 'block') hover.block = hit.block;
      } else {
        const elevation = this.anchors.gridInfo?.elevation ?? this.lastBounds?.maxZ;
        if (Number.isFinite(elevation)) {
          const p = intersectHorizontalPlane(this.raycaster.ray, elevation);
          if (p) hover = { type: 'ground', x: p.x, y: p.y, z: p.z };
        }
      }
      this._setHover(hover);
    });
    this._listen(canvas, 'pointerleave', () => this._setHover(null));
    this._listen(this.container, 'pointerenter', () => { this._pointerInside = true; });
    this._listen(this.container, 'pointerleave', () => { this._pointerInside = false; });
    // Right-click is the rotate button; keep the browser menu out of the way.
    this._listen(canvas, 'contextmenu', (e) => e.preventDefault());
  }

  _setHover(hover) {
    const prev = this._hover;
    const same = (!prev && !hover) || (prev && hover && prev.type === hover.type && prev.holeId === hover.holeId
      && Math.abs(prev.x - hover.x) < 1e-6 && Math.abs(prev.y - hover.y) < 1e-6 && Math.abs(prev.z - hover.z) < 1e-6);
    if (same) return;
    this._hover = hover;
    this.hoverHandler?.(hover);
  }

  _attachKeyboard() {
    if (typeof window === 'undefined') return;
    const canvas = this.renderer.domElement;
    this._listen(window, 'keydown', (e) => {
      if (isTypingTarget(e.target)) return;
      const focused = typeof document !== 'undefined' && document.activeElement === canvas;
      if (!focused && !this._pointerInside) return;
      if (e.altKey) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const helper = this._baselodeViewingHelper;
      let handled = true;
      switch (e.code) {
        case 'Escape':
          _setSelectedDrillhole(this, null);
          applySelection(this, null);
          this.escapeHandler?.();
          break;
        case 'KeyG':
          if (this.controlMode === 'fly') { handled = false; break; }
          this.setGroundGridVisible(!this.anchorVisibility.grid);
          this.setExtentBoxVisible(this.anchorVisibility.grid);
          break;
        case 'KeyL':
          if (this.controlMode === 'fly') { handled = false; break; }
          if (this.drillholeLayer) _setDrillholeAnnotations(this, { labels: !this.drillholeLayer.show.labels });
          break;
        case 'BracketLeft':
        case 'BracketRight':
          if (helper?.active && typeof helper.step === 'function') {
            const step = helper.width || this.anchors.gridInfo?.spacing || 10;
            helper.step(e.code === 'BracketRight' ? step : -step);
            this.sectionStepHandler?.(helper.position);
          } else handled = false;
          break;
        default:
          handled = false;
      }
      if (!handled && this.controlMode === 'orbit' && !helper?.active) {
        handled = true;
        switch (e.code) {
          case 'Digit1': case 'Numpad1': this.viewFrom(ctrl ? 'south' : 'north'); break;
          case 'Digit3': case 'Numpad3': this.viewFrom(ctrl ? 'west' : 'east'); break;
          case 'Digit7': case 'Numpad7': this.viewFrom(ctrl ? 'bottom' : 'top'); break;
          case 'Digit5': case 'Numpad5': this.toggleProjection(); this.projectionChangeHandler?.(this.getProjection()); break;
          case 'KeyF': this.frameSelection(); break;
          case 'Home': this.fitAll(); break;
          case 'Period': case 'NumpadDecimal': this.pivotToSelection(); break;
          default: handled = false;
        }
      }
      if (handled) e.preventDefault();
    });
  }

  /** Called when the projection is toggled from the keyboard. */
  setProjectionChangeHandler(handler) { this.projectionChangeHandler = typeof handler === 'function' ? handler : null; }
  /** Called with the new position when a section / slab is stepped from the keyboard. */
  setSectionStepHandler(handler) { this.sectionStepHandler = typeof handler === 'function' ? handler : null; }

  _syncAnchors() {
    if (!this.scene) return;
    const b = this.lastBounds;
    const key = b ? [b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ].map((v) => v.toFixed(2)).join('|') : '';
    if (key === this.anchors.boundsKey) return;
    this.anchors.boundsKey = key;
    this._rebuildAnchors();
    if (this.fogEnabled) this.setFogEnabled(true);
    if (this.flyControls) this.flyControls.setSpeedFromBounds?.(b);
  }

  _rebuildAnchors() {
    if (!this.scene) return;
    this._disposeAnchors();
    const b = this.lastBounds;
    if (!b) return;
    const dark = this.isDarkBackground;
    const grid = describeGrid(b, { elevation: this._gridElevation });
    this.anchors.gridInfo = grid;
    this.anchors.grid = createGroundGrid(grid, { dark });
    this.anchors.grid.visible = this.anchorVisibility.grid;
    this.scene.add(this.anchors.grid);
    this.anchors.extent = createExtentBox(b, { dark });
    this.anchors.extent.visible = this.anchorVisibility.extent;
    this.scene.add(this.anchors.extent);
  }

  _disposeAnchors() {
    if (this.anchors.grid) { this.scene?.remove(this.anchors.grid); disposeAnchor(this.anchors.grid); this.anchors.grid = null; }
    if (this.anchors.extent) { this.scene?.remove(this.anchors.extent); disposeAnchor(this.anchors.extent); this.anchors.extent = null; }
  }

  _updateAnchorsFrame(dt, viewportHeight, tweening) {
    if (this.anchors.pivot && this.controls) {
      const recent = nowMs() - this._lastInteractionMs < 450;
      updatePivotIndicator(this.anchors.pivot, {
        target: this.controls.target,
        camera: this.camera,
        viewportHeight,
        active: this.controlMode === 'orbit' && (this._interacting || recent || tweening),
        dt,
      });
    }
    updateExtentLabels(this.anchors.extent, this.camera, viewportHeight);
  }

  _frustumFootprint(elevation) {
    if (!this.camera || !Number.isFinite(elevation)) return null;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const near = new THREE.Vector3();
    const far = new THREE.Vector3();
    const ray = new THREE.Ray();
    return corners.map(([x, y]) => {
      near.set(x, y, -1).unproject(this.camera);
      far.set(x, y, 1).unproject(this.camera);
      ray.origin.copy(near);
      ray.direction.copy(far).sub(near).normalize();
      const p = intersectHorizontalPlane(ray, elevation);
      return p ? { x: p.x, y: p.y } : null;
    });
  }
}

/**
 * Make a ViewportGizmo instance behave as if THREE.Object3D.DEFAULT_UP were
 * +Z regardless of the global default: same mapping the library applies for
 * Z-up, pinned on the instance.
 */
function pinGizmoToZUp(gizmo) {
  if (!gizmo) return;
  gizmo.up.set(0, 0, 1);
  gizmo.coordinateConversion = (v, isSpherical = false) => {
    const { x, y, z } = v;
    return isSpherical ? v.set(z, x, y) : v.set(y, z, x);
  };
}

function _getDrillholeSelected(scene) {
  return _getSelectedDrillhole(scene);
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function hexToCss(hex) {
  return `#${Number(hex).toString(16).padStart(6, '0')}`;
}

function relativeLuminance(color) {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

const _planeHit = new THREE.Vector3();
function intersectHorizontalPlane(ray, elevation) {
  const dz = ray.direction.z;
  if (Math.abs(dz) < 1e-9) return null;
  const t = (elevation - ray.origin.z) / dz;
  if (t <= 0) return null;
  return _planeHit.copy(ray.origin).addScaledVector(ray.direction, t).clone();
}

export default Baselode3DScene;
