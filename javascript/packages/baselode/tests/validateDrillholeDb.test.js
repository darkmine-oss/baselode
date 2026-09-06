/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  validateDrillholeDb,
  fixSingleStationSurveys,
  dropUnusableSurveyRows,
  synthesiseCollarStation,
  normalizeAzimuth,
  dropOrphanIntervals,
  swapInvertedIntervals,
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

  it('flags azimuth=360 by default with normalizeAzimuth fix recipe', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A')],
      survey: [surveyRow('A', 0, 360, -90), surveyRow('A', 100, 0, -90)],
    });
    const issues = checksWith(report, 'azimuth_range');
    expect(issues).toHaveLength(1);
    expect(issues[0].fix).toContain('normalizeAzimuth');
  });

  it('accepts azimuth=360 when allowFullCircle is true', () => {
    const report = validateDrillholeDb(
      {
        collar: [collarRow('A')],
        survey: [surveyRow('A', 0, 360, -90), surveyRow('A', 100, 0, -90)],
      },
      { allowFullCircle: true },
    );
    expect(checksWith(report, 'azimuth_range')).toEqual([]);
  });

  it('still flags azimuth > 360 when allowFullCircle is true', () => {
    const report = validateDrillholeDb(
      {
        collar: [collarRow('A')],
        survey: [surveyRow('A', 0, 360.1, -90), surveyRow('A', 100, 0, -90)],
      },
      { allowFullCircle: true },
    );
    expect(checksWith(report, 'azimuth_range')).toHaveLength(1);
  });

  it('flags dip out of [-90, 90]', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A')],
      survey: [surveyRow('A', 0, 0, -100), surveyRow('A', 100, 0, -90)],
    });
    expect(checksWith(report, 'dip_range')[0].severity).toBe('error');
  });

  it('flags orphan intervals with dropOrphanIntervals fix recipe', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A')],
      survey: [surveyRow('A', 0), surveyRow('A', 100)],
      intervalTables: { assay: [assayRow('B', 0, 1)] },
    });
    const issues = checksWith(report, 'orphan_intervals');
    expect(issues).toHaveLength(1);
    expect(issues[0].hole_id).toBe('B');
    expect(issues[0].table).toBe('assay');
    expect(issues[0].fix).toContain('dropOrphanIntervals');
  });

  it('flags negative or zero lengths with swapInvertedIntervals fix recipe', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A')],
      survey: [surveyRow('A', 0), surveyRow('A', 100)],
      intervalTables: { assay: [assayRow('A', 5, 2)] },
    });
    const issues = checksWith(report, 'negative_lengths');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].fix).toContain('swapInvertedIntervals');
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

describe('dropOrphanIntervals', () => {
  it('keeps only rows whose hole_id is in collar', () => {
    const cleaned = dropOrphanIntervals(
      [assayRow('A', 0, 1), assayRow('B', 0, 1), assayRow('A', 1, 2)],
      [collarRow('A')],
    );
    expect(cleaned).toHaveLength(2);
    expect(cleaned.every((row) => row.hole_id === 'A')).toBe(true);
  });

  it('returns empty when collar is empty', () => {
    expect(dropOrphanIntervals([assayRow('A', 0, 1)], [])).toEqual([]);
  });
});

describe('swapInvertedIntervals', () => {
  it('swaps from/to when to < from', () => {
    const fixed = swapInvertedIntervals([
      assayRow('A', 5, 2, 0.1),
      assayRow('A', 2, 5, 0.2),
      assayRow('A', 3, 3, 0.3),
    ]);
    expect(fixed.map((row) => row.from)).toEqual([2, 2, 3]);
    expect(fixed.map((row) => row.to)).toEqual([5, 5, 3]);
    expect(fixed.map((row) => row.au_ppm)).toEqual([0.1, 0.2, 0.3]);
  });

  it('preserves other columns', () => {
    const fixed = swapInvertedIntervals([
      { hole_id: 'A', from: 5, to: 2, comment: 'needs review', lithology: 'granite' },
    ]);
    expect(fixed[0]).toMatchObject({ from: 2, to: 5, comment: 'needs review', lithology: 'granite' });
  });
});

