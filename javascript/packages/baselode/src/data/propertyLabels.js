/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
// Per-property display metadata for strip logs and other property-keyed views.
//
// A property such as "Au" carries a value unit ("ppm") and an optional raw
// source attribute ("Au_ppb").  These helpers turn that metadata into the
// canonical display strings used in selectors, axis titles, legends and
// hover tooltips — e.g. "Au (ppm)" or "Au (ppm, source: Au_ppb)".

/**
 * Per-property display metadata.
 * @typedef {Object} PropertyMeta
 * @property {string} [label] Canonical display label. Defaults to the property key.
 * @property {string|null} [unit] Normalised value unit, rendered after the label
 *   like "Au (ppm)".
 * @property {string|null} [sourceAttribute] Raw source attribute (e.g. "Au_ppb").
 *   Shown only when distinct from the label.
 */

/** Default row column carrying the normalised value unit. */
export const DEFAULT_UNIT_COLUMN = 'analysis_uom';

/** Default row column carrying the raw source attribute name. */
export const DEFAULT_ATTRIBUTE_COLUMN = 'analyte_attribute';

/**
 * Trim a value to a non-empty string, or return null.
 * @param {*} value
 * @returns {string|null}
 */
function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = `${value}`.trim();
  return text === '' ? null : text;
}

/**
 * Resolve the display parts for a property: base label, unit and source.
 * The source attribute is suppressed when it matches the base label
 * (case-insensitive), since it carries no extra information then.
 *
 * @param {string} property - Bare property key (e.g. "Au").
 * @param {PropertyMeta} [meta] - Optional per-property metadata.
 * @returns {{ label: string, unit: string|null, source: string|null }}
 */
export function resolvePropertyLabelParts(property, meta) {
  const label = cleanText(meta?.label) ?? cleanText(property) ?? '';
  const unit = cleanText(meta?.unit);
  const rawSource = cleanText(meta?.sourceAttribute);
  const source = rawSource && rawSource.toLowerCase() !== label.toLowerCase()
    ? rawSource
    : null;
  return { label, unit, source };
}

/**
 * Format a property display label with optional unit / source attribute.
 *
 * | unit | sourceAttribute (≠ label) | Result                     |
 * |------|---------------------------|----------------------------|
 * | ppm  | Au_ppb                    | `Au (ppm, source: Au_ppb)` |
 * | ppm  | (missing or == label)     | `Au (ppm)`                 |
 * | —    | Au_ppb                    | `Au (source: Au_ppb)`      |
 * | —    | —                         | `Au`                       |
 *
 * When `meta` is omitted the bare property key is returned unchanged.
 *
 * @param {string} property - Bare property key (e.g. "Au").
 * @param {PropertyMeta} [meta] - Optional per-property metadata.
 * @returns {string}
 */
export function formatPropertyLabel(property, meta) {
  const { label, unit, source } = resolvePropertyLabelParts(property, meta);
  if (!label) return label;
  if (unit && source) return `${label} (${unit}, source: ${source})`;
  if (unit) return `${label} (${unit})`;
  if (source) return `${label} (source: ${source})`;
  return label;
}

/**
 * Derive per-property metadata directly from interval rows (Option B).
 *
 * The row-level `unitColumn` / `attributeColumn` are assumed to describe a
 * single measurement per row (the long-format assay shape). To avoid
 * mis-attributing them in wide rows, only rows where exactly one of the
 * queried properties carries a value contribute to that property's bucket;
 * wide rows where the metadata can't be unambiguously assigned are skipped.
 * A unanimous unit / attribute across a property's contributing rows is
 * adopted; a mixed set is omitted.
 *
 * @param {Array<Object>} rows - Interval rows (a hole's `points`).
 * @param {string[]} properties - Property keys to derive metadata for.
 *   Pass only actual measurement properties — exclude the metadata columns
 *   themselves (e.g. `analysis_uom`, `analyte_attribute`) so they don't count
 *   toward the "exactly one populated property" check.
 * @param {Object} [options]
 * @param {string} [options.unitColumn] - Row column holding the value unit.
 * @param {string} [options.attributeColumn] - Row column holding the source attribute.
 * @returns {Record<string, PropertyMeta>}
 */
export function derivePropertyMeta(rows, properties, {
  unitColumn = DEFAULT_UNIT_COLUMN,
  attributeColumn = DEFAULT_ATTRIBUTE_COLUMN,
} = {}) {
  const result = {};
  if (!Array.isArray(rows) || !Array.isArray(properties)) return result;

  const validProperties = properties.filter(Boolean);
  if (!validProperties.length) return result;

  const buckets = new Map(
    validProperties.map((property) => [property, { units: new Set(), attributes: new Set() }])
  );

  rows.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    let target = null;
    let ambiguous = false;
    for (const property of validProperties) {
      const value = row[property];
      if (value === undefined || value === null || value === '') continue;
      if (target !== null) {
        ambiguous = true;
        break;
      }
      target = property;
    }
    if (!target || ambiguous) return;
    const bucket = buckets.get(target);
    const unit = cleanText(row[unitColumn]);
    if (unit) bucket.units.add(unit);
    const attribute = cleanText(row[attributeColumn]);
    if (attribute) bucket.attributes.add(attribute);
  });

  buckets.forEach((bucket, property) => {
    const meta = {};
    if (bucket.units.size === 1) [meta.unit] = bucket.units;
    if (bucket.attributes.size === 1) [meta.sourceAttribute] = bucket.attributes;
    if (meta.unit || meta.sourceAttribute) result[property] = meta;
  });

  return result;
}
