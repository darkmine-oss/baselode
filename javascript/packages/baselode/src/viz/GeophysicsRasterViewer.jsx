/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useControllable } from '../panels/useControllable.js';
import { createGeophysicsRaster, getGeophysicsRasterBand } from '../data/geophysicsRaster.js';
import {
  DEFAULT_GEOPHYSICS_STRETCH,
  GEOPHYSICS_PALETTES,
  geophysicsColorGradient,
} from './geophysicsColorScales.js';
import { DEFAULT_GEOPHYSICS_HILLSHADE, renderGeophysicsRaster } from './geophysicsRasterViz.js';
import './GeophysicsRasterViewer.css';

const DEFAULT_VIEW = Object.freeze({
  palette: 'viridis',
  reversePalette: false,
  stretch: DEFAULT_GEOPHYSICS_STRETCH,
  hillshade: DEFAULT_GEOPHYSICS_HILLSHADE,
});

const COLORBAR_TICKS = [0, 0.25, 0.5, 0.75, 1];

/** Merge a partial view (including the legacy `clipRange`) over the defaults. */
export function resolveGeophysicsView(view = {}) {
  const stretch = view.stretch
    ?? (view.clipRange ? { mode: 'absolute', min: view.clipRange[0], max: view.clipRange[1] } : DEFAULT_VIEW.stretch);
  return {
    palette: view.palette ?? DEFAULT_VIEW.palette,
    reversePalette: Boolean(view.reversePalette),
    stretch,
    hillshade: { ...DEFAULT_VIEW.hillshade, ...(view.hillshade ?? {}) },
  };
}

function formatValue(value) {
  if (!Number.isFinite(value)) return '–';
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude >= 1e6 || magnitude < 1e-3)) return value.toExponential(2);
  return Number(value.toPrecision(4)).toLocaleString();
}

function stretchLabel(stretch) {
  if (stretch.mode === 'equalize') return 'Histogram equalised';
  if (stretch.mode === 'absolute') return 'Absolute range';
  return `${stretch.low}–${stretch.high} percentile`;
}

function describeRaster(raster, band) {
  const parts = [raster.bandNames[band - 1], `${raster.width} × ${raster.height} cells`];
  const [a, , , , e] = raster.transform;
  if (raster.crs) parts.push(String(raster.crs));
  if (raster.crs || Math.abs(a) !== 1) parts.push(`cell ${formatValue(Math.abs(a))} × ${formatValue(Math.abs(e))}`);
  return parts.filter(Boolean).join(' · ');
}

/**
 * Canvas geophysics raster viewer.
 *
 * Display state is `{ palette, reversePalette, stretch, hillshade }`; pass
 * `value` and `onViewChange` to control it from a parent, or `defaultView`
 * to seed the built-in controls. A colour bar, raster summary and cursor
 * read-out are shown by default; `showControls={false}` gives a static view.
 */
