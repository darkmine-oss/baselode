/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  BASELODE_TOOL_UI_KINDS,
  BASELODE_TOOL_UI_SCHEMA_CONTRACTS,
  BASELODE_TOOL_UI_TOOL_NAMES,
  getBaselodeToolUiSchemaContract,
  getBaselodeToolUiSchemaContractByToolName,
  isBaselodeToolUiResultEmpty,
  parseBaselodeToolUiResult,
  resolveBaselodeToolUiToolNames,
} from '../src/tool-ui/contracts-entry.js';

const KINDS = Object.values(BASELODE_TOOL_UI_KINDS);

describe('published Tool UI schema contracts', () => {
  it('publishes a canonical tool name and schema for every Tool UI primitive', () => {
    expect(KINDS).toHaveLength(8);
    expect(Object.keys(BASELODE_TOOL_UI_SCHEMA_CONTRACTS)).toEqual(KINDS);
    expect(new Set(Object.values(BASELODE_TOOL_UI_TOOL_NAMES)).size).toBe(8);

    for (const kind of KINDS) {
      const contract = getBaselodeToolUiSchemaContract(kind);
      expect(contract.kind).toBe(kind);
      expect(contract.toolName).toBe(BASELODE_TOOL_UI_TOOL_NAMES[kind]);
      expect(contract.styles).toContain('baselode/tool-ui/style.css');
      expect(contract.schema.safeParse).toBeTypeOf('function');
    }
  });

  it('resolves canonical and consumer-defined backend tool names', () => {
    expect(getBaselodeToolUiSchemaContractByToolName('baselode_strip_log')?.kind)
      .toBe('strip-log');
    expect(getBaselodeToolUiSchemaContractByToolName('show_assay_chart', {
      'strip-log': 'show_assay_chart',
    })?.kind).toBe('strip-log');
    expect(getBaselodeToolUiSchemaContractByToolName('missing')).toBeNull();
    expect(() => getBaselodeToolUiSchemaContractByToolName('shared_name', {
      'strip-log': 'shared_name',
      'scatter-plot': 'shared_name',
    })).toThrow('must be unique');
    expect(() => resolveBaselodeToolUiToolNames({ scatterplot: 'plot_assays' }))
      .toThrow('Unknown Baselode Tool UI kind');
  });

  it('returns the detailed Zod validation result instead of discarding issues', () => {
    const parsed = parseBaselodeToolUiResult('scatter-plot', {
      id: 'scatter-1',
      rows: [{ au: 1 }],
      xProp: '',
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error.issues.map((issue) => issue.path.join('.')))
      .toEqual(expect.arrayContaining(['xProp', 'yProp']));
  });

  it('detects structurally valid but semantically empty results', () => {
    const emptyScatter = parseBaselodeToolUiResult('scatter-plot', {
      id: 'scatter-empty',
      rows: [],
      xProp: 'au',
      yProp: 'cu',
    });
    expect(emptyScatter.success).toBe(true);
    expect(isBaselodeToolUiResultEmpty('scatter-plot', emptyScatter.data)).toBe(true);

    const populatedScene = parseBaselodeToolUiResult('3d-scene', {
      id: 'scene-1',
      drillholes: { holes: [{ id: 'BLDD001' }] },
    });
    expect(populatedScene.success).toBe(true);
    expect(isBaselodeToolUiResultEmpty('3d-scene', populatedScene.data)).toBe(false);
  });

  it('rejects unknown kinds explicitly', () => {
    expect(() => parseBaselodeToolUiResult('map', {}))
      .toThrow('Unknown Baselode Tool UI kind');
  });
});
