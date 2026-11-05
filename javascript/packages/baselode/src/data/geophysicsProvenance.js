/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */

// Version 1 lineage: strict JSON encoded as UTF-8 base64 for ERS and GDAL tags.
// This records processing; it neither authenticates cells nor executes code.
export const PROVENANCE_TAG = 'BASELODE_PROVENANCE';
const SCHEMA = 'baselode.geophysics.provenance';
const MAX_BYTES = 16 * 1024 * 1024;
const DTYPES = ['float32', 'float64', 'uint8', 'int8', 'uint16', 'int16', 'uint32', 'int32'];
const READER_FIELDS = new Set(['driver', 'source', 'tags', 'width', 'height', 'datum', 'projection', 'coordinate_type', 'cell_type', 'crs_units', 'units']);

function sourceReference(value) {
  if (typeof value !== 'string') return value;
  const match = /[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(value);
  if (!match) return value;
  // Preserve spelling and opaque/VSI names; strip only URL authority
  // userinfo and query/fragment text, identically to Python.
  const end = match.index + match[0].length;
  const tail = value.slice(end).split(/[?#]/, 1)[0];
  const slash = tail.indexOf('/');
  const authority = slash < 0 ? tail : tail.slice(0, slash);
  const path = slash < 0 ? '' : tail.slice(slash);
  return value.slice(0, end) + authority.slice(authority.lastIndexOf('@') + 1) + path;
}

function redactSources(value) {
  if (Array.isArray(value)) return value.map(redactSources);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (key.toLowerCase() === 'sources' && Array.isArray(item)) return [key, item.map((source) => typeof source === 'string' ? sourceReference(source) : redactSources(source))];
    if (/(^|_)source$/i.test(key)) return [key, typeof item === 'string' ? sourceReference(item) : redactSources(item)];
    return [key, redactSources(item)];
  }));
}

function checkSteps(metadata, limit) {
  const steps = Object.hasOwn(metadata, 'processing') ? metadata.processing : [];
  if (!Array.isArray(steps) || !steps.every((step) => step && !Array.isArray(step) && typeof step.operation === 'string')) {
    throw new TypeError('provenance processing must be a list of named operations');
  }
  for (const step of steps) {
    if (Object.hasOwn(step, 'operand_lineage') && (!Number.isInteger(step.operand_lineage) || step.operand_lineage < 0 || step.operand_lineage >= limit)) {
      throw new TypeError('invalid provenance operand_lineage reference');
    }
  }
}

function checkGraph(metadata) {
  const nodes = Object.hasOwn(metadata, 'input_lineage') ? metadata.input_lineage : [];
  if (!Array.isArray(nodes)) throw new TypeError('input_lineage must be a list');
  nodes.forEach((node, index) => {
    if (!node || !node.metadata || typeof node.metadata !== 'object' || Array.isArray(node.metadata) || Object.hasOwn(node.metadata, 'input_lineage')) {
      throw new TypeError('input_lineage must contain flat metadata/source records');
    }
    if (!Array.isArray(node.sources) || !node.sources.every((source) => typeof source === 'string')) throw new TypeError('invalid input_lineage sources');
    checkSteps(node.metadata, index);
  });
  checkSteps(metadata, nodes.length);
}

function jsonValue(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || ancestors.has(value)
    || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) {
    throw new TypeError('provenance metadata must be acyclic finite JSON objects, arrays and primitives');
  }
  if (Array.isArray(value) && Array.from({ length: value.length }, (_, index) => index).some((index) => !Object.hasOwn(value, index))) {
    throw new TypeError('provenance metadata arrays must contain JSON values without holes');
  }
  if (Reflect.ownKeys(value).some((key) => typeof key !== 'string')
    || (Array.isArray(value) && Reflect.ownKeys(value).length !== value.length + 1)) {
    throw new TypeError('provenance metadata requires JSON string keys and plain arrays');
  }
  ancestors.add(value);
  for (const item of Object.values(value)) jsonValue(item, ancestors);
  ancestors.delete(value);
}

