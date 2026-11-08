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
  crs_units?: GeophysicsCrsUnits | 'm' | 'ft' | 'us-ft' | 'km' | null;
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

export type GeophysicsObservationField = 'magnetic_total_field' | 'magnetic_anomaly' | 'gravity_observed' | 'gravity_anomaly' | 'radiometric' | 'radiometric_counts' | 'other';
export interface GeophysicsObservationRecord {
  id: string;
  x?: number | null;
  y?: number | null;
  z?: number | null;
  time?: number | null;
  clearance?: number | null;
  line_id?: string | null;
  station_id?: string | null;
  values?: Record<string, number | null>;
  extra?: Record<string, unknown>;
}
export interface GeophysicsObservationsInput {
  schema?: 'baselode.geophysics.observations';
  version?: 1;
  records: GeophysicsObservationRecord[];
  channels: Record<string, { field_type: GeophysicsObservationField; units: string; description?: string }>;
  crs?: string | null;
  crs_units?: string | null;
  metadata?: Record<string, unknown>;
}
export interface GeophysicsObservations extends GeophysicsObservationsInput {
  schema: 'baselode.geophysics.observations';
  version: 1;
  records: Required<GeophysicsObservationRecord>[];
  crs: string | null;
  crs_units: string | null;
  metadata: Record<string, unknown>;
}
export interface GeophysicsObservationQcOptions {
  max_speed?: number;
  max_distance_gap?: number;
  max_time_gap?: number;
  min_clearance?: number;
  spike_window?: number;
  spike_thresholds?: Record<string, number>;
}
export interface GeophysicsObservationQcReport {
  schema: 'baselode.geophysics.observation_qc';
  version: 1;
  state: 'ok' | 'needs_input' | 'rejected';
  producer: { library: string; version: string; algorithm_version: number };
  issues: Array<{ state: string; code: string; message: string }>;
  flags: Array<{ row: number; id: string; code: string; channel?: string; [key: string]: unknown }>;
  segments: Array<{ line_id: string | null; start: number; end: number; count: number; reason: string }>;
  edges: Array<{ from: number; to: number; distance: number; seconds: number; speed: number }>;
  coincident_locations: number[][];
  repeats: Array<{ station_id: string; rows: number[]; same_location: boolean | null; channels: Record<string, { count: number; mean: number; min: number; max: number; range: number; sample_std: number | null }> }>;
  summary: Record<string, unknown>;
  coverage: Record<string, number>;
  parameters: GeophysicsObservationQcOptions;
  assumptions: string[];
  flags_truncated: boolean;
}
export function createGeophysicsObservations(payload: GeophysicsObservationsInput): GeophysicsObservations;
export function geophysicsObservationSchema(): Record<string, unknown>;
export function describeGeophysicsObservationQc(): Record<string, unknown>;
export function qcGeophysicsObservations(payload: unknown, options?: GeophysicsObservationQcOptions | null): GeophysicsObservationQcReport;

export interface GeophysicsInterpolationOptions {
  channels: string[];
  radius: number;
  duplicate_policy: 'mean' | 'reject';
  elevation_policy: 'ignore';
  method?: 'nearest' | 'idw';
  neighbors?: number;
  min_neighbors?: number;
  power?: number;
  extrapolation?: 'mask' | 'allow';
}
export interface GeophysicsGridOptions extends GeophysicsInterpolationOptions {
  bounds: [number, number, number, number];
  shape: [number, number];
}
export type GeophysicsGriddingValidationOptions =
  | { by: 'line'; buffer_distance?: number }
  | { by: 'block'; block_size: [number, number]; origin: [number, number]; buffer_distance?: number };
export interface GeophysicsGriddingBaseReport {
  version: 1;
  state: 'ok' | 'needs_input' | 'rejected';
  issues: Array<{ code: string; message: string }>;
  producer: { library: string; version: string; algorithm_version: number };
  parameters: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  assumptions: string[];
}
export interface GeophysicsObservationGridReport extends GeophysicsGriddingBaseReport {
  schema: 'baselode.geophysics.observation_grid';
  artifacts: Record<string, GeophysicsRaster>;
}
export interface GeophysicsGriddingMetrics {
  tested: number;
  supported: number;
  unsupported: number;
  coverage: number | null;
  rmse: number | null;
  mae: number | null;
  bias: number | null;
}
export interface GeophysicsGriddingValidationReport extends GeophysicsGriddingBaseReport {
  schema: 'baselode.geophysics.gridding_validation';
  folds: Array<{
    group: string;
    train_records: number;
    test_records: number;
    excluded_buffer_records: number;
    training: Record<string, unknown>;
    predictions: Array<{ id: string; channel: string; observed: number; predicted: number | null; nearest_distance: number | null; neighbors: number; extrapolated: boolean; supported: boolean }>;
    metrics: Record<string, GeophysicsGriddingMetrics>;
  }>;
  summary: Record<string, GeophysicsGriddingMetrics>;
}
export function describeGeophysicsGridding(): Record<string, unknown>;
export function gridGeophysicsObservations(payload: unknown, options: GeophysicsGridOptions): GeophysicsObservationGridReport;
export function crossValidateGeophysicsGridding(payload: unknown, options: GeophysicsInterpolationOptions, validation: GeophysicsGriddingValidationOptions): GeophysicsGriddingValidationReport;

