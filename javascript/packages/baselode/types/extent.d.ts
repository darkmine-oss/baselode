export type ExtentBboxTuple = readonly [number, number, number, number];

export interface ExtentBboxObject {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type ExtentBbox = ExtentBboxTuple | ExtentBboxObject;
export type ExtentCrs = string | number;
export type ExtentPosition = [number, number];

export interface ExtentOptions {
  xmin?: number;
  ymin?: number;
  xmax?: number;
  ymax?: number;
  bbox?: ExtentBbox;
  name?: string | null;
  crs?: ExtentCrs;
}

export interface ExtentPolygon {
  type: 'Polygon';
  coordinates: ExtentPosition[][];
}

export interface ExtentFeature<P extends object | null = Record<string, unknown>> {
  type: 'Feature';
  properties: P;
  geometry: ExtentPolygon;
}

export interface ExtentFeatureCollection<P extends object | null = Record<string, unknown>> {
  type: 'FeatureCollection';
  features: Array<ExtentFeature<P>>;
}

export const DEFAULT_EXTENT_CRS: 'EPSG:4326';

export class Extent {
  readonly xmin: number;
  readonly ymin: number;
  readonly xmax: number;
  readonly ymax: number;
  readonly name: string | null;
  crs: string;

  constructor(options?: ExtentOptions);

  static fromBbox(bbox: ExtentBbox, crs?: ExtentCrs, name?: string | null): Extent;
  static fromFeature(
    feature: ExtentFeature<object | null>,
    crs?: ExtentCrs,
    name?: string | null,
  ): Extent;

  setCrs(crs: ExtentCrs): this;
  toCrs(targetCrs: ExtentCrs): Extent;
  center(options?: { lonlat?: boolean }): ExtentPosition;
  getFoliumRectangle(): [ExtentPosition, ExtentPosition];
  toPolygon(): ExtentPolygon;
  toFeature<P extends object | null = Record<string, unknown>>(properties?: P): ExtentFeature<P>;
  toFeatureCollection<P extends object | null = Record<string, unknown>>(
    properties?: P,
  ): ExtentFeatureCollection<P>;
}
