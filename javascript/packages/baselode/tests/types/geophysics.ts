import {
  GEOPHYSICS_OPERATIONS,
  createGeophysicsRaster,
  combineGeophysicsRasters,
  encodeErs,
  encodeGeoTiff,
  loadGeoTiff,
  readErs,
  geophysicsReduceToPole,
  processGeophysicsRaster,
  type GeophysicsRaster,
} from 'baselode/geophysics';

const raster: GeophysicsRaster = createGeophysicsRaster({ data: [[1, 2], [3, null]], transform: [10, 0, 0, 0, -10, 0] });
const reduced: GeophysicsRaster = geophysicsReduceToPole(raster, { inclination: -55, declination: 1 });
const continued = processGeophysicsRaster(reduced, 'upward_continuation', { height: 100 });
const units: string | null | undefined = continued.metadata.crs_units;
const operations: readonly string[] = GEOPHYSICS_OPERATIONS;

// @ts-expect-error upward continuation needs a height
processGeophysicsRaster(raster, 'upward_continuation', { order: 1 });

void units;
void operations;

combineGeophysicsRasters(raster, raster, 'subtract', { includeProvenance: false });
encodeErs(raster, { includeProvenance: false });
encodeGeoTiff(raster, { includeProvenance: false });
const producerVersion: string | undefined = raster.metadata.baselode_provenance?.producer.version;
void producerVersion;

void loadGeoTiff(new ArrayBuffer(0), { includeProvenance: false });
readErs('', new ArrayBuffer(0), { includeProvenance: false });

import { listGeophysicsOperations, describeGeophysicsOperation, geophysicsWorkflowSchema, magneticGridRecipe, validateGeophysicsWorkflow, runGeophysicsWorkflow } from 'baselode/geophysics';
const recipe = magneticGridRecipe();
const contractVersion: 1 = describeGeophysicsOperation('upward_continuation').version;
const catalogueSize: number = listGeophysicsOperations().length;
const report = runGeophysicsWorkflow(recipe, { magnetic: raster });
const artifact: GeophysicsRaster | undefined = report.artifacts.edges;
void artifact; void contractVersion; void catalogueSize;
void validateGeophysicsWorkflow(recipe, { magnetic: raster });
void geophysicsWorkflowSchema();

import { createGeophysicsObservations, geophysicsObservationSchema, describeGeophysicsObservationQc, qcGeophysicsObservations, type GeophysicsObservations } from 'baselode/geophysics';
const observations: GeophysicsObservations = createGeophysicsObservations({ records: [{ id: 'a', x: 1, y: 2, values: { mag: 10 } }], channels: { mag: { field_type: 'magnetic_total_field', units: 'nT' } }, crs_units: 'm' });
const surveyReport = qcGeophysicsObservations(observations, { max_speed: 20, spike_thresholds: { mag: 5 } });
const normalizedReading: number | null | undefined = observations.records[0]?.values.mag;
void surveyReport; void normalizedReading; void geophysicsObservationSchema(); void describeGeophysicsObservationQc();
// @ts-expect-error speed threshold must be numeric
qcGeophysicsObservations(observations, { max_speed: '20' });

import { describeGeophysicsGridding, gridGeophysicsObservations, crossValidateGeophysicsGridding, type GeophysicsInterpolationOptions } from 'baselode/geophysics';
const interpolationOptions: GeophysicsInterpolationOptions = { channels: ['mag'], radius: 50, duplicate_policy: 'mean', elevation_policy: 'ignore' };
const griddedObservations = gridGeophysicsObservations(observations, { ...interpolationOptions, bounds: [0, 0, 100, 100], shape: [10, 10] });
const gridValidation = crossValidateGeophysicsGridding(observations, interpolationOptions, { by: 'line', buffer_distance: 10 });
void griddedObservations; void gridValidation; void describeGeophysicsGridding();
// @ts-expect-error block validation requires an explicit origin
crossValidateGeophysicsGridding(observations, interpolationOptions, { by: 'block', block_size: [10, 10] });
// @ts-expect-error elevation treatment must be explicitly acknowledged
const incompleteInterpolation: GeophysicsInterpolationOptions = { channels: ['mag'], radius: 50, duplicate_policy: 'mean' };
void incompleteInterpolation;

