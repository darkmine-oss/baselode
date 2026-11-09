/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import descriptor from './geophysics_corrections.json';
import gravityTemporalDescriptor from './geophysics_gravity_temporal.json';
import reprojectionDescriptor from './geophysics_reprojection.json';
import proj4 from 'proj4';
import { createGeophysicsObservations, qcGeophysicsObservations, unicodeStrings } from './geophysicsObservations.js';
import { jsonValue, appendInput, encodeProvenance } from './geophysicsProvenance.js';
import { geophysicsCoordinateUnit } from './geophysicsProcessing.js';
import { computeCrossovers, crossoverSum, crossoverRms, describeGeophysicsCrossovers, CrossoverResourceError } from './geophysicsCrossovers.js';
export { describeGeophysicsCrossovers };
const clone = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, names) => object(value) && Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
const spaces = '[ \\t\\n\\r\\v\\f\\u001c-\\u001f\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]';
const surrounding = new RegExp(`^${spaces}+|${spaces}+$`, 'g');
const trim = (value) => typeof value === 'string' ? value.replace(surrounding, '') : value;
const text = (value) => typeof value === 'string' && trim(value).length > 0;
const label = (value) => text(value) && [...value].length <= 128;
const evidence = (value) => text(value) && [...value].length <= 4096;
const limits = descriptor.resources;
const number = (value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limits.numeric_bound;
const digest = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const schema = 'baselode.geophysics.correction_ledger';
const algorithm = 'sha256-float64-v1';
const aliases = new Map(Object.entries(descriptor.catalogue).flatMap(([name, item]) => item.aliases.map((alias) => [alias.toLowerCase().replace(/[ _-]/g, ''), name])));
const canonical = (value) => typeof value === 'string' ? aliases.get(value.toLowerCase().replace(/[ _-]/g, '')) : undefined;
class NeedsInput extends Error {}
class ResourceError extends Error {}
const producer = () => ({ library: 'baselode', version: typeof __BASELODE_VERSION__ === 'undefined' ? 'unversioned' : __BASELODE_VERSION__, algorithm_version: 1 });
/** Independent ledger/schema/alias/parameter contracts. No asynchronous work. */
export function describeGeophysicsCorrections() { return clone(descriptor); }
function report(operation) { return { schema: 'baselode.geophysics.corrections', version: 1, operation, state: 'ok', issues: [], observations: null, ledger: null, states: {}, proposals: [], diagnostics: {}, parameters: {}, producer: producer(), assumptions: clone(descriptor.assumptions) }; }
function errorResult(result, error) {
  result.state = error instanceof NeedsInput ? 'needs_input' : 'rejected';
  result.issues.push({ code: error instanceof NeedsInput ? 'context' : ((error instanceof ResourceError || error instanceof CrossoverResourceError) ? 'resource' : 'contract'), message: error.message });
  Object.assign(result, { observations: null, ledger: null, states: {} }); return result;
}
function json(value) {
  jsonValue(value); unicodeStrings(value);
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).length > limits.max_options_bytes) throw new ResourceError('correction options/declarations exceed 256 KiB');
  return JSON.parse(encoded);
}
function channelsFor(data, correction) {
  const family = descriptor.catalogue[correction].family;
  return Object.keys(data.channels).filter((name) => data.channels[name].field_type.startsWith(family)).sort();
}
async function binding(data) {
  const names = Object.keys(data.channels).sort(); const buffer = new ArrayBuffer(8); const view = new DataView(buffer);
  function hexNumber(value) {
    if (value === null) return null;
    if (!number(value)) throw Error('correction binding requires finite binary64 values within +/-1e100; integers must be exactly representable');
    view.setFloat64(0, value === 0 ? 0 : value, false);
    return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  const rows = data.records.map((row) => [row.id, ...['x', 'y', 'z', 'time', 'clearance'].map((name) => hexNumber(row[name])), row.line_id, row.station_id, names.map((name) => hexNumber(row.values[name]))]);
  const snapshot = ['baselode.correction_binding.v1', data.crs, data.crs_units, names.map((name) => [name, data.channels[name].field_type, data.channels[name].units]), rows];
  const encoded = new TextEncoder().encode(JSON.stringify(snapshot));
  if (encoded.length > limits.max_binding_bytes) throw new ResourceError('correction binding snapshot exceeds 32 MiB');
  if (!globalThis.crypto?.subtle) throw new NeedsInput('SHA-256 binding requires Web Crypto (Node 20+ or a secure browser context)');
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', encoded))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function statesFor(data, ledger) {
  const states = Object.fromEntries(Object.keys(descriptor.catalogue).map((name) => [name, Object.fromEntries(channelsFor(data, name).map((channel) => [channel, 'unknown']))]));
  for (const entry of ledger.entries.filter((item) => item.kind !== 'reprojection')) for (const channel of entry.channels) states[entry.correction][channel] = entry.state;
  return states;
}
function baseOptions(options) {
  const contract = descriptor.base_parameters;
  if (!object(options) || Object.keys(options).some((name) => !Object.hasOwn(contract.properties, name))) throw Error('base correction requires known option names');
  const params = json(options);
  if (contract.required.some((name) => !Object.hasOwn(params, name))) throw new NeedsInput('supply channel, base_channel, reference, max_gap, event_id, evidence and clock_policy');
  if (!['channel', 'base_channel'].every((name) => typeof params[name] === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(params[name]))) throw Error('channel/base_channel must be declared channel names');
  if (!number(params.reference) || !number(params.max_gap) || params.max_gap <= 0) throw Error('reference must be finite nT and max_gap a positive time distance in range');
  if (!label(params.event_id) || !evidence(params.evidence)) throw Error('event_id/evidence require nonempty bounded strings');
  if (params.clock_policy !== 'synchronized') throw new NeedsInput('clock_policy must explicitly acknowledge synchronized UTC Unix seconds');
  return params;
}
function igrfOptions(options) {
  const contract = descriptor.igrf_parameters;
  if (!object(options) || Object.keys(options).some((name) => !Object.hasOwn(contract.properties, name))) throw Error('IGRF removal requires known option names');
  const params = json(options);
  if (contract.required.some((name) => !Object.hasOwn(params, name))) throw new NeedsInput('supply channel, event_id, evidence and explicit model=IGRF14');
  if (typeof params.channel !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(params.channel)) throw Error('channel must be a declared channel name');
  if (!label(params.event_id) || !evidence(params.evidence) || params.model !== 'IGRF14') throw Error('IGRF removal requires bounded event_id/evidence and model=IGRF14');
  return params;
}

function lagOptions(options) {
  const contract = descriptor.lag_parameters;
  if (!object(options) || Object.keys(options).some((name) => !Object.hasOwn(contract.properties, name))) throw Error('lag correction requires known option names');
  const params = json(options);
  if (contract.required.some((name) => !Object.hasOwn(params, name))) throw new NeedsInput('supply channel, lag_seconds, max_gap, unsupported_policy, event_id, evidence and clock_policy');
  if (typeof params.channel !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(params.channel)) throw Error('channel must be a declared channel name');
  if (!number(params.lag_seconds) || Math.abs(params.lag_seconds) > 3600 || !number(params.max_gap) || params.max_gap <= 0) throw Error('lag_seconds must be within +/-3600 and max_gap finite positive seconds');
  if (!['reject', 'mask'].includes(params.unsupported_policy) || !label(params.event_id) || !evidence(params.evidence)) throw Error('lag requires explicit reject/mask policy and bounded event_id/evidence');
  if (params.clock_policy !== 'synchronized') throw new NeedsInput('clock_policy must explicitly acknowledge synchronized UTC Unix seconds');
  return params;
}
function headingOptions(options) {
  const contract = descriptor.heading_parameters;
  if (!object(options) || Object.keys(options).some((name) => !Object.hasOwn(contract.properties, name))) throw Error('heading correction requires known option names');
  const params = json(options);
  if (contract.required.some((name) => !Object.hasOwn(params, name))) throw new NeedsInput('supply all heading/calibration, gap, sign, event and evidence options');
  if (!['channel', 'heading_key'].every((name) => typeof params[name] === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(params[name]))) throw Error('channel and heading_key must be named fields');
  if (!['true_north', 'magnetic_north', 'grid_north'].includes(params.heading_reference) || params.bias_convention !== 'observed_minus_reference') throw Error('declare a supported heading reference and observed_minus_reference bias convention');
  if (!label(params.calibration_id) || !label(params.event_id) || !evidence(params.evidence)) throw Error('calibration_id/event_id/evidence require nonempty bounded strings');
  if (!number(params.max_heading_gap) || params.max_heading_gap <= 0 || params.max_heading_gap > 180) throw Error('max_heading_gap must be finite degrees in (0,180]');
  const nodes = params.calibration;
  if (!Array.isArray(nodes) || nodes.length < 2) throw Error('calibration requires at least two heading/bias nodes');
  if (nodes.length > limits.max_heading_nodes) throw new ResourceError('heading calibration accepts at most 72 nodes');
  for (const node of nodes) if (!keys(node, ['heading_degrees', 'bias_nT']) || !number(node.heading_degrees) || node.heading_degrees < 0 || node.heading_degrees >= 360 || !number(node.bias_nT)) throw Error('calibration nodes require finite unique headings in [0,360) and bias_nT');
  nodes.sort((a, b) => a.heading_degrees - b.heading_degrees);
  if (nodes.some((node, index) => index && node.heading_degrees === nodes[index - 1].heading_degrees)) throw Error('calibration headings must be unique');
  return params;
}
function rawHeading(row, key) { return Object.hasOwn(row.extra, key) ? row.extra[key] : null; }
async function headingBinding(data, params) {
  if (data.records.length > limits.max_heading_records) throw new ResourceError('heading correction accepts at most 4096 records');
  const context = data.metadata.heading;
  if (!keys(context, ['key', 'units', 'reference', 'positive']) || context.key !== params.heading_key || context.units !== 'degrees' || context.reference !== params.heading_reference || context.positive !== 'clockwise') throw new NeedsInput('declare metadata.heading key/units=degrees/reference/positive=clockwise matching heading options');
  const buffer = new ArrayBuffer(8); const view = new DataView(buffer);
  function hexNumber(value) { view.setFloat64(0, value === 0 ? 0 : value, false); return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
  const rows = data.records.map((row) => {
    const heading = rawHeading(row, params.heading_key);
    if (heading !== null && (!number(heading) || heading < 0 || heading > 360)) throw Error('every supplied heading must be a finite clockwise angle in [0,360] degrees');
    return [row.id, heading === null ? null : hexNumber(heading)];
  });
  const snapshot = ['baselode.heading_binding.v1', params.channel, params.heading_key, params.heading_reference, params.calibration_id, params.bias_convention, hexNumber(params.max_heading_gap), params.calibration.map((n) => [hexNumber(n.heading_degrees), hexNumber(n.bias_nT)]), ['key', 'units', 'reference', 'positive'].map((n) => context[n]), rows];
  const encoded = new TextEncoder().encode(JSON.stringify(snapshot));
  if (encoded.length > limits.max_binding_bytes) throw new ResourceError('heading input binding exceeds 32 MiB');
  if (!globalThis.crypto?.subtle) throw new NeedsInput('SHA-256 binding requires Web Crypto (Node 20+ or a secure browser context)');
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', encoded))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function crossoverOptions(options, level = false) {
  const schema = level ? descriptor.levelling_parameters : descriptor.crossover_parameters;
  if (!object(options) || Object.keys(options).some((n) => !Object.hasOwn(schema.properties,n))) throw Error('crossover/levelling options require known names');
  const params = json(options);
  if (schema.required.some((n) => !Object.hasOwn(params,n))) throw new NeedsInput('supply all explicit geometry, elevation and (for levelling) role/quality/event options');
  if (typeof params.channel !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(params.channel)) throw Error('channel must be a declared scalar observation channel');
  if (!number(params.max_segment_length) || params.max_segment_length <= 0 || params.max_segment_length > 1e9 || !number(params.min_crossing_angle) || params.min_crossing_angle <= 0 || params.min_crossing_angle > 90) throw Error('supply positive max_segment_length<=1e9 and min_crossing_angle<=90');
  const tol = params.intersection_tolerance;
  if (!number(tol) || tol < 1e-9 || tol > 1e6 || tol > params.max_segment_length/100) throw Error('intersection_tolerance must be [1e-9,1e6] and <=max_segment_length/100');
  if (!['ignore','limit'].includes(params.elevation_policy)) throw Error('elevation_policy must be explicitly ignore or limit');
  if (params.elevation_policy === 'ignore' && params.max_height_difference !== null) throw Error('ignore elevation requires max_height_difference=null');
  if (params.elevation_policy === 'limit' && (!number(params.max_height_difference) || params.max_height_difference < 0)) throw Error('limit elevation requires a nonnegative native-height-unit difference');
  if (!level) return params;
  for (const n of ['reference_lines','target_lines']) if (!Array.isArray(params[n]) || !params[n].length || !params[n].every(label) || new Set(params[n]).size !== params[n].length) throw Error('reference_lines/target_lines must be nonempty unique label lists');
  if (params.reference_lines.length+params.target_lines.length > limits.max_crossover_lines) throw new ResourceError('levelling accepts at most 128 lines');
  if (params.reference_lines.some((line) => params.target_lines.includes(line))) throw Error('reference and target line roles must be disjoint');
  for (const [n,upper] of [['min_crossovers',8192],['min_reference_lines',params.reference_lines.length]]) if (!Number.isInteger(params[n]) || params[n] < 1 || params[n] > upper) throw Error('min_crossovers/min_reference_lines must be positive integers within available bounds');
  if (!['max_abs_correction','max_rms_residual'].every((n) => number(params[n]) && params[n] >= 0)) throw Error('levelling quality bounds must be finite nonnegative nT');
  if (!label(params.event_id) || !evidence(params.evidence)) throw Error('event_id/evidence require nonempty bounded strings');
  return params;
}
const levellingOptions = (options) => crossoverOptions(options,true);
function crossoverContext(data, params) {
  if (data.records.length > limits.max_crossover_records) throw new ResourceError('crossovers/levelling accept at most 4096 records');
  if (!Object.hasOwn(data.channels,params.channel)) throw Error('select a declared scalar observation channel');
  let unit;
  try { unit = geophysicsCoordinateUnit({crs:trim(data.crs),metadata:{crs_units:trim(data.crs_units)}}); }
  catch { throw new NeedsInput('crossovers require projected/local Cartesian coordinates with matching linear units'); }
  if (!['m','ft','us-ft','km'].includes(unit)) throw new NeedsInput('declare projected/local linear coordinate units');
  let height = null;
  if (params.elevation_policy === 'limit') {
    const meta = data.metadata;
    if (!label(meta.height_datum) || ['unknown','unspecified'].includes(trim(meta.height_datum).toLowerCase()) || !['up','down'].includes(meta.z_positive)) throw new NeedsInput('height-limited crossovers need a known height_datum and explicit up/down z_positive');
    let hunit; try { hunit = geophysicsCoordinateUnit({crs:null,metadata:{crs_units:trim(meta.height_units)}}); }
    catch { throw new NeedsInput('height-limited crossovers require declared linear height_units'); }
    if (!['m','ft','us-ft','km'].includes(hunit)) throw new NeedsInput('height-limited crossovers require declared linear height_units');
    height = [hunit,meta.height_datum,meta.z_positive];
  }
  return [unit,height];
}
function crossoverPrepare(data,params) {
  const context = crossoverContext(data,params);
  for (const row of data.records) {
    if (row.x === null || row.y === null || row.line_id === null) throw new NeedsInput('every crossover record requires XY and a line_id, including missing-reading markers');
    if (Math.abs(row.x) > 1e12 || Math.abs(row.y) > 1e12) throw Error('crossover XY coordinates must be within +/-1e12');
  }
  return context;
}
async function levellingBinding(data,params,offsets) {
  const context = crossoverContext(data,params); const roles = [...params.reference_lines,...params.target_lines];
  const actual = new Set(data.records.map((row) => row.line_id));
  if (actual.size !== roles.length || roles.some((line) => !actual.has(line))) throw Error('reference/target roles must cover exactly every observation line_id');
  if (!Array.isArray(offsets) || offsets.length !== roles.length) throw Error('line_offsets must contain every reference then target in declared order');
  offsets.forEach((item,index) => {
    if (!keys(item,['line_id','bias_nT']) || item.line_id !== roles[index] || !number(item.bias_nT)) throw Error('invalid canonical line-offset model');
    if ((index < params.reference_lines.length && item.bias_nT !== 0) || Math.abs(item.bias_nT) > params.max_abs_correction) throw Error('reference offsets must be zero and target offsets within the declared limit');
  });
  const buffer = new ArrayBuffer(8); const view = new DataView(buffer);
  const hex = (value) => { view.setFloat64(0,value === 0 ? 0 : value,false); return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2,'0')).join(''); };
  const snapshot = ['baselode.levelling_binding.v1',params.channel,...['max_segment_length','min_crossing_angle','intersection_tolerance'].map((n) => hex(params[n])),params.elevation_policy,params.max_height_difference === null ? null : hex(params.max_height_difference),params.reference_lines,params.target_lines,params.min_crossovers,params.min_reference_lines,hex(params.max_abs_correction),hex(params.max_rms_residual),context,offsets.map((item) => [item.line_id,hex(item.bias_nT)])];
  const encoded = new TextEncoder().encode(JSON.stringify(snapshot));
  if (encoded.length > limits.max_binding_bytes) throw new ResourceError('levelling model binding exceeds 32 MiB');
  if (!globalThis.crypto?.subtle) throw new NeedsInput('SHA-256 binding requires Web Crypto (Node 20+ or a secure browser context)');
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',encoded))].map((b) => b.toString(16).padStart(2,'0')).join('');
}

