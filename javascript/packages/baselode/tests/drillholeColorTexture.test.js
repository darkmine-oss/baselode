/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { buildDrillholeTubeGeometry } from '../src/viz/drillholeTubeGeometry.js';
import {
  buildDrillholeColorLayer,
  buildHoleTextureData,
  hexToRgbBytes,
  intervalRunsForHole,
  resolveColorMode,
  sampleLayerColorBytes,
  NO_DATA_COLOR,
  PRESENCE_COLOR,
} from '../src/viz/drillholeColorTexture.js';

const holes = [
  { id: 'DDH001', points: [{ x: 0, y: 0, z: 0, md: 0 }, { x: 0, y: 0, z: -100, md: 100 }] },
  { id: 'ddh002', points: [{ x: 10, y: 0, z: 0, md: 0 }, { x: 10, y: 0, z: -50, md: 50 }] },
];
const meta = () => buildDrillholeTubeGeometry(holes).holes;

describe('resolveColorMode', () => {
  it('maps render options to a colouring mode', () => {
    expect(resolveColorMode({})).toBe('none');
    expect(resolveColorMode({ selectedAssayVariable: '__HAS_ASSAY__', isCategoricalVariable: true })).toBe('presence');
    expect(resolveColorMode({ selectedAssayVariable: 'au', isCategoricalVariable: true })).toBe('categorical');
    expect(resolveColorMode({ selectedAssayVariable: 'au' })).toBe('numeric');
  });
});

describe('buildDrillholeColorLayer', () => {
  it('rasterises a 1 m interval so it survives a 100 m survey segment', () => {
    const layer = buildDrillholeColorLayer(meta(), {
      mode: 'numeric',
      scaleMode: 'linear',
      depthTexels: 200,
      intervalsByHole: { DDH001: [{ from: 40, to: 41, value: 10 }, { from: 0, to: 100, value: 0 }].reverse() },
    });
    // Later intervals paint over earlier ones: the 1 m hit lands on top.
    const row = layer.intervalData.subarray(0, 200);
    expect(row[80]).toBeCloseTo(1); // 40 m of 100 m → texel 80, value 10 = max → 1
    expect(row[79]).toBeCloseTo(0);
    expect(row[82]).toBeCloseTo(0);
    expect(layer.legend.entries.length).toBeGreaterThan(0);
  });

  it('leaves unpainted depth as no-data and matches holes case-insensitively', () => {
    const layer = buildDrillholeColorLayer(meta(), {
      mode: 'numeric',
      depthTexels: 100,
      intervalsByHole: { DDH002: [{ from: 0, to: 25, value: 3 }] },
    });
    const row0 = layer.intervalData.subarray(0, 100);
    const row1 = layer.intervalData.subarray(100, 200);
    expect(row0.every((v) => v === -1)).toBe(true);
    expect(row1[10]).toBeGreaterThanOrEqual(0);
    expect(row1[75]).toBe(-1);
    expect(sampleLayerColorBytes(layer, 0, 0.5)).toEqual(hexToRgbBytes(NO_DATA_COLOR));
  });

  it('assigns stable category indices and a matching legend', () => {
    const layer = buildDrillholeColorLayer(meta(), {
      mode: 'categorical',
      depthTexels: 100,
      intervalsByHole: {
        DDH001: [{ from: 0, to: 50, value: 'shale' }, { from: 50, to: 100, value: 'basalt' }],
        ddh002: [{ from: 0, to: 50, value: 'shale' }],
      },
      categoryColorMap: { basalt: '#112233' },
    });
    expect(layer.categories).toEqual(['basalt', 'shale']);
    expect(layer.legend.entries[0]).toMatchObject({ label: 'basalt', color: '#112233' });
    // basalt is index 0 → texel value 0.25, shale index 1 → 0.75
    expect(layer.intervalData[10]).toBeCloseTo(0.75);
    expect(layer.intervalData[90]).toBeCloseTo(0.25);
    expect(sampleLayerColorBytes(layer, 0, 0.9)).toEqual([0x11, 0x22, 0x33]);
    const runs = intervalRunsForHole(layer, 0);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ start: 0, end: 0.5 });
  });

  it('presence mode paints one colour wherever any interval exists', () => {
    const layer = buildDrillholeColorLayer(meta(), {
      mode: 'presence',
      depthTexels: 20,
      intervalsByHole: { DDH001: [{ from: 20, to: 30 }] },
    });
    expect(Array.from(layer.intervalData.subarray(0, 20))).toEqual([-1, -1, -1, -1, 1, 1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]);
    expect(sampleLayerColorBytes(layer, 0, 0.25)).toEqual(hexToRgbBytes(PRESENCE_COLOR));
    expect(layer.legend.entries.map((e) => e.label)).toEqual(['Has assay data', 'No assay data']);
  });

  it('quantile mode bins by rank so outliers do not flatten the ramp', () => {
    const values = [1, 1, 1, 1, 2, 2, 2, 2, 3, 1000];
    const intervals = values.map((v, i) => ({ from: i * 10, to: i * 10 + 10, value: v }));
    const layer = buildDrillholeColorLayer(meta(), { mode: 'numeric', scaleMode: 'quantile', bins: 5, depthTexels: 100, intervalsByHole: { DDH001: intervals } });
    expect(layer.legend.entries).toHaveLength(5);
    expect(layer.intervalData[5]).toBeLessThan(layer.intervalData[95]);
    expect(layer.intervalData[85]).toBeLessThan(layer.intervalData[95]);
  });

  it('log mode handles zero and negative values by clamping to the positive floor', () => {
    const layer = buildDrillholeColorLayer(meta(), {
      mode: 'numeric', scaleMode: 'log', depthTexels: 16,
      intervalsByHole: { DDH001: [{ from: 0, to: 50, value: 0 }, { from: 50, to: 100, value: 100 }] },
    });
    expect(layer.intervalData[0]).toBeCloseTo(0);
    expect(layer.intervalData[15]).toBeCloseTo(1);
  });
});

describe('buildDrillholeColorLayer edge cases', () => {
  it('falls back to a linear scale when a log scale has no positive values', () => {
    const layer = buildDrillholeColorLayer(meta(), {
      mode: 'numeric', scaleMode: 'log', depthTexels: 16,
      intervalsByHole: { DDH001: [{ from: 0, to: 50, value: -2 }, { from: 50, to: 100, value: 0 }] },
    });
    expect(layer.legend.scaleMode).toBe('linear');
    expect(layer.intervalData[0]).toBeCloseTo(0);
    expect(layer.intervalData[15]).toBeCloseTo(1);
    expect(layer.legend.entries.every((e) => !/n\/a/.test(e.label))).toBe(true);
  });

  it('survives a categorical attribute with no categories at all', () => {
    const layer = buildDrillholeColorLayer(meta(), { mode: 'categorical', depthTexels: 16, intervalsByHole: { DDH001: [{ from: 0, to: 10, value: '' }] } });
    expect(layer.categories).toEqual([]);
    expect(layer.rampBytes).toHaveLength(256 * 4);
    expect(layer.intervalData.every((v) => v === -1)).toBe(true);
  });
});

describe('buildHoleTextureData', () => {
  it('stores a base colour and a visibility flag per hole', () => {
    const data = buildHoleTextureData(meta(), { visibleIds: new Set(['ddh001']) });
    expect(data).toHaveLength(8);
    expect(data[3]).toBe(1);
    expect(data[7]).toBe(0);
    expect(data[0]).toBeGreaterThan(0);
  });
});
