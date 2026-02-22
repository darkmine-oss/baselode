/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { AZIMUTH, DIP, STRUCTURE_TYPE } from '../data/datamodel.js';

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
 * @param {Object|null} [opts.colorMap] - Map from structure_type string to hex color string
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
    const x = s.x ?? s.easting ?? s[STRUCTURE_TYPE];  // fallback chain
    const xVal = s.x != null ? s.x : (s.easting != null ? s.easting : null);
    const yVal = s.y != null ? s.y : (s.northing != null ? s.northing : null);
    const zVal = s.z != null ? s.z : (s.elevation != null ? s.elevation : null);
    const dip = s[DIP] != null ? Number(s[DIP]) : null;
    const az = s[AZIMUTH] != null ? Number(s[AZIMUTH]) : null;

    if (xVal == null || yVal == null || zVal == null || dip == null || az == null) continue;
    if (!Number.isFinite(xVal) || !Number.isFinite(yVal) || !Number.isFinite(zVal)) continue;
    if (!Number.isFinite(dip) || !Number.isFinite(az)) continue;

    const normal = dipAzimuthToNormal(dip, az);

    const geom = new THREE.CylinderGeometry(radius, radius, discThickness, segments, 1, false);
    const mat = new THREE.MeshStandardMaterial({
      color: resolveColor(s[STRUCTURE_TYPE], colorMap),
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
      structure_type: s[STRUCTURE_TYPE],
      dip,
      azimuth: az,
      comments: s.comments,
    };

    group.add(mesh);
  }

  return group;
}