export interface GeophysicsAlignmentTarget {
  shape: [number, number];
  transform: [number, number, number, number, number, number];
  crs: string | null;
  crs_units?: string | null;
  frame_id?: string | null;
}
export type GeophysicsAlignmentOptions = {
  datum_policy?: 'backend';
} & (
  | { method: 'nearest' | 'bilinear'; value_kind: 'continuous' }
  | { method: 'nearest'; value_kind: 'categorical' }
);
export interface GeophysicsAlignmentReport extends GeophysicsGriddingBaseReport {
  schema: 'baselode.geophysics.raster_alignment';
  artifacts: Partial<Record<'raster' | 'support' | 'footprint' | 'coordinate_valid', GeophysicsRaster>>;
}
export function describeGeophysicsAlignment(): Record<string, unknown>;
export function alignGeophysicsRaster(source: GeophysicsRaster, target: GeophysicsAlignmentTarget, options: GeophysicsAlignmentOptions): GeophysicsAlignmentReport;
export function matchGeophysicsRaster(source: GeophysicsRaster, reference: GeophysicsRaster, options: GeophysicsAlignmentOptions): GeophysicsAlignmentReport;

/** Contracts for the optional Python numerical backend; no JavaScript solver. */
export interface GeophysicsEquivalentSourceOptions {
  channel: string;
  depth: number;
  damping: number | null;
  radius: number;
  duplicate_policy: 'mean' | 'reject';
  extrapolation?: 'mask' | 'allow';
}
export interface GeophysicsEquivalentSourceGridOptions extends GeophysicsEquivalentSourceOptions {
  bounds: [number, number, number, number];
  shape: [number, number];
  target_height: number;
}
export type GeophysicsEquivalentSourceRequest = {
  schema: 'baselode.geophysics.equivalent_source_request';
  version: 1;
  observations: GeophysicsObservationsInput;
} & (
  | { operation: 'grid'; options: GeophysicsEquivalentSourceGridOptions; validation?: never; candidates?: never }
  | { operation: 'cross_validate'; options: GeophysicsEquivalentSourceOptions; validation: GeophysicsGriddingValidationOptions; candidates?: Array<{ depth: number; damping: number | null }> | null }
);
export interface GeophysicsEquivalentSourceReport {
  schema: 'baselode.geophysics.equivalent_source_grid' | 'baselode.geophysics.equivalent_source_validation' | 'baselode.geophysics.equivalent_source_request';
  version: 1;
  state: 'ok' | 'needs_input' | 'rejected' | 'failed';
  issues: Array<{ code: string; message: string }>;
  producer: { library: string; version: string; algorithm_version: number };
  parameters: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  assumptions: string[];
  /** Present for grid reports from the JSON runner, including empty on failure. */
  artifacts?: Partial<Record<'grid' | 'support' | 'nearest_distance' | 'extrapolation', GeophysicsRasterPayload>>;
  residuals?: Array<{ id: string; observed: number; predicted: number; residual: number }>;
  candidates?: Array<{
    parameters: { depth: number; damping: number | null };
    folds: Array<{ group: string; train_records: number; test_records: number; excluded_buffer_records: number; training: Record<string, unknown> | null; predictions: Array<{ id: string; observed: number; predicted: number | null; nearest_distance: number | null; extrapolated: boolean | null; supported: boolean }>; metrics: GeophysicsGriddingMetrics }>;
    summary: GeophysicsGriddingMetrics;
  }>;
  best_index?: number | null;
}
export function describeGeophysicsEquivalentSources(): Record<string, unknown>;

