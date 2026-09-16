/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { applySpritePixelSize, createPivotSprite, createTextSprite, disposeSprite } from './sceneSprites.js';

/**
 * Visual anchors that give the eye something to hold on to in a scene with
 * no surfaces: a fading ground grid at a datum elevation, a hairline extent
 * box with its dimensions written on it, and an orbit-pivot marker.
 */

/**
 * Round a length to a "nice" 1 / 2 / 5 × 10^k value.
 * @param {number} value
 * @returns {number}
 */
export function niceNumber(value) {
  if (!(value > 0)) return 1;
  const exp = Math.floor(Math.log10(value));
  const f = value / Math.pow(10, exp);
  const nice = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return nice * Math.pow(10, exp);
}

/**
 * Format a length in metres for labels.
 */
export function formatMetres(value) {
  if (!Number.isFinite(value)) return '';
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 2)} km`;
  if (Math.abs(value) >= 100) return `${Math.round(value)} m`;
  if (Math.abs(value) >= 10) return `${value.toFixed(1)} m`;
  return `${value.toFixed(2)} m`;
}

/**
 * Describe the grid for a set of bounds: datum elevation, spacing and fade.
 * @param {{minX:number,maxX:number,minY:number,maxY:number,minZ:number,maxZ:number}} bounds
 * @param {object} [opts]
 * @param {number} [opts.elevation] - explicit datum; defaults to the top of the bounds (collars)
 * @param {number} [opts.spacing] - explicit spacing; defaults to a nice ~1/10 of the extent
 */
export function describeGrid(bounds, opts = {}) {
  const sizeX = bounds.maxX - bounds.minX;
  const sizeY = bounds.maxY - bounds.minY;
  const sizeZ = bounds.maxZ - bounds.minZ;
  const maxDim = Math.max(sizeX, sizeY, sizeZ, 1);
  const planDim = Math.max(sizeX, sizeY, 1);
  return {
    center: new THREE.Vector3((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0),
    elevation: Number.isFinite(opts.elevation) ? opts.elevation : bounds.maxZ,
    spacing: Number.isFinite(opts.spacing) && opts.spacing > 0 ? opts.spacing : niceNumber(planDim / 10),
    fadeRadius: planDim * 1.1 + maxDim * 0.3,
    planeSize: (planDim * 1.1 + maxDim * 0.3) * 2.2,
    maxDim,
  };
}

/**
 * Create a fading ground grid mesh.
 * @param {object} grid - from describeGrid
 * @param {object} [opts]
 * @param {boolean} [opts.dark=false]
 * @param {number} [opts.majorEvery=5]
 * @returns {THREE.Mesh}
 */
export function createGroundGrid(grid, opts = {}) {
  const geom = new THREE.PlaneGeometry(grid.planeSize, grid.planeSize, 1, 1);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSpacing: { value: grid.spacing },
      uMajorEvery: { value: opts.majorEvery ?? 5 },
      uColor: { value: new THREE.Color(opts.dark ? 0xb5b3c8 : 0x4b5563) },
      // Phase of the grid centre within one cell (computed in float64 here)
      // so lines sit on absolute multiples of the spacing without pushing
      // multi-million-metre coordinates through float32 in the shader.
      uPhase: { value: new THREE.Vector2(mod(grid.center.x, grid.spacing), mod(grid.center.y, grid.spacing)) },
      uFadeRadius: { value: grid.fadeRadius },
      uOpacity: { value: opts.dark ? 0.55 : 0.5 },
    },
    vertexShader: `
      varying vec2 vLocal;
      void main() {
        vLocal = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uSpacing;
      uniform float uMajorEvery;
      uniform vec3 uColor;
      uniform vec2 uPhase;
      uniform float uFadeRadius;
      uniform float uOpacity;
      varying vec2 vLocal;
      float gridLine(vec2 coord) {
        vec2 d = fwidth(coord);
        vec2 g = abs(fract(coord - 0.5) - 0.5) / max(d, vec2(1e-6));
        float line = min(g.x, g.y);
        return 1.0 - min(line, 1.0);
      }
      void main() {
        vec2 p = vLocal + uPhase;
        vec2 minorCoord = p / uSpacing;
        float minor = gridLine(minorCoord);
        float major = gridLine(p / (uSpacing * uMajorEvery));
        // Drop minor lines as they crowd together on screen.
        vec2 density = fwidth(minorCoord);
        float minorFade = 1.0 - smoothstep(0.04, 0.12, max(density.x, density.y));
        float dist = length(vLocal) / uFadeRadius;
        float fade = 1.0 - smoothstep(0.2, 0.9, dist);
        float a = max(minor * 0.22 * minorFade, major * 0.75) * fade * uOpacity;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geom, material);
  mesh.position.set(grid.center.x, grid.center.y, grid.elevation);
  mesh.renderOrder = -10;
  mesh.name = 'baselode-ground-grid';
  mesh.userData.grid = grid;
  return mesh;
}

