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
