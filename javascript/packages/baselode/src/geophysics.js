/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `baselode/geophysics`: geophysics raster loading and processing without
 * React, Plotly or the DOM, so it can run in a Web Worker. The same
 * functions are also exported from the main `baselode` entry.
 */

export {
  createGeophysicsRaster,
  getGeophysicsRasterBand,
  geophysicsRasterRange,
  decimateGeophysicsRaster,
  geophysicsRasterFromBands,
  loadGeoTiff,
} from './data/geophysicsRaster.js';
export { parseErsHeader, ersCrs, readErs, loadErs } from './data/ersLoader.js';
export {
  GEOPHYSICS_SAMPLING_METHODS,
  sampleGeophysicsRaster,
  sampleGeophysicsRows,
  sampleGeophysicsProfile,
  geophysicsProfileStations,
} from './data/geophysicsSampling.js';
// Reprojects points with the same CRS definitions sampling uses.
export { transformPoints as transformCrsPoints } from './extent/crs.js';
export {
  GEOPHYSICS_COMBINE_OPERATIONS,
  cropGeophysicsRaster,
  clipGeophysicsRaster,
  combineGeophysicsRasters,
  fillGeophysicsGaps,
} from './data/geophysicsEditing.js';
export { DEFAULT_ERS_NULL, ersCoordinateSpace, encodeErs, encodeGeoTiff } from './data/geophysicsWriters.js';
export {
  GEOPHYSICS_FILTER_METHODS,
  GEOPHYSICS_OPERATIONS,
  MIN_RTP_INCLINATION,
  geophysicsLowPass,
  geophysicsHighPass,
  geophysicsBandPass,
  geophysicsVerticalDerivative,
  geophysicsHorizontalDerivative,
  geophysicsTotalHorizontalDerivative,
  geophysicsTiltDerivative,
  geophysicsAnalyticSignal,
  geophysicsUpwardContinuation,
  geophysicsReduceToPole,
  processGeophysicsRaster,
} from './data/geophysicsProcessing.js';

export { listGeophysicsOperations, describeGeophysicsOperation, geophysicsWorkflowSchema, magneticGridRecipe, validateGeophysicsWorkflow, runGeophysicsWorkflow } from './data/geophysicsWorkflows.js';

export { createGeophysicsObservations, geophysicsObservationSchema, describeGeophysicsObservationQc, qcGeophysicsObservations } from './data/geophysicsObservations.js';

export { describeGeophysicsGridding, gridGeophysicsObservations, crossValidateGeophysicsGridding } from './data/geophysicsGridding.js';

export { describeGeophysicsAlignment, alignGeophysicsRaster, matchGeophysicsRaster } from './data/geophysicsAlignment.js';