import { alignGeophysicsRaster, matchGeophysicsRaster, describeGeophysicsAlignment, type GeophysicsAlignmentTarget } from 'baselode/geophysics';
const target: GeophysicsAlignmentTarget = { shape: [2, 2], transform: [10, 0, 0, 0, -10, 0], crs: 'EPSG:28350' };
const aligned = alignGeophysicsRaster(raster, target, { method: 'bilinear', value_kind: 'continuous' });
const support: GeophysicsRaster | undefined = aligned.artifacts.support;
void support; void describeGeophysicsAlignment();
void matchGeophysicsRaster(raster, raster, { method: 'nearest', value_kind: 'categorical' });
// @ts-expect-error categorical values cannot use bilinear sampling
alignGeophysicsRaster(raster, target, { method: 'bilinear', value_kind: 'categorical' });
// @ts-expect-error explicit sampling method is required
alignGeophysicsRaster(raster, target, { value_kind: 'continuous' });

import { describeGeophysicsEquivalentSources, type GeophysicsEquivalentSourceRequest, type GeophysicsEquivalentSourceReport } from 'baselode/geophysics';
const equivalentOptions = { channel: 'mag', depth: 100, damping: null, radius: 1000, duplicate_policy: 'mean' as const };
const equivalentRequest: GeophysicsEquivalentSourceRequest = { schema: 'baselode.geophysics.equivalent_source_request', version: 1, operation: 'grid', observations, options: { ...equivalentOptions, bounds: [0, 0, 100, 100], shape: [10, 10], target_height: 300 } };
const equivalentValidation: GeophysicsEquivalentSourceRequest = { schema: 'baselode.geophysics.equivalent_source_request', version: 1, operation: 'cross_validate', observations, options: equivalentOptions, validation: { by: 'line' } };
void equivalentRequest; void equivalentValidation; void describeGeophysicsEquivalentSources();
const readEquivalentState = (result: GeophysicsEquivalentSourceReport) => result.state;
void readEquivalentState;
// @ts-expect-error common-surface height is mandatory for a grid request
const missingEquivalentHeight: GeophysicsEquivalentSourceRequest = { schema: 'baselode.geophysics.equivalent_source_request', version: 1, operation: 'grid', observations, options: equivalentOptions };
void missingEquivalentHeight;

import { describeGeophysicsCorrections, inspectGeophysicsCorrections, declareGeophysicsCorrections, correctGeophysicsMagneticBase, type GeophysicsCorrectionReport } from 'baselode/geophysics';
const inspectedCorrections: Promise<GeophysicsCorrectionReport> = inspectGeophysicsCorrections(observations);
const declaredCorrections = declareGeophysicsCorrections(observations, [{ id: 'source', correction: 'magnetic_diurnal', channels: ['mag'], state: 'unapplied', evidence: 'contractor history checked' }]);
const baseCorrectionOptions = { channel: 'mag', base_channel: 'base', reference: 50000, max_gap: 30, event_id: 'diurnal-1', evidence: 'base QC checked', clock_policy: 'synchronized' as const };
const correctedMagnetic = correctGeophysicsMagneticBase(observations, observations, baseCorrectionOptions);
void inspectedCorrections; void declaredCorrections; void correctedMagnetic; void describeGeophysicsCorrections();
// @ts-expect-error explicit synchronized-clock policy is required
correctGeophysicsMagneticBase(observations, observations, { channel: 'mag', base_channel: 'base', reference: 50000, max_gap: 30, event_id: 'diurnal-1', evidence: 'checked' });
// @ts-expect-error unregistered correction identifiers are not executable aliases
declareGeophysicsCorrections(observations, [{ id: 'bad', correction: 'custom', channels: ['mag'], state: 'unapplied', evidence: 'checked' }]);

