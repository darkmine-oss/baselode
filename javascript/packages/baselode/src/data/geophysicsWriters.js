/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Encode geophysics rasters as ER Mapper (.ers + data file) and GeoTIFF bytes,
// for saving from a browser or Node.  Mirrors Python's
// baselode.geophysics.writers: the ERS layout matches byte for byte (checked
// against the `editing.ersWriter` fixture case), and both formats read back
// with readErs / loadGeoTiff, Python's load_raster and GDAL.
//
// geotiff.js's own writer stores 8-bit samples only, so GeoTIFF is encoded
// here: little-endian, uncompressed, one strip per band.

import proj4 from 'proj4';
import { createGeophysicsRaster } from './geophysicsRaster.js';

/** Null value for float grids that have none (as Python). */
export const DEFAULT_ERS_NULL = -99999;

const CELL_TYPES = {
  uint8: { ers: 'Unsigned8BitInteger', bytes: 1, format: 1, array: Uint8Array, min: 0, max: 255 },
  int8: { ers: 'Signed8BitInteger', bytes: 1, format: 2, array: Int8Array, min: -128, max: 127 },
  uint16: { ers: 'Unsigned16BitInteger', bytes: 2, format: 1, array: Uint16Array, min: 0, max: 65535 },
  int16: { ers: 'Signed16BitInteger', bytes: 2, format: 2, array: Int16Array, min: -32768, max: 32767 },
  uint32: { ers: 'Unsigned32BitInteger', bytes: 4, format: 1, array: Uint32Array, min: 0, max: 4294967295 },
  int32: { ers: 'Signed32BitInteger', bytes: 4, format: 2, array: Int32Array, min: -2147483648, max: 2147483647 },
  float32: { ers: 'IEEE4ByteReal', bytes: 4, format: 3, array: Float32Array, float: true },
  float64: { ers: 'IEEE8ByteReal', bytes: 8, format: 3, array: Float64Array, float: true },
};

const GEODETIC = { 4283: 'GDA94', 7844: 'GDA2020', 4202: 'AGD66', 4203: 'AGD84', 4326: 'WGS84' };
// [first EPSG code, last EPSG code, code of zone 0, datum, projection prefix]:
// the zones EPSG defines for each system (as Python).
const ZONED = [
  [28348, 28358, 28300, 'GDA94', 'MGA'],
  [7846, 7859, 7800, 'GDA2020', 'MGA'],
  [20248, 20258, 20200, 'AGD66', 'AMG'],
  [20348, 20358, 20300, 'AGD84', 'AMG'],
  [32601, 32660, 32600, 'WGS84', 'NUTM'],
  [32701, 32760, 32700, 'WGS84', 'SUTM'],
];

function asRaster(raster) {
  return raster?.bandCount ? raster : createGeophysicsRaster(raster);
}

/**
 * `EPSG:N` for EPSG numbers and strings in any spelling, otherwise the
 * trimmed definition, so equal systems compare equal.
 */
export function canonicalCrs(crs) {
  if (crs === null || crs === undefined) return null;
  if (typeof crs === 'number') return `EPSG:${crs}`;
  const text = String(crs).trim();
  const match = /^(?:epsg\s*:\s*)?(\d+)$/i.exec(text);
  return match ? `EPSG:${Number(match[1])}` : text;
}

function epsgCode(crs) {
  if (crs === null || crs === undefined) return null;
  const match = /^EPSG:(\d+)$/.exec(canonicalCrs(crs));
  return match ? Number(match[1]) : null;
}

/**
 * ERS `[datum, projection, coordinateType]` for a CRS: `['GDA94', 'MGA50',
 * 'EN']`, `['GDA94', 'GEODETIC', 'LATLONG']`, or `['RAW', 'RAW', 'EN']` when
 * there is no CRS or it has no ERS name (eastings and northings, as GDAL
 * writes them, so GDAL still reads the position).  The inverse of `ersCrs`.
 *
 * @param {string|number|null} crs
 * @returns {[string, string, string]}
 */
