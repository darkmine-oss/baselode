/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import schema from './geophysics_observations.schema.json';
import descriptor from './geophysics_observation_qc.json';
import { jsonValue } from './geophysicsProvenance.js';
import { geophysicsCoordinateUnit } from './geophysicsProcessing.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const whitespace = '[ \t\n\r\v\f\u001c-\u001f\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]';
const surroundingWhitespace = new RegExp(`^${whitespace}+|${whitespace}+$`, 'g');
const trim = (value) => typeof value === 'string' ? value.replace(surroundingWhitespace, '') : value;
const text = (value) => typeof value === 'string' && trim(value).length > 0;
const number = (value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e100;
const label = (value) => typeof value === 'string' && [...value].length >= 1 && [...value].length <= 128 && text(value);
const knownKeys = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key));
const fields = ['magnetic_total_field', 'magnetic_anomaly', 'gravity_observed', 'gravity_anomaly', 'gravity_disturbance', 'radiometric', 'radiometric_counts', 'other'];
const limits = descriptor.resources;

// Reject lone UTF-16 code units, including in extension keys, consistently
// with Python's UTF-8 JSON contract. Valid pairs/astral characters are retained.
export function unicodeStrings(value) {
  if (typeof value === 'string') {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0xD800 && code <= 0xDBFF) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xDC00 && next <= 0xDFFF)) throw new TypeError('unpaired Unicode surrogate');
        index += 1;
      } else if (code >= 0xDC00 && code <= 0xDFFF) throw new TypeError('unpaired Unicode surrogate');
    }
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) { unicodeStrings(key); unicodeStrings(item); }
  }
}

/** Independent schema for normalized observation documents. */
export function geophysicsObservationSchema() { return clone(schema); }
/** Discover parameter contracts, assumptions, limits and direct API scope. */
export function describeGeophysicsObservationQc() { return clone(descriptor); }

/** Validate/copy acquisition-order observations; preserve nulls and declared corrections. */
export function createGeophysicsObservations(payload) {
  if (!knownKeys(payload, ['schema', 'version', 'records', 'channels', 'crs', 'crs_units', 'metadata'])) throw new TypeError('observations require an object with known v1 fields');
  const { records, channels } = payload;
  if (!Array.isArray(records) || records.length > limits.max_records) throw new RangeError('records must be a list of at most 100000 observations');
  if (!object(channels) || Object.keys(channels).length < 1 || Object.keys(channels).length > 32 || records.length * Object.keys(channels).length > limits.max_readings) {
    throw new RangeError('require 1..32 channels and at most 250000 channel readings');
  }
  try { jsonValue(payload); unicodeStrings(payload); } catch { throw new TypeError('observations require finite acyclic JSON and valid Unicode scalar strings'); }
  const encoded = JSON.stringify(payload);
  if (new TextEncoder().encode(encoded).length > limits.max_json_bytes) throw new RangeError('observations exceed the 16 MiB JSON limit');
  const document = JSON.parse(encoded);
  if ((Object.hasOwn(document, 'schema') && document.schema !== 'baselode.geophysics.observations') || (Object.hasOwn(document, 'version') && document.version !== 1)) {
    throw new RangeError('unsupported observation schema/version');
  }
  document.schema = 'baselode.geophysics.observations'; document.version = 1;
  for (const name of ['crs', 'crs_units']) {
    if (!Object.hasOwn(document, name)) document[name] = null;
    if (document[name] !== null && !text(document[name])) throw new TypeError(`${name} must be a nonempty string or null`);
  }
  if (!Object.hasOwn(document, 'metadata')) document.metadata = {};
  if (!object(document.metadata)) throw new TypeError('metadata must be a JSON object');
  const corrections = Object.hasOwn(document.metadata, 'corrections') ? document.metadata.corrections : {};
  if (!object(corrections) || !Object.values(corrections).every((state) => ['applied', 'unapplied', 'unknown'].includes(state))) throw new TypeError('corrections must map names to applied, unapplied or unknown');
  for (const [name, channel] of Object.entries(document.channels)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) || !knownKeys(channel, ['field_type', 'units', 'description'])) throw new TypeError('channel names/descriptors violate the v1 schema');
    if (!fields.includes(channel.field_type) || !text(channel.units) || (Object.hasOwn(channel, 'description') && typeof channel.description !== 'string')) {
      throw new TypeError('each channel needs a recognized field_type and nonempty units');
    }
  }
  const ids = new Set();
  document.records.forEach((row, index) => {
    if (!knownKeys(row, ['id', 'x', 'y', 'z', 'time', 'clearance', 'line_id', 'station_id', 'values', 'extra'])) throw new TypeError(`record ${index} must use known v1 fields`);
    if (!label(row.id) || ids.has(row.id)) throw new TypeError('each observation needs a unique nonempty id'); ids.add(row.id);
    for (const key of ['line_id', 'station_id']) {
      if (!Object.hasOwn(row, key)) row[key] = null;
      if (row[key] !== null && !label(row[key])) throw new TypeError(`record ${index} ${key} must be a label or null`);
    }
    for (const key of ['x', 'y', 'z', 'time', 'clearance']) {
      if (!Object.hasOwn(row, key)) row[key] = null;
      if (row[key] !== null && !number(row[key])) throw new TypeError(`record ${index} ${key} must be null or finite numeric within +/-1e100`);
    }
    if (!Object.hasOwn(row, 'values')) row.values = {};
    if (!object(row.values) || Object.keys(row.values).some((key) => !Object.hasOwn(channels, key))) throw new TypeError(`record ${index} has undeclared channel values`);
    for (const name of Object.keys(channels)) {
      if (!Object.hasOwn(row.values, name)) row.values[name] = null;
      if (row.values[name] !== null && !number(row.values[name])) throw new TypeError(`record ${index} channel ${name} must be null or finite numeric within +/-1e100`);
    }
    if (!Object.hasOwn(row, 'extra')) row.extra = {};
    if (!object(row.extra)) throw new TypeError(`record ${index} extra must be a JSON object`);
  });
  if (new TextEncoder().encode(JSON.stringify(document)).length > limits.max_json_bytes) throw new RangeError('normalized observations exceed the 16 MiB JSON limit');
  return document;
}

