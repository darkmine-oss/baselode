/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Tool UI stylesheet', () => {
  it('carries every geophysics raster viewer rule for package consumers', () => {
    const toolUi = read('../src/tool-ui/style.css');
    const rules = read('../src/viz/GeophysicsRasterViewer.css')
      .split('\n')
      .filter((line) => line.startsWith('.'));
    expect(rules.length).toBeGreaterThan(5);
    for (const rule of rules) expect(toolUi).toContain(rule);
  });
});
