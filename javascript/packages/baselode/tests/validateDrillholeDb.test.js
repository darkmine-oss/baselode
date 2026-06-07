/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  validateDrillholeDb,
  fixSingleStationSurveys,
  replaceBelowDetectionLimit,
} from '../src/data/validateDrillholeDb.js';

const collarRow = (hole_id, max_depth = 100) => ({
  hole_id,
  easting: 0,
  northing: 0,
  elevation: 0,
  max_depth,
});
const surveyRow = (hole_id, depth, azimuth = 0, dip = -90) => ({ hole_id, depth, azimuth, dip });
const assayRow = (hole_id, from, to, au_ppm = 0.1) => ({ hole_id, from, to, au_ppm });
const checksWith = (report, name) => report.issues.filter((issue) => issue.check === name);

describe('validateDrillholeDb', () => {
  it('reports no issues on a clean db', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A')],
      survey: [surveyRow('A', 0), surveyRow('A', 50)],
      intervalTables: { assay: [assayRow('A', 0, 1), assayRow('A', 1, 2)] },
    });
    expect(report.summary).toEqual({ error: 0, warning: 0, info: 0 });
    expect(report.issues).toEqual([]);
  });

  it('flags duplicate hole_ids in collar', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A'), collarRow('A')],
      survey: [surveyRow('A', 0), surveyRow('A', 100)],
    });
    const issues = checksWith(report, 'duplicate_hole_ids');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
  });

  it('flags single-station surveys with the fix recipe', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A')],
      survey: [surveyRow('A', 0)],
    });
    const issues = checksWith(report, 'single_station_surveys');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].fix).toContain('fixSingleStationSurveys');
  });

  it('flags azimuth out of [0, 360)', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A')],
      survey: [surveyRow('A', 0, 400, -90), surveyRow('A', 100, 0, -90)],
    });
    expect(checksWith(report, 'azimuth_range')[0].severity).toBe('error');
  });

  it('flags dip out of [-90, 90]', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A')],
      survey: [surveyRow('A', 0, 0, -100), surveyRow('A', 100, 0, -90)],
    });
    expect(checksWith(report, 'dip_range')[0].severity).toBe('error');
  });

  it('flags orphan intervals', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A')],
      survey: [surveyRow('A', 0), surveyRow('A', 100)],
      intervalTables: { assay: [assayRow('B', 0, 1)] },
    });
    const issues = checksWith(report, 'orphan_intervals');
    expect(issues).toHaveLength(1);
    expect(issues[0].hole_id).toBe('B');
    expect(issues[0].table).toBe('assay');
  });

  it('flags negative or zero lengths', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A')],
      survey: [surveyRow('A', 0), surveyRow('A', 100)],
      intervalTables: { assay: [assayRow('A', 5, 2)] },
    });
    expect(checksWith(report, 'negative_lengths')[0].severity).toBe('error');
  });

  it('flags intervals beyond collar max_depth', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A', 10)],
      survey: [surveyRow('A', 0), surveyRow('A', 10)],
      intervalTables: { assay: [assayRow('A', 0, 15)] },
    });
    expect(checksWith(report, 'intervals_beyond_max_depth')[0].severity).toBe('warning');
  });

  it('flags interval overlaps as warnings', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A')],
      survey: [surveyRow('A', 0), surveyRow('A', 100)],
      intervalTables: {
        assay: [assayRow('A', 0, 5, 0.1), assayRow('A', 3, 7, 0.2)],
      },
    });
    expect(checksWith(report, 'interval_overlaps')[0].severity).toBe('warning');
  });

  it('flags interval gaps as info', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A')],
      survey: [surveyRow('A', 0), surveyRow('A', 100)],
      intervalTables: {
        assay: [assayRow('A', 0, 1, 0.1), assayRow('A', 5, 6, 0.2)],
      },
    });
    expect(checksWith(report, 'interval_gaps')[0].severity).toBe('info');
  });

  it('flags below-detection sentinels as info', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A')],
      survey: [surveyRow('A', 0), surveyRow('A', 100)],
      intervalTables: {
        assay: [{ hole_id: 'A', from: 0, to: 1, au_ppm: '<0.005' }],
      },
    });
    expect(checksWith(report, 'below_detection_limit')[0].severity).toBe('info');
  });

  it('summary counts match issue severities', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A'), collarRow('A')],
      survey: [surveyRow('A', 0, 400, -90)],
      intervalTables: { assay: [assayRow('Z', 5, 2)] },
    });
    const total = report.summary.error + report.summary.warning + report.summary.info;
    expect(total).toBe(report.issues.length);
    expect(report.summary.error).toBeGreaterThanOrEqual(3);
  });
});

describe('fixSingleStationSurveys', () => {
  it('uses collar max_depth when available', () => {
    const fixed = fixSingleStationSurveys(
      [surveyRow('A', 0, 45, -60)],
      [collarRow('A', 250)],
    );
    expect(fixed).toHaveLength(2);
    expect(fixed.map((row) => row.depth)).toEqual([0, 250]);
    expect(fixed.every((row) => row.azimuth === 45 && row.dip === -60)).toBe(true);
  });

  it('falls back to depth + 1 when no max_depth', () => {
    const fixed = fixSingleStationSurveys([surveyRow('A', 12, 45, -60)]);
    expect(fixed.map((row) => row.depth)).toEqual([12, 13]);
  });

  it('leaves multi-station holes unchanged', () => {
    const fixed = fixSingleStationSurveys([
      surveyRow('A', 0),
      surveyRow('A', 50),
      surveyRow('B', 0),
    ]);
    expect(fixed).toHaveLength(4);
    expect(fixed.filter((row) => row.hole_id === 'A').map((row) => row.depth)).toEqual([0, 50]);
    expect(fixed.filter((row) => row.hole_id === 'B').map((row) => row.depth)).toEqual([0, 1]);
  });
});

describe('replaceBelowDetectionLimit', () => {
  it('substitutes half MDL by default', () => {
    const result = replaceBelowDetectionLimit(
      [
        { au_ppm: '<0.005' },
        { au_ppm: '0.012' },
        { au_ppm: '<0.02' },
      ],
      { columns: ['au_ppm'] },
    );
    expect(result.map((row) => row.au_ppm)).toEqual([0.0025, '0.012', 0.01]);
  });

  it('respects custom sentinel factor', () => {
    const result = replaceBelowDetectionLimit(
      [{ au_ppm: '<0.01' }],
      { columns: ['au_ppm'], sentinelFactor: 1.0 },
    );
    expect(result[0].au_ppm).toBe(0.01);
  });
});
