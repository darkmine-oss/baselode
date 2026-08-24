/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { GeophysicsRasterViewer } from '../viz/GeophysicsRasterViewer.jsx';

/** Render a serializable geophysics raster result in assistant and app UIs. */
export function BaselodeGeophysicsRasterToolUI({
  title,
  subtitle,
  raster,
  palette,
  clipRange,
  hillshade,
  height = 420,
  showControls = true,
  onViewChange,
}) {
  return (
    <section className="baselode-tool-geophysics-raster">
      {(title || subtitle) && <header className="baselode-tool-geophysics-raster__header">
        {title && <h3>{title}</h3>}
        {subtitle && <p>{subtitle}</p>}
      </header>}
      <GeophysicsRasterViewer
        raster={raster}
        {...(onViewChange ? {
          value: { palette, clipRange, hillshade },
          onViewChange,
        } : {})}
        defaultView={{ palette, clipRange, hillshade }}
        height={height}
        showControls={showControls}
      />
    </section>
  );
}
