/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import {
  safeParseSerializableBaselode3DScene,
  safeParseSerializableBaselodeStripLog,
} from '../src/tool-ui/schema.js';

describe('Tool UI serializable schemas', () => {
  it('parses a valid strip-log payload and applies track defaults', () => {
    const parsed = safeParseSerializableBaselodeStripLog({
      id: 'strip-log-BLDD001',
      hole: {
        id: 'BLDD001',
        points: [
          { from: 0, to: 12, au_ppm: 0.11, lithology: 'SAP' },
          { from: 12, to: 24, au_ppm: 0.35, lithology: 'BAS' },
        ],
        metadata: {
          project: 'demo',
          isPublic: true,
          note: null,
        },
      },
      tracks: [
        { property: 'au_ppm' },
      ],
      depthRange: [0, 24],
    });

    expect(parsed).not.toBeNull();
    expect(parsed.tracks[0].displayType).toBe('numeric');
    expect(parsed.depthRange).toEqual([0, 24]);
  });

  it('parses optional per-property metadata on a strip-log payload', () => {
    const parsed = safeParseSerializableBaselodeStripLog({
      id: 'strip-log-BLDD001',
      hole: {
        id: 'BLDD001',
        points: [{ from: 0, to: 12, Au: 0.11, analysis_uom: 'ppm', analyte_attribute: 'Au_ppb' }],
      },
      tracks: [{ property: 'Au' }],
      propertyMeta: {
        Au: { unit: 'ppm', sourceAttribute: 'Au_ppb' },
        Ni: { unit: '%', sourceAttribute: null },
      },
      deriveMetaFromRows: true,
    });

    expect(parsed).not.toBeNull();
    expect(parsed.propertyMeta.Au).toEqual({ unit: 'ppm', sourceAttribute: 'Au_ppb' });
    expect(parsed.deriveMetaFromRows).toBe(true);
  });

  it('rejects invalid strip-log payloads', () => {
    expect(safeParseSerializableBaselodeStripLog({
      id: 'strip-log-BLDD001',
      hole: { id: 'BLDD001', points: [] },
      tracks: [],
    })).toBeNull();

    expect(safeParseSerializableBaselodeStripLog({
      id: 'strip-log-BLDD001',
      hole: { id: 'BLDD001', points: [] },
      tracks: [{ property: 'au_ppm' }],
      height: 1201,
    })).toBeNull();
  });

  it('parses a valid 3D scene payload with optional nested objects', () => {
    const parsed = safeParseSerializableBaselode3DScene({
      id: 'scene-BLDD001',
      height: 720,
      background: 'black',
      controlMode: 'fly',
      drillholes: {
        holes: [{ id: 'BLDD001', points: [{ x: 0, y: 0, z: 0, md: 0 }] }],
        options: { selectedAssayVariable: 'au_ppm' },
      },
      blocks: {
        data: [{ x: 0, y: 0, z: 0, au_ppm: 1.2 }],
        selectedProperty: 'au_ppm',
      },
      rasterOverlays: [{
        source: { type: 'url', url: 'https://cdn.example.test/magnetics.png' },
        bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        opacity: 0.6,
      }],
      camera: {
        fitToBounds: true,
        focusPadding: 1.4,
      },
    });

    expect(parsed).not.toBeNull();
    expect(parsed.background).toBe('black');
    expect(parsed.drillholes.holes).toHaveLength(1);
    expect(parsed.blocks.selectedProperty).toBe('au_ppm');
  });

  it('rejects invalid 3D scene payloads', () => {
    expect(safeParseSerializableBaselode3DScene({
      id: 'scene-BLDD001',
      height: 1401,
    })).toBeNull();

    expect(safeParseSerializableBaselode3DScene({
      id: 'scene-BLDD001',
      rasterOverlays: [{
        source: { type: 'file', url: 'magnetics.png' },
        bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      }],
    })).toBeNull();
  });
});