function validate(manifest) {
  jsonValue(manifest);
  if (!manifest || manifest.schema !== SCHEMA) throw new TypeError('invalid Baselode provenance schema');
  if (manifest.version !== 1) throw new TypeError('unsupported Baselode provenance version');
  const { metadata, producer, sources, export: output } = manifest;
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object' || Object.hasOwn(metadata, 'provenance')) {
    throw new TypeError('invalid provenance metadata snapshot');
  }
  if (producer?.library !== 'baselode' || typeof producer.version !== 'string') throw new TypeError('invalid provenance producer');
  if (!['ERS', 'GeoTIFF'].includes(output?.format) || !DTYPES.includes(output?.dtype)) throw new TypeError('invalid provenance export descriptor');
  if (!Array.isArray(sources) || !sources.every((source) => typeof source === 'string')) throw new TypeError('invalid provenance source references');
  checkGraph(metadata);
  return manifest;
}

export function inputRecord(metadata) {
  const { provenance, ...snapshot } = metadata;
  jsonValue(snapshot);
  if (snapshot.tags && typeof snapshot.tags === 'object' && !Array.isArray(snapshot.tags)) {
    snapshot.tags = Object.fromEntries(Object.entries(snapshot.tags).filter(([key]) => key !== PROVENANCE_TAG));
  }
  const sources = provenance == null ? [] : [...validate(provenance).sources];
  if (metadata.source && !sources.includes(metadata.source)) sources.push(metadata.source);
  const record = { metadata: snapshot, sources };
  jsonValue(record);
  const cleaned = redactSources(JSON.parse(JSON.stringify(record)));
  if (!cleaned.sources.every((source) => typeof source === 'string')) throw new TypeError('invalid provenance source references');
  cleaned.sources = [...new Set(cleaned.sources)];
  return cleaned;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function appendInput(left, right) {
  checkGraph(left);
  checkGraph(right);
  const nodes = inputRecord(left).metadata.input_lineage ?? [];
  const mapping = [];
  const keys = nodes.map((node) => JSON.stringify(canonical(node)));
  const add = (record) => {
    for (const step of record.metadata.processing ?? []) {
      if (Object.hasOwn(step, 'operand_lineage')) step.operand_lineage = mapping[step.operand_lineage];
    }
    const key = JSON.stringify(canonical(record));
    let index = keys.indexOf(key);
    if (index < 0) {
      index = nodes.length;
      nodes.push(record);
      keys.push(key);
    }
    return index;
  };
  const record = inputRecord(right);
  const inputs = record.metadata.input_lineage ?? [];
  delete record.metadata.input_lineage;
  inputs.forEach((node, index) => { mapping[index] = add(node); });
  const operand = add(record);
  return { nodes, operand };
}

export function recordSelection(metadata, bands) {
  if (!metadata.provenance) return metadata;
  return { ...metadata, processing: [...(metadata.processing ?? []), { operation: 'select_bands', bands }] };
}

export function encodeProvenance(metadata, format, dtype) {
  // Intentional v1 contract: never silently drop non-JSON metadata. Writers
  // provide includeProvenance:false for legacy metadata-agnostic exports.
  const record = inputRecord(metadata);
  const manifest = validate({
    schema: SCHEMA, version: 1,
    producer: { library: 'baselode', version: typeof __BASELODE_VERSION__ === 'undefined' ? 'unversioned' : __BASELODE_VERSION__ },
    sources: record.sources, metadata: record.metadata, export: { format, dtype },
  });
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  if (bytes.length > MAX_BYTES) throw new RangeError('Baselode provenance exceeds the 16 MiB limit');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function restoreProvenance(metadata, encoded) {
  if (encoded === null || encoded === undefined) return redactSources(metadata);
  try {
    if (typeof encoded !== 'string' || encoded.length > 4 * Math.ceil(MAX_BYTES / 3) || (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))) {
      throw new TypeError('invalid or oversized provenance field');
    }
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    if (bytes.length > MAX_BYTES) throw new RangeError('oversized provenance field');
    const manifest = redactSources(validate(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))));
    const snapshot = Object.fromEntries(Object.entries(manifest.metadata).filter(([key]) => !READER_FIELDS.has(key)));
    const restored = { ...snapshot, ...redactSources(metadata), provenance: manifest };
    if (restored.tags && typeof restored.tags === 'object') {
      restored.tags = Object.fromEntries(Object.entries(restored.tags).filter(([key]) => key !== PROVENANCE_TAG));
    }
    return restored;
  } catch (error) {
    throw new TypeError(`invalid Baselode provenance: ${error.message}`, { cause: error });
  }
}
