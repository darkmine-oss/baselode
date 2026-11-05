export type GeophysicsCell = number | null;
export type GeophysicsBand = GeophysicsCell[][];
export type GeophysicsTransform = [number, number, number, number, number, number];
export type GeophysicsCrsUnits = 'degree' | 'metre' | 'foot' | 'us_survey_foot';

export interface GeophysicsProcessingStep {
  operation: string;
  [key: string]: unknown;
}

export interface GeophysicsProvenance {
  schema: 'baselode.geophysics.provenance';
  version: 1;
  producer: { library: 'baselode'; version: string };
  sources: string[];
  metadata: Record<string, unknown>;
  export: { format: 'ERS' | 'GeoTIFF'; dtype: GeophysicsCellType };
}

export interface GeophysicsRasterMetadata {
  baselode_provenance?: GeophysicsProvenance;
  provenance_ignored?: boolean;
  input_lineage?: Array<{ metadata: Record<string, unknown>; sources: string[] }>;
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
export function loadGeoTiff(source: BinarySource, options?: { maxCells?: number; samples?: number[]; includeProvenance?: boolean }): Promise<GeophysicsRaster>;

export function parseErsHeader(text: string): Record<string, unknown>;
export function ersCrs(datum: string | null | undefined, projection: string | null | undefined): string | null;
export function readErs(
  headerText: string,
  data: ArrayBuffer | ArrayBufferView,
  options?: { maxCells?: number; name?: string; includeProvenance?: boolean },
): GeophysicsRaster;
export function loadErs(
  header: BinarySource,
  data: BinarySource,
  options?: { maxCells?: number; name?: string; includeProvenance?: boolean },
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

export type GeophysicsSamplingMethod = 'bilinear' | 'nearest';
export const GEOPHYSICS_SAMPLING_METHODS: readonly GeophysicsSamplingMethod[];
export type GeophysicsPoint = [number, number] | { x: number; y: number };
export interface GeophysicsSamplingOptions {
  band?: number;
  method?: GeophysicsSamplingMethod;
  crs?: string | number;
}
export function sampleGeophysicsRaster(
  raster: GeophysicsRasterInput,
  points: GeophysicsPoint[],
  options?: GeophysicsSamplingOptions,
): Array<number | null>;
export function sampleGeophysicsRows<T extends object>(
  raster: GeophysicsRasterInput,
  rows: T[],
  options?: GeophysicsSamplingOptions & { xField?: string; yField?: string; field?: string },
): Array<T & Record<string, number | null>>;
export interface GeophysicsProfileStation { distance: number; x: number; y: number }
export function geophysicsProfileStations(vertices: GeophysicsPoint[], spacing: number): GeophysicsProfileStation[];
export function sampleGeophysicsProfile(
  raster: GeophysicsRasterInput,
  vertices: GeophysicsPoint[],
  options: GeophysicsSamplingOptions & { spacing: number },
): Array<GeophysicsProfileStation & { value: number | null }>;
/** Reproject [x, y] pairs; non-finite pairs come back as [NaN, NaN]. */
export function transformCrsPoints(
  sourceCrs: string | number,
  targetCrs: string | number,
  points: Array<[number, number]>,
): Array<[number, number]>;

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
  options?: { includeProvenance?: boolean },
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
  options?: { name?: string; dtype?: GeophysicsCellType; nodata?: number; includeProvenance?: boolean },
): { header: string; data: ArrayBuffer };
export function encodeGeoTiff(
  raster: GeophysicsRasterInput,
  options?: { dtype?: GeophysicsCellType; nodata?: number; includeProvenance?: boolean },
): ArrayBuffer;

/** V1 recipes use the same snake_case parameters in Python and JavaScript. */
export interface GeophysicsWorkflowStep {
  id: string;
  operation: string;
  version: 1;
  inputs: string[];
  parameters: Record<string, number | string | boolean>;
}
export interface GeophysicsWorkflow {
  schema: 'baselode.geophysics.workflow';
  version: 1;
  steps: GeophysicsWorkflowStep[];
  outputs: string[];
}
export interface GeophysicsOperationDescription {
  id: string;
  version: 1;
  inputs: { count: number; kind: string; field_types: string[]; units: string; coordinates: string };
  parameters: { type: 'object'; properties: Record<string, Record<string, unknown>>; required: string[]; additionalProperties: false };
  outputs: { kind: string; resolution: string; field_type: string; units: string };
  assumptions: string[];
  backend: Record<string, unknown>;
  deterministic: boolean;
  corrections: string;
  resources: Record<string, number>;
}
export interface GeophysicsWorkflowValidation {
  state: 'ok' | 'needs_input' | 'rejected' | 'failed';
  issues: Array<{ state: string; code: string; path: string; message: string }>;
  plan: GeophysicsWorkflowStep[];
  resource_estimate: { retained_cell_values: number; max_fft_cells_per_band: number; limits: Record<string, number> };
}
export interface GeophysicsWorkflowResult extends GeophysicsWorkflowValidation {
  artifacts: Record<string, GeophysicsRaster>;
  diagnostics: Array<{ step: string; cell_values: number; assumptions: string[] }>;
  completed_steps: string[];
}
export function listGeophysicsOperations(): GeophysicsOperationDescription[];
export function describeGeophysicsOperation(operation: string): GeophysicsOperationDescription;
export function geophysicsWorkflowSchema(): Record<string, unknown>;
export function magneticGridRecipe(): GeophysicsWorkflow;
export function validateGeophysicsWorkflow(workflow: unknown, inputs: Record<string, GeophysicsRaster>): GeophysicsWorkflowValidation;
export function runGeophysicsWorkflow(workflow: unknown, inputs: Record<string, GeophysicsRaster>): GeophysicsWorkflowResult;
