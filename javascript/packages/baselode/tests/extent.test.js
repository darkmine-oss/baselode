/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_EXTENT_CRS, Extent } from '../src/extent/Extent.js';

describe('Extent construction', () => {
  it('constructs from named bounds with the default CRS', () => {
    const extent = new Extent({ xmin: 118, ymin: -32, xmax: 120, ymax: -30 });

    expect(extent).toMatchObject({
      xmin: 118,
      ymin: -32,
      xmax: 120,
      ymax: -30,
      name: null,
      crs: DEFAULT_EXTENT_CRS,
    });
  });

  it('constructs from tuple and object bbox forms', () => {
    expect(Extent.fromBbox([118, -32, 120, -30], 4326, 'WA')).toMatchObject({
      xmin: 118,
      ymin: -32,
      xmax: 120,
      ymax: -30,
      name: 'WA',
      crs: 'EPSG:4326',
    });
    expect(Extent.fromBbox({ west: 118, south: -32, east: 120, north: -30 }))
      .toMatchObject({ xmin: 118, ymin: -32, xmax: 120, ymax: -30 });
  });

  it('keeps bounds and name immutable while setCrs remains chainable', () => {
    const extent = new Extent({ xmin: 0, ymin: 1, xmax: 2, ymax: 3, name: 'area' });

    expect(() => { extent.xmin = 99; }).toThrow(TypeError);
    expect(() => { extent.name = 'changed'; }).toThrow(TypeError);
    expect(extent.setCrs('epsg:3857')).toBe(extent);
    expect(extent.crs).toBe('EPSG:3857');
  });

  it('accepts raw proj and WKT definitions', () => {
    const proj = '+proj=longlat +datum=WGS84 +no_defs';
    const wkt = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]';

    expect(Extent.fromBbox([0, 0, 1, 1], proj).crs).toBe(proj);
    expect(Extent.fromBbox([0, 0, 1, 1], wkt).crs).toBe(wkt);
  });

  it.each([
    [{ xmin: Number.NaN, ymin: 0, xmax: 1, ymax: 1 }, /finite number/],
    [{ xmin: 2, ymin: 0, xmax: 1, ymax: 1 }, /xmin/],
    [{ xmin: 0, ymin: 2, xmax: 1, ymax: 1 }, /ymin/],
    [{ bbox: [0, 0, 1] }, /four|contain/],
    [{ xmin: 0, ymin: 0, xmax: 1, ymax: 1, crs: 'EPSG:999999' }, /Invalid CRS/],
  ])('rejects invalid input %#', (options, message) => {
    expect(() => new Extent(options)).toThrow(message);
  });
});

describe('Extent reprojection', () => {
  it('normalises common CRS forms and returns a fresh same-CRS copy', () => {
    const extent = Extent.fromBbox([118, -32, 120, -30], '4326', 'WA');
    const copy = extent.toCrs(4326);

    expect(copy).not.toBe(extent);
    expect(copy).toEqual(extent);
  });

  it('supports GDA94 / MGA zone definitions and preserves the complete envelope', () => {
    const extent = Extent.fromBbox([120, -32, 120.5, -31.5], 'EPSG:4326');
    const projected = extent.toCrs(28351);
    const roundTrip = projected.toCrs('EPSG:4326');

    expect(projected.crs).toBe('EPSG:28351');
    expect(projected.xmin).toBeLessThan(projected.xmax);
    expect(projected.ymin).toBeLessThan(projected.ymax);
    expect(roundTrip.xmin).toBeLessThanOrEqual(120);
    expect(roundTrip.ymin).toBeLessThanOrEqual(-32);
    expect(roundTrip.xmax).toBeGreaterThanOrEqual(120.5);
    expect(roundTrip.ymax).toBeGreaterThanOrEqual(-31.5);
  });

  it('uses all four transformed corners for a projected envelope', () => {
    const projected = Extent.fromBbox([112, -45, 154, -10]).toCrs('EPSG:28351');
    const transformedCorners = [
      [112, -45], [154, -45], [154, -10], [112, -10],
    ].map(([x, y]) => Extent.fromBbox([x, y, x, y]).toCrs('EPSG:28351'));

    expect(projected.xmin).toBe(Math.min(...transformedCorners.map(({ xmin }) => xmin)));
    expect(projected.ymin).toBe(Math.min(...transformedCorners.map(({ ymin }) => ymin)));
    expect(projected.xmax).toBe(Math.max(...transformedCorners.map(({ xmax }) => xmax)));
    expect(projected.ymax).toBe(Math.max(...transformedCorners.map(({ ymax }) => ymax)));
  });

  it('returns projected and longitude/latitude centers', () => {
    const projected = Extent.fromBbox([120, -32, 120.5, -31.5]).toCrs(28351);
    const [x, y] = projected.center();
    const [lon, lat] = projected.center({ lonlat: true });

    expect(x).toBeGreaterThan(projected.xmin);
    expect(y).toBeGreaterThan(projected.ymin);
    expect(lon).toBeCloseTo(120.25, 2);
    expect(lat).toBeCloseTo(-31.75, 2);
  });
});

describe('Extent GeoJSON helpers', () => {
  const extent = new Extent({ xmin: 1, ymin: 2, xmax: 4, ymax: 6 });
  const ring = [[1, 2], [4, 2], [4, 6], [1, 6], [1, 2]];

  it('emits a closed counter-clockwise polygon in deterministic order', () => {
    expect(extent.toPolygon()).toEqual({ type: 'Polygon', coordinates: [ring] });
  });

  it('wraps the polygon as Feature and FeatureCollection', () => {
    const properties = { id: 'study-area' };
    expect(extent.toFeature(properties)).toEqual({
      type: 'Feature',
      properties,
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
    expect(extent.toFeatureCollection(properties).features).toEqual([
      extent.toFeature(properties),
    ]);
  });

  it('derives an envelope from a Polygon Feature and formats Folium bounds', () => {
    const feature = {
      type: 'Feature',
      properties: null,
      geometry: {
        type: 'Polygon',
        coordinates: [[[3, 7], [9, 5], [4, -1], [3, 7]]],
      },
    };
    const derived = Extent.fromFeature(feature, 'EPSG:3857', 'polygon');

    expect(derived).toMatchObject({
      xmin: 3, ymin: -1, xmax: 9, ymax: 7, crs: 'EPSG:3857', name: 'polygon',
    });
    expect(derived.getFoliumRectangle()).toEqual([[-1, 3], [7, 9]]);
  });
});
