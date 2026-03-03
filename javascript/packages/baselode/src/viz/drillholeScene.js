/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { buildEqualRangeColorScale, getEqualRangeBinIndex, getEqualRangeColor } from './assayColorScale.js';
import { fitCameraToBounds } from './baselode3dCameraControls.js';
import { syncSelectables } from './sceneSelectables.js';

/** Default color for low or zero assay values */
const LOW_ASSAY_GREY = '#9ca3af';

/**
 * Get measured depth range for a segment between two points
 */
export function getMeasuredDepthRange(p1, p2) {
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
 */
export function getWeightedIntervalValue(assayIntervals, segStart, segEnd) {
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
 */
export function getAssaySegmentColor(value, assayScale) {
  if (!Number.isFinite(value)) return new THREE.Color(LOW_ASSAY_GREY);
  const binIndex = getEqualRangeBinIndex(value, assayScale);
  if (binIndex < 0) return new THREE.Color(LOW_ASSAY_GREY);
  const colorHex = getEqualRangeColor(value, assayScale, LOW_ASSAY_GREY);
  return new THREE.Color(colorHex);
}

/**
 * Get a deterministic hex color for a categorical value using FNV-1a hash → HSL
 */
export function getCategoryHexColor(category) {
  if (!category || !String(category).trim()) return LOW_ASSAY_GREY;
  const h = seededUnit(String(category).toLowerCase().trim());
  return '#' + new THREE.Color().setHSL(h, 0.70, 0.50).getHexString();
}

/**
 * Normalize drillhole rendering options with defaults
 */
export function normalizeDrillholeRenderOptions(options = {}) {
  return {
    preserveView: Boolean(options.preserveView),
    assayIntervalsByHole: options.assayIntervalsByHole || null,
    selectedAssayVariable: options.selectedAssayVariable || '',
    isCategoricalVariable: Boolean(options.isCategoricalVariable),
  };
}

/**
 * Collect all numeric assay values from interval data
 */
export function collectAssayValues(assayIntervalsByHole, selectedAssayVariable) {
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
 */
export function buildHoleUserData(hole) {
  return {
    holeId: hole.id,
    project: hole.project
  };
}

/**
 * Normalize hole key to lowercase trimmed string for case-insensitive matching
 */
export function normalizeHoleKey(value) {
  return `${value ?? ''}`.trim().toLowerCase();
}

/**
 * Generate a deterministic per-segment color based on hole ID and segment index
 */
export function randomSegmentColor(holeId, segmentIndex) {
  const seed = `${holeId ?? ''}:${segmentIndex ?? 0}`;
  const base = seededUnit(seed);
  const band = ((segmentIndex ?? 0) % 14) / 14;
  const hue = (base * 0.15 + band * 0.85) % 1;
  const color = new THREE.Color();
  color.setHSL(hue, 1.0, 0.5);
  return color;
}

/**
 * Produce a deterministic float in [0, 1) from an input string (FNV-1a hash)
 */
export function seededUnit(input) {
  const text = `${input ?? ''}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

// ---------------------------------------------------------------------------
// Private helpers (not exported)
// ---------------------------------------------------------------------------

function getDominantCategory(intervals, segStart, segEnd) {
  let best = null;
  let bestOverlap = 0;
  for (const iv of intervals) {
    const from = Number(iv?.from);
    const to = Number(iv?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const overlap = Math.min(segEnd, to) - Math.max(segStart, from);
    if (overlap > bestOverlap) { bestOverlap = overlap; best = iv?.value; }
  }
  return best;
}

function resolveAssayIntervalsForHole(hole, assayIntervalsByHole) {
  if (!assayIntervalsByHole || !hole) return [];
  const holeId = hole.id || hole.holeId;
  if (!holeId) return [];

  const exact = assayIntervalsByHole[holeId];
  if (Array.isArray(exact) && exact.length) return exact;

  const normalized = normalizeHoleKey(holeId);
  if (normalized) {
    const byNormalized = assayIntervalsByHole[normalized];
    if (Array.isArray(byNormalized) && byNormalized.length) return byNormalized;
  }

  return [];
}

function getSegmentColor({ selectedAssayVariable, assayIntervals, assayScale, holeId, segmentIndex, p1, p2, isCategorical }) {
  if (!selectedAssayVariable) {
    return randomSegmentColor(holeId, segmentIndex);
  }
  if (selectedAssayVariable === '__HAS_ASSAY__') {
    if (!assayIntervals?.length) return new THREE.Color(LOW_ASSAY_GREY);
    const depthRange = getMeasuredDepthRange(p1, p2);
    if (!depthRange) return new THREE.Color(LOW_ASSAY_GREY);
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
  if (isCategorical) {
    const cat = getDominantCategory(assayIntervals, depthRange.segStart, depthRange.segEnd);
    return new THREE.Color(getCategoryHexColor(cat));
  }
  const value = getWeightedIntervalValue(assayIntervals, depthRange.segStart, depthRange.segEnd);
  return getAssaySegmentColor(value, assayScale);
}

// ---------------------------------------------------------------------------
// Public scene functions
// ---------------------------------------------------------------------------

/**
 * Build cylinder meshes for all drillholes and add them to the scene.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {Array} holes - Array of desurveyed hole objects with `points`
 * @param {object} [options]
 */
export function setDrillholes(sceneCtx, holes, options = {}) {
  if (!sceneCtx.scene) return;

  clearDrillholes(sceneCtx);
  if (!holes || holes.length === 0) return;

  const { preserveView, assayIntervalsByHole, selectedAssayVariable, isCategoricalVariable } = normalizeDrillholeRenderOptions(options);
  const allAssayValues = isCategoricalVariable ? [] : collectAssayValues(assayIntervalsByHole, selectedAssayVariable);
  const assayScale = buildEqualRangeColorScale(allAssayValues);

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  const tmpVec = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  holes.forEach((hole, idx) => {
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
        sceneCtx.scene.add(sphere);
        sceneCtx.drillLines.push(sphere);
        sceneCtx.drillMeshes.push(sphere);
      }
      return;
    }

    const group = new THREE.Group();
    group.userData = buildHoleUserData(hole);
    const assayIntervals = selectedAssayVariable
      ? resolveAssayIntervalsForHole(hole, assayIntervalsByHole)
      : [];

    for (let i = 0; i < points.length - 1; i += 1) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const dir = tmpVec.subVectors(p2, p1);
      const len = dir.length();
      if (len <= 0.001) continue;
      const radius = 2.2;
      const cylinderGeom = new THREE.CylinderGeometry(radius, radius, len, 6, 1, true);
      const segmentColor = getSegmentColor({
        selectedAssayVariable,
        assayIntervals,
        assayScale,
        holeId: hole.id,
        segmentIndex: i,
        p1,
        p2,
        isCategorical: isCategoricalVariable,
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
      sceneCtx.drillMeshes.push(mesh);
    }

    sceneCtx.scene.add(group);
    sceneCtx.drillLines.push(group);
  });

  if (sceneCtx.camera && sceneCtx.controls) {
    sceneCtx.lastBounds = { minX, maxX, minY, maxY, minZ, maxZ };
    if (!preserveView) {
      fitCameraToBounds(sceneCtx, { minX, maxX, minY, maxY, minZ, maxZ });
    }
  }
  syncSelectables(sceneCtx);
}

/**
 * Remove all drillhole meshes from the scene and dispose GPU resources.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 */
export function clearDrillholes(sceneCtx) {
  sceneCtx.drillLines.forEach((line) => {
    sceneCtx.scene.remove(line);
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
  sceneCtx.drillLines = [];
  sceneCtx.drillMeshes = [];
  syncSelectables(sceneCtx);
}
