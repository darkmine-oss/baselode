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
  /** False remains authoritative on copies; set true alongside a verified replacement transform. */
  hasExplicitTransform?: boolean;
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
  /** False remains authoritative on copies; set true alongside a verified replacement transform. */
  hasExplicitTransform?: boolean;
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
  parameters: Record<string, number | string | boolean | number[][]>;
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
  outputs: { kind: string; resolution: string; field_type: string; units: string; band_units?: string[] };
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

export type GeophysicsObservationField = 'magnetic_total_field' | 'magnetic_anomaly' | 'gravity_observed' | 'gravity_relative' | 'gravity_anomaly' | 'gravity_disturbance' | 'radiometric' | 'radiometric_counts' | 'other';
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
export type GeophysicsCorrectionEvent = GeophysicsReprojectionEvent | (GeophysicsCorrectionDeclaration & {
  producer: { library: 'baselode'; version: string; algorithm_version: 1 };
  input_binding: string;
  output_binding: string;
} & (
  | { kind: 'declaration' }
  | { kind: 'application'; correction: 'gravity_tide'; state: 'applied'; parameters: GeophysicsGravityTideOptions; temporal_binding: string; affected_records: number }
  | { kind: 'application'; correction: 'gravity_drift'; state: 'applied'; parameters: GeophysicsGravityDriftOptions; model: GeophysicsGravityDriftModel; temporal_binding: string; affected_records: number }
  | { kind: 'application'; correction: 'gravity_bouguer' | 'gravity_terrain'; state: 'applied'; parameters: GravityPlateOptions | GravityTerrainOptions; model: Record<string, unknown>; topography_binding: string; affected_records: number }
  | { kind: 'application'; correction: 'gravity_normal'; state: 'applied'; parameters: GeophysicsNormalGravityRemovalOptions; model: GeophysicsNormalGravityModel; normal_binding: string; affected_records: number }
  | { kind: 'application'; correction: 'magnetic_levelling'; state: 'applied'; parameters: GeophysicsMagneticLevellingOptions; line_offsets: GeophysicsLineOffset[]; levelling_binding: string; affected_records: number }
  | { kind: 'application'; correction: 'magnetic_heading'; state: 'applied'; parameters: GeophysicsMagneticHeadingOptions; heading_binding: string; affected_records: number }
  | { kind: 'application'; correction: 'magnetic_lag'; state: 'applied'; parameters: GeophysicsMagneticLagOptions; masked_records: Array<{ id: string; value: number }>; affected_records: number }
  | { kind: 'application'; correction: 'magnetic_igrf'; state: 'applied'; parameters: GeophysicsIgrfRemovalOptions; model: GeophysicsIgrfModel; affected_records: number }
  | { kind: 'application'; correction: 'magnetic_diurnal'; state: 'applied'; parameters: GeophysicsMagneticBaseOptions; base_binding: string; base_station_id: string; affected_records: number }
));
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
  operation: 'inspect' | 'declare' | 'magnetic_base' | 'reproject_observations';
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

/** JSON response from Python remove_igrf; no JavaScript numerical execution. */
export type GeophysicsIgrfRemovalReport = Omit<GeophysicsCorrectionReport, 'operation' | 'state' | 'proposals'> & {
  operation: 'remove_igrf'; state: 'ok' | 'needs_input' | 'rejected' | 'failed';
  proposals: Array<{ id: string; reference_total: number; corrected_value: number }>;
};

/** Positive lag advances delayed values: corrected(t)=input(t+lag_seconds). */
export interface GeophysicsMagneticLagOptions {
  channel: string; lag_seconds: number; max_gap: number; unsupported_policy: 'reject' | 'mask';
  event_id: string; evidence: string; clock_policy: 'synchronized';
}
export interface GeophysicsMagneticLagProposal {
  id: string; line_id: string; segment: number; time: number; source_time: number;
  original: number; corrected: number | null; source_ids: string[]; weight: number | null;
  supported: boolean; reason: 'outside_segment' | 'missing_source_reading' | 'excessive_gap' | null;
}
export type GeophysicsMagneticLagReport = Omit<GeophysicsCorrectionReport, 'operation' | 'proposals'> & {
  operation: 'magnetic_lag'; proposals: GeophysicsMagneticLagProposal[];
};
/** Native async Web Crypto ledger binding. No navigation geometry or timestamps are shifted. */
export function correctGeophysicsMagneticLag(payload: unknown, options: GeophysicsMagneticLagOptions): Promise<GeophysicsMagneticLagReport>;

