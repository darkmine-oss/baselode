/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import proj4 from 'proj4';
import descriptor from './geophysics_alignment.json';
import { jsonValue, appendInput, encodeProvenance } from './geophysicsProvenance.js';
import { unicodeStrings } from './geophysicsObservations.js';
import { createGeophysicsRaster } from './geophysicsRaster.js';
import { sampleGeophysicsRaster } from './geophysicsSampling.js';
import { normaliseCrs } from '../extent/crs.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e100;
const spaces = '[ \\t\\n\\r\\v\\f\\u001c-\\u001f\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]';
const surrounding = new RegExp(`^${spaces}+|${spaces}+$`, 'g');
const trim = (value) => typeof value === 'string' ? value.replace(surrounding, '') : value;
const text = (value) => typeof value === 'string' && trim(value).length > 0;
const label = (value) => text(value) && [...value].length <= 128;
const units = new Map(Object.entries({ m: 'm', metre: 'm', meter: 'm', ft: 'ft', foot: 'ft', feet: 'ft', 'us-ft': 'us-ft', us_survey_foot: 'us-ft', 'us survey foot': 'us-ft', foot_us: 'us-ft', foot_intl: 'ft', km: 'km', kilometre: 'km', kilometer: 'km', degree: 'degree', degrees: 'degree' }));
const limits = descriptor.resources;
class NeedsInput extends Error {}
class ResourceError extends Error {}
/** Independent target/options schemas, supported horizontal CRSs and limits. */
export function describeGeophysicsAlignment() { return clone(descriptor); }
function json(value) {
  try {
    jsonValue(value); unicodeStrings(value); const encoded = JSON.stringify(value);
    if (new TextEncoder().encode(encoded).length > 16 * 1024 * 1024) throw Error('oversized JSON');
    return JSON.parse(encoded);
  } catch { throw Error('alignment requires finite acyclic Unicode JSON within 16 MiB'); }
}
function crs(value) {
  if (value === null) return null;
  if (!text(value)) throw Error('CRS must be a nonempty string or explicit null');
  const normalized = trim(value); const match = /^(?:EPSG\s*:\s*)?(\d+)$/i.exec(normalized);
  return match ? `EPSG:${Number(match[1])}` : normalized;
}
const epsg = (value) => typeof value === 'string' && /^EPSG:\d+$/.test(value) ? Number(value.slice(5)) : null;
function coordinateUnit(reference, declared) {
  let unit = null;
  if (declared !== null && declared !== undefined) {
    if (typeof declared !== 'string') throw Error('coordinate units must be a recognized string or null');
    unit = units.get(trim(declared).toLowerCase());
    if (!unit) throw Error('coordinate units must be m, ft, us-ft, km or degree');
  }
  const code = epsg(reference); const inferred = descriptor.cross_crs_epsg.includes(code) ? ([4326, 4283, 7844, 4202, 4203].includes(code) ? 'degree' : 'm') : null;
  if (unit && inferred && unit !== inferred) throw Error('declared coordinate units conflict with the CRS');
  unit ??= inferred;
  if (!unit) throw new NeedsInput('declare coordinate crs_units for local/custom CRS grids');
  return unit;
}
function geometry(shape, transform) {
  if (!Array.isArray(shape) || shape.length !== 2 || !shape.every((size) => number(size) && Number.isInteger(size) && size > 0)) throw Error('shape must be positive integer [rows,columns]');
  if (!Array.isArray(transform) || transform.length !== 6 || !transform.every(number)) throw Error('transform must contain six finite numeric affine values');
  const [a, b, c, d, e, f] = transform; const determinant = a * e - b * d;
  if (!Number.isFinite(determinant) || determinant === 0) throw Error('affine transform must be finite and invertible');
  const [rows, columns] = shape;
  for (const x of [0, columns]) for (const y of [0, rows]) if (!Number.isFinite(a * x + b * y + c) || !Number.isFinite(d * x + e * y + f)) throw Error('affine grid coordinates exceed the numeric range');
  for (const [x, y] of [[0.5, 0.5], [columns - 0.5, rows - 0.5]]) {
    const px = a * x + b * y + c; const py = d * x + e * y + f;
    if (columns > 1 && px === a * (x - 1) + b * y + c && py === d * (x - 1) + e * y + f) throw Error('column spacing is not representable at this coordinate scale');
    if (rows > 1 && px === a * x + b * (y - 1) + c && py === d * x + e * (y - 1) + f) throw Error('row spacing is not representable at this coordinate scale');
  }
  return { shape: [...shape], transform: [...transform] };
}
function sourceRaster(raster) {
  if (!object(raster) || !Number.isInteger(raster.width) || !Number.isInteger(raster.height) || !Number.isInteger(raster.bandCount) || raster.bandCount < 1 || !Array.isArray(raster.data) || !object(raster.metadata)) throw Error('source/reference must be a GeophysicsRaster');
  if (raster.width * raster.height * raster.bandCount > limits.max_source_values) throw new ResourceError('source/reference exceeds 1000000 cell values');
  if (raster.nodata !== null && typeof raster.nodata !== 'number') throw Error('source/reference nodata must be numeric or null');
  const grid = geometry([raster.height, raster.width], raster.transform);
  if (raster.data.length !== raster.bandCount || !raster.data.every((band) => Array.isArray(band) && band.length === raster.height && band.every((row) => Array.isArray(row) && row.length === raster.width && Array.from(row).every((value) => value === null || (typeof value === 'number' && (!Number.isFinite(value) || value === raster.nodata || Math.abs(value) <= 1e100)))))) throw Error('source/reference values must match dimensions and lie within +/-1e100 or be missing');
  if (!Array.isArray(raster.bandNames) || raster.bandNames.length !== raster.bandCount || !raster.bandNames.every((name) => typeof name === 'string')) throw Error('source band names must match band count');
  return { ...grid, metadata: json(raster.metadata) };
}
function optionsContract(options) {
  if (!object(options) || Object.keys(options).some((key) => !Object.hasOwn(descriptor.parameters.properties, key))) throw Error('alignment options must contain only method, value_kind and optional datum_policy');
  const params = json(options);
  if (!Object.hasOwn(params, 'method') || !Object.hasOwn(params, 'value_kind')) throw new NeedsInput('supply explicit method and value_kind');
  if (!['nearest', 'bilinear'].includes(params.method) || !['continuous', 'categorical'].includes(params.value_kind)) throw Error('method must be nearest/bilinear and value_kind continuous/categorical');
  if (params.value_kind === 'categorical' && params.method !== 'nearest') throw Error('categorical scalar values require nearest sampling');
  if (Object.hasOwn(params, 'datum_policy') && params.datum_policy !== 'backend') throw Error('datum_policy must be backend when supplied');
  return params;
}
function targetContract(target) {
  if (!object(target) || Object.keys(target).some((key) => !Object.hasOwn(descriptor.target.properties, key))) throw Error('target must use only shape, transform, crs, crs_units and frame_id');
  const result = json(target);
  if (['shape', 'transform', 'crs'].some((key) => !Object.hasOwn(result, key))) throw new NeedsInput('target needs explicit shape, transform and crs (null for a local grid)');
  Object.assign(result, geometry(result.shape, result.transform)); result.crs = crs(result.crs); result.crs_units = coordinateUnit(result.crs, result.crs_units);
  result.frame_id ??= null;
  if (result.frame_id !== null && !label(result.frame_id)) throw Error('frame_id must be a nonempty label or null');
  return result;
}
function report() {
  return { schema: 'baselode.geophysics.raster_alignment', version: 1, state: 'ok', issues: [], artifacts: {}, parameters: {}, diagnostics: {},
    producer: { library: 'baselode', version: typeof __BASELODE_VERSION__ === 'undefined' ? 'unversioned' : __BASELODE_VERSION__, algorithm_version: 1 }, assumptions: clone(descriptor.assumptions) };
}
function errorResult(result, error) {
  result.state = error instanceof NeedsInput ? 'needs_input' : 'rejected';
  result.issues.push({ code: error instanceof NeedsInput ? 'context' : (error instanceof ResourceError ? 'resource' : 'contract'), message: error.message }); result.artifacts = {}; return result;
}
/** Align continuous/categorical scalars to explicit cell-centre geometry; no vector/height conversion. */
export function alignGeophysicsRaster(source, target, options) {
  const result = report();
  try {
    const original = sourceRaster(source); const metadata = original.metadata; const params = optionsContract(options); const grid = targetContract(target); const [height, width] = grid.shape;
    if (params.value_kind === 'categorical' && source.data.some((band) => band.some((row) => row.some((value) => value !== null && Number.isFinite(value) && value !== source.nodata && !Number.isSafeInteger(value))))) throw Error('categorical cells must be integer codes within the JSON safe-integer range');
    if (height * width > limits.max_target_cells || height * width * source.bandCount > limits.max_target_band_values) throw new ResourceError('target shape/bands exceed alignment resource limits');
    const sourceCrs = crs(source.crs); const sourceUnit = coordinateUnit(sourceCrs, metadata.crs_units); const changed = sourceCrs !== grid.crs;
    if (sourceCrs === null || grid.crs === null) {
      if (changed) throw new NeedsInput('a local grid cannot be reprojected without an explicit CRS');
      if (!label(metadata.frame_id) || grid.frame_id === null) throw new NeedsInput('local alignment requires declared matching source/target frame_id');
      if (metadata.frame_id !== grid.frame_id) throw Error('source and target local frame_id must match');
    }
    if (!changed && sourceUnit !== grid.crs_units) throw Error('same-CRS source/target coordinate units must match');
    let converter = null; let backend = { name: 'identity', version: '1' };
    if (changed) {
      if (params.datum_policy !== 'backend') throw new NeedsInput('cross-CRS alignment requires explicit datum_policy=backend acknowledgement');
      if (!descriptor.cross_crs_epsg.includes(epsg(sourceCrs)) || !descriptor.cross_crs_epsg.includes(epsg(grid.crs))) throw Error('cross-CRS alignment requires a documented supported 2D EPSG pair');
      converter = proj4(normaliseCrs(grid.crs), normaliseCrs(sourceCrs)); backend = { name: 'proj4', version: proj4.version, datum_transformations: 'existing approximate definitions' };
    }
    const [a, b, c, d, e, f] = grid.transform; const points = [];
    for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) {
      const x = a * (column + 0.5) + b * (row + 0.5) + c; const y = d * (column + 0.5) + e * (row + 0.5) + f;
      try { points.push(converter ? converter.forward([x, y]) : [x, y]); } catch { points.push([NaN, NaN]); }
    }
    const [sa, sb, sc, sd, se, sf] = original.transform; const determinant = sa * se - sb * sd; const tolerance = descriptor.pixel_tolerance;
    const valid = []; const footprint = [];
    for (const [x, y] of points) {
      const px = (se * (x - sc) - sb * (y - sf)) / determinant; const py = (-sd * (x - sc) + sa * (y - sf)) / determinant;
      const finite = [x, y, px, py].every(Number.isFinite); valid.push(Number(finite));
      footprint.push(Number(finite && px >= -tolerance && px <= source.width + tolerance && py >= -tolerance && py <= source.height + tolerance));
    }
    const values = Array.from({ length: source.bandCount }, (_, band) => sampleGeophysicsRaster(source, points, { band: band + 1, method: params.method }).map((value) => Number.isFinite(value) ? value : null));
    const support = values.map((band) => band.map((value) => Number(value !== null)));
    const { nodes, operand } = appendInput(metadata, metadata); const omitted = Object.keys(metadata).filter((key) => descriptor.historical_fields.includes(key));
    const outputMetadata = Object.fromEntries(Object.entries(metadata).filter(([key]) => !descriptor.historical_fields.includes(key)));
    Object.assign(outputMetadata, { crs_units: grid.crs_units, input_lineage: nodes, uncertainty_propagated: false });
    if (grid.frame_id !== null) outputMetadata.frame_id = grid.frame_id;
    const step = { operation: 'align_raster', version: 1, target: clone(grid), parameters: clone(params), operand_lineage: operand, source_shape: original.shape, source_transform: original.transform, source_crs: sourceCrs, backend };
    outputMetadata.processing = [...(outputMetadata.processing ?? []), step]; encodeProvenance(outputMetadata, 'GeoTIFF', 'float64');
    const arrays = { raster: values, support, footprint: [footprint], coordinate_valid: [valid] };
    for (const [key, bands] of Object.entries(arrays)) {
      const attributes = clone(outputMetadata); let names = [...source.bandNames];
      if (key !== 'raster') { Object.assign(attributes, { field_type: 'other', units: bands.map(() => '1'), diagnostic: key }); if (key !== 'support') names = [key]; }
      const data = bands.map((band) => Array.from({ length: height }, (_, row) => band.slice(row * width, (row + 1) * width)));
      result.artifacts[key] = createGeophysicsRaster({ data, transform: grid.transform, crs: grid.crs, bandNames: names, metadata: attributes });
    }
    result.parameters = { target: grid, options: params };
    result.diagnostics = { source_shape: original.shape, target_shape: grid.shape, source_crs: sourceCrs, target_crs: grid.crs, source_units: sourceUnit, target_units: grid.crs_units,
      coordinate_valid_cells: valid.reduce((sum, value) => sum + value, 0), footprint_cells: footprint.reduce((sum, value) => sum + value, 0), supported_per_band: support.map((band) => band.reduce((sum, value) => sum + value, 0)), historical_metadata_fields: omitted, uncertainty_propagated: false, backend };
    return result;
  } catch (error) { return errorResult(result, error); }
}
/** Match reference geometry while retaining source bands/scientific metadata. */
export function matchGeophysicsRaster(source, reference, options) {
  try {
    if (!object(reference) || !object(reference.metadata)) throw Error('source/reference must be a GeophysicsRaster');
    const grid = geometry([reference.height, reference.width], reference.transform);
    return alignGeophysicsRaster(source, { shape: grid.shape, transform: grid.transform, crs: reference.crs, crs_units: reference.metadata.crs_units ?? null, frame_id: reference.metadata.frame_id ?? null }, options);
  } catch (error) { return errorResult(report(), error); }
}
