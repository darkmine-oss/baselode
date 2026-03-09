/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import {
  BASELODE_TEMPLATE,
  BASELODE_TEMPLATE_NAME,
  BASELODE_COLORWAY,
} from '../src/viz/baselodeTemplate.js';

import {
  buildPlotConfig,
  buildIntervalPoints,
  buildCategoricalStripLogConfig,
} from '../src/viz/drillholeViz.js';

import {
  buildTadpoleConfig,
  buildStructuralStripConfig,
  buildCommentsConfig,
} from '../src/viz/structuralViz.js';


describe('baselodeTemplate', () => {
  it('exports BASELODE_TEMPLATE_NAME as "baselode"', () => {
    expect(BASELODE_TEMPLATE_NAME).toBe('baselode');
  });

  it('exports BASELODE_COLORWAY as a non-empty array', () => {
    expect(Array.isArray(BASELODE_COLORWAY)).toBe(true);
    expect(BASELODE_COLORWAY.length).toBeGreaterThan(0);
  });

  it('BASELODE_TEMPLATE has white paper and plot backgrounds', () => {
    expect(BASELODE_TEMPLATE.layout.paper_bgcolor).toBe('#ffffff');
    expect(BASELODE_TEMPLATE.layout.plot_bgcolor).toBe('#ffffff');
  });

  it('BASELODE_TEMPLATE has axis grid and line colors', () => {
    expect(BASELODE_TEMPLATE.layout.xaxis.gridcolor).toBe('#e8e8e8');
    expect(BASELODE_TEMPLATE.layout.yaxis.linecolor).toBe('#d0d0d0');
  });

  it('BASELODE_TEMPLATE includes modebar remove list', () => {
    expect(BASELODE_TEMPLATE.layout.modebar.remove).toContain('select2d');
    expect(BASELODE_TEMPLATE.layout.modebar.remove).toContain('lasso2d');
  });
});


describe('drillholeViz applies baselode template by default', () => {
  const points = [
    { z: 5, val: 1.5, from: 0, to: 10, errorPlus: 5, errorMinus: 5 },
    { z: 15, val: 2.5, from: 10, to: 20, errorPlus: 5, errorMinus: 5 },
  ];

  it('buildPlotConfig numeric layout includes baselode template', () => {
    const { layout } = buildPlotConfig({ points, isCategorical: false, property: 'grade', chartType: 'markers+line' });
    expect(layout.template).toBe(BASELODE_TEMPLATE);
  });

  it('buildPlotConfig categorical layout includes baselode template', () => {
    const catPoints = [
      { z: 5, val: 'A', from: 0, to: 10, errorPlus: 5, errorMinus: 5 },
      { z: 15, val: 'B', from: 10, to: 20, errorPlus: 5, errorMinus: 5 },
    ];
    const { layout } = buildPlotConfig({ points: catPoints, isCategorical: true, property: 'lith', chartType: 'categorical' });
    expect(layout.template).toBe(BASELODE_TEMPLATE);
  });

  it('buildPlotConfig accepts template override', () => {
    const customTemplate = { layout: { paper_bgcolor: 'black' } };
    const { layout } = buildPlotConfig({ points, isCategorical: false, property: 'grade', chartType: 'line', template: customTemplate });
    expect(layout.template).toBe(customTemplate);
  });

  it('buildPlotConfig accepts null template override', () => {
    const { layout } = buildPlotConfig({ points, isCategorical: false, property: 'grade', chartType: 'line', template: null });
    expect(layout.template).toBeNull();
  });

  it('buildCategoricalStripLogConfig layout includes baselode template', () => {
    const rows = [
      { from: 0, to: 10, geology_code: 'FG' },
      { from: 10, to: 20, geology_code: 'SBIF' },
    ];
    const { layout } = buildCategoricalStripLogConfig(rows);
    expect(layout.template).toBe(BASELODE_TEMPLATE);
  });

  it('buildCategoricalStripLogConfig accepts template override', () => {
    const rows = [{ from: 0, to: 10, geology_code: 'FG' }];
    const customTemplate = { layout: {} };
    const { layout } = buildCategoricalStripLogConfig(rows, { template: customTemplate });
    expect(layout.template).toBe(customTemplate);
  });
});


describe('structuralViz applies baselode template by default', () => {
  const structPoints = [
    { depth: 10, dip: 45, azimuth: 90 },
    { depth: 20, dip: 60, azimuth: 180 },
  ];

  it('buildTadpoleConfig layout includes baselode template', () => {
    const { layout } = buildTadpoleConfig(structPoints);
    expect(layout.template).toBe(BASELODE_TEMPLATE);
  });

  it('buildTadpoleConfig accepts template override', () => {
    const customTemplate = { layout: { paper_bgcolor: 'beige' } };
    const { layout } = buildTadpoleConfig(structPoints, { template: customTemplate });
    expect(layout.template).toBe(customTemplate);
  });

  it('buildStructuralStripConfig layout includes baselode template', () => {
    const intervals = [
      { from: 0, to: 10, structure_type: 'Joint' },
      { from: 10, to: 20, structure_type: 'Fault' },
    ];
    const { layout } = buildStructuralStripConfig(intervals);
    expect(layout.template).toBe(BASELODE_TEMPLATE);
  });

  it('buildStructuralStripConfig accepts template override', () => {
    const intervals = [{ from: 0, to: 10, structure_type: 'Joint' }];
    const customTemplate = { layout: {} };
    const { layout } = buildStructuralStripConfig(intervals, { template: customTemplate });
    expect(layout.template).toBe(customTemplate);
  });

  it('buildCommentsConfig layout includes baselode template', () => {
    const intervals = [
      { from: 0, to: 10, comments: 'Some comment here' },
    ];
    const { layout } = buildCommentsConfig(intervals);
    expect(layout.template).toBe(BASELODE_TEMPLATE);
  });

  it('buildCommentsConfig accepts template override', () => {
    const intervals = [{ from: 0, to: 10, comments: 'test' }];
    const customTemplate = { layout: {} };
    const { layout } = buildCommentsConfig(intervals, { template: customTemplate });
    expect(layout.template).toBe(customTemplate);
  });
});