function optionsContract(options, channels) {
  const supplied = options ?? {};
  if (!knownKeys(supplied, Object.keys(descriptor.parameters.properties))) throw new TypeError('QC options must be an object with known parameter names');
  try { jsonValue(supplied); } catch { throw new TypeError('QC options require finite acyclic JSON'); }
  const result = { spike_window: 5, spike_thresholds: {}, ...clone(supplied) };
  if (!Number.isInteger(result.spike_window) || result.spike_window < 3 || result.spike_window > 101 || result.spike_window % 2 === 0) throw new RangeError('spike_window must be an odd integer from 3 to 101');
  for (const name of ['max_speed', 'max_distance_gap', 'max_time_gap', 'min_clearance']) {
    if (Object.hasOwn(result, name) && (!number(result[name]) || (name !== 'min_clearance' && result[name] <= 0))) throw new RangeError(`${name} must be finite in range, positive except min_clearance`);
  }
  if (!object(result.spike_thresholds) || Object.entries(result.spike_thresholds).some(([name, threshold]) => !Object.hasOwn(channels, name) || !number(threshold) || threshold <= 0)) {
    throw new TypeError('spike_thresholds need positive finite values for declared channels');
  }
  return result;
}
// Neumaier compensated sum retains small readings through cancellation.
function sumFinite(values) {
  let sum = 0; let correction = 0;
  for (const value of values) {
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next;
  }
  return sum + correction;
}
const group = (map, key, index) => { if (!map.has(key)) map.set(key, []); map.get(key).push(index); };