import { describeGeophysicsIgrf, type GeophysicsIgrfRequest, type GeophysicsIgrfReport, type GeophysicsCorrectionEvent } from 'baselode/geophysics';
const igrfRequest: GeophysicsIgrfRequest = { model: 'IGRF14', points: [{ id: 'station', longitude: 115, latitude: -32, height_m: 100, time: 1735689600 }] };
void igrfRequest; void describeGeophysicsIgrf();
declare const igrfReport: GeophysicsIgrfReport;
const northField: number | undefined = igrfReport.fields[0]?.north;
void northField;
declare const correctionEvent: GeophysicsCorrectionEvent;
if (correctionEvent.kind === 'application' && correctionEvent.correction === 'magnetic_igrf') {
  const model: 'IGRF14' = correctionEvent.model.model;
  const interpolation: 'decimal-year' = correctionEvent.model.time_interpolation;
  void model; void interpolation;
}
// @ts-expect-error ellipsoidal height is required
const ambiguousHeight: GeophysicsIgrfRequest = { model: 'IGRF14', points: [{ id: 'station', longitude: 115, latitude: -32, time: 1735689600 }] };
// @ts-expect-error no implicit latest-model selection
const implicitIgrf: GeophysicsIgrfRequest = { model: 'latest', points: [] };
void ambiguousHeight; void implicitIgrf;

import { correctGeophysicsMagneticLag, type GeophysicsMagneticLagReport } from 'baselode/geophysics';
const lagReport: Promise<GeophysicsMagneticLagReport> = correctGeophysicsMagneticLag(observations, { channel: 'mag', lag_seconds: .5, max_gap: 1, unsupported_policy: 'mask', event_id: 'lag-1', evidence: 'calibration', clock_policy: 'synchronized' });
void lagReport;
if (correctionEvent.kind === 'application' && correctionEvent.correction === 'magnetic_lag') {
  const original: number | undefined = correctionEvent.masked_records[0]?.value;
  void original;
}
// @ts-expect-error boundary handling must be explicit
correctGeophysicsMagneticLag(observations, { channel: 'mag', lag_seconds: .5, max_gap: 1, event_id: 'lag-1', evidence: 'calibration', clock_policy: 'synchronized' });
// @ts-expect-error no unbounded extrapolation policy
correctGeophysicsMagneticLag(observations, { channel: 'mag', lag_seconds: .5, max_gap: 1, unsupported_policy: 'extrapolate', event_id: 'lag-1', evidence: 'calibration', clock_policy: 'synchronized' });

import { correctGeophysicsMagneticHeading, type GeophysicsMagneticHeadingReport } from 'baselode/geophysics';
const headingReport: Promise<GeophysicsMagneticHeadingReport> = correctGeophysicsMagneticHeading(observations, { channel: 'mag', heading_key: 'sensor_heading', heading_reference: 'true_north', calibration_id: 'cal-1', calibration: [{ heading_degrees: 0, bias_nT: 2 }, { heading_degrees: 180, bias_nT: -2 }], max_heading_gap: 180, bias_convention: 'observed_minus_reference', event_id: 'heading-1', evidence: 'calibration checked' });
void headingReport;
if (correctionEvent.kind === 'application' && correctionEvent.correction === 'magnetic_heading') {
  const boundHeadings: string = correctionEvent.heading_binding;
  void boundHeadings;
}
// @ts-expect-error explicit observed-minus-reference bias convention is required
correctGeophysicsMagneticHeading(observations, { channel: 'mag', heading_key: 'sensor_heading', heading_reference: 'true_north', calibration_id: 'cal-1', calibration: [], max_heading_gap: 180, event_id: 'heading-1', evidence: 'calibration' });

import { describeGeophysicsCrossovers, analyzeGeophysicsCrossovers, levelGeophysicsMagneticLines, type GeophysicsCrossoverReport, type GeophysicsMagneticLevellingReport } from 'baselode/geophysics';
const crossingOptions = { channel: 'mag', max_segment_length: 100, min_crossing_angle: 30, intersection_tolerance: 1e-6, elevation_policy: 'ignore' as const, max_height_difference: null };
const crossingReport: Promise<GeophysicsCrossoverReport> = analyzeGeophysicsCrossovers(observations, crossingOptions);
const levelReport: Promise<GeophysicsMagneticLevellingReport> = levelGeophysicsMagneticLines(observations, { ...crossingOptions, reference_lines: ['R'], target_lines: ['A'], min_crossovers: 1, min_reference_lines: 1, max_abs_correction: 10, max_rms_residual: 1, event_id: 'tie-1', evidence: 'checked' });
void crossingReport; void levelReport; void describeGeophysicsCrossovers();
if (correctionEvent.kind === 'application' && correctionEvent.correction === 'magnetic_levelling') {
  const lineBias: number | undefined = correctionEvent.line_offsets[0]?.bias_nT;
  void lineBias;
}
// @ts-expect-error reference/target roles and quality policies must be explicit
levelGeophysicsMagneticLines(observations, crossingOptions);

