/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { FlyControls } from 'three/examples/jsm/controls/FlyControls';
import { ViewportGizmo } from 'three-viewport-gizmo';
import { getColorForValue } from '../data/blockModelLoader.js';
import { buildEqualRangeColorScale, getEqualRangeBinIndex, getEqualRangeColor } from './assayColorScale.js';
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
  setViewState
} from './baselode3dCameraControls.js';

const LOW_ASSAY_GREY = '#9ca3af';

function getMeasuredDepthRange(p1, p2) {
  const md1 = Number(p1?.md);
  const md2 = Number(p2?.md);
  if (!Number.isFinite(md1) || !Number.isFinite(md2)) return null;
  const segStart = Math.min(md1, md2);
  const segEnd = Math.max(md1, md2);
  if (segEnd <= segStart) return null;
  return { segStart, segEnd };
}

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

function getAssaySegmentColor(value, assayScale) {
  if (!Number.isFinite(value) || value <= 0) return new THREE.Color(LOW_ASSAY_GREY);
  const binIndex = getEqualRangeBinIndex(value, assayScale);
  if (binIndex <= 0) return new THREE.Color(LOW_ASSAY_GREY);
  const colorHex = getEqualRangeColor(value, assayScale, LOW_ASSAY_GREY);
  return new THREE.Color(colorHex);
}

function normalizeDrillholeRenderOptions(options = {}) {
  return {
    preserveView: Boolean(options.preserveView),
    assayIntervalsByHole: options.assayIntervalsByHole || null,
    selectedAssayVariable: options.selectedAssayVariable || ''
  };
}

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

function buildHoleUserData(hole) {
  return {
    holeId: hole.id,
    project: hole.project
  };
}

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
    this.frameId = null;
    this.clock = new THREE.Clock();
    this.handleCanvasClick = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.drillholeClickHandler = null;
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

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
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
      const intersects = this.raycaster.intersectObjects(this.drillMeshes, true);
      if (intersects.length === 0) return;
      let obj = intersects[0].object;
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

  setBlocks(data, selectedProperty, stats) {
    if (!this.scene) return;

    this._clearBlocks();

    if (!data || !selectedProperty || !stats) return;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    data.forEach((row) => {
      const {
        center_x = 0,
        center_y = 0,
        center_z = 0,
        size_x = 1,
        size_y = 1,
        size_z = 1
      } = row;

      minX = Math.min(minX, center_x - size_x / 2);
      maxX = Math.max(maxX, center_x + size_x / 2);
      minY = Math.min(minY, center_y - size_y / 2);
      maxY = Math.max(maxY, center_y + size_y / 2);
      minZ = Math.min(minZ, center_z - size_z / 2);
      maxZ = Math.max(maxZ, center_z + size_z / 2);

      const geometry = new THREE.BoxGeometry(size_x, size_y, size_z);
      const color = getColorForValue(row[selectedProperty], stats, THREE);
      const material = new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide
      });

      const block = new THREE.Mesh(geometry, material);
      block.position.set(center_x, center_y, center_z);
      this.scene.add(block);
      this.blocks.push(block);
    });

    if (this.camera && this.controls) {
      this.lastBounds = { minX, maxX, minY, maxY, minZ, maxZ };
      fitCameraToBounds(this, { minX, maxX, minY, maxY, minZ, maxZ });
    }
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
      const defaultColor = new THREE.Color().setHSL((idx / holes.length), 0.6, 0.45);
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
          const sphereGeom = new THREE.SphereGeometry(5, 16, 16);
          const sphereMat = new THREE.MeshStandardMaterial({ color: defaultColor });
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
        const radius = 2.5;
        const cylinderGeom = new THREE.CylinderGeometry(radius, radius, len, 10, 1, false);
        const segmentColor = this._getSegmentColor({
          selectedAssayVariable,
          assayIntervals,
          assayScale,
          holeId: hole.id,
          segmentIndex: i,
          p1,
          p2
        });
        const cylinderMat = new THREE.MeshStandardMaterial({ color: segmentColor });
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
