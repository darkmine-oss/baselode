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

### Polygonal grade blocks

Grade blocks are closed polyhedral meshes — grade shells, geologic domains, or any volumetric solid defined by triangulated vertices.  They are loaded from a structured JSON format:

```js
import { loadGradeBlocksFromJson, addGradeBlocksToScene } from 'baselode';

// Parse and validate the JSON (accepts a parsed object or a JSON string)
const blockSet = loadGradeBlocksFromJson(json);

// Render into an existing THREE.Scene (e.g. from Baselode3DScene)
const group = addGradeBlocksToScene(scene.scene, blockSet);
// Returns a THREE.Group whose children are one THREE.Mesh per block
```

#### JSON schema (version `"1.0"`)

```json
{
  "schema_version": "1.0",
  "units": "m",
  "blocks": [
    {
      "id": "HG",
      "name": "High grade",
      "vertices": [[0,0,0], [10,0,0], [10,10,0], [0,10,0],
                   [0,0,5], [10,0,5], [10,10,5], [0,10,5]],
      "triangles": [[0,1,2],[0,2,3], [4,5,6],[4,6,7],
                    [0,1,5],[0,5,4], [1,2,6],[1,6,5],
                    [2,3,7],[2,7,6], [3,0,4],[3,4,7]],
      "attributes": { "grade_class": "HG", "au_ppm": 4.2 },
      "material": { "color": "#B02020", "opacity": 1.0 }
    }
  ]
}
```

| Field | Required | Description |
|---|---|---|
| `schema_version` | yes | Must be `"1.0"` |
| `units` | no | Coordinate units string (e.g. `"m"`) |
| `blocks[].id` | yes | Unique identifier |
| `blocks[].name` | yes | Display name |
| `blocks[].vertices` | yes | `[[x,y,z], ...]` array of 3-D vertex positions |
| `blocks[].triangles` | yes | `[[i,j,k], ...]` zero-based triangle index triples |
| `blocks[].attributes` | no | Arbitrary key-value metadata shown in selection panel |
| `blocks[].material.color` | no | CSS hex colour (default `#888888`) |
| `blocks[].material.opacity` | no | 0–1 opacity (default `1.0`) |

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

![2D multi-track strip logs](/screenshots/v0.1.5-striplogs.png)

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

<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:1rem">
  <img src="/screenshots/v0.1.5-3d-drillstrings.png" alt="3D drillhole viewer" style="border-radius:8px;border:1px solid #e2e8f0;width:100%" />
  <img src="/screenshots/v0.1.5-3d-blockmodel.png" alt="3D block model viewer" style="border-radius:8px;border:1px solid #e2e8f0;width:100%" />
</div>

`Baselode3DScene` is a thin orchestrator that owns the WebGL context and delegates rendering to domain-specific modules (`drillholeScene`, `blockModelScene`, `structuralScene`).  Use it directly or through the pre-built React wrapper.

```js
import { Baselode3DScene } from 'baselode';

const scene = new Baselode3DScene();
scene.init(containerElement);   // attach to a DOM container

// Drillholes (desurveyed trace objects)
scene.setDrillholes(holes, { selectedAssayVariable: 'au_ppm', assayIntervalsByHole });

// Block model
scene.setBlocks(blockRows, 'au_ppm', stats);

// Structural discs
scene.setStructuralDiscs(structuralRows, holes, { radius: 5, opacity: 0.75 });

// Click handlers
scene.setDrillholeClickHandler(({ holeId }) => console.log(holeId));
scene.setBlockClickHandler((blockRow) => console.log(blockRow));

// Cleanup
scene.dispose();
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

### Polygonal grade blocks — 3D rendering

`addGradeBlocksToScene` renders each block as a `THREE.Mesh` with flat-shaded `MeshStandardMaterial` and an edge-highlight `LineSegments` child (hidden by default, shown on selection).

```js
import { Baselode3DScene, loadGradeBlocksFromJson, addGradeBlocksToScene } from 'baselode';

