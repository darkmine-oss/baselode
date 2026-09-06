/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Block model grid definition — mirrors `baselode.blockmodel.definition`.
 *
 * A block model is a regular grid of *base blocks* anchored at an origin,
 * optionally rotated, and optionally grouped into larger *parent blocks*.
 * Every block sits on the base grid and spans a whole number of base
 * blocks per axis.
 *
 * Frames: `local` is grid-aligned metres from the origin (u along the
 * grid x axis, v along y, w along z); `world` is the projected CRS.
 * `world = origin + R · local`, with `R = Rz(azimuth) · Rx(dip) · Ry(plunge)`:
 * azimuth is the bearing of the grid's y axis clockwise from north, dip
 * tilts the y axis down, plunge tilts the x axis down (all degrees).
 */

const AXES = ['x', 'y', 'z'];
const SIZE_KEYS = ['dx', 'dy', 'dz'];
const COUNT_KEYS = ['nx', 'ny', 'nz'];
const ROTATION_KEYS = ['azimuth', 'dip', 'plunge'];
const EPS = 1e-9;

function triplet(value, keys, name, integer = false) {
  if (value == null) throw new Error(`${name} is required`);
  let items;
  if (Array.isArray(value)) {
    if (value.length !== 3) throw new Error(`${name} must have three components, got ${value.length}`);
    items = value.map(Number);
  } else if (typeof value === 'object') {
    const missing = keys.filter((key) => value[key] === undefined);
    if (missing.length) throw new Error(`${name} is missing ${missing.join(', ')}; expected keys ${keys.join(', ')}`);
    items = keys.map((key) => Number(value[key]));
  } else {
    throw new Error(`${name} must be an array or object`);
  }
  if (items.some((item) => !Number.isFinite(item))) throw new Error(`${name} components must be finite numbers`);
  return integer ? items.map((item) => Math.trunc(item)) : items;
}

function positive(values, name) {
  if (values.some((value) => !(value > 0))) throw new Error(`${name} components must be > 0, got ${values}`);
  return values;
}

function degToRad(angle) {
  return (angle * Math.PI) / 180;
}

function matMul(a, b) {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[r][c] = a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c];
    }
  }
  return out;
}

