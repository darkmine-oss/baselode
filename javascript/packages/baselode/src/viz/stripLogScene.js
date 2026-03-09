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
  let topY = -Infinity;
  let botY = Infinity;
  for (const p of points) {
    if (p.y > topY) topY = p.y;
    if (p.y < botY) botY = p.y;
  }
  const height = topY - botY;
  if (height < 0.001) return null;
  return { topY, botY, height };
}

/**
 * Map depth/value data pairs onto panel-local 2D coordinates.
 *
 * Panel-local space: X runs left (min value) to right (max value); Y runs top
 * (shallow) to bottom (deep).
 *
 * @param {number[]} depths
 * @param {number[]} values
 * @param {number} panelWidth
 * @param {number} panelHeight
 * @param {number|null} valueMin  - explicit min override (null = auto)
 * @param {number|null} valueMax  - explicit max override (null = auto)
 * @returns {THREE.Vector3[]} panel-local points (Z = 0.01 to sit above the panel face)
 */
export function buildStripLogLinePoints(depths, values, panelWidth, panelHeight, valueMin, valueMax) {
  if (!Array.isArray(depths) || !Array.isArray(values)) return [];

  const len = Math.min(depths.length, values.length);
  const valid = [];
  for (let i = 0; i < len; i++) {
    if (Number.isFinite(depths[i]) && Number.isFinite(values[i])) {
      valid.push({ d: depths[i], v: values[i] });
    }
  }
  if (valid.length < 2) return [];

  const minDepth = Math.min(...valid.map((p) => p.d));
  const maxDepth = Math.max(...valid.map((p) => p.d));
  const depthRange = maxDepth - minDepth || 1;

  const autoMin = Math.min(...valid.map((p) => p.v));
  const autoMax = Math.max(...valid.map((p) => p.v));
  const vMin = valueMin != null ? valueMin : autoMin;
  const vMax = valueMax != null ? valueMax : autoMax;
  const valRange = vMax - vMin || 1;

  return valid.map(({ d, v }) => {
    const tDepth = (d - minDepth) / depthRange; // 0=shallow → 1=deep
    const tVal = Math.max(0, Math.min(1, (v - vMin) / valRange));
    const localX = -panelWidth / 2 + tVal * panelWidth;
    const localY = panelHeight / 2 - tDepth * panelHeight; // top=shallow
    return new THREE.Vector3(localX, localY, 0.01);
  });
}

/**
 * Build a Three.js Group containing the strip log panel geometry for one hole.
 *
 * The panel is a flat rectangle placed beside the hole collar, offset in the
 * scene +X direction by `lateralOffset` scene units.  The panel faces +Z
 * (toward the viewer at the default viewpoint) and spans the hole's full
 * vertical extent.
 *
 * @param {object} hole - Hole object with `id` and `points`
 * @param {object} stripLog - Strip log definition (holeId, depths, values, options)
 * @returns {THREE.Group|null}
 */
export function buildStripLogGroup(hole, stripLog) {
  const points = hole.points || [];
  const extent = getHoleVerticalExtent(points);
  if (!extent) return null;

  const { topY, botY, height } = extent;
  const collar = points[0];

  const opts = normalizeStripLogOptions(stripLog.options);
  const { panelWidth, lateralOffset, color, valueMin, valueMax } = opts;

  const panelCenterX = collar.x + lateralOffset + panelWidth / 2;
  const panelCenterY = (topY + botY) / 2;
  const panelCenterZ = collar.z;

  const group = new THREE.Group();
  group.userData = { holeId: hole.id, isStripLog: true };

  // Background panel — PlaneGeometry sits in XY plane, normal = +Z
  const panelGeom = new THREE.PlaneGeometry(panelWidth, height);
  const panelMat = new THREE.MeshBasicMaterial({
    color: 0xf5f5f5,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
  });
  const panelMesh = new THREE.Mesh(panelGeom, panelMat);
  panelMesh.position.set(panelCenterX, panelCenterY, panelCenterZ);
  group.add(panelMesh);

  // Border line loop (slight +Z offset so it renders in front of the panel)
  const hw = panelWidth / 2;
  const hh = height / 2;
  const borderPts = [
    new THREE.Vector3(-hw, hh, 0.005),
    new THREE.Vector3(hw, hh, 0.005),
    new THREE.Vector3(hw, -hh, 0.005),
    new THREE.Vector3(-hw, -hh, 0.005),
    new THREE.Vector3(-hw, hh, 0.005),
  ];
  const borderGeom = new THREE.BufferGeometry().setFromPoints(borderPts);
  const borderMat = new THREE.LineBasicMaterial({ color: 0x888888 });
  const borderLine = new THREE.Line(borderGeom, borderMat);
  borderLine.position.set(panelCenterX, panelCenterY, panelCenterZ);
  group.add(borderLine);

  // Line graph
  const linePoints = buildStripLogLinePoints(
    stripLog.depths,
    stripLog.values,
    panelWidth,
    height,
    valueMin,
    valueMax
  );

  if (linePoints.length >= 2) {
    const lineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(color) });
    const lineMesh = new THREE.Line(lineGeom, lineMat);
    lineMesh.position.set(panelCenterX, panelCenterY, panelCenterZ);
    group.add(lineMesh);
  }

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
