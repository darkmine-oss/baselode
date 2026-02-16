import { describe, expect, it } from 'vitest';

import {
  attachAssayPositions,
  balancedTangentialDesurvey,
  minimumCurvatureDesurvey,
  tangentialDesurvey
} from '../src/data/desurveyMethods.js';


describe('desurveyMethods parity helpers', () => {
  const collars = [
    { hole_id: 'H1', x: 500000, y: 6900000, z: 300 }
  ];

  const surveys = [
    { hole_id: 'H1', from: 0, azimuth: 0, dip: -60 },
    { hole_id: 'H1', from: 50, azimuth: 10, dip: -65 },
    { hole_id: 'H1', from: 100, azimuth: 20, dip: -70 }
  ];

  it('returns trace rows with expected keys for all methods', () => {
    const methods = [minimumCurvatureDesurvey, tangentialDesurvey, balancedTangentialDesurvey];

    methods.forEach((run) => {
      const traces = run(collars, surveys, { step: 10 });
      expect(traces.length).toBeGreaterThan(1);
      const sample = traces[0];
      ['hole_id', 'md', 'x', 'y', 'z', 'azimuth', 'dip'].forEach((key) => {
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
});
