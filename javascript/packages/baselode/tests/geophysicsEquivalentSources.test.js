/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { describeGeophysicsEquivalentSources } from '../src/data/geophysicsEquivalentSources.js';
it('publishes the same independent contract as the Python-only numerical backend', () => {
  const descriptor = describeGeophysicsEquivalentSources();
  const python = JSON.parse(readFileSync(new URL('../../../../python/src/baselode/geophysics/geophysics_equivalent_sources.json', import.meta.url), 'utf8'));
  expect(descriptor).toEqual(python);
  expect(descriptor.execution.javascript).toBe('contract_only');
  expect(descriptor.request_schema.properties.operation.enum).toEqual(['grid', 'cross_validate']);
  expect(descriptor.result_contract.grid_artifacts).toEqual(['grid', 'support', 'nearest_distance', 'extrapolation']);
  descriptor.resources.max_records = 0;
  expect(describeGeophysicsEquivalentSources().resources.max_records).toBe(512);
});