function applicationCounts(data, entries) {
  const counts = Object.fromEntries(Object.keys(data.channels).map((name) => [name, data.records.filter((row) => row.values[name] !== null).length]));
  const rows = new Map(data.records.map((row) => [row.id, row])); const expected = new Map(); const seen = new Map();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!object(entry) || entry.kind !== 'application') continue;
    const channels = entry.channels;
    if (!Array.isArray(channels) || channels.length !== 1 || typeof channels[0] !== 'string' || !Object.hasOwn(counts, channels[0])) continue;
    const channel = channels[0];
    if (entry.correction === 'magnetic_lag') {
      if (!Array.isArray(entry.masked_records) || entry.masked_records.length > limits.max_lag_records) throw Error('lag masked_records must be a bounded list');
      if (!seen.has(channel)) seen.set(channel, new Set());
      for (const item of entry.masked_records) {
        if (!keys(item, ['id', 'value']) || !label(item.id) || !rows.has(item.id) || !number(item.value)) throw Error('lag masked_records need existing IDs and finite original values');
        if (seen.get(channel).has(item.id) || rows.get(item.id).values[channel] !== null) throw Error('lag masks must be unique per channel and remain null in current observations');
        seen.get(channel).add(item.id);
      }
      counts[channel] += entry.masked_records.length;
    }
    expected.set(index, counts[channel]);
  }
  return expected;
}

