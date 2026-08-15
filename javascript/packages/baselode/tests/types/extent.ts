import {
  DEFAULT_EXTENT_CRS,
  Extent,
  type ExtentFeature,
  type ExtentPolygon,
  type ExtentPosition,
} from 'baselode/extent';

const extent = Extent.fromBbox([118, -32, 120, -30] as const, 4326, 'WA');
const projected: Extent = extent.toCrs('EPSG:28351');
const center: ExtentPosition = projected.center({ lonlat: true });
const polygon: ExtentPolygon = projected.toPolygon();
const feature: ExtentFeature<{ id: string }> = projected.toFeature({ id: 'wa' });

extent.setCrs(DEFAULT_EXTENT_CRS);
center[0].toFixed();
polygon.coordinates[0][0][0].toFixed();
feature.properties.id.toUpperCase();