export function ersCoordinateSpace(crs) {
  const code = epsgCode(crs);
  if (code in GEODETIC) return [GEODETIC[code], 'GEODETIC', 'LATLONG'];
  for (const [first, last, base, datum, prefix] of ZONED) {
    if (code !== null && code >= first && code <= last) return [datum, `${prefix}${code - base}`, 'EN'];
  }
  return ['RAW', 'RAW', 'EN'];
}

function cellType(dtype) {
  const type = CELL_TYPES[dtype];
  if (!type) throw new RangeError(`cannot write ${dtype} cells; use one of ${Object.keys(CELL_TYPES).join(', ')}`);
  return type;
}

function northUp(raster) {
  const [a, b, c, d, e, f] = raster.transform;
  if (b !== 0 || d !== 0 || a <= 0 || e >= 0) {
    throw new RangeError('ERS grids must be north-up (no rotation, positive cell sizes)');
  }
  return [a, -e, c, f];
}

function isValid(value, nodata) {
  return value !== null && value !== undefined && Number.isFinite(value) && value !== nodata;
}

/** The null value to write, or null when the type has none. */
function nullValue(raster, type, nodata, fallback) {
  if (nodata !== undefined && nodata !== null) return Number(nodata);
  if (raster.nodata !== null && Number.isFinite(raster.nodata)) return raster.nodata;
  return type.float ? fallback : null;
}

function typeName(type) {
  return Object.keys(CELL_TYPES).find((key) => CELL_TYPES[key] === type);
}

/**
 * One band's cells in the output type, missing cells set to `fill`.  Throws
 * when a missing cell has no null value, a value or the null value does not
 * fit the type, or a real value would read back as null (as Python).
 */
function bandCells(raster, band, type, fill) {
  if (fill !== null && !type.float && !(Number.isInteger(fill) && fill >= type.min && fill <= type.max)) {
    throw new RangeError(`nodata ${fill} does not fit ${typeName(type)} cells`);
  }
  // The null value as stored, so float32 rounding cannot hide a collision.
  const stored = fill === null ? null : new type.array([fill])[0];
  if (type.float && Number.isFinite(fill) && !Number.isFinite(stored)) {
    throw new RangeError(`nodata ${fill} is too large for ${typeName(type)} cells`);
  }
  const cells = new type.array(raster.width * raster.height);
  raster.data[band].forEach((row, i) => row.forEach((value, j) => {
    const k = i * raster.width + j;
    if (!isValid(value, raster.nodata)) {
      if (fill === null) throw new RangeError('the raster has missing cells but the output type has no null value; pass nodata');
      cells[k] = fill;
      return;
    }
    if (!type.float && (value < type.min || value > type.max || !Number.isInteger(value))) {
      throw new RangeError(`values do not fit ${typeName(type)} cells`);
    }
    cells[k] = value;
    if (type.float && !Number.isFinite(cells[k])) {
      throw new RangeError(`values are too large for ${typeName(type)} cells; pass dtype: 'float64'`);
    }
    if (stored !== null && cells[k] === stored) {
      throw new RangeError(
        `the null value ${fill} also occurs as data, so those cells would read back as missing; pass a different nodata`,
      );
    }
  }));
  return cells;
}

function dms(value) {
  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  const degrees = Math.trunc(magnitude);
  const minutes = Math.trunc((magnitude - degrees) * 60);
  const seconds = (magnitude - degrees - minutes / 60) * 3600;
  return `${sign}${degrees}:${minutes}:${seconds}`;
}

/**
 * Encode a raster as an ER Mapper dataset.  Matches Python's `write_ers`.
 *
 * @param {object} raster - North-up.
 * @param {object} [options]
 * @param {string} [options.name='grid.ers'] - Header file name, recorded in the header.
 * @param {string} [options.dtype='float32'] - Cell type: float32, float64, (u)int8/16/32.
 * @param {number} [options.nodata] - `NullCellValue`; defaults to the raster's
 *   nodata, or -99999 for float grids.
 * @returns {{header: string, data: ArrayBuffer}} Save the data beside the
 *   header, named as the header without `.ers`.
 */
