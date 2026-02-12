/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { FlyControls } from 'three/examples/jsm/controls/FlyControls';
import { ViewportGizmo } from 'three-viewport-gizmo';
import { getColorForValue } from '../data/blockModelLoader.js';

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
    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.001, 100000);
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

    // Grid and axes
    const gridHelper = new THREE.GridHelper(5000, 100, 0xcccccc, 0xe0e0e0);
    gridHelper.rotation.x = Math.PI / 2;
    this.scene.add(gridHelper);

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
      this.renderer.render(this.scene, this.camera);
      if (this.gizmo) this.gizmo.render();
    };
    animate();
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
      this._fitCameraToBounds({ minX, maxX, minY, maxY, minZ, maxZ });
    }
  }

  setDrillholes(holes) {
    if (!this.scene) return;

    this._clearDrillholes();
    if (!holes || holes.length === 0) return;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    const tmpVec = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0); // cylinder default axis

    holes.forEach((hole, idx) => {
      const color = new THREE.Color().setHSL((idx / holes.length), 0.6, 0.45);
      const points = (hole.points || []).map((p) => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
        return new THREE.Vector3(p.x, p.y, p.z);
      });

      if (points.length < 2) {
        if (points.length === 1) {
          const sphereGeom = new THREE.SphereGeometry(5, 16, 16);
          const sphereMat = new THREE.MeshStandardMaterial({ color });
          const sphere = new THREE.Mesh(sphereGeom, sphereMat);
          sphere.position.copy(points[0]);
          sphere.userData = { holeId: hole.id, project: hole.project };
          this.scene.add(sphere);
          this.drillLines.push(sphere);
          this.drillMeshes.push(sphere);
        }
        return;
      }

      const group = new THREE.Group();
      group.userData = { holeId: hole.id, project: hole.project };

      for (let i = 0; i < points.length - 1; i += 1) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const dir = tmpVec.subVectors(p2, p1);
        const len = dir.length();
        if (len <= 0.001) continue;
        const radius = 2.5;
        const cylinderGeom = new THREE.CylinderGeometry(radius, radius, len, 10, 1, false);
        const cylinderMat = new THREE.MeshStandardMaterial({ color });
        const mesh = new THREE.Mesh(cylinderGeom, cylinderMat);
        mesh.position.copy(p1.clone().addScaledVector(dir, 0.5));
        mesh.quaternion.setFromUnitVectors(up, dir.clone().normalize());
        mesh.userData = { holeId: hole.id, project: hole.project };
        group.add(mesh);
        this.drillMeshes.push(mesh);
      }

      this.scene.add(group);
      this.drillLines.push(group);
    });

    if (this.camera && this.controls) {
      this.lastBounds = { minX, maxX, minY, maxY, minZ, maxZ };
      this._fitCameraToBounds({ minX, maxX, minY, maxY, minZ, maxZ });
    }
  }

  _fitCameraToBounds({ minX, maxX, minY, maxY, minZ, maxZ }) {
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;
    const maxDim = Math.max(sizeX, sizeY, sizeZ, 1);
    const distance = maxDim * 2;

    this.controls.target.set(centerX, centerY, centerZ);
    this.camera.position.set(centerX + distance, centerY + distance, centerZ + distance);
    this.camera.lookAt(centerX, centerY, centerZ);
    this.controls.update();
  }

  recenterCameraToOrigin(distance = 1000) {
    if (!this.camera || !this.controls) return;
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(distance, distance, distance);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
  }

  lookDown(distance = 2000) {
    if (!this.camera || !this.controls) return;
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, 0, distance);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
  }

  pan(dx = 0, dy = 0) {
    if (!this.controls) return;
    // pan in screen space units (positive x: right, positive y: up)
    if (typeof this.controls.pan === 'function') {
      this.controls.pan(dx, dy);
      this.controls.update();
    }
  }

  dolly(scale = 1.1) {
    if (!this.controls || typeof this.controls.dollyIn !== 'function' || typeof this.controls.dollyOut !== 'function') return;
    if (scale > 1) {
      this.controls.dollyOut(scale);
    } else {
      this.controls.dollyIn(1 / scale);
    }
    this.controls.update();
  }

  focusOnLastBounds(padding = 1.2) {
    if (!this.lastBounds) return;
    const {
      minX, maxX, minY, maxY, minZ, maxZ
    } = this.lastBounds;
    const sizeX = (maxX - minX) * padding;
    const sizeY = (maxY - minY) * padding;
    const sizeZ = (maxZ - minZ) * padding;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const maxDim = Math.max(sizeX, sizeY, sizeZ, 1);
    const distance = maxDim * 2;
    this.controls.target.set(centerX, centerY, centerZ);
    this.camera.position.set(centerX + distance, centerY + distance, centerZ + distance);
    this.camera.lookAt(centerX, centerY, centerZ);
    this.controls.update();
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
    this.controlMode = mode === 'fly' ? 'fly' : 'orbit';
    if (this.controlMode === 'fly') {
      if (this.controls) this.controls.enabled = false;
      if (this.flyControls) this.flyControls.enabled = true;
    } else {
      if (this.flyControls) this.flyControls.enabled = false;
      if (this.controls) {
        this.controls.enabled = true;
        // Align orbit target with current camera forward to avoid jumps when toggling back
        this.camera.getWorldDirection(this._tmpDir);
        const target = this.camera.position.clone().addScaledVector(this._tmpDir, 10);
        this.controls.target.copy(target);
        this.controls.update();
      }
    }
  }
}

export default Baselode3DScene;
