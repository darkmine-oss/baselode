/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useRef } from 'react';
import Plotly from 'plotly.js-dist-min';

/**
 * Thin React wrapper that mounts / updates / unmounts a Plotly figure
 * from a (data, layout) pair.  Shared between the analytics tool-UI
 * components so each one stays small.
 *
 * @param {{ data: Array<Object>, layout: Object, height?: number, showModeBar?: boolean, style?: Object }} props
 */
export function PlotlyChart({ data, layout, height = 480, showModeBar = false, style }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const effectiveLayout = {
      autosize: true,
      ...layout,
      height,
    };
    Plotly.react(container, data || [], effectiveLayout, {
      responsive: true,
      displayModeBar: showModeBar,
    });
    return () => {
      try {
        Plotly.purge(container);
      } catch (_error) {
        // container may already be unmounted
      }
    };
  }, [data, layout, height, showModeBar]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: `${height}px`, ...(style || {}) }}
    />
  );
}