export interface GeophysicsHeadingCalibrationNode { heading_degrees: number; bias_nT: number; }
export interface GeophysicsMagneticHeadingOptions {
  channel: string; heading_key: string; heading_reference: 'true_north' | 'magnetic_north' | 'grid_north';
  calibration_id: string; calibration: GeophysicsHeadingCalibrationNode[]; max_heading_gap: number;
  bias_convention: 'observed_minus_reference'; event_id: string; evidence: string;
}
export interface GeophysicsMagneticHeadingProposal {
  id: string; heading_degrees: number | null; original: number; bias_nT: number | null; corrected: number | null;
  calibration_headings: number[]; angular_gap: number | null; weight: number | null; supported: boolean;
  reason: 'missing_heading' | 'excessive_heading_gap' | null;
}
export type GeophysicsMagneticHeadingReport = Omit<GeophysicsCorrectionReport, 'operation' | 'proposals'> & {
  operation: 'magnetic_heading'; proposals: GeophysicsMagneticHeadingProposal[];
};
/** Apply supplied scalar heading bias; native async Web Crypto validates heading/calibration and data bindings. */
export function correctGeophysicsMagneticHeading(payload: unknown, options: GeophysicsMagneticHeadingOptions): Promise<GeophysicsMagneticHeadingReport>;

export interface GeophysicsCrossoverOptions {
  channel: string; max_segment_length: number; min_crossing_angle: number; intersection_tolerance: number;
  elevation_policy: 'ignore' | 'limit'; max_height_difference: number | null;
}
export interface GeophysicsMagneticLevellingOptions extends GeophysicsCrossoverOptions {
  reference_lines: string[]; target_lines: string[]; min_crossovers: number; min_reference_lines: number;
  max_abs_correction: number; max_rms_residual: number; event_id: string; evidence: string;
}
export interface GeophysicsLineOffset { line_id: string; bias_nT: number; }
export interface GeophysicsCrossover {
  id: string; line_a: string; line_b: string; x: number; y: number;
  segment_a: [string, string]; segment_b: [string, string]; fraction_a: number; fraction_b: number; angle_degrees: number;
  value_a: number | null; value_b: number | null; height_a: number | null; height_b: number | null;
  height_difference: number | null; difference: number | null; eligible: boolean;
  reason: 'missing_reading' | 'shallow_angle' | 'missing_height' | 'height_difference' | null;
  used_for_fit?: boolean; difference_after?: number | null;
}
export interface GeophysicsCrossoverReport {
  schema: 'baselode.geophysics.crossovers'; version: 1; operation: 'analyze'; state: 'ok' | 'needs_input' | 'rejected';
  issues: Array<{code: string; message: string}>; parameters: Record<string, unknown>; crossovers: GeophysicsCrossover[];
  diagnostics: Record<string, unknown>; summary: Record<string, unknown>; units: {xy?: string; height?: string | null; field?: string};
  observation_binding: string | null; producer: {library: string; version: string; algorithm_version: number}; assumptions: string[];
}
export interface GeophysicsLevellingProposal {
  line_id: string; bias_nT: number | null; crossovers: number; reference_lines: string[];
  rms_before: number | null; rms_after: number | null; supported: boolean;
  reason: 'insufficient_crossovers' | 'excessive_correction' | 'excessive_residual' | null;
}
export type GeophysicsMagneticLevellingReport = Omit<GeophysicsCorrectionReport, 'operation' | 'proposals'> & {
  operation: 'magnetic_levelling'; proposals: GeophysicsLevellingProposal[]; crossovers: GeophysicsCrossover[];
};
export function describeGeophysicsCrossovers(): Record<string, unknown>;
export function analyzeGeophysicsCrossovers(payload: unknown, options: GeophysicsCrossoverOptions): Promise<GeophysicsCrossoverReport>;
export function levelGeophysicsMagneticLines(payload: unknown, options: GeophysicsMagneticLevellingOptions): Promise<GeophysicsMagneticLevellingReport>;

