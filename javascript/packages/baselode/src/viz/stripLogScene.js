/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';

/**
 * Default panel width in scene units.
 * @type {number}
 */
export const STRIP_LOG_DEFAULT_PANEL_WIDTH = 20;

/**
 * Default lateral offset from the drillhole collar in scene units.
 * @type {number}
 */
export const STRIP_LOG_DEFAULT_LATERAL_OFFSET = 15;

/**
 * Default line color for the strip log graph.
 * @type {string}
 */
export const STRIP_LOG_DEFAULT_COLOR = '#00bcd4';

/**
 * Normalise strip log options with defaults.
 *
 * @param {object} [options]
 * @returns {{ panelWidth: number, lateralOffset: number, color: string, valueMin: number|null, valueMax: number|null }}
 */
export function normalizeStripLogOptions(options = {}) {
  return {
    panelWidth: options.panelWidth != null ? Number(options.panelWidth) : STRIP_LOG_DEFAULT_PANEL_WIDTH,
    lateralOffset: options.lateralOffset != null ? Number(options.lateralOffset) : STRIP_LOG_DEFAULT_LATERAL_OFFSET,
    color: options.color || STRIP_LOG_DEFAULT_COLOR,
    valueMin: options.valueMin != null ? Number(options.valueMin) : null,
    valueMax: options.valueMax != null ? Number(options.valueMax) : null,
  };
}

/**
 * Compute the vertical extent of a hole's points.
 *
 * Returns `{ topY, botY, height }` where `topY >= botY` (Y = elevation in the
 * scene's coordinate system).  Returns `null` when the extent is degenerate.
 *
 * @param {Array<{x:number, y:number, z:number}>} points
 * @returns {{ topY: number, botY: number, height: number }|null}
 */
export function getHoleVerticalExtent(points) {
  if (!points || points.length < 2) return null;
  let topZ = -Infinity;
  let botZ = Infinity;
  for (const p of points) {
    if (p.z > topZ) topZ = p.z;
    if (p.z < botZ) botZ = p.z;
  }
  const height = topZ - botZ;
  if (height < 0.001) return null;
  return { topZ, botZ, height };
}

/**
 * Map depth/value data pairs onto panel-local 2D coordinates.
 *
 * Panel-local space: X runs left (min value) to right (max value); Y runs top
 * (shallow) to bottom (deep) along the hole direction.  Z = 0.01 offsets the line
 * slightly in front of the panel face.  The caller is responsible for applying the
 * panel's world-space quaternion to these local-space points.
 *
 * @param {number[]} depths      - downhole measured depths for each sample
 * @param {number[]} values
 * @param {number} panelWidth
 * @param {number} panelHeight   - total length of the panel (= hole measured depth at toe)
 * @param {number|null} valueMin - explicit min override (null = auto)
 * @param {number|null} valueMax - explicit max override (null = auto)
 * @param {number|null} depthScale - measured depth at toe used to anchor depth=0 at the
 *   collar and scale positions correctly along the hole.  When null the depths are
 *   auto-scaled between their own min/max (legacy behaviour).
 * @returns {THREE.Vector3[]} panel-local points (Z = 0.01 to sit in front of the panel)
 */
