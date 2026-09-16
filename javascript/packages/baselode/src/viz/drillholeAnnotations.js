/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { holeBaseColor } from './drillholeColorTexture.js';
import { applySpritePixelSize, createTextSprite, disposeSprite } from './sceneSprites.js';

/**
 * Collar markers, hole-id labels and collar drop lines for the drillhole
 * layer.  All three are cheap: two instanced meshes, one sprite per hole and
 * one line segment per hole.
 */

/**
 * Build collar markers as two instanced meshes (a filled disc in the hole's
 * base colour and a dark ring outline).
 * @param {Array<object>} holesMeta - from buildDrillholeTubeGeometry
 * @param {Array<object>} singlePointHoles - holes with one station only
 * @param {object} [opts]
 * @param {number} [opts.radius=3] - disc radius in scene units
 * @param {boolean} [opts.dark=false] - dark background palette
 * @param {THREE.Vector3} [opts.origin] - positions are stored relative to this point
 * @returns {THREE.Group}
 */
export function buildCollarMarkers(holesMeta, singlePointHoles = [], opts = {}) {
  const radius = Math.max(opts.radius ?? 3, 1e-3);
  const origin = opts.origin || new THREE.Vector3();
  const entries = [
    ...holesMeta.map((h) => ({ point: h.collar, index: h.index, id: h.id, project: h.project, mdMin: h.mdMin })),
    ...singlePointHoles.map((h, i) => ({ point: h.point, index: -1, colorIndex: holesMeta.length + i, id: h.id, project: h.project, mdMin: 0 })),
  ];
  const group = new THREE.Group();
  group.name = 'baselode-collar-markers';
  if (!entries.length) return group;

  const disc = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 28),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }),
    entries.length,
  );
  const ring = new THREE.InstancedMesh(
    new THREE.RingGeometry(0.82, 1, 28),
    new THREE.MeshBasicMaterial({ color: opts.dark ? 0xf5f5f7 : 0x1f2937, side: THREE.DoubleSide, toneMapped: false }),
    entries.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(radius, radius, radius);
  const ringScale = new THREE.Vector3(radius * 1.25, radius * 1.25, radius * 1.25);
  const lift = new THREE.Vector3(0, 0, radius * 0.05);
  entries.forEach((e, i) => {
    const p = e.point.clone().sub(origin).add(lift);
    m.compose(p, q, s);
    disc.setMatrixAt(i, m);
    disc.setColorAt(i, holeBaseColor(e.colorIndex ?? e.index));
    m.compose(p, q, ringScale);
    ring.setMatrixAt(i, m);
  });
  disc.instanceMatrix.needsUpdate = true;
  if (disc.instanceColor) disc.instanceColor.needsUpdate = true;
  ring.instanceMatrix.needsUpdate = true;
  ring.renderOrder = 2;
  disc.renderOrder = 3;
  disc.userData.collarEntries = entries;
  disc.userData.isCollarDiscs = true;
  group.add(ring, disc);
  return group;
}

/**
 * Raycast the collar discs.  Returns the nearest collar hit with its entry
 * (works for single-station holes that have no tube).
 * @param {THREE.Group} markerGroup
 * @param {THREE.Raycaster} raycaster
 * @returns {{entry: object, point: THREE.Vector3, distance: number}|null}
 */
export function pickCollar(markerGroup, raycaster) {
  if (!markerGroup?.visible) return null;
  const disc = markerGroup.children.find((c) => c.userData?.isCollarDiscs);
  if (!disc) return null;
  const hits = [];
  disc.raycast(raycaster, hits);
  if (!hits.length) return null;
  hits.sort((x, y) => x.distance - y.distance);
  const hit = hits[0];
  const entry = disc.userData.collarEntries[hit.instanceId];
  return entry ? { entry, point: hit.point, distance: hit.distance } : null;
}

/**
 * Build one hole-id label sprite per hole, hovering above the collar.
 * @param {Array<object>} holesMeta
 * @param {Array<object>} singlePointHoles
 * @param {object} [opts]
 * @param {number} [opts.lift=6] - vertical offset above the collar
 * @param {boolean} [opts.dark=false]
 * @param {THREE.Vector3} [opts.origin] - positions are stored relative to this point
 * @returns {THREE.Group}
 */