function transpose(m) {
  return [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
}

/**
 * Rotation matrix `R` with `world = origin + R · local`.
 * @param {number} azimuth - bearing of the grid y axis, degrees clockwise from north
 * @param {number} dip - tilt of the grid y axis below horizontal, degrees
 * @param {number} plunge - tilt of the grid x axis below horizontal, degrees
 * @returns {number[][]} 3x3 row-major matrix
 */
export function blockModelRotationMatrix(azimuth = 0, dip = 0, plunge = 0) {
  const az = degToRad(azimuth);
  const dp = degToRad(dip);
  const pl = degToRad(plunge);
  const rz = [[Math.cos(az), Math.sin(az), 0], [-Math.sin(az), Math.cos(az), 0], [0, 0, 1]];
  const rx = [[1, 0, 0], [0, Math.cos(dp), Math.sin(dp)], [0, -Math.sin(dp), Math.cos(dp)]];
  const ry = [[Math.cos(pl), 0, Math.sin(pl)], [0, 1, 0], [-Math.sin(pl), 0, Math.cos(pl)]];
  return matMul(matMul(rz, rx), ry);
}

/**
 * Build a block model definition.
 *
 * @param {Object} spec
 * @param {number[]|{x,y,z}} spec.origin - world coordinates of the grid's minimum corner
 * @param {number[]|{dx,dy,dz}} spec.blockSize - base block size (world units)
 * @param {number[]|{nx,ny,nz}} spec.nBlocks - grid extent in base blocks
 * @param {number[]|{nx,ny,nz}} [spec.parentSize] - parent block size in base-block multiples
 * @param {number[]|{azimuth,dip,plunge}} [spec.rotation] - degrees; default none
 * @param {string} [spec.crs]
 * @param {string} [spec.name]
 * @param {string} [spec.description]
 * @param {Object} [spec.extra]
 * @returns {Object} frozen definition with `origin`, `blockSize`, `nBlocks`,
 *   `parentSize` (or null), `rotation` `{azimuth, dip, plunge}`, `crs`,
 *   `name`, `description`, `extra`, `matrix`, `inverse`
 */
export function createBlockModelDefinition(spec = {}) {
  const origin = triplet(spec.origin, AXES, 'origin');
  const blockSize = positive(triplet(spec.blockSize, SIZE_KEYS, 'blockSize'), 'blockSize');
  const nBlocks = triplet(spec.nBlocks, COUNT_KEYS, 'nBlocks', true);
  if (nBlocks.some((n) => n < 1)) throw new Error(`nBlocks components must be >= 1, got ${nBlocks}`);
  let parentSize = null;
  if (spec.parentSize != null) {
    parentSize = triplet(spec.parentSize, COUNT_KEYS, 'parentSize', true);
    if (parentSize.some((p) => p < 1)) throw new Error(`parentSize components must be >= 1, got ${parentSize}`);
  }
  let rotation = { azimuth: 0, dip: 0, plunge: 0 };
  if (Array.isArray(spec.rotation)) {
    const [azimuth, dip, plunge] = triplet(spec.rotation, ROTATION_KEYS, 'rotation');
    rotation = { azimuth, dip, plunge };
  } else if (spec.rotation && typeof spec.rotation === 'object') {
    rotation = {
      azimuth: Number(spec.rotation.azimuth ?? 0),
      dip: Number(spec.rotation.dip ?? 0),
      plunge: Number(spec.rotation.plunge ?? 0),
    };
  }
  const matrix = blockModelRotationMatrix(rotation.azimuth, rotation.dip, rotation.plunge);
  return Object.freeze({
    origin,
    blockSize,
    nBlocks,
    parentSize,
    rotation,
    crs: spec.crs || '',
    name: spec.name || '',
    description: spec.description || '',
    extra: { ...(spec.extra || {}) },
    matrix,
    inverse: transpose(matrix),
  });
}

/**
 * Build a definition from the JSON written by Python's
 * `BlockModelDefinition.to_dict()` / `BlockModel.to_dict()`, or from legacy
 * block metadata (`origin` + `min_block_size` + `max_block_size` + `bbox_3d`).
 * @param {Object} meta
 * @returns {Object} definition
 */
export function blockModelDefinitionFromDict(meta) {
  if (!meta || typeof meta !== 'object') throw new Error('block model metadata must be an object');
  const source = meta.definition && typeof meta.definition === 'object' ? meta.definition : meta;
  if (source.origin == null) throw new Error('block model metadata has no origin');
  let rotation = source.rotation;
  if (rotation == null && source.origin && source.origin.rotation_deg != null) {
    rotation = { azimuth: Number(source.origin.rotation_deg) };
  }
  const blockSize = source.block_size || source.blockSize || source.min_block_size;
  if (blockSize == null) throw new Error('block model metadata has no block_size (or legacy min_block_size)');
  const base = positive(triplet(blockSize, SIZE_KEYS, 'block_size'), 'block_size');

  let parentSize = source.parent_size ?? source.parentSize ?? null;
  if (parentSize == null && source.max_block_size) {
    const parentWorld = triplet(source.max_block_size, SIZE_KEYS, 'max_block_size');
    const ratios = parentWorld.map((p, idx) => p / base[idx]);
    if (ratios.some((r) => Math.abs(r - Math.round(r)) > 1e-6)) {
      throw new Error(`legacy max_block_size ${parentWorld} is not a whole multiple of min_block_size ${base}`);
    }
    parentSize = ratios.map((r) => Math.round(r));
  }

  let nBlocks = source.n_blocks ?? source.nBlocks;
  if (nBlocks == null) {
    const bbox = source.bbox_3d;
    if (!bbox) throw new Error('block model metadata needs n_blocks or a legacy bbox_3d');
    const rotated = rotation && Object.values(rotation).some((a) => Math.abs(Number(a)) > 0);
    if (rotated) throw new Error('cannot derive n_blocks from bbox_3d for a rotated grid; give n_blocks');
    const extents = [bbox.max_x - bbox.min_x, bbox.max_y - bbox.min_y, bbox.max_z - bbox.min_z];
    nBlocks = extents.map((e, idx) => Math.round(e / base[idx]));
  }

  return createBlockModelDefinition({
    origin: source.origin,
    blockSize: base,
    nBlocks,
    parentSize,
    rotation,
    crs: source.crs,
    name: source.name,
    description: source.description,
    extra: source.extra,
  });
}

/**
 * JSON-ready plain object in the same shape Python's `to_dict()` writes.
 * @param {Object} definition
 * @returns {Object}
 */
export function blockModelDefinitionToDict(definition) {
  const keyed = (keys, values) => Object.fromEntries(keys.map((key, idx) => [key, values[idx]]));
  return {
    name: definition.name,
    description: definition.description,
    crs: definition.crs,
    origin: keyed(AXES, definition.origin),
    block_size: keyed(SIZE_KEYS, definition.blockSize),
    n_blocks: keyed(COUNT_KEYS, definition.nBlocks),
    parent_size: definition.parentSize ? keyed(COUNT_KEYS, definition.parentSize) : null,
    rotation: { ...definition.rotation },
    extra: { ...definition.extra },
  };
}

/** Local grid coordinates → world. */
export function localToWorld(definition, u, v, w) {
  const m = definition.matrix;
  return [
    definition.origin[0] + m[0][0] * u + m[0][1] * v + m[0][2] * w,
    definition.origin[1] + m[1][0] * u + m[1][1] * v + m[1][2] * w,
    definition.origin[2] + m[2][0] * u + m[2][1] * v + m[2][2] * w,
  ];
}

/** World coordinates → local grid coordinates. */
export function worldToLocal(definition, x, y, z) {
  const m = definition.inverse;
  const sx = x - definition.origin[0];
  const sy = y - definition.origin[1];
  const sz = z - definition.origin[2];
  return [
    m[0][0] * sx + m[0][1] * sy + m[0][2] * sz,
    m[1][0] * sx + m[1][1] * sy + m[1][2] * sz,
    m[2][0] * sx + m[2][1] * sy + m[2][2] * sz,
  ];
}

/**
 * World centroid of the block whose minimum corner is base cell (i, j, k)
 * and which spans (ni, nj, nk) base blocks.
 */
export function indexToWorld(definition, i, j, k, ni = 1, nj = 1, nk = 1) {
  const [dx, dy, dz] = definition.blockSize;
  return localToWorld(definition, (i + ni / 2) * dx, (j + nj / 2) * dy, (k + nk / 2) * dz);
}

/** Base cell [i, j, k] containing a world point (may fall outside the grid). */
export function worldToIndex(definition, x, y, z) {
  const [u, v, w] = worldToLocal(definition, x, y, z);
  const [dx, dy, dz] = definition.blockSize;
  return [Math.floor(u / dx + EPS), Math.floor(v / dy + EPS), Math.floor(w / dz + EPS)];
}

/** True when the block [i, i+ni) x [j, j+nj) x [k, k+nk) lies inside the grid. */
export function containsIndex(definition, i, j, k, ni = 1, nj = 1, nk = 1) {
  const [nx, ny, nz] = definition.nBlocks;
  return i >= 0 && j >= 0 && k >= 0 && i + ni <= nx && j + nj <= ny && k + nk <= nz;
}

/** Parent block index of base cell (i, j, k); identity without parents. */
export function parentIndex(definition, i, j, k) {
  if (!definition.parentSize) return [i, j, k];
  const [px, py, pz] = definition.parentSize;
  return [Math.floor(i / px), Math.floor(j / py), Math.floor(k / pz)];
}

/** Grid extent along its local axes in world units. */
export function blockModelExtent(definition) {
  return definition.blockSize.map((size, idx) => size * definition.nBlocks[idx]);
}

/** Parent block size in world units, or null without parents. */
export function parentBlockSize(definition) {
  if (!definition.parentSize) return null;
  return definition.blockSize.map((size, idx) => size * definition.parentSize[idx]);
}

/** The eight world-space corners of the grid. */
export function blockModelCorners(definition) {
  const [ex, ey, ez] = blockModelExtent(definition);
  const local = [[0, 0, 0], [ex, 0, 0], [0, ey, 0], [ex, ey, 0], [0, 0, ez], [ex, 0, ez], [0, ey, ez], [ex, ey, ez]];
  return local.map(([u, v, w]) => localToWorld(definition, u, v, w));
}

/** Axis-aligned world bounding box of the (possibly rotated) grid. */
export function blockModelBounds(definition) {
  const corners = blockModelCorners(definition);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const zs = corners.map((c) => c[2]);
  return {
    min_x: Math.min(...xs), max_x: Math.max(...xs),
    min_y: Math.min(...ys), max_y: Math.max(...ys),
    min_z: Math.min(...zs), max_z: Math.max(...zs),
  };
}

/** GeoJSON polygon of the grid footprint in plan. */
export function blockModelOutline2d(definition) {
  const [ex, ey] = blockModelExtent(definition);
  const ring = [[0, 0], [ex, 0], [ex, ey], [0, ey], [0, 0]].map(([u, v]) => {
    const [x, y] = localToWorld(definition, u, v, 0);
    return [x, y];
  });
  return { type: 'Polygon', coordinates: [ring] };
}

/** True when both grids share origin, base block size and rotation. */
export function sameGrid(a, b, tol = 1e-6) {
  const close = (p, q) => Math.abs(p - q) <= tol;
  return a.origin.every((v, idx) => close(v, b.origin[idx]))
    && a.blockSize.every((v, idx) => close(v, b.blockSize[idx]))
    && ROTATION_KEYS.every((key) => close(a.rotation[key], b.rotation[key]));
}