export function encodeErs(raster, { name = 'grid.ers', dtype = 'float32', nodata } = {}) {
  const normalized = asRaster(raster);
  const type = cellType(dtype);
  const [cellX, cellY, originX, originY] = northUp(normalized);
  const fill = nullValue(normalized, type, nodata, DEFAULT_ERS_NULL);
  const { width, height, bandCount } = normalized;

  const bands = Array.from({ length: bandCount }, (_, band) => bandCells(normalized, band, type, fill));
  const buffer = new ArrayBuffer(width * height * bandCount * type.bytes);
  const view = new DataView(buffer);
  const setters = {
    1: type.format === 2 ? (o, v) => view.setInt8(o, v) : (o, v) => view.setUint8(o, v),
    2: type.format === 2 ? (o, v) => view.setInt16(o, v, true) : (o, v) => view.setUint16(o, v, true),
    4: type.float ? (o, v) => view.setFloat32(o, v, true)
      : type.format === 2 ? (o, v) => view.setInt32(o, v, true) : (o, v) => view.setUint32(o, v, true),
    8: (o, v) => view.setFloat64(o, v, true),
  };
  const set = setters[type.bytes];
  let offset = 0;
  // Band-interleaved by line: each line holds every band in turn.
  for (let row = 0; row < height; row += 1) {
    for (let band = 0; band < bandCount; band += 1) {
      for (let column = 0; column < width; column += 1) {
        set(offset, bands[band][row * width + column]);
        offset += type.bytes;
      }
    }
  }

  const [datum, projection, coordinateType] = ersCoordinateSpace(normalized.crs);
  let registration;
  if (coordinateType === 'LATLONG') registration = [`Longitude\t= ${dms(originX)}`, `Latitude\t= ${dms(originY)}`];
  else registration = [`Eastings\t= ${originX}`, `Northings\t= ${originY}`];
  const units = normalized.metadata?.units ?? [];
  const lines = [
    'DatasetHeader Begin',
    '\tVersion\t= "6.0"',
    `\tName\t= "${name}"`,
    '\tDataSetType\t= ERStorage',
    '\tDataType\t= Raster',
    '\tByteOrder\t= LSBFirst',
    '\tCoordinateSpace Begin',
    `\t\tDatum\t= "${datum}"`,
    `\t\tProjection\t= "${projection}"`,
    `\t\tCoordinateType\t= ${coordinateType}`,
    '\t\tRotation\t= 0:0:0.0',
    '\tCoordinateSpace End',
    '\tRasterInfo Begin',
    `\t\tCellType\t= ${type.ers}`,
  ];
  if (fill !== null) lines.push(`\t\tNullCellValue\t= ${fill}`);
  lines.push(
    '\t\tCellInfo Begin',
    `\t\t\tXdimension\t= ${cellX}`,
    `\t\t\tYdimension\t= ${cellY}`,
    '\t\tCellInfo End',
    `\t\tNrOfLines\t= ${height}`,
    `\t\tNrOfCellsPerLine\t= ${width}`,
    '\t\tRegistrationCoord Begin',
    ...registration.map((line) => `\t\t\t${line}`),
    '\t\tRegistrationCoord End',
    '\t\tRegistrationCellX\t= 0',
    '\t\tRegistrationCellY\t= 0',
    `\t\tNrOfBands\t= ${bandCount}`,
  );
  normalized.bandNames.forEach((bandName, index) => {
    lines.push('\t\tBandId Begin', `\t\t\tValue\t= "${bandName}"`);
    if (units[index]) lines.push(`\t\t\tUnits\t= "${units[index]}"`);
    lines.push('\t\tBandId End');
  });
  lines.push('\tRasterInfo End', 'DatasetHeader End', '');
  return { header: lines.join('\n'), data: buffer };
}

