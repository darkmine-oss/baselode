/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Create the portable in-memory raster shape shared by the Python and
 * JavaScript Baselode packages. Data is always bands-first: [band][row][col].
 *
 * The transform uses GDAL's six-value affine form:
 * x = a * column + b * row + c; y = d * column + e * row + f.
 *
 * @param {object} payload
 * @returns {object}
 */
export function createGeophysicsRaster(payload = {}) {
  const data = normalizeRasterData(payload.data);
  const height = data[0].length;
  const width = data[0][0].length;
  const transform = normalizeTransform(payload.transform, height);
  const bandNames = payload.bandNames ?? data.map((_, index) => `band_${index + 1}`);

  if (!Array.isArray(bandNames) || bandNames.length !== data.length) {
    throw new TypeError('bandNames must contain one name for every raster band.');
  }

  return {
    data,
    width,
    height,
    bandCount: data.length,
    transform,
    crs: payload.crs ?? null,
    nodata: Number.isFinite(Number(payload.nodata)) ? Number(payload.nodata) : null,
    bandNames: bandNames.map(String),
    metadata: { ...(payload.metadata ?? {}) },
    bounds: rasterBounds(transform, width, height),
  };
}

/**
 * Return one band using GDAL's one-based numbering.
 *
 * @param {object} raster
 * @param {number} [index=1]
 * @returns {number[][]}
 */
export function getGeophysicsRasterBand(raster, index = 1) {
  const normalized = raster?.bandCount ? raster : createGeophysicsRaster(raster);
  if (!Number.isInteger(index) || index < 1 || index > normalized.bandCount) {
    throw new RangeError(`Raster band index must be between 1 and ${normalized.bandCount}.`);
  }
  return normalized.data[index - 1];
}

/**
 * Return numeric min/max values, ignoring null, non-finite, and nodata cells.
 *
 * @param {object} raster
 * @param {number} [band=1]
 * @returns {[number, number]}
 */
export function geophysicsRasterRange(raster, band = 1) {
  const normalized = raster?.bandCount ? raster : createGeophysicsRaster(raster);
  const values = getGeophysicsRasterBand(normalized, band);
  let min = Infinity;
  let max = -Infinity;
  for (const row of values) {
    for (const value of row) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric === normalized.nodata) continue;
      min = Math.min(min, numeric);
      max = Math.max(max, numeric);
    }
  }
  if (!Number.isFinite(min)) throw new RangeError('Raster band contains no finite values.');
  return [min, max];
}

/**
 * Load a GeoTIFF or Cloud-Optimized GeoTIFF in browser or Node applications.
 * ERS and other GDAL formats should be opened with Python's `load_raster` and
 * transferred using `GeophysicsRaster.to_payload()`.
 *
 * @param {string|ArrayBuffer|Blob} source
 * @param {object} [options]
 * @param {number[]} [options.samples] - Zero-based TIFF sample indexes.
 * @returns {Promise<object>}
 */
export async function loadGeoTiff(source, options = {}) {
  const { fromArrayBuffer, fromUrl } = await import('geotiff');
  let tiff;
  if (typeof source === 'string' || source instanceof URL) {
    tiff = await fromUrl(source);
  } else {
    const buffer = typeof Blob !== 'undefined' && source instanceof Blob
      ? await source.arrayBuffer()
      : source;
    if (!(buffer instanceof ArrayBuffer)) {
      throw new TypeError('GeoTIFF source must be a URL, ArrayBuffer, or Blob.');
    }
    tiff = await fromArrayBuffer(buffer);
  }

  const image = await tiff.getImage();
  const values = await image.readRasters({ samples: options.samples, interleave: false });
  const data = Array.from(values, (band) => typedBandToRows(band, image.getWidth()));
  const origin = image.getOrigin();
  const resolution = image.getResolution();
  const transform = origin && resolution
    ? [resolution[0], 0, origin[0], 0, -Math.abs(resolution[1]), origin[1]]
    : undefined;
  const fileDirectory = image.getFileDirectory();
  const names = Array.from(values, (_, index) => `band_${index + 1}`);

  return createGeophysicsRaster({
    data,
    transform,
    crs: image.getGeoKeys()?.ProjectedCSTypeGeoKey ?? image.getGeoKeys()?.GeographicTypeGeoKey ?? null,
    nodata: parseNoData(fileDirectory.GDAL_NODATA),
    bandNames: names,
    metadata: { driver: 'GeoTIFF', width: image.getWidth(), height: image.getHeight() },
  });
}

function normalizeRasterData(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('Raster data must be a non-empty two- or three-dimensional array.');
  }
  const bands = isRow(value[0]) ? [value] : value;
  if (!bands.every(isGrid)) {
    throw new TypeError('Raster data must contain rectangular numeric row arrays.');
  }
  const height = bands[0].length;
  const width = bands[0][0].length;
  if (!bands.every((band) => band.length === height && band.every((row) => row.length === width))) {
    throw new TypeError('Every raster band must have the same rectangular shape.');
  }
  return bands.map((band) => band.map((row) => row.map((value) => {
    if (value === null || value === undefined) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  })));
}

function isRow(value) {
  return Array.isArray(value) && value.length > 0 && !Array.isArray(value[0]);
}

function isGrid(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isRow);
}

function normalizeTransform(value, height) {
  if (value == null) return [1, 0, 0, 0, -1, height];
  if (!Array.isArray(value) || value.length !== 6 || !value.every((item) => Number.isFinite(Number(item)))) {
    throw new TypeError('transform must be six finite affine values.');
  }
  return value.map(Number);
}

function rasterBounds(transform, width, height) {
  const [a, b, c, d, e, f] = transform;
  const corners = [
    [c, f],
    [a * width + c, d * width + f],
    [b * height + c, e * height + f],
    [a * width + b * height + c, d * width + e * height + f],
  ];
  return {
    minX: Math.min(...corners.map(([x]) => x)),
    minY: Math.min(...corners.map(([, y]) => y)),
    maxX: Math.max(...corners.map(([x]) => x)),
    maxY: Math.max(...corners.map(([, y]) => y)),
  };
}

function typedBandToRows(values, width) {
  const rows = [];
  for (let row = 0; row < values.length / width; row += 1) {
    rows.push(Array.from(values.slice(row * width, (row + 1) * width)));
  }
  return rows;
}

function parseNoData(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
