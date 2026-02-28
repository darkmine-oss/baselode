/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { FlyControls } from 'three/examples/jsm/controls/FlyControls';
import { ViewportGizmo } from 'three-viewport-gizmo';
import { getColorForValue } from '../data/blockModelLoader.js';
import { buildEqualRangeColorScale, getEqualRangeBinIndex, getEqualRangeColor } from './assayColorScale.js';
import { computeStructuralPositions } from '../data/structuralPositions.js';
import { buildStructuralDiscs } from './structuralScene.js';
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

/** Default color for low or zero assay values */
const LOW_ASSAY_GREY = '#9ca3af';

/**
 * Get measured depth range for a segment between  two points
 * @private
 */
function getMeasuredDepthRange(p1, p2) {
  const md1 = Number(p1?.md);
  const md2 = Number(p2?.md);
  if (!Number.isFinite(md1) || !Number.isFinite(md2)) return null;
  const segStart = Math.min(md1, md2);
  const segEnd = Math.max(md1, md2);
  if (segEnd <= segStart) return null;
  return { segStart, segEnd };
}

/**
 * Calculate weighted average assay value for a segment overlapping with assay intervals
 * @private
 */
function getWeightedIntervalValue(assayIntervals, segStart, segEnd) {
  let weightedSum = 0;
  let weightTotal = 0;

  for (let i = 0; i < assayIntervals.length; i += 1) {
    const candidate = assayIntervals[i];
    const from = Number(candidate?.from);
    const to = Number(candidate?.to);
    const value = Number(candidate?.value);
    if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(value) || to <= from) continue;
    const overlapStart = Math.max(segStart, from);
    const overlapEnd = Math.min(segEnd, to);
    const overlap = overlapEnd - overlapStart;
    if (overlap <= 0) continue;
    weightedSum += value * overlap;
    weightTotal += overlap;
  }

  if (weightTotal <= 0) return null;
  const value = weightedSum / weightTotal;
  return Number.isFinite(value) ? value : null;
}

/**
 * Get THREE.Color for an assay value based on color scale
 * @private
 */
function getAssaySegmentColor(value, assayScale) {
  if (!Number.isFinite(value)) return new THREE.Color(LOW_ASSAY_GREY);
  const binIndex = getEqualRangeBinIndex(value, assayScale);
  if (binIndex < 0) return new THREE.Color(LOW_ASSAY_GREY);
  const colorHex = getEqualRangeColor(value, assayScale, LOW_ASSAY_GREY);
  return new THREE.Color(colorHex);
}

/**
 * Normalize drillhole rendering options with defaults
 * @private
 */
function normalizeDrillholeRenderOptions(options = {}) {
  return {
    preserveView: Boolean(options.preserveView),
    assayIntervalsByHole: options.assayIntervalsByHole || null,
    selectedAssayVariable: options.selectedAssayVariable || ''
  };
}

/**
 * Collect all numeric assay values from interval data
 * @private
 */
function collectAssayValues(assayIntervalsByHole, selectedAssayVariable) {
  if (!assayIntervalsByHole || !selectedAssayVariable) return [];
  const allAssayValues = [];
  Object.values(assayIntervalsByHole).forEach((intervals) => {
    (intervals || []).forEach((interval) => {
      const value = Number(interval?.value);
      if (Number.isFinite(value)) allAssayValues.push(value);
    });
  });
  return allAssayValues;
}

/**
 * Build user data object for drillhole mesh
 * @private
 */
function buildHoleUserData(hole) {
  return {
    holeId: hole.id,
    project: hole.project
  };
}

