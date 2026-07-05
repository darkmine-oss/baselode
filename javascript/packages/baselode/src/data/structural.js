/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Structural geology conversions for oriented-core measurements.
 *
 * Converts core-frame alpha/beta angles into real-world dip / dip-direction
 * using the hole orientation at the measurement depth. Mirrors the Python
 * module ``baselode.drill.structural`` — keep the two in sync.
 */

const DEGREES_PER_RADIAN = 180 / Math.PI;
const RADIANS_PER_DEGREE = Math.PI / 180;

/** Holes steeper than this are treated as vertical (BOH line undefined). */
const VERTICAL_HOLE_DIP_LIMIT = 89.9;

function normalizeVector(vector) {
  const magnitude = Math.hypot(vector[0], vector[1], vector[2]);
  if (magnitude === 0) return [0, 0, 0];
  return [vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude];
}

function crossProduct(first, second) {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function dotProduct(first, second) {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

/** Project `vector` onto the plane perpendicular to unit vector `axisVec`, normalised. */
function projectPerpendicular(vector, axisVec) {
  const along = dotProduct(vector, axisVec);
  return normalizeVector([
    vector[0] - along * axisVec[0],
    vector[1] - along * axisVec[1],
    vector[2] - along * axisVec[2],
  ]);
}

/**
 * Convert one alpha/beta measurement to dip / dip-direction.
 * Frame: X = east, Y = north, Z = up; all angles in degrees.
 * @private
 */
function convertSingleAlphaBeta(holeDip, holeAzimuth, alpha, beta) {
  const plungeRad = -holeDip * RADIANS_PER_DEGREE; // positive down
  const azimuthRad = holeAzimuth * RADIANS_PER_DEGREE;
  const alphaRad = alpha * RADIANS_PER_DEGREE;
  const betaRad = beta * RADIANS_PER_DEGREE;

  // Downhole unit axis.
  const axisVec = [
    Math.cos(plungeRad) * Math.sin(azimuthRad),
    Math.cos(plungeRad) * Math.cos(azimuthRad),
    -Math.sin(plungeRad),
  ];

  // Bottom-of-hole reference line: gravity projected perpendicular to the
  // axis. Degenerate for (near-)vertical holes, where north is used instead —
  // beta is then measured clockwise from north.
  const referenceVec = Math.abs(holeDip) > VERTICAL_HOLE_DIP_LIMIT
    ? [0, 1, 0]
    : [0, 0, -1];
  const bohVec = projectPerpendicular(referenceVec, axisVec);

  // Apex direction: beta clockwise looking downhole = positive right-hand
  // rotation about the downhole axis.
  const axisCrossBoh = crossProduct(axisVec, bohVec);
  const apexVec = [
    bohVec[0] * Math.cos(betaRad) + axisCrossBoh[0] * Math.sin(betaRad),
    bohVec[1] * Math.cos(betaRad) + axisCrossBoh[1] * Math.sin(betaRad),
    bohVec[2] * Math.cos(betaRad) + axisCrossBoh[2] * Math.sin(betaRad),
  ];

  // Pole to the measured plane, flipped to point up.
  let poleVec = [
    axisVec[0] * Math.sin(alphaRad) - apexVec[0] * Math.cos(alphaRad),
    axisVec[1] * Math.sin(alphaRad) - apexVec[1] * Math.cos(alphaRad),
    axisVec[2] * Math.sin(alphaRad) - apexVec[2] * Math.cos(alphaRad),
  ];
  if (poleVec[2] < 0) {
    poleVec = [-poleVec[0], -poleVec[1], -poleVec[2]];
  }

  const clampedUp = Math.min(Math.max(poleVec[2], 0), 1);
  const dip = Math.acos(clampedUp) * DEGREES_PER_RADIAN;
  if (dip === 0) return { dip: 0, dipDirection: 0 };
  // The upward pole's horizontal component points toward the dip direction
  // (steepest descent): e.g. a plane dipping east has upward pole up-and-east.
  const dipDirection = (
    (Math.atan2(poleVec[0], poleVec[1]) * DEGREES_PER_RADIAN) % 360 + 360
  ) % 360;
  return { dip, dipDirection };
}

/**
 * Convert oriented-core alpha/beta angles into dip / dip-direction.
 *
 * Conventions:
 * - `holeDip`: survey convention, negative = downward (GSWA style, e.g. −60).
 * - `holeAzimuth`: degrees clockwise from north.
 * - `alpha`: acute angle between the planar feature and the core axis
 *   (90° = plane perpendicular to core).
 * - `beta`: degrees clockwise (looking downhole) from the bottom-of-hole (BOH)
 *   reference line to the down-hole apex of the ellipse trace. For
 *   (near-)vertical holes (|holeDip| > 89.9°) the BOH line is undefined and
 *   beta is measured clockwise from north instead.
 *
 * Returns dip (0–90, positive down) and dipDirection (0–360, azimuth of
 * steepest descent). When dip is exactly 0, dipDirection is 0 by convention.
 *
 * Accepts scalars or index-aligned arrays (scalars broadcast); with any array
 * input the result fields are arrays of the same length.
 *
 * @param {number|Array<number>} holeDip
 * @param {number|Array<number>} holeAzimuth
 * @param {number|Array<number>} alpha
 * @param {number|Array<number>} beta
 * @returns {{dip: number|Array<number>, dipDirection: number|Array<number>}}
 */
export function alphaBetaToDipAzimuth(holeDip, holeAzimuth, alpha, beta) {
  const inputs = [holeDip, holeAzimuth, alpha, beta];
  const arrayLengths = inputs.filter(Array.isArray).map((input) => input.length);
  if (!arrayLengths.length) {
    return convertSingleAlphaBeta(holeDip, holeAzimuth, alpha, beta);
  }
  const count = Math.max(...arrayLengths);
  const valueAt = (input, index) => (Array.isArray(input) ? Number(input[index]) : Number(input));
  const dips = [];
  const dipDirections = [];
  for (let index = 0; index < count; index += 1) {
    const converted = convertSingleAlphaBeta(
      valueAt(holeDip, index),
      valueAt(holeAzimuth, index),
      valueAt(alpha, index),
      valueAt(beta, index)
    );
    dips.push(converted.dip);
    dipDirections.push(converted.dipDirection);
  }
  return { dip: dips, dipDirection: dipDirections };
}
