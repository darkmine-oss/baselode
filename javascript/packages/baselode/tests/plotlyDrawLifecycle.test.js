/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, vi } from 'vitest';
import { createPlotlyDrawLifecycle } from '../src/viz/plotlyDrawLifecycle.js';

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('createPlotlyDrawLifecycle', () => {
  it('purges only after every tracked draw has settled', async () => {
    const lifecycle = createPlotlyDrawLifecycle();
    const firstDraw = deferred();
    const secondDraw = deferred();
    const plotly = { purge: vi.fn() };
    const epoch = lifecycle.begin();

    lifecycle.track(firstDraw.promise);
    lifecycle.track(secondDraw.promise);
    const purge = lifecycle.purgeWhenIdle({}, plotly, epoch);

    firstDraw.resolve();
    await Promise.resolve();
    expect(plotly.purge).not.toHaveBeenCalled();

    secondDraw.resolve();
    await purge;
    expect(plotly.purge).toHaveBeenCalledTimes(1);
  });

  it('does not let an older cleanup purge a successor render', async () => {
    const lifecycle = createPlotlyDrawLifecycle();
    const plotly = { purge: vi.fn() };
    const epoch = lifecycle.begin();

    lifecycle.track(Promise.resolve());
    const purge = lifecycle.purgeWhenIdle({}, plotly, epoch);
    lifecycle.begin();

    await purge;
    expect(plotly.purge).not.toHaveBeenCalled();
  });

  it('handles rejected draws before purging', async () => {
    const lifecycle = createPlotlyDrawLifecycle();
    const plotly = { purge: vi.fn() };
    const epoch = lifecycle.begin();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    lifecycle.track(Promise.reject(new Error('draw failed')));
    await lifecycle.purgeWhenIdle({}, plotly, epoch);

    expect(plotly.purge).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
