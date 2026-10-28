/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

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
  const view = { palette, reversePalette, stretch, clipRange, hillshade };
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
        {...(onViewChange ? { value: view, onViewChange } : {})}
        defaultView={view}
        height={height}
        showControls={showControls}
      />
    </section>
  );
}
