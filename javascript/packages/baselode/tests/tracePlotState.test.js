/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  resolveTracePlotBody,
  resolveTracePlotSelectVisibility,
  deriveGroupValue,
  groupValuesFromHoles,
  filterHolesByGroup,
} from '../src/viz/tracePlotState.js';
import {
  DISPLAY_NUMERIC,
  DISPLAY_COMMENT,
  DISPLAY_TADPOLE,
  getChartOptions,
} from '../src/data/columnMeta.js';

// Spec: specs/traceplot-controls-always-visible.md — body state matrix
// and select visibility, covering the 7 scenarios called out in the spec.

describe('resolveTracePlotBody', () => {
  it('shows "No holes loaded" when holeOptions is empty (scenario 6)', () => {
    expect(resolveTracePlotBody({
      holeId: '',
      hole: null,
      holeOptions: [],
      property: '',
      propertyOptions: [],
      displayType: DISPLAY_NUMERIC,
      points: [],
    })).toEqual({ kind: 'placeholder', text: 'No holes loaded' });
  });

  it('shows "Select a hole" when holes exist but none picked (scenario 1)', () => {
    expect(resolveTracePlotBody({
      holeId: '',
      hole: null,
      holeOptions: ['H1', 'H2'],
      property: '',
      propertyOptions: [],
      displayType: DISPLAY_NUMERIC,
      points: [],
    })).toEqual({ kind: 'placeholder', text: 'Select a hole' });
  });

  it('shows "Loading {holeId}…" while resolving a hole asynchronously (scenario 5)', () => {
    expect(resolveTracePlotBody({
      holeId: 'H42',
      hole: null,
      holeOptions: ['H42'],
      property: '',
      propertyOptions: [],
      displayType: DISPLAY_NUMERIC,
      points: [],
    })).toEqual({ kind: 'placeholder', text: 'Loading H42…' });
  });

  it('shows "Select a property" once a hole is picked but property is not', () => {
    expect(resolveTracePlotBody({
      holeId: 'H1',
      hole: { holeId: 'H1' },
      holeOptions: ['H1'],
      property: '',
      propertyOptions: ['Au', 'Cu'],
      displayType: DISPLAY_NUMERIC,
      points: [],
    })).toEqual({ kind: 'placeholder', text: 'Select a property' });
  });

  it('shows "No properties available for hole {id}" when hole has no properties (scenario 4)', () => {
    expect(resolveTracePlotBody({
      holeId: 'H1',
      hole: { holeId: 'H1' },
      holeOptions: ['H1'],
      property: '',
      propertyOptions: [],
      displayType: DISPLAY_NUMERIC,
      points: [],
    })).toEqual({
      kind: 'placeholder',
      text: 'No properties available for hole H1',
    });
  });

  it('shows "No values for {property} in hole {id}" when intervalled data is empty (scenario 3)', () => {
    expect(resolveTracePlotBody({
      holeId: 'H1',
      hole: { holeId: 'H1' },
      holeOptions: ['H1'],
      property: 'Au',
      propertyOptions: ['Au'],
      displayType: DISPLAY_NUMERIC,
      points: [],
    })).toEqual({
      kind: 'placeholder',
      text: 'No values for Au in hole H1',
    });
  });

  it('falls through to chart when comment-type has empty intervals (border boxes still render)', () => {
    expect(resolveTracePlotBody({
      holeId: 'H1',
      hole: { holeId: 'H1' },
      holeOptions: ['H1'],
      property: 'comments',
      propertyOptions: ['comments'],
      displayType: DISPLAY_COMMENT,
      points: [],
    })).toEqual({ kind: 'chart' });
  });

  it('falls through to chart when tadpole display has empty points (buildTadpoleConfig handles it)', () => {
    expect(resolveTracePlotBody({
      holeId: 'H1',
      hole: { holeId: 'H1' },
      holeOptions: ['H1'],
      property: 'alpha',
      propertyOptions: ['alpha'],
      displayType: DISPLAY_TADPOLE,
      points: [],
    })).toEqual({ kind: 'chart' });
  });

  it('renders the chart when hole, property and points are present (scenario 2)', () => {
    expect(resolveTracePlotBody({
      holeId: 'H1',
      hole: { holeId: 'H1' },
      holeOptions: ['H1'],
      property: 'Au',
      propertyOptions: ['Au'],
      displayType: DISPLAY_NUMERIC,
      points: [{ from: 0, to: 1, value: 1.2 }],
    })).toEqual({ kind: 'chart' });
  });

  it('renders a "Plot error: …" placeholder when renderError is set', () => {
    expect(resolveTracePlotBody({
      holeId: 'H1',
      hole: { holeId: 'H1' },
      holeOptions: ['H1'],
      property: 'Au',
      propertyOptions: ['Au'],
      displayType: DISPLAY_NUMERIC,
      points: [{ from: 0, to: 1, value: 1.2 }],
      renderError: 'boom',
    })).toEqual({ kind: 'placeholder', text: 'Plot error: boom' });
  });
});