/** WGS84 geographic/UTM only. See discoverable descriptor for zone limits. */
export interface GeophysicsReprojectionOptions {
  target_crs: string;
  datum_policy: 'backend';
  event_id: string;
  evidence: string;
}
export interface GeophysicsHorizontalContext {
  crs: string;
  crs_units: 'degree' | 'degrees' | 'm' | 'metre' | 'meter';
}
export interface GeophysicsReprojectionEvent {
  id: string;
  kind: 'reprojection';
  evidence: string;
  producer: { library: 'baselode'; version: string; algorithm_version: 1 };
  input_binding: string;
  output_binding: string;
  parameters: GeophysicsReprojectionOptions;
  source: GeophysicsHorizontalContext;
  target: GeophysicsHorizontalContext;
  backend: { name: 'identity' | 'pyproj' | 'proj4'; version: string; proj_version: string | null };
  transformed_records: number;
  transform_binding: string;
}
export function describeGeophysicsReprojection(): Record<string, unknown>;
/** Native asynchronous Web Crypto; inputs unchanged, failures return no output. */
export function reprojectGeophysicsObservations(payload: unknown, options: GeophysicsReprojectionOptions): Promise<GeophysicsCorrectionReport>;

export type GeophysicsObservationWorkflowReference = { input: string; step?: never; output?: never } | { step: string; output: string; input?: never };
export type GeophysicsObservationWorkflowOperation = 'fit_regional_trend' | 'analyze_grid_spectrum' | 'apply_bouguer_plate' | 'correct_gravity_terrain' | 'apply_gravity_tide' | 'correct_gravity_drift' | 'analyze_gravity_repeats' | 'remove_normal_gravity' | 'qc_observations' | 'inspect_corrections' | 'declare_corrections' | 'correct_magnetic_base' | 'remove_igrf' | 'correct_magnetic_lag' | 'correct_magnetic_heading' | 'reproject_observations' | 'analyze_crossovers' | 'level_magnetic_lines' | 'grid_observations' | 'raster_low_pass' | 'raster_high_pass' | 'raster_band_pass' | 'raster_vertical_derivative' | 'raster_horizontal_derivative' | 'raster_total_horizontal_derivative' | 'raster_tilt_derivative' | 'raster_analytic_signal' | 'raster_upward_continuation' | 'raster_reduce_to_pole' | 'raster_combine';
export interface GeophysicsObservationWorkflowStep {
  id: string;
  operation: GeophysicsObservationWorkflowOperation;
  version: 1;
  inputs: GeophysicsObservationWorkflowReference[];
  parameters: Record<string, unknown>;
}
export interface GeophysicsObservationWorkflow {
  schema: 'baselode.geophysics.observation_workflow';
  version: 1;
  steps: GeophysicsObservationWorkflowStep[];
  outputs: Record<string, GeophysicsObservationWorkflowReference>;
}
export interface GeophysicsObservationWorkflowResult {
  schema: 'baselode.geophysics.observation_workflow_result';
  version: 1;
  state: 'ok' | 'needs_input' | 'rejected' | 'failed';
  issues: Array<{code: string; path: string; message: string}>;
  workflow: GeophysicsObservationWorkflow | null;
  plan: GeophysicsObservationWorkflowStep[];
  completed_steps: string[];
  /** Native observation, raster or report ports; names/types come from the descriptor. */
  artifacts: Record<string, GeophysicsObservations | GeophysicsRaster | Record<string, unknown>>;
  step_reports: Record<string, Record<string, unknown>>;
  input_bindings: Record<string, string>;
  resource_estimate: Record<string, unknown>;
  resource_usage?: Record<string, unknown>;
  producer: {library: string; version: string; algorithm_version: number};
}
export function describeGeophysicsObservationWorkflow(): Record<string, unknown>;
export function magneticObservationRecipe(): GeophysicsObservationWorkflow;
/** Structural only; each native operation checks scientific values/context at execution. */
export function validateGeophysicsObservationWorkflow(workflow: unknown, inputs: Record<string, unknown>): Promise<GeophysicsObservationWorkflowResult>;
/** Atomic full-resolution outputs. IGRF workflows require Python execution. */
export function runGeophysicsObservationWorkflow(workflow: unknown, inputs: Record<string, unknown>): Promise<GeophysicsObservationWorkflowResult>;