import { describeGeophysicsReprojection, reprojectGeophysicsObservations, type GeophysicsReprojectionOptions } from 'baselode/geophysics';
const projectionOptions: GeophysicsReprojectionOptions = {target_crs:'EPSG:32750',datum_policy:'backend',event_id:'projection',evidence:'WGS84 checked'};
const projectedObservations: Promise<GeophysicsCorrectionReport> = reprojectGeophysicsObservations(observations,projectionOptions);
void projectedObservations; void describeGeophysicsReprojection();
if (correctionEvent.kind === 'reprojection') {
  const sourceCrs: string = correctionEvent.source.crs;
  const count: number = correctionEvent.transformed_records;
  void sourceCrs; void count;
  // @ts-expect-error coordinate derivations do not change a correction state
  void correctionEvent.state;
}
// @ts-expect-error explicit backend acknowledgement required
reprojectGeophysicsObservations(observations,{target_crs:'EPSG:32750',event_id:'projection',evidence:'checked'});

import { describeGeophysicsObservationWorkflow, magneticObservationRecipe, runGeophysicsObservationWorkflow, validateGeophysicsObservationWorkflow, type GeophysicsObservationWorkflow, type GeophysicsObservationWorkflowReference, type GeophysicsObservationWorkflowResult } from 'baselode/geophysics';
const observationRecipe: GeophysicsObservationWorkflow = magneticObservationRecipe();
const observationResult: Promise<GeophysicsObservationWorkflowResult> = runGeophysicsObservationWorkflow(observationRecipe,{survey:observations});
void observationResult; void validateGeophysicsObservationWorkflow(observationRecipe,{survey:observations}); void describeGeophysicsObservationWorkflow();
// @ts-expect-error output port required for a step reference
const missingPort: GeophysicsObservationWorkflowReference = {step:'level'};
// @ts-expect-error references cannot mix input and step namespaces
const mixedReference: GeophysicsObservationWorkflowReference = {input:'survey',step:'level',output:'observations'};
void missingPort; void mixedReference;

import { describeGeophysicsNormalGravity, type GeophysicsNormalGravityRequest, type GeophysicsNormalGravityRemovalOptions } from 'baselode/geophysics';
const normalRequest: GeophysicsNormalGravityRequest = {model:'WGS84',points:[{id:'station',longitude:117,latitude:-32,height_m:100}]};
const normalOptions: GeophysicsNormalGravityRemovalOptions = {channel:'g',model:'GRS80',reference_policy:'caller_verified',event_id:'normal',evidence:'datum checked'};
void normalRequest; void normalOptions; void describeGeophysicsNormalGravity();
if(correctionEvent.kind==='application'&&correctionEvent.correction==='gravity_normal') {const digest:string=correctionEvent.normal_binding;void digest;}
// @ts-expect-error ellipsoidal height required
const missingNormalHeight: GeophysicsNormalGravityRequest = {model:'WGS84',points:[{id:'station',longitude:117,latitude:-32}]};
void missingNormalHeight;

import { describeGeophysicsGravityTemporal, applyGeophysicsGravityTide, correctGeophysicsGravityDrift, analyzeGeophysicsGravityRepeats, type GeophysicsGravityTideOptions, type GeophysicsGravityDriftOptions } from 'baselode/geophysics';
declare const gravityTideOptions: GeophysicsGravityTideOptions;
declare const gravityDriftOptions: GeophysicsGravityDriftOptions;
void applyGeophysicsGravityTide(observations,gravityTideOptions);void correctGeophysicsGravityDrift(observations,gravityDriftOptions);void analyzeGeophysicsGravityRepeats(observations,{channel:'g'});void describeGeophysicsGravityTemporal();
if(correctionEvent.kind==='application'&&correctionEvent.correction==='gravity_drift'){const datum:string=correctionEvent.model.source_gravity_datum;void datum;}
// @ts-expect-error explicit effect sign is required
const missingGravitySign: GeophysicsGravityTideOptions = {channel:'g',model_id:'t',reference_policy:'caller_verified',clock_policy:'synchronized',event_id:'t',evidence:'checked',effects:[],max_abs_effect_mGal:1};
void missingGravitySign;

