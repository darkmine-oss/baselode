/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { parseGeophysicsCSV, geophysicsToStripLogs } from '../src/data/geophysicsLoader.js';
import { parseLasFile } from '../src/data/lasLoader.js';
import { GEOPHYSICS_NULL_SENTINEL } from '../src/data/datamodel.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_CSV = `HoleId,FromDepth,ToDepth,GAMMA,DENSITY
HOLE01,0.0,0.1,-999.25,-999.25
HOLE01,0.1,0.2,55.0,-999.25
HOLE01,0.2,0.3,62.0,2.3
HOLE02,0.0,0.1,44.0,1.9
HOLE02,0.1,0.2,-999.25,2.1
`;

const POINT_CSV = `HoleId,DEPTH,GAMMA
HOLE01,0.05,45.0
HOLE01,0.15,55.0
HOLE01,0.25,62.0
`;

// 10 rows; GAMMA has real values from depth 0.55 onward; DENSITY is null throughout.
// This ensures both channels meet the >=2-sample threshold for GAMMA (5 values)
// while DENSITY tests the null-stripping behaviour cleanly.
const MINIMAL_LAS = `~VERSION INFORMATION
 VERS.                  2.0: CWLS LOG ASCII STANDARD - VERSION 2.0
 WRAP.                   NO: ONE LINE PER DEPTH STEP
~WELL INFORMATION
 STRT.M               0.05: START DEPTH
 STOP.M               0.95: STOP DEPTH
 STEP.M               0.10: STEP
 NULL.            -999.2500: NULL VALUE
 WELL.              MKC435 : WELL NAME
~CURVE INFORMATION
 DEPT    .M               : MEASURED DEPTH
 GAMMA   .GAPI            : GAMMA RAY
 DENSITY .G/CC            : BULK DENSITY
~A  DEPT      GAMMA        DENSITY
   0.0500   -999.2500   -999.2500
   0.1500   -999.2500   -999.2500
   0.2500   -999.2500   -999.2500
   0.3500   -999.2500   -999.2500
   0.4500   -999.2500   -999.2500
   0.5500     52.0000   -999.2500
   0.6500     58.0000   -999.2500
   0.7500     61.0000   -999.2500
   0.8500     74.0000   -999.2500
   0.9500     81.1000   -999.2500