export interface GeophysicsNormalGravityPoint { id: string; longitude: number; latitude: number; height_m: number }
export interface GeophysicsNormalGravityRequest { model: 'WGS84' | 'GRS80'; height_policy?: 'external_only' | 'analytic_continuation'; points: GeophysicsNormalGravityPoint[] }
export interface GeophysicsNormalGravityModel {
  model: 'WGS84' | 'GRS80'; backend: 'boule'; backend_version: '0.6.0';
  algorithm: 'external_normal_gravity_full_gradient'; coordinate_system: 'geodetic'; units: 'mGal';
  semimajor_axis: number; flattening: number; geocentric_grav_const: number; angular_velocity: number;
}
export interface GeophysicsNormalGravityRemovalOptions {
  height_policy?: 'external_only' | 'analytic_continuation';
  channel: string; model: 'WGS84' | 'GRS80'; reference_policy: 'caller_verified'; event_id: string; evidence: string;
}
export interface GeophysicsNormalGravityReport {
  schema: 'baselode.geophysics.normal_gravity'; version: 1;
  state: 'ok' | 'needs_input' | 'rejected' | 'failed'; issues: Array<{code: string; message: string}>;
  model: GeophysicsNormalGravityModel | null;
  fields: Array<{id: string; normal_gravity: number; height_sensitivity_mGal_per_m: number; ellipsoidal_u_component_mGal: number; ellipsoidal_beta_component_mGal: number; height_extrapolated: boolean}>;
  producer: {library: string; version: string; algorithm_version: number}; assumptions: string[];
}
/** Numerical execution requires Python baselode[gravity]. Ledger replay is native. */
export function describeGeophysicsNormalGravity(): Record<string, unknown>;

export interface GeophysicsGravityTemporalOptions {
  channel: string; model_id: string; reference_policy: 'caller_verified'; clock_policy: 'synchronized'; event_id: string; evidence: string;
}
export interface GeophysicsGravityTideOptions extends GeophysicsGravityTemporalOptions {
  effects: Array<{record_id: string; effect_mGal: number}>;
  effect_convention: 'observed_minus_reference'; max_abs_effect_mGal: number;
}
export interface GeophysicsGravityDriftOptions extends GeophysicsGravityTemporalOptions {
  controls: Array<{record_id: string; reference_mGal: number}>;
  target_gravity_datum: string; max_gap_seconds: number; max_abs_correction_mGal: number; max_drift_rate_mGal_per_s: number;
}
export interface GeophysicsGravityDriftModel {
  algorithm: 'piecewise_linear_absolute_ties_v1'; source_gravity_datum: string; input_field_type: 'gravity_relative' | 'gravity_observed';
  ties: Array<{record_id: string; station_id: string; time: number; original_mGal: number; reference_mGal: number; bias_mGal: number}>;
}
export interface GeophysicsGravityTemporalReport extends Omit<GeophysicsCorrectionReport,'operation' | 'proposals'> {
  operation: 'apply_gravity_tide' | 'correct_gravity_drift' | 'analyze_gravity_repeats';
  proposals: Array<Record<string, unknown>>;
}
export function describeGeophysicsGravityTemporal(): Record<string, unknown>;
export function applyGeophysicsGravityTide(payload: unknown, options: GeophysicsGravityTideOptions): Promise<GeophysicsGravityTemporalReport>;
export function correctGeophysicsGravityDrift(payload: unknown, options: GeophysicsGravityDriftOptions): Promise<GeophysicsGravityTemporalReport>;
export function analyzeGeophysicsGravityRepeats(payload: unknown, options: {channel: string}): Promise<GeophysicsGravityTemporalReport>;