import {describeGeophysicsGravityTopography, type GravityPlateOptions, type GravityTerrainOptions} from 'baselode/geophysics';
declare const plateOptions: GravityPlateOptions;
declare const terrainOptions: GravityTerrainOptions;
void plateOptions; void terrainOptions; void describeGeophysicsGravityTopography();
if(correctionEvent.kind==='application'&&correctionEvent.correction==='gravity_terrain'){const digest:string=correctionEvent.topography_binding;void digest;}
// @ts-expect-error density is required
const missingPlateDensity: GravityPlateOptions={channel:'g',reference_height_m:0,height_datum:'WGS84_ellipsoid',reference_policy:'caller_verified',max_abs_correction_mGal:100,event_id:'p',evidence:'checked'};
void missingPlateDensity;

import {describeGeophysicsRadiometrics,stackGeophysicsRadiometricGrids,calculateGeophysicsRadiometricRatios,createGeophysicsRadiometricTernary,type GeophysicsRadiometricRatioOptions,type GeophysicsRadiometricTernaryOptions,type GeophysicsObservationWorkflowOperation} from 'baselode/geophysics';
const radioRatios:GeophysicsRadiometricRatioOptions={potassium_floor:.1,thorium_floor:.5,reference_policy:'caller_verified',evidence:'checked'};
const radioTernary:GeophysicsRadiometricTernaryOptions={k_min:0,k_max:4,u_min:0,u_max:8,th_min:0,th_max:16,gamma:1,reference_policy:'caller_verified',evidence:'checked'};
void calculateGeophysicsRadiometricRatios(raster,radioRatios);void createGeophysicsRadiometricTernary(raster,radioTernary);void describeGeophysicsRadiometrics();void stackGeophysicsRadiometricGrids(raster,raster,raster,{reference_policy:'caller_verified',evidence:'checked'});
const plateWorkflowOperation:GeophysicsObservationWorkflowOperation='apply_bouguer_plate';const terrainWorkflowOperation:GeophysicsObservationWorkflowOperation='correct_gravity_terrain';void plateWorkflowOperation;void terrainWorkflowOperation;
// @ts-expect-error ratio denominator floor is required
const radioMissingFloor:GeophysicsRadiometricRatioOptions={thorium_floor:.5,reference_policy:'caller_verified',evidence:'checked'};
void radioMissingFloor;

// Existing catalogue clients keep the original string units API.
const compatibleLegacyUnitDescription:string=describeGeophysicsOperation('low_pass').outputs.units.toUpperCase();
const radioBandUnits:string[]|undefined=describeGeophysicsOperation('radiometric_ratios').outputs.band_units;
const declaredTransformMarker:boolean|undefined=raster.hasExplicitTransform;
void compatibleLegacyUnitDescription;void radioBandUnits;void declaredTransformMarker;

import {describeGeophysicsMicrolevelling,estimateGeophysicsMagneticMicrolevelling,microlevelGeophysicsMagneticGrid,type GeophysicsMicrolevellingOptions} from 'baselode/geophysics';
const microOptions: GeophysicsMicrolevellingOptions = {flight_azimuth:0,line_spacing:4,along_line_wavelength:64,across_line_wavelength:16,max_abs_correction:5,protected_bounds:[[48,0,80,128]],edge_margin_cells:8,min_training_fraction:.5,reference_policy:'caller_verified',evidence:'verified',geology_policy:'directional_overlap_acknowledged'};
describeGeophysicsMicrolevelling();
const microGrid = createGeophysicsRaster({data:[[1]],transform:[1,0,0,0,-1,1]});
estimateGeophysicsMagneticMicrolevelling(microGrid,microOptions);
microlevelGeophysicsMagneticGrid(microGrid,microOptions);
const microStep: import('baselode/geophysics').GeophysicsWorkflowStep = {id:'noise',operation:'estimate_magnetic_microlevelling',version:1,inputs:['magnetic'],parameters:{...microOptions}};
microStep.parameters.protected_bounds;

