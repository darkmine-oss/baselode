/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { DrillholeSet } from '../src/data/drillholeSet.js';

const collarRows = () => [
  { hole_id: 'A', easting: 500000, northing: 6900000, elevation: 300, max_depth: 100 },
  { hole_id: 'B', easting: 500100, northing: 6900050, elevation: 305, max_depth: 80 },
];

const surveyRows = () => [
  { hole_id: 'A', depth: 0, azimuth: 0, dip: -90 },
  { hole_id: 'A', depth: 100, azimuth: 0, dip: -90 },
  { hole_id: 'B', depth: 0, azimuth: 90, dip: -60 },
  { hole_id: 'B', depth: 80, azimuth: 90, dip: -60 },
];

const assayRows = () => [
  { hole_id: 'A', from: 0, to: 10, au_ppm: 0.1 },
  { hole_id: 'A', from: 10, to: 20, au_ppm: 0.2 },
  { hole_id: 'B', from: 0, to: 20, au_ppm: 0.05 },
];

describe('DrillholeSet construction and table registration', () => {
  it('records the inputs and metadata', () => {
    const db = new DrillholeSet(collarRows(), surveyRows(), {
      crs: 'EPSG:32750', project: 'goldfields',
    });
    expect(db.crs).toBe('EPSG:32750');
    expect(db.project).toBe('goldfields');
    expect(db.collar).toHaveLength(2);
    expect(db.survey).toHaveLength(4);
    expect(db.tables).toEqual({});
  });

  it('addTable is chainable and records the kind tag', () => {
    const db = new DrillholeSet(collarRows(), surveyRows());
    const result = db.addTable('assay', assayRows()).addTable('geology', [], 'litho');
    expect(result).toBe(db);
    expect(Object.keys(db.tables)).toEqual(['assay', 'geology']);
    expect(db.tableKinds).toEqual({ assay: 'assay', geology: 'litho' });
  });

  it('addTable rejects an empty name', () => {
    const db = new DrillholeSet(collarRows(), surveyRows());
    expect(() => db.addTable('', assayRows())).toThrow();
  });

  it('exposes holes via the collar table', () => {
    const db = new DrillholeSet(collarRows(), surveyRows());
    expect([...db.holes].sort()).toEqual(['A', 'B']);
  });

  it('get / has surface the registered tables', () => {
    const db = new DrillholeSet(collarRows(), surveyRows()).addTable('assay', assayRows());
    expect(db.has('assay')).toBe(true);
    expect(db.has('missing')).toBe(false);
    expect(db.get('assay')).toBe(db.tables.assay);
  });
});

describe('DrillholeSet.validate', () => {
  it('returns a structured report', () => {
    const db = new DrillholeSet(collarRows(), surveyRows()).addTable('assay', assayRows());
    const report = db.validate();
    expect(report).toHaveProperty('summary');
    expect(report).toHaveProperty('issues');
    expect(report.summary.error).toBe(0);
  });

  it('forwards options to validateDrillholeDb', () => {
    const survey = surveyRows();
    survey[0].azimuth = 360;
    const db = new DrillholeSet(collarRows(), survey);
    const strict = db.validate();
    const permissive = db.validate({ allowFullCircle: true });
    expect(strict.issues.filter((issue) => issue.check === 'azimuth_range')).toHaveLength(1);
    expect(permissive.issues.filter((issue) => issue.check === 'azimuth_range')).toHaveLength(0);
  });
});

describe('DrillholeSet.desurvey', () => {
  it('runs desurvey, returns trace rows with expected shape, and caches identical args', () => {
    const db = new DrillholeSet(collarRows(), surveyRows());
    const first = db.desurvey({ step: 10 });
    expect(first.length).toBeGreaterThan(1);
    expect(first[0]).toHaveProperty('md');
    expect(first[0]).toHaveProperty('hole_id');
    const second = db.desurvey({ step: 10 });
    expect(second).toBe(first);
  });

  it('maps canonical baselode columns (easting/northing/elevation, depth) into the desurvey shape', () => {
    const db = new DrillholeSet(collarRows(), surveyRows());
    const traces = db.desurvey({ step: 10 });
    // collar A starts at easting=500000, so the first sample should sit at x=500000 (or near it),
    // not at the legacy x=0 fallback that would happen if mapping were absent.
    const firstA = traces.find((row) => row.hole_id === 'A');
    expect(firstA.x).toBeCloseTo(500000, 1);
    expect(firstA.y).toBeCloseTo(6900000, 1);
  });

  it('recomputes when args change or force is true', () => {
    const db = new DrillholeSet(collarRows(), surveyRows());
    const first = db.desurvey({ step: 10 });
    const second = db.desurvey({ step: 5 });
    const third = db.desurvey({ step: 5, force: true });
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
  });

  it('rejects an unknown method', () => {
    const db = new DrillholeSet(collarRows(), surveyRows());
    expect(() => db.desurvey({ method: 'black_magic' })).toThrow(/Unknown desurvey method/);
  });

  it('exposes the cached trace via .traces with real content', () => {
    const db = new DrillholeSet(collarRows(), surveyRows());
    const traces = db.traces;
    expect(traces.length).toBeGreaterThan(1);
    expect(traces[0]).toHaveProperty('md');
    expect(db._traces).toBe(traces);
  });
});

describe('DrillholeSet column-name forwarding', () => {
  it('propagates a custom holeCol into validateDrillholeDb', () => {
    // Only one survey station for hole A — with the right holeCol this is
    // a single_station_surveys warning; with the wrong fallback the rows
    // group under undefined and no warning fires.
    const collar = [
      { HOLEID: 'A', easting: 0, northing: 0, elevation: 0, max_depth: 100 },
    ];
    const survey = [
      { HOLEID: 'A', depth: 0, azimuth: 0, dip: -90 },
    ];
    const db = new DrillholeSet(collar, survey, { holeCol: 'HOLEID' });
    const report = db.validate();
    const warnings = report.issues.filter(
      (issue) => issue.check === 'single_station_surveys',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].hole_id).toBe('A');
  });
});

describe('DrillholeSet reserved table names', () => {
  it('rejects "collars"', () => {
    const db = new DrillholeSet(collarRows(), surveyRows());
    expect(() => db.addTable('collars', assayRows())).toThrow(/reserved/);
  });

  it('rejects "traces"', () => {
    const db = new DrillholeSet(collarRows(), surveyRows());
    expect(() => db.addTable('traces', assayRows())).toThrow(/reserved/);
  });
});

describe('DrillholeSet.toString', () => {
  it('reflects state', () => {
    const db = new DrillholeSet(collarRows(), surveyRows()).addTable('assay', assayRows());
    const text = db.toString();
    expect(text).toContain('holes=2');
    expect(text).toContain('surveyRows=4');
    expect(text).toContain('assay');
  });
});