export function buildHoleLabels(holesMeta, singlePointHoles = [], opts = {}) {
  const group = new THREE.Group();
  group.name = 'baselode-hole-labels';
  const lift = opts.lift ?? 6;
  const origin = opts.origin || new THREE.Vector3();
  const style = opts.dark
    ? { color: '#f5f5f7', background: 'rgba(20,20,28,0.78)', border: 'rgba(255,255,255,0.25)' }
    : { color: '#1f2937', background: 'rgba(255,255,255,0.86)', border: 'rgba(15,23,42,0.25)' };
  const entries = [
    ...holesMeta.map((h) => ({ point: h.collar, id: h.id })),
    ...singlePointHoles.map((h) => ({ point: h.point, id: h.id })),
  ];
  entries.forEach((e) => {
    const sprite = createTextSprite(e.id, { fontSize: 11, ...style });
    if (!sprite) return;
    sprite.position.copy(e.point).sub(origin).add(new THREE.Vector3(0, 0, lift));
    sprite.userData.anchor = e.point.clone();
    sprite.userData.holeId = e.id;
    group.add(sprite);
  });
  return group;
}

/**
 * Vertical drop lines from each collar down (or up) to a datum elevation.
 * Useful when the ground grid sits at a different elevation to the collars.
 * @param {Array<object>} holesMeta
 * @param {Array<object>} singlePointHoles
 * @param {number} datumZ
 * @param {object} [opts]
 * @param {boolean} [opts.dark=false]
 * @param {THREE.Vector3} [opts.origin] - positions are stored relative to this point
 * @returns {THREE.LineSegments|null}
 */
export function buildCollarDropLines(holesMeta, singlePointHoles, datumZ, opts = {}) {
  if (!Number.isFinite(datumZ)) return null;
  const pts = [];
  const origin = opts.origin || new THREE.Vector3();
  const push = (p) => {
    if (Math.abs(p.z - datumZ) < 1e-3) return;
    pts.push(p.x - origin.x, p.y - origin.y, p.z - origin.z, p.x - origin.x, p.y - origin.y, datumZ - origin.z);
  };
  holesMeta.forEach((h) => push(h.collar));
  singlePointHoles.forEach((h) => push(h.point));
  if (!pts.length) return null;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({ color: opts.dark ? 0x9a9ab0 : 0x6b7280, transparent: true, opacity: 0.45, toneMapped: false });
  const lines = new THREE.LineSegments(geom, mat);
  lines.name = 'baselode-collar-drop-lines';
  return lines;
}

/**
 * Per-frame update: keep labels a constant pixel size and fade them out with
 * distance so a dense project does not become a wall of text.
 * @param {THREE.Group} labelGroup
 * @param {THREE.Camera} camera
 * @param {number} viewportHeight
 * @param {object} [opts]
 * @param {number} [opts.pixelHeight=18]
 * @param {number} [opts.fadeStart] - distance where fading starts
 * @param {number} [opts.fadeEnd] - distance where labels vanish
 * @param {THREE.Vector3} [opts.origin] - the group's world offset (sprite positions are local)
 */
export function updateLabelSprites(labelGroup, camera, viewportHeight, opts = {}) {
  if (!labelGroup || !labelGroup.visible || !camera) return;
  const px = opts.pixelHeight ?? 18;
  const fadeStart = opts.fadeStart ?? Infinity;
  const fadeEnd = opts.fadeEnd ?? Infinity;
  const camPos = opts.origin ? camera.position.clone().sub(opts.origin) : camera.position;
  const ortho = Boolean(camera.isOrthographicCamera);
  labelGroup.children.forEach((sprite) => {
    applySpritePixelSize(sprite, camera, viewportHeight, px);
    if (ortho || !Number.isFinite(fadeStart)) {
      sprite.material.opacity = 1;
      sprite.visible = true;
      return;
    }
    const d = camPos.distanceTo(sprite.position);
    const o = d <= fadeStart ? 1 : d >= fadeEnd ? 0 : 1 - (d - fadeStart) / (fadeEnd - fadeStart);
    sprite.material.opacity = o;
    sprite.visible = o > 0.02;
  });
}

/**
 * Dispose a group produced by the builders above.
 */
export function disposeAnnotationGroup(obj) {
  if (!obj) return;
  obj.traverse((child) => {
    if (child.isSprite) { disposeSprite(child); return; }
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
    else child.material?.dispose?.();
  });
}