describe('resolveTracePlotSelectVisibility', () => {
  const numericOptions = getChartOptions(DISPLAY_NUMERIC);
  const commentOptions = getChartOptions(DISPLAY_COMMENT);

  it('shows all three selects by default when chart-type has options', () => {
    expect(resolveTracePlotSelectVisibility({
      chartOptions: numericOptions,
      showHoleSelect: true,
      showPropertySelect: true,
      showChartTypeSelect: true,
    })).toEqual({ hole: true, property: true, chartType: numericOptions.length > 1 });
  });

  it('hides the hole select when showHoleSelect=false (scenario 7)', () => {
    expect(resolveTracePlotSelectVisibility({
      chartOptions: numericOptions,
      showHoleSelect: false,
      showPropertySelect: true,
      showChartTypeSelect: true,
    })).toEqual({ hole: false, property: true, chartType: numericOptions.length > 1 });
  });

  it('hides the chart-type select when fewer than two chart options', () => {
    // Comment display type exposes a single option (or none) for chart type.
    expect(
      resolveTracePlotSelectVisibility({
        chartOptions: commentOptions.length > 1 ? [commentOptions[0]] : commentOptions,
        showHoleSelect: true,
        showPropertySelect: true,
        showChartTypeSelect: true,
      }).chartType
    ).toBe(false);
  });

  it('hides the chart-type select when showChartTypeSelect=false even with multiple options', () => {
    expect(resolveTracePlotSelectVisibility({
      chartOptions: numericOptions,
      showHoleSelect: true,
      showPropertySelect: true,
      showChartTypeSelect: false,
    }).chartType).toBe(false);
  });
});

// Hole selector helpers — drive the group+hole / field selector modes.

describe('deriveGroupValue', () => {
  it('reads a string key off an option object', () => {
    expect(deriveGroupValue({ holeId: 'H1', projectCode: 'P1' }, 'projectCode')).toBe('P1');
  });

  it('calls a function accessor with the raw option', () => {
    const fn = (h) => `${h.projectCode}/${h.holeId}`;
    expect(deriveGroupValue({ holeId: 'H1', projectCode: 'P1' }, fn)).toBe('P1/H1');
  });

  it('returns undefined for string holes when grouped by a string key', () => {
    expect(deriveGroupValue('H1', 'projectCode')).toBeUndefined();
  });

  it('returns undefined when groupBy is missing', () => {
    expect(deriveGroupValue({ projectCode: 'P1' }, undefined)).toBeUndefined();
    expect(deriveGroupValue({ projectCode: 'P1' }, '')).toBeUndefined();
  });
});

describe('groupValuesFromHoles', () => {
  it('returns unique, non-empty group values in first-seen order', () => {
    const holes = [
      { holeId: 'H1', projectCode: 'P1' },
      { holeId: 'H2', projectCode: 'P2' },
      { holeId: 'H3', projectCode: 'P1' }, // duplicate group
      { holeId: 'H4', projectCode: '' },   // empty group — skipped
      { holeId: 'H5', projectCode: null }, // null group — skipped
      { holeId: 'H6', projectCode: 'P3' },
    ];
    expect(groupValuesFromHoles(holes, 'projectCode')).toEqual(['P1', 'P2', 'P3']);
  });

  it('accepts a function accessor', () => {
    const holes = [
      { holeId: 'AAA-1' },
      { holeId: 'BBB-1' },
      { holeId: 'AAA-2' },
    ];
    expect(groupValuesFromHoles(holes, (h) => h.holeId.split('-')[0])).toEqual(['AAA', 'BBB']);
  });

  it('returns an empty array for empty or missing input', () => {
    expect(groupValuesFromHoles([], 'projectCode')).toEqual([]);
    expect(groupValuesFromHoles(undefined, 'projectCode')).toEqual([]);
  });
});

describe('filterHolesByGroup', () => {
  const holes = [
    { holeId: 'H1', projectCode: 'P1' },
    { holeId: 'H2', projectCode: 'P2' },
    { holeId: 'H3', projectCode: 'P1' },
  ];

  it('returns only holes whose group matches', () => {
    expect(filterHolesByGroup(holes, 'projectCode', 'P1')).toEqual([
      { holeId: 'H1', projectCode: 'P1' },
      { holeId: 'H3', projectCode: 'P1' },
    ]);
  });

  it('returns the full list when groupValue is empty', () => {
    expect(filterHolesByGroup(holes, 'projectCode', '')).toEqual(holes);
    expect(filterHolesByGroup(holes, 'projectCode', null)).toEqual(holes);
    expect(filterHolesByGroup(holes, 'projectCode', undefined)).toEqual(holes);
  });

  it('returns an empty array when no holes belong to the group', () => {
    expect(filterHolesByGroup(holes, 'projectCode', 'P-missing')).toEqual([]);
  });
});
