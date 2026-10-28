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

const { loadGeoTiff } = await import('../src/data/geophysicsRaster.js');

function setImage({ fileDirectory = {}, origin = [500000, 7000000], resolution = [10, -10], noData = -9999 } = {}) {
  Object.assign(image, {
    getWidth: () => 2,
    getHeight: () => 1,
    readRasters: async () => [Float32Array.from([1, -9999])],
    getFileDirectory: () => fileDirectory,
    getOrigin: () => origin,
    getResolution: () => resolution,
    getGDALNoData: () => noData,
    getGeoKeys: () => ({ ProjectedCSTypeGeoKey: 28351 }),
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

  it('leaves an unreferenced TIFF on the default pixel grid', async () => {
    setImage();
    image.getOrigin = () => { throw new Error('The image does not have an affine transformation.'); };
    const raster = await loadGeoTiff(new ArrayBuffer(8));
    expect(raster.transform).toEqual([1, 0, 0, 0, -1, 1]);
  });
});
