/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { AZIMUTH, DIP } from '../data/datamodel.js';
import { computeStructuralPositions } from '../data/structuralPositions.js';
import { syncSelectables } from './sceneSelectables.js';

const DEFAULT_COLOR_MAP = {
  bedding: '#2563eb',
  foliation: '#16a34a',
  joint: '#9333ea',
  fault: '#dc2626',
  vein: '#f59e0b',
  'shear zone': '#0ea5e9',
  'fault zone': '#ef4444',
};

/**
 * Resolve a color string for a structure type from a color map.
 * @private
 * @param {string|null} structureType
 * @param {Object|null} colorMap
 * @returns {number} THREE.js hex color integer
 */
function resolveColor(structureType, colorMap) {
  const map = colorMap || DEFAULT_COLOR_MAP;
  const key = (structureType || '').toLowerCase().trim();
  const hex = map[key] || '#888888';
  return new THREE.Color(hex).getHex();
}

/**
 * Compute a disc plane normal vector from dip and azimuth in ENU coordinates.
 *
 * Convention: azimuth is clockwise from North, dip is measured from horizontal.
 * The normal points upward (positive Z in elevation-positive convention).
 *
 * @param {number} dip - Dip angle in degrees [0, 90]
 * @param {number} azimuth - Dip direction azimuth in degrees [0, 360)
 * @returns {THREE.Vector3} Unit normal vector in ENU coordinates
 */
export function dipAzimuthToNormal(dip, azimuth) {
  const dipRad = (dip * Math.PI) / 180;
  const azRad = (azimuth * Math.PI) / 180;
  return new THREE.Vector3(
    Math.sin(azRad) * Math.sin(dipRad),  // East component
    Math.cos(azRad) * Math.sin(dipRad),  // North component
    Math.cos(dipRad)                       // Up component
  ).normalize();
}

/**
 * Build Three.js disc meshes for structural measurements.
 *
 * Each structural measurement with valid 3D coordinates is rendered as a
 * thin cylinder (disc) oriented perpendicular to the plane normal derived
 * from the dip/azimuth values.
 *
 * userData is set on each mesh for hover/picking support.
 *
 * @param {Array<Object>} structures - Each row must have x/easting, y/northing, z/elevation,
 *                                     dip, and azimuth fields.
 * @param {Object} opts
 * @param {number} [opts.radius=5] - Disc radius in scene units
 * @param {number} [opts.discThickness=0.2] - Disc thickness in scene units
 * @param {number} [opts.opacity=0.7] - Material opacity [0, 1]
 * @param {number} [opts.segments=32] - Cylinder radial segments (higher = smoother)
 * @param {Object|null} [opts.colorMap] - Map from defect string to hex color string
 * @returns {THREE.Group} Group containing one Mesh per valid measurement
 */
export function buildStructuralDiscs(structures, opts = {}) {
  const {
    radius = 5,
    discThickness = 0.2,
    opacity = 0.7,
    segments = 32,
    colorMap = null,
  } = opts;

  const group = new THREE.Group();
  const yAxis = new THREE.Vector3(0, 1, 0);

  for (const s of structures) {
    const xVal = s.x != null ? s.x : (s.easting != null ? s.easting : null);
    const yVal = s.y != null ? s.y : (s.northing != null ? s.northing : null);
    const zVal = s.z != null ? s.z : (s.elevation != null ? s.elevation : null);

    if (xVal == null || yVal == null || zVal == null) continue;
    if (!Number.isFinite(xVal) || !Number.isFinite(yVal) || !Number.isFinite(zVal)) continue;

    const dipVal = s[DIP] != null ? Number(s[DIP]) : null;
    const azVal = s[AZIMUTH] != null ? Number(s[AZIMUTH]) : null;

    let normal;
    if (s.nx != null && Number.isFinite(s.nx) && s.ny != null && Number.isFinite(s.ny) && s.nz != null && Number.isFinite(s.nz)) {
      normal = new THREE.Vector3(s.nx, s.ny, s.nz).normalize();
    } else {
      if (dipVal == null || azVal == null || !Number.isFinite(dipVal) || !Number.isFinite(azVal)) continue;
      normal = dipAzimuthToNormal(dipVal, azVal);
    }

    const geom = new THREE.CylinderGeometry(radius, radius, discThickness, segments, 1, false);
    const mat = new THREE.MeshStandardMaterial({
      color: resolveColor(s['structure_type'], colorMap),
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(xVal, yVal, zVal);

    // CylinderGeometry default axis is Y; rotate so Y aligns with normal
    mesh.quaternion.setFromUnitVectors(yAxis, normal);

    mesh.userData = {
      type: 'structure',
      hole_id: s.hole_id,
      depth: s.depth ?? s.mid,
      structure_type: s['structure_type'],
      dip: dipVal,
      azimuth: azVal,
      comments: s.comments,
    };

    group.add(mesh);
  }

  return group;
}

// ---------------------------------------------------------------------------
// Scene-level functions (operate on a Baselode3DScene instance)
// ---------------------------------------------------------------------------

/**
 * Compute positions for structural measurements and add disc meshes to the scene.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {Array} structures - Structural measurement rows
 * @param {Array} holes - Desurveyed hole objects with `points`
 * @param {object} [opts]
 * @param {number} [opts.maxDiscs=3000] - Cap on rendered discs for performance
 */
export function setStructuralDiscs(sceneCtx, structures, holes, opts = {}) {
  if (!sceneCtx.scene) return;
  clearStructuralDiscs(sceneCtx);
  if (!structures?.length || !holes?.length) return;

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

  sceneCtx.structuralGroup = buildStructuralDiscs(enriched, opts);
  sceneCtx.scene.add(sceneCtx.structuralGroup);
  sceneCtx.structuralGroup.traverse(child => {
    if (child.isMesh) sceneCtx.structuralMeshes.push(child);
  });
  syncSelectables(sceneCtx);
}

/**
 * Remove all structural disc meshes from the scene and dispose GPU resources.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 */
export function clearStructuralDiscs(sceneCtx) {
  if (sceneCtx.structuralGroup) {
    sceneCtx.scene.remove(sceneCtx.structuralGroup);
    sceneCtx.structuralGroup.traverse(child => {
      if (child.isMesh) {
        child.geometry.dispose();
        child.material.dispose();
      }
    });
    sceneCtx.structuralGroup = null;
  }
  sceneCtx.structuralMeshes = [];
  syncSelectables(sceneCtx);
}

/**
 * Show or hide the structural discs group.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {boolean} visible
 */
export function setStructuralDiscsVisible(sceneCtx, visible) {
  if (sceneCtx.structuralGroup) {
    sceneCtx.structuralGroup.visible = Boolean(visible);
  }
}
