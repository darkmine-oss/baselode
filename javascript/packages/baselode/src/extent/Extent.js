/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import proj4 from 'proj4';

export const DEFAULT_EXTENT_CRS = 'EPSG:4326';

const EPSG_PATTERN = /^epsg\s*:\s*(\d+)$/i;
const BARE_EPSG_PATTERN = /^\d+$/;

function registerAustralianCrsDefinitions() {
  if (!proj4.defs('EPSG:4283')) {
    proj4.defs(
      'EPSG:4283',
      '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs +type=crs',
    );
  }
  for (let zone = 49; zone <= 58; zone += 1) {
    const code = `EPSG:${28300 + zone}`;
    if (!proj4.defs(code)) {
      proj4.defs(
        code,
        `+proj=utm +zone=${zone} +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs`,
      );
    }
  }
}

registerAustralianCrsDefinitions();

function describe(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function normaliseCrs(crs) {
  if (crs === null || crs === undefined) {
    throw new TypeError(
      "Extent requires a CRS. Pass crs: 'EPSG:4326' (default), an EPSG number, or a proj/WKT definition.",
    );
  }

  let normalized;
  if (typeof crs === 'number') {
    if (!Number.isSafeInteger(crs) || crs <= 0) {
      throw new TypeError(`Invalid CRS ${describe(crs)}: EPSG numbers must be positive integers.`);
    }
    normalized = `EPSG:${crs}`;
  } else if (typeof crs === 'string') {
    const trimmed = crs.trim();
    if (!trimmed) {
      throw new TypeError('Invalid CRS "": CRS definitions must not be empty.');
    }
    const epsgMatch = trimmed.match(EPSG_PATTERN);
    if (epsgMatch) {
      normalized = `EPSG:${Number(epsgMatch[1])}`;
    } else if (BARE_EPSG_PATTERN.test(trimmed)) {
      normalized = `EPSG:${Number(trimmed)}`;
    } else {
      normalized = trimmed;
    }
  } else {
    throw new TypeError(
      `Invalid CRS ${describe(crs)}: pass an EPSG string/number or a proj/WKT definition.`,
    );
  }

  try {
    proj4(normalized);
  } catch (error) {
    const detail = error?.message ? `: ${error.message}` : '';
    throw new TypeError(
      `Invalid CRS ${describe(crs)}${detail}. The definition is not registered or supported by proj4.`,
      { cause: error },
    );
  }
  return normalized;
}

function finiteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Extent ${name} must be a finite number; received ${describe(value)}.`);
  }
  return value;
}

function boundsFromBbox(bbox) {
  if (Array.isArray(bbox)) {
    if (bbox.length !== 4) {
      throw new TypeError('Extent bbox arrays must contain [west, south, east, north].');
    }
    return {
      xmin: bbox[0],
      ymin: bbox[1],
      xmax: bbox[2],
      ymax: bbox[3],
    };
  }
  if (bbox && typeof bbox === 'object') {
    return {
      xmin: bbox.west,
      ymin: bbox.south,
      xmax: bbox.east,
      ymax: bbox.north,
    };
  }
  throw new TypeError(
    'Extent bbox must be [west, south, east, north] or { west, south, east, north }.',
  );
}

function validateBounds(bounds) {
  const normalized = {
    xmin: finiteNumber(bounds.xmin, 'xmin'),
    ymin: finiteNumber(bounds.ymin, 'ymin'),
    xmax: finiteNumber(bounds.xmax, 'xmax'),
    ymax: finiteNumber(bounds.ymax, 'ymax'),
  };
  if (normalized.xmin > normalized.xmax) {
    throw new RangeError('Extent xmin must be less than or equal to xmax.');
  }
  if (normalized.ymin > normalized.ymax) {
    throw new RangeError('Extent ymin must be less than or equal to ymax.');
  }
  return normalized;
}

function transformedBounds(sourceCrs, targetCrs, points) {
  try {
    const transformed = points.map((point) => proj4(sourceCrs, targetCrs, point));
    const xs = transformed.map(([x]) => finiteNumber(x, 'transformed x'));
    const ys = transformed.map(([, y]) => finiteNumber(y, 'transformed y'));
    return {
      xmin: Math.min(...xs),
      ymin: Math.min(...ys),
      xmax: Math.max(...xs),
      ymax: Math.max(...ys),
    };
  } catch (error) {
    throw new Error(
      `Failed to reproject extent from CRS ${describe(sourceCrs)} to ${describe(targetCrs)}: ${error?.message || error}`,
      { cause: error },
    );
  }
}

/**
 * Axis-aligned bounding box with an explicit coordinate reference system.
 */
export class Extent {
  constructor(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Extent constructor expects an options object.');
    }
    const hasBbox = options.bbox !== undefined;
    const hasBounds = ['xmin', 'ymin', 'xmax', 'ymax']
      .some((property) => options[property] !== undefined);
    if (hasBbox && hasBounds) {
      throw new TypeError('Extent accepts either bbox or xmin/ymin/xmax/ymax, not both.');
    }
    const bounds = validateBounds(hasBbox ? boundsFromBbox(options.bbox) : options);
    const name = options.name ?? null;
    if (name !== null && typeof name !== 'string') {
      throw new TypeError('Extent name must be a string or null.');
    }
    const crs = normaliseCrs(options.crs ?? DEFAULT_EXTENT_CRS);

    Object.defineProperties(this, {
      xmin: { value: bounds.xmin, enumerable: true },
      ymin: { value: bounds.ymin, enumerable: true },
      xmax: { value: bounds.xmax, enumerable: true },
      ymax: { value: bounds.ymax, enumerable: true },
      name: { value: name, enumerable: true },
      crs: { value: crs, enumerable: true, writable: true },
    });
  }

  static fromBbox(bbox, crs = DEFAULT_EXTENT_CRS, name = null) {
    return new Extent({ bbox, crs, name });
  }

  static fromFeature(feature, crs = DEFAULT_EXTENT_CRS, name = null) {
    if (!feature || feature.type !== 'Feature' || feature.geometry?.type !== 'Polygon') {
      throw new TypeError('Extent.fromFeature expects a GeoJSON Polygon Feature.');
    }
    const positions = feature.geometry.coordinates.flat();
    if (!positions.length) {
      throw new TypeError('Extent.fromFeature cannot derive bounds from an empty Polygon.');
    }
    const xs = positions.map((position) => finiteNumber(position?.[0], 'polygon x'));
    const ys = positions.map((position) => finiteNumber(position?.[1], 'polygon y'));
    return new Extent({
      xmin: Math.min(...xs),
      ymin: Math.min(...ys),
      xmax: Math.max(...xs),
      ymax: Math.max(...ys),
      crs,
      name,
    });
  }

  setCrs(crs) {
    this.crs = normaliseCrs(crs);
    return this;
  }

  toCrs(targetCrs) {
    const target = normaliseCrs(targetCrs);
    if (target === this.crs) {
      return new Extent({
        xmin: this.xmin,
        ymin: this.ymin,
        xmax: this.xmax,
        ymax: this.ymax,
        name: this.name,
        crs: target,
      });
    }
    const bounds = transformedBounds(this.crs, target, [
      [this.xmin, this.ymin],
      [this.xmax, this.ymin],
      [this.xmax, this.ymax],
      [this.xmin, this.ymax],
    ]);
    return new Extent({ ...bounds, name: this.name, crs: target });
  }

  center({ lonlat = false } = {}) {
    const point = [
      (this.xmin + this.xmax) / 2,
      (this.ymin + this.ymax) / 2,
    ];
    if (!lonlat || this.crs === DEFAULT_EXTENT_CRS) return point;
    try {
      return proj4(this.crs, DEFAULT_EXTENT_CRS, point);
    } catch (error) {
      throw new Error(
        `Failed to reproject extent center from CRS ${describe(this.crs)} to ${describe(DEFAULT_EXTENT_CRS)}: ${error?.message || error}`,
        { cause: error },
      );
    }
  }

  getFoliumRectangle() {
    return [[this.ymin, this.xmin], [this.ymax, this.xmax]];
  }

  toPolygon() {
    return {
      type: 'Polygon',
      coordinates: [[
        [this.xmin, this.ymin],
        [this.xmax, this.ymin],
        [this.xmax, this.ymax],
        [this.xmin, this.ymax],
        [this.xmin, this.ymin],
      ]],
    };
  }

  toFeature(properties = {}) {
    if (properties !== null && (typeof properties !== 'object' || Array.isArray(properties))) {
      throw new TypeError('Extent feature properties must be an object or null.');
    }
    return {
      type: 'Feature',
      properties,
      geometry: this.toPolygon(),
    };
  }

  toFeatureCollection(properties = {}) {
    return {
      type: 'FeatureCollection',
      features: [this.toFeature(properties)],
    };
  }
}
