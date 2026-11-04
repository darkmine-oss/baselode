/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Coordinate reference system helpers shared by Extent and geophysics
// sampling.  proj4 only knows WGS84 and Web Mercator out of the box, so the
// Australian systems Baselode's loaders produce are registered here.
//
// Datum shifts are approximate: GDA94 and GDA2020 are both treated as
// WGS84-equivalent (they differ by about 1.8 m), and AGD66 / AGD84 use the
// national seven-parameter transformations (accurate to a few metres).
// Python uses pyproj, which can apply more exact transformations.

import proj4 from 'proj4';

const EPSG_PATTERN = /^epsg\s*:\s*(\d+)$/i;
const BARE_EPSG_PATTERN = /^\d+$/;

const DATUMS = [
  // [geographic EPSG, projected base (zone added), ellipsoid + towgs84]
  [4283, 28300, '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0'], // GDA94 / MGA94
  [7844, 7800, '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0'], // GDA2020 / MGA2020
  [4202, 20200, '+ellps=aust_SA +towgs84=-117.808,-51.536,137.784,0.303,0.446,0.234,-0.29'], // AGD66 / AMG66
  [4203, 20300, '+ellps=aust_SA +towgs84=-117.763,-51.51,139.061,0.292,0.443,0.277,-0.191'], // AGD84 / AMG84
];

function define(code, definition) {
  if (!proj4.defs(code)) proj4.defs(code, definition);
}

function registerAustralianCrsDefinitions() {
  for (const [geographic, projected, datum] of DATUMS) {
    define(`EPSG:${geographic}`, `+proj=longlat ${datum} +no_defs +type=crs`);
    for (let zone = 49; zone <= 58; zone += 1) {
      define(`EPSG:${projected + zone}`, `+proj=utm +zone=${zone} +south ${datum} +units=m +no_defs +type=crs`);
    }
  }
  for (let zone = 1; zone <= 60; zone += 1) {
    define(`EPSG:${32600 + zone}`, `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs +type=crs`);
    define(`EPSG:${32700 + zone}`, `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs +type=crs`);
  }
}

registerAustralianCrsDefinitions();

export function describeCrs(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

/**
 * Validate a CRS and return it in canonical `EPSG:N` form when it is an EPSG
 * code, otherwise the trimmed proj/WKT definition.
 *
 * @param {string|number} crs - EPSG string (`'EPSG:28350'`), EPSG number, or proj/WKT text.
 * @param {string} [context='A CRS'] - Prefix for the missing-CRS error.
 * @returns {string}
 * @throws {TypeError} When the CRS is missing, malformed, or unknown to proj4.
 *   Register other systems first with `proj4.defs(code, definition)`.
 */
export function normaliseCrs(crs, context = 'A CRS') {
  if (crs === null || crs === undefined) {
    throw new TypeError(
      `${context} requires a CRS. Pass crs: 'EPSG:4326' (default), an EPSG number, or a proj/WKT definition.`,
    );
  }

  let normalized;
  if (typeof crs === 'number') {
    if (!Number.isSafeInteger(crs) || crs <= 0) {
      throw new TypeError(`Invalid CRS ${describeCrs(crs)}: EPSG numbers must be positive integers.`);
    }
    normalized = `EPSG:${crs}`;
  } else if (typeof crs === 'string') {
    const trimmed = crs.trim();
    if (!trimmed) {
      throw new TypeError('Invalid CRS "": CRS definitions must not be empty.');
    }
    const epsgMatch = trimmed.match(EPSG_PATTERN);
    if (epsgMatch) {
      normalized = `EPSG:${Number(epsgMatch[1])}`;
    } else if (BARE_EPSG_PATTERN.test(trimmed)) {
      normalized = `EPSG:${Number(trimmed)}`;
    } else {
      normalized = trimmed;
    }
  } else {
    throw new TypeError(
      `Invalid CRS ${describeCrs(crs)}: pass an EPSG string/number or a proj/WKT definition.`,
    );
  }

  try {
    proj4(normalized);
  } catch (error) {
    const detail = error?.message ? `: ${error.message}` : '';
    throw new TypeError(
      `Invalid CRS ${describeCrs(crs)}${detail}. The definition is not registered or supported by proj4.`,
      { cause: error },
    );
  }
  return normalized;
}

/**
 * Reproject `[x, y]` pairs between coordinate reference systems.
 *
 * @param {string|number} sourceCrs
 * @param {string|number} targetCrs
 * @param {Array<[number, number]>} points - x/easting/longitude first.
 * @returns {Array<[number, number]>} New pairs; the input is not modified.
 *   Non-finite input pairs come back as `[NaN, NaN]`.
 */
export function transformPoints(sourceCrs, targetCrs, points) {
  const source = normaliseCrs(sourceCrs);
  const target = normaliseCrs(targetCrs);
  if (source === target) return points.map(([x, y]) => [x, y]);
  const converter = proj4(source, target);
  return points.map(([x, y]) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [NaN, NaN];
    const [px, py] = converter.forward([x, y]);
    return [px, py];
  });
}