async function validate(data, ledger, current, checkSummary = true) {
  if (!keys(ledger, ['schema', 'version', 'algorithm', 'initial_binding', 'current_binding', 'entries']) || ledger.schema !== schema || ledger.version !== 1 || ledger.algorithm !== algorithm) throw Error('unsupported or malformed correction ledger');
  if (!digest(ledger.initial_binding) || !digest(ledger.current_binding)) throw Error('ledger bindings must be lowercase SHA-256 digests');
  if (!Array.isArray(ledger.entries)) throw Error('correction ledger entries must be a list');
  if (ledger.entries.length > limits.max_events) throw new ResourceError('correction ledger exceeds 64 events');
  const common = ['id', 'kind', 'correction', 'channels', 'state', 'evidence', 'producer', 'input_binding', 'output_binding'];
  const baseExtra = ['parameters', 'base_binding', 'base_station_id', 'affected_records'];
  const igrfExtra = ['parameters', 'model', 'affected_records'];
  const frames = await reprojectionFrames(data, ledger.entries);
  const counts = applicationCounts(data, ledger.entries);
  const states = statesFor(data, { entries: [] }); let previous = ledger.initial_binding; const ids = new Set();
  for (const [index, entry] of ledger.entries.entries()) {
    if (object(entry) && entry.kind === 'reprojection') {
      if (ids.has(entry.id) || entry.input_binding !== previous) throw Error('duplicate event ID or broken reprojection binding chain');
      ids.add(entry.id); previous = entry.output_binding; continue;
    }
    const extraSets={magnetic_igrf:igrfExtra,magnetic_lag:['parameters','masked_records','affected_records'],magnetic_heading:['parameters','heading_binding','affected_records'],magnetic_levelling:['parameters','line_offsets','levelling_binding','affected_records'],gravity_bouguer:['parameters','model','topography_binding','affected_records'],gravity_terrain:['parameters','model','topography_binding','affected_records'],gravity_normal:['parameters','model','normal_binding','affected_records'],gravity_tide:['parameters','temporal_binding','affected_records'],gravity_drift:['parameters','model','temporal_binding','affected_records']};
    const extra=typeof entry?.correction==='string'&&Object.hasOwn(extraSets,entry.correction)?extraSets[entry.correction]:baseExtra;
    if (!object(entry) || !['declaration', 'application'].includes(entry.kind) || !keys(entry, [...common, ...(entry.kind === 'application' ? extra : [])])) throw Error('malformed correction ledger event');
    const correction = entry.correction;
    if (typeof correction !== 'string' || !Object.hasOwn(states, correction) || !label(entry.id) || ids.has(entry.id) || !evidence(entry.evidence)) throw Error('ledger events need unique IDs, registered correction and bounded evidence');
    ids.add(entry.id);
    const channels = entry.channels;
    if (!Array.isArray(channels) || !channels.length || !channels.every((name) => typeof name === 'string' && Object.hasOwn(states[correction], name)) || new Set(channels).size !== channels.length) throw Error('ledger event channels must be unique and applicable to the correction family');
    if (!['unknown', 'unapplied', 'applied'].includes(entry.state) || entry.input_binding !== previous || !digest(entry.output_binding)) throw Error('invalid ledger state or broken binding chain');
    if (!keys(entry.producer, ['library', 'version', 'algorithm_version']) || entry.producer.library !== 'baselode' || !label(entry.producer.version) || entry.producer.algorithm_version !== 1) throw Error('invalid ledger producer/version');
    if (entry.kind === 'declaration') {
      if (entry.output_binding !== previous || channels.some((name) => states[correction][name] !== 'unknown' && states[correction][name] !== entry.state)) throw Error('declarations cannot change data or reset known correction history');
    } else {
      let params;
      try { const parsers=new Map([['magnetic_igrf',igrfOptions],['magnetic_lag',lagOptions],['magnetic_heading',headingOptions],['magnetic_levelling',levellingOptions],['gravity_bouguer',gravityPlateOptions],['gravity_terrain',gravityTerrainOptions],['gravity_normal',normalOptions],['gravity_tide',gravityTideOptions],['gravity_drift',gravityDriftOptions]]);params=(parsers.get(correction)??baseOptions)(entry.parameters); }
      catch (error) { if (error instanceof NeedsInput) throw Error(`invalid stored application parameters: ${error.message}`); throw error; }
      const count = counts.get(index);
      if (!['magnetic_diurnal', 'magnetic_igrf', 'magnetic_lag', 'magnetic_heading', 'magnetic_levelling', 'gravity_normal','gravity_tide','gravity_drift','gravity_bouguer','gravity_terrain'].includes(correction) || channels.length !== 1 || entry.state !== 'applied' || channels.some((name) => states[correction][name] !== 'unapplied')) throw Error('application requires unapplied supported correction history for one channel');
      if (params.channel !== channels[0] || params.event_id !== entry.id || params.evidence !== entry.evidence) throw Error('application parameters do not match the ledger event');
      if (correction === 'magnetic_diurnal' && (!digest(entry.base_binding) || !label(entry.base_station_id))) throw Error('invalid base application binding/station');
      if (correction === 'magnetic_igrf' && (!keys(entry.model, Object.keys(descriptor.igrf_model.const)) || Object.entries(descriptor.igrf_model.const).some(([key, value]) => entry.model[key] !== value))) throw Error('invalid IGRF model/coefficient/convention identity');
      if (correction === 'magnetic_lag' && ((params.unsupported_policy === 'reject' && entry.masked_records.length) || count <= entry.masked_records.length)) throw Error('lag masks require explicit mask policy and at least one supported reading');
      if (correction === 'magnetic_heading') {
        let currentHeading;
        try { currentHeading = await headingBinding(data, params); }
        catch (error) { if (error instanceof NeedsInput) throw Error(`invalid stored heading context: ${error.message}`); throw error; }
        if (!digest(entry.heading_binding) || entry.heading_binding !== currentHeading) throw Error('stale heading binding: heading inputs, context or calibration changed');
      }
      if (correction === 'magnetic_levelling') {
        let currentModel;
        try { currentModel = await levellingBinding({...data,...frames[index]},params,entry.line_offsets); }
        catch (error) { if (error instanceof NeedsInput) throw Error(`invalid stored levelling context: ${error.message}`); throw error; }
        if (!digest(entry.levelling_binding) || entry.levelling_binding !== currentModel) throw Error('stale levelling binding: line roles/model, semantic options or context changed');
      }
      if(correction==='gravity_normal') {
        if(['gravity_free_air','gravity_bouguer','gravity_terrain'].some(k=>states[k][channels[0]]!=='unapplied'))throw Error('normal-at-height application requires unapplied height reductions');
        const model=descriptor.gravity_models[params.model];
        if(!keys(entry.model,Object.keys(model))||Object.entries(model).some(([key,value])=>entry.model[key]!==value))throw Error('invalid normal gravity model/backend identity');
        let normal;
        try{normal=await normalBinding({...data,...frames[index]},params);}
        catch(error){if(error instanceof NeedsInput)throw Error(`invalid stored gravity context: ${error.message}`);throw error;}
        if(!digest(entry.normal_binding)||entry.normal_binding!==normal)throw Error('stale normal gravity context/model binding');
      }
      if(['gravity_tide','gravity_drift'].includes(correction)) {
        if(['gravity_normal','gravity_free_air','gravity_bouguer','gravity_terrain'].some(k=>states[k][channels[0]]!=='unapplied')||(correction==='gravity_drift'&&states.gravity_tide[channels[0]]!=='applied'))throw Error('temporal gravity application conflicts with reference/height or tide history');
        let temporal;
        try{temporal=await gravityTemporalBinding(data,params,entry.model??null);}
        catch(error){if(error instanceof NeedsInput)throw Error(`invalid stored temporal gravity context: ${error.message}`);throw error;}
        if(!digest(entry.temporal_binding)||entry.temporal_binding!==temporal)throw Error('stale temporal gravity context/effects/model binding');
      }
      if(['gravity_bouguer','gravity_terrain'].includes(correction)) {
        let bound;
        try {
          gravityTopographyHistory(states,channels[0],correction==='gravity_terrain');
          const model=descriptor.gravity_topography_models[correction];
          if(!keys(entry.model,Object.keys(model))||Object.entries(model).some(([k,v])=>entry.model[k]!==v))throw Error('invalid gravity topography model identity');
          if(correction==='gravity_terrain')matchingGravityPlate(ledger.entries.slice(0,index),params);
          bound=await gravityTopographyBinding({...data,...frames[index]},params,entry.model);
        }catch(error){if(error instanceof NeedsInput)throw Error('invalid stored topography context: '+error.message);throw error;}
        if(!digest(entry.topography_binding)||entry.topography_binding!==bound)throw Error('stale gravity topography parameters/model/context binding');
      }
      if (!Number.isInteger(entry.affected_records) || entry.affected_records !== count || count < 1) throw Error('application must account for every nonnull channel reading immediately before that event');
    }
    for (const name of channels) states[correction][name] = entry.state;
    previous = entry.output_binding;
  }
  if (previous !== ledger.current_binding || current !== previous) throw Error('stale ledger binding: observation data changed; use a traceable source dataset');
  if (!checkSummary) return ledger;
  const legacy = data.metadata.corrections ?? {};
  for (const correction of new Set(ledger.entries.filter((entry) => entry.kind !== 'reprojection').map((entry) => entry.correction))) if (!Object.hasOwn(legacy, correction)) throw Error('legacy correction summary is missing a ledger correction');
  for (const [key, state] of Object.entries(legacy)) {
    const correction = canonical(key);
    if (correction && Object.keys(states[correction]).length) {
      const values = new Set(Object.values(states[correction])); const aggregate = values.size === 1 ? [...values][0] : 'unknown';
      if (state !== aggregate) throw Error('legacy correction summary conflicts with ledger channel states');
    }
  }
  return ledger;
}
async function load(data) {
  const current = await binding(data);
  encodeProvenance(data.metadata, 'GeoTIFF', 'float64');
  if (Object.hasOwn(data.metadata, 'correction_ledger')) return validate(data, clone(data.metadata.correction_ledger), current);
  if ((data.metadata.processing ?? []).some((step) => ['correct_magnetic_base', 'remove_igrf', 'correct_magnetic_lag', 'correct_magnetic_heading', 'level_magnetic_lines', 'reproject_observations','remove_normal_gravity','apply_gravity_tide','correct_gravity_drift','apply_bouguer_plate','correct_gravity_terrain'].includes(step.operation))) throw Error('processing records a correction but its ledger is missing; restore the bound document instead of declaring unapplied');
  const ledger = { schema, version: 1, algorithm, initial_binding: current, current_binding: current, entries: [] }; const groups = new Map();
  for (const [alias, state] of Object.entries(data.metadata.corrections ?? {})) {
    const correction = canonical(alias);
    if (correction && channelsFor(data, correction).length) { if (!groups.has(correction)) groups.set(correction, []); groups.get(correction).push([alias, state]); }
  }
  for (const correction of [...groups.keys()].sort()) {
    const pairs = groups.get(correction);
    if (new Set(pairs.map(([, state]) => state)).size !== 1) throw Error('conflicting legacy correction aliases require explicit source-history repair');
    ledger.entries.push({ id: `legacy:${correction}`, kind: 'declaration', correction, channels: channelsFor(data, correction), state: pairs[0][1], evidence: `Imported metadata.corrections for ${correction} (${pairs.length} aliases)`, producer: producer(), input_binding: current, output_binding: current });
  }
  return validate(data, ledger, current, false);
}
async function save(data, ledger) {
  if (ledger.entries.length > limits.max_events) throw new ResourceError('correction ledger exceeds 64 events');
  await validate(data, ledger, await binding(data), false);
  const states = statesFor(data, ledger); data.metadata.corrections ??= {}; const legacy = data.metadata.corrections;
  for (const key of [...Object.keys(legacy), ...[...new Set(ledger.entries.filter((entry) => entry.kind !== 'reprojection').map((entry) => entry.correction))].sort()]) {
    const correction = canonical(key);
    if (correction && Object.keys(states[correction]).length) { const values = new Set(Object.values(states[correction])); legacy[key] = values.size === 1 ? [...values][0] : 'unknown'; }
  }
  data.metadata.correction_ledger = ledger;
  if (new TextEncoder().encode(JSON.stringify(data)).length > limits.max_output_json_bytes) throw new ResourceError('output observations including lineage exceed the 16 MiB JSON limit');
  encodeProvenance(data.metadata, 'GeoTIFF', 'float64');
  return createGeophysicsObservations(data);
}
/** Inspect binding/history without changing the supplied observation document. */
export async function inspectGeophysicsCorrections(payload) {
  const result = report('inspect');
  try { const data = createGeophysicsObservations(payload); const ledger = await load(data); Object.assign(result, { ledger, states: statesFor(data, ledger) }); return result; }
  catch (error) { return errorResult(result, error); }
}
/** Append evidence-backed declarations; known states cannot be reset. */
export async function declareGeophysicsCorrections(payload, declarations) {
  const result = report('declare');
  try {
    const data = createGeophysicsObservations(payload); const ledger = await load(data); const items = json(declarations);
    if (!Array.isArray(items) || !items.length) throw Error('declarations must be a nonempty list');
    if (items.length + ledger.entries.length > limits.max_events) throw new ResourceError('declarations exceed the 64-event ledger limit');
    for (const item of items) {
      if (!keys(item, ['id', 'correction', 'channels', 'state', 'evidence'])) throw Error('declarations need exactly id, correction, channels, state and evidence');
      ledger.entries.push({ ...item, kind: 'declaration', producer: producer(), input_binding: ledger.current_binding, output_binding: ledger.current_binding });
    }
    const output = await save(data, ledger); await validate(output, ledger, await binding(output));
    Object.assign(result, { observations: output, ledger: clone(ledger), states: statesFor(output, ledger), parameters: { declarations: items } }); return result;
  } catch (error) { return errorResult(result, error); }
}
/** Subtract synchronized base variation only with complete coverage and unapplied history. */
export async function correctGeophysicsMagneticBase(payload, base, options) {
  const result = report('magnetic_base');
  try {
    const data = createGeophysicsObservations(payload); const monitor = createGeophysicsObservations(base); const params = baseOptions(options); result.parameters = params;
    const ledger = await load(data); const monitorLedger = await load(monitor); const baseBinding = monitorLedger.current_binding; const channel = params.channel; const baseChannel = params.base_channel;
    if (!Object.hasOwn(data.channels, channel) || !Object.hasOwn(monitor.channels, baseChannel)) throw Error('selected channel/base_channel must be declared');
    if (!['magnetic_total_field', 'magnetic_anomaly'].includes(data.channels[channel].field_type) || monitor.channels[baseChannel].field_type !== 'magnetic_total_field') throw Error('survey must be magnetic total field/anomaly and base must be magnetic total field');
    if (trim(data.channels[channel].units) !== 'nT' || trim(monitor.channels[baseChannel].units) !== 'nT') throw Error('selected survey/base channels require nT; convert units explicitly first');
    const baseState = statesFor(monitor, monitorLedger).magnetic_diurnal[baseChannel];
    if (baseState === 'unknown') throw new NeedsInput('declare evidence-backed unapplied magnetic_diurnal history for the base stream');
    if (baseState !== 'unapplied') throw Error('base stream magnetic_diurnal is already applied; use the uncorrected monitor');
    if (ledger.entries.some((entry) => entry.id === params.event_id)) throw Error('event_id already exists in the correction ledger');
    const state = statesFor(data, ledger).magnetic_diurnal[channel];
    if (state === 'unknown') throw new NeedsInput('declare evidence-backed unapplied magnetic_diurnal history before correction');
    if (state !== 'unapplied') throw Error('magnetic_diurnal is already applied; repeated correction is rejected');
    const records = monitor.records;
    if (!records.length || records.some((row) => row.time === null)) throw new NeedsInput('every base record needs a UTC Unix time, including missing-reading gap markers');
    const times = records.map((row) => row.time);
    if (times.some((time, index) => index > 0 && time <= times[index - 1])) throw Error('base times must increase strictly; duplicate/nonmonotonic samples require input QC');
    const stations = new Set(records.map((row) => row.station_id));
    if (stations.size !== 1 || stations.has(null)) throw Error('base records must identify one nonnull stationary station_id');
    if (['x', 'y', 'z'].some((axis) => new Set(records.filter((row) => row[axis] !== null).map((row) => row[axis])).size > 1)) throw Error('base positions must be stationary; moving XYZ samples are not a base station');
    const readings = data.records.filter((row) => row.values[channel] !== null);
    if (!readings.length) throw new NeedsInput('selected survey channel needs at least one nonnull reading');
    for (const row of readings) {
      const time = row.time; let predicted = null; let reason = null;
      if (time === null) reason = 'missing_time';
      else {
        let left = 0; let right = times.length;
        while (left < right) { const middle = Math.floor((left + right) / 2); if (times[middle] < time) left = middle + 1; else right = middle; }
        const index = left;
        if (index < times.length && times[index] === time) { predicted = records[index].values[baseChannel]; if (predicted === null) reason = 'missing_base_reading'; }
        else if (index === 0 || index === times.length) reason = 'outside_base_span';
        else {
          const before = records[index - 1].values[baseChannel]; const after = records[index].values[baseChannel]; const gap = times[index] - times[index - 1];
          if (before === null || after === null) reason = 'missing_base_reading';
          else if (gap > params.max_gap) reason = 'excessive_base_gap';
          else { const weight = (time - times[index - 1]) / gap; predicted = before + (after - before) * weight; }
        }
      }
      const variation = predicted !== null ? predicted - params.reference : null; const corrected = variation !== null ? row.values[channel] - variation : null;
      if (corrected !== null && (!number(variation) || !number(corrected))) throw Error('base variation/corrected values exceed portable numeric range');
      result.proposals.push({ id: row.id, time, base_value: predicted, variation, corrected, supported: reason === null, reason });
    }
    const supported = result.proposals.filter((item) => item.supported).length; const station = [...stations][0];
    result.diagnostics = { selected_readings: readings.length, supported_readings: supported, missing_readings: data.records.length - readings.length, base_records: records.length, base_station_id: station, base_binding: baseBinding, uncertainty_propagated: false };
    if (supported !== readings.length) throw new NeedsInput('base coverage is incomplete; no corrected observations or application event committed');
    const beforeBinding = ledger.current_binding;
    readings.forEach((row, index) => { row.values[channel] = result.proposals[index].corrected; }); const outputBinding = await binding(data);
    ledger.entries.push({ id: params.event_id, kind: 'application', correction: 'magnetic_diurnal', channels: [channel], state: 'applied', evidence: params.evidence, producer: producer(), input_binding: beforeBinding, output_binding: outputBinding, parameters: params, base_binding: baseBinding, base_station_id: station, affected_records: readings.length });
    ledger.current_binding = outputBinding;
    const metadata = data.metadata; const source = appendInput(metadata, metadata); metadata.input_lineage = source.nodes; const monitorInput = appendInput(metadata, monitor.metadata); metadata.input_lineage = monitorInput.nodes;
    for (const key of ['uncertainty', 'variance', 'standard_deviation']) delete metadata[key];
    metadata.uncertainty_propagated = false;
    metadata.processing = [...(metadata.processing ?? []), { operation: 'magnetic_base_input', version: 1, event_id: params.event_id, input_binding: beforeBinding, operand_lineage: source.operand }, { operation: 'correct_magnetic_base', version: 1, parameters: params, input_binding: beforeBinding, output_binding: outputBinding, base_binding: baseBinding, operand_lineage: monitorInput.operand }];
    const output = await save(data, ledger); await validate(output, ledger, outputBinding);
    Object.assign(result, { observations: output, ledger: clone(ledger), states: statesFor(output, ledger) }); return result;
  } catch (error) { return errorResult(result, error); }
}

