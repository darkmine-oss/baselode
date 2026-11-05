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