`;

// ---------------------------------------------------------------------------
// parseGeophysicsCSV — interval schema (from/to)
// ---------------------------------------------------------------------------

describe('parseGeophysicsCSV — interval schema', () => {
  it('returns one entry per hole', () => {
    const result = parseGeophysicsCSV(MINIMAL_CSV);
    expect(result).toHaveLength(2);
    expect(result.map((h) => h.holeId).sort()).toEqual(['HOLE01', 'HOLE02']);
  });

  it('detects value channels', () => {
    const [hole] = parseGeophysicsCSV(MINIMAL_CSV);
    expect(Object.keys(hole.channels).sort()).toContain('gamma');
  });

  it('strips null sentinel -999.25 from values', () => {
    const result = parseGeophysicsCSV(MINIMAL_CSV);
    for (const { channels } of result) {
      for (const { values } of Object.values(channels)) {
        expect(values).not.toContain(GEOPHYSICS_NULL_SENTINEL);
      }
    }
  });

  it('uses interval midpoint as depth', () => {
    const [hole] = parseGeophysicsCSV(MINIMAL_CSV);
    // HOLE01 gamma has values at rows 0.1–0.2 (mid ~0.15) and 0.2–0.3 (mid ~0.25)
    const gamma = hole.channels['gamma'];
    expect(gamma.depths.some((d) => Math.abs(d - 0.15) < 1e-9)).toBe(true);
    expect(gamma.depths.some((d) => Math.abs(d - 0.25) < 1e-9)).toBe(true);
  });

  it('depths and values arrays have equal length', () => {
    const result = parseGeophysicsCSV(MINIMAL_CSV);
    for (const { channels } of result) {
      for (const { depths, values } of Object.values(channels)) {
        expect(depths).toHaveLength(values.length);
      }
    }
  });

  it('excludes from/to/mid from channel detection', () => {
    const result = parseGeophysicsCSV(MINIMAL_CSV);
    for (const { channels } of result) {
      expect(channels).not.toHaveProperty('from');
      expect(channels).not.toHaveProperty('to');
      expect(channels).not.toHaveProperty('mid');
    }
  });

  it('sorts depths ascending', () => {
    const [hole] = parseGeophysicsCSV(MINIMAL_CSV);
    const { depths } = hole.channels['gamma'];
    for (let i = 1; i < depths.length; i++) {
      expect(depths[i]).toBeGreaterThanOrEqual(depths[i - 1]);
    }
  });

  it('returns empty array for empty CSV', () => {
    expect(parseGeophysicsCSV('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseGeophysicsCSV — point schema (single depth column)
// ---------------------------------------------------------------------------

describe('parseGeophysicsCSV — point schema', () => {
  it('resolves single depth column', () => {
    const [hole] = parseGeophysicsCSV(POINT_CSV);
    expect(hole.holeId).toBe('HOLE01');
    expect(hole.channels['gamma'].depths).toEqual([0.05, 0.15, 0.25]);
    expect(hole.channels['gamma'].values).toEqual([45.0, 55.0, 62.0]);
  });
});

// ---------------------------------------------------------------------------
// geophysicsToStripLogs
// ---------------------------------------------------------------------------

describe('geophysicsToStripLogs', () => {
  it('returns one strip log entry per hole', () => {
    const holes = parseGeophysicsCSV(MINIMAL_CSV);
    const logs = geophysicsToStripLogs(holes);
    expect(logs).toHaveLength(2);
  });

  it('each entry has holeId, depths, values, options', () => {
    const holes = parseGeophysicsCSV(MINIMAL_CSV);
    const [log] = geophysicsToStripLogs(holes);
    expect(log).toHaveProperty('holeId');
    expect(log).toHaveProperty('depths');
    expect(log).toHaveProperty('values');
    expect(log).toHaveProperty('options');
  });

  it('selects requested channel', () => {
    const holes = parseGeophysicsCSV(MINIMAL_CSV);
    const logs = geophysicsToStripLogs(holes, 'density');
    // HOLE02 has 2 valid density values (1.9, 2.1) so the channel is retained
    const hole02 = logs.find((l) => l.holeId === 'HOLE02');
    expect(hole02.values).toContain(1.9);
    expect(hole02.values).toContain(2.1);
  });

  it('falls back to first channel when requested channel is absent', () => {
    const holes = parseGeophysicsCSV(MINIMAL_CSV);
    const logs = geophysicsToStripLogs(holes, 'nonexistent');
    expect(logs).toHaveLength(2);
  });

  it('forwards options to each entry', () => {
    const holes = parseGeophysicsCSV(POINT_CSV);
    const opts = { color: '#ff0000', panelWidth: 30 };
    const [log] = geophysicsToStripLogs(holes, null, opts);
    expect(log.options).toEqual(opts);
  });
});

// ---------------------------------------------------------------------------
// parseLasFile
// ---------------------------------------------------------------------------

describe('parseLasFile', () => {
  it('returns one hole object', () => {
    const result = parseLasFile(MINIMAL_LAS);
    expect(result).toHaveLength(1);
  });

  it('reads hole id from WELL mnemonic', () => {
    const [hole] = parseLasFile(MINIMAL_LAS);
    expect(hole.holeId).toBe('MKC435');
  });

  it('holeId option overrides well mnemonic', () => {
    const [hole] = parseLasFile(MINIMAL_LAS, { holeId: 'OVERRIDE' });
    expect(hole.holeId).toBe('OVERRIDE');
  });

  it('detects curve channels with sufficient valid samples', () => {
    const [hole] = parseLasFile(MINIMAL_LAS);
    // density is all-null in the fixture so only gamma survives the >=2-sample filter
    expect(Object.keys(hole.channels)).toContain('gamma');
    expect(Object.keys(hole.channels)).not.toContain('density');
  });

  it('strips null sentinel from values', () => {
    const [hole] = parseLasFile(MINIMAL_LAS);
    for (const { values } of Object.values(hole.channels)) {
      expect(values).not.toContain(-999.25);
    }
  });

  it('real gamma value at depth 0.95 is 81.1', () => {
    const [hole] = parseLasFile(MINIMAL_LAS);
    const { depths, values } = hole.channels['gamma'];
    const idx = depths.indexOf(0.95);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(values[idx]).toBeCloseTo(81.1, 2);
  });

  it('depths and values have equal length per channel', () => {
    const [hole] = parseLasFile(MINIMAL_LAS);
    for (const { depths, values } of Object.values(hole.channels)) {
      expect(depths).toHaveLength(values.length);
    }
  });

  it('includes units map for all declared curves', () => {
    const [hole] = parseLasFile(MINIMAL_LAS);
    // units covers all curves from ~CURVE regardless of null filtering on channels
    expect(hole.units['gamma']).toBe('GAPI');
    expect(hole.units['density']).toBe('G/CC');
  });

  it('returns empty array when no data section', () => {
    const noData = MINIMAL_LAS.split('~A')[0];
    expect(parseLasFile(noData)).toEqual([]);
  });

  it('returns empty array when no curve section', () => {
    expect(parseLasFile('~VERSION\n VERS. 2.0: v\n~A\n 0.1 55.0\n')).toEqual([]);
  });

  it('custom nullSentinel option overrides LAS file value', () => {
    const las = MINIMAL_LAS.replace('-999.2500', '9999.0000');
    const [hole] = parseLasFile(las, { nullSentinel: 9999.0 });
    for (const { values } of Object.values(hole.channels)) {
      expect(values).not.toContain(9999.0);
    }
  });

  it('output is compatible with geophysicsToStripLogs', () => {
    const holes = parseLasFile(MINIMAL_LAS);
    const logs = geophysicsToStripLogs(holes, 'gamma');
    expect(logs).toHaveLength(1);
    expect(logs[0].holeId).toBe('MKC435');
    expect(logs[0].depths.length).toBeGreaterThan(0);
  });
});