/** corrected(t)=input(t+lag_seconds) within contiguous line segments. Explicit reject/mask coverage; no extrapolation. */
export async function correctGeophysicsMagneticLag(payload, options) {
  const result = report('magnetic_lag');
  try {
    const params = lagOptions(options); result.parameters = params;
    const data = createGeophysicsObservations(payload);
    if (data.records.length > limits.max_lag_records) throw new ResourceError('lag correction accepts at most 4096 records; partition explicitly');
    const channel = params.channel;
    if (!Object.hasOwn(data.channels, channel) || !['magnetic_total_field', 'magnetic_anomaly'].includes(data.channels[channel].field_type) || trim(data.channels[channel].units) !== 'nT') throw Error('lag correction requires a magnetic total-field/anomaly channel in nT');
    const ledger = await load(data);
    if (ledger.entries.some((entry) => entry.id === params.event_id)) throw Error('event_id already exists in the correction ledger');
    const state = statesFor(data, ledger).magnetic_lag[channel];
    if (state === 'unknown') throw new NeedsInput('declare evidence-backed unapplied magnetic_lag history before correction');
    if (state !== 'unapplied') throw Error('magnetic_lag is already applied; repeated correction is rejected');
    const segments = [];
    for (const row of data.records) {
      if (row.line_id === null || row.time === null) throw new NeedsInput('every lag record needs line_id and UTC time, including null-reading gap markers');
      if (!segments.length || segments.at(-1).at(-1).line_id !== row.line_id) segments.push([]);
      const segment = segments.at(-1);
      if (segment.length && row.time <= segment.at(-1).time) throw Error('times must increase strictly within each contiguous line segment; run acquisition QC');
      segment.push(row);
    }
    const selected = data.records.filter((row) => row.values[channel] !== null).length;
    if (!selected) throw new NeedsInput('selected channel needs at least one nonnull reading');
    for (const [segmentIndex, segment] of segments.entries()) {
      const times = segment.map((row) => row.time);
      for (const row of segment) {
        const original = row.values[channel]; if (original === null) continue;
        const query = row.time + params.lag_seconds;
        if (!number(query) || (params.lag_seconds !== 0 && query === row.time)) throw Error('lag-shifted UTC time is outside portable range or below timestamp precision');
        let low = 0; let high = times.length;
        while (low < high) { const mid = Math.floor((low + high) / 2); if (times[mid] < query) low = mid + 1; else high = mid; }
        const index = low; let value = null; let reason = null; let sourceIds = []; let weight = null;
        if (index < times.length && times[index] === query) {
          value = segment[index].values[channel]; sourceIds = [segment[index].id]; weight = 0;
          if (value === null) reason = 'missing_source_reading';
        } else if (index === 0 || index === times.length) reason = 'outside_segment';
        else {
          const left = segment[index - 1]; const right = segment[index]; sourceIds = [left.id, right.id]; const gap = times[index] - times[index - 1];
          if (left.values[channel] === null || right.values[channel] === null) reason = 'missing_source_reading';
          else if (gap > params.max_gap) reason = 'excessive_gap';
          else { weight = (query - times[index - 1]) / gap; value = left.values[channel] + (right.values[channel] - left.values[channel]) * weight; }
        }
        if (value !== null && !number(value)) throw Error('interpolated magnetic reading exceeds portable numeric range');
        result.proposals.push({ id: row.id, line_id: row.line_id, segment: segmentIndex, time: row.time, source_time: query, original, corrected: value, source_ids: sourceIds, weight, supported: reason === null, reason });
      }
    }
    const supported = result.proposals.filter((p) => p.supported).length;
    result.diagnostics = { selected_readings: selected, supported_readings: supported, unsupported_readings: selected - supported, missing_readings: data.records.length - selected, segments: segments.length, uncertainty_propagated: false };
    if (!supported || (supported !== selected && params.unsupported_policy === 'reject')) throw new NeedsInput('lag coverage is incomplete or empty; no corrected observations or application event committed');
    const masked = result.proposals.filter((p) => !p.supported).map((p) => ({ id: p.id, value: p.original }));
    const proposals = new Map(result.proposals.map((p) => [p.id, p])); const before = ledger.current_binding;
    for (const row of data.records) if (proposals.has(row.id)) row.values[channel] = proposals.get(row.id).corrected;
    const after = await binding(data);
    ledger.entries.push({ id: params.event_id, kind: 'application', correction: 'magnetic_lag', channels: [channel], state: 'applied', evidence: params.evidence, producer: producer(), input_binding: before, output_binding: after, parameters: params, masked_records: masked, affected_records: selected });
    ledger.current_binding = after;
    const metadata = data.metadata; const source = appendInput(metadata, metadata); metadata.input_lineage = source.nodes;
    for (const key of ['uncertainty', 'variance', 'standard_deviation']) delete metadata[key];
    metadata.uncertainty_propagated = false;
    metadata.processing = [...(metadata.processing ?? []), { operation: 'correct_magnetic_lag', version: 1, parameters: params, input_binding: before, output_binding: after, operand_lineage: source.operand }];
    const output = await save(data, ledger); await validate(output, ledger, after);
    Object.assign(result, { observations: output, ledger: clone(ledger), states: statesFor(output, ledger) }); return result;
  } catch (error) { return errorResult(result, error); }
}

