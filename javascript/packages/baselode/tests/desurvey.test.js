/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import { desurveyTraces } from '../src/data/desurvey.js';

/**
 * Azimuth is a compass bearing measured clockwise from north, so the
 * horizontal components of a trace are east = sin(azimuth) and
 * north = cos(azimuth).  `desurveyTraces` returns scene-frame `x`/`y`
 * where `x` is converted to longitude and `y` to latitude, so `x` is
 * east and `y` is north.
 *
 * These bearings are chosen deliberately: 045 is the axis of the
 * east/north mirror, so it is the one direction that looks correct under
 * a swapped decomposition and cannot discriminate.
 */
describe('desurveyTraces horizontal decomposition', () => {
  const collars = [{ hole_id: 'H1', latitude: 0, longitude: 0, elevation: 0 }];

  const traceToe = (azimuth) => {
    const surveys = [
      { hole_id: 'H1', depth: 0, azimuth, dip: -60 },
      { hole_id: 'H1', depth: 100, azimuth, dip: -60 }
    ];
    const [hole] = desurveyTraces(collars, surveys);
    return hole.points[hole.points.length - 1];
  };

  it('sends a hole drilled due east to the east', () => {
    const toe = traceToe(90);
    expect(toe.x).toBeGreaterThan(1);
    expect(toe.y).toBeCloseTo(0, 6);
  });

  it('sends a hole drilled due north to the north', () => {
    const toe = traceToe(0);
    expect(toe.y).toBeGreaterThan(1);
    expect(toe.x).toBeCloseTo(0, 6);
  });

  it('sends a hole drilled due south to the south', () => {
    const toe = traceToe(180);
    expect(toe.y).toBeLessThan(-1);
    expect(toe.x).toBeCloseTo(0, 6);
  });

  it('places the toe on its surveyed bearing', () => {
    for (const azimuth of [0, 30, 90, 135, 200, 315]) {
      const toe = traceToe(azimuth);
      const bearing = ((Math.atan2(toe.x, toe.y) * 180) / Math.PI + 360) % 360;
      expect(bearing).toBeCloseTo(azimuth, 4);
    }
  });

  it('agrees with directionCosines on the horizontal components', () => {
    // desurveyMethods.directionCosines is the reference implementation and
    // matches the Python `_direction_cosines`; the two must not drift.
    const azimuth = 93.2;
    const toe = traceToe(azimuth);
    const horizontal = Math.hypot(toe.x, toe.y);
    const az = (azimuth * Math.PI) / 180;
    expect(toe.x).toBeCloseTo(horizontal * Math.sin(az), 6);
    expect(toe.y).toBeCloseTo(horizontal * Math.cos(az), 6);
  });

  it('keeps depth and downhole length independent of azimuth', () => {
    const depths = [0, 90, 180, 270].map((azimuth) => traceToe(azimuth).z);
    depths.forEach((z) => expect(z).toBeCloseTo(depths[0], 6));
    expect(depths[0]).toBeLessThan(0); // z up, hole goes down
  });
});