export type GeophysicsCorrectionState = 'unknown' | 'unapplied' | 'applied';
export type GeophysicsCorrectionName = 'magnetic_diurnal' | 'magnetic_igrf' | 'magnetic_lag' | 'magnetic_heading' | 'magnetic_levelling' | 'magnetic_microlevelling' | 'gravity_drift' | 'gravity_tide' | 'gravity_normal' | 'gravity_free_air' | 'gravity_bouguer' | 'gravity_terrain' | 'radiometric_dead_time' | 'radiometric_energy_calibration' | 'radiometric_background' | 'radiometric_stripping' | 'radiometric_height' | 'radiometric_concentration';
export interface GeophysicsCorrectionDeclaration {
  id: string;
  correction: GeophysicsCorrectionName;
  channels: string[];
  state: GeophysicsCorrectionState;
  evidence: string;
}
export interface GeophysicsMagneticBaseOptions {
  channel: string;
  base_channel: string;
  reference: number;
  max_gap: number;
  event_id: string;
  evidence: string;
  clock_policy: 'synchronized';
}
export type GeophysicsCorrectionEvent = GeophysicsCorrectionDeclaration & {
  producer: { library: 'baselode'; version: string; algorithm_version: 1 };
  input_binding: string;
  output_binding: string;
} & (
  | { kind: 'declaration' }
  | { kind: 'application'; correction: 'magnetic_igrf'; state: 'applied'; parameters: GeophysicsIgrfRemovalOptions; model: GeophysicsIgrfModel; affected_records: number }
  | { kind: 'application'; correction: 'magnetic_diurnal'; state: 'applied'; parameters: GeophysicsMagneticBaseOptions; base_binding: string; base_station_id: string; affected_records: number }
);
export interface GeophysicsCorrectionLedger {
  schema: 'baselode.geophysics.correction_ledger';
  version: 1;
  algorithm: 'sha256-float64-v1';
  initial_binding: string;
  current_binding: string;
  entries: GeophysicsCorrectionEvent[];
}
export interface GeophysicsCorrectionReport {
  schema: 'baselode.geophysics.corrections';
  version: 1;
  operation: 'inspect' | 'declare' | 'magnetic_base';
  state: 'ok' | 'needs_input' | 'rejected';
  issues: Array<{ code: string; message: string }>;
  observations: GeophysicsObservations | null;
  ledger: GeophysicsCorrectionLedger | null;
  states: Record<GeophysicsCorrectionName, Record<string, GeophysicsCorrectionState>>;
  proposals: Array<{ id: string; time: number | null; base_value: number | null; variation: number | null; corrected: number | null; supported: boolean; reason: 'missing_time' | 'missing_base_reading' | 'outside_base_span' | 'excessive_base_gap' | null }>;
  diagnostics: Record<string, unknown>;
  parameters: Record<string, unknown>;
  producer: { library: string; version: string; algorithm_version: number };
  assumptions: string[];
}
export function describeGeophysicsCorrections(): Record<string, unknown>;
/** Native Web Crypto SHA-256: Node 20+ or secure browser context. */
export function inspectGeophysicsCorrections(payload: unknown): Promise<GeophysicsCorrectionReport>;
export function declareGeophysicsCorrections(payload: unknown, declarations: GeophysicsCorrectionDeclaration[]): Promise<GeophysicsCorrectionReport>;
export function correctGeophysicsMagneticBase(payload: unknown, base: unknown, options: GeophysicsMagneticBaseOptions): Promise<GeophysicsCorrectionReport>;

/** Python-only scientific backend; JavaScript exposes the contract and validates its ledger events. */
export interface GeophysicsIgrfPoint { id: string; longitude: number; latitude: number; height_m: number; time: number; }
export interface GeophysicsIgrfRequest { model: 'IGRF14'; points: GeophysicsIgrfPoint[]; }
export interface GeophysicsIgrfRemovalOptions { channel: string; model: 'IGRF14'; event_id: string; evidence: string; }
export interface GeophysicsIgrfField { id: string; north: number; east: number; down: number; horizontal: number; total: number; declination: number | null; inclination: number; }
export interface GeophysicsIgrfModel {
  model: 'IGRF14'; backend: 'ppigrf'; backend_version: '2.1.0'; coefficients: 'IGRF14.shc'; coefficients_sha256: string;
  height_datum: 'WGS84_ellipsoid'; height_units: 'm'; z_positive: 'up'; time_units: 'UTC Unix seconds';
  time_interpolation: 'decimal-year'; component_frame: 'geodetic north/east/down'; field_units: 'nT'; angle_units: 'degrees';
}
export interface GeophysicsIgrfReport {
  schema: 'baselode.geophysics.igrf'; version: 1; state: 'ok' | 'needs_input' | 'rejected' | 'failed';
  issues: Array<{ code: string; message: string }>; fields: GeophysicsIgrfField[]; model: GeophysicsIgrfModel | null;
  diagnostics: Record<string, unknown>; producer: { library: string; version: string; algorithm_version: number }; assumptions: string[];
}
export function describeGeophysicsIgrf(): Record<string, unknown>;