function mod(a, n) {
  return ((a % n) + n) % n;
}

/**
 * Create a hairline extent box with three dimension labels.
 * @param {object} bounds
 * @param {object} [opts]
 * @param {boolean} [opts.dark=false]
 * @returns {THREE.Group}
 */
export function createExtentBox(bounds, opts = {}) {
  const group = new THREE.Group();
  group.name = 'baselode-extent-box';
  const box = new THREE.Box3(
    new THREE.Vector3(bounds.minX, bounds.minY, bounds.minZ),
    new THREE.Vector3(bounds.maxX, bounds.maxY, bounds.maxZ),
  );
  const helper = new THREE.Box3Helper(box, new THREE.Color(opts.dark ? 0x8f8daa : 0x64748b));
  helper.material.transparent = true;
  helper.material.opacity = 0.55;
  helper.material.toneMapped = false;
  group.add(helper);

  const style = opts.dark
    ? { color: '#e6e6f0', background: 'rgba(20,20,28,0.7)', border: 'rgba(255,255,255,0.2)' }
    : { color: '#334155', background: 'rgba(255,255,255,0.8)', border: 'rgba(15,23,42,0.2)' };
  const sizeX = bounds.maxX - bounds.minX;
  const sizeY = bounds.maxY - bounds.minY;
  const sizeZ = bounds.maxZ - bounds.minZ;
  const labels = [
    { text: `E ${formatMetres(sizeX)}`, pos: [(bounds.minX + bounds.maxX) / 2, bounds.minY, bounds.minZ] },
    { text: `N ${formatMetres(sizeY)}`, pos: [bounds.minX, (bounds.minY + bounds.maxY) / 2, bounds.minZ] },
    { text: `RL ${formatMetres(sizeZ)}`, pos: [bounds.minX, bounds.minY, (bounds.minZ + bounds.maxZ) / 2] },
  ];
  labels.forEach((l) => {
    const s = createTextSprite(l.text, { fontSize: 11, ...style });
    if (!s) return;
    s.position.set(l.pos[0], l.pos[1], l.pos[2]);
    group.add(s);
  });
  return group;
}

/**
 * Create the orbit-pivot marker.  Call updatePivotIndicator each frame.
 * @param {object} [opts]
 * @param {string} [opts.color]
 * @returns {THREE.Sprite|null}
 */
export function createPivotIndicator(opts = {}) {
  return createPivotSprite(opts.color || '#8c2981');
}

/**
 * Animate the pivot marker's opacity and keep it a constant pixel size at the
 * orbit target.
 * @param {THREE.Sprite} sprite
 * @param {object} args
 * @param {THREE.Vector3} args.target
 * @param {THREE.Camera} args.camera
 * @param {number} args.viewportHeight
 * @param {boolean} args.active - true while the user is interacting
 * @param {number} args.dt - seconds since last frame
 */
export function updatePivotIndicator(sprite, { target, camera, viewportHeight, active, dt }) {
  if (!sprite) return;
  const goal = active ? 0.95 : 0;
  const rate = active ? 12 : 4;
  const o = sprite.material.opacity + (goal - sprite.material.opacity) * Math.min(1, rate * (dt || 0.016));
  sprite.material.opacity = Math.abs(o - goal) < 0.005 ? goal : o;
  sprite.visible = sprite.material.opacity > 0.01;
  if (!sprite.visible) return;
  sprite.position.copy(target);
  applySpritePixelSize(sprite, camera, viewportHeight, 30);
}

/**
 * Keep extent-box dimension labels at a constant pixel size.
 */
export function updateExtentLabels(group, camera, viewportHeight) {
  if (!group || !group.visible) return;
  group.children.forEach((child) => {
    if (child.isSprite) applySpritePixelSize(child, camera, viewportHeight, 16);
  });
}

/**
 * Dispose any anchor object created above.
 */
export function disposeAnchor(obj) {
  if (!obj) return;
  obj.traverse((child) => {
    if (child.isSprite) { disposeSprite(child); return; }
    child.geometry?.dispose?.();
    child.material?.dispose?.();
  });
}