describe('normalizeAzimuth', () => {
  it('wraps 360 to 0', () => {
    const out = normalizeAzimuth([surveyRow('A', 0, 360, -90)]);
    expect(out[0].azimuth).toBe(0);
  });

  it('wraps negative and above-360 values', () => {
    const out = normalizeAzimuth([
      surveyRow('A', 0, -30, -90),
      surveyRow('A', 50, 450, -90),
      surveyRow('A', 100, 180, -90),
    ]);
    expect(out.map((row) => row.azimuth)).toEqual([330, 90, 180]);
  });

  it('leaves nullish azimuth untouched', () => {
    const out = normalizeAzimuth([{ hole_id: 'A', depth: 0, azimuth: null, dip: -90 }]);
    expect(out[0].azimuth).toBeNull();
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

describe('survey usability checks (GH-96)', () => {
  it('flags rows with null azimuth or dip as errors with a fix recipe', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A')],
      survey: [surveyRow('A', 0), { hole_id: 'A', depth: 50, azimuth: null, dip: -90 }, { hole_id: 'A', depth: 100, azimuth: 0, dip: undefined }],
    });
    const issues = checksWith(report, 'survey_null_orientation');
    expect(issues.map((issue) => issue.row_index)).toEqual([1, 2]);
    expect(issues.every((issue) => issue.severity === 'error')).toBe(true);
    expect(issues[0].message).toContain('azimuth');
    expect(issues[1].message).toContain('dip');
    expect(issues[0].fix).toContain('dropUnusableSurveyRows');
    expect(issues[0].fix).toContain('synthesiseCollarStation');
    expect(checksWith(report, 'survey_no_usable_stations')).toEqual([]);
  });

  it('warns for a hole whose only survey rows are unusable', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A'), collarRow('B')],
      survey: [surveyRow('A', 0), surveyRow('A', 50), { hole_id: 'B', depth: 0, azimuth: null, dip: null }],
    });
    const warnings = checksWith(report, 'survey_no_usable_stations');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].hole_id).toBe('B');
    expect(warnings[0].severity).toBe('warning');
    expect(warnings[0].message).toContain('1 survey row(s)');
    expect(warnings[0].fix).toContain('synthesiseCollarStation');
  });

  it('warns for a collar hole with no survey rows at all', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A'), collarRow('C')],
      survey: [surveyRow('A', 0), surveyRow('A', 50)],
    });
    const warnings = checksWith(report, 'survey_no_usable_stations');
    expect(warnings.map((issue) => issue.hole_id)).toEqual(['C']);
    expect(warnings[0].message).toContain('no survey rows');
  });

  it('skips the no-usable-station check when the survey table is empty', () => {
    const report = validateDrillholeDb({ collar: [collarRow('A')], survey: [] });
    expect(checksWith(report, 'survey_no_usable_stations')).toEqual([]);
  });

  it('counts only usable rows for the single-station check', () => {
    const report = validateDrillholeDb({
      collar: [collarRow('A')],
      survey: [surveyRow('A', 0), { hole_id: 'A', depth: 50, azimuth: null, dip: -90 }],
    });
    const single = checksWith(report, 'single_station_surveys');
    expect(single).toHaveLength(1);
    expect(single[0].row_index).toBe(0);
  });
});

describe('dropUnusableSurveyRows', () => {
  it('removes rows with null or non-numeric depth / azimuth / dip', () => {
    const survey = [
      surveyRow('A', 0),
      { hole_id: 'A', depth: 50, azimuth: null, dip: -90 },
      { hole_id: 'A', depth: 'bad', azimuth: 0, dip: -90 },
      { hole_id: 'B', depth: 0, azimuth: 10, dip: 'x' },
    ];
    const result = dropUnusableSurveyRows(survey);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(survey[0]);
    expect(survey).toHaveLength(4);
  });
});

describe('synthesiseCollarStation', () => {
  it('builds a station from the collar orientation and drops the unusable rows', () => {
    const collar = [
      { ...collarRow('A'), azimuth: 45, dip: -60 },
      { ...collarRow('B', 80), azimuth: 90, dip: -70 },
    ];
    const survey = [surveyRow('A', 0), surveyRow('A', 50), { hole_id: 'B', depth: 30, azimuth: null, dip: null }];
    const { survey: result, report } = synthesiseCollarStation(survey, collar);
    expect(report).toEqual({
      holesSynthesised: 1, fromCollar: 1, verticalFallback: 0, verticalFallbackHoles: [], rowsDropped: 1,
    });
    const bRows = result.filter((row) => row.hole_id === 'B');
    expect(bRows).toEqual([{ hole_id: 'B', depth: 0, azimuth: 90, dip: -70 }]);
    expect(result.filter((row) => row.hole_id === 'A')).toHaveLength(2);
  });

  it('falls back to vertical and reports which holes', () => {
    const collar = [collarRow('A'), collarRow('B', 80)];
    const survey = [surveyRow('A', 0), surveyRow('A', 50)];
    const { survey: result, report } = synthesiseCollarStation(survey, collar);
    expect(report.holesSynthesised).toBe(1);
    expect(report.verticalFallback).toBe(1);
    expect(report.verticalFallbackHoles).toEqual(['B']);
    expect(result.find((row) => row.hole_id === 'B')).toEqual({ hole_id: 'B', depth: 0, azimuth: 0, dip: -90 });
  });

  it('matches collar orientation columns case-insensitively', () => {
    const collar = [{ ...collarRow('B', 80), Azimuth: 120, DIP: -55 }];
    const { survey: result } = synthesiseCollarStation([], collar);
    expect(result).toEqual([{ hole_id: 'B', depth: 0, azimuth: 120, dip: -55 }]);
  });

  it('pads to max_depth when chained with fixSingleStationSurveys', () => {
    const collar = [{ ...collarRow('B', 80), azimuth: 90, dip: -60 }];
    const { survey: synthesised } = synthesiseCollarStation([{ hole_id: 'B', depth: 40, azimuth: null, dip: null }], collar);
    const padded = fixSingleStationSurveys(synthesised, collar);
    expect(padded.map((row) => row.depth)).toEqual([0, 80]);
    const report = validateDrillholeDb({ collar, survey: padded });
    expect(report.summary).toEqual({ error: 0, warning: 0, info: 0 });
  });
});
