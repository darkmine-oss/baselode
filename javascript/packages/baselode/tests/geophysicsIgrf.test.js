/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, it, expect } from 'vitest';
import { describeGeophysicsIgrf } from '../src/geophysics.js';
import { describeGeophysicsCorrections } from '../src/data/geophysicsCorrections.js';

describe('IGRF published contracts', () => {
  it('publishes matching identities for reference calculation and ledger replay', () => {
    const contract = describeGeophysicsIgrf();
    expect(contract.model).toEqual(describeGeophysicsCorrections().igrf_model.const);
    expect(contract.removal_parameters).toEqual(describeGeophysicsCorrections().igrf_parameters);
    expect(contract.result_schema.properties.model.anyOf[1].const).toEqual(contract.model);
    expect(contract.execution.javascript).toContain('Python');
  });
  it('returns independent mutable descriptions', () => {
    const first = describeGeophysicsIgrf(); first.model.model = 'changed'; first.request_schema.properties.points.maxItems = 0;
    expect(describeGeophysicsIgrf().model.model).toBe('IGRF14');
    expect(describeGeophysicsIgrf().request_schema.properties.points.maxItems).toBe(512);
  });
});