/** Subtract supplied observed-minus-reference bias with circular calibration support; no fitted compensation model. */
export async function correctGeophysicsMagneticHeading(payload, options) {
  const result = report('magnetic_heading');
  try {
    const params = headingOptions(options); result.parameters = params;
    const data = createGeophysicsObservations(payload);
    if (data.records.length > limits.max_heading_records) throw new ResourceError('heading correction accepts at most 4096 records');
    const channel = params.channel;
    if (!Object.hasOwn(data.channels, channel) || !['magnetic_total_field', 'magnetic_anomaly'].includes(data.channels[channel].field_type) || trim(data.channels[channel].units) !== 'nT') throw Error('heading correction requires a magnetic total-field/anomaly channel in nT');
    const ledger = await load(data);
    if (ledger.entries.some((entry) => entry.id === params.event_id)) throw Error('event_id already exists in the correction ledger');
    const state = statesFor(data, ledger).magnetic_heading[channel];
    if (state === 'unknown') throw new NeedsInput('declare evidence-backed unapplied magnetic_heading history before correction');
    if (state !== 'unapplied') throw Error('magnetic_heading is already applied; repeated correction is rejected');
    const headingInput = await headingBinding(data, params); const nodes = params.calibration;
    const readings = data.records.filter((row) => row.values[channel] !== null);
    if (!readings.length) throw new NeedsInput('selected channel needs at least one nonnull reading');
    for (const row of readings) {
      const raw = rawHeading(row, params.heading_key); const h = raw === 360 ? 0 : raw;
      let bias = null; let reason = null; let bracket = []; let gap = null; let weight = null;
      if (h === null) reason = 'missing_heading';
      else {
        let low = 0; let high = nodes.length;
        while (low < high) { const mid = Math.floor((low + high) / 2); if (nodes[mid].heading_degrees < h) low = mid + 1; else high = mid; }
        const index = low;
        if (index < nodes.length && nodes[index].heading_degrees === h) { bias = nodes[index].bias_nT; bracket = [h]; gap = 0; weight = 0; }
        else {
          const left = nodes[(index - 1 + nodes.length) % nodes.length]; const right = nodes[index % nodes.length];
          const start = left.heading_degrees; const end = right.heading_degrees + ([0, nodes.length].includes(index) ? 360 : 0);
          const query = h + (index === 0 ? 360 : 0); gap = end - start; bracket = [left.heading_degrees, right.heading_degrees];
          if (gap > params.max_heading_gap) reason = 'excessive_heading_gap';
          else { weight = (query - start) / gap; bias = left.bias_nT + (right.bias_nT - left.bias_nT) * weight; }
        }
      }
      const original = row.values[channel]; const value = bias === null ? null : original - bias;
      if (bias !== null && (!number(bias) || !number(value))) throw Error('heading bias/corrected value exceeds portable numeric range');
      result.proposals.push({ id: row.id, heading_degrees: h, original, bias_nT: bias, corrected: value, calibration_headings: bracket, angular_gap: gap, weight, supported: reason === null, reason });
    }
    const supported = result.proposals.filter((p) => p.supported).length;
    result.diagnostics = { selected_readings: readings.length, supported_readings: supported, missing_readings: data.records.length - readings.length, calibration_nodes: nodes.length, heading_binding: headingInput, uncertainty_propagated: false };
    if (supported !== readings.length) throw new NeedsInput('heading support is incomplete; no corrected observations or application event committed');
    const before = ledger.current_binding;
    readings.forEach((row, index) => { row.values[channel] = result.proposals[index].corrected; });
    const after = await binding(data);
    ledger.entries.push({ id: params.event_id, kind: 'application', correction: 'magnetic_heading', channels: [channel], state: 'applied', evidence: params.evidence, producer: producer(), input_binding: before, output_binding: after, parameters: params, heading_binding: headingInput, affected_records: readings.length });
    ledger.current_binding = after;
    const metadata = data.metadata; const source = appendInput(metadata, metadata); metadata.input_lineage = source.nodes;
    for (const key of ['uncertainty', 'variance', 'standard_deviation']) delete metadata[key];
    metadata.uncertainty_propagated = false;
    metadata.processing = [...(metadata.processing ?? []), { operation: 'correct_magnetic_heading', version: 1, parameters: params, heading_binding: headingInput, input_binding: before, output_binding: after, operand_lineage: source.operand }];
    const output = await save(data, ledger); await validate(output, ledger, after);
    Object.assign(result, { observations: output, ledger: clone(ledger), states: statesFor(output, ledger) }); return result;
  } catch (error) { return errorResult(result, error); }
}

/** Read-only bounded scalar mis-ties at projected/local XY line intersections. */
export async function analyzeGeophysicsCrossovers(payload,options) {
  const result = {schema:'baselode.geophysics.crossovers',version:1,operation:'analyze',state:'ok',issues:[],parameters:{},crossovers:[],diagnostics:{},summary:{},units:{},observation_binding:null,producer:producer(),assumptions:describeGeophysicsCrossovers().assumptions};
  try {
    const params = crossoverOptions(options); result.parameters = params;
    const data = createGeophysicsObservations(payload); const context = crossoverPrepare(data,params); const ledger = await load(data);
    const analysis = computeCrossovers(data,params);
    Object.assign(result,{crossovers:analysis.crossovers,diagnostics:analysis.diagnostics,summary:analysis.summary,observation_binding:ledger.current_binding,units:{xy:context[0],height:context[1] ? context[1][0] : (typeof data.metadata.height_units === 'string' ? data.metadata.height_units : null),field:data.channels[params.channel].units}});
  } catch (error) {
    const missing = error instanceof NeedsInput; const resource = error instanceof ResourceError || error instanceof CrossoverResourceError;
    Object.assign(result,{state:missing ? 'needs_input' : 'rejected',crossovers:[],observation_binding:null}); result.issues.push({code:missing ? 'context' : (resource ? 'resource' : 'contract'),message:error.message});
  }
  return result;
}

/** Fit a constant target-minus-reference bias per target, holding explicit references fixed. */
export async function levelGeophysicsMagneticLines(payload,options) {
  const result = report('magnetic_levelling'); result.crossovers = []; result.assumptions = describeGeophysicsCrossovers().assumptions;
  try {
    const params = levellingOptions(options); result.parameters = params; const data = createGeophysicsObservations(payload); crossoverPrepare(data,params);
    const channel = params.channel;
    if (!['magnetic_total_field','magnetic_anomaly'].includes(data.channels[channel].field_type) || trim(data.channels[channel].units) !== 'nT') throw Error('line levelling requires a magnetic total-field/anomaly channel in nT');
    const ledger = await load(data);
    if (ledger.entries.some((e) => e.id === params.event_id)) throw Error('event_id already exists in the correction ledger');
    const state = statesFor(data,ledger).magnetic_levelling[channel];
    if (state === 'unknown') throw new NeedsInput('declare evidence-backed unapplied magnetic_levelling history');
    if (state !== 'unapplied') throw Error('magnetic_levelling is already applied; repeated levelling rejected');
    const roles = [...params.reference_lines,...params.target_lines]; const actual = new Set(data.records.map((row) => row.line_id));
    if (actual.size !== roles.length || roles.some((line) => !actual.has(line))) throw Error('reference/target roles must cover exactly every line');
    const analysis = computeCrossovers(data,params); const crossings = analysis.crossovers; result.crossovers = crossings;
    const refs = new Set(params.reference_lines); const targets = new Set(params.target_lines);
    const errors = new Map(params.target_lines.map((line) => [line,[]])); const ties = new Map(params.target_lines.map((line) => [line,new Set()]));
    for (const row of crossings) {
      const a = row.line_a; const b = row.line_b; const used = row.eligible && ((targets.has(a) && refs.has(b)) || (targets.has(b) && refs.has(a))); row.used_for_fit = used;
      if (used) { const [target,reference,diff] = targets.has(a) ? [a,b,row.difference] : [b,a,-row.difference]; errors.get(target).push(diff); ties.get(target).add(reference); }
    }
    const biases = new Map(params.reference_lines.map((line) => [line,0]));
    for (const line of params.target_lines) {
      const values = errors.get(line); const bias = values.length ? crossoverSum(values)/values.length : null; const residuals = values.map((v) => v-bias); const rms = crossoverRms(residuals);
      if (bias !== null && (!number(bias) || !number(rms))) throw Error('fitted line bias/residual exceeds portable numeric range');
      let reason = null;
      if (values.length < params.min_crossovers || ties.get(line).size < params.min_reference_lines) reason = 'insufficient_crossovers';
      else if (Math.abs(bias) > params.max_abs_correction) reason = 'excessive_correction';
      else if (rms > params.max_rms_residual) reason = 'excessive_residual';
      result.proposals.push({line_id:line,bias_nT:bias,crossovers:values.length,reference_lines:params.reference_lines.filter((ref) => ties.get(line).has(ref)),rms_before:crossoverRms(values),rms_after:rms,supported:reason === null,reason});
      if (bias !== null) biases.set(line,bias);
    }
    result.diagnostics = {...analysis.diagnostics,reference_lines:params.reference_lines,target_lines:params.target_lines,uncertainty_propagated:false};
    if (result.proposals.some((p) => !p.supported)) throw new NeedsInput('every target must pass crossover coverage and correction/residual gates; no application committed');
    const offsets = roles.map((line) => ({line_id:line,bias_nT:biases.get(line)})); const modelBinding = await levellingBinding(data,params,offsets); const before = ledger.current_binding;
    const readings = data.records.filter((row) => row.values[channel] !== null);
    for (const row of readings) { const value = row.values[channel]-biases.get(row.line_id); if (!number(value)) throw Error('levelled values exceed portable numeric range'); row.values[channel] = value; }
    for (const row of crossings) { row.difference_after = row.difference === null ? null : row.difference-biases.get(row.line_a)+biases.get(row.line_b); if (row.difference_after !== null && !number(row.difference_after)) throw Error('levelled crossover difference exceeds portable numeric range'); }
    result.diagnostics = {...result.diagnostics,rms_before:crossoverRms(crossings.filter((row) => row.used_for_fit).map((row) => row.difference)),rms_after:crossoverRms(crossings.filter((row) => row.used_for_fit).map((row) => row.difference_after)),levelling_binding:modelBinding};
    const after = await binding(data);
    ledger.entries.push({id:params.event_id,kind:'application',correction:'magnetic_levelling',channels:[channel],state:'applied',evidence:params.evidence,producer:producer(),input_binding:before,output_binding:after,parameters:params,line_offsets:offsets,levelling_binding:modelBinding,affected_records:readings.length}); ledger.current_binding = after;
    const metadata = data.metadata; const source = appendInput(metadata,metadata); metadata.input_lineage = source.nodes;
    for (const key of ['uncertainty','variance','standard_deviation']) delete metadata[key]; metadata.uncertainty_propagated = false;
    metadata.processing = [...(metadata.processing ?? []),{operation:'level_magnetic_lines',version:1,parameters:params,line_offsets:offsets,levelling_binding:modelBinding,input_binding:before,output_binding:after,operand_lineage:source.operand}];
    const output = await save(data,ledger); await validate(output,ledger,after);
    Object.assign(result,{observations:output,ledger:clone(ledger),states:statesFor(output,ledger)}); return result;
  } catch (error) { return errorResult(result,error); }
}


