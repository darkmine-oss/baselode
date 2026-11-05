/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */

// Version 1 lineage: strict JSON encoded as UTF-8 base64 for ERS and GDAL tags.
// This records processing; it neither authenticates cells nor executes code.
export const PROVENANCE_TAG = 'BASELODE_PROVENANCE';
const SCHEMA = 'baselode.geophysics.provenance';
const MAX_BYTES = 16 * 1024 * 1024;

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
  if (!['ERS', 'GeoTIFF'].includes(output?.format) || typeof output?.dtype !== 'string') throw new TypeError('invalid provenance export descriptor');
  if (!Array.isArray(sources) || !sources.every((source) => typeof source === 'string')) throw new TypeError('invalid provenance source references');
  const steps = Object.hasOwn(metadata, 'processing') ? metadata.processing : [];
  if (!Array.isArray(steps) || !steps.every((step) => step && !Array.isArray(step) && typeof step.operation === 'string')) {
    throw new TypeError('provenance processing must be a list of named operations');
  }
  return manifest;
}

export function inputRecord(metadata) {
  const { provenance, ...snapshot } = metadata;
  if (snapshot.tags && typeof snapshot.tags === 'object') {
    snapshot.tags = Object.fromEntries(Object.entries(snapshot.tags).filter(([key]) => key !== PROVENANCE_TAG));
  }
  const sources = provenance == null ? [] : [...validate(provenance).sources];
  if (metadata.source && !sources.includes(metadata.source)) sources.push(metadata.source);
  const record = { metadata: snapshot, sources };
  jsonValue(record);
  return JSON.parse(JSON.stringify(record));
}

export function recordSelection(metadata, bands) {
  if (!metadata.provenance) return metadata;
  return { ...metadata, processing: [...(metadata.processing ?? []), { operation: 'select_bands', bands }] };
}

export function encodeProvenance(metadata, format, dtype) {
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
  if (encoded === null || encoded === undefined) return metadata;
  try {
    if (typeof encoded !== 'string' || encoded.length > 4 * Math.ceil(MAX_BYTES / 3) || (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))) {
      throw new TypeError('invalid or oversized provenance field');
    }
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    if (bytes.length > MAX_BYTES) throw new RangeError('oversized provenance field');
    const manifest = validate(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    const restored = { ...manifest.metadata, ...metadata, provenance: manifest };
    if (restored.tags && typeof restored.tags === 'object') {
      restored.tags = Object.fromEntries(Object.entries(restored.tags).filter(([key]) => key !== PROVENANCE_TAG));
    }
    return restored;
  } catch (error) {
    throw new TypeError(`invalid Baselode provenance: ${error.message}`, { cause: error });
  }
}
