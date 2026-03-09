/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, beforeEach } from 'vitest';

import {
  STRIP_LOG_DEFAULT_PANEL_WIDTH,
  STRIP_LOG_DEFAULT_LATERAL_OFFSET,
  STRIP_LOG_DEFAULT_COLOR,
  normalizeStripLogOptions,
  getHoleVerticalExtent,
  buildStripLogLinePoints,
  buildStripLogGroup,
  setStripLogs,
  clearStripLogs,
} from '../src/viz/stripLogScene.js';

// ---------------------------------------------------------------------------
// Minimal stubs for Three.js objects
// ---------------------------------------------------------------------------

/** Stub THREE.Vector3 */
function makeVector3(x = 0, y = 0, z = 0) {
  return { x, y, z, isVector3: true };
}

/** Build a minimal sceneCtx */
function makeSceneCtx() {
  const objects = [];
  return {
    scene: {
      add(obj) { objects.push(obj); },
      remove(obj) {
        const i = objects.indexOf(obj);
        if (i !== -1) objects.splice(i, 1);
      },
      _objects: objects,
    },
    stripLogGroups: [],
  };
}

/** A simple straight-vertical hole */
function makeVerticalHole(id = 'H1') {
  return {
    id,
    points: [
      { x: 100, y: 50, z: 200 },  // collar
      { x: 100, y: 30, z: 200 },
      { x: 100, y: 10, z: 200 },
      { x: 100, y: -150, z: 200 }, // bottom
    ],
  };
}

/** A simple strip log definition */
function makeStripLog(holeId = 'H1', opts = {}) {
  return {
    holeId,
    depths: [0, 50, 100, 150, 200],
    values: [1.0, 2.5, 1.8, 3.1, 0.5],
    options: opts,
  };
}

// ---------------------------------------------------------------------------
// normalizeStripLogOptions
// ---------------------------------------------------------------------------

