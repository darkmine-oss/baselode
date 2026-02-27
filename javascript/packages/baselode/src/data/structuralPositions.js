/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Interpolate a 3D position and drill direction along a desurveyed trace.
 *
 * @param {Array<{hole_id: string, md: number, x: number, y: number, z: number, azimuth?: number, dip?: number}>} sortedTraceRows
 *   Trace points sorted ascending by md.
 * @param {number} targetMd - Measured depth to interpolate at.
 * @returns {{x: number, y: number, z: number, dx: number, dy: number, dz: number}|null}
 *   Position and unit drill direction (dz negative = downward), or null if not possible.
 */
export function interpolateTrace(sortedTraceRows, targetMd) {
  if (!sortedTraceRows || sortedTraceRows.length === 0) return null;
  if (!Number.isFinite(targetMd)) return null;

  const n = sortedTraceRows.length;

  if (n === 1) {
    const p = sortedTraceRows[0];
    return { x: Number(p.x), y: Number(p.y), z: Number(p.z), dx: 0, dy: 0, dz: -1 };
  }

  // Find enclosing segment
  let segIdx = -1;
  for (let i = 0; i < n - 1; i++) {
    const md0 = Number(sortedTraceRows[i].md);
    const md1 = Number(sortedTraceRows[i + 1].md);
    if (targetMd >= md0 && targetMd <= md1) {
      segIdx = i;
      break;
    }
  }

  let p0, p1, t;

  if (segIdx === -1) {
    if (targetMd < Number(sortedTraceRows[0].md)) {
      // Before first point — extrapolate using first segment
      p0 = sortedTraceRows[0];
      p1 = sortedTraceRows[1];
    } else {
      // Beyond last point — extend using last segment
      p0 = sortedTraceRows[n - 2];
      p1 = sortedTraceRows[n - 1];
    }
    const md0 = Number(p0.md);
    const md1 = Number(p1.md);
    const segLen = md1 - md0;
    t = segLen > 0 ? (targetMd - md0) / segLen : (targetMd < md0 ? 0 : 1);
  } else {
    p0 = sortedTraceRows[segIdx];
    p1 = sortedTraceRows[segIdx + 1];
    const md0 = Number(p0.md);
    const md1 = Number(p1.md);
    const segLen = md1 - md0;
    t = segLen > 0 ? (targetMd - md0) / segLen : 0;
  }

  const x = Number(p0.x) + t * (Number(p1.x) - Number(p0.x));
  const y = Number(p0.y) + t * (Number(p1.y) - Number(p0.y));
  const z = Number(p0.z) + t * (Number(p1.z) - Number(p0.z));

  // Compute drill direction: prefer azimuth/dip, fall back to finite differences
  let dx, dy, dz;
  const az0 = Number(p0.azimuth);
  const dip0 = Number(p0.dip);
  const az1 = Number(p1.azimuth);
  const dip1 = Number(p1.dip);

  if (Number.isFinite(az0) && Number.isFinite(dip0)) {
    const az = Number.isFinite(az1) && Number.isFinite(dip1)
      ? az0 + t * (az1 - az0)
      : az0;
    const dip = Number.isFinite(az1) && Number.isFinite(dip1)
      ? dip0 + t * (dip1 - dip0)
      : dip0;
    const azRad = (az * Math.PI) / 180;
    const dipRad = (dip * Math.PI) / 180;
    // Match directionCosines convention: dz = -sin(dip) (downward positive)
    dx = Math.cos(dipRad) * Math.sin(azRad);
    dy = Math.cos(dipRad) * Math.cos(azRad);
    dz = -Math.sin(dipRad);
  } else {
    // Finite difference from segment
    const ddx = Number(p1.x) - Number(p0.x);
    const ddy = Number(p1.y) - Number(p0.y);
    const ddz = Number(p1.z) - Number(p0.z);
    const len = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
    if (len < 1e-10) return { x, y, z, dx: 0, dy: 0, dz: -1 };
    dx = ddx / len;
    dy = ddy / len;
    dz = ddz / len;
  }

  // Normalize direction
  const dlen = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dlen < 1e-10) return { x, y, z, dx: 0, dy: 0, dz: -1 };
  return { x, y, z, dx: dx / dlen, dy: dy / dlen, dz: dz / dlen };
}