export function buildStripLogLinePoints(depths, values, panelWidth, panelHeight, valueMin, valueMax, depthScale) {
  if (!Array.isArray(depths) || !Array.isArray(values)) return [];

  const len = Math.min(depths.length, values.length);
  const valid = [];
  for (let i = 0; i < len; i++) {
    if (Number.isFinite(depths[i]) && Number.isFinite(values[i])) {
      valid.push({ d: depths[i], v: values[i] });
    }
  }
  if (valid.length < 2) return [];

  // When depthScale is provided, depth 0 = collar and depthScale = toe, so each
  // sample lands at its true position along the hole axis.  Otherwise fall back
  // to auto-scaling across the data's own depth range (legacy behaviour).
  const depthRef = (depthScale != null && depthScale > 0) ? depthScale : null;
  const minDepth = depthRef != null ? 0 : Math.min(...valid.map((p) => p.d));
  const maxDepth = depthRef != null ? depthRef : Math.max(...valid.map((p) => p.d));
  const depthRange = maxDepth - minDepth || 1;

  const autoMin = Math.min(...valid.map((p) => p.v));
  const autoMax = Math.max(...valid.map((p) => p.v));
  const vMin = valueMin != null ? valueMin : autoMin;
  const vMax = valueMax != null ? valueMax : autoMax;
  const valRange = vMax - vMin || 1;

  return valid.map(({ d, v }) => {
    const tDepth = (d - minDepth) / depthRange; // 0=collar → 1=toe
    const tVal = Math.max(0, Math.min(1, (v - vMin) / valRange));
    const localX = -panelWidth / 2 + tVal * panelWidth;
    // localY increases along +holeDir (downhole). Mesh origin is at the collar,
    // so localY = 0 → collar and localY = +panelHeight → toe.
    const localY = tDepth * panelHeight;
    return new THREE.Vector3(localX, localY, 0.01);
  });
}

/**
 * Build a flat ribbon BufferGeometry by extruding a polyline in the XY plane.
 *
 * For each consecutive pair of points a quad is generated perpendicular to the
 * segment direction, giving a solid filled line of the requested half-width.
 * Using a Mesh + MeshBasicMaterial avoids the WebGL line-width restriction and
 * the LineMaterial shader complexity.
 *
 * @param {THREE.Vector3[]} points - Line points in panel-local XY space
 * @param {number} halfWidth - Half the desired ribbon width
 * @returns {THREE.BufferGeometry|null}
 */
function buildLineRibbonGeometry(points, halfWidth) {
  const n = points.length;
  if (n < 2) return null;

  const positions = [];
  const indices = [];
  let vi = 0;

  for (let i = 0; i < n - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) continue;

    // Perpendicular unit vector in XY, scaled to half-width
    const nx = (-dy / len) * halfWidth;
    const ny = (dx / len) * halfWidth;
    const z = 0.01;

    positions.push(
      p1.x + nx, p1.y + ny, z,
      p1.x - nx, p1.y - ny, z,
      p2.x + nx, p2.y + ny, z,
      p2.x - nx, p2.y - ny, z,
    );
    indices.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
    vi += 4;
  }

  if (positions.length === 0) return null;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  return geom;
}

/**
 * Build a Three.js Group containing the strip log trace for one hole.
 *
 * No backing panel or border — just a solid ribbon tracing the assay values
 * floating in scene space beside the hole.  The trace is oriented parallel to
 * the collar→toe axis and offset laterally from the hole by `lateralOffset`
 * scene units.
 *
 * @param {object} hole - Hole object with `id` and `points`
 * @param {object} stripLog - Strip log definition (holeId, depths, values, options)
 * @returns {THREE.Group|null}
 */