/** Independent bounded WGS84 observation reprojection contract. */
export function describeGeophysicsReprojection() { return clone(reprojectionDescriptor); }
function projectionCode(crs) {
  if (typeof crs !== 'string' || !/^EPSG:(4326|326[0-9]{2}|327[0-9]{2})$/.test(crs)) throw Error('reprojection supports canonical WGS84 EPSG:4326 and EPSG:32601..32660/32701..32760 only');
  const code = Number(crs.slice(5));
  if (code !== 4326 && !(code % 100 >= 1 && code % 100 <= 60)) throw Error('UTM zone must be 1..60');
  return code;
}
function projectionFrame(frame) {
  if (!keys(frame,['crs','crs_units'])) throw Error('horizontal context needs exactly crs and crs_units');
  const code = projectionCode(frame.crs);
  if (!(code === 4326 ? ['degree','degrees'] : ['m','metre','meter']).includes(frame.crs_units)) throw Error('declare degree/degrees for EPSG:4326 or m/metre/meter for UTM');
  return code;
}
function reprojectionOptions(options) {
  const contract = reprojectionDescriptor.parameters;
  if (!object(options) || Object.keys(options).some((key) => !Object.hasOwn(contract.properties,key))) throw Error('reprojection requires known option names');
  const params = json(options);
  if (contract.required.some((key) => !Object.hasOwn(params,key))) throw new NeedsInput('supply target_crs, datum_policy=backend, event_id and evidence');
  projectionCode(params.target_crs);
  if (params.datum_policy !== 'backend') throw new NeedsInput('reprojection requires explicit datum_policy=backend acknowledgement');
  if (!label(params.event_id) || !evidence(params.evidence)) throw Error('event_id/evidence require bounded nonempty strings');
  return params;
}
function projectionArea(code,lon,lat) {
  const tolerance = 1e-8;
  if (!number(lon) || !number(lat) || Math.abs(lon) > 180+tolerance || Math.abs(lat) > 90+tolerance) throw Error('coordinates must resolve to finite WGS84 longitude/latitude in range');
  if (code !== 4326) {
    const center=6*(code%100)-183; const south=Math.floor(code/100)===327;
    const delta=Math.abs(lon-center); const distance=Math.min(delta,Math.abs(360-delta));
    if (distance>3+tolerance || lat<(south?-80:0)-tolerance || lat>(south?0:84)+tolerance) throw Error('coordinates lie outside the declared UTM six-degree zone/hemisphere/latitude domain');
  }
}
async function reprojectionHash(entry) {
  const snapshot=['baselode.reprojection_binding.v1', ...['id','evidence','input_binding','output_binding'].map((k)=>entry[k]),
    ['target_crs','datum_policy','event_id','evidence'].map((k)=>entry.parameters[k]), ...['source','target'].map((k)=>['crs','crs_units'].map((field)=>entry[k][field])),
    ['name','version','proj_version'].map((k)=>entry.backend[k]),entry.transformed_records];
  if (!globalThis.crypto?.subtle) throw new NeedsInput('SHA-256 binding requires Web Crypto (Node 20+ or a secure browser context)');
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(snapshot))))].map((byte)=>byte.toString(16).padStart(2,'0')).join('');
}
async function reprojectionFrames(data,entries) {
  let frame={crs:data.crs,crs_units:data.crs_units}; const frames=new Array(entries.length);
  for(let index=entries.length-1;index>=0;index--) {
    const entry=entries[index];
    if(object(entry) && entry.kind==='reprojection') {
      if(!keys(entry,['id','kind','evidence','producer','input_binding','output_binding','parameters','source','target','backend','transformed_records','transform_binding']) || !label(entry.id) || !evidence(entry.evidence) || !['input_binding','output_binding','transform_binding'].every((k)=>digest(entry[k]))) throw Error('malformed reprojection event');
      let params;
      try { params=reprojectionOptions(entry.parameters); }
      catch(error) { if(error instanceof NeedsInput) throw Error(`invalid stored reprojection parameters: ${error.message}`); throw error; }
      projectionFrame(entry.source); const targetCode=projectionFrame(entry.target);
      if(params.event_id!==entry.id || params.evidence!==entry.evidence || params.target_crs!==entry.target.crs || entry.target.crs_units!==(targetCode===4326?'degree':'m') || entry.target.crs!==frame.crs || entry.target.crs_units!==frame.crs_units) throw Error('broken reprojection parameter/context chain');
      const backend=entry.backend; const same=entry.source.crs===entry.target.crs;
      if(!keys(backend,['name','version','proj_version']) || !(same?['identity']:['pyproj','proj4']).includes(backend.name) || !label(backend.version) || !(backend.proj_version===null || label(backend.proj_version))) throw Error('invalid reprojection backend identity');
      if(!keys(entry.producer,['library','version','algorithm_version']) || entry.producer.library!=='baselode' || !label(entry.producer.version) || entry.producer.algorithm_version!==1) throw Error('invalid reprojection producer');
      if(!number(entry.transformed_records) || entry.transformed_records<1 || entry.transformed_records!==data.records.filter((row)=>row.x!==null&&row.y!==null).length || entry.transform_binding!==await reprojectionHash(entry)) throw Error('stale reprojection binding or transformed count');
      frame=entry.source;
    }
    frames[index]=frame;
  }
  return frames;
}
function projectionDefinition(code) {
  return code===4326?'+proj=longlat +datum=WGS84 +no_defs':`+proj=utm +zone=${code%100} ${Math.floor(code/100)===327?'+south ':''}+datum=WGS84 +units=m +no_defs`;
}
/** Derive horizontal WGS84 coordinates, preserving historical correction states.
 * Always XY; complete null pairs survive, partial/out-of-zone pairs reject.
 * Heights and measured headings retain their original acquisition reference.
 * No datum shift, vertical conversion, heading rotation or uncertainty propagation.
 */
export async function reprojectGeophysicsObservations(payload,options) {
  const result=report('reproject_observations');
  try {
    const params=reprojectionOptions(options); result.parameters=params;
    const data=createGeophysicsObservations(payload); const source={crs:data.crs,crs_units:data.crs_units};
    const sourceCode=projectionFrame(source); const targetCode=projectionCode(params.target_crs);
    const target={crs:params.target_crs,crs_units:targetCode===4326?'degree':'m'};
    const ledger=await load(data);
    if(ledger.entries.some((entry)=>entry.id===params.event_id)) throw Error('event_id already exists in the correction ledger');
    if(ledger.entries.length>=limits.max_events) throw new ResourceError('correction ledger exceeds 64 events');
    const geographic=proj4(projectionDefinition(sourceCode),projectionDefinition(4326));
    const transform=proj4(projectionDefinition(sourceCode),projectionDefinition(targetCode));
    let count=0;
    for(const row of data.records) {
      if(row.x===null&&row.y===null) continue;
      if(row.x===null||row.y===null) throw Error('reprojection requires complete XY pairs or both null');
      if(Math.abs(row.x)>1e12||Math.abs(row.y)>1e12) throw Error('reprojection XY must be within +/-1e12');
      const [lon,lat]=sourceCode===4326?[row.x,row.y]:geographic.forward([row.x,row.y]);
      projectionArea(sourceCode,lon,lat); projectionArea(targetCode,lon,lat);
      const [x,y]=sourceCode===targetCode?[row.x,row.y]:transform.forward([row.x,row.y]);
      if(![x,y].every((v)=>Number.isFinite(v)&&Math.abs(v)<=1e12)) throw Error('transformed XY must be finite within +/-1e12');
      row.x=x; row.y=y; count++;
    }
    if(!count) throw new NeedsInput('reprojection needs at least one complete XY pair');
    const before=ledger.current_binding; Object.assign(data,target); const after=await binding(data);
    const same=source.crs===target.crs; const backend={name:same?'identity':'proj4',version:same?'1':proj4.version,proj_version:null};
    const event={id:params.event_id,kind:'reprojection',evidence:params.evidence,producer:producer(),input_binding:before,output_binding:after,parameters:params,source,target,backend,transformed_records:count};
    event.transform_binding=await reprojectionHash(event); ledger.entries.push(event); ledger.current_binding=after;
    const metadata=data.metadata; const {nodes,operand}=appendInput(metadata,metadata); metadata.input_lineage=nodes;
    for(const key of ['uncertainty','variance','standard_deviation']) delete metadata[key];
    metadata.uncertainty_propagated=false;
    metadata.processing=[...(metadata.processing??[]),{operation:'reproject_observations',version:1,parameters:params,source,target,backend,input_binding:before,output_binding:after,operand_lineage:operand}];
    const output=await save(data,ledger); await validate(output,ledger,after);
    Object.assign(result,{observations:output,ledger:clone(ledger),states:statesFor(output,ledger),diagnostics:{transformed_records:count,missing_xy_records:data.records.length-count,backend}}); return result;
  } catch(error) { return errorResult(result,error); }
}


function normalOptions(options) {
  const contract=descriptor.normal_gravity_parameters;
  if(!object(options)||Object.keys(options).some(key=>!Object.hasOwn(contract.properties,key)))throw Error('normal gravity removal requires known option names');
  const params=json(options);
  if(contract.required.some(key=>!Object.hasOwn(params,key)))throw new NeedsInput('supply channel, model, reference_policy, event_id and evidence');
  if(typeof params.channel!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(params.channel))throw Error('channel must be a declared observation channel');
  if(!Object.hasOwn(params,'height_policy'))params.height_policy='external_only';
  if(!['external_only','analytic_continuation'].includes(params.height_policy))throw Error('height_policy must be external_only or analytic_continuation');
  if(!['WGS84','GRS80'].includes(params.model)||params.reference_policy!=='caller_verified')throw Error('select WGS84/GRS80 and acknowledge reference_policy=caller_verified');
  if(!label(params.event_id)||!evidence(params.evidence))throw Error('event_id/evidence require bounded nonempty strings');
  return params;
}
function gravityContext(data,params) {
  if(data.records.length>512)throw new ResourceError('normal gravity removal accepts at most 512 records');
  const model=params.model;const metadata=data.metadata;const crs=model==='WGS84'?['EPSG:4326']:['EPSG:4283','EPSG:7844'];
  if(!crs.includes(data.crs)||!['degree','degrees'].includes(data.crs_units)||metadata.height_units!=='m'||metadata.height_datum!==model+'_ellipsoid'||metadata.z_positive!=='up')throw new NeedsInput('supply matching model geographic CRS, degree/degrees, height_units=m, model_ellipsoid height_datum and z_positive=up');
  const datum=effectiveGravityDatum(data,params.channel);
  if(!label(datum)||['unknown','unspecified'].includes(trim(datum).toLowerCase())||!['tide_free','zero_tide','mean_tide'].includes(metadata.tide_system))throw new NeedsInput('declare gravity_datum and tide_system=tide_free/zero_tide/mean_tide; caller verifies normal-reference comparability');
  return [data.crs,data.crs_units,metadata.height_units,metadata.height_datum,metadata.z_positive,datum,metadata.tide_system];
}
async function normalBinding(data,params) {
  const context=gravityContext(data,params);const model=descriptor.gravity_models[params.model];const buffer=new ArrayBuffer(8);const view=new DataView(buffer);
  const numbers=['semimajor_axis','flattening','geocentric_grav_const','angular_velocity'].map(key=>{view.setFloat64(0,model[key],false);return [...new Uint8Array(buffer)].map(byte=>byte.toString(16).padStart(2,'0')).join('');});
  const snapshot=['baselode.gravity_normal_binding.v1',params.channel,params.model,params.reference_policy,params.height_policy,context,model.backend,model.backend_version,model.algorithm,numbers];
  if(!globalThis.crypto?.subtle)throw new NeedsInput('SHA-256 binding requires Web Crypto (Node 20+ or secure browser)');
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(snapshot))))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}


