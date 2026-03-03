# JavaScript Guide

The `baselode` npm package provides data loading, desurveying, 2D strip-log visualisation, and a 3D scene renderer for drillhole and spatial datasets.

**Requires:** Node.js 18+ · peer dependencies: React 18+, Three.js, Plotly, PapaParse

```bash
npm install baselode
```

---

## Peer Dependencies

`baselode` relies on the following peer dependencies, which must be installed in your application:

```bash
npm install react react-dom three three-viewport-gizmo plotly.js-dist-min papaparse
```

---

## Data Model

The JavaScript package exposes the same [Baselode Open Data Model](/guide/python#data-model) constants as the Python package.

```js
import {
  HOLE_ID, LATITUDE, LONGITUDE, ELEVATION,
  AZIMUTH, DIP, FROM, TO, MID, DEPTH,
  EASTING, NORTHING, CRS,
  BASELODE_DATA_MODEL_DRILL_COLLAR,
  BASELODE_DATA_MODEL_DRILL_SURVEY,
  BASELODE_DATA_MODEL_DRILL_ASSAY,
  DEFAULT_COLUMN_MAP
} from 'baselode';
```

### Column standardization

Like the Python loaders, the JS column utilities normalise source field names to the Baselode data model.

```js
import { standardizeColumns, normalizeFieldName } from 'baselode';

const normalised = standardizeColumns(rawRows);
// e.g. "HoleId" → "hole_id", "RL" → "elevation"
```

---

## Data Loading

### Collars, surveys, and assays

```js
import { loadCollars, loadSurveys, loadAssays, assembleDataset } from 'baselode';

// Accepts a CSV text string or an array of row objects
const collars  = loadCollars(collarsText);
const surveys  = loadSurveys(surveysText);
const assays   = loadAssays(assaysText);

const dataset = assembleDataset({ collars, surveys, assays });
```

### Assay-focused loaders

For large assay CSVs with multiple analyte columns:

```js
import { loadAssayFile, loadAssayHole, buildAssayState } from 'baselode';

// Load metadata (hole IDs + column names) without parsing all rows
const meta = await loadAssayMetadata(csvText);

// Load assay data for a specific hole
const holeData = loadAssayHole(csvText, 'HOLE_001');
```

### Structural data

```js
import { parseStructuralPointsCSV, parseStructuralCSV } from 'baselode';

const structuralPoints = parseStructuralPointsCSV(csvText);
// Returns an array of { hole_id, depth, dip, azimuth, alpha, beta, comments }
```

### Block model

```js
import { parseBlockModelCSV, getBlockStats, filterBlocks } from 'baselode';

const blocks = parseBlockModelCSV(csvText);
const stats  = getBlockStats(blocks, 'au_ppm');
const subset = filterBlocks(blocks, { property: 'au_ppm', min: 1.0 });
```

### Unified dataset (assays + structural)

```js
import { parseUnifiedDataset } from 'baselode';

const unified = parseUnifiedDataset(assaysCsvText, structuralCsvText);
// Returns a combined array with a `_source` tag ('assay' | 'structural')
```

---

## Desurveying

### parseSurveyCSV and desurveyTraces

```js
import { parseSurveyCSV, desurveyTraces } from 'baselode';

const surveyTable = parseSurveyCSV(surveyCsvText);
const traces      = desurveyTraces(collarsCsvText, surveyTable);
// traces: Map<holeId, TracePoint[]> where each point has { x, y, z, md, azimuth, dip }
```

### Low-level desurvey methods

```js
import {
  minimumCurvatureDesurvey,
  tangentialDesurvey,
  balancedTangentialDesurvey,
  buildTraces
} from 'baselode';

// minimumCurvatureDesurvey is the industry standard (default)
const trace = minimumCurvatureDesurvey(collar, surveyRows, { step: 1.0 });
```

### Attaching assay positions to 3D traces

```js
import { attachAssayPositions } from 'baselode';

const assaysWithXYZ = attachAssayPositions(assayRows, traces);
// Adds { x, y, z } to each assay row by interpolating the trace
```

---

## Visualization

### Column classification

`baselode` classifies columns automatically for the strip-log renderer:

```js
import { classifyColumns, DISPLAY_NUMERIC, DISPLAY_CATEGORICAL, DISPLAY_COMMENT, DISPLAY_TADPOLE } from 'baselode';

const classification = classifyColumns(rows);
// Returns { colName: DISPLAY_NUMERIC | DISPLAY_CATEGORICAL | DISPLAY_COMMENT | DISPLAY_TADPOLE | DISPLAY_HIDDEN }
```

### 2D strip log (Plotly)

```js
import { buildIntervalPoints, buildPlotConfig, getChartOptions, defaultChartType } from 'baselode';

const points     = buildIntervalPoints(holeRows, 'au_ppm');
const chartType  = defaultChartType('au_ppm', holeRows);
const config     = buildPlotConfig(points, 'au_ppm', { chartType });

Plotly.newPlot('container', config.data, config.layout);
```

### React component — TracePlot

`TracePlot` renders a complete multi-track Plotly strip log for a single hole.

```jsx
import { TracePlot } from 'baselode';

<TracePlot
  rows={holeRows}
  properties={['au_ppm', 'lithology', 'alpha']}
/>
```

### React hook — useDrillholeTraceGrid

For building full drill-hole comparison grids:

```jsx
import { useDrillholeTraceGrid } from 'baselode';

function MyGrid({ holes, selectedProperty }) {
  const { plots } = useDrillholeTraceGrid({ holes, property: selectedProperty });
  return <div className="grid">{plots.map(p => <TracePlot key={p.holeId} {...p} />)}</div>;
}
```

### Color scale

Continuous numeric color scales for 3D viewers and maps:

```js
import { buildEqualRangeColorScale, getEqualRangeColor, ASSAY_COLOR_PALETTE_10 } from 'baselode';

const scale  = buildEqualRangeColorScale(values, ASSAY_COLOR_PALETTE_10);
const colour = getEqualRangeColor(scale, 2.5);  // '#...'
```

---

## 3D Scene

### Baselode3DScene

`Baselode3DScene` is the core Three.js scene manager.  You can use it directly or through the pre-built React wrapper.

```js
import Baselode3DScene from 'baselode/viz/baselode3dScene';

const scene = new Baselode3DScene(canvasElement);
scene.loadTraces(tracesPayload);
scene.loadStructuralDiscs(discPayload);
```

### React component — Baselode3DControls

Drop-in React component with orbit controls, a camera gizmo, and a controls panel:

```jsx
import { Baselode3DControls } from 'baselode';
import 'baselode/style.css';

<Baselode3DControls
  traces={traces}
  structuralDiscs={discs}
  colorBy="au_ppm"
/>
```

### React component — BlockModelWidget

Interactive 3D block model viewer:

```jsx
import { BlockModelWidget } from 'baselode';
import 'baselode/style.css';

<BlockModelWidget
  blocks={blocks}
  colorProperty="grade"
/>
```

### 3D payload builders

```js
import { tracesAsSegments, intervalsAsTubes, annotationsFromIntervals } from 'baselode';

const segments    = tracesAsSegments(traces);
const tubes       = intervalsAsTubes(assays, { colorBy: 'au_ppm', radius: 2 });
const annotations = annotationsFromIntervals(assays);
```

### Structural disc builder

```js
import { buildStructuralDiscs } from 'baselode';

const discs = buildStructuralDiscs(structuralPoints, traces);
// Returns Three.js-ready disc descriptors for each structural measurement
```

---

## Camera Controls

Programmatic camera control helpers for the 3D scene:

```js
import {
  fitCameraToBounds,
  recenterCameraToOrigin,
  lookDown,
  pan, dolly,
  setFov
} from 'baselode';

fitCameraToBounds(scene, bounds);
lookDown(scene);
setFov(scene, 45);
```

---

## Standalone Bundle

For non-React environments (e.g. embedding in a plain HTML page or a Python Dash iframe), `baselode` ships a standalone UMD/IIFE module that registers itself as `window.baselode`:

```html
<script src="baselode-module.js"></script>
<script>
  const scene = new window.baselode.Baselode3DScene(document.getElementById('canvas'));
</script>
```

The standalone bundle is built from `vite.standalone.js` in the JS package and is copied to `demo-viewer-dash/assets/` automatically:

```bash
cd javascript/packages/baselode
npm run build:module
```
