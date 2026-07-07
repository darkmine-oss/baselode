/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import { buildPlotConfig } from '../src/viz/drillholeViz.js';

const numericPoints = [
  { z: 10.5, val: 30, from: 10, to: 11, errorPlus: 0.5, errorMinus: 0.5 },
  { z: 20.5, val: 41, from: 20, to: 21, errorPlus: 0.5, errorMinus: 0.5 },
];

const categoricalPoints = [
  { z: 5, val: 'SAP', from: 0, to: 10, errorPlus: 5, errorMinus: 5 },
  { z: 15, val: 'BAS', from: 10, to: 20, errorPlus: 5, errorMinus: 5 },
];

describe('buildPlotConfig with property metadata', () => {
  it('leaves numeric output unchanged when no meta is supplied', () => {
    const { data, layout } = buildPlotConfig({
      points: numericPoints, isCategorical: false, property: 'Au', chartType: 'markers+line',
    });
    expect(layout.xaxis.title.text).toBe('Au');
    expect(data[0].hovertemplate).toBe(
      'Au: %{x}<br>from: %{customdata[0]:.3f} to: %{customdata[1]:.3f}<extra></extra>'
    );
  });

  it('appends the unit to the numeric axis title and hover tooltip', () => {
    const { data, layout } = buildPlotConfig({
      points: numericPoints, isCategorical: false, property: 'Au', chartType: 'markers+line',
      meta: { unit: 'ppm' },
    });
    expect(layout.xaxis.title.text).toBe('Au (ppm)');
    expect(data[0].hovertemplate).toBe(
      'Au: %{x} ppm<br>from: %{customdata[0]:.3f} to: %{customdata[1]:.3f}<extra></extra>'
    );
  });

  it('adds a Source line and source attribute when supplied', () => {
    const { data, layout } = buildPlotConfig({
      points: numericPoints, isCategorical: false, property: 'Au', chartType: 'bar',
      meta: { unit: 'ppm', sourceAttribute: 'Au_ppb' },
    });
    expect(layout.xaxis.title.text).toBe('Au (ppm, source: Au_ppb)');
    // Bars floor below-detection negatives, so hover reads the raw value
    // from customdata[2] rather than the plotted x.
    expect(data[0].hovertemplate).toBe(
      'Au: %{customdata[2]} ppm<br>Source: Au_ppb<br>from: %{customdata[0]:.3f} to: %{customdata[1]:.3f}<extra></extra>'
    );
  });

  it('omits a source attribute that matches the property key', () => {
    const { data, layout } = buildPlotConfig({
      points: numericPoints, isCategorical: false, property: 'Au', chartType: 'line',
      meta: { unit: 'ppm', sourceAttribute: 'AU' },
    });
    expect(layout.xaxis.title.text).toBe('Au (ppm)');
    expect(data[0].hovertemplate).not.toContain('Source:');
  });

  it('applies the formatted label to the categorical hover tooltip only', () => {
    const { data, layout } = buildPlotConfig({
      points: categoricalPoints, isCategorical: true, property: 'Au', chartType: 'categorical',
      meta: { unit: 'ppm', sourceAttribute: 'Au_ppb' },
    });
    // No in-plot title: the property is shown by the track's picker, and a
    // title header pushes the bands out of depth alignment (Python parity).
    expect(layout.title).toBeUndefined();
    expect(data[0].hovertemplate).toBe(
      'Au: SAP<br>Source: Au_ppb<br>from: %{customdata[0]:.3f} to: %{customdata[1]:.3f}<extra></extra>'
    );
  });
});
