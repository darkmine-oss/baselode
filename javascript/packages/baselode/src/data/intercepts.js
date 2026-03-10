/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Calculate significant intercepts from assay interval data.
 *
 * A significant intercept is a contiguous downhole run of assay intervals where
 * every interval meets or exceeds {@link minGrade}, and the total run length is
 * at least {@link minLength}.
 *
 * @param {Array<Object>} intervals - Assay interval rows, each containing at
 *   minimum the hole ID, from-depth, to-depth, and assay field columns.
 * @param {string} assayField - Name of the assay value property on each row
 *   (e.g. `"CU_PCT"` or `"AU_PPM"`).
 * @param {number} minGrade - Minimum grade threshold. Intervals below this
 *   value are excluded.
 * @param {number} minLength - Minimum contiguous downhole length required to
 *   report an intercept.
 * @param {Object} [options={}]
 * @param {string} [options.fromCol="from"] - Property name for the from-depth.
 * @param {string} [options.toCol="to"] - Property name for the to-depth.
 * @param {string} [options.holeCol="hole_id"] - Property name for the hole ID.
 * @returns {Array<Object>} One object per significant intercept with properties:
 *   `hole_id`, `assay_field`, `from`, `to`, `length`, `avg_grade`,
 *   `n_samples`, `label`.
 */
export function significantIntercepts(intervals, assayField, minGrade, minLength, options = {}) {
  const fromCol = options.fromCol || 'from';
  const toCol = options.toCol || 'to';
  const holeCol = options.holeCol || 'hole_id';

  if (!intervals || !intervals.length) return [];

  // Group by hole ID
  const byHole = {};
  for (const row of intervals) {
    const holeId = row[holeCol];
    if (holeId == null) continue;
    if (!byHole[holeId]) byHole[holeId] = [];
    byHole[holeId].push(row);
  }

  const results = [];

  for (const [holeId, holeIntervals] of Object.entries(byHole)) {
    // Sort by from depth
    const sorted = [...holeIntervals].sort((a, b) => Number(a[fromCol]) - Number(b[fromCol]));

    // Filter to above-threshold intervals with finite grades
    const qualifying = sorted.filter((row) => {
      const grade = Number(row[assayField]);
      return Number.isFinite(grade) && grade >= minGrade;
    });

    if (!qualifying.length) continue;

    // Group qualifying intervals into contiguous runs
    const runs = [];
    let currentRun = [];
    let prevTo = null;

    for (const row of qualifying) {
      const f = Number(row[fromCol]);
      const t = Number(row[toCol]);

      if (prevTo === null || Math.abs(f - prevTo) > 1e-6) {
        if (currentRun.length) runs.push(currentRun);
        currentRun = [row];
      } else {
        currentRun.push(row);
      }
      prevTo = t;
    }
    if (currentRun.length) runs.push(currentRun);

    for (const run of runs) {
      const totalFrom = Number(run[0][fromCol]);
      const totalTo = Number(run[run.length - 1][toCol]);
      const totalLength = totalTo - totalFrom;

      if (totalLength < minLength) continue;

      let weightedSum = 0;
      let totalWeight = 0;
      for (const row of run) {
        const grade = Number(row[assayField]);
        const len = Number(row[toCol]) - Number(row[fromCol]);
        weightedSum += grade * len;
        totalWeight += len;
      }
      const avgGrade = weightedSum / totalWeight;
      const nSamples = run.length;
      const label = `${totalLength.toFixed(1)} m @ ${avgGrade.toFixed(2)} ${assayField}`;

      results.push({
        [holeCol]: holeId,
        assay_field: assayField,
        [fromCol]: totalFrom,
        [toCol]: totalTo,
        length: totalLength,
        avg_grade: avgGrade,
        n_samples: nSamples,
        label,
      });
    }
  }

  return results;
}