/** Explicit-density land plate/finite-zone terrain operations execute in Python. */
export interface GravityPlateOptions {
  channel: string; density_kg_m3: number; reference_height_m: number;
  height_datum: string; reference_policy: 'caller_verified';
  max_abs_correction_mGal: number; event_id: string; evidence: string;
}
export interface GravityTerrainDem {
  id: string; crs: string | null; crs_units: 'm'; frame_id: string | null;
  height_datum: string; bounds: [number, number, number, number]; heights: number[][];
}
export interface GravityTerrainOptions extends GravityPlateOptions {
  dem: GravityTerrainDem; outside_dem_policy: 'flat_at_station_height';
  min_edge_distance_m: number; ground_tolerance_m: number;
}
export function describeGeophysicsGravityTopography(): Record<string, any>;

/** Context asserts already corrected equivalent concentrations; not raw counts. */
export interface GeophysicsRadiometricContext {
  state: 'corrected_concentration'; reference_height_m: number; height_datum: string;
  calibration_ids: [string,string,string];
}
export interface GeophysicsRadiometricVerification {
  reference_policy: 'caller_verified'; evidence: string;
}
export interface GeophysicsRadiometricRatioOptions extends GeophysicsRadiometricVerification {
  potassium_floor: number; thorium_floor: number; negative_policy?: 'mask';
}
export interface GeophysicsRadiometricTernaryOptions extends GeophysicsRadiometricVerification {
  k_min: number; k_max: number; u_min: number; u_max: number; th_min: number; th_max: number;
  gamma: number; negative_policy?: 'mask';
}
export function describeGeophysicsRadiometrics(): Record<string, any>;
export function stackGeophysicsRadiometricGrids(potassium: GeophysicsRasterInput, uranium: GeophysicsRasterInput, thorium: GeophysicsRasterInput, options: GeophysicsRadiometricVerification): GeophysicsRaster;
export function calculateGeophysicsRadiometricRatios(raster: GeophysicsRasterInput, options: GeophysicsRadiometricRatioOptions): GeophysicsRaster;
export function createGeophysicsRadiometricTernary(raster: GeophysicsRasterInput, options: GeophysicsRadiometricTernaryOptions): GeophysicsRaster;

/** Explicit original-grid residual striping controls; distances are CRS units. */
export interface GeophysicsMicrolevellingOptions {
  flight_azimuth: number; line_spacing: number;
  along_line_wavelength: number; across_line_wavelength: number;
  max_abs_correction: number; protected_bounds: Array<[number,number,number,number]>;
  edge_margin_cells: number; min_training_fraction: number;
  reference_policy: 'caller_verified'; evidence: string;
  geology_policy: 'directional_overlap_acknowledged';
}
export function describeGeophysicsMicrolevelling(): Record<string, any>;
export function estimateGeophysicsMagneticMicrolevelling(raster: GeophysicsRasterInput, options: GeophysicsMicrolevellingOptions): GeophysicsRaster;
export function microlevelGeophysicsMagneticGrid(raster: GeophysicsRasterInput, options: GeophysicsMicrolevellingOptions): GeophysicsRaster;

export interface GeophysicsSpectrumOptions {
  band: number; detrend: 'none' | 'mean' | 'plane'; window: 'boxcar' | 'hann_periodic';
  radial_bins: number; direction_bins: number; missing_policy: 'reject';
}
export interface GeophysicsSpectrumBin {count: number; power_sum: number; mean_power_density: number | null}
export interface GeophysicsSpectrumReport {
  schema: 'baselode.geophysics.spectrum_result'; version: 1; model: Record<string,string>;
  state: 'ok' | 'needs_input' | 'rejected' | 'failed'; issues: Array<{code: string; message: string}>;
  radial: Array<GeophysicsSpectrumBin & {frequency_low: number; frequency_high: number; wavelength_low: number; wavelength_high: number | null}>;
  directional: Array<GeophysicsSpectrumBin & {azimuth_low: number; azimuth_high: number}>;
  parameters?: GeophysicsSpectrumOptions; source?: Record<string, unknown>;
  units?: {source: string; power: string; density: string; frequency: string; wavelength: string};
  diagnostics?: Record<string, any>; metadata?: GeophysicsRasterMetadata;
  producer: Record<string, string | number>; assumptions: string[];
}
export function describeGeophysicsSpectrum(): Record<string, any>;
export function analyzeGeophysicsGridSpectrum(raster: GeophysicsRasterInput, options: GeophysicsSpectrumOptions): GeophysicsSpectrumReport;

