/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The ERS cases in test/data/geophysics_reference.json are written and read
// by Python's baselode.geophysics.ers (test/test_geophysics_reference.py).

import { describe, expect, it } from 'vitest';
import fixture from '../../../../test/data/geophysics_reference.json';
import { ersCrs, loadErs, parseErsHeader, readErs } from '../src/data/ersLoader.js';
import {
  createGeophysicsRaster,
  decimateGeophysicsRaster,
  geophysicsRasterFromBands,
  geophysicsRasterRange,
} from '../src/data/geophysicsRaster.js';

function bytes(base64) {
  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

function expectRowsClose(actual, expected) {
  expect(actual.length).toBe(expected.length);
  expected.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
    const cell = actual[rowIndex][columnIndex];
    if (value === null) expect(cell).toBeNull();
    else expect(cell).toBeCloseTo(value, 9);
  }));
}

describe('ERS reader Python parity', () => {
  for (const ers of fixture.ers) {
    it(`reads ${ers.name} like Python`, () => {
      const raster = readErs(ers.header, bytes(ers.data));
      expect(raster.transform).toEqual(ers.raster.transform);
      expect(raster.crs).toBe(ers.raster.crs);
      expect(raster.bandNames).toEqual(ers.raster.bandNames);
      expect(raster.nodata).toBe(ers.nodata);
      expect(raster.metadata.units).toEqual(ers.raster.metadata.units);
      ers.raster.data.forEach((band, index) => expectRowsClose(raster.data[index], band));
    });

    it(`decimates ${ers.name} like Python`, () => {
      const decimated = readErs(ers.header, bytes(ers.data), { maxCells: 6 });
      expect(decimated.transform).toEqual(ers.decimated6.transform);
      expect(decimated.nodata).toBeNull();
      expect(decimated.metadata.processing).toEqual([{ operation: 'decimate', factor: 3, method: 'area_mean' }]);
      ers.decimated6.data.forEach((band, index) => expectRowsClose(decimated.data[index], band));
      // Decimating a loaded raster gives the same result as decimating on read.
      const later = decimateGeophysicsRaster(readErs(ers.header, bytes(ers.data)), 6);
      later.data.forEach((band, index) => expectRowsClose(band, ers.decimated6.data[index]));
    });
  }
});

describe('ERS reader', () => {
  const [ers] = fixture.ers;

  it('loads from files and reports the header name in errors', async () => {
    const header = new File([ers.header], 'tmi.ers');
    const raster = await loadErs(header, new Blob([bytes(ers.data)]));
    expect(raster.metadata.source).toBe('tmi.ers');
    await expect(loadErs(header, new Blob([bytes(ers.data).slice(0, 12)])))
      .rejects.toThrow(/tmi\.ers: expected 60 cells/);
  });

  it('fetches string URLs for the header and data', async () => {
    const files = { '/grids/tmi.ers': ers.header, '/grids/tmi': bytes(ers.data) };
    const fetched = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      return new Response(files[url]);
    };
    try {
      const raster = await loadErs('/grids/tmi.ers', '/grids/tmi');
      expect(fetched).toEqual(['/grids/tmi.ers', '/grids/tmi']);
      expect(raster.bandNames).toEqual(ers.raster.bandNames);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects malformed, rotated and unsupported headers', () => {
    expect(() => parseErsHeader('Other Begin\nOther End\n')).toThrow(/no DatasetHeader/);
    expect(() => parseErsHeader('DatasetHeader Begin\n')).toThrow(/unclosed/);
    const data = bytes(ers.data);
    expect(() => readErs(ers.header.replace('Rotation\t= 0:0:0.0', 'Rotation\t= 12:30:0'), data))
      .toThrow(/rotated ERS grids \(12.5 degrees\)/);
    expect(() => readErs(ers.header.replace('IEEE4ByteReal', 'Complex'), data)).toThrow(/unsupported CellType/);
  });

  it('parses brace lists and rejects translated ECW images', () => {
    const header = [
      'DatasetHeader Begin',
      '\tDataFile\t= "survey.ecw"',
      '\tDataSetType\t= Translated',
      '\tDataType\t= Raster',
      '\tRasterInfo Begin',
      '\t\tCellType\t= Unsigned8BitInteger',
      '\t\tNrOfLines\t= 4',
      '\t\tNrOfCellsPerLine\t= 3',
      '\t\tNrOfBands\t= 4',
      '\t\tRegionInfo Begin',
      '\t\t\tType\t\t= Polygon',
      '\t\t\tSubRegion\t= {',
      '\t\t\t\t0\t0',
      '\t\t\t\t0\t2',
      '\t\t\t}',
      '\t\tRegionInfo End',
      '\tRasterInfo End',
      'DatasetHeader End',
    ].join('\n');
    const region = parseErsHeader(header).RasterInfo.RegionInfo;
    expect(region.SubRegion).toBe('0\t0\n0\t2');
    expect(region.Type).toBe('Polygon');
    expect(() => parseErsHeader(header.split('}')[0])).toThrow(/unclosed 'SubRegion' list/);
    const data = new Uint8Array(48);
    expect(() => readErs(header, data, { name: 'survey.ers' }))
      .toThrow(/survey\.ers: survey\.ecw is a compressed ECW image, not grid values/);
    expect(() => readErs(header.replace('survey.ecw', 'survey.jp2'), data))
      .toThrow(/translated ERS datasets \(survey\.jp2\)/);
  });

  it('maps datum and projection to EPSG codes', () => {
    expect(ersCrs('GDA94', 'MGA51')).toBe('EPSG:28351');
    expect(ersCrs('GDA2020', 'MGA50')).toBe('EPSG:7850');
    expect(ersCrs('AGD66', 'AMG53')).toBe('EPSG:20253');
    expect(ersCrs('WGS84', 'SUTM55')).toBe('EPSG:32755');
    expect(ersCrs('gda94', 'geodetic')).toBe('EPSG:4283');
    expect(ersCrs('GDA94', 'MGA61')).toBeNull();
    expect(ersCrs('NAD27', 'UTM10')).toBeNull();
  });
});

describe('decimateGeophysicsRaster', () => {
  it('returns small rasters unchanged and validates maxCells', () => {
    const raster = createGeophysicsRaster({ data: [[1, 2], [3, 4]] });
    expect(decimateGeophysicsRaster(raster, 4)).toBe(raster);
    expect(() => decimateGeophysicsRaster(raster, 0)).toThrow(RangeError);
  });

  it('keeps float32 sentinels matching when building from typed bands', () => {
    const band = Float32Array.from([5, -1e32]);
    const raster = geophysicsRasterFromBands([band], { width: 2, height: 1, nodata: -1e32 });
    expect(raster.nodata).toBe(Math.fround(-1e32));
    expect(geophysicsRasterRange(raster)).toEqual([5, 5]);
  });

  it('ignores nodata and keeps the footprint', () => {
    const raster = createGeophysicsRaster({
      data: [[1, 3, -9999], [5, null, 7]],
      transform: [10, 0, 100, 0, -10, 200],
      nodata: -9999,
    });
    const decimated = decimateGeophysicsRaster(raster, 2);
    // Factor 2: one row of two cells, each 1.5 source columns wide.
    expect(decimated.data[0][0][0]).toBeCloseTo((1 + 0.5 * 3 + 5) / 2.5, 12);
    expect(decimated.data[0][0][1]).toBeCloseTo((0.5 * 3 + 7) / 1.5, 12);
    expect(decimated.transform).toEqual([15, 0, 100, 0, -20, 200]);
    expect(decimated.bounds).toEqual(raster.bounds);
  });
});
