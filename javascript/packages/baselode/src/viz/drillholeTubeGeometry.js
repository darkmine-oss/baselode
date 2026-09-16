/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';

/**
 * Build a single merged tube geometry for a set of desurveyed drillholes.
 *
 * Every hole becomes one continuous tube: a ring of `radialSegments` vertices
 * at each survey station, rings shared between adjacent segments (so joints
 * are seamless), plus a cap at the collar and at end-of-hole.  All holes are
 * packed into one BufferGeometry so the whole set draws in a single call.
 *
 * Per-vertex attributes carry everything the drillhole shader needs to colour
 * and resize the tube without touching the geometry again:
 *
 *   - `position`  baked centre + radial * radius (kept in sync for raycasting)
 *   - `normal`    smooth radial normal (cap vertices use the tangent)
 *   - `aCentre`   centreline point the vertex belongs to
 *   - `aRadial`   unit radial direction (zero for cap centre vertices)
 *   - `aHole`     hole index into the returned `holes` metadata array
 *   - `aMdNorm`   measured depth normalised to [0, 1] along the hole
 *
 * @param {Array<{id?: string, project?: string, points: Array<{x:number,y:number,z:number,md?:number}>}>} holes
 * @param {object} [options]
 * @param {number} [options.radialSegments=8] - vertices per ring
 * @param {number} [options.radius=1] - initial tube radius in scene units
 * @returns {{ geometry: THREE.BufferGeometry|null, holes: Array<object>, bounds: object|null, singlePointHoles: Array<object>, origin: THREE.Vector3 }}
 *   `holes` metadata (collar, eoh, points, sphere) stays in world coordinates;
 *   geometry attributes are relative to `origin`.
 */