describe('normalizeStripLogOptions', () => {
  it('returns defaults when called with no arguments', () => {
    const opts = normalizeStripLogOptions();
    expect(opts.panelWidth).toBe(STRIP_LOG_DEFAULT_PANEL_WIDTH);
    expect(opts.lateralOffset).toBe(STRIP_LOG_DEFAULT_LATERAL_OFFSET);
    expect(opts.color).toBe(STRIP_LOG_DEFAULT_COLOR);
    expect(opts.valueMin).toBeNull();
    expect(opts.valueMax).toBeNull();
  });

  it('accepts explicit overrides', () => {
    const opts = normalizeStripLogOptions({ panelWidth: 30, lateralOffset: 5, color: '#ff0000', valueMin: 0, valueMax: 10 });
    expect(opts.panelWidth).toBe(30);
    expect(opts.lateralOffset).toBe(5);
    expect(opts.color).toBe('#ff0000');
    expect(opts.valueMin).toBe(0);
    expect(opts.valueMax).toBe(10);
  });

  it('coerces numeric strings', () => {
    const opts = normalizeStripLogOptions({ panelWidth: '25', lateralOffset: '8' });
    expect(opts.panelWidth).toBe(25);
    expect(opts.lateralOffset).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// getHoleVerticalExtent
// ---------------------------------------------------------------------------

describe('getHoleVerticalExtent', () => {
  it('returns null for empty or single-point holes', () => {
    expect(getHoleVerticalExtent(null)).toBeNull();
    expect(getHoleVerticalExtent([])).toBeNull();
    expect(getHoleVerticalExtent([{ x: 0, y: 0, z: 0 }])).toBeNull();
  });

  it('returns correct extent for a vertical hole', () => {
    const points = [
      { x: 100, y: 50, z: 200 },
      { x: 100, y: -150, z: 200 },
    ];
    const result = getHoleVerticalExtent(points);
    expect(result).not.toBeNull();
    expect(result.topY).toBe(50);
    expect(result.botY).toBe(-150);
    expect(result.height).toBe(200);
  });

  it('returns null for a degenerate (zero-height) hole', () => {
    const points = [
      { x: 100, y: 50, z: 200 },
      { x: 200, y: 50, z: 300 },
    ];
    expect(getHoleVerticalExtent(points)).toBeNull();
  });

  it('handles multi-point holes by taking actual min/max Y', () => {
    const points = makeVerticalHole().points;
    const result = getHoleVerticalExtent(points);
    expect(result.topY).toBe(50);
    expect(result.botY).toBe(-150);
    expect(result.height).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// buildStripLogLinePoints
// ---------------------------------------------------------------------------

describe('buildStripLogLinePoints', () => {
  it('returns empty array for null/invalid inputs', () => {
    expect(buildStripLogLinePoints(null, null, 20, 100, null, null)).toHaveLength(0);
    expect(buildStripLogLinePoints([], [], 20, 100, null, null)).toHaveLength(0);
    expect(buildStripLogLinePoints([0], [1], 20, 100, null, null)).toHaveLength(0);
  });

  it('produces one point per valid depth/value pair', () => {
    const depths = [0, 50, 100];
    const values = [1, 2, 3];
    const pts = buildStripLogLinePoints(depths, values, 20, 100, null, null);
    expect(pts).toHaveLength(3);
  });

  it('skips non-finite values', () => {
    const depths = [0, 50, NaN, 100];
    const values = [1, 2, 3, 4];
    const pts = buildStripLogLinePoints(depths, values, 20, 100, null, null);
    expect(pts).toHaveLength(3);
  });

  it('maps depth=0 to the top of the panel (localY = panelHeight/2)', () => {
    const pts = buildStripLogLinePoints([0, 100], [0, 1], 20, 100, null, null);
    expect(pts[0].y).toBeCloseTo(50);   // top
    expect(pts[1].y).toBeCloseTo(-50);  // bottom
  });

  it('maps value=min to the left edge (localX = -panelWidth/2)', () => {
    const pts = buildStripLogLinePoints([0, 100], [0, 10], 20, 100, 0, 10);
    expect(pts[0].x).toBeCloseTo(-10);  // left edge
    expect(pts[1].x).toBeCloseTo(10);   // right edge
  });

  it('uses explicit valueMin/valueMax for normalisation', () => {
    const pts = buildStripLogLinePoints([0, 100], [5, 5], 20, 100, 0, 10);
    // value=5 with range [0,10] → tVal = 0.5 → x = -10 + 0.5*20 = 0
    expect(pts[0].x).toBeCloseTo(0);
    expect(pts[1].x).toBeCloseTo(0);
  });

  it('clamps value to [0, 1] normalised space', () => {
    // value=20 is outside range [0, 10] → clamped to 1 → right edge
    const pts = buildStripLogLinePoints([0, 100], [0, 20], 20, 100, 0, 10);
    expect(pts[1].x).toBeCloseTo(10);
  });

  it('uses a small positive Z offset so the line renders above the panel', () => {
    const pts = buildStripLogLinePoints([0, 100], [0, 1], 20, 100, null, null);
    pts.forEach((p) => expect(p.z).toBeGreaterThan(0));
  });
});

// ---------------------------------------------------------------------------
// buildStripLogGroup
// ---------------------------------------------------------------------------

describe('buildStripLogGroup', () => {
  it('returns null when hole has fewer than 2 points', () => {
    const hole = { id: 'H1', points: [{ x: 0, y: 0, z: 0 }] };
    expect(buildStripLogGroup(hole, makeStripLog('H1'))).toBeNull();
  });

  it('returns null when hole has zero vertical extent', () => {
    const hole = { id: 'H1', points: [{ x: 0, y: 50, z: 0 }, { x: 100, y: 50, z: 0 }] };
    expect(buildStripLogGroup(hole, makeStripLog('H1'))).toBeNull();
  });

  it('returns a Group for a valid hole and strip log', () => {
    const hole = makeVerticalHole();
    const group = buildStripLogGroup(hole, makeStripLog('H1'));
    expect(group).not.toBeNull();
    expect(group.isGroup).toBe(true);
  });

  it('sets userData.holeId on the returned group', () => {
    const hole = makeVerticalHole('DH002');
    const group = buildStripLogGroup(hole, makeStripLog('DH002'));
    expect(group.userData.holeId).toBe('DH002');
    expect(group.userData.isStripLog).toBe(true);
  });

  it('adds at least 3 children (panel, border, line) for a valid strip log', () => {
    const hole = makeVerticalHole();
    const group = buildStripLogGroup(hole, makeStripLog('H1'));
    // panel background + border line + graph line = 3 minimum
    expect(group.children.length).toBeGreaterThanOrEqual(3);
  });

  it('adds only 2 children (panel + border) when depths/values are insufficient', () => {
    const hole = makeVerticalHole();
    const log = { holeId: 'H1', depths: [0], values: [1] }; // only 1 pair — no line
    const group = buildStripLogGroup(hole, log);
    expect(group.children.length).toBe(2);
  });

  it('panel center is offset laterally from the collar', () => {
    const hole = makeVerticalHole();
    const log = makeStripLog('H1', { lateralOffset: 15, panelWidth: 20 });
    const group = buildStripLogGroup(hole, log);
    const panelMesh = group.children[0];
    // center = collar.x + lateralOffset + panelWidth/2 = 100 + 15 + 10 = 125
    expect(panelMesh.position.x).toBeCloseTo(125);
  });
});

// ---------------------------------------------------------------------------
// setStripLogs / clearStripLogs
// ---------------------------------------------------------------------------

describe('setStripLogs', () => {
  let ctx;
  beforeEach(() => { ctx = makeSceneCtx(); });

  it('is a no-op when scene is null', () => {
    ctx.scene = null;
    expect(() => setStripLogs(ctx, [makeVerticalHole()], [makeStripLog()])).not.toThrow();
  });

  it('is a no-op when stripLogs is empty', () => {
    setStripLogs(ctx, [makeVerticalHole()], []);
    expect(ctx.stripLogGroups).toHaveLength(0);
  });

  it('is a no-op when holes array is empty', () => {
    setStripLogs(ctx, [], [makeStripLog()]);
    expect(ctx.stripLogGroups).toHaveLength(0);
  });

  it('adds one group per matched strip log', () => {
    const holes = [makeVerticalHole('H1'), makeVerticalHole('H2')];
    const logs = [makeStripLog('H1'), makeStripLog('H2')];
    setStripLogs(ctx, holes, logs);
    expect(ctx.stripLogGroups).toHaveLength(2);
  });

  it('skips strip logs whose holeId does not match any hole', () => {
    const holes = [makeVerticalHole('H1')];
    const logs = [makeStripLog('UNKNOWN')];
    setStripLogs(ctx, holes, logs);
    expect(ctx.stripLogGroups).toHaveLength(0);
  });

  it('adds groups to scene', () => {
    const holes = [makeVerticalHole('H1')];
    setStripLogs(ctx, holes, [makeStripLog('H1')]);
    expect(ctx.scene._objects).toHaveLength(1);
  });

  it('clears existing strip logs before adding new ones', () => {
    const holes = [makeVerticalHole('H1')];
    setStripLogs(ctx, holes, [makeStripLog('H1')]);
    expect(ctx.stripLogGroups).toHaveLength(1);
    setStripLogs(ctx, holes, [makeStripLog('H1'), makeStripLog('H1')]);
    expect(ctx.stripLogGroups).toHaveLength(2);
  });
});

describe('clearStripLogs', () => {
  let ctx;
  beforeEach(() => { ctx = makeSceneCtx(); });

  it('is safe to call when stripLogGroups is empty', () => {
    expect(() => clearStripLogs(ctx)).not.toThrow();
    expect(ctx.stripLogGroups).toHaveLength(0);
  });

  it('removes groups from the scene', () => {
    const holes = [makeVerticalHole('H1')];
    setStripLogs(ctx, holes, [makeStripLog('H1')]);
    expect(ctx.scene._objects).toHaveLength(1);
    clearStripLogs(ctx);
    expect(ctx.scene._objects).toHaveLength(0);
    expect(ctx.stripLogGroups).toHaveLength(0);
  });

  it('is safe to call when scene is null', () => {
    ctx.stripLogGroups = [{ traverse: () => {}, children: [] }];
    ctx.scene = null;
    expect(() => clearStripLogs(ctx)).not.toThrow();
  });
});
