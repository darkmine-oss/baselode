/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import descriptor from './geophysics_gridding.json';
import { createGeophysicsObservations } from './geophysicsObservations.js';
import { geophysicsCoordinateUnit } from './geophysicsProcessing.js';
import { jsonValue, inputRecord, encodeProvenance } from './geophysicsProvenance.js';
import { createGeophysicsRaster } from './geophysicsRaster.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e100;
const spaces = '[ \\t\\n\\r\\v\\f\\u001c-\\u001f\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]';
const surrounding = new RegExp(`^${spaces}+|${spaces}+$`, 'g');
const trim = (value) => typeof value === 'string' ? value.replace(surrounding, '') : value;
const limits = descriptor.resources;
class NeedsInput extends Error {}
class ResourceError extends Error {}

function sum(values) {
  let total = 0; let correction = 0;
  for (const value of values) {
    const next = total + value;
    correction += Math.abs(total) >= Math.abs(value) ? (total - next) + value : (value - next) + total;
    total = next;
  }
  return total + correction;
}
/** Independent parameter schemas, assumptions and resource limits. */
export function describeGeophysicsGridding() { return clone(descriptor); }
function report(kind) {
  return { schema: `baselode.geophysics.${kind}`, version: 1, state: 'ok', issues: [],
    producer: { library: 'baselode', version: typeof __BASELODE_VERSION__ === 'undefined' ? 'unversioned' : __BASELODE_VERSION__, algorithm_version: 1 },
    parameters: {}, diagnostics: {}, assumptions: clone(descriptor.assumptions) };
}
function errorResult(result, error) {
  result.state = error instanceof NeedsInput ? 'needs_input' : 'rejected';
  result.issues.push({ code: error instanceof NeedsInput ? 'context' : (error instanceof ResourceError ? 'resource' : 'contract'), message: error.message });
  return result;
}
function jsonOptions(options, schema) {
  if (!object(options) || Object.keys(options).some((key) => !Object.hasOwn(schema.properties, key))) throw Error('gridding options must be a JSON object with known parameter names');
  let result;
  try { jsonValue(options); result = clone(options); } catch { throw Error('gridding options require finite acyclic JSON'); }
  const missing = schema.required.filter((name) => !Object.hasOwn(result, name));
  if (missing.length) throw new NeedsInput(`supply required options: ${missing.join(', ')}`);
  for (const [name, rule] of Object.entries(schema.properties)) if (!Object.hasOwn(result, name) && Object.hasOwn(rule, 'default')) result[name] = clone(rule.default);
  return result;
}
function parameters(data, options, grid) {
  const params = jsonOptions(options, descriptor[grid ? 'grid_parameters' : 'interpolation_parameters']);
  if (!Array.isArray(params.channels) || !params.channels.length || !params.channels.every((name) => typeof name === 'string' && Object.hasOwn(data.channels, name)) || new Set(params.channels).size !== params.channels.length) {
    throw Error('channels must be a unique nonempty list of declared channel names');
  }
  if (new Set(params.channels.map((name) => data.channels[name].field_type)).size !== 1) throw Error('selected channels must share field_type; grid different field families separately');
  for (const name of ['neighbors', 'min_neighbors']) if (!Number.isInteger(params[name]) || params[name] < 1 || params[name] > 64) throw Error('neighbors/min_neighbors must be integers from 1 to 64');
  if (params.min_neighbors > params.neighbors) throw Error('min_neighbors cannot exceed neighbors');
  if (!number(params.radius) || params.radius <= 0 || !number(params.power) || params.power <= 0 || params.power > 16) throw Error('radius must be positive in range and power must be in (0,16]');
  if (!['nearest', 'idw'].includes(params.method) || !['mean', 'reject'].includes(params.duplicate_policy) || !['mask', 'allow'].includes(params.extrapolation)) throw Error('unsupported interpolation method, duplicate policy or extrapolation policy');
  if (params.elevation_policy !== 'ignore') throw Error('baseline interpolation requires explicit elevation_policy=ignore; no height reduction is performed');
  if (grid) {
    const { bounds, shape } = params;
    if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(number) || !(bounds[0] < bounds[2] && bounds[1] < bounds[3])) throw Error('bounds must be finite outer edges [min_x,min_y,max_x,max_y] with positive extent');
    if (!Array.isArray(shape) || shape.length !== 2 || !shape.every((value) => Number.isInteger(value) && value >= 1 && value <= 100000)) throw Error('shape must be positive integer [rows,columns]');
    if (shape[0] * shape[1] > limits.max_grid_cells || shape[0] * shape[1] * params.channels.length > limits.max_band_values) throw new ResourceError('grid shape/channels exceed cell or band-value limits');
  }
  let unit;
  try { unit = geophysicsCoordinateUnit({ crs: trim(data.crs), metadata: { crs_units: trim(data.crs_units) } }); }
  catch { throw new NeedsInput('gridding requires a projected CRS or explicit local linear crs_units'); }
  if (unit === 'coordinate_unit') throw new NeedsInput('gridding requires a projected CRS or explicit local linear crs_units');
  return { params, unit };
}
const eligible = (data, channels) => data.records.filter((row) => row.x !== null && row.y !== null && channels.some((name) => row.values[name] !== null));
function cross(a, b, c) {
  const ux = b[0] - a[0]; const uy = b[1] - a[1]; const vx = c[0] - a[0]; const vy = c[1] - a[1];
  const first = Math.max(Math.abs(ux), Math.abs(uy)); const second = Math.max(Math.abs(vx), Math.abs(vy));
  if (first === 0 || second === 0) return 0;
  const value = (ux / first) * (vy / second) - (uy / first) * (vx / second);
  return Math.abs(value) <= 1e-12 ? 0 : value;
}
function hull(points) {
  const positions = points.map((point) => point.slice(0, 2)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (positions.length <= 1) return positions;
  const lower = []; const upper = [];
  for (const point of positions) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop(); lower.push(point); }
  for (const point of [...positions].reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop(); upper.push(point); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
function inside(boundary, x, y) {
  const point = [x, y];
  if (!boundary.length) return false;
  if (boundary.length === 1) return x === boundary[0][0] && y === boundary[0][1];
  if (boundary.length === 2) {
    const [a, b] = boundary;
    return cross(a, b, point) === 0 && x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0]) && y >= Math.min(a[1], b[1]) && y <= Math.max(a[1], b[1]);
  }
  return boundary.every((point, index) => cross(point, boundary[(index + 1) % boundary.length], [x, y]) >= 0);
}
function training(rows, params) {
  const result = new Map(); const diagnostics = {};
  for (const channel of params.channels) {
    const groups = new Map();
    for (const row of rows) {
      const value = row.values[channel]; if (value === null) continue;
      const key = JSON.stringify([row.x, row.y]);
      if (!groups.has(key)) groups.set(key, { xy: [row.x, row.y], values: [] }); groups.get(key).values.push(value);
    }
    const duplicates = [...groups.values()].filter((group) => group.values.length > 1).length;
    if (duplicates && params.duplicate_policy === 'reject') throw Error('coincident channel observations require duplicate_policy=mean or explicit input QC');
    const points = [...groups.values()].map((group) => [...group.xy, sum(group.values) / group.values.length]);
    result.set(channel, { points, hull: hull(points) });
    diagnostics[channel] = { locations: points.length, readings: [...groups.values()].reduce((count, group) => count + group.values.length, 0), duplicate_locations: duplicates };
  }
  return { training: result, diagnostics };
}
function predict(samples, x, y, params) {
  const distances = samples.points.map((point, index) => [Math.hypot(point[0] - x, point[1] - y), index, point[2]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const nearest = distances.length ? distances[0][0] : null;
  const selected = distances.filter((item) => item[0] <= params.radius).slice(0, params.neighbors);
  const extrapolated = !inside(samples.hull, x, y);
  const supported = selected.length >= params.min_neighbors && (!extrapolated || params.extrapolation === 'allow');
  let value = null;
  if (supported) {
    if (selected[0][0] === 0 || params.method === 'nearest') value = selected[0][2];
    else { const weights = selected.map((item) => (selected[0][0] / item[0]) ** params.power); value = sum(weights.map((weight, index) => weight * selected[index][2])) / sum(weights); }
  }
  return { predicted: value, nearest_distance: nearest, neighbors: selected.length, extrapolated, supported };
}
function budget(pairs) { if (pairs > limits.max_pair_evaluations) throw new ResourceError('prediction/holdout pair work exceeds 10000000 evaluations; use smaller survey/grid partitions'); }
function diagnostics(data, rows, params, unit) {
  const z = rows.filter((row) => row.z !== null).map((row) => row.z);
  return { input_records: data.records.length, eligible_records: rows.length, skipped_records: data.records.length - rows.length,
    crs: data.crs, distance_units: unit, channels: Object.fromEntries(params.channels.map((name) => [name, clone(data.channels[name])])),
    elevation: { policy: 'ignore', known: z.length, missing: rows.length - z.length, min: z.length ? z.reduce((a, b) => Math.min(a, b)) : null, max: z.length ? z.reduce((a, b) => Math.max(a, b)) : null },
    height_units: data.metadata.height_units ?? null, height_datum: data.metadata.height_datum ?? null, corrections: clone(data.metadata.corrections ?? {}) };
}
/** Bounded north-up XY interpolation; artifacts retain full resolution and support diagnostics. */
export function gridGeophysicsObservations(payload, options) {
  const result = { ...report('observation_grid'), artifacts: {} };
  try {
    const data = createGeophysicsObservations(payload); const { params, unit } = parameters(data, options, true); result.parameters = params;
    const rows = eligible(data, params.channels); const [height, width] = params.shape;
    const pairs = 2 * height * width * rows.length * params.channels.length; budget(pairs);
    const fitted = training(rows, params);
    if ([...fitted.training.values()].some((item) => !item.points.length)) throw new NeedsInput('each selected channel needs at least one observation with valid XY and reading');
    const [minX, minY, maxX, maxY] = params.bounds; const dx = (maxX - minX) / width; const dy = (maxY - minY) / height;
    if (![dx, dy].every((value) => Number.isFinite(value) && value > 0) || (width > 1 && minX + 0.5 * dx === minX + 1.5 * dx) || (height > 1 && maxY - 0.5 * dy === maxY - 1.5 * dy)) throw Error('grid spacing is not representable at the supplied coordinate scale');
    const details = { ...diagnostics(data, rows, params, unit), training: fitted.diagnostics, pair_evaluations_upper_bound: pairs, supported: {}, extrapolated: {} };
    const snapshot = inputRecord(data.metadata);
    const metadata = { field_type: data.channels[params.channels[0]].field_type, units: params.channels.map((name) => data.channels[name].units), crs_units: unit,
      corrections: clone(details.corrections), observation_metadata: snapshot.metadata, sources: snapshot.sources, channel_definitions: details.channels, elevation: details.elevation,
      processing: [{ operation: 'grid_observations', version: 1, parameters: clone(params), input_records: data.records.length }] };
    if (Object.hasOwn(snapshot.metadata, 'source')) metadata.source = snapshot.metadata.source;
    if (Object.hasOwn(data.metadata, 'baselode_provenance')) metadata.baselode_provenance = clone(data.metadata.baselode_provenance);
    encodeProvenance(metadata, 'GeoTIFF', 'float64');
    const arrays = Object.fromEntries(['grid', 'support', 'neighbor_count', 'nearest_distance', 'extrapolation'].map((key) => [key, params.channels.map(() => Array.from({ length: height }, () => Array(width).fill(null)))]));
    params.channels.forEach((channel, band) => {
      let supported = 0; let extrapolated = 0;
      for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) {
        const prediction = predict(fitted.training.get(channel), minX + (column + 0.5) * dx, maxY - (row + 0.5) * dy, params);
        if (prediction.supported) { arrays.grid[band][row][column] = prediction.predicted; supported += 1; }
        extrapolated += Number(prediction.extrapolated);
        arrays.support[band][row][column] = Number(prediction.supported); arrays.neighbor_count[band][row][column] = prediction.neighbors;
        arrays.nearest_distance[band][row][column] = prediction.nearest_distance; arrays.extrapolation[band][row][column] = Number(prediction.extrapolated);
      }
      details.supported[channel] = supported; details.extrapolated[channel] = extrapolated;
    });
    for (const [key, values] of Object.entries(arrays)) {
      const attributes = clone(metadata);
      if (key !== 'grid') Object.assign(attributes, { field_type: 'other', units: params.channels.map(() => key === 'nearest_distance' ? unit : (key === 'neighbor_count' ? 'count' : '1')), diagnostic: key });
      result.artifacts[key] = createGeophysicsRaster({ data: values, transform: [dx, 0, minX, 0, -dy, maxY], crs: trim(data.crs), bandNames: params.channels, metadata: attributes });
    }
    result.diagnostics = details; return result;
  } catch (error) { result.artifacts = {}; return errorResult(result, error); }
}
function validationOptions(options) {
  const params = jsonOptions(options, descriptor.validation_parameters);
  if (!['line', 'block'].includes(params.by) || !number(params.buffer_distance) || params.buffer_distance < 0) throw Error('validation requires by=line/block and nonnegative buffer_distance');
  if (params.by === 'line' && ['block_size', 'origin'].some((key) => Object.hasOwn(params, key))) throw Error('block_size/origin apply only to by=block');
  if (params.by === 'block') {
    if (['block_size', 'origin'].some((key) => !Object.hasOwn(params, key))) throw new NeedsInput('block validation requires explicit block_size and origin in CRS units');
    for (const key of ['block_size', 'origin']) if (!Array.isArray(params[key]) || params[key].length !== 2 || !params[key].every((value) => number(value) && (key === 'origin' || value > 0))) throw Error('block_size/origin must be XY numeric pairs; block sizes positive');
  }
  return params;
}
function metrics(predictions) {
  const errors = predictions.filter((item) => item.supported).map((item) => item.predicted - item.observed);
  const count = errors.length; const total = predictions.length;
  return { tested: total, supported: count, unsupported: total - count, coverage: total ? count / total : null,
    rmse: count ? Math.sqrt(sum(errors.map((value) => value * value)) / count) : null, mae: count ? sum(errors.map(Math.abs)) / count : null, bias: count ? sum(errors) / count : null };
}
/** Leave out whole lines/blocks, excluding colocated/buffered training rows before aggregation. */
export function crossValidateGeophysicsGridding(payload, options, validation) {
  const result = { ...report('gridding_validation'), folds: [], summary: {} };
  try {
    const data = createGeophysicsObservations(payload); const { params, unit } = parameters(data, options, false); const split = validationOptions(validation);
    result.parameters = { interpolation: params, validation: split };
    const rows = eligible(data, params.channels); budget(rows.length ** 2 * (1 + 2 * params.channels.length));
    const groups = new Map();
    for (const row of rows) {
      let key;
      if (split.by === 'line') { if (row.line_id === null) throw new NeedsInput('line validation requires line_id on every eligible observation'); key = row.line_id; }
      else {
        const ratios = ['x', 'y'].map((axis, index) => (row[axis] - split.origin[index]) / split.block_size[index]);
        if (!ratios.every((value) => Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER)) throw Error('block indices exceed the portable numeric range');
        key = ratios.map((value) => Math.floor(value)).join(':');
      }
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row);
    }
    if (groups.size < 2) throw new NeedsInput('spatial validation requires at least two nonempty line/block groups');
    if (groups.size > limits.max_folds) throw new ResourceError('validation exceeds 64 held-out groups; use meaningful smaller survey partitions');
    const combined = new Map(params.channels.map((name) => [name, []]));
    for (const [key, test] of groups) {
      const ids = new Set(test.map((row) => row.id)); const candidates = rows.filter((row) => !ids.has(row.id));
      const train = candidates.filter((row) => test.every((target) => Math.hypot(row.x - target.x, row.y - target.y) > split.buffer_distance));
      const fitted = training(train, params);
      const fold = { group: key, train_records: train.length, test_records: test.length, excluded_buffer_records: candidates.length - train.length, training: fitted.diagnostics, predictions: [], metrics: {} };
      for (const channel of params.channels) {
        const predictions = test.filter((row) => row.values[channel] !== null).map((row) => ({ id: row.id, channel, observed: row.values[channel], ...predict(fitted.training.get(channel), row.x, row.y, params) }));
        fold.predictions.push(...predictions); combined.get(channel).push(...predictions); fold.metrics[channel] = metrics(predictions);
      }
      result.folds.push(fold);
    }
    result.summary = Object.fromEntries([...combined].map(([name, predictions]) => [name, metrics(predictions)])); result.diagnostics = diagnostics(data, rows, params, unit); return result;
  } catch (error) { result.folds = []; result.summary = {}; return errorResult(result, error); }
}