/**
 * Convert core-relative alpha/beta angles to a geographic plane normal.
 *
 * The drill frame:
 *   D = unit drill direction (positive = downward along hole)
 *   R = normalize(cross(U, D))  where U = (0,0,1) or fallback (0,1,0)
 *   B = normalize(cross(D, R))
 *
 * Sanity checks:
 *   alpha=90 → N perpendicular to D
 *   alpha=0  → N parallel to D
 *
 * @param {number} alphaDeg - Alpha angle in degrees; 90 = plane perpendicular to drill axis.
 * @param {number} betaDeg - Beta angle in degrees; rotation of reference mark around drill axis.
 * @param {{dx: number, dy: number, dz: number}} drillDir - Unit drill direction vector.
 * @param {Object} [opts]
 * @param {'R'|'B'} [opts.betaZeroAxis='B'] - Frame axis corresponding to beta=0.
 * @param {number} [opts.betaHandedness=1] - +1 for right-hand rotation, -1 for left-hand.
 * @returns {{nx: number, ny: number, nz: number}} Unit normal vector in ENU coordinates.
 */
export function alphaBetaToNormal(alphaDeg, betaDeg, drillDir, opts = {}) {
  const { betaZeroAxis = 'B', betaHandedness = 1 } = opts;
  const { dx, dy, dz } = drillDir;
  const D = [dx, dy, dz];

  // Up vector with fallback when D is nearly vertical
  let U = [0, 0, 1];
  const dotDU = D[0] * U[0] + D[1] * U[1] + D[2] * U[2];
  if (Math.abs(dotDU) > 0.99) {
    U = [0, 1, 0];
  }

  // R = normalize(cross(U, D))
  const crossUD = [
    U[1] * D[2] - U[2] * D[1],
    U[2] * D[0] - U[0] * D[2],
    U[0] * D[1] - U[1] * D[0],
  ];
  const crossUDLen = Math.sqrt(crossUD[0] ** 2 + crossUD[1] ** 2 + crossUD[2] ** 2);
  const R = crossUDLen > 1e-10
    ? [crossUD[0] / crossUDLen, crossUD[1] / crossUDLen, crossUD[2] / crossUDLen]
    : [1, 0, 0];

  // B = normalize(cross(D, R))
  const crossDR = [
    D[1] * R[2] - D[2] * R[1],
    D[2] * R[0] - D[0] * R[2],
    D[0] * R[1] - D[1] * R[0],
  ];
  const crossDRLen = Math.sqrt(crossDR[0] ** 2 + crossDR[1] ** 2 + crossDR[2] ** 2);
  const B = crossDRLen > 1e-10
    ? [crossDR[0] / crossDRLen, crossDR[1] / crossDRLen, crossDR[2] / crossDRLen]
    : [0, 1, 0];

  // Starting axis for beta rotation
  const N_perp0 = betaZeroAxis === 'R' ? R : B;

  // Rodrigues rotation: rotate N_perp0 around D by (beta * betaHandedness) radians
  const betaRad = (betaDeg * Math.PI) / 180 * betaHandedness;
  const cosB = Math.cos(betaRad);
  const sinB = Math.sin(betaRad);
  const dotND = N_perp0[0] * D[0] + N_perp0[1] * D[1] + N_perp0[2] * D[2];
  const crossDN = [
    D[1] * N_perp0[2] - D[2] * N_perp0[1],
    D[2] * N_perp0[0] - D[0] * N_perp0[2],
    D[0] * N_perp0[1] - D[1] * N_perp0[0],
  ];
  const N_perp = [
    N_perp0[0] * cosB + crossDN[0] * sinB + D[0] * dotND * (1 - cosB),
    N_perp0[1] * cosB + crossDN[1] * sinB + D[1] * dotND * (1 - cosB),
    N_perp0[2] * cosB + crossDN[2] * sinB + D[2] * dotND * (1 - cosB),
  ];

  // theta = (90 - alpha) * pi/180; N = normalize(cos(theta)*N_perp + sin(theta)*D)
  const theta = ((90 - alphaDeg) * Math.PI) / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const Nx = cosT * N_perp[0] + sinT * D[0];
  const Ny = cosT * N_perp[1] + sinT * D[1];
  const Nz = cosT * N_perp[2] + sinT * D[2];

  const NLen = Math.sqrt(Nx * Nx + Ny * Ny + Nz * Nz);
  if (NLen < 1e-10) return { nx: 0, ny: 0, nz: 1 };
  return { nx: Nx / NLen, ny: Ny / NLen, nz: Nz / NLen };
}

