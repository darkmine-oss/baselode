export type GeophysicsCell = number | null;
export type GeophysicsBand = GeophysicsCell[][];
export type GeophysicsTransform = [number, number, number, number, number, number];
export type GeophysicsCrsUnits = 'degree' | 'metre' | 'foot' | 'us_survey_foot';

export interface GeophysicsProcessingStep {
  operation: string;
  [key: string]: unknown;
}

export interface GeophysicsRasterMetadata {
  units?: Array<string | null>;
  crs_units?: GeophysicsCrsUnits | null;
  processing?: GeophysicsProcessingStep[];
  [key: string]: unknown;
}

export interface GeophysicsRasterPayload {
  data: GeophysicsCell[][] | GeophysicsCell[][][];
  transform?: GeophysicsTransform | null;
  crs?: string | null;
  nodata?: number | null;
  bandNames?: string[];
  metadata?: GeophysicsRasterMetadata;
}

export interface GeophysicsRaster {
  data: GeophysicsBand[];
  width: number;
  height: number;
  bandCount: number;
  transform: GeophysicsTransform;
  crs: string | null;
  nodata: number | null;
  bandNames: string[];
  metadata: GeophysicsRasterMetadata;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export type GeophysicsRasterInput = GeophysicsRaster | GeophysicsRasterPayload;
type BinarySource = string | URL | Blob | ArrayBuffer | ArrayBufferView;

export function createGeophysicsRaster(payload: GeophysicsRasterPayload): GeophysicsRaster;
export function getGeophysicsRasterBand(raster: GeophysicsRasterInput, index?: number): GeophysicsBand;
export function geophysicsRasterRange(raster: GeophysicsRasterInput, band?: number): [number, number];
export function decimateGeophysicsRaster(raster: GeophysicsRasterInput, maxCells?: number): GeophysicsRaster;
export function geophysicsRasterFromBands(
  bands: Array<ArrayLike<number> | ((index: number) => number)>,
  options: { width: number; height: number; maxCells?: number } & Omit<GeophysicsRasterPayload, 'data'>,
): GeophysicsRaster;
export function loadGeoTiff(source: BinarySource, options?: { maxCells?: number; samples?: number[] }): Promise<GeophysicsRaster>;

export function parseErsHeader(text: string): Record<string, unknown>;
export function ersCrs(datum: string | null | undefined, projection: string | null | undefined): string | null;
export function readErs(
  headerText: string,
  data: ArrayBuffer | ArrayBufferView,
  options?: { maxCells?: number; name?: string },
): GeophysicsRaster;
export function loadErs(
  header: BinarySource,
  data: BinarySource,
  options?: { maxCells?: number; name?: string },
): Promise<GeophysicsRaster>;

export type GeophysicsFilterMethod = 'gaussian' | 'butterworth';
export const GEOPHYSICS_FILTER_METHODS: readonly GeophysicsFilterMethod[];
export const MIN_RTP_INCLINATION: number;

export interface GeophysicsFilterOptions {
  method?: GeophysicsFilterMethod;
  order?: number;
  detrend?: boolean;
}

export interface GeophysicsOperationOptions {
  low_pass: GeophysicsFilterOptions & { wavelength: number };
  high_pass: GeophysicsFilterOptions & { wavelength: number };
  band_pass: GeophysicsFilterOptions & { longWavelength: number; shortWavelength: number };
  vertical_derivative: { order?: number };
  horizontal_derivative: { direction?: 'east' | 'north' };
  total_horizontal_derivative: Record<string, never>;
  tilt_derivative: Record<string, never>;
  analytic_signal: Record<string, never>;
  upward_continuation: { height: number };
  reduce_to_pole: { inclination: number; declination: number };
}

export type GeophysicsOperation = keyof GeophysicsOperationOptions;
export const GEOPHYSICS_OPERATIONS: readonly GeophysicsOperation[];

export function geophysicsLowPass(raster: GeophysicsRasterInput, options: GeophysicsOperationOptions['low_pass']): GeophysicsRaster;
export function geophysicsHighPass(raster: GeophysicsRasterInput, options: GeophysicsOperationOptions['high_pass']): GeophysicsRaster;
export function geophysicsBandPass(raster: GeophysicsRasterInput, options: GeophysicsOperationOptions['band_pass']): GeophysicsRaster;
export function geophysicsVerticalDerivative(raster: GeophysicsRasterInput, options?: GeophysicsOperationOptions['vertical_derivative']): GeophysicsRaster;
export function geophysicsHorizontalDerivative(raster: GeophysicsRasterInput, options?: GeophysicsOperationOptions['horizontal_derivative']): GeophysicsRaster;
export function geophysicsTotalHorizontalDerivative(raster: GeophysicsRasterInput): GeophysicsRaster;
export function geophysicsTiltDerivative(raster: GeophysicsRasterInput): GeophysicsRaster;
export function geophysicsAnalyticSignal(raster: GeophysicsRasterInput): GeophysicsRaster;
export function geophysicsUpwardContinuation(raster: GeophysicsRasterInput, options: GeophysicsOperationOptions['upward_continuation']): GeophysicsRaster;
export function geophysicsReduceToPole(raster: GeophysicsRasterInput, options: GeophysicsOperationOptions['reduce_to_pole']): GeophysicsRaster;
export function processGeophysicsRaster<K extends GeophysicsOperation>(
  raster: GeophysicsRasterInput,
  operation: K,
  options?: GeophysicsOperationOptions[K],
): GeophysicsRaster;

export type GeophysicsCombineOperation = 'add' | 'subtract' | 'multiply' | 'divide';
export const GEOPHYSICS_COMBINE_OPERATIONS: readonly GeophysicsCombineOperation[];
export type GeophysicsPolygon =
  | Array<[number, number]>
  | Array<Array<[number, number]>>
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }
  | { type: 'Feature'; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } };
export function cropGeophysicsRaster(
  raster: GeophysicsRasterInput,
  bounds: [number, number, number, number],
): GeophysicsRaster;
export function clipGeophysicsRaster(
  raster: GeophysicsRasterInput,
  polygon: GeophysicsPolygon,
  options?: { crop?: boolean },
): GeophysicsRaster;
export function combineGeophysicsRasters(
  left: GeophysicsRasterInput,
  right: GeophysicsRasterInput | number,
  operation: GeophysicsCombineOperation,
): GeophysicsRaster;
export function fillGeophysicsGaps(
  raster: GeophysicsRasterInput,
  options?: { maxDistance?: number | null; iterations?: number },
): GeophysicsRaster;

export type GeophysicsCellType = 'float32' | 'float64' | 'uint8' | 'int8' | 'uint16' | 'int16' | 'uint32' | 'int32';
export const DEFAULT_ERS_NULL: number;
export function ersCoordinateSpace(crs: string | number | null | undefined): [string, string, string];
export function encodeErs(
  raster: GeophysicsRasterInput,
  options?: { name?: string; dtype?: GeophysicsCellType; nodata?: number },
): { header: string; data: ArrayBuffer };
export function encodeGeoTiff(
  raster: GeophysicsRasterInput,
  options?: { dtype?: GeophysicsCellType; nodata?: number },
): ArrayBuffer;