function effectiveGravityDatum(data,channel) {
  const overrides=Object.hasOwn(data.metadata,'gravity_channel_datums')?data.metadata.gravity_channel_datums:{};
  if(!object(overrides))throw Error('metadata.gravity_channel_datums must be an object');
  return Object.hasOwn(overrides,channel)?overrides[channel]:data.metadata.gravity_datum;
}
const knownGravityLabel=value=>label(value)&&!['unknown','unspecified'].includes(trim(value).toLowerCase());
function gravityTemporalOptions(options,drift) {
  const contract=descriptor[drift?'gravity_drift_parameters':'gravity_tide_parameters'];
  if(!object(options)||Object.keys(options).some(key=>!Object.hasOwn(contract.properties,key)))throw Error('temporal gravity requires known option names');
  const params=json(options);
  if(contract.required.some(key=>!Object.hasOwn(params,key)))throw new NeedsInput('supply every explicit gravity model/reference/clock/quality/event option');
  if(typeof params.channel!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(params.channel))throw Error('select a declared gravity channel');
  if(!label(params.model_id)||!label(params.event_id)||!evidence(params.evidence))throw Error('model_id/event_id/evidence must be bounded labels');
  if(params.clock_policy!=='synchronized'||params.reference_policy!=='caller_verified')throw new NeedsInput('explicit synchronized clock and caller_verified reference policies required');
  const items=params[drift?'controls':'effects'];const limit=drift?128:4096;
  if(!Array.isArray(items)||items.length<(drift?2:1))throw Error('supply at least two controls or one effect');
  if(items.length>limit)throw new ResourceError('gravity control/effect table exceeds its limit');
  const ids=new Set();const valueKey=drift?'reference_mGal':'effect_mGal';
  for(const item of items) {
    if(!keys(item,['record_id',valueKey])||!label(item.record_id)||ids.has(item.record_id)||!number(item[valueKey])||(drift&&item[valueKey]<=0))throw Error('control/effect rows need unique record IDs and valid mGal values');ids.add(item.record_id);
  }
  const caps=drift?['max_abs_correction_mGal','max_drift_rate_mGal_per_s']:['max_abs_effect_mGal'];
  if(caps.some(key=>!number(params[key])||params[key]<0))throw Error('gravity quality caps must be finite nonnegative mGal or mGal/s');
  if(drift) {
    if(!knownGravityLabel(params.target_gravity_datum)||!number(params.max_gap_seconds)||params.max_gap_seconds<=0||params.max_gap_seconds>1e9)throw Error('declare target gravity datum and max_gap_seconds in (0,1e9]');
  } else if(params.effect_convention!=='observed_minus_reference'||items.some(item=>Math.abs(item.effect_mGal)>params.max_abs_effect_mGal))throw Error('effect convention/correction cap violated');
  return params;
}
const gravityTideOptions=options=>gravityTemporalOptions(options,false);
const gravityDriftOptions=options=>gravityTemporalOptions(options,true);
function gravityTemporalContext(data,params) {
  if(data.records.length>4096)throw new ResourceError('temporal gravity accepts at most 4096 records');
  if(!Object.hasOwn(data.channels,params.channel)||data.channels[params.channel].units!=='mGal')throw Error('temporal gravity needs a declared mGal channel');
  const m=data.metadata;
  if(['instrument_id','gravity_scale_calibration_id','height_datum'].some(k=>!knownGravityLabel(m[k]))||m.height_units!=='m'||m.z_positive!=='up'||!['tide_free','zero_tide','mean_tide'].includes(m.tide_system))throw new NeedsInput('declare instrument_id, gravity_scale_calibration_id, height datum/m/up and tide_system');
  for(const row of data.records)if(row.values[params.channel]!==null&&!['x','y','z','time'].every(k=>number(row[k])))throw new NeedsInput('each nonnull gravity reading needs finite XY/Z and synchronized UTC time');
  return ['instrument_id','gravity_scale_calibration_id','height_units','height_datum','z_positive','tide_system'].map(k=>m[k]);
}
function validateGravityDriftModel(data,params,model) {
  if(!keys(model,['algorithm','source_gravity_datum','input_field_type','ties'])||model.algorithm!=='piecewise_linear_absolute_ties_v1'||!knownGravityLabel(model.source_gravity_datum)||!['gravity_relative','gravity_observed'].includes(model.input_field_type))throw Error('invalid fixed-reference gravity drift model');
  const controls=new Map(params.controls.map(item=>[item.record_id,item.reference_mGal]));const rows=new Map(data.records.map(row=>[row.id,row]));const ties=model.ties;
  if(!Array.isArray(ties)||ties.length!==controls.size)throw Error('drift ties must represent exactly the declared controls');
  const ids=new Set();
  for(const [index,tie] of ties.entries()) {
    if(!keys(tie,['record_id','station_id','time','original_mGal','reference_mGal','bias_mGal'])||!label(tie.record_id)||ids.has(tie.record_id)||!controls.has(tie.record_id)||!rows.has(tie.record_id))throw Error('malformed gravity tie model');ids.add(tie.record_id);const row=rows.get(tie.record_id);
    if(!label(tie.station_id)||tie.station_id!==row.station_id||tie.time!==row.time||!['time','original_mGal','reference_mGal','bias_mGal'].every(k=>number(tie[k]))||tie.reference_mGal!==controls.get(tie.record_id)||tie.bias_mGal!==tie.original_mGal-tie.reference_mGal)throw Error('gravity tie inputs/time/reference changed');
    if(model.input_field_type==='gravity_observed'&&tie.original_mGal<=0)throw Error('absolute tie readings must be positive');
    if(Math.abs(tie.bias_mGal)>params.max_abs_correction_mGal)throw Error('gravity tie correction exceeds declared cap');
    if(index) {const gap=tie.time-ties[index-1].time;if(!number(gap)||gap<=0||Math.abs((tie.bias_mGal-ties[index-1].bias_mGal)/gap)>params.max_drift_rate_mGal_per_s)throw Error('gravity tie times/rate violate declared model bounds');}
  }
}
async function gravityTemporalBinding(data,params,model=null) {
  const context=gravityTemporalContext(data,params);
  if(Object.hasOwn(params,'controls')) {
    validateGravityDriftModel(data,params,model);const datum=effectiveGravityDatum(data,params.channel);if(datum!==params.target_gravity_datum)throw Error('drift target channel gravity datum changed');context.push(datum);
  } else {
    const affected=new Set(data.records.filter(row=>row.values[params.channel]!==null).map(row=>row.id));const supplied=new Set(params.effects.map(item=>item.record_id));
    if(affected.size!==supplied.size||[...affected].some(id=>!supplied.has(id)))throw Error('tide effect table must cover exactly all nonnull selected records');
  }
  const buffer=new ArrayBuffer(8);const view=new DataView(buffer);
  function canonical(value) {
    if(typeof value==='number'){if(!number(value))throw Error('temporal model numbers must be finite portable binary64');view.setFloat64(0,value===0?0:value,false);return ['f64',[...new Uint8Array(buffer)].map(byte=>byte.toString(16).padStart(2,'0')).join('')];}
    if(Array.isArray(value))return value.map(canonical);
    if(object(value))return Object.keys(value).sort().map(key=>[key,canonical(value[key])]);return value;
  }
  const semantic=Object.fromEntries(Object.entries(params).filter(([key])=>!['event_id','evidence'].includes(key)));const rows=data.records.map(row=>[row.id,row.time,row.z,row.station_id]);
  const snapshot=['baselode.gravity_temporal_binding.v1',canonical(semantic),canonical(model),canonical(context),canonical(rows)];const encoded=new TextEncoder().encode(JSON.stringify(snapshot));
  if(encoded.length>limits.max_binding_bytes)throw new ResourceError('temporal gravity binding exceeds byte limit');if(!globalThis.crypto?.subtle)throw new NeedsInput('SHA-256 binding requires Web Crypto');
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',encoded))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

function gravityRepeats(data,channel) {
  const qc=qcGeophysicsObservations(data,{});const groups=[];
  for(const repeat of qc.repeats) {
    const rows=repeat.rows.map(i=>data.records[i]).filter(row=>row.values[channel]!==null);if(!rows.length)continue;
    const locations=new Set(rows.map(row=>JSON.stringify([row.x,row.y])));const heights=new Set(rows.map(row=>row.z));
    const same_location=rows.every(row=>row.x!==null&&row.y!==null)?locations.size===1:null;
    const same_height=rows.every(row=>row.z!==null)?heights.size===1:null;
    groups.push({station_id:repeat.station_id,record_ids:rows.map(row=>row.id),same_location,same_height,geometry_comparable:rows.length>=2&&same_location===true&&same_height===true,statistics:repeat.channels[channel]});
  }
  return groups;
}
/** Native station QC only; no inferred instrument drift or station repair. */
export async function analyzeGeophysicsGravityRepeats(payload,options) {
  const result=report('analyze_gravity_repeats');result.assumptions=clone(gravityTemporalDescriptor.assumptions);
  try {
    const params=json(options);if(!keys(params,['channel']))throw Error('repeat analysis requires exactly channel');
    const data=createGeophysicsObservations(payload);const channel=params.channel;
    if(typeof channel!=='string'||!Object.hasOwn(data.channels,channel)||!data.channels[channel].field_type.startsWith('gravity_')||data.channels[channel].units!=='mGal')throw Error('repeat analysis requires a gravity channel in mGal');
    if(data.records.length>4096)throw new ResourceError('gravity repeat analysis accepts at most 4096 records');
    const ledger=await load(data);const repeats=gravityRepeats(data,channel);Object.assign(result,{parameters:params,states:statesFor(data,ledger),diagnostics:{repeats,gravity_datum:effectiveGravityDatum(data,channel)??null}});
    if(!repeats.some(item=>item.statistics.count>=2))throw new NeedsInput('no station has two nonnull selected readings; repeat coverage unavailable');return result;
  } catch(error){return errorResult(result,error);}
}
async function startGravityTemporal(payload,options,drift) {
  const params=drift?gravityDriftOptions(options):gravityTideOptions(options);const data=createGeophysicsObservations(payload);const channel=params.channel;
  if(!Object.hasOwn(data.channels,channel)||!['gravity_relative','gravity_observed'].includes(data.channels[channel].field_type)||data.channels[channel].units!=='mGal')throw Error('use scale-calibrated gravity_relative or absolute gravity_observed in mGal');
  gravityTemporalContext(data,params);if(!knownGravityLabel(effectiveGravityDatum(data,channel)))throw new NeedsInput('declare selected input gravity datum, including relative instrument zero when applicable');
  const ledger=await load(data);const states=statesFor(data,ledger);const expected={gravity_normal:'unapplied',gravity_free_air:'unapplied',gravity_bouguer:'unapplied',gravity_terrain:'unapplied'};expected[drift?'gravity_drift':'gravity_tide']='unapplied';if(drift)expected.gravity_tide='applied';
  for(const [name,required] of Object.entries(expected)){const state=states[name][channel];if(state==='unknown')throw new NeedsInput(`declare evidence-backed ${required} ${name} history`);if(state!==required)throw Error(`gravity processing order/repeat conflicts with ${name} history`);}
  if(ledger.entries.some(entry=>entry.id===params.event_id))throw Error('event_id already exists');if(ledger.entries.length>=limits.max_events)throw new ResourceError('gravity event limit exceeded');
  const readings=data.records.filter(row=>row.values[channel]!==null);if(!readings.length)throw new NeedsInput('selected channel needs nonnull readings');
  if(data.channels[channel].field_type==='gravity_observed'&&readings.some(row=>row.values[channel]<=0))throw Error('absolute observed gravity must be positive; relative readings need gravity_relative field type');
  return {data,params,ledger,readings};
}
async function finishGravityTemporal(data,params,ledger,result,before,model=null) {
  const after=await binding(data);const temporal=await gravityTemporalBinding(data,params,model);const correction=model?'gravity_drift':'gravity_tide';
  const event={id:params.event_id,kind:'application',correction,channels:[params.channel],state:'applied',evidence:params.evidence,producer:producer(),input_binding:before,output_binding:after,parameters:params,temporal_binding:temporal,affected_records:data.records.filter(row=>row.values[params.channel]!==null).length};if(model)event.model=model;
  ledger.entries.push(event);ledger.current_binding=after;const metadata=data.metadata;
  for(const key of ['uncertainty','variance','standard_deviation'])delete metadata[key];metadata.uncertainty_propagated=false;
  const operand=result.diagnostics.source_operand;delete result.diagnostics.source_operand;
  metadata.processing=[...(metadata.processing??[]),{operation:model?'correct_gravity_drift':'apply_gravity_tide',version:1,parameters:params,input_binding:before,output_binding:after,operand_lineage:operand}];
  const output=await save(data,ledger);Object.assign(result,{observations:output,ledger:clone(ledger),states:statesFor(output,ledger)});return result;
}
/** Subtract an exact supplied effect for every nonnull selected reading.
 * No astronomical tide prediction or permanent-tide conversion is inferred.
 */
export async function applyGeophysicsGravityTide(payload,options) {
  const result=report('apply_gravity_tide');result.assumptions=clone(gravityTemporalDescriptor.assumptions);
  try {
    const {data,params,ledger,readings}=await startGravityTemporal(payload,options,false);result.parameters=params;await gravityTemporalBinding(data,params);
    const effects=new Map(params.effects.map(item=>[item.record_id,item.effect_mGal]));const before=ledger.current_binding;
    const source=appendInput(data.metadata,data.metadata);data.metadata.input_lineage=source.nodes;result.diagnostics={source_operand:source.operand,affected_records:readings.length,uncertainty_propagated:false};
    for(const row of readings) {
      const original=row.values[params.channel];const value=original-effects.get(row.id);
      if(!number(value)||(data.channels[params.channel].field_type==='gravity_observed'&&value<=0))throw Error('tide-corrected reading violates finite/absolute magnitude bounds');
      row.values[params.channel]=value;result.proposals.push({id:row.id,original,effect_mGal:effects.get(row.id),corrected:value});
    }
    return await finishGravityTemporal(data,params,ledger,result,before);
  } catch(error){return errorResult(result,error);}
}
/** Fixed-reference absolute base tying plus piecewise-linear loop drift.
 * Every reading needs bounded support; no extrapolation or global network solve.
 * Only the selected datum/type changes; original readings and other channels survive.
 */
export async function correctGeophysicsGravityDrift(payload,options) {
  const result=report('correct_gravity_drift');result.assumptions=clone(gravityTemporalDescriptor.assumptions);
  try {
    const {data,params,ledger,readings}=await startGravityTemporal(payload,options,true);result.parameters=params;const channel=params.channel;const rows=new Map(readings.map(row=>[row.id,row]));const ties=[];
    for(const control of params.controls) {
      if(!rows.has(control.record_id))throw Error('control must identify a nonnull selected reading');const row=rows.get(control.record_id);if(row.station_id===null)throw new NeedsInput('every control requires a station_id');
      ties.push({record_id:row.id,station_id:row.station_id,time:row.time,original_mGal:row.values[channel],reference_mGal:control.reference_mGal,bias_mGal:row.values[channel]-control.reference_mGal});
    }
    ties.sort((a,b)=>a.time-b.time);const model={algorithm:'piecewise_linear_absolute_ties_v1',source_gravity_datum:effectiveGravityDatum(data,channel),input_field_type:data.channels[channel].field_type,ties};result.diagnostics.model=clone(model);validateGravityDriftModel(data,params,model);
    const times=ties.map(tie=>tie.time);result.diagnostics.loops=ties.slice(0,-1).map((a,index)=>{const b=ties[index+1];return {from_id:a.record_id,to_id:b.record_id,closed_station_loop:a.station_id===b.station_id,elapsed_seconds:b.time-a.time,observed_change_mGal:b.original_mGal-a.original_mGal,reference_change_mGal:b.reference_mGal-a.reference_mGal,drift_change_mGal:b.bias_mGal-a.bias_mGal};});result.diagnostics.repeats_before=gravityRepeats(data,channel);
    for(const row of readings) {
      let lo=0,hi=times.length;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(times[mid]<row.time)lo=mid+1;else hi=mid;}const index=lo;let bias=null,reason=null;
      if(index<times.length&&times[index]===row.time)bias=ties[index].bias_mGal;
      else if(index===0||index===times.length)reason='outside_control_span';
      else if(times[index]-times[index-1]>params.max_gap_seconds)reason='excessive_control_gap';
      else {const a=ties[index-1],b=ties[index];const weight=(row.time-a.time)/(b.time-a.time);bias=a.bias_mGal+weight*(b.bias_mGal-a.bias_mGal);}
      const value=bias===null?null:row.values[channel]-bias;if(value!==null&&(!number(value)||value<=0))reason='invalid_absolute_output';
      result.proposals.push({id:row.id,time:row.time,original:row.values[channel],bias_mGal:bias,corrected:value,supported:reason===null,reason});
    }
    if(result.proposals.some(item=>!item.supported))throw new NeedsInput('drift coverage/absolute-output support incomplete; no application committed');
    const before=ledger.current_binding;const source=appendInput(data.metadata,data.metadata);data.metadata.input_lineage=source.nodes;result.diagnostics.source_operand=source.operand;
    readings.forEach((row,index)=>{row.values[channel]=result.proposals[index].corrected;});data.channels[channel].field_type='gravity_observed';data.metadata.gravity_channel_datums??={};data.metadata.gravity_channel_datums[channel]=params.target_gravity_datum;
    result.diagnostics.repeats_after=gravityRepeats(data,channel);result.diagnostics.uncertainty_propagated=false;
    return await finishGravityTemporal(data,params,ledger,result,before,model);
  } catch(error){return errorResult(result,error);}
}


