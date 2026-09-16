// Copyright (C) 2026 Darkmine Pty Ltd.

// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { getGeologicalSchema, getGeologicalTable } from '../src/data/geological.js';

describe('geological storage schema', () => {
  it('exposes drill and surface measurements with explicit identities', () => {
    expect(Object.keys(getGeologicalSchema().tables)).toHaveLength(21);
    expect(getGeologicalTable('drill.collar').primaryKey).toEqual(['_collar_id']);
    expect(getGeologicalTable('surface.petrophysics').columns._surface_sample_id).toBeDefined();
    expect(getGeologicalTable('surface.petrophysics').columns._collar_id).toBeUndefined();
    expect(getGeologicalTable('drill.veins')).toBeDefined();
    expect(getGeologicalTable('missing')).toBeUndefined();
    expect(getGeologicalTable('constructor')).toBeUndefined();
    expect(getGeologicalTable('toString')).toBeUndefined();
    expect(getGeologicalTable('__proto__')).toBeUndefined();
  });

  it('does not let consumers mutate subsequent lookups', () => {
    getGeologicalTable('drill.collar').columns.geography.storageType = 'text';
    expect(getGeologicalTable('drill.collar').columns.geography.storageType)
      .toBe('geography(Point,7844)');
  });
});
