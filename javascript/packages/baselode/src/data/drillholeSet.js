/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * DrillholeSet — composition root for the drilling tables of a project.
 *
 * Holds a collar + survey table plus N named interval tables and exposes
 * the existing function-based API as methods.  No new logic; each method
 * delegates to the corresponding module (`validateDrillholeDb`,
 * `minimumCurvatureDesurvey`, etc.).  The trace is cached after the
 * first `desurvey()` call.
 *
 * Mirrors the Python `baselode.drill.DrillholeSet` class.
 */

import { HOLE_ID, EASTING, NORTHING, ELEVATION, DEPTH, FROM } from './datamodel.js';
import { validateDrillholeDb } from './validateDrillholeDb.js';
import {
  minimumCurvatureDesurvey,
  tangentialDesurvey,
  balancedTangentialDesurvey,
  midpointTangentialDesurvey,
} from './desurveyMethods.js';

const DESURVEY_METHODS = {
  minimum_curvature: minimumCurvatureDesurvey,
  tangential: tangentialDesurvey,
  balanced_tangential: balancedTangentialDesurvey,
  midpoint_tangential: midpointTangentialDesurvey,
};

// The JS desurvey helpers (kept compatible with their existing callers)
// read `collar.x/y/z` and `survey.from`. DrillholeSet stores rows in the
// canonical baselode shape (`easting/northing/elevation` and `depth`),
// so we map at the call boundary rather than mutating the stored tables.
function _collarToDesurveyShape(row, holeCol) {
  if (!row) return row;
  return {
    ...row,
    hole_id: row[holeCol] != null ? row[holeCol] : row.hole_id,
    x: row[EASTING] != null ? row[EASTING] : row.x,
    y: row[NORTHING] != null ? row[NORTHING] : row.y,
    z: row[ELEVATION] != null ? row[ELEVATION] : row.z,
  };
}

function _surveyToDesurveyShape(row, holeCol) {
  if (!row) return row;
  return {
    ...row,
    hole_id: row[holeCol] != null ? row[holeCol] : row.hole_id,
    [FROM]: row[DEPTH] != null ? row[DEPTH] : row[FROM],
  };
}

export class DrillholeSet {
  /**
   * @param {Array<Object>} collar - Collar rows
   * @param {Array<Object>} survey - Survey rows
   * @param {Object} [options]
   * @param {string} [options.crs]
   * @param {string} [options.project]
   * @param {string} [options.holeCol=HOLE_ID]
   */
  constructor(collar, survey, { crs = null, project = null, holeCol = HOLE_ID } = {}) {
    this.collar = collar || [];
    this.survey = survey || [];
    this.crs = crs;
    this.project = project;
    this.holeCol = holeCol;
    this.tables = {};
    this.tableKinds = {};
    this._traces = null;
    this._desurveyArgs = null;
  }

  /**
   * Register an interval table.  Chainable.
   */
  addTable(name, rows, kind = 'assay') {
    if (typeof name !== 'string' || !name) {
      throw new Error('Table name must be a non-empty string');
    }
    if (name === 'collars' || name === 'traces') {
      throw new Error(`Table name '${name}' is reserved for built-in OMF elements`);
    }
    this.tables[name] = rows || [];
    this.tableKinds[name] = kind;
    return this;
  }

  /**
   * Distinct hole IDs from the collar table.
   */
  get holes() {
    const seen = new Set();
    for (const row of this.collar) {
      const value = row && row[this.holeCol];
      if (value == null) continue;
      seen.add(value);
    }
    return [...seen];
  }

  /**
   * Cached desurveyed trace; runs desurvey() on first access.
   */
  get traces() {
    if (this._traces === null) return this.desurvey();
    return this._traces;
  }

  /**
   * Desurvey the holes.  Cached when called with identical args.
   *
   * @param {Object} [options]
   * @param {string} [options.method='minimum_curvature']
   * @param {number} [options.step=1.0]
   * @param {boolean} [options.force=false]
   */
  desurvey({ method = 'minimum_curvature', step = 1.0, force = false } = {}) {
    const args = `${method}:${step}`;
    if (this._traces !== null && this._desurveyArgs === args && !force) {
      return this._traces;
    }
    const methodFn = DESURVEY_METHODS[method];
    if (!methodFn) {
      const available = Object.keys(DESURVEY_METHODS).sort().join(', ');
      throw new Error(`Unknown desurvey method '${method}'. Available: ${available}`);
    }
    const collarShaped = this.collar.map((row) => _collarToDesurveyShape(row, this.holeCol));
    const surveyShaped = this.survey.map((row) => _surveyToDesurveyShape(row, this.holeCol));
    this._traces = methodFn(collarShaped, surveyShaped, { step });
    this._desurveyArgs = args;
    return this._traces;
  }

  /**
   * Run validateDrillholeDb over the set.  Extra options are forwarded.
   */
  validate(options = {}) {
    return validateDrillholeDb(
      {
        collar: this.collar,
        survey: this.survey,
        intervalTables: Object.keys(this.tables).length ? this.tables : null,
      },
      { holeCol: this.holeCol, ...options },
    );
  }

  /**
   * Array-style table accessor.
   */
  get(tableName) {
    return this.tables[tableName];
  }

  has(tableName) {
    return Object.prototype.hasOwnProperty.call(this.tables, tableName);
  }

  toString() {
    return (
      `<DrillholeSet holes=${this.holes.length} `
      + `surveyRows=${this.survey.length} `
      + `tables=[${Object.keys(this.tables).join(', ')}]>`
    );
  }
}
