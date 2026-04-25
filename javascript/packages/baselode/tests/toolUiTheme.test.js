/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';

import {
  getToolUiThemeName,
  getToolUiThemeStyle,
} from '../src/tool-ui/theme.js';
import { BASELODE_LIGHT } from '../src/viz/baselodeTemplate.js';
import { BASELODE_DARK } from '../src/viz/baselodeDarkTemplate.js';

describe('Tool UI theme bridge', () => {
  it('maps strip-log template names to Baselode theme names', () => {
    expect(getToolUiThemeName('baselode')).toBe('baselode');
    expect(getToolUiThemeName('plotly-default')).toBe('baselode');
    expect(getToolUiThemeName('baselode-dark')).toBe('baselode-dark');
  });

  it('maps 3D scene backgrounds to Baselode theme names', () => {
    expect(getToolUiThemeName('white')).toBe('baselode');
    expect(getToolUiThemeName('black')).toBe('baselode-dark');
  });

  it('derives light CSS variables from BASELODE_LIGHT', () => {
    const style = getToolUiThemeStyle('baselode');

    expect(style['--baselode-tool-bg']).toBe(BASELODE_LIGHT.bg);
    expect(style['--baselode-tool-ink']).toBe(BASELODE_LIGHT.ink);
    expect(style['--baselode-tool-line']).toBe(BASELODE_LIGHT.line);
    expect(style['--baselode-tool-primary']).toBe(BASELODE_LIGHT.primary);
  });

  it('derives dark CSS variables from BASELODE_DARK', () => {
    const style = getToolUiThemeStyle('baselode-dark');

    expect(style['--baselode-tool-bg']).toBe(BASELODE_DARK.bg);
    expect(style['--baselode-tool-ink']).toBe(BASELODE_DARK.ink);
    expect(style['--baselode-tool-line']).toBe(BASELODE_DARK.line);
    expect(style['--baselode-tool-primary']).toBe(BASELODE_DARK.accent);
  });
});
