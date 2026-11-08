/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import descriptor from './geophysics_corrections.json';
import { createGeophysicsObservations, unicodeStrings } from './geophysicsObservations.js';
import { jsonValue, appendInput, encodeProvenance } from './geophysicsProvenance.js';
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
  result.issues.push({ code: error instanceof NeedsInput ? 'context' : (error instanceof ResourceError ? 'resource' : 'contract'), message: error.message });
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
  for (const entry of ledger.entries) for (const channel of entry.channels) states[entry.correction][channel] = entry.state;
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

function validate(data, ledger, current, checkSummary = true) {
  if (!keys(ledger, ['schema', 'version', 'algorithm', 'initial_binding', 'current_binding', 'entries']) || ledger.schema !== schema || ledger.version !== 1 || ledger.algorithm !== algorithm) throw Error('unsupported or malformed correction ledger');
  if (!digest(ledger.initial_binding) || !digest(ledger.current_binding)) throw Error('ledger bindings must be lowercase SHA-256 digests');
  if (!Array.isArray(ledger.entries)) throw Error('correction ledger entries must be a list');
  if (ledger.entries.length > limits.max_events) throw new ResourceError('correction ledger exceeds 64 events');
  const common = ['id', 'kind', 'correction', 'channels', 'state', 'evidence', 'producer', 'input_binding', 'output_binding'];
  const baseExtra = ['parameters', 'base_binding', 'base_station_id', 'affected_records'];
  const igrfExtra = ['parameters', 'model', 'affected_records'];
  const counts = applicationCounts(data, ledger.entries);
  const states = statesFor(data, { entries: [] }); let previous = ledger.initial_binding; const ids = new Set();
  for (const [index, entry] of ledger.entries.entries()) {
    const extra = entry?.correction === 'magnetic_igrf' ? igrfExtra : (entry?.correction === 'magnetic_lag' ? ['parameters', 'masked_records', 'affected_records'] : baseExtra);
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
      try { params = (correction === 'magnetic_igrf' ? igrfOptions : (correction === 'magnetic_lag' ? lagOptions : baseOptions))(entry.parameters); }
      catch (error) { if (error instanceof NeedsInput) throw Error(`invalid stored application parameters: ${error.message}`); throw error; }
      const count = counts.get(index);
      if (!['magnetic_diurnal', 'magnetic_igrf', 'magnetic_lag'].includes(correction) || channels.length !== 1 || entry.state !== 'applied' || channels.some((name) => states[correction][name] !== 'unapplied')) throw Error('application requires unapplied supported correction history for one channel');
      if (params.channel !== channels[0] || params.event_id !== entry.id || params.evidence !== entry.evidence) throw Error('application parameters do not match the ledger event');
      if (correction === 'magnetic_diurnal' && (!digest(entry.base_binding) || !label(entry.base_station_id))) throw Error('invalid base application binding/station');
      if (correction === 'magnetic_igrf' && (!keys(entry.model, Object.keys(descriptor.igrf_model.const)) || Object.entries(descriptor.igrf_model.const).some(([key, value]) => entry.model[key] !== value))) throw Error('invalid IGRF model/coefficient/convention identity');
      if (correction === 'magnetic_lag' && ((params.unsupported_policy === 'reject' && entry.masked_records.length) || count <= entry.masked_records.length)) throw Error('lag masks require explicit mask policy and at least one supported reading');
      if (!Number.isInteger(entry.affected_records) || entry.affected_records !== count || count < 1) throw Error('application must account for every nonnull channel reading immediately before that event');
    }
    for (const name of channels) states[correction][name] = entry.state;
    previous = entry.output_binding;
  }
  if (previous !== ledger.current_binding || current !== previous) throw Error('stale ledger binding: observation data changed; use a traceable source dataset');
  if (!checkSummary) return ledger;
  const legacy = data.metadata.corrections ?? {};
  for (const correction of new Set(ledger.entries.map((entry) => entry.correction))) if (!Object.hasOwn(legacy, correction)) throw Error('legacy correction summary is missing a ledger correction');
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
  if ((data.metadata.processing ?? []).some((step) => ['correct_magnetic_base', 'remove_igrf', 'correct_magnetic_lag'].includes(step.operation))) throw Error('processing records a correction but its ledger is missing; restore the bound document instead of declaring unapplied');
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
  validate(data, ledger, await binding(data), false);
  const states = statesFor(data, ledger); data.metadata.corrections ??= {}; const legacy = data.metadata.corrections;
  for (const key of [...Object.keys(legacy), ...[...new Set(ledger.entries.map((entry) => entry.correction))].sort()]) {
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
    const output = await save(data, ledger); validate(output, ledger, await binding(output));
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
    const output = await save(data, ledger); validate(output, ledger, outputBinding);
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
    const output = await save(data, ledger); validate(output, ledger, after);
    Object.assign(result, { observations: output, ledger: clone(ledger), states: statesFor(output, ledger) }); return result;
  } catch (error) { return errorResult(result, error); }
}
