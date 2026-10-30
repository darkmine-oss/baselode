/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * ER Mapper `.ers` raster reader (port of Python's `baselode.geophysics.ers`).
 *
 * An ERS dataset is a plain-text header (`grid.ers`) beside a raw
 * band-interleaved-by-line binary file (`grid`). Australian government
 * geophysics grids are distributed in this form. Georeferencing follows the
 * GDAL ERS driver: the registration coordinate is the top-left corner of the
 * registration cell, which defaults to cell (0, 0).
 */

import { geophysicsRasterFromBands } from './geophysicsRaster.js';

const CELL_TYPES = {
  unsigned8bitinteger: { size: 1, read: 'getUint8' },
  signed8bitinteger: { size: 1, read: 'getInt8' },
  unsigned16bitinteger: { size: 2, read: 'getUint16' },
  signed16bitinteger: { size: 2, read: 'getInt16' },
  unsigned32bitinteger: { size: 4, read: 'getUint32' },
  signed32bitinteger: { size: 4, read: 'getInt32' },
  ieee4bytereal: { size: 4, read: 'getFloat32' },
  ieee8bytereal: { size: 8, read: 'getFloat64' },
};

const DATUM_EPSG = {
  GDA94: { geodetic: 4283, mga: 28300 },
  GDA2020: { geodetic: 7844, mga: 7800 },
  AGD66: { geodetic: 4202, amg: 20200 },
  AGD84: { geodetic: 4203, amg: 20300 },
  WGS84: { geodetic: 4326, nutm: 32600, sutm: 32700 },
};

const ZONED_PROJECTION = /^(MGA|AMG|NUTM|SUTM)(\d{1,2})$/;

/**
 * Parse ERS header text into nested objects. `Name Begin` / `Name End` blocks
 * become objects and `key = value` lines become strings with quotes removed.
 * A `key = {` list (for example a region's `SubRegion` vertices) runs to the
 * closing `}` and becomes its lines joined by newlines. A repeated block or
 * key (for example `BandId`) becomes an array.
 *
 * @param {string} text
 * @returns {object} The `DatasetHeader` block.
 */
export function parseErsHeader(text) {
  const root = {};
  const stack = [root];
  let listKey = null;
  let listLines = [];
  String(text).split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (listKey !== null) {
      if (line === '}') {
        store(stack[stack.length - 1], listKey, listLines.join('\n'));
        listKey = null;
      } else if (line) {
        listLines.push(line);
      }
      return;
    }
    if (!line || line.startsWith('#')) return;
    const equals = line.indexOf('=');
    if (equals >= 0) {
      const value = line.slice(equals + 1).trim();
      if (value === '{') {
        listKey = line.slice(0, equals).trim();
        listLines = [];
      } else {
        store(stack[stack.length - 1], line.slice(0, equals).trim(), value.replace(/^"|"$/g, ''));
      }
      return;
    }
    const parts = line.split(/\s+/);
    if (parts.length === 2 && parts[1] === 'Begin') {
      const block = {};
      store(stack[stack.length - 1], parts[0], block);
      stack.push(block);
    } else if (parts.length === 2 && parts[1] === 'End') {
      if (stack.length === 1) throw new Error(`ERS header line ${index + 1}: unmatched '${line}'`);
      stack.pop();
    } else {
      throw new Error(`ERS header line ${index + 1}: cannot parse '${line}'`);
    }
  });
  if (listKey !== null) throw new Error(`ERS header ends inside the unclosed '${listKey}' list`);
  if (stack.length !== 1) throw new Error('ERS header ends inside an unclosed block');
  if (!('DatasetHeader' in root)) throw new Error('ERS header has no DatasetHeader block');
  return root.DatasetHeader;
}

// A Translated dataset points at an image in another format, such as an
// ECW-compressed colour rendering, rather than raw grid values.
function rejectTranslated(header, name) {
  if (String(header.DataSetType ?? '').toLowerCase() !== 'translated') return;
  const dataFile = header.DataFile || '';
  if (dataFile.toLowerCase().endsWith('.ecw')) {
    throw new Error(`${name}: ${dataFile} is a compressed ECW image, not grid values; open the raw .ers grid instead`);
  }
  throw new Error(`${name}: translated ERS datasets (${dataFile || 'no DataFile'}) are not supported`);
}

