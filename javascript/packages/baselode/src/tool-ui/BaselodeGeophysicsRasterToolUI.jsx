/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useState } from 'react';
import { GeophysicsRasterViewer } from '../viz/GeophysicsRasterViewer.jsx';

/**
 * Render a serializable geophysics raster result in assistant and app UIs.
 *
 * Chat-first defaults: a static image with colour bar, raster summary and
 * cursor read-out. Set `showControls` to expose palette, stretch and
 * hillshade controls.
 */
export function BaselodeGeophysicsRasterToolUI({
  title,
  subtitle,
  raster,
  band = 1,
  units,
  palette,
  reversePalette,
  stretch,
  clipRange,
  hillshade,
  height = 360,
  showControls = false,
  onViewChange,
}) {
  const propsView = { palette, reversePalette, stretch, clipRange, hillshade };
  const propsKey = JSON.stringify(propsView);
  // The Tool UI owns the display state so controls work even when
  // `onViewChange` only reports events (as the assistant adapter does).
  // A new tool result with different display props resets it.
  const [view, setView] = useState(propsView);
  const [seenKey, setSeenKey] = useState(propsKey);
  if (seenKey !== propsKey) {
    setSeenKey(propsKey);
    setView(propsView);
  }
  const handleViewChange = (next) => {
    setView(next);
    onViewChange?.(next);
  };
  return (
    <section className="baselode-tool-geophysics-raster">
      {(title || subtitle) && <header className="baselode-tool-geophysics-raster__header">
        {title && <h3>{title}</h3>}
        {subtitle && <p>{subtitle}</p>}
      </header>}
      <GeophysicsRasterViewer
        raster={raster}
        band={band}
        units={units}
        value={view}
        onViewChange={handleViewChange}
        height={height}
        showControls={showControls}
      />
    </section>
  );
}
