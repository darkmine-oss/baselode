/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { BASELODE_DATA_MODEL_SCHEMAS, getBaselodeSchema } from '../src/data/schemas.js';

const EXPECTED_TABLES = [
  'drill_collar',
  'drill_survey',
  'structural_point',
  'drill_assay',
  'drill_geology',
  'geophysics',
  'surface_sample',
];

describe('baselode data model schemas (JS)', () => {
  it('exposes the combined document with all tables', () => {
    expect(BASELODE_DATA_MODEL_SCHEMAS.title).toBe('baselode data model');
    expect(Object.keys(BASELODE_DATA_MODEL_SCHEMAS.schemas)).toEqual(EXPECTED_TABLES);
  });

  it('every per-table schema is a Draft 2020-12 object schema', () => {
    for (const name of EXPECTED_TABLES) {
      const schema = BASELODE_DATA_MODEL_SCHEMAS.schemas[name];
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeTypeOf('object');
      expect(Array.isArray(schema.required)).toBe(true);
      expect(Array.isArray(schema.primaryKey)).toBe(true);
    }
  });

  it('carries foreign-key annotations on every drillhole-keyed table', () => {
    for (const name of ['drill_survey', 'structural_point', 'drill_assay', 'drill_geology', 'geophysics']) {
      const fk = BASELODE_DATA_MODEL_SCHEMAS.schemas[name].properties.hole_id.foreignKey;
      expect(fk).toEqual({ table: 'drill_collar', column: 'hole_id' });
    }
  });

  it('carries unit annotations on spatial / depth / angle fields', () => {
    const collar = BASELODE_DATA_MODEL_SCHEMAS.schemas.drill_collar.properties;
    expect(collar.latitude.unit).toBe('deg');
    expect(collar.elevation.unit).toBe('m');
    const survey = BASELODE_DATA_MODEL_SCHEMAS.schemas.drill_survey.properties;
    expect(survey.depth.unit).toBe('m');
    expect(survey.azimuth.unit).toBe('deg');
    expect(survey.dip.unit).toBe('deg');
  });

  it('marks primary-key fields as required (non-nullable)', () => {
    const survey = BASELODE_DATA_MODEL_SCHEMAS.schemas.drill_survey;
    for (const pk of survey.primaryKey) {
      expect(survey.required).toContain(pk);
      // Required fields carry a string type, not [type, "null"].
      expect(typeof survey.properties[pk].type).toBe('string');
    }
  });

  it('getBaselodeSchema returns the schema for known tables and undefined otherwise', () => {
    expect(getBaselodeSchema('drill_collar')).toBe(BASELODE_DATA_MODEL_SCHEMAS.schemas.drill_collar);
    expect(getBaselodeSchema('bogus_table')).toBeUndefined();
  });
});
