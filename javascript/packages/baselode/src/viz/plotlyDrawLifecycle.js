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

/**
 * Keep a Plotly figure sized to its container without Plotly's untracked
 * responsive window listener.
 *
 * @param {HTMLElement} target - Plotly graph div to observe.
 * @param {Object} plotly - Plotly module with `relayout`.
 * @param {Object} lifecycle - Lifecycle returned by `createPlotlyDrawLifecycle`.
 * @returns {Function} Disconnects the resize observer.
 */
export function observePlotlyResize(target, plotly, lifecycle) {
  if (typeof ResizeObserver === 'undefined') return () => {};

  let previousWidth = 0;
  let previousHeight = 0;
  const observer = new ResizeObserver(() => {
    if (!target.data) return;

    const width = Math.max(0, Math.floor(target.clientWidth));
    const height = Math.max(0, Math.floor(target.clientHeight));
    if (width <= 0 || height <= 0) return;
    if (width === previousWidth && height === previousHeight) return;

    previousWidth = width;
    previousHeight = height;
    try {
      lifecycle.track(plotly.relayout(target, { width, height, autosize: false }));
    } catch (error) {
      console.warn('Plot resize error', error);
    }
  });

  observer.observe(target);
  return () => observer.disconnect();
}