export function buildDrillholeTubeGeometry(holes, options = {}) {
  const radialSegments = Math.max(3, Math.floor(options.radialSegments ?? 8));
  const radius = Number.isFinite(options.radius) && options.radius > 0 ? options.radius : 1;

  const prepared = [];
  const singlePointHoles = [];
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  (holes || []).forEach((hole, sourceIndex) => {
    const pts = cleanPoints(hole?.points);
    pts.forEach((p) => {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    });
    if (pts.length === 0) return;
    if (pts.length === 1) {
      singlePointHoles.push({ id: hole.id ?? hole.holeId ?? `hole-${sourceIndex}`, project: hole.project, point: pts[0], sourceIndex });
      return;
    }
    prepared.push({ hole, pts, sourceIndex });
  });

  const bounds = Number.isFinite(minX) ? { minX, maxX, minY, maxY, minZ, maxZ } : null;
  // Geometry is stored relative to the bounds centre and the mesh is placed
  // there, so projected coordinates (northings of several million metres)
  // keep sub-millimetre precision in float32 attributes.
  const origin = bounds
    ? new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2)
    : new THREE.Vector3();
  if (prepared.length === 0) {
    return { geometry: null, holes: [], bounds, singlePointHoles, origin };
  }

  // Count vertices / indices up front so we can allocate typed arrays once.
  let vertexCount = 0;
  let indexCount = 0;
  prepared.forEach(({ pts }) => {
    const rings = pts.length;
    vertexCount += rings * radialSegments;            // body rings
    vertexCount += 2 * (radialSegments + 1);          // two caps (ring + centre)
    indexCount += (rings - 1) * radialSegments * 6;   // body quads
    indexCount += 2 * radialSegments * 3;             // cap fans
  });

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const centres = new Float32Array(vertexCount * 3);
  const radials = new Float32Array(vertexCount * 3);
  const holeIdx = new Float32Array(vertexCount);
  const mdNorm = new Float32Array(vertexCount);
  const indices = new Uint32Array(indexCount);

  const meta = [];
  let vi = 0;
  let ii = 0;

  const tangent = new THREE.Vector3();
  const prevDir = new THREE.Vector3();
  const nextDir = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const radial = new THREE.Vector3();

  prepared.forEach(({ hole, pts, sourceIndex }, holeIndex) => {
    const mds = resolveMeasuredDepths(pts);
    const mdMin = mds[0];
    const mdMax = mds[mds.length - 1];
    const length = Math.max(mdMax - mdMin, 1e-6);
    const vertexStart = vi;
    const indexStart = ii;

    const writeVertex = (centre, radialVec, normalVec, md) => {
      const o = vi * 3;
      const cx = centre.x - origin.x, cy = centre.y - origin.y, cz = centre.z - origin.z;
      positions[o] = cx + radialVec.x * radius;
      positions[o + 1] = cy + radialVec.y * radius;
      positions[o + 2] = cz + radialVec.z * radius;
      normals[o] = normalVec.x; normals[o + 1] = normalVec.y; normals[o + 2] = normalVec.z;
      centres[o] = cx; centres[o + 1] = cy; centres[o + 2] = cz;
      radials[o] = radialVec.x; radials[o + 1] = radialVec.y; radials[o + 2] = radialVec.z;
      holeIdx[vi] = holeIndex;
      mdNorm[vi] = (md - mdMin) / length;
      vi += 1;
    };

    // Parallel-transport frame along the polyline.
    let frameNormal = null;
    const ringBase = [];
    const ringFrames = [];
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      if (i === 0) {
        tangent.subVectors(pts[1], pts[0]).normalize();
      } else if (i === pts.length - 1) {
        tangent.subVectors(pts[i], pts[i - 1]).normalize();
      } else {
        prevDir.subVectors(pts[i], pts[i - 1]).normalize();
        nextDir.subVectors(pts[i + 1], pts[i]).normalize();
        tangent.addVectors(prevDir, nextDir);
        if (tangent.lengthSq() < 1e-10) tangent.copy(nextDir); else tangent.normalize();
      }
      if (!frameNormal) {
        frameNormal = perpendicularTo(tangent);
      } else {
        // Remove the component along the new tangent, re-normalise.
        frameNormal.addScaledVector(tangent, -frameNormal.dot(tangent));
        if (frameNormal.lengthSq() < 1e-10) frameNormal = perpendicularTo(tangent); else frameNormal.normalize();
      }
      normal.copy(frameNormal);
      binormal.crossVectors(tangent, normal).normalize();
      ringFrames.push({ t: tangent.clone(), n: normal.clone(), b: binormal.clone() });

      ringBase.push(vi);
      for (let j = 0; j < radialSegments; j += 1) {
        const theta = (j / radialSegments) * Math.PI * 2;
        radial.copy(normal).multiplyScalar(Math.cos(theta)).addScaledVector(binormal, Math.sin(theta));
        writeVertex(p, radial, radial, mds[i]);
      }
    }

    // Body quads.
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a0 = ringBase[i];
      const b0 = ringBase[i + 1];
      for (let j = 0; j < radialSegments; j += 1) {
        const j1 = (j + 1) % radialSegments;
        const a = a0 + j, b = a0 + j1, c = b0 + j, d = b0 + j1;
        indices[ii++] = a; indices[ii++] = b; indices[ii++] = d;
        indices[ii++] = a; indices[ii++] = d; indices[ii++] = c;
      }
    }

    // Collar cap (faces up-hole, i.e. against the first tangent).
    const zero = new THREE.Vector3();
    const capNormal = new THREE.Vector3();
    {
      const frame = ringFrames[0];
      capNormal.copy(frame.t).negate();
      const centreIndex = vi;
      writeVertex(pts[0], zero, capNormal, mds[0]);
      const base = vi;
      for (let j = 0; j < radialSegments; j += 1) {
        const theta = (j / radialSegments) * Math.PI * 2;
        radial.copy(frame.n).multiplyScalar(Math.cos(theta)).addScaledVector(frame.b, Math.sin(theta));
        writeVertex(pts[0], radial, capNormal, mds[0]);
      }
      for (let j = 0; j < radialSegments; j += 1) {
        const j1 = (j + 1) % radialSegments;
        indices[ii++] = centreIndex; indices[ii++] = base + j1; indices[ii++] = base + j;
      }
    }

    // End-of-hole cap (faces down-hole).
    {
      const last = pts.length - 1;
      const frame = ringFrames[last];
      capNormal.copy(frame.t);
      const centreIndex = vi;
      writeVertex(pts[last], zero, capNormal, mds[last]);
      const base = vi;
      for (let j = 0; j < radialSegments; j += 1) {
        const theta = (j / radialSegments) * Math.PI * 2;
        radial.copy(frame.n).multiplyScalar(Math.cos(theta)).addScaledVector(frame.b, Math.sin(theta));
        writeVertex(pts[last], radial, capNormal, mds[last]);
      }
      for (let j = 0; j < radialSegments; j += 1) {
        const j1 = (j + 1) % radialSegments;
        indices[ii++] = centreIndex; indices[ii++] = base + j; indices[ii++] = base + j1;
      }
    }

    const sphere = boundingSphereOf(pts);
    meta.push({
      id: hole.id ?? hole.holeId ?? `hole-${sourceIndex}`,
      project: hole.project,
      index: holeIndex,
      sourceIndex,
      vertexStart,
      vertexCount: vi - vertexStart,
      indexStart,
      indexCount: ii - indexStart,
      mdMin,
      mdMax,
      length,
      points: pts,
      mds,
      collar: pts[0].clone(),
      eoh: pts[pts.length - 1].clone(),
      sphere,
    });
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('aCentre', new THREE.BufferAttribute(centres, 3));
  geometry.setAttribute('aRadial', new THREE.BufferAttribute(radials, 3));
  geometry.setAttribute('aHole', new THREE.BufferAttribute(holeIdx, 1));
  geometry.setAttribute('aMdNorm', new THREE.BufferAttribute(mdNorm, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  geometry.userData.radius = radius;
  geometry.userData.origin = origin.clone();

  return { geometry, holes: meta, bounds, singlePointHoles, origin };
}

/**
 * Re-bake the `position` attribute for a new tube radius so CPU raycasting
 * stays in sync with what the shader draws.
 * @param {THREE.BufferGeometry} geometry - geometry from buildDrillholeTubeGeometry
 * @param {number} radius
 */
export function updateTubeRadius(geometry, radius) {
  if (!geometry || !Number.isFinite(radius) || radius <= 0) return;
  const pos = geometry.getAttribute('position');
  const centre = geometry.getAttribute('aCentre');
  const radial = geometry.getAttribute('aRadial');
  if (!pos || !centre || !radial) return;
  const p = pos.array, c = centre.array, r = radial.array;
  for (let i = 0; i < p.length; i += 1) p[i] = c[i] + r[i] * radius;
  pos.needsUpdate = true;
  geometry.userData.radius = radius;
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
}

/**
 * Pick a sensible tube radius: about 1 % of the typical hole length, never
 * more than a small fraction of the scene extent, clamped so tiny and huge
 * projects both read well.  Regional datasets with short holes therefore get
 * slim tubes close up (the line level of detail covers the far view).
 * @param {{minX:number,maxX:number,minY:number,maxY:number,minZ:number,maxZ:number}|null} bounds
 * @param {number} [typicalLength] - median hole length in scene units
 * @returns {number}
 */
export function defaultTubeRadius(bounds, typicalLength) {
  if (!bounds) return 1;
  const maxDim = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ, 1);
  const byExtent = maxDim * 0.0018;
  const byLength = Number.isFinite(typicalLength) && typicalLength > 0 ? typicalLength * 0.012 : byExtent;
  return Math.min(Math.max(Math.min(byExtent, byLength), 0.05), 25);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanPoints(points) {
  const out = [];
  let last = null;
  (points || []).forEach((p) => {
    const x = Number(p?.x), y = Number(p?.y), z = Number(p?.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const v = new THREE.Vector3(x, y, z);
    const md = Number(p?.md);
    v.md = Number.isFinite(md) ? md : undefined;
    if (last && last.distanceToSquared(v) < 1e-10) {
      // Duplicate station: keep the deeper md if supplied.
      if (v.md !== undefined && (last.md === undefined || v.md > last.md)) last.md = v.md;
      return;
    }
    out.push(v);
    last = v;
  });
  return out;
}

function resolveMeasuredDepths(pts) {
  const allFinite = pts.every((p) => Number.isFinite(p.md));
  const mds = new Array(pts.length);
  if (allFinite) {
    for (let i = 0; i < pts.length; i += 1) mds[i] = pts[i].md;
    // Guarantee monotonic increase for the normalisation.
    for (let i = 1; i < mds.length; i += 1) if (mds[i] <= mds[i - 1]) mds[i] = mds[i - 1] + 1e-6;
    return mds;
  }
  let acc = Number.isFinite(pts[0].md) ? pts[0].md : 0;
  mds[0] = acc;
  for (let i = 1; i < pts.length; i += 1) {
    acc += pts[i].distanceTo(pts[i - 1]);
    mds[i] = acc;
  }
  return mds;
}

function perpendicularTo(t) {
  const ax = Math.abs(t.x), ay = Math.abs(t.y), az = Math.abs(t.z);
  const helper = ax <= ay && ax <= az ? new THREE.Vector3(1, 0, 0)
    : ay <= az ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  return new THREE.Vector3().crossVectors(t, helper).normalize();
}

function boundingSphereOf(pts) {
  const box = new THREE.Box3();
  pts.forEach((p) => box.expandByPoint(p));
  const center = new THREE.Vector3();
  box.getCenter(center);
  let radius = 0;
  pts.forEach((p) => { radius = Math.max(radius, p.distanceTo(center)); });
  return { center, radius };
}