export function buildStripLogGroup(hole, stripLog) {
  const points = hole.points || [];
  if (points.length < 2) return null;

  const collar = points[0];
  const toe = points[points.length - 1];

  // Hole axis: collar → toe
  const holeDirRaw = new THREE.Vector3(
    toe.x - collar.x,
    toe.y - collar.y,
    toe.z - collar.z,
  );
  const holeLength = holeDirRaw.length();
  if (holeLength < 0.001) return null;
  const holeDir = holeDirRaw.clone().normalize();

  const opts = normalizeStripLogOptions(stripLog.options);
  const { panelWidth, lateralOffset, color, valueMin, valueMax } = opts;

  // Lateral direction: perpendicular to hole axis, as horizontal as possible
  const worldZ = new THREE.Vector3(0, 0, 1);
  let lateralDir = new THREE.Vector3().crossVectors(holeDir, worldZ);
  if (lateralDir.lengthSq() < 1e-6) {
    lateralDir.set(1, 0, 0);
  } else {
    lateralDir.normalize();
  }

  const panelNormal = new THREE.Vector3().crossVectors(lateralDir, holeDir).normalize();

  // Origin of the trace: collar shifted laterally by the offset
  const traceOrigin = new THREE.Vector3(collar.x, collar.y, collar.z)
    .addScaledVector(lateralDir, lateralOffset);

  // Rotation: local X → lateralDir (value axis), local Y → holeDir (depth axis)
  const rotMatrix = new THREE.Matrix4().makeBasis(lateralDir, holeDir, panelNormal);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

  // Use the hole's measured depth at the toe as the depth scale so that each
  // sample's depth maps to its true position along the hole axis.
  const measuredDepths = points.map((p) => p.md).filter(Number.isFinite);
  const depthScale = measuredDepths.length > 0 ? Math.max(...measuredDepths) : holeLength;

  const linePoints = buildStripLogLinePoints(
    stripLog.depths,
    stripLog.values,
    panelWidth,
    holeLength,
    valueMin,
    valueMax,
    depthScale,
  );

  if (linePoints.length < 2) return null;

  const group = new THREE.Group();
  group.userData = { holeId: hole.id, isStripLog: true };

  const halfWidth = panelWidth * 0.025;
  const ribbonGeom = buildLineRibbonGeometry(linePoints, halfWidth);
  if (!ribbonGeom) return null;

  const ribbonMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    side: THREE.DoubleSide,
  });
  const ribbonMesh = new THREE.Mesh(ribbonGeom, ribbonMat);
  ribbonMesh.position.copy(traceOrigin);
  ribbonMesh.quaternion.copy(quaternion);
  group.add(ribbonMesh);

  return group;
}

/**
 * Add floating 2D strip log panels beside drillholes in the 3D scene.
 *
 * Each entry in `stripLogs` is matched to a hole by `holeId`.  A flat
 * rectangular panel is created for each matched pair and added to the scene
 * beside the corresponding drillhole.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {Array<{id: string, points: Array<{x:number,y:number,z:number}>}>} holes
 *   Hole objects already rendered in the scene (same array passed to setDrillholes).
 * @param {Array<object>} stripLogs - Strip log definitions. Each must contain:
 *   - `holeId` {string}   — must match a `hole.id`
 *   - `depths` {number[]} — downhole depth positions for each sample
 *   - `values` {number[]} — numeric value at each depth
 *   - `options` {object}  — optional display overrides:
 *       - `panelWidth`    {number} scene-unit width of the panel (default 20)
 *       - `lateralOffset` {number} scene-unit offset from the hole (default 15)
 *       - `color`         {string} CSS/hex line colour (default '#00bcd4')
 *       - `valueMin`      {number} explicit minimum value for scaling
 *       - `valueMax`      {number} explicit maximum value for scaling
 */
export function setStripLogs(sceneCtx, holes, stripLogs) {
  if (!sceneCtx.scene) return;

  clearStripLogs(sceneCtx);
  if (!stripLogs || stripLogs.length === 0) return;
  if (!holes || holes.length === 0) return;

  const holeById = new Map();
  holes.forEach((hole) => {
    if (hole.id != null) holeById.set(hole.id, hole);
  });

  stripLogs.forEach((stripLog) => {
    const hole = holeById.get(stripLog.holeId);
    if (!hole) return;

    const group = buildStripLogGroup(hole, stripLog);
    if (!group) return;

    sceneCtx.scene.add(group);
    sceneCtx.stripLogGroups.push(group);
  });
}

/**
 * Remove all strip log panels from the scene and free GPU resources.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 */
export function clearStripLogs(sceneCtx) {
  if (!sceneCtx.stripLogGroups) return;
  sceneCtx.stripLogGroups.forEach((group) => {
    if (sceneCtx.scene) sceneCtx.scene.remove(group);
    group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  });
  sceneCtx.stripLogGroups = [];
}
