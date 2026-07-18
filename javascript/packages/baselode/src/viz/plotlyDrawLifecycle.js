/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Track asynchronous Plotly draws and safely purge a plot after its draws end.
 *
 * Plotly's draw methods resolve after their full rendering pipeline finishes.
 * Purging before then removes state that Plotly still reads from its after-plot
 * callbacks. An epoch lets a successor render take ownership of the same div
 * before an older cleanup gets its turn to purge it.
 *
 * @returns {Object} Lifecycle methods for a single Plotly container.
 */
export function createPlotlyDrawLifecycle() {
  let epoch = 0;
  let lastDraw = Promise.resolve();

  return {
    begin() {
      epoch += 1;
      return epoch;
    },

    track(draw) {
      const handledDraw = Promise.resolve(draw).catch((error) => {
        console.warn('Plot draw error', error);
      });
      lastDraw = Promise.all([lastDraw, handledDraw]).then(() => undefined);
      return lastDraw;
    },

    purgeWhenIdle(target, plotly, ownerEpoch) {
      const pendingDraws = lastDraw;
      return pendingDraws.then(() => {
        if (epoch !== ownerEpoch) return;
        try {
          plotly.purge(target);
        } catch (error) {
          console.warn('Plot purge error', error);
        }
      });
    },
  };
}