export interface GeophysicsRegionalBaseOptions {
  band: number; degree: 0 | 1 | 2; exclude_bounds: Array<[number,number,number,number]>;
  min_training_fraction: number; max_condition: number; domain_policy: 'source_footprint';
}
export type GeophysicsRegionalOptions = GeophysicsRegionalBaseOptions & (
  {estimator: 'least_squares'; huber_threshold?: never; max_iterations?: never; convergence_tolerance?: never}
  | {estimator: 'huber'; huber_threshold: number; max_iterations: number; convergence_tolerance: number}
);
export interface GeophysicsRegionalReport {
  schema: 'baselode.geophysics.regional_result'; version: 1;
  state: 'ok' | 'needs_input' | 'rejected' | 'failed'; issues: Array<{code: string; message: string}>;
  artifacts: Partial<Record<'regional' | 'residual' | 'training_mask',GeophysicsRaster>>;
  parameters?: GeophysicsRegionalOptions; model?: Record<string, any>;
  diagnostics: Record<string, any>; producer: Record<string, string | number>; assumptions: string[];
}
export function describeGeophysicsRegionalTrend(): Record<string, any>;
export function fitGeophysicsRegionalTrend(raster: GeophysicsRasterInput, options: GeophysicsRegionalOptions): GeophysicsRegionalReport;

/** Shared local metre coordinates. Upstream projection/datum transformations are caller responsibilities. */
export interface GeophysicsGravityForwardPoint {id: string; x_m: number; y_m: number; z_m: number}
export type GeophysicsGravityForwardSource = GeophysicsGravityForwardPoint & (
  {kind: 'point_mass'; mass_contrast_kg: number; radius_m?: never; density_contrast_kg_m3?: never}
  | {kind: 'sphere'; radius_m: number; density_contrast_kg_m3: number; mass_contrast_kg?: never}
);
export interface GeophysicsGravityForwardRequest {
  schema: 'baselode.geophysics.gravity_forward_request'; version: 1;
  coordinate_frame: {id: string; kind: 'local_cartesian'; axes: 'x_y_up'; units: 'm'; height_datum: string};
  sources: GeophysicsGravityForwardSource[]; points: GeophysicsGravityForwardPoint[];
  include_sensitivities: boolean; point_mass_min_distance_m?: number; metadata?: Record<string, unknown>;
}
/** Values use the enclosing field_units; sensitivity fields have derivative units. */
export interface GeophysicsGravityForwardField {id: string; gx: number; gy: number; gz_up: number; g_down: number; potential: number}
export type GeophysicsGravityForwardUnits = Record<Exclude<keyof GeophysicsGravityForwardField,'id'>,string>;
export interface GeophysicsGravityForwardSensitivity {
  source_id: string; parameter: 'mass_contrast_kg' | 'density_contrast_kg_m3'; parameter_units: 'kg' | 'kg/m^3';
  field_units: GeophysicsGravityForwardUnits; fields: GeophysicsGravityForwardField[];
}
export interface GeophysicsGravityForwardReport {
  schema: 'baselode.geophysics.gravity_forward_result'; version: 1;
  state: 'ok' | 'needs_input' | 'rejected' | 'failed'; issues: Array<{code: string; message: string}>;
  model: Record<string, string | number>; request: GeophysicsGravityForwardRequest | null;
  fields: GeophysicsGravityForwardField[]; sensitivities: GeophysicsGravityForwardSensitivity[];
  field_units: GeophysicsGravityForwardUnits; diagnostics: Record<string, number | boolean>;
  producer: Record<string, string | number>; assumptions: string[];
}
export function describeGeophysicsGravityForward(): Record<string, any>;
export function calculateGeophysicsGravityForward(request: GeophysicsGravityForwardRequest): GeophysicsGravityForwardReport;

