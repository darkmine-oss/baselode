/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useRef } from 'react';
import Plotly from 'plotly.js-dist-min';
import {
  createPlotlyDrawLifecycle,
  observePlotlyResize,
} from '../viz/plotlyDrawLifecycle.js';

/**
 * Thin React wrapper that mounts / updates / unmounts a Plotly figure
 * from a (data, layout) pair.  Shared between the analytics tool-UI
 * components so each one stays small.
 *
 * @param {{ data: Array<Object>, layout: Object, height?: number, showModeBar?: boolean, style?: Object }} props
 */
export function PlotlyChart({ data, layout, height = 480, showModeBar = false, style }) {
  const containerRef = useRef(null);
  const plotLifecycleRef = useRef(null);
  if (!plotLifecycleRef.current) {
    plotLifecycleRef.current = createPlotlyDrawLifecycle();
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const effectiveLayout = {
      autosize: true,
      ...layout,
      height,
    };
    const plotEpoch = plotLifecycleRef.current.begin();
    try {
      plotLifecycleRef.current.track(Plotly.react(container, data || [], effectiveLayout, {
        responsive: false,
        displayModeBar: showModeBar,
      }));
    } catch (error) {
      console.warn('Plot render error', error);
    }
    return () => {
      plotLifecycleRef.current.purgeWhenIdle(container, Plotly, plotEpoch);
    };
  }, [data, layout, height, showModeBar]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    return observePlotlyResize(container, Plotly, plotLifecycleRef.current);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: `${height}px`, ...(style || {}) }}
    />
  );
}
