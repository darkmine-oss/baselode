/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import {
  attachAssayPositions,
  balancedTangentialDesurvey,
  midpointTangentialDesurvey,
  minimumCurvatureDesurvey,
  tangentialDesurvey
} from '../src/data/desurveyMethods.js';

import fixture from '../../../test/data/desurvey_reference.json';


describe('desurveyMethods parity helpers', () => {
  const collars = [
    { hole_id: 'H1', easting: 500000, northing: 6900000, elevation: 300 }
  ];

  const surveys = [
    { hole_id: 'H1', depth: 0, azimuth: 0, dip: -60 },
    { hole_id: 'H1', depth: 50, azimuth: 10, dip: -65 },
    { hole_id: 'H1', depth: 100, azimuth: 20, dip: -70 }
  ];

  it('returns trace rows with expected keys for all methods', () => {
    const methods = [
      minimumCurvatureDesurvey, tangentialDesurvey, balancedTangentialDesurvey, midpointTangentialDesurvey
    ];

    methods.forEach((run) => {
      const traces = run(collars, surveys, { step: 10 });
      expect(traces.length).toBeGreaterThan(1);
      const sample = traces[0];
      ['hole_id', 'md', 'x', 'y', 'z', 'azimuth', 'dip'].forEach((key) => {
        expect(sample).toHaveProperty(key);
      });
      ['easting', 'northing', 'elevation'].forEach((key) => {
        expect(sample).toHaveProperty(key);
      });
    });
  });

  it('attaches nearest trace positions to assay intervals by midpoint MD', () => {
    const traces = minimumCurvatureDesurvey(collars, surveys, { step: 5 });
    const assays = [
      { hole_id: 'H1', from: 10, to: 20, grade: 1.2 },
      { hole_id: 'H1', from: 40, to: 50, grade: 2.5 }
    ];

    const merged = attachAssayPositions(assays, traces);

    expect(merged).toHaveLength(2);
    merged.forEach((row) => {
      expect(Number.isFinite(row.x) || Number.isFinite(row.x_trace)).toBe(true);
      expect(Number.isFinite(row.y) || Number.isFinite(row.y_trace)).toBe(true);
      expect(Number.isFinite(row.z) || Number.isFinite(row.z_trace)).toBe(true);
    });
  });

  it('uses compass azimuth and elevation-positive-up coordinates', () => {
    const traces = minimumCurvatureDesurvey(
      [{ hole_id: 'EAST', easting: 0, northing: 0, elevation: 0 }],
      [
        { hole_id: 'EAST', depth: 0, azimuth: 90, dip: -60 },
        { hole_id: 'EAST', depth: 100, azimuth: 90, dip: -60 }
      ],
      { step: 100 }
    );
    const toe = traces.at(-1);
    expect(toe.easting).toBeCloseTo(50, 6);
    expect(toe.northing).toBeCloseTo(0, 6);
    expect(toe.elevation).toBeCloseTo(-86.60254, 5);
    expect(toe.x).toBe(toe.easting);
    expect(toe.y).toBe(toe.northing);
    expect(toe.z).toBe(toe.elevation);
  });

  it('joins collar and survey hole IDs case-insensitively', () => {
    const traces = minimumCurvatureDesurvey(
      [{ hole_id: 'DH001', easting: 0, northing: 0, elevation: 0 }],
      [
        { hole_id: 'dh001', depth: 0, azimuth: 0, dip: -90 },
        { hole_id: 'dh001', depth: 10, azimuth: 0, dip: -90 }
      ],
      { step: null }
    );
    expect(traces).toHaveLength(2);
    expect(traces.at(-1).hole_id).toBe('DH001');
    expect(traces.at(-1).elevation).toBeCloseTo(-10, 6);
  });

  it('matches the wellpathpy minimum-curvature fixture at survey stations', () => {
    const tolerance = fixture.tolerance_position_m;
    fixture.trajectories.forEach((trajectory) => {
      const collar = trajectory.collar;
      const traces = minimumCurvatureDesurvey(
        [{
          hole_id: collar.hole_id,
          easting: collar.easting,
          northing: collar.northing,
          elevation: collar.elevation
        }],
        trajectory.surveys,
        { step: 1 }
      );
      trajectory.expected.minimum_curvature.forEach((expected) => {
        const row = traces.find((trace) => Math.abs(trace.md - expected.md) < 1e-6);
        expect(row, `${trajectory.name} is missing md=${expected.md}`).toBeDefined();
        expect(row.easting - collar.easting).toBeCloseTo(expected.easting_offset, 2);
        expect(row.northing - collar.northing).toBeCloseTo(expected.northing_offset, 2);
        expect(collar.elevation - row.elevation).toBeCloseTo(expected.tvd, 2);
        expect(Math.abs((row.easting - collar.easting) - expected.easting_offset)).toBeLessThanOrEqual(tolerance);
        expect(Math.abs((row.northing - collar.northing) - expected.northing_offset)).toBeLessThanOrEqual(tolerance);
        expect(Math.abs((collar.elevation - row.elevation) - expected.tvd)).toBeLessThanOrEqual(tolerance);
      });
    });
  });
});