function gravityTopographyOptions(options,terrain) {
  const schema=descriptor[terrain?'gravity_terrain_parameters':'gravity_plate_parameters'];
  if(!object(options)||Object.keys(options).some(k=>!Object.hasOwn(schema.properties,k)))throw Error('gravity topography requires known option names');const params=json(options);
  if(schema.required.some(k=>!Object.hasOwn(params,k)))throw new NeedsInput('supply every explicit density/reference/height/support/event option');
  if(typeof params.channel!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(params.channel))throw Error('select a declared gravity channel');
  if(!label(params.event_id)||!evidence(params.evidence)||!knownGravityLabel(params.height_datum))throw Error('height datum/event ID/evidence require bounded known labels');
  if(params.reference_policy!=='caller_verified')throw new NeedsInput('caller_verified reference policy required');
  if(!number(params.density_kg_m3)||!(params.density_kg_m3>0&&params.density_kg_m3<=10000)||!number(params.reference_height_m)||Math.abs(params.reference_height_m)>10000||!number(params.max_abs_correction_mGal)||params.max_abs_correction_mGal<0)throw Error('invalid density/reference/correction bounds');
  if(terrain) {
    if(params.outside_dem_policy!=='flat_at_station_height')throw Error('explicit flat_at_station_height outside DEM policy required');
    if(!number(params.min_edge_distance_m)||!(params.min_edge_distance_m>0&&params.min_edge_distance_m<=50000)||!number(params.ground_tolerance_m)||params.ground_tolerance_m<0||params.ground_tolerance_m>1)throw Error('invalid terrain edge support or ground tolerance');
    const d=params.dem;if(!keys(d,['id','crs','crs_units','frame_id','height_datum','bounds','heights'])||!label(d.id)||(d.crs!==null&&!label(d.crs))||(d.frame_id!==null&&!label(d.frame_id))||d.crs_units!=='m'||d.height_datum!==params.height_datum)throw Error('invalid DEM identity/frame/metre/height context');
    const b=d.bounds,h=d.heights;if(!Array.isArray(b)||b.length!==4||b.some(v=>!number(v)||Math.abs(v)>1e9))throw Error('DEM bounds need finite metre coordinates within +/-1e9');
    if(!(b[2]-b[0]>0&&b[2]-b[0]<=100000&&b[3]-b[1]>0&&b[3]-b[1]<=100000))throw Error('DEM extent must be positive and at most 100 km per axis');
    if(!Array.isArray(h)||!h.length||!Array.isArray(h[0])||!h[0].length)throw Error('DEM needs a rectangular north-up height matrix');
    if(h.length*h[0].length>1024)throw new ResourceError('terrain accepts at most 1024 DEM cells');
    if(h.some(row=>!Array.isArray(row)||row.length!==h[0].length||row.some(v=>!number(v)||v-params.reference_height_m<0||v-params.reference_height_m>10000)))throw Error('DEM must be complete rectangular finite land heights within 10 km above reference');
  }return params;
}
function gravityPlateOptions(options){return gravityTopographyOptions(options,false);}
function gravityTerrainOptions(options){return gravityTopographyOptions(options,true);}
function gravityTopographyHistory(states,channel,terrain) {
  const expected={gravity_normal:'applied',gravity_drift:'applied',gravity_tide:'applied',gravity_free_air:'unapplied',gravity_bouguer:terrain?'applied':'unapplied',gravity_terrain:'unapplied'};
  for(const [name,required] of Object.entries(expected)){if(states[name][channel]==='unknown')throw new NeedsInput('declare evidence-backed '+required+' '+name+' history');if(states[name][channel]!==required)throw Error('gravity topography order/repeat conflicts with '+name);}
}
function matchingGravityPlate(entries,params) {
  const matches=entries.filter(e=>e.kind==='application'&&e.correction==='gravity_bouguer'&&e.channels.length===1&&e.channels[0]===params.channel);
  if(matches.length!==1)throw new NeedsInput('terrain requires the native bound Bouguer plate event');
  if(['density_kg_m3','reference_height_m','height_datum'].some(k=>matches[0].parameters[k]!==params[k]))throw Error('terrain and Bouguer density/reference/height datum must match');
}
function gravityTopographyContext(data,params,checkGeometry=true) {
  if(data.records.length>512)throw new ResourceError('gravity topography accepts at most 512 records');const c=params.channel,m=data.metadata;
  if(!Object.hasOwn(data.channels,c)||data.channels[c].field_type!=='gravity_disturbance'||data.channels[c].units!=='mGal')throw Error('topography requires gravity_disturbance in mGal');
  const datum=effectiveGravityDatum(data,c);if(m.height_units!=='m'||m.z_positive!=='up'||m.height_datum!==params.height_datum||!knownGravityLabel(datum)||!['tide_free','zero_tide','mean_tide'].includes(m.tide_system))throw new NeedsInput('declare matching height datum/metres/up, selected gravity datum and tide system');
  const readings=data.records.filter(r=>r.values[c]!==null);if(!readings.length)throw new NeedsInput('gravity topography needs nonnull readings');
  if(readings.some(r=>!number(r.z)||r.z-params.reference_height_m<0||r.z-params.reference_height_m>10000))throw new NeedsInput('each reading requires land height within 10 km above reference');
  if(Object.hasOwn(params,'dem')) {
    const d=params.dem;const unit=geophysicsCoordinateUnit({crs:data.crs,metadata:{crs_units:data.crs_units}});
    if(unit!=='m'||data.crs!==d.crs||data.crs_units!=='m'||(data.crs===null&&(!knownGravityLabel(m.frame_id)||m.frame_id!==d.frame_id))||(data.crs!==null&&d.frame_id!==null))throw new NeedsInput('DEM and survey require the same projected/local metre frame');
    const [w,s,e,n]=d.bounds,rows=d.heights.length,cols=d.heights[0].length;if(readings.length*rows*cols>524288)throw new ResourceError('terrain station-cell pair budget exceeded');
    for(const r of checkGeometry?readings:[]){if(!number(r.x)||!number(r.y))throw new NeedsInput('terrain needs finite XY for every nonnull reading');const margin=Math.min(r.x-w,e-r.x,r.y-s,n-r.y);if(margin<params.min_edge_distance_m)throw new NeedsInput('station lacks the explicitly required DEM edge support');const i=Math.min(rows-1,Math.floor((n-r.y)/(n-s)*rows)),j=Math.min(cols-1,Math.floor((r.x-w)/(e-w)*cols));if(Math.abs(r.z-d.heights[i][j])>params.ground_tolerance_m)throw new NeedsInput('station height does not match containing DEM cell');}
  }return [data.crs,data.crs_units,m.frame_id??null,m.height_units,m.height_datum,m.z_positive,datum,m.tide_system];
}
async function gravityTopographyBinding(data,params,model) {
  const context=gravityTopographyContext(data,params,false),buffer=new ArrayBuffer(8),view=new DataView(buffer);
  function canonical(value){if(typeof value==='number'){if(!number(value))throw Error('topography numbers must be finite portable binary64');view.setFloat64(0,value===0?0:value,false);return ['f64',[...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('')];}if(Array.isArray(value))return value.map(canonical);if(object(value))return Object.keys(value).sort().map(k=>[k,canonical(value[k])]);return value;}
  const semantic=Object.fromEntries(Object.entries(params).filter(([k])=>!['event_id','evidence'].includes(k))),rows=data.records.map(r=>[r.id,r.z]);const encoded=new TextEncoder().encode(JSON.stringify(['baselode.gravity_topography_binding.v1',canonical(semantic),canonical(model),canonical(context),canonical(rows)]));
  if(encoded.length>limits.max_binding_bytes)throw new ResourceError('gravity topography binding exceeds byte limit');if(!globalThis.crypto?.subtle)throw new NeedsInput('SHA-256 binding requires Web Crypto');
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',encoded))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
