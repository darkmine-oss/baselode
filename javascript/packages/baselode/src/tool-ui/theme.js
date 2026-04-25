/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { BASELODE_LIGHT } from '../viz/baselodeTemplate.js';
import { BASELODE_DARK } from '../viz/baselodeDarkTemplate.js';

function toToolUiThemeVars(palette) {
  return {
    '--baselode-tool-bg': palette.bg,
    '--baselode-tool-panel': palette.panel,
    '--baselode-tool-ink': palette.ink,
    '--baselode-tool-ink-soft': palette.ink_soft,
    '--baselode-tool-grid': palette.grid,
    '--baselode-tool-line': palette.line,
    '--baselode-tool-accent': palette.accent,
    '--baselode-tool-muted-1': palette.muted_1,
    '--baselode-tool-muted-2': palette.muted_2,
    '--baselode-tool-muted-3': palette.muted_3,
    '--baselode-tool-primary': palette.primary || palette.accent,
  };
}

export function getToolUiThemeName(theme) {
  return theme === 'baselode-dark' || theme === 'black' ? 'baselode-dark' : 'baselode';
}

export function getToolUiThemeStyle(theme) {
  return toToolUiThemeVars(
    getToolUiThemeName(theme) === 'baselode-dark' ? BASELODE_DARK : BASELODE_LIGHT
  );
}