export function GeophysicsRasterViewer({
  raster,
  band = 1,
  units,
  value,
  onViewChange,
  defaultView,
  showControls = true,
  showColorbar = true,
  showSummary = true,
  showCursorValue = true,
  height = 420,
  className = '',
}) {
  const normalizedRaster = useMemo(() => createGeophysicsRaster(raster), [raster]);
  const values = useMemo(() => getGeophysicsRasterBand(normalizedRaster, band), [normalizedRaster, band]);
  const [storedView, setView] = useControllable({
    value,
    onChange: onViewChange,
    defaultValue: resolveGeophysicsView(defaultView),
  });
  const view = resolveGeophysicsView(storedView);
  const rendered = useMemo(
    () => renderGeophysicsRaster(normalizedRaster, { ...view, band }),
    // The view is rebuilt every render; its serialised form is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [normalizedRaster, band, JSON.stringify(view)],
  );
  const canvasRef = useRef(null);
  const [cursor, setCursor] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = rendered.width;
    canvas.height = rendered.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.putImageData(new ImageData(rendered.data, rendered.width, rendered.height), 0, 0);
  }, [rendered]);

  const handlePointerMove = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The canvas uses object-fit: contain, so find the drawn image inside it.
    const box = canvas.getBoundingClientRect();
    const scale = Math.min(box.width / rendered.width, box.height / rendered.height);
    const left = box.left + (box.width - rendered.width * scale) / 2;
    const top = box.top + (box.height - rendered.height * scale) / 2;
    const column = Math.floor((event.clientX - left) / scale);
    const row = Math.floor((event.clientY - top) / scale);
    if (row < 0 || column < 0 || row >= rendered.height || column >= rendered.width) {
      setCursor(null);
      return;
    }
    const [a, b, c, d, e, f] = normalizedRaster.transform;
    const x = a * (column + 0.5) + b * (row + 0.5) + c;
    const y = d * (column + 0.5) + e * (row + 0.5) + f;
    setCursor({ x, y, value: values[row][column] });
  };

  const setStretch = (patch) => setView((current) => ({
    stretch: { ...resolveGeophysicsView(current).stretch, ...patch },
  }));
  const setStretchMode = (mode) => {
    if (mode === 'absolute') setView({ stretch: { mode, min: rendered.range[0], max: rendered.range[1] } });
    else if (mode === 'relative') setView({ stretch: DEFAULT_GEOPHYSICS_STRETCH });
    else setView({ stretch: { mode } });
  };
  const setStretchLimit = (key, raw) => {
    const number = Number(raw);
    if (!Number.isFinite(number)) return;
    const next = { ...view.stretch, [key]: number };
    const [low, high] = next.mode === 'relative' ? [next.low, next.high] : [next.min, next.max];
    if (!(low < high) || (next.mode === 'relative' && (low < 0 || high > 100))) return;
    setStretch({ [key]: number });
  };
  const setHillshade = (patch) => setView((current) => ({
    hillshade: { ...resolveGeophysicsView(current).hillshade, ...patch },
  }));

  const { stretch, hillshade } = view;
  const unitsLabel = units ? ` ${units}` : '';

  return (
    <section className={`baselode-geophysics-raster ${className}`}>
      <canvas
        ref={canvasRef}
        className="baselode-geophysics-raster__canvas"
        style={{ height }}
        role="img"
        aria-label={`Geophysics raster: ${normalizedRaster.bandNames[band - 1]}`}
        onPointerMove={showCursorValue ? handlePointerMove : undefined}
        onPointerLeave={showCursorValue ? () => setCursor(null) : undefined}
      />
      {(showColorbar || showSummary) && (
        <div className="baselode-geophysics-raster__legend">
          {showColorbar && (
            <figure className="baselode-geophysics-raster__colorbar" aria-label="Colour scale">
              <div
                className="baselode-geophysics-raster__gradient"
                style={{ background: geophysicsColorGradient(view.palette, view.reversePalette) }}
              />
              <div className="baselode-geophysics-raster__ticks">
                {COLORBAR_TICKS.map((ratio) => (
                  <span key={ratio}>{formatValue(rendered.scale.valueAt(ratio))}</span>
                ))}
              </div>
              <figcaption>{stretchLabel(stretch)}{unitsLabel && ` ·${unitsLabel}`}</figcaption>
            </figure>
          )}
          {showSummary && (
            <p className="baselode-geophysics-raster__summary">
              {cursor
                ? `${formatValue(cursor.x)}, ${formatValue(cursor.y)} → ${formatValue(cursor.value)}${unitsLabel}`
                : describeRaster(normalizedRaster, band)}
            </p>
          )}
        </div>
      )}
      {showControls && (
        <fieldset className="baselode-geophysics-raster__controls">
          <legend>Raster display controls</legend>
          <label>
            Colour scale
            <select value={view.palette} onChange={(event) => setView({ palette: event.target.value })}>
              {GEOPHYSICS_PALETTES.map((palette) => <option key={palette} value={palette}>{palette}</option>)}
            </select>
          </label>
          <label className="baselode-geophysics-raster__checkbox">
            <input type="checkbox" checked={view.reversePalette} onChange={(event) => setView({ reversePalette: event.target.checked })} />
            Reverse
          </label>
          <label>
            Stretch
            <select value={stretch.mode} onChange={(event) => setStretchMode(event.target.value)}>
              <option value="relative">Relative (percentile)</option>
              <option value="absolute">Absolute (data units)</option>
              <option value="equalize">Histogram equalised</option>
            </select>
          </label>
          {stretch.mode === 'relative' && <>
            <label>
              Low percentile
              <input type="number" min="0" max="100" step="any" value={stretch.low} onChange={(event) => setStretchLimit('low', event.target.value)} />
            </label>
            <label>
              High percentile
              <input type="number" min="0" max="100" step="any" value={stretch.high} onChange={(event) => setStretchLimit('high', event.target.value)} />
            </label>
          </>}
          {stretch.mode === 'absolute' && <>
            <label>
              Minimum{unitsLabel}
              <input type="number" step="any" value={stretch.min} onChange={(event) => setStretchLimit('min', event.target.value)} />
            </label>
            <label>
              Maximum{unitsLabel}
              <input type="number" step="any" value={stretch.max} onChange={(event) => setStretchLimit('max', event.target.value)} />
            </label>
          </>}
          <label className="baselode-geophysics-raster__checkbox">
            <input type="checkbox" checked={Boolean(hillshade.enabled)} onChange={(event) => setHillshade({ enabled: event.target.checked })} />
            Hillshade
          </label>
          {hillshade.enabled && <>
            <label>
              Sun azimuth ({hillshade.azimuth}°)
              <input type="range" min="0" max="360" value={hillshade.azimuth} onChange={(event) => setHillshade({ azimuth: Number(event.target.value) })} />
            </label>
            <label>
              Sun altitude ({hillshade.altitude}°)
              <input type="range" min="1" max="90" value={hillshade.altitude} onChange={(event) => setHillshade({ altitude: Number(event.target.value) })} />
            </label>
            <label>
              Shade strength ({Math.round(hillshade.strength * 100)}%)
              <input type="range" min="0" max="1" step="0.05" value={hillshade.strength} onChange={(event) => setHillshade({ strength: Number(event.target.value) })} />
            </label>
            <label className="baselode-geophysics-raster__checkbox">
              <input
                type="checkbox"
                checked={hillshade.zFactor === 'auto'}
                onChange={(event) => setHillshade({ zFactor: event.target.checked ? 'auto' : rendered.zFactor })}
              />
              Auto relief
            </label>
            {hillshade.zFactor !== 'auto' && (
              <label>
                Vertical exaggeration
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={hillshade.zFactor}
                  onChange={(event) => {
                    const zFactor = Number(event.target.value);
                    if (zFactor > 0) setHillshade({ zFactor });
                  }}
                />
              </label>
            )}
          </>}
        </fieldset>
      )}
    </section>
  );
}