// --- GeoTIFF ------------------------------------------------------------------

const SHORT = 3;
const LONG = 4;
const ASCII = 2;
const DOUBLE = 12;
const TYPE_BYTES = { [SHORT]: 2, [LONG]: 4, [ASCII]: 1, [DOUBLE]: 8 };

/**
 * Whether an EPSG code is geographic (lat/long), from what is known rather
 * than its number: a proj4 definition, the systems ERS names (see
 * ersCoordinateSpace), or the raster's own `metadata.crs_units`.
 */
function isGeographic(code, raster) {
  const definition = proj4.defs(`EPSG:${code}`);
  if (definition) return definition.projName === 'longlat';
  if (code in GEODETIC) return true;
  if (ersCoordinateSpace(code)[0] !== 'RAW') return false; // an MGA, AMG or UTM zone
  const units = raster.metadata?.crs_units;
  if (units === 'degree') return true;
  if (units === 'metre' || units === 'foot' || units === 'us_survey_foot') return false;
  throw new RangeError(
    `cannot tell whether EPSG:${code} is geographic or projected; set metadata.crs_units ('degree' or 'metre') `
    + 'or register the CRS with proj4.defs',
  );
}

const LINEAR_UNIT_CODES = { metre: 9001, foot: 9002, us_survey_foot: 9003 };
const PROJ4_UNITS = { m: 'metre', ft: 'foot', 'us-ft': 'us_survey_foot' };

/** A projected CRS's linear units, or null when unknown. */
function projectedUnits(code, raster) {
  const recorded = raster.metadata?.crs_units;
  if (recorded in LINEAR_UNIT_CODES) return recorded;
  const definition = proj4.defs(`EPSG:${code}`);
  if (definition) return PROJ4_UNITS[definition.units ?? 'm'] ?? null;
  return ersCoordinateSpace(code)[0] !== 'RAW' ? 'metre' : null;
}

