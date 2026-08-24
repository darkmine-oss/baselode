/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useMemo, useRef } from 'react';
import { useControllable } from '../panels/useControllable.js';
import { createGeophysicsRaster, geophysicsRasterRange } from '../data/geophysicsRaster.js';
import { GEOPHYSICS_PALETTES, renderGeophysicsRaster } from './geophysicsRasterViz.js';
import './GeophysicsRasterViewer.css';

const DEFAULT_VIEW = Object.freeze({
  palette: 'viridis',
  clipRange: null,
  hillshade: { enabled: false, azimuth: 315, altitude: 45, strength: 0.65 },
});

/**
 * Canvas geophysics raster viewer with portable, controllable display state.
 * Pass `value` and `onViewChange` to control palette, clip and hillshade from
 * a parent application, or omit them for the built-in accessible controls.
 */
export function GeophysicsRasterViewer({
  raster,
  value,
  onViewChange,
  defaultView = DEFAULT_VIEW,
  showControls = true,
  height = 420,
  className = '',
}) {
  const normalizedRaster = useMemo(() => createGeophysicsRaster(raster), [raster]);
  const [view, setView] = useControllable({
    value,
    onChange: onViewChange,
    defaultValue: { ...DEFAULT_VIEW, ...defaultView, hillshade: { ...DEFAULT_VIEW.hillshade, ...defaultView.hillshade } },
  });
  const range = useMemo(() => geophysicsRasterRange(normalizedRaster), [normalizedRaster]);
  const rendered = useMemo(() => renderGeophysicsRaster(normalizedRaster, view), [normalizedRaster, view]);
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = rendered.width;
    canvas.height = rendered.height;
    const context = canvas.getContext('2d');
    const image = new ImageData(rendered.data, rendered.width, rendered.height);
    context.putImageData(image, 0, 0);
  }, [rendered]);

  const clipRange = view.clipRange ?? range;
  const setClip = (index, value) => setView((current) => {
    const next = [...(current.clipRange ?? range)];
    next[index] = Number(value);
    if (next[1] <= next[0]) return null;
    return { clipRange: next };
  });
  const setHillshade = (patch) => setView((current) => ({
    hillshade: { ...DEFAULT_VIEW.hillshade, ...current.hillshade, ...patch },
  }));

  return (
    <section className={`baselode-geophysics-raster ${className}`}>
      <canvas
        ref={canvasRef}
        className="baselode-geophysics-raster__canvas"
        style={{ height }}
        aria-label="Geophysics raster"
      />
      {showControls && (
        <fieldset className="baselode-geophysics-raster__controls">
          <legend>Raster display controls</legend>
          <label>
            Colour map
            <select value={view.palette ?? DEFAULT_VIEW.palette} onChange={(event) => setView({ palette: event.target.value })}>
              {GEOPHYSICS_PALETTES.map((palette) => <option key={palette} value={palette}>{palette}</option>)}
            </select>
          </label>
          <label>
            Low clip
            <input type="number" value={clipRange[0]} min={range[0]} max={clipRange[1]} step="any" onChange={(event) => setClip(0, event.target.value)} />
          </label>
          <label>
            High clip
            <input type="number" value={clipRange[1]} min={clipRange[0]} max={range[1]} step="any" onChange={(event) => setClip(1, event.target.value)} />
          </label>
          <label className="baselode-geophysics-raster__checkbox">
            <input type="checkbox" checked={Boolean(view.hillshade?.enabled)} onChange={(event) => setHillshade({ enabled: event.target.checked })} />
            Hillshade
          </label>
          {view.hillshade?.enabled && <>
            <label>
              Sun azimuth ({view.hillshade.azimuth}°)
              <input type="range" min="0" max="360" value={view.hillshade.azimuth} onChange={(event) => setHillshade({ azimuth: Number(event.target.value) })} />
            </label>
            <label>
              Sun altitude ({view.hillshade.altitude}°)
              <input type="range" min="1" max="90" value={view.hillshade.altitude} onChange={(event) => setHillshade({ altitude: Number(event.target.value) })} />
            </label>
            <label>
              Hillshade strength ({Math.round(view.hillshade.strength * 100)}%)
              <input type="range" min="0" max="1" step="0.05" value={view.hillshade.strength} onChange={(event) => setHillshade({ strength: Number(event.target.value) })} />
            </label>
          </>}
        </fieldset>
      )}
    </section>
  );
}