export interface GeophysicsMagneticForwardPoint {id: string; x_m: number; y_m: number; z_m: number}
export interface GeophysicsMagneticForwardSource extends GeophysicsMagneticForwardPoint {
  kind: 'dipole'; moment_x_A_m2: number; moment_y_A_m2: number; moment_z_up_A_m2: number;
}
export interface GeophysicsMagneticForwardRequest {
  schema: 'baselode.geophysics.magnetic_forward_request'; version: 1;
  coordinate_frame: {id: string; kind: 'local_cartesian'; axes: 'x_y_up'; units: 'm'; height_datum: string};
  sources: GeophysicsMagneticForwardSource[]; points: GeophysicsMagneticForwardPoint[];
  include_sensitivities: boolean; min_distance_m: number;
  background_nT: {x: number; y: number; z_up: number} | null;
  metadata?: Record<string, unknown>;
}
export interface GeophysicsMagneticForwardDerivativeField {
  id: string; bx: number; by: number; bz_up: number; b_down: number; tmi_linear: number | null;
}
export interface GeophysicsMagneticForwardField extends GeophysicsMagneticForwardDerivativeField {
  tmi_exact: number | null; linearization_difference: number | null;
}
export interface GeophysicsMagneticForwardSensitivity {
  source_id: string; parameter: 'moment_x_A_m2' | 'moment_y_A_m2' | 'moment_z_up_A_m2'; parameter_units: 'A*m^2';
  field_units: Record<Exclude<keyof GeophysicsMagneticForwardDerivativeField,'id'>,string>;
  fields: GeophysicsMagneticForwardDerivativeField[];
}
export interface GeophysicsMagneticForwardReport {
  schema: 'baselode.geophysics.magnetic_forward_result'; version: 1;
  state: 'ok' | 'needs_input' | 'rejected' | 'failed'; issues: Array<{code: string; message: string}>;
  model: Record<string,string | number>; request: GeophysicsMagneticForwardRequest | null;
  fields: GeophysicsMagneticForwardField[]; sensitivities: GeophysicsMagneticForwardSensitivity[];
  field_units: Record<Exclude<keyof GeophysicsMagneticForwardField,'id'>,string>;
  diagnostics: Record<string,number | boolean | null>; producer: Record<string,string | number>; assumptions: string[];
}
export function describeGeophysicsMagneticForward(): Record<string, any>;
export function calculateGeophysicsMagneticForward(request: GeophysicsMagneticForwardRequest): GeophysicsMagneticForwardReport;

export interface GeophysicsGravityPrismsRequest {
  schema: 'baselode.geophysics.gravity_prisms_request'; version: 1;
  coordinate_frame: {id: string; kind: 'local_cartesian'; axes: 'x_y_up'; units: 'm'; height_datum: string};
  sources: Array<{id: string; kind: 'prism'; bounds_m: [number,number,number,number,number,number]; density_contrast_kg_m3: number}>;
  points: GeophysicsGravityForwardPoint[]; include_sensitivities: boolean; metadata?: Record<string,unknown>;
}
export interface GeophysicsGravityPrismsValidation {
  schema: 'baselode.geophysics.gravity_prisms_validation'; version: 1;
  state: 'ok' | 'needs_input' | 'rejected' | 'failed'; issues: Array<{code: string; message: string}>;
  request: GeophysicsGravityPrismsRequest | null; diagnostics: Record<string,number>; producer: Record<string,string | number>;
}
/** Numerical result is produced by Python baselode[potential-fields], not JavaScript. */
export interface GeophysicsGravityPrismsReport {
  schema: 'baselode.geophysics.gravity_prisms_result'; version: 1;
  state: 'ok' | 'needs_input' | 'rejected' | 'failed'; issues: Array<{code: string; message: string}>;
  request: GeophysicsGravityPrismsRequest | null; model: Record<string,string | number>;
  fields: GeophysicsGravityForwardField[]; sensitivities: Array<{
    source_id: string; parameter: 'density_contrast_kg_m3'; parameter_units: 'kg/m^3';
    field_units: GeophysicsGravityForwardUnits; fields: GeophysicsGravityForwardField[];
  }>;
  field_units: GeophysicsGravityForwardUnits; diagnostics: Record<string,string | number | boolean>;
  producer: Record<string,string | number>; assumptions: string[];
}
export function describeGeophysicsGravityPrisms(): Record<string,any>;
export function validateGeophysicsGravityPrisms(request: GeophysicsGravityPrismsRequest): GeophysicsGravityPrismsValidation;