/**
 * Baselode 3D Scene Manager
 * Manages THREE.js scene for rendering drillholes and block models in 3D
 * Supports orbit and fly camera controls, assay coloring, and interactive selection
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
  }

  init(container) {
    if (!container) return;
    this.container = container;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xffffff);

    // Camera
    // Lower near plane to allow ultra-close zoom without clipping
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

    // Lighting - balanced for clean colors without bleeding
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
    directionalLight.position.set(10, 10, 5);
    this.scene.add(directionalLight);

    // Axes helper
    const axesHelper = new THREE.AxesHelper(20);
    this.scene.add(axesHelper);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false; // remove inertial damping for snappier response
    this.controls.screenSpacePanning = true;
    this.controls.enableZoom = true;
    this.controls.zoomSpeed = 1.2;
    this.controls.minDistance = 0.003; // 10x closer zoom
    this.controls.maxDistance = 40000;
    // Controls: left drag = pan, scroll = zoom, right drag = rotate
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

    // Fly controls (disabled by default, toggled on demand)
    this.flyControls = new FlyControls(this.camera, this.renderer.domElement);
    this.flyControls.movementSpeed = 2000; // faster fly speed
    this.flyControls.rollSpeed = Math.PI / 12;
    this.flyControls.dragToLook = true;
    this.flyControls.enabled = false;

    // Viewport gizmo (interactive axis helper)
    this.gizmo = new ViewportGizmo(this.camera, this.renderer, {
      container: this.container,
      placement: 'top-right',
      size: 110,
      offset: { top: 12, right: 12 },
      animated: true,
      speed: 1.5
    });
    this.gizmo.attachControls(this.controls);
    this._attachCanvasClickHandler();

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
      this.renderer.render(this.scene, this.camera);
      if (this.gizmo) this.gizmo.render();
    };
    animate();
  }

  setViewChangeHandler(handler) {
    this.viewChangeHandler = typeof handler === 'function' ? handler : null;
  }

  getViewState() {
    return getViewState(this);
  }

  setViewState(viewState) {
    return setViewState(this, viewState);
  }

  _buildViewSignature(viewState) {
    return buildViewSignature(viewState);
  }

  _emitViewChangeIfNeeded() {
    emitViewChangeIfNeeded(this);
  }

  _attachCanvasClickHandler() {
    const renderer = this.renderer;
    if (!renderer) return;

    this.handleCanvasClick = (event) => {
      if (event.button !== 0) return; // left click only

      // Ignore clicks inside the gizmo area to avoid conflicts
      if (this.gizmo?.domElement) {
        const gizmoRect = this.gizmo.domElement.getBoundingClientRect();
        if (
          event.clientX >= gizmoRect.left &&
          event.clientX <= gizmoRect.right &&
          event.clientY >= gizmoRect.top &&
          event.clientY <= gizmoRect.bottom
        ) {
          return;
        }
      }

      const rect = renderer.domElement.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;

      this.pointer.x = ((localX / rect.width) * 2) - 1;
      this.pointer.y = -((localY / rect.height) * 2) + 1;

      this.raycaster.setFromCamera(this.pointer, this.camera);

      // Check block clicks first (blocks are on top of drillholes in priority)
      if (this.blocks.length > 0) {
        const blockIntersects = this.raycaster.intersectObjects(this.blocks, false);
        if (blockIntersects.length > 0) {
          const hit = blockIntersects[0];
          const blockObj = hit.object;
          if (blockObj?.userData?._isMergedBlocks && this.blockClickHandler) {
            // Merged geometry: each quad = 2 triangles, so quad index = faceIndex / 2
            const quadIndex = Math.floor(hit.faceIndex / 2);
            const blockData = blockObj.userData._quadToBlock[quadIndex];
            if (blockData) this.blockClickHandler(blockData);
          }
          return; // consumed by block click
        }
      }

      // Fall through to drillhole click detection
      const drillHits = this.raycaster.intersectObjects(this.drillMeshes, true);
      const structHits = this.raycaster.intersectObjects(this.structuralMeshes, true);

      const drillDist = drillHits[0]?.distance ?? Infinity;
      const structDist = structHits[0]?.distance ?? Infinity;

      if (structDist < drillDist && structHits.length > 0) {
        // Structural disc clicked — fire handler with structural metadata
        const mesh = structHits[0].object;
        if (this.drillholeClickHandler) {
          this.drillholeClickHandler({ type: 'structure', ...mesh.userData });
        }
        return;
      }

      if (drillHits.length === 0) return;
      let obj = drillHits[0].object;
      while (obj && obj.parent && !obj.userData?.holeId) {
        obj = obj.parent;
      }
      const holeId = obj?.userData?.holeId;
      const project = obj?.userData?.project;
      if (holeId && this.drillholeClickHandler) {
        this.drillholeClickHandler({ holeId, project });
      }
    };

    renderer.domElement.addEventListener('click', this.handleCanvasClick);
  }

  resize() {
    if (!this.container || !this.camera || !this.renderer) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (this.gizmo) this.gizmo.update();
  }

  /**
   * Render block model data as a single merged mesh of exterior faces only.
   *
   * Adjacent blocks' shared faces are skipped so there are no coincident
   * polygons and therefore no z-fighting.  Vertex colours are used so the
   * entire model is a single draw call.
   *
   * Accepts rows with canonical column names ``x``, ``y``, ``z``, ``dx``,
   * ``dy``, ``dz`` (produced by :func:`parseBlockModelCSV`).
   *
   * @param {Array<Object>} data - Block rows (canonical column names)
   * @param {string} selectedProperty - Attribute column used for colouring
   * @param {Object} stats - Property statistics (from :func:`calculatePropertyStats`)
   * @param {Object} [options]
   * @param {Object} [options.offset] - Optional ``{x, y, z}`` translation applied
   *   to all block centres before rendering.  When omitted the scene defaults to
   *   auto-centering by shifting the extent centre to the origin.
   * @param {number} [options.opacity=1.0] - Initial material opacity (0–1)
   * @param {boolean} [options.autoCenter=true] - If true and no offset is
   *   supplied, translate block centres so the extent centre sits at the origin.
   */
  setBlocks(data, selectedProperty, stats, options = {}) {
    if (!this.scene) return;

    this._clearBlocks();

    if (!data || !selectedProperty || !stats) return;

    const { autoCenter = true, opacity = 1.0 } = options;

    // Compute raw extent from data
    let rawMinX = Infinity, rawMaxX = -Infinity;
    let rawMinY = Infinity, rawMaxY = -Infinity;
    let rawMinZ = Infinity, rawMaxZ = -Infinity;

    data.forEach((row) => {
      const x = Number(row.x ?? row.center_x ?? 0);
      const y = Number(row.y ?? row.center_y ?? 0);
      const z = Number(row.z ?? row.center_z ?? 0);
      const dx = Number(row.dx ?? row.size_x ?? 1);
      const dy = Number(row.dy ?? row.size_y ?? 1);
      const dz = Number(row.dz ?? row.size_z ?? 1);
      rawMinX = Math.min(rawMinX, x - dx / 2);
      rawMaxX = Math.max(rawMaxX, x + dx / 2);
      rawMinY = Math.min(rawMinY, y - dy / 2);
      rawMaxY = Math.max(rawMaxY, y + dy / 2);
      rawMinZ = Math.min(rawMinZ, z - dz / 2);
      rawMaxZ = Math.max(rawMaxZ, z + dz / 2);
    });

    // Determine coordinate offset
    let offX = 0, offY = 0, offZ = 0;
    if (options.offset) {
      offX = Number(options.offset.x ?? 0);
      offY = Number(options.offset.y ?? 0);
      offZ = Number(options.offset.z ?? 0);
    } else if (autoCenter) {
      offX = -((rawMinX + rawMaxX) / 2);
      offY = -((rawMinY + rawMaxY) / 2);
      offZ = -((rawMinZ + rawMaxZ) / 2);
    }

    // Translated scene extents (used for camera fit)
    const minX = rawMinX + offX, maxX = rawMaxX + offX;
    const minY = rawMinY + offY, maxY = rawMaxY + offY;
    const minZ = rawMinZ + offZ, maxZ = rawMaxZ + offZ;

    // Neighbour lookup: "rx,ry,rz" keyed on rounded data-space block centres.
    // A face is interior (skipped) when the neighbour centre exists in the set.
    const bkey = (x, y, z) => `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
    const blockSet = new Set(
      data.map(row => bkey(Number(row.x ?? 0), Number(row.y ?? 0), Number(row.z ?? 0)))
    );

    // Six face definitions.  neibDir is used to locate the neighbour in that
    // direction.  verts are ±1 scale factors of the half-extents (dx/2 etc.).
    const FACE_DEFS = [
      { normal: [ 1, 0, 0], neibDir: [ 1, 0, 0], verts: [[ 1,-1,-1],[ 1, 1,-1],[ 1, 1, 1],[ 1,-1, 1]] },
      { normal: [-1, 0, 0], neibDir: [-1, 0, 0], verts: [[-1,-1, 1],[-1, 1, 1],[-1, 1,-1],[-1,-1,-1]] },
      { normal: [ 0, 1, 0], neibDir: [ 0, 1, 0], verts: [[-1, 1, 1],[ 1, 1, 1],[ 1, 1,-1],[-1, 1,-1]] },
      { normal: [ 0,-1, 0], neibDir: [ 0,-1, 0], verts: [[ 1,-1, 1],[-1,-1, 1],[-1,-1,-1],[ 1,-1,-1]] },
      { normal: [ 0, 0, 1], neibDir: [ 0, 0, 1], verts: [[-1,-1, 1],[ 1,-1, 1],[ 1, 1, 1],[-1, 1, 1]] },
      { normal: [ 0, 0,-1], neibDir: [ 0, 0,-1], verts: [[ 1,-1,-1],[-1,-1,-1],[-1, 1,-1],[ 1, 1,-1]] },
    ];

    const positions = [];
    const normals   = [];
    const colors    = [];
    const indices   = [];
    const quadToBlock = []; // quad index → original row (for click detection)
    let vi = 0;

    data.forEach((row) => {
      const bx = Number(row.x ?? row.center_x ?? 0);
      const by = Number(row.y ?? row.center_y ?? 0);
      const bz = Number(row.z ?? row.center_z ?? 0);
      const dx = Number(row.dx ?? row.size_x ?? 1);
      const dy = Number(row.dy ?? row.size_y ?? 1);
      const dz = Number(row.dz ?? row.size_z ?? 1);
      const cx = bx + offX, cy = by + offY, cz = bz + offZ;

      const color = getColorForValue(row[selectedProperty], stats, THREE);
      const { r, g, b } = color;

      FACE_DEFS.forEach((face) => {
        // Skip face if an adjacent block occupies the neighbouring cell
        const nbx = bx + face.neibDir[0] * dx;
        const nby = by + face.neibDir[1] * dy;
        const nbz = bz + face.neibDir[2] * dz;
        if (blockSet.has(bkey(nbx, nby, nbz))) return;

        const vBase = vi;
        face.verts.forEach(([sx, sy, sz]) => {
          positions.push(cx + sx * dx / 2, cy + sy * dy / 2, cz + sz * dz / 2);
          normals.push(face.normal[0], face.normal[1], face.normal[2]);
          colors.push(r, g, b);
          vi++;
        });
        indices.push(vBase, vBase + 1, vBase + 2, vBase, vBase + 2, vBase + 3);
        quadToBlock.push(row);
      });
    });

    if (positions.length === 0) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
    geometry.setAttribute('color',    new THREE.Float32BufferAttribute(colors,    3));
    geometry.setIndex(indices);

    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide, // safe — all interior faces are already removed
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData._isMergedBlocks = true;
    mesh.userData._quadToBlock = quadToBlock;
    this.scene.add(mesh);
    this.blocks.push(mesh);

    if (this.camera && this.controls) {
      this.lastBounds = { minX, maxX, minY, maxY, minZ, maxZ };
      fitCameraToBounds(this, { minX, maxX, minY, maxY, minZ, maxZ });
    }
  }

  /**
   * Update the opacity of all currently rendered blocks.
   * @param {number} opacity - New opacity value between 0 (transparent) and 1 (opaque)
   */
  setBlockOpacity(opacity) {
    const clamped = Math.max(0, Math.min(1, Number(opacity)));
    this.blocks.forEach((block) => {
      if (block.material) {
        block.material.opacity = clamped;
        block.material.transparent = clamped < 1;
        block.material.needsUpdate = true;
      }
    });
  }

  /**
   * Register a click handler for block selection.
   * The handler is called with the full block row data when a block is clicked.
   * @param {Function|null} handler - Callback ``(blockData) => void``, or null to clear
   */
  setBlockClickHandler(handler) {
    this.blockClickHandler = typeof handler === 'function' ? handler : null;
  }

  setDrillholes(holes, options = {}) {
    if (!this.scene) return;

    this._clearDrillholes();
    if (!holes || holes.length === 0) return;

    const { preserveView, assayIntervalsByHole, selectedAssayVariable } = normalizeDrillholeRenderOptions(options);
    const allAssayValues = collectAssayValues(assayIntervalsByHole, selectedAssayVariable);
    const assayScale = buildEqualRangeColorScale(allAssayValues);

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    const tmpVec = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0); // cylinder default axis

    holes.forEach((hole, idx) => {
      // Improved color palette: use golden angle for better distribution
      const goldenAngle = 137.5;
      const hue = ((idx * goldenAngle) % 360) / 360;
      const defaultColor = new THREE.Color().setHSL(hue, 0.75, 0.55);
      const points = (hole.points || []).map((p) => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
        const point = new THREE.Vector3(p.x, p.y, p.z);
        point.md = p.md;
        return point;
      });

      if (points.length < 2) {
        if (points.length === 1) {
          const sphereGeom = new THREE.SphereGeometry(5, 12, 12);
          const sphereMat = new THREE.MeshLambertMaterial({ 
            color: defaultColor,
            emissive: defaultColor,
            emissiveIntensity: 0.2
          });
          const sphere = new THREE.Mesh(sphereGeom, sphereMat);
          sphere.position.copy(points[0]);
          sphere.userData = buildHoleUserData(hole);
          this.scene.add(sphere);
          this.drillLines.push(sphere);
          this.drillMeshes.push(sphere);
        }
        return;
      }

      const group = new THREE.Group();
      group.userData = buildHoleUserData(hole);
      const assayIntervals = selectedAssayVariable
        ? this._resolveAssayIntervalsForHole(hole, assayIntervalsByHole)
        : [];

      for (let i = 0; i < points.length - 1; i += 1) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const dir = tmpVec.subVectors(p2, p1);
        const len = dir.length();
        if (len <= 0.001) continue;
        const radius = 2.2;
        const cylinderGeom = new THREE.CylinderGeometry(radius, radius, len, 6, 1, true);
        const segmentColor = this._getSegmentColor({
          selectedAssayVariable,
          assayIntervals,
          assayScale,
          holeId: hole.id,
          segmentIndex: i,
          p1,
          p2
        });
        const cylinderMat = new THREE.MeshLambertMaterial({ 
          color: segmentColor,
          flatShading: true,
          emissive: segmentColor,
          emissiveIntensity: 0.15
        });
        const mesh = new THREE.Mesh(cylinderGeom, cylinderMat);
        mesh.position.copy(p1.clone().addScaledVector(dir, 0.5));
        mesh.quaternion.setFromUnitVectors(up, dir.clone().normalize());
        mesh.userData = buildHoleUserData(hole);
        group.add(mesh);
        this.drillMeshes.push(mesh);
      }

      this.scene.add(group);
      this.drillLines.push(group);
    });

    if (this.camera && this.controls) {
      this.lastBounds = { minX, maxX, minY, maxY, minZ, maxZ };
      if (!preserveView) {
        fitCameraToBounds(this, { minX, maxX, minY, maxY, minZ, maxZ });
      }
    }
  }

  _getSegmentColor({ selectedAssayVariable, assayIntervals, assayScale, holeId, segmentIndex, p1, p2 }) {
    if (!selectedAssayVariable) {
      return randomSegmentColor(holeId, segmentIndex);
    }
    // Special mode: color by presence of any assay data
    if (selectedAssayVariable === '__HAS_ASSAY__') {
      if (!assayIntervals?.length) return new THREE.Color(LOW_ASSAY_GREY);
      const depthRange = getMeasuredDepthRange(p1, p2);
      if (!depthRange) return new THREE.Color(LOW_ASSAY_GREY);
      // Check for ANY overlap with assay intervals
      const hasData = assayIntervals.some((interval) => {
        const from = Number(interval?.from);
        const to = Number(interval?.to);
        if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
        const overlapStart = Math.max(depthRange.segStart, from);
        const overlapEnd = Math.min(depthRange.segEnd, to);
        return overlapEnd > overlapStart;
      });
      return hasData ? new THREE.Color('#ff8c42') : new THREE.Color(LOW_ASSAY_GREY);
    }
    if (!assayIntervals?.length) return new THREE.Color(LOW_ASSAY_GREY);
    const depthRange = getMeasuredDepthRange(p1, p2);
    if (!depthRange) return new THREE.Color(LOW_ASSAY_GREY);
    const value = getWeightedIntervalValue(assayIntervals, depthRange.segStart, depthRange.segEnd);
    return getAssaySegmentColor(value, assayScale);
  }

  _resolveAssayIntervalsForHole(hole, assayIntervalsByHole) {
    if (!assayIntervalsByHole || !hole) return [];
    const holeId = hole.id || hole.holeId;
    if (!holeId) return [];

    // Try exact match first
    const exact = assayIntervalsByHole[holeId];
    if (Array.isArray(exact) && exact.length) return exact;

    // Try normalized (case-insensitive) match
    const normalized = normalizeHoleKey(holeId);
    if (normalized) {
      const byNormalized = assayIntervalsByHole[normalized];
      if (Array.isArray(byNormalized) && byNormalized.length) return byNormalized;
    }

    return [];
  }

  _fitCameraToBounds({ minX, maxX, minY, maxY, minZ, maxZ }) {
    fitCameraToBounds(this, { minX, maxX, minY, maxY, minZ, maxZ });
  }

  recenterCameraToOrigin(distance = 1000) {
    recenterCameraToOrigin(this, distance);
  }

  lookDown(distance = 2000) {
    lookDown(this, distance);
  }

  pan(dx = 0, dy = 0) {
    pan(this, dx, dy);
  }

  dolly(scale = 1.1) {
    dolly(this, scale);
  }

  focusOnLastBounds(padding = 1.2) {
    focusOnLastBounds(this, padding);
  }

  _clearBlocks() {
    this.blocks.forEach((block) => {
      this.scene.remove(block);
      block.geometry.dispose();
      block.material.dispose();
    });
    this.blocks = [];
  }

  setStructuralDiscs(structures, holes, opts = {}) {
    if (!this.scene) return;
    this._clearStructuralDiscs();
    if (!structures?.length || !holes?.length) return;

    // Uniform-sample down to maxDiscs to keep render performance reasonable
    const { maxDiscs = 3000 } = opts;
    let input = structures;
    if (input.length > maxDiscs) {
      const step = input.length / maxDiscs;
      const sampled = [];
      for (let i = 0; i < maxDiscs; i++) {
        sampled.push(input[Math.floor(i * step)]);
      }
      input = sampled;
    }

    const traceRows = holes.flatMap(h => (h.points || []).map(p => ({ ...p, hole_id: h.id })));
    const enriched = computeStructuralPositions(input, traceRows, opts);
    if (!enriched.length) return;
    this.structuralGroup = buildStructuralDiscs(enriched, opts);
    this.scene.add(this.structuralGroup);
    this.structuralGroup.traverse(child => {
      if (child.isMesh) this.structuralMeshes.push(child);
    });
  }

  /**
   * Change the camera field-of-view while keeping the visible scene the same apparent size.
   * FOV is clamped to [FOV_MIN_DEG, FOV_MAX_DEG]. Delegates to setFov in baselode3dCameraControls.
   * @param {number} fovDeg - Desired FOV in degrees
   */
  setCameraFov(fovDeg) {
    setFov(this, fovDeg);
  }

  setStructuralDiscsVisible(visible) {
    if (this.structuralGroup) {
      this.structuralGroup.visible = Boolean(visible);
    }
  }

  _clearStructuralDiscs() {
    if (this.structuralGroup) {
      this.scene.remove(this.structuralGroup);
      this.structuralGroup.traverse(child => {
        if (child.isMesh) {
          child.geometry.dispose();
          child.material.dispose();
        }
      });
      this.structuralGroup = null;
    }
    this.structuralMeshes = [];
  }

  _clearDrillholes() {
    this.drillLines.forEach((line) => {
      this.scene.remove(line);
      if (line.isGroup) {
        line.traverse((child) => {
          if (child.isMesh) {
            child.geometry.dispose();
            child.material.dispose();
          }
        });
      } else if (line.isMesh) {
        line.geometry.dispose();
        line.material.dispose();
      }
    });
    this.drillLines = [];
    this.drillMeshes = [];
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

    this._clearBlocks();
    this._clearDrillholes();
    this._clearStructuralDiscs();

    if (this.controls) this.controls.dispose();
    if (this.flyControls) this.flyControls.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      if (this.container && this.renderer.domElement) {
        this.container.removeChild(this.renderer.domElement);
      }
    }
  }

  setDrillholeClickHandler(handler) {
    this.drillholeClickHandler = handler;
  }

  setControlMode(mode = 'orbit') {
    setControlMode(this, mode);
  }
}

export default Baselode3DScene;

function normalizeHoleKey(value) {
  return `${value ?? ''}`.trim().toLowerCase();
}

function randomSegmentColor(holeId, segmentIndex) {
  const seed = `${holeId ?? ''}:${segmentIndex ?? 0}`;
  const base = seededUnit(seed);
  const band = ((segmentIndex ?? 0) % 14) / 14;
  const hue = (base * 0.15 + band * 0.85) % 1;
  const color = new THREE.Color();
  color.setHSL(hue, 1.0, 0.5);
  return color;
}

function seededUnit(input) {
  const text = `${input ?? ''}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}
