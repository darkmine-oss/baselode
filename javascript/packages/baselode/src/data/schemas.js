/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Bundles the JSON Schema document generated from the Python
// `baselode.datamodel` constants.  Regenerate via
// `python -m baselode.datamodel.regen_schemas` — the regen script
// writes here AND to `test/data/baselode_schemas.json`; a parity test
// asserts both copies match the generator's current output, so the
// two languages can never disagree on field types / units / relations.

// Vite / Rollup / Vitest all support direct JSON imports natively;
// the import-attribute form (`with { type: 'json' }`) trips up Vite's
// SSR resolver, so the plain form is what ships.
import schemasDoc from './baselode_schemas.json';

/**
 * Combined Draft 2020-12 JSON Schema document with one entry per
 * baselode canonical table.  Shape:
 *
 *   {
 *     $schema: 'https://json-schema.org/draft/2020-12/schema',
 *     title:   'baselode data model',
 *     schemas: {
 *       drill_collar:     { ...JSON Schema... },
 *       drill_survey:     { ... },
 *       structural_point: { ... },
 *       drill_assay:      { ... },
 *       drill_geology:    { ... },
 *       geophysics:       { ... },
 *       surface_sample:   { ... },
 *     }
 *   }
 *
 * Each per-table schema carries the standard JSON Schema keywords
 * (`type`, `properties`, `required`) plus baselode extensions:
 * `primaryKey` (array of column names), per-field `foreignKey` (when
 * the column references another table's primary key), and per-field
 * `unit` (e.g. `'m'`, `'deg'`) where the field has a physical unit.
 */
export const BASELODE_DATA_MODEL_SCHEMAS = schemasDoc;

/**
 * Look up a single table's JSON Schema by name.  Returns `undefined`
 * if the table isn't in the bundled document — see
 * {@link BASELODE_DATA_MODEL_SCHEMAS} for the available names.
 *
 * @param {string} name - One of `'drill_collar'`, `'drill_survey'`,
 *   `'structural_point'`, `'drill_assay'`, `'drill_geology'`,
 *   `'geophysics'`, `'surface_sample'`.
 * @returns {Object|undefined}
 */
export function getBaselodeSchema(name) {
  return schemasDoc.schemas?.[name];
}
