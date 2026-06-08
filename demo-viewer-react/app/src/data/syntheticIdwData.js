/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Synthetic IDW test data.  The dataset deliberately encodes a known
 * scalar field so the rendered IDW volume can be visually verified:
 * the high-value cluster should glow at the same world position the
 * Gaussian peak was placed.
 */

// `InterpSamplePoint` is only a JSDoc typedef inside baselode (no
// runtime export) — refer to it via the JSDoc import below.
/** @typedef {{ id: string, holeId: string, x: number, y: number, z: number, value: number }} InterpSamplePoint */

/**
 * Deterministic pseudo-random number generator — same input always
 * gives the same output, so the page renders identically across
 * reloads without bundling a fixture file.
 *
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a synthetic 3D scalar dataset with two Gaussian "anomalies"
 * inside a box.  The high-grade cluster sits in the south-east upper
 * corner, a smaller low-grade cluster in the north-west lower corner,
 * and everywhere else is background noise.
 *
 * Coordinate frame: local meters, X = east, Y = north, Z = up.
 *
 * @param {object} [options]
 * @param {number}  [options.count=200] - How many sample points to generate
 * @param {[number,number,number]} [options.boxSize=[1000,1000,300]]
 * @param {number}  [options.seed=42]
 * @returns {{
 *   samples: InterpSamplePoint[],
 *   bounds: { min: [number,number,number], max: [number,number,number] },
 *   anomalies: Array<{ center: [number,number,number], peak: number, sigma: number }>,
 *   minValue: number,
 *   maxValue: number,
 * }}
 */
export function buildSyntheticIdwDataset(options = {}) {
  const {
    count = 200,
    boxSize = [1000, 1000, 300],
    seed = 42,
  } = options;

  const rng = mulberry32(seed);
  const [bx, by, bz] = boxSize;

  // Two analytic Gaussian anomalies — the IDW volume should reproduce
  // these as smooth coloured clouds at the same positions.
  const anomalies = [
    { center: [bx * 0.75, by * 0.25, bz * 0.75], peak: 100, sigma: bx * 0.12 },
    { center: [bx * 0.20, by * 0.80, bz * 0.20], peak:  40, sigma: bx * 0.18 },
  ];

  const samples = [];
  let minValue = Infinity;
  let maxValue = -Infinity;

  for (let i = 0; i < count; i++) {
    const x = rng() * bx;
    const y = rng() * by;
    const z = rng() * bz;

    // Sum-of-Gaussians + a thin noise floor so the IDW kernel has
    // something to interpolate even outside the anomaly cores.
    let value = 0.5 + (rng() - 0.5) * 0.8; // tiny background drift
    for (const a of anomalies) {
      const dx = x - a.center[0];
      const dy = y - a.center[1];
      const dz = z - a.center[2];
      const r2 = dx * dx + dy * dy + dz * dz;
      value += a.peak * Math.exp(-r2 / (2 * a.sigma * a.sigma));
    }

    const sample = {
      id: `synthetic_${i}`,
      holeId: `H${Math.floor(i / 20)}`, // 20 samples per hole, 10 holes
      x, y, z,
      value,
    };
    samples.push(sample);
    if (value < minValue) minValue = value;
    if (value > maxValue) maxValue = value;
  }

  return {
    samples,
    bounds: { min: [0, 0, 0], max: [bx, by, bz] },
    anomalies,
    minValue,
    maxValue,
  };
}