const scene = new Baselode3DScene();
scene.init(containerElement);

const blockSet = loadGradeBlocksFromJson(json);
const group    = addGradeBlocksToScene(scene.scene, blockSet, { defaultOpacity: 0.85 });

// Register meshes so the built-in selection glow fires on click
scene.selectables = Array.from(group.children);
```

**Click selection and edge highlight**

When a mesh is clicked the scene's built-in raycast handler applies a glow outline (`OutlinePass`) around the outer silhouette.  Each mesh also carries a hidden `LineSegments` child built from `EdgesGeometry` — showing it on selection highlights every polyhedral edge explicitly:

```js
// Show/hide the edge overlay when selection changes
group.children.forEach((mesh) => {
  const edgeLines = mesh.children[0];
  if (edgeLines) edgeLines.visible = mesh.userData.id === selectedId;
});
```

`mesh.userData` contains `{ id, attributes }` from the source JSON, available in the click callback.

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

## Section and Slice Viewing Helpers

Two interactive helpers for geological cross-section and slab-slice workflows.  Only one may be active at a time — activating one automatically deactivates the other.

### SectionHelper

A **section** is a vertical planar view aligned to a principal axis.  When active the camera switches to orthographic projection, rotation is disabled, and a clipping plane hides geometry **in front of** the section (toward the camera) so only geology **behind** the section is visible.

```js
import { SectionHelper } from 'baselode';

const section = new SectionHelper(scene);

// Activate an East–West section (camera looks in −X direction)
section.enableSectionMode('x');         // 'x' | 'y'

// Move the section plane
section.setSectionPosition(4500);       // X = 4500 m
section.stepSection(-10);              // step 10 m west

// Query position
const pos = section.getSectionPosition();

// Deactivate
section.disableSectionMode();
```

| Method | Description |
|---|---|
| `enableSectionMode(axis)` | Activate section mode (`'x'` or `'y'`) |
| `disableSectionMode()` | Deactivate and restore perspective camera |
| `setSectionPosition(distance)` | Move section plane to world coordinate |
| `stepSection(delta)` | Relative step along the section axis |
| `getSectionPosition()` | Return current section position |
| `dispose()` | Alias for `disableSectionMode()` |

### SliceHelper

A **slice** (slab slice) displays only geometry within a finite thickness around an arbitrary plane.  Two clipping planes form a bounded slab: `distance ± width/2`.

```js
import { SliceHelper } from 'baselode';
import * as THREE from 'three';

const slice = new SliceHelper(scene);

// Activate
slice.enableSliceMode();

// Define the slice plane (normal + signed distance from origin)
slice.setSlicePlane(new THREE.Vector3(1, 0, 0), 4500);  // YZ plane at X=4500
slice.setSliceWidth(50);                                  // ±25 m slab

// Scan through the scene
slice.moveSlice(10);                                      // advance 10 m

// Derive a plane from a knife line drawn on the canvas
const result = slice.createSlicePlaneFromScreenLine(
  { x: 100, y: 300 },   // start pixel coordinate
  { x: 700, y: 300 }    // end pixel coordinate
);
if (result) {
  slice.setSlicePlane(result.normal, result.distance);
}

// Query state
const { normal, distance } = slice.getSlicePlane();
const width = slice.getSliceWidth();

// Deactivate
slice.disableSliceMode();
```

| Method | Description |
|---|---|
| `enableSliceMode()` | Activate slice mode |
| `disableSliceMode()` | Deactivate and remove clipping planes |
| `setSlicePlane(normal, distance)` | Set the slice plane (unit normal + signed distance) |
| `setSliceWidth(width)` | Set total slab thickness |
| `moveSlice(delta)` | Translate slice plane along its normal |
| `getSlicePlane()` | Return `{ normal, distance }` |
| `getSliceWidth()` | Return current slab thickness |
| `createSlicePlaneFromScreenLine(start, end)` | Derive a vertical plane from pixel coordinates |
| `dispose()` | Alias for `disableSliceMode()` |

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