function store(container, key, value) {
  if (!(key in container)) container[key] = value;
  else if (Array.isArray(container[key])) container[key].push(value);
  else container[key] = [container[key], value];
}

function asList(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Parse an ERS `d:m:s` angle (or a plain decimal) to decimal degrees. */
function parseDms(value) {
  const text = String(value).trim();
  if (!text.includes(':')) return Number(text);
  const negative = text.startsWith('-');
  const [degrees = 0, minutes = 0, seconds = 0] = text.replace(/^[+-]/, '').split(':').map(Number);
  const total = degrees + minutes / 60 + seconds / 3600;
  return negative ? -total : total;
}

/**
 * Map an ERS datum/projection pair to an `EPSG:` identifier for the
 * Australian and WGS84 systems used by government geophysics grids.
 *
 * @param {string} datum - ERS `Datum`, e.g. `GDA94`.
 * @param {string} projection - ERS `Projection`, e.g. `MGA51` or `GEODETIC`.
 * @returns {string|null}
 */
export function ersCrs(datum, projection) {
  const codes = DATUM_EPSG[String(datum ?? '').toUpperCase()];
  if (!codes) return null;
  const name = String(projection ?? '').toUpperCase();
  if (name === 'GEODETIC' || name === 'GEOGRAPHIC') return `EPSG:${codes.geodetic}`;
  const match = ZONED_PROJECTION.exec(name);
  if (!match) return null;
  const family = match[1].toLowerCase();
  const zone = Number(match[2]);
  if (!(family in codes) || zone < 1 || zone > 60) return null;
  return `EPSG:${codes[family] + zone}`;
}

function registration(rasterInfo, coordinateType) {
  // ER Mapper writes `RegistrationCoord`; some tools write the long form.
  const coordinate = rasterInfo.RegistrationCoord || rasterInfo.RegistrationCoordinate || {};
  let x;
  let y;
  if (coordinateType === 'LL') {
    x = coordinate.Longitude == null ? null : parseDms(coordinate.Longitude);
    y = coordinate.Latitude == null ? null : parseDms(coordinate.Latitude);
  } else if (coordinateType === 'RAW') {
    [x, y] = [coordinate.MetresX, coordinate.MetresY];
  } else {
    [x, y] = [coordinate.Eastings, coordinate.Northings];
  }
  return x == null || y == null ? null : [Number(x), Number(y)];
}

/**
 * Read an ERS dataset from its header text and binary data.
 *
 * @param {string} headerText - Contents of the `.ers` header.
 * @param {ArrayBuffer|ArrayBufferView} data - The binary data file.
 * @param {object} [options]
 * @param {number} [options.maxCells] - Decimate (area-weighted mean) to at
 *   most this many cells per band while reading.
 * @param {string} [options.name] - Header file name, used in errors and
 *   `metadata.source`.
 * @returns {object} A geophysics raster: `NullCellValue` cells are null,
 *   `BandId` values name the bands, and band units plus the raw ERS datum and
 *   projection are kept in `metadata`.
 */
export function readErs(headerText, data, options = {}) {
  const name = options.name ?? 'ERS header';
  const header = parseErsHeader(headerText);
  if (String(header.DataType ?? 'Raster').toLowerCase() !== 'raster') {
    throw new Error(`${name}: only ERS raster datasets are supported`);
  }
  rejectTranslated(header, name);
  const rasterInfo = header.RasterInfo;
  if (!rasterInfo || typeof rasterInfo !== 'object' || Array.isArray(rasterInfo)) {
    throw new Error(`${name}: missing RasterInfo block`);
  }
  const cellType = CELL_TYPES[String(rasterInfo.CellType ?? '').toLowerCase()];
  if (!cellType) throw new Error(`${name}: unsupported CellType '${rasterInfo.CellType}'`);
  const littleEndian = String(header.ByteOrder ?? 'LSBFirst').toLowerCase() !== 'msbfirst';
  const height = Number(rasterInfo.NrOfLines);
  const width = Number(rasterInfo.NrOfCellsPerLine);
  const bandCount = Number(rasterInfo.NrOfBands ?? 1);
  if (![height, width, bandCount].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error(`${name}: RasterInfo needs integer NrOfLines and NrOfCellsPerLine`);
  }

  const space = header.CoordinateSpace || {};
  const rotation = parseDms(space.Rotation ?? '0');
  if (Math.abs(rotation) > 1e-9) {
    throw new Error(`${name}: rotated ERS grids (${rotation} degrees) are not supported`);
  }

  const bytes = ArrayBuffer.isView(data)
    ? new DataView(data.buffer, data.byteOffset, data.byteLength)
    : new DataView(data);
  const offset = Number(header.HeaderOffset ?? 0);
  const expected = height * width * bandCount;
  const found = Math.max(0, Math.floor((bytes.byteLength - offset) / cellType.size));
  if (found < expected) {
    throw new Error(
      `${name}: expected ${expected} cells for ${bandCount} band(s) of ${height} x ${width}, found ${found}`,
    );
  }
  const nullValue = rasterInfo.NullCellValue;
  const nodata = nullValue == null || nullValue === '' ? null : Number(nullValue);
  // Compare in the cell precision, as Python compares in the source dtype.
  const sentinel = nodata !== null && cellType.read === 'getFloat32' ? Math.fround(nodata) : nodata;
  const read = bytes[cellType.read].bind(bytes);
  // Band-interleaved by line: each line holds every band in turn. Cells are
  // read on demand, so decimation never holds a full-resolution copy.
  const bands = Array.from({ length: bandCount }, (_, band) => (index) => {
    const row = Math.floor(index / width);
    const column = index - row * width;
    const value = read(offset + ((row * bandCount + band) * width + column) * cellType.size, littleEndian);
    return value === sentinel ? NaN : value;
  });

  const coordinateType = String(space.CoordinateType ?? 'EN').toUpperCase();
  const cellInfo = rasterInfo.CellInfo;
  const origin = registration(rasterInfo, coordinateType);
  let transform;
  if (origin && cellInfo && Object.keys(cellInfo).length) {
    const cellX = Number(cellInfo.Xdimension ?? 1);
    const cellY = Number(cellInfo.Ydimension ?? 1);
    const originX = origin[0] - Number(rasterInfo.RegistrationCellX ?? 0) * cellX;
    const originY = origin[1] + Number(rasterInfo.RegistrationCellY ?? 0) * cellY;
    transform = [cellX, 0, originX, 0, -cellY, originY];
  }

  const bandIds = asList(rasterInfo.BandId);
  const bandNames = [];
  const units = [];
  for (let index = 0; index < bandCount; index += 1) {
    const bandId = bandIds[index] && typeof bandIds[index] === 'object' ? bandIds[index] : {};
    bandNames.push(bandId.Value || `band_${index + 1}`);
    units.push(bandId.Units || null);
  }

  return geophysicsRasterFromBands(bands, {
    width,
    height,
    maxCells: options.maxCells,
    transform,
    crs: ersCrs(space.Datum, space.Projection),
    nodata: sentinel,
    bandNames,
    metadata: {
      driver: 'ERS',
      source: options.name ?? null,
      datum: space.Datum ?? null,
      projection: space.Projection ?? null,
      coordinate_type: coordinateType,
      cell_type: rasterInfo.CellType,
      units,
    },
  });
}

/**
 * Load an ERS dataset from its header and data file.
 *
 * @param {string|URL|Blob|ArrayBuffer} header - Header text (anything
 *   containing `DatasetHeader Begin`), or a URL, file or bytes holding it.
 * @param {string|URL|Blob|ArrayBuffer|ArrayBufferView} data - The data file
 *   (the header name without `.ers`) as a URL, file, or bytes.
 * @param {object} [options] - See {@link readErs}.
 * @returns {Promise<object>}
 */
export async function loadErs(header, data, options = {}) {
  const headerText = typeof header === 'string' && /DatasetHeader\s+Begin/.test(header)
    ? header
    : new TextDecoder('latin1').decode(await toBytes(header));
  const name = options.name ?? (typeof File !== 'undefined' && header instanceof File ? header.name : undefined);
  return readErs(headerText, await toBytes(data), { ...options, name });
}

async function toBytes(source) {
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) return source;
  if (typeof Blob !== 'undefined' && source instanceof Blob) return source.arrayBuffer();
  if (typeof source === 'string' || source instanceof URL) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Could not fetch ${source}: ${response.status}`);
    return response.arrayBuffer();
  }
  throw new TypeError('ERS sources must be a URL, Blob, ArrayBuffer, or typed array.');
}
