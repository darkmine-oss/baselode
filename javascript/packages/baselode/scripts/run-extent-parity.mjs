/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFileSync } from 'node:fs';
import { Extent } from '../src/extent/Extent.js';

const input = JSON.parse(readFileSync(0, 'utf8'));
const results = input.map(({ bounds, crs, targetCrs, name, properties = {} }) => {
  const extent = new Extent({ ...bounds, crs, name });
  const projected = extent.toCrs(targetCrs);
  return {
    bounds: {
      xmin: projected.xmin,
      ymin: projected.ymin,
      xmax: projected.xmax,
      ymax: projected.ymax,
    },
    crs: projected.crs,
    name: projected.name,
    center: projected.center(),
    foliumRectangle: projected.getFoliumRectangle(),
    polygon: projected.toPolygon(),
    feature: projected.toFeature(properties),
    featureCollection: projected.toFeatureCollection(properties),
  };
});

process.stdout.write(JSON.stringify(results));
