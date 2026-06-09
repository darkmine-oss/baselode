/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A 3D sample support point used for IDW interpolation.
 *
 * @typedef {object} InterpSamplePoint
 * @property {string}  id       - Unique sample identifier
 * @property {string}  holeId   - Parent hole identifier
 * @property {number}  x        - World X coordinate
 * @property {number}  y        - World Y coordinate
 * @property {number}  z        - World Z coordinate (elevation)
 * @property {number}  value    - Numeric attribute value at this point
 * @property {number}  [from]   - Down-hole depth from (m)
 * @property {number}  [to]     - Down-hole depth to (m)
 * @property {number}  [length] - Interval length (m)
 * @property {object}  [metadata] - Arbitrary extra data
 */

/**
 * Build interpolation sample points from desurveyed assay intervals.
 *
 * Each interval is represented by its midpoint along the drill trace.
 * If the trace has desurveyed positions, those are used directly.  If
 * not (e.g. vertical hole shortcut), the collar x/y/z are used for X/Y
 * and midMd is used to estimate Z as collar.z – midMd (straight-line
 * vertical assumption).
 *
 * @param {Array<object>} assayRows
 *   Rows that each contain at least: holeId, from, to, and the attribute
 *   specified by `attributeName`.  Desurveyed rows (attached via
 *   attachAssayPositions) should additionally carry x, y, z fields.
 * @param {string} attributeName - Column name of the numeric attribute to interpolate
 * @returns {InterpSamplePoint[]}
 */
export function buildInterpSamplesFromAssays(assayRows, attributeName) {
  if (!Array.isArray(assayRows) || !attributeName) return [];

  const samples = [];
  for (let i = 0; i < assayRows.length; i++) {
    const row = assayRows[i];
    const raw = row[attributeName];
    if (raw === null || raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (!isFinite(value)) continue;

    const from = Number(row.from ?? row.FROM ?? 0);
    const to   = Number(row.to   ?? row.TO   ?? 0);
    const len  = to - from;
    if (len < 0) continue;

    let x = Number(row.x ?? row.X ?? NaN);
    let y = Number(row.y ?? row.Y ?? NaN);
    let z = Number(row.z ?? row.Z ?? NaN);

    // Fallback: if desurveyed mid-point coordinates are missing, try
    // collar-level fields (x_collar, y_collar, z_collar) and apply the
    // straight-line-vertical assumption.
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
      const cx = Number(row.x_collar ?? row.collar_x ?? NaN);
      const cy = Number(row.y_collar ?? row.collar_y ?? NaN);
      const cz = Number(row.z_collar ?? row.collar_z ?? NaN);
      if (!isFinite(cx) || !isFinite(cy) || !isFinite(cz)) continue;
      const midMd = from + len / 2;
      x = cx;
      y = cy;
      z = cz - midMd; // vertical downward assumption
    }

    samples.push({
      id:     String(row.id ?? row.sampleId ?? `${row.hole_id ?? row.holeId ?? ''}_${i}`),
      holeId: String(row.hole_id ?? row.holeId ?? ''),
      x,
      y,
      z,
      value,
      from: isFinite(from) ? from : undefined,
      to:   isFinite(to)   ? to   : undefined,
      length: isFinite(len) ? len : undefined,
      metadata: row.metadata ?? undefined,
    });
  }
  return samples;
}