import {analyzeGeophysicsGridSpectrum,describeGeophysicsSpectrum,type GeophysicsSpectrumOptions} from 'baselode/geophysics';
const spectrumOptions: GeophysicsSpectrumOptions = {band:1,detrend:'mean',window:'hann_periodic',radial_bins:32,direction_bins:12,missing_policy:'reject'};
const spectrumReport = analyzeGeophysicsGridSpectrum(raster,spectrumOptions);
spectrumReport.radial[0]?.mean_power_density?.toFixed(2);
describeGeophysicsSpectrum();
const spectrumStep: import('baselode/geophysics').GeophysicsObservationWorkflowStep = {id:'spectrum',operation:'analyze_grid_spectrum',version:1,inputs:[{step:'grid',output:'grid'}],parameters:{...spectrumOptions}};
spectrumStep.operation;

import {fitGeophysicsRegionalTrend,describeGeophysicsRegionalTrend,type GeophysicsRegionalOptions} from 'baselode/geophysics';
const regionalOptions: GeophysicsRegionalOptions = {band:1,degree:2,estimator:'huber',exclude_bounds:[],min_training_fraction:.5,max_condition:1e6,domain_policy:'source_footprint',huber_threshold:1,max_iterations:50,convergence_tolerance:1e-9};
const regionalResult = fitGeophysicsRegionalTrend(raster,regionalOptions);
regionalResult.artifacts.residual?.metadata.units;
describeGeophysicsRegionalTrend();
const regionalStep: import('baselode/geophysics').GeophysicsObservationWorkflowStep = {id:'fit',operation:'fit_regional_trend',version:1,inputs:[{step:'grid',output:'grid'}],parameters:{...regionalOptions}};
regionalStep.operation;
// @ts-expect-error LS forbids unused Huber-only controls
const invalidRegionalOptions: GeophysicsRegionalOptions = {band:1,degree:1,estimator:'least_squares',exclude_bounds:[],min_training_fraction:.5,max_condition:1e6,domain_policy:'source_footprint',huber_threshold:1};
void invalidRegionalOptions;

import {describeGeophysicsGravityForward,calculateGeophysicsGravityForward,type GeophysicsGravityForwardRequest,type GeophysicsGravityForwardSource} from 'baselode/geophysics';
const gravitySource: GeophysicsGravityForwardSource = {id:'sphere',kind:'sphere',x_m:0,y_m:0,z_m:-100,radius_m:10,density_contrast_kg_m3:2000};
const forwardRequest: GeophysicsGravityForwardRequest = {schema:'baselode.geophysics.gravity_forward_request',version:1,coordinate_frame:{id:'local',kind:'local_cartesian',axes:'x_y_up',units:'m',height_datum:'local_zero'},sources:[gravitySource],points:[{id:'p',x_m:0,y_m:0,z_m:0}],include_sensitivities:true};
const forwardReport = calculateGeophysicsGravityForward(forwardRequest);
const forwardValue: number | undefined = forwardReport.fields[0]?.g_down;
void forwardValue; describeGeophysicsGravityForward();
// @ts-expect-error sphere mass and density amplitudes are mutually exclusive
const invalidForwardSource: GeophysicsGravityForwardSource = {...gravitySource,mass_contrast_kg:1};
void invalidForwardSource;
// @ts-expect-error explicit calculation frame and sensitivity policy are required
calculateGeophysicsGravityForward({sources:[gravitySource],points:[]});

import {describeGeophysicsMagneticForward,calculateGeophysicsMagneticForward,type GeophysicsMagneticForwardRequest} from 'baselode/geophysics';
const magneticForwardRequest: GeophysicsMagneticForwardRequest = {schema:'baselode.geophysics.magnetic_forward_request',version:1,coordinate_frame:{id:'local',kind:'local_cartesian',axes:'x_y_up',units:'m',height_datum:'local_zero'},sources:[{id:'dipole',kind:'dipole',x_m:0,y_m:0,z_m:-100,moment_x_A_m2:0,moment_y_A_m2:0,moment_z_up_A_m2:1000}],points:[{id:'p',x_m:0,y_m:0,z_m:0}],include_sensitivities:true,min_distance_m:1,background_nT:null};
const magneticForwardReport = calculateGeophysicsMagneticForward(magneticForwardRequest);
const syntheticTmi: number | null | undefined = magneticForwardReport.fields[0]?.tmi_exact;
void syntheticTmi; describeGeophysicsMagneticForward();
// @ts-expect-error required nullable background must still be supplied explicitly
calculateGeophysicsMagneticForward({schema:'baselode.geophysics.magnetic_forward_request',version:1,coordinate_frame:magneticForwardRequest.coordinate_frame,sources:[],points:[],include_sensitivities:false,min_distance_m:1});
// @ts-expect-error exact TMI derivatives are intentionally absent
magneticForwardReport.sensitivities[0].fields[0].tmi_exact;