/**
 * Compute 3D positions and plane normals for structural measurements.
 *
 * Prioritises alpha/beta core angles over geographic dip/azimuth.
 * Rows with no matching trace or missing required fields are excluded.
 *
 * @param {Array<Object>} structures - Flat rows with {hole_id, depth?, mid?, alpha?, beta?, dip?, azimuth?, ...}
 * @param {Array<Object>} traceRows - Flat rows with {hole_id, md, x, y, z, azimuth?, dip?}
 * @param {Object} [opts] - Options forwarded to alphaBetaToNormal.
 * @returns {Array<Object>} Structure rows enriched with {x, y, z, nx, ny, nz}.
 */
export function computeStructuralPositions(structures, traceRows, opts = {}) {
  if (!structures?.length || !traceRows?.length) return [];

  // Group trace rows by hole_id (lowercase) sorted ascending by md
  const tracesByHole = new Map();
  for (const row of traceRows) {
    const holeId = row.hole_id != null ? `${row.hole_id}`.trim().toLowerCase() : '';
    if (!holeId) continue;
    if (!tracesByHole.has(holeId)) tracesByHole.set(holeId, []);
    tracesByHole.get(holeId).push(row);
  }
  for (const [, rows] of tracesByHole) {
    rows.sort((a, b) => Number(a.md) - Number(b.md));
  }

  const result = [];
  for (const s of structures) {
    const holeId = s.hole_id != null ? `${s.hole_id}`.trim().toLowerCase() : '';
    if (!holeId) continue;

    const holeTrace = tracesByHole.get(holeId);
    if (!holeTrace || holeTrace.length === 0) continue;

    const depth = s.depth != null ? Number(s.depth) : (s.mid != null ? Number(s.mid) : null);
    if (!Number.isFinite(depth)) continue;

    const pos = interpolateTrace(holeTrace, depth);
    if (!pos) continue;

    const { x, y, z, dx, dy, dz } = pos;

    let nx, ny, nz;
    const alpha = s.alpha != null ? Number(s.alpha) : null;
    const beta = s.beta != null ? Number(s.beta) : null;

    if (Number.isFinite(alpha)) {
      const betaVal = Number.isFinite(beta) ? beta : 0;
      const n = alphaBetaToNormal(alpha, betaVal, { dx, dy, dz }, opts);
      nx = n.nx;
      ny = n.ny;
      nz = n.nz;
    } else {
      const dip = s.dip != null ? Number(s.dip) : null;
      const az = s.azimuth != null ? Number(s.azimuth) : null;
      if (!Number.isFinite(dip) || !Number.isFinite(az)) continue;
      // Geographic formula matching dipAzimuthToNormal in structuralScene.js
      const dipRad = (dip * Math.PI) / 180;
      const azRad = (az * Math.PI) / 180;
      nx = Math.sin(azRad) * Math.sin(dipRad);
      ny = Math.cos(azRad) * Math.sin(dipRad);
      nz = Math.cos(dipRad);
    }

    result.push({ ...s, x, y, z, nx, ny, nz });
  }

  return result;
}
