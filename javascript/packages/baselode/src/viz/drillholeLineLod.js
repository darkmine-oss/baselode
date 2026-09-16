/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { holeBaseColor, intervalRunsForHole, sampleLayerColorBytes } from './drillholeColorTexture.js';

/**
 * Screen-constant-width polyline representation of the drillhole set, used
 * as the far level of detail.  Colour runs are taken from the same interval
 * texture data as the tube shader, so both representations agree exactly.
 */

/**
 * Interpolate a point on a hole's polyline at a normalised measured depth.
 * @param {object} hole - hole metadata from buildDrillholeTubeGeometry
 * @param {number} t - normalised depth in [0, 1]
 * @param {THREE.Vector3} [out]
 * @returns {THREE.Vector3}
 */
export function pointAtNormalisedDepth(hole, t, out = new THREE.Vector3()) {
  const md = hole.mdMin + Math.min(1, Math.max(0, t)) * hole.length;
  const { points, mds } = hole;
  if (md <= mds[0]) return out.copy(points[0]);
  for (let i = 0; i < mds.length - 1; i += 1) {
    if (md <= mds[i + 1]) {
      const span = mds[i + 1] - mds[i];
      const f = span > 0 ? (md - mds[i]) / span : 0;
      return out.copy(points[i]).lerp(points[i + 1], f);
    }
  }
  return out.copy(points[points.length - 1]);
}

/**
 * Build the line representation for a colour layer.
 * @param {Array<object>} holesMeta
 * @param {object|null} layer - colour layer (null → per-hole base colours)
 * @param {object} [opts]
 * @param {number} [opts.lineWidth=2.5] - pixels
 * @param {THREE.Vector2} [opts.resolution]
 * @param {THREE.Vector3} [opts.origin] - coordinates are stored relative to this point
 * @param {Float32Array} [opts.holeFlags] - RGBA per hole; alpha 0 means ghosted
 * @param {THREE.Color} [opts.ghostColor] - background tint for ghosted holes
 * @param {number} [opts.ghostMix=0.12]
 * @returns {LineSegments2}
 */
export function buildDrillholeLines(holesMeta, layer, opts = {}) {
  const positions = [];
  const colors = [];
  const segmentToHole = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const tmpColor = new THREE.Color();
  const origin = opts.origin || new THREE.Vector3();
  const ghost = opts.ghostColor || new THREE.Color(0xffffff);
  const ghostMix = opts.ghostMix ?? 0.12;

  holesMeta.forEach((hole) => {
    const runs = intervalRunsForHole(layer, hole.index);
    const base = holeBaseColor(hole.index);
    const ghosted = opts.holeFlags ? opts.holeFlags[hole.index * 4 + 3] < 0.5 : false;
    runs.forEach((run) => {
      const [r, g, bb] = sampleLayerColorBytes(layer, hole.index, (run.start + run.end) / 2, base);
      tmpColor.setRGB(r / 255, g / 255, bb / 255, THREE.SRGBColorSpace);
      if (ghosted) tmpColor.lerpColors(ghost, tmpColor, ghostMix);
      // Break the run at survey stations so curved holes stay curved.
      const mdStart = hole.mdMin + run.start * hole.length;
      const mdEnd = hole.mdMin + run.end * hole.length;
      const breakpoints = [run.start];
      for (let i = 1; i < hole.mds.length - 1; i += 1) {
        const md = hole.mds[i];
        if (md > mdStart && md < mdEnd) breakpoints.push((md - hole.mdMin) / hole.length);
      }
      breakpoints.push(run.end);
      for (let i = 0; i < breakpoints.length - 1; i += 1) {
        pointAtNormalisedDepth(hole, breakpoints[i], a);
        pointAtNormalisedDepth(hole, breakpoints[i + 1], b);
        if (a.distanceToSquared(b) < 1e-12) continue;
        positions.push(a.x - origin.x, a.y - origin.y, a.z - origin.z, b.x - origin.x, b.y - origin.y, b.z - origin.z);
        colors.push(tmpColor.r, tmpColor.g, tmpColor.b, tmpColor.r, tmpColor.g, tmpColor.b);
        segmentToHole.push(hole.index);
      }
    });
  });

  const geometry = new LineSegmentsGeometry();
  if (positions.length) {
    geometry.setPositions(positions);
    geometry.setColors(colors);
  }
  const material = new LineMaterial({
    color: 0xffffff,
    vertexColors: true,
    linewidth: opts.lineWidth ?? 2.5,
    worldUnits: false,
    fog: true,
  });
  if (opts.resolution) material.resolution.copy(opts.resolution);
  const lines = new LineSegments2(geometry, material);
  lines.name = 'baselode-drillhole-lines';
  lines.userData.segmentToHole = segmentToHole;
  lines.computeLineDistances?.();
  return lines;
}

/**
 * Dispose a line object produced by buildDrillholeLines.
 */
export function disposeDrillholeLines(lines) {
  if (!lines) return;
  lines.geometry?.dispose?.();
  lines.material?.dispose?.();
}