/** Non-destructive QC. ok means checks completed, never scientific survey acceptance. */
export function qcGeophysicsObservations(payload, options = null) {
  const report = { schema: 'baselode.geophysics.observation_qc', version: 1, state: 'ok', issues: [],
    producer: { library: 'baselode', version: typeof __BASELODE_VERSION__ === 'undefined' ? 'unversioned' : __BASELODE_VERSION__, algorithm_version: 1 },
    flags: [], segments: [], edges: [], coincident_locations: [], repeats: [], summary: {},
    coverage: { within_line_edges: 0, speed_edges: 0, skipped_speed_edges: 0, spike_windows: 0, skipped_spike_windows: 0, spike_edge_rows: 0 },
    parameters: {}, assumptions: clone(descriptor.assumptions), flags_truncated: false };
  const seenIssues = new Set();
  const issue = (state, code, message) => {
    const key = JSON.stringify([state, code, message]);
    if (!seenIssues.has(key)) { seenIssues.add(key); report.issues.push({ state, code, message }); }
  };
  let data; let params;
  try { data = createGeophysicsObservations(payload); params = optionsContract(options, data.channels); report.parameters = params; }
  catch (error) { issue('rejected', 'contract', error.message); report.state = 'rejected'; return report; }
  const rows = data.records; const channels = Object.keys(data.channels);
  if (rows.length * params.spike_window * Object.keys(params.spike_thresholds).length > limits.max_spike_window_values) {
    issue('rejected', 'resource', 'spike windows exceed 10000000 channel values; use smaller survey partitions/window'); report.state = 'rejected'; return report;
  }
  const counts = {};
  const flag = (index, code, channel = null, details = {}) => {
    counts[code] = (counts[code] ?? 0) + 1;
    if (report.flags.length < limits.max_flags) report.flags.push({ row: index, id: rows[index].id, code, ...details, ...(channel !== null ? { channel } : {}) });
    else if (!report.flags_truncated) { report.flags_truncated = true; issue('rejected', 'resource', 'QC flag limit exceeded; report is partial'); }
  };
  let distanceUnit = null; let linear = true;
  try { distanceUnit = geophysicsCoordinateUnit({ crs: trim(data.crs), metadata: { crs_units: trim(data.crs_units) } }); if (distanceUnit === 'coordinate_unit') linear = false; }
  catch { linear = false; }
  if (!linear && ['max_speed', 'max_distance_gap'].some((name) => Object.hasOwn(params, name))) issue('needs_input', 'coordinates', 'speed/distance thresholds require a projected CRS or explicit local linear crs_units');
  const heightUnits = data.metadata.height_units;
  let clearanceEnabled = false;
  if (Object.hasOwn(params, 'min_clearance') && text(heightUnits)) {
    try { clearanceEnabled = geophysicsCoordinateUnit({ crs: null, metadata: { crs_units: trim(heightUnits) } }) !== 'coordinate_unit'; } catch { /* Missing/invalid height context remains explicit. */ }
  }
  if (Object.hasOwn(params, 'min_clearance') && !clearanceEnabled) issue('needs_input', 'height_units', 'supply metadata.height_units for measured clearance thresholds');
  const locations = new Map(); const stations = new Map(); let segment;
  let missingTime = false; let missingCoordinates = false; let missingClearance = false;
  rows.forEach((row, index) => {
    const xy = row.x !== null && row.y !== null;
    if (xy) group(locations, JSON.stringify([row.x, row.y]), index); else { flag(index, 'missing_coordinates'); missingCoordinates = true; }
    if (row.time === null && ['max_speed', 'max_time_gap'].some((name) => Object.hasOwn(params, name))) { missingTime = true; flag(index, 'missing_time'); }
    if (row.station_id !== null) group(stations, row.station_id, index);
    if (row.line_id === null) flag(index, 'unassigned_line');
    for (const channel of channels) if (row.values[channel] === null) flag(index, 'missing_value', channel);
    if (clearanceEnabled) {
      if (row.clearance === null) { missingClearance = true; flag(index, 'missing_clearance'); }
      else if (row.clearance < params.min_clearance) flag(index, 'low_clearance', null, { value: row.clearance });
    }
    let reason = row.line_id === null ? 'unassigned_line' : (index === 0 ? 'start' : 'line_change');
    let connect = index > 0 && row.line_id !== null && row.line_id === rows[index - 1].line_id;
    if (connect) {
      report.coverage.within_line_edges += 1;
      const previous = rows[index - 1]; const geometry = xy && previous.x !== null && previous.y !== null;
      const distance = geometry && linear ? Math.hypot(row.x - previous.x, row.y - previous.y) : null;
      const dt = row.time !== null && previous.time !== null ? row.time - previous.time : null;
      reason = Object.hasOwn(params, 'max_distance_gap') && distance === null ? (geometry ? 'distance_context' : 'missing_coordinates') : null;
      if (dt === null && Object.hasOwn(params, 'max_time_gap')) reason = 'missing_time';
      if (dt !== null && dt <= 0) { reason = 'non_increasing_time'; flag(index, reason, null, { previous_id: previous.id }); }
      if (distance !== null && Object.hasOwn(params, 'max_distance_gap') && distance > params.max_distance_gap) { reason ??= 'distance_gap'; flag(index, 'distance_gap', null, { previous_id: previous.id, distance }); }
      if (dt !== null && Object.hasOwn(params, 'max_time_gap') && dt > params.max_time_gap) { reason ??= 'time_gap'; flag(index, 'time_gap', null, { previous_id: previous.id, seconds: dt }); }
      if (reason === null && distance !== null && dt !== null && dt > 0) {
        const speed = distance / dt;
        if (Number.isFinite(speed)) {
          report.edges.push({ from: index - 1, to: index, distance, seconds: dt, speed }); report.coverage.speed_edges += 1;
          if (Object.hasOwn(params, 'max_speed') && speed > params.max_speed) flag(index, 'high_speed', null, { previous_id: previous.id, speed });
        } else {
          reason = 'numeric_range'; report.coverage.skipped_speed_edges += 1;
          flag(index, 'numeric_range', null, { previous_id: previous.id });
          issue('rejected', 'numeric_range', 'speed exceeds numeric range');
        }
      } else {
        report.coverage.skipped_speed_edges += 1;
      }
      connect = reason === null;
    }
    if (!connect) { segment = { line_id: row.line_id, start: index, end: index, count: 1, reason: reason ?? 'unassigned_line' }; report.segments.push(segment); }
    else { segment.end = index; segment.count += 1; }
  });
  if (['max_speed', 'max_distance_gap', 'max_time_gap'].some((name) => Object.hasOwn(params, name)) && rows.length && report.coverage.within_line_edges === 0) issue('needs_input', 'line_context', 'line checks require at least two consecutive records with the same non-null line_id');
  if (missingTime) issue('needs_input', 'time_context', 'supply UTC epoch seconds for rows flagged missing_time');
  if (missingCoordinates && ['max_speed', 'max_distance_gap'].some((name) => Object.hasOwn(params, name))) issue('needs_input', 'distance_context', 'supply XY coordinates for rows flagged missing_coordinates');
  if (missingClearance) issue('needs_input', 'clearance', 'supply measured clearance for rows flagged missing_clearance');
  for (const indexes of locations.values()) if (indexes.length > 1) { report.coincident_locations.push(indexes); for (const index of indexes) flag(index, 'coincident_location'); }
  const half = Math.floor(params.spike_window / 2);
  for (const segment of report.segments) for (const [channel, threshold] of Object.entries(params.spike_thresholds)) {
    report.coverage.spike_edge_rows += Math.min(segment.count, 2 * half);
    for (let index = segment.start + half; index <= segment.end - half; index += 1) {
      const values = rows.slice(index - half, index + half + 1).map((row) => row.values[channel]);
      if (values.some((value) => value === null)) { report.coverage.skipped_spike_windows += 1; continue; }
      values.sort((a, b) => a - b); const median = values[half]; report.coverage.spike_windows += 1;
      const residual = rows[index].values[channel] - median;
      if (Math.abs(residual) > threshold) flag(index, 'spike_candidate', channel, { residual, median });
    }
  }
  if (rows.length && Object.keys(params.spike_thresholds).length && report.coverage.spike_windows === 0) issue('needs_input', 'spike_context', 'no complete spike windows; supply readings/longer contiguous lines or choose a smaller odd window');
  for (const [stationId, indexes] of stations) {
    if (indexes.length < 2) continue;
    const positions = new Set(indexes.filter((index) => rows[index].x !== null && rows[index].y !== null).map((index) => JSON.stringify([rows[index].x, rows[index].y])));
    const complete = indexes.every((index) => rows[index].x !== null && rows[index].y !== null);
    if (positions.size > 1) for (const index of indexes) flag(index, 'station_location_mismatch');
    const summary = { station_id: stationId, rows: indexes, same_location: complete ? positions.size === 1 : null, channels: {} };
    for (const channel of channels) {
      const values = indexes.map((index) => rows[index].values[channel]).filter((value) => value !== null);
      if (!values.length) continue;
      const mean = sumFinite(values) / values.length;
      const deviation = values.length > 1 ? Math.sqrt(sumFinite(values.map((value) => (value - mean) ** 2)) / (values.length - 1)) : null;
      const minimum = values.reduce((a, b) => Math.min(a, b)); const maximum = values.reduce((a, b) => Math.max(a, b));
      summary.channels[channel] = { count: values.length, mean, min: minimum, max: maximum, range: maximum - minimum, sample_std: deviation };
    }
    report.repeats.push(summary);
  }
  report.summary = { records: rows.length, channels: channels.length, flags_by_code: counts,
    channel_definitions: clone(data.channels), crs: data.crs, height_datum: clone(data.metadata.height_datum ?? null),
    distance_units: linear ? distanceUnit : null, height_units: typeof heightUnits === 'string' ? heightUnits : null, corrections: clone(data.metadata.corrections ?? {}) };
  report.state = report.issues.some((item) => item.state === 'rejected') ? 'rejected' : (report.issues.length ? 'needs_input' : 'ok');
  return report;
}
