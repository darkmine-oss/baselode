/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DISPLAY_COMMENT, DISPLAY_TADPOLE } from '../data/columnMeta.js';

/**
 * Decide what the TracePlot body should display for a given state.
 * Returns either { kind: 'chart' } when a chart should render, or
 * { kind: 'placeholder', text } with the message to show.
 *
 * Pure — does not touch the DOM or Plotly — so callers and tests can
 * verify the state matrix without rendering.
 *
 * @param {Object} state
 * @param {string} state.holeId           - The selected hole id (config.holeId)
 * @param {Object|null} state.hole        - The resolved hole (graph.hole)
 * @param {Array} state.holeOptions       - Available holes
 * @param {string} state.property         - The selected property (config.property)
 * @param {Array} state.propertyOptions   - Available properties
 * @param {string} state.displayType      - DISPLAY_* constant
 * @param {Array} state.points            - Plot points
 * @param {string} [state.renderError]    - Local plot-build error, if any
 * @returns {{ kind: 'chart' } | { kind: 'placeholder', text: string }}
 */
export function resolveTracePlotBody({
  holeId,
  hole,
  holeOptions,
  property,
  propertyOptions,
  displayType,
  points,
  renderError,
}) {
  if (renderError) {
    return { kind: 'placeholder', text: `Plot error: ${renderError}` };
  }
  const holes = holeOptions || [];
  if (!holeId) {
    if (holes.length === 0) {
      return { kind: 'placeholder', text: 'No holes loaded' };
    }
    return { kind: 'placeholder', text: 'Select a hole' };
  }
  if (!hole) {
    return { kind: 'placeholder', text: `Loading ${holeId}…` };
  }
  const props = propertyOptions || [];
  if (!property) {
    if (props.length === 0) {
      return { kind: 'placeholder', text: `No properties available for hole ${holeId}` };
    }
    return { kind: 'placeholder', text: 'Select a property' };
  }
  const isComment = displayType === DISPLAY_COMMENT;
  const isTadpole = displayType === DISPLAY_TADPOLE;
  const pts = points || [];
  if (!isComment && !isTadpole && pts.length === 0) {
    return { kind: 'placeholder', text: `No values for ${property} in hole ${holeId}` };
  }
  return { kind: 'chart' };
}

/**
 * Read a group value off a hole option using either a string key
 * (looked up on the option object) or a function.
 *
 * @param {string|Object} holeOption
 * @param {string|Function} groupBy
 * @returns {*} the group value, or undefined if it can't be derived
 */
export function deriveGroupValue(holeOption, groupBy) {
  if (typeof groupBy === 'function') return groupBy(holeOption);
  if (typeof groupBy !== 'string' || !groupBy) return undefined;
  if (holeOption == null || typeof holeOption !== 'object') return undefined;
  return holeOption[groupBy];
}

/**
 * Unique, non-empty group values from a list of hole options, in
 * first-seen order.
 *
 * @param {Array} holeOptions
 * @param {string|Function} groupBy
 * @returns {Array} unique group values
 */
export function groupValuesFromHoles(holeOptions, groupBy) {
  const out = [];
  const seen = new Set();
  for (const h of holeOptions || []) {
    const g = deriveGroupValue(h, groupBy);
    if (g == null || g === '') continue;
    if (seen.has(g)) continue;
    seen.add(g);
    out.push(g);
  }
  return out;
}

/**
 * Filter hole options to those whose group matches groupValue.
 * Returns the full list when groupValue is empty.
 *
 * @param {Array} holeOptions
 * @param {string|Function} groupBy
 * @param {*} groupValue
 * @returns {Array}
 */
export function filterHolesByGroup(holeOptions, groupBy, groupValue) {
  if (groupValue == null || groupValue === '') return holeOptions || [];
  return (holeOptions || []).filter((h) => deriveGroupValue(h, groupBy) === groupValue);
}

/**
 * Decide which control selects render for a given configuration.
 *
 * @param {Object} args
 * @param {Array} args.chartOptions
 * @param {boolean} args.showHoleSelect
 * @param {boolean} args.showPropertySelect
 * @param {boolean} args.showChartTypeSelect
 * @returns {{ hole: boolean, property: boolean, chartType: boolean }}
 */
export function resolveTracePlotSelectVisibility({
  chartOptions,
  showHoleSelect,
  showPropertySelect,
  showChartTypeSelect,
}) {
  const opts = chartOptions || [];
  return {
    hole: showHoleSelect !== false,
    property: showPropertySelect !== false,
    chartType: showChartTypeSelect !== false && opts.length > 1,
  };
}
