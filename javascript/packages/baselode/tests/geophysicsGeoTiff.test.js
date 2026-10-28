/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const image = {};

vi.mock('geotiff', () => ({
  fromArrayBuffer: async () => ({ getImage: async () => image }),
  fromUrl: async () => ({ getImage: async () => image }),
}));

const { createGeophysicsRaster, decimateGeophysicsRaster, loadGeoTiff } = await import('../src/data/geophysicsRaster.js');

const TIE_POINT = [0, 0, 0, 500000, 7000000, 0];

function setImage({ fileDirectory = { ModelTiepoint: TIE_POINT }, resolution = [10, -10], noData = -9999, geoKeys = {} } = {}) {
  Object.assign(image, {
    getWidth: () => 2,
    getHeight: () => 1,
    readRasters: async () => [Float32Array.from([1, -9999])],
    getFileDirectory: () => fileDirectory,
    getResolution: () => resolution,
    getGDALNoData: () => noData,
    getGeoKeys: () => ({ ProjectedCSTypeGeoKey: 28351, ...geoKeys }),
  });
}

describe('loadGeoTiff', () => {
  beforeEach(() => setImage());

  it('uses the GDAL nodata value, EPSG CRS and north-up transform', async () => {
    const raster = await loadGeoTiff(new ArrayBuffer(8));
    expect(raster.nodata).toBe(-9999);
    expect(raster.crs).toBe('EPSG:28351');
    expect(raster.transform).toEqual([10, 0, 500000, 0, -10, 7000000]);
  });

  it('keeps a south-up grid south-up', async () => {
    setImage({ resolution: [10, 10] });
    expect((await loadGeoTiff(new ArrayBuffer(8))).transform).toEqual([10, 0, 500000, 0, 10, 7000000]);
  });

  it('reads a rotated ModelTransformation in full', async () => {
    setImage({ fileDirectory: { ModelTransformation: [8, 6, 0, 500000, 6, -8, 0, 7000000, 0, 0, 0, 0, 0, 0, 0, 1] } });
    expect((await loadGeoTiff(new ArrayBuffer(8))).transform).toEqual([8, 6, 500000, 6, -8, 7000000]);
  });

  it('places pixel (0, 0) from a tie point on another pixel', async () => {
    setImage({ fileDirectory: { ModelTiepoint: [5, 7, 0, 500000, 7000000, 0] } });
    expect((await loadGeoTiff(new ArrayBuffer(8))).transform).toEqual([10, 0, 499950, 0, -10, 7000070]);
  });

  it('shifts PixelIsPoint tie points to cell corners, as GDAL does', async () => {
    setImage({ geoKeys: { GTRasterTypeGeoKey: 2 } });
    expect((await loadGeoTiff(new ArrayBuffer(8))).transform).toEqual([10, 0, 499995, 0, -10, 7000005]);
    setImage({
      geoKeys: { GTRasterTypeGeoKey: 2 },
      fileDirectory: { ModelTransformation: [8, 6, 0, 500000, 6, -8, 0, 7000000, 0, 0, 0, 0, 0, 0, 0, 1] },
    });
    expect((await loadGeoTiff(new ArrayBuffer(8))).transform).toEqual([8, 6, 499993, 6, -8, 7000001]);
  });

  it('matches a float32 sentinel that is not exact in float32', async () => {
    setImage({ noData: -1e32 });
    image.readRasters = async () => [Float32Array.from([1, -1e32])];
    const raster = await loadGeoTiff(new ArrayBuffer(8));
    expect(raster.data[0][0][1]).toBe(raster.nodata);
  });

  it('leaves an unreferenced TIFF on the default pixel grid', async () => {
    setImage();
    image.getResolution = () => { throw new Error('The image does not have an affine transformation.'); };
    const raster = await loadGeoTiff(new ArrayBuffer(8));
    expect(raster.transform).toEqual([1, 0, 0, 0, -1, 1]);
  });

  it('decimates from row strips without reading the whole image', async () => {
    const values = Float32Array.from({ length: 12 }, (_, index) => (index === 5 ? -9999 : index));
    const windows = [];
    Object.assign(image, {
      getWidth: () => 4,
      getHeight: () => 3,
      readRasters: async ({ window } = {}) => {
        const [left, top, right, bottom] = window ?? [0, 0, 4, 3];
        windows.push(window ?? null);
        expect([left, right]).toEqual([0, 4]);
        return [values.slice(top * 4, bottom * 4)];
      },
    });
    const raster = await loadGeoTiff(new ArrayBuffer(8), { maxCells: 4 });
    // Factor 2: two output rows of 1.5 source rows each, two columns.
    expect(windows).toEqual([[0, 0, 4, 2], [0, 1, 4, 3]]);
    const full = createGeophysicsRaster({
      data: [[[0, 1, 2, 3], [4, -9999, 6, 7], [8, 9, 10, 11]]], nodata: -9999,
      transform: [10, 0, 500000, 0, -10, 7000000],
    });
    const expected = decimateGeophysicsRaster(full, 4);
    expect(raster.transform).toEqual(expected.transform);
    raster.data[0].forEach((row, r) => row.forEach((value, c) => expect(value).toBeCloseTo(expected.data[0][r][c], 12)));
  });

  it('decimates while loading when maxCells is set', async () => {
    const raster = await loadGeoTiff(new ArrayBuffer(8), { maxCells: 1 });
    // The nodata cell is ignored and the cell doubles in width.
    expect(raster.data).toEqual([[[1]]]);
    expect(raster.nodata).toBeNull();
    expect(raster.transform).toEqual([20, 0, 500000, 0, -10, 7000000]);
  });
});