function escapeXml(text) {
  return String(text).replace(/[<>&"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function gdalMetadata(raster) {
  const units = raster.metadata?.units ?? [];
  const items = raster.bandNames.flatMap((bandName, index) => [
    `<Item name="DESCRIPTION" sample="${index}" role="description">${escapeXml(bandName)}</Item>`,
    ...(units[index] ? [`<Item name="UNITTYPE" sample="${index}" role="unittype">${escapeXml(units[index])}</Item>`] : []),
  ]);
  return `<GDALMetadata>\n${items.map((item) => `  ${item}`).join('\n')}\n</GDALMetadata>`;
}

/**
 * Encode a raster as an uncompressed GeoTIFF.  Matches the layout of
 * Python's `write_geotiff` closely enough that GDAL, Python's
 * `load_raster` and `loadGeoTiff` read the same grid, CRS, nodata and band
 * names.
 *
 * @param {object} raster
 * @param {object} [options]
 * @param {string} [options.dtype='float32'] - float32, float64 or (u)int8/16/32.
 * @param {number} [options.nodata] - Value for missing cells; defaults to the
 *   raster's nodata, or NaN for float grids.
 * @returns {ArrayBuffer}
 *
 * The CRS is written when it is an EPSG code; other definitions are left
 * out (the grid keeps its transform).
 */
export function encodeGeoTiff(raster, { dtype = 'float32', nodata } = {}) {
  const normalized = asRaster(raster);
  const type = cellType(dtype);
  const fill = nullValue(normalized, type, nodata, NaN);
  const { width, height, bandCount } = normalized;
  const bands = Array.from({ length: bandCount }, (_, band) => bandCells(normalized, band, type, fill));
  const stripBytes = width * height * type.bytes;

  const [a, b, c, d, e, f] = normalized.transform;
  const geoKeys = [[1025, 1]]; // GTRasterTypeGeoKey: PixelIsArea
  const code = epsgCode(normalized.crs);
  if (code !== null) {
    const geographic = isGeographic(code, normalized);
    geoKeys.push([1024, geographic ? 2 : 1]);
    geoKeys.push([geographic ? 2048 : 3072, code]);
    // ProjLinearUnitsGeoKey, so readers (loadGeoTiff included) know the units.
    const unit = geographic ? null : LINEAR_UNIT_CODES[projectedUnits(code, normalized)];
    if (unit) geoKeys.push([3076, unit]);
  }
  geoKeys.sort(([p], [q]) => p - q);
  const tags = [
    [256, LONG, [width]],
    [257, LONG, [height]],
    [258, SHORT, Array(bandCount).fill(type.bytes * 8)],
    [259, SHORT, [1]],
    [262, SHORT, [1]],
    [273, LONG, Array(bandCount).fill(0)], // strip offsets, set below
    [277, SHORT, [bandCount]],
    [278, LONG, [height]],
    [279, LONG, Array(bandCount).fill(stripBytes)],
    [284, SHORT, [2]], // one plane per band
    ...(bandCount > 1 ? [[338, SHORT, Array(bandCount - 1).fill(0)]] : []),
    [339, SHORT, Array(bandCount).fill(type.format)],
    ...(b === 0 && d === 0 && a > 0 && e < 0
      ? [[33550, DOUBLE, [a, -e, 0]], [33922, DOUBLE, [0, 0, 0, c, f, 0]]]
      : [[34264, DOUBLE, [a, b, 0, c, d, e, 0, f, 0, 0, 0, 0, 0, 0, 0, 1]]]),
    [34735, SHORT, [1, 1, 0, geoKeys.length, ...geoKeys.flatMap(([key, value]) => [key, 0, 1, value])]],
    [42112, ASCII, gdalMetadata(normalized)],
    ...(fill === null ? [] : [[42113, ASCII, Number.isNaN(fill) ? 'nan' : String(fill)]]),
  ].sort(([p], [q]) => p - q);

  const encoded = tags.map(([tag, kind, values]) => {
    const items = kind === ASCII ? [...new TextEncoder().encode(values), 0] : values;
    return { tag, kind, items, bytes: items.length * TYPE_BYTES[kind] };
  });
  const ifdBytes = 2 + encoded.length * 12 + 4;
  let extra = 8 + ifdBytes;
  for (const entry of encoded) {
    if (entry.bytes > 4) {
      extra += extra % 8 ? 8 - (extra % 8) : 0;
      entry.offset = extra;
      extra += entry.bytes;
    }
  }
  const dataStart = extra + (extra % 8 ? 8 - (extra % 8) : 0);
  const strips = encoded.find((entry) => entry.tag === 273);
  strips.items = bands.map((_, band) => dataStart + band * stripBytes);

  const buffer = new ArrayBuffer(dataStart + bandCount * stripBytes);
  const view = new DataView(buffer);
  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, encoded.length, true);
  const write = (kind, offset, value) => {
    if (kind === SHORT) view.setUint16(offset, value, true);
    else if (kind === LONG) view.setUint32(offset, value, true);
    else if (kind === ASCII) view.setUint8(offset, value);
    else view.setFloat64(offset, value, true);
  };
  encoded.forEach((entry, index) => {
    const at = 10 + index * 12;
    view.setUint16(at, entry.tag, true);
    view.setUint16(at + 2, entry.kind, true);
    view.setUint32(at + 4, entry.items.length, true);
    const target = entry.bytes > 4 ? entry.offset : at + 8;
    if (entry.bytes > 4) view.setUint32(at + 8, entry.offset, true);
    entry.items.forEach((value, item) => write(entry.kind, target + item * TYPE_BYTES[entry.kind], value));
  });
  view.setUint32(10 + encoded.length * 12, 0, true);
  bands.forEach((cells, band) => {
    new Uint8Array(buffer, dataStart + band * stripBytes, stripBytes)
      .set(new Uint8Array(cells.buffer, cells.byteOffset, stripBytes));
  });
  return buffer;
}