describe('desurvey collar extrapolation (GH-96)', () => {
  const collar = [{ hole_id: 'T1', easting: 1000, northing: 2000, elevation: 300 }];
  const methods = {
    minimumCurvatureDesurvey, tangentialDesurvey, balancedTangentialDesurvey, midpointTangentialDesurvey
  };

  Object.entries(methods).forEach(([name, run]) => {
    it(`${name}: a single deep station is extended straight up to the collar`, () => {
      const traces = run(collar, [{ hole_id: 'T1', depth: 135, azimuth: 90, dip: -60 }], { step: 5 });
      expect(traces[0].md).toBe(0);
      expect(traces[0].easting).toBe(1000);
      expect(traces[0].elevation).toBe(300);
      const toe = traces.at(-1);
      expect(toe.md).toBeCloseTo(135, 9);
      expect(toe.easting).toBeCloseTo(1000 + 135 * Math.cos(Math.PI / 3), 6);
      expect(toe.northing).toBeCloseTo(2000, 6);
      expect(toe.elevation).toBeCloseTo(300 - 135 * Math.sin(Math.PI / 3), 6);
    });
  });

  it('keeps the first station orientation from md 0 down to that station', () => {
    const traces = minimumCurvatureDesurvey(
      collar,
      [
        { hole_id: 'T1', depth: 10, azimuth: 0, dip: -90 },
        { hole_id: 'T1', depth: 20, azimuth: 90, dip: -45 }
      ],
      { step: 1 }
    );
    const at10 = traces.find((row) => Math.abs(row.md - 10) < 1e-9);
    expect(at10.easting).toBeCloseTo(1000, 9);
    expect(at10.elevation).toBeCloseTo(290, 9);
  });

  it('leaves a survey that already starts at md 0 unchanged', () => {
    const traces = minimumCurvatureDesurvey(
      collar,
      [{ hole_id: 'T1', depth: 0, azimuth: 0, dip: -90 }, { hole_id: 'T1', depth: 10, azimuth: 0, dip: -90 }],
      { step: 1 }
    );
    expect(traces).toHaveLength(11);
    expect(traces[0].md).toBe(0);
  });
});

describe('midpointTangentialDesurvey (GH-96)', () => {
  const collar = [{ hole_id: 'M1', easting: 1000, northing: 2000, elevation: 300 }];

  it('switches orientation halfway between stations', () => {
    const traces = midpointTangentialDesurvey(
      collar,
      [{ hole_id: 'M1', depth: 0, azimuth: 0, dip: -90 }, { hole_id: 'M1', depth: 50, azimuth: 90, dip: 0 }],
      { step: 5 }
    );
    const at25 = traces.find((row) => Math.abs(row.md - 25) < 1e-9);
    expect(at25.elevation).toBeCloseTo(275, 9);
    expect(at25.easting).toBeCloseTo(1000, 9);
    const toe = traces.at(-1);
    expect(toe.md).toBeCloseTo(50, 9);
    expect(toe.elevation).toBeCloseTo(275, 9);
    expect(toe.easting).toBeCloseTo(1025, 9);
    expect(traces.filter((row) => row.md <= 25 + 1e-9).every((row) => row.dip === -90)).toBe(true);
    expect(traces.filter((row) => row.md > 25 + 1e-9).every((row) => row.dip === 0)).toBe(true);
  });

  it('differs from top-of-segment tangential on a dogleg', () => {
    const surveys = [
      { hole_id: 'M1', depth: 0, azimuth: 0, dip: -90 }, { hole_id: 'M1', depth: 50, azimuth: 90, dip: 0 }
    ];
    expect(tangentialDesurvey(collar, surveys, { step: 5 }).at(-1).elevation).toBeCloseTo(250, 9);
    expect(midpointTangentialDesurvey(collar, surveys, { step: 5 }).at(-1).elevation).toBeCloseTo(275, 9);
  });

  it('runs the last orientation from the last midpoint to the end of hole', () => {
    const traces = midpointTangentialDesurvey(
      collar,
      [
        { hole_id: 'M1', depth: 0, azimuth: 0, dip: -90 },
        { hole_id: 'M1', depth: 20, azimuth: 0, dip: -90 },
        { hole_id: 'M1', depth: 40, azimuth: 0, dip: 0 }
      ],
      { step: 10 }
    );
    const at30 = traces.find((row) => Math.abs(row.md - 30) < 1e-9);
    expect(at30.elevation).toBeCloseTo(270, 9);
    expect(at30.northing).toBeCloseTo(2000, 9);
    const toe = traces.at(-1);
    expect(toe.elevation).toBeCloseTo(270, 9);
    expect(toe.northing).toBeCloseTo(2010, 9);
  });
});