import {describeGeophysicsGravityPrisms,validateGeophysicsGravityPrisms,type GeophysicsGravityPrismsRequest,type GeophysicsGravityPrismsReport} from 'baselode/geophysics';
const prismRequest: GeophysicsGravityPrismsRequest = {schema:'baselode.geophysics.gravity_prisms_request',version:1,coordinate_frame:forwardRequest.coordinate_frame,sources:[{id:'body',kind:'prism',bounds_m:[-50,50,-50,50,-150,-50],density_contrast_kg_m3:2000}],points:[{id:'p',x_m:0,y_m:0,z_m:0}],include_sensitivities:true};
const prismValidation = validateGeophysicsGravityPrisms(prismRequest);
void prismValidation; describeGeophysicsGravityPrisms();
const usePythonPrismResult = (result: GeophysicsGravityPrismsReport): number | undefined => result.fields[0]?.g_down;
void usePythonPrismResult;
// @ts-expect-error prism bounds require all six scalars
const invalidPrism: GeophysicsGravityPrismsRequest['sources'][0] = {id:'body',kind:'prism',bounds_m:[0,1,0,1],density_contrast_kg_m3:2000};
void invalidPrism;

import {describeGeophysicsMagneticPrisms,validateGeophysicsMagneticPrisms,type GeophysicsMagneticPrismsRequest,type GeophysicsMagneticPrismsReport} from 'baselode/geophysics';
const magneticPrismRequest: GeophysicsMagneticPrismsRequest = {schema:'baselode.geophysics.magnetic_prisms_request',version:1,coordinate_frame:forwardRequest.coordinate_frame,sources:[{id:'body',kind:'prism',bounds_m:[-50,50,-50,50,-150,-50],magnetization_x_A_m:0,magnetization_y_A_m:0,magnetization_z_up_A_m:1}],points:[{id:'p',x_m:0,y_m:0,z_m:0}],include_sensitivities:true,min_distance_m:1,background_nT:null};
const magneticPrismValidation = validateGeophysicsMagneticPrisms(magneticPrismRequest);
void magneticPrismValidation; describeGeophysicsMagneticPrisms();
const useMagneticPrismResult = (r: GeophysicsMagneticPrismsReport): number | null | undefined => r.fields[0]?.tmi_exact;
void useMagneticPrismResult;
// @ts-expect-error all three magnetization components are required
const invalidMagneticPrism: GeophysicsMagneticPrismsRequest['sources'][0] = {id:'body',kind:'prism',bounds_m:[0,1,0,1,0,1],magnetization_z_up_A_m:1};
void invalidMagneticPrism;

import {calculateGeophysicsMisfit,type GeophysicsMisfitRequest} from 'baselode/geophysics';
const misfitContext: GeophysicsMisfitRequest['observed']['context']={quantity:'gravity_g_down',units:'mGal',field_type:'gravity_anomaly',reference_id:'zero',coordinate_frame:forwardRequest.coordinate_frame};
const misfitRequest: GeophysicsMisfitRequest={schema:'baselode.geophysics.misfit_request',version:1,observed:{context:misfitContext,records:[{id:'a',x_m:0,y_m:0,z_m:0,value:1,standard_deviation:1,group_id:null}]},predicted:{context:misfitContext,records:[{id:'a',x_m:0,y_m:0,z_m:0,value:0}]},options:{coverage_policy:'complete',weighting:'standard_deviation',coordinate_tolerance_m:0,residual_convention:'observed_minus_predicted'}};
calculateGeophysicsMisfit(misfitRequest).summary?.statistics.rmse;
// @ts-expect-error uncertainties are explicitly nullable, not silently absent
const badMisfitRecord:GeophysicsMisfitRequest['observed']['records'][0]={id:'a',x_m:0,y_m:0,z_m:0,value:1,group_id:null};
void badMisfitRecord;
