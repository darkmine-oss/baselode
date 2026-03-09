# JavaScript API Reference

Complete reference for the `baselode` npm package (v0.1.x).

All exports are available as named imports from `'baselode'`:

```js
import { loadCollars, desurveyTraces, TracePlot } from 'baselode';
```

---

## Data Model Constants

```js
import {
  HOLE_ID, LATITUDE, LONGITUDE, ELEVATION,
  AZIMUTH, DIP, FROM, TO, MID, DEPTH,
  PROJECT_ID, EASTING, NORTHING, CRS, STRIKE,
  BASELODE_DATA_MODEL_DRILL_COLLAR,
  BASELODE_DATA_MODEL_DRILL_SURVEY,
  BASELODE_DATA_MODEL_DRILL_ASSAY,
  BASELODE_DATA_MODEL_STRUCTURAL_POINT,
  DEFAULT_COLUMN_MAP
} from 'baselode';
```

These are string constants (`"hole_id"`, `"latitude"`, etc.) that match the [Python data model](/guide/python#data-model).

---

## Data Layer

### Column utilities

#### `normalizeFieldName(name)`
Normalise a column name to lowercase, trimmed string.

#### `standardizeColumns(rows, columnMap?)`
Rename fields in an array of row objects using the default column map (and an optional override).

```js
const normalised = standardizeColumns(rawRows);
```

#### `standardizeRowArray(rows)`
Apply column standardisation to an array of rows.

---

### Collar / survey / assay loaders

#### `loadCollars(source, options?)`
Load collar data from a CSV text string or row array.  Returns a normalised array of collar objects.

#### `loadSurveys(source, options?)`
Load survey data.  Returns a normalised array sorted by `hole_id`, `depth`.

#### `loadAssays(source, options?)`
Load assay interval data.  Computes a `mid` field.  Returns a normalised array.

#### `loadTable(source, options?)`
Low-level loader shared by all high-level loaders.

#### `assembleDataset({ collars, surveys, assays, structures, geotechnical, metadata? })`
Assemble pre-loaded arrays into a dataset object.

```js
const dataset = assembleDataset({ collars, surveys, assays });
// { collars, surveys, assays, structures, geotechnical, metadata }
```

#### `joinAssaysToTraces(assays, traces, onCols?)`
Left-join 3D trace positions onto assay rows.

#### `filterByProject(rows, projectId)`
Filter rows to a specific `project_id`.

#### `coerceNumeric(rows, columns)`
Convert listed fields to numbers (or `NaN`) for each row.

---

### Assay-focused loaders

#### `parseAssayHoleIds(csvText)`
Parse a CSV and return the list of unique `hole_id` values.

#### `parseAssayHoleIdsWithAssays(csvText)`
Parse a CSV and return `{ holeIds, assayColumns }`.

#### `parseAssayHole(csvText, holeId)`
Parse all rows for a single hole.

#### `parseAssaysCSV(csvText)`
Parse the full assay CSV.

#### `loadAssayMetadata(csvText)`
Extract column metadata without loading all rows.

#### `loadAssayHole(csvText, holeId)`
Load assay rows for one hole.

#### `buildAssayState(csvText)`
Build a full assay state object (hole IDs + column names + data).

#### `loadAssayFile(csvText)`
Load all assay data into memory.

#### `reorderHoleIds(holeIds)`
Sort hole IDs in a natural order.

#### `deriveAssayProps(rows)`
Derive the list of assay property columns from a row array.

---

### CSV row utilities

#### `normalizeCsvRow(row)`
Normalise a single parsed CSV row (trim strings, coerce numbers).

#### `pickFirstPresent(row, candidates)`
Return the first non-null value found in `row` by key list.

---

### Error utilities

#### `toError(value)`
Coerce any value to an `Error` instance.

#### `withDataErrorContext(fn, context)`
Wrap a function with contextual error messages.

#### `logDataWarning(message, ...args)`
Log a data-related warning.

#### `logDataInfo(message, ...args)`
Log a data-related info message.

---

### Field sets

#### `ASSAY_NON_VALUE_FIELDS`
Set of column names that are structural/metadata (not analyte values).

---

### Drillhole loaders

#### `parseDrillholesCSV(csvText)`
Parse a combined drillhole CSV (collars + surveys in one file).

---

### Block model loaders

#### `parseBlockModelCSV(csvText)`
Parse a block model CSV.  Returns an array of block objects.

#### `normalizeBlockRow(row)`
Normalise a single block model row.

#### `loadBlockModelMetadata(csvText)`
Extract metadata (column names, coordinate ranges) from a block model CSV.

#### `calculatePropertyStats(blocks, property)`
Compute min/max/mean for a property across all blocks.

#### `getBlockStats(blocks, property)`
Return `{ min, max, mean }` for a property.

#### `filterBlocks(blocks, { property, min, max })`
Filter blocks by a property value range.

#### `calculateBlockVolume(block)`
Compute the volume of a single block.

#### `getColorForValue(value, colorScale)`
Get the hex colour for a value from a color scale.

---

### Grade block loaders

#### `loadGradeBlocksFromJson(input)`
Parse and validate a grade block set from a JSON object or JSON string.  Throws if `schema_version` is not `"1.0"` or required fields are missing.  Returns a `GradeBlockSet`:

```js
{
  schema_version: "1.0",
  units: "m",
  blocks: [{ id, name, vertices, triangles, attributes, material }, ...]
}
```

#### `gradeBlockToThreeGeometry(block)`
Convert a single grade block to a `THREE.BufferGeometry` (positions + triangle indices).  No normal attribute is computed — `flatShading: true` on the material handles per-face lighting correctly for hard-edged polyhedral geometry.

#### `addGradeBlocksToScene(scene, blockSet, options?)`
Create `THREE.Mesh` objects for all blocks and add them to a `THREE.Scene`.  Each mesh uses a flat-shaded `MeshStandardMaterial` and carries a hidden `THREE.LineSegments` child (`EdgesGeometry`, 15° threshold) for per-edge highlight on selection.  Returns the `THREE.Group` containing all meshes.

`options`: `{ defaultOpacity }` — fallback opacity when `block.material.opacity` is not set (default `1.0`).

`mesh.userData` per mesh:

| Field | Description |
|---|---|
| `id` | Block id from JSON |
| `attributes` | Arbitrary attributes object from JSON |

---

### Structural loaders

#### `parseStructuralPointsCSV(csvText)`
Parse a structural points CSV.  Returns an array of `{ hole_id, depth, dip, azimuth, alpha, beta, comments }`.

#### `parseStructuralIntervalsCSV(csvText)`
Parse a structural intervals CSV.

#### `parseStructuralCSV(csvText)`
Auto-detect point vs interval schema and parse accordingly.

#### `validateStructuralPoints(rows)`
Validate structural point rows.  Returns `{ valid, errors }`.

#### `groupRowsByHole(rows)`
Group an array of rows into a `Map<holeId, row[]>`.

---

### Unified loader

#### `parseAssayCsvTextToHoles(csvText)`
Parse an assay CSV and group rows by hole.

#### `parseUnifiedDataset(assaysCsvText, structuralCsvText)`
Load and merge assays and structural data.  Returns a combined array tagged with `_source`.

---

### Structural positions

#### `interpolateTrace(trace, depth)`
Interpolate a 3D position along a hole trace at the given measured depth.

#### `alphaBetaToNormal(alpha, beta, traceOrientation)`
Convert alpha/beta angles to a 3D normal vector.

#### `computeStructuralPositions(structuralRows, traces)`
Attach 3D positions and normal vectors to all structural measurement rows.

---

## Column Metadata

#### `classifyColumns(rows)`
Classify each column in a row array as one of:
`DISPLAY_NUMERIC | DISPLAY_CATEGORICAL | DISPLAY_COMMENT | DISPLAY_TADPOLE | DISPLAY_HIDDEN`

#### `getChartOptions(colName, rows)`
Return available chart types for a column.

#### `defaultChartType(colName, rows)`
Return the default chart type for a column.

#### Constants

| Constant | Value | Description |
|---|---|---|
| `DISPLAY_NUMERIC` | `"numeric"` | Numeric assay column |
| `DISPLAY_CATEGORICAL` | `"categorical"` | Categorical / lithology column |
| `DISPLAY_COMMENT` | `"comment"` | Free-text comment column |
| `DISPLAY_HIDDEN` | `"hidden"` | Non-display metadata column |
| `DISPLAY_TADPOLE` | `"tadpole"` | Structural alpha/beta tadpole symbol |
| `CHART_OPTIONS` | — | Map of chart type labels |
| `HIDDEN_COLUMNS` | `Set<string>` | Column names hidden by default |
| `COMMENT_COLUMN_NAMES` | `Set<string>` | Column names treated as comments |

---

## Visualization Layer

### drillholeViz

#### `buildIntervalPoints(rows, property)`
Convert assay rows into interval point objects for plotting.

#### `buildPlotConfig(points, property, options?)`
Build a Plotly trace/layout config for a property.

#### `holeHasData(rows, property)`
Return `true` if the hole has at least one non-null value for `property`.

#### Constants
`NUMERIC_LINE_COLOR`, `NUMERIC_MARKER_COLOR`, `ERROR_COLOR`

---

### React component — TracePlot

```jsx
import { TracePlot } from 'baselode';

<TracePlot
  rows={holeRows}           // array of row objects for one hole
  properties={['au_ppm']}   // columns to render
  height={600}              // optional height in px
/>
```

Renders a multi-track Plotly strip log with depth increasing downward.

---

### React hook — useDrillholeTraceGrid

```jsx
import { useDrillholeTraceGrid } from 'baselode';

const { plots } = useDrillholeTraceGrid({ holes, property });
```

Returns an array of plot configs for a drill-hole comparison grid.

---

### Color scales

#### `buildEqualRangeColorScale(values, palette?)`
Build an equal-range color scale from a numeric array.

#### `getEqualRangeBinIndex(scale, value)`
Return the bin index for `value` in a pre-built scale.

#### `getEqualRangeColor(scale, value)`
Return the hex color for `value` in a pre-built scale.

#### `ASSAY_COLOR_PALETTE_10`
Default 10-color palette array for assay visualisation.

---

### 2D projections

#### `projectTraceToSection(traces, origin, azimuth)`
Project 3D trace points onto a vertical cross-section.

#### `sectionWindow(traces, origin, azimuth, width)`
Filter traces to points within `width` metres of the section plane.

#### `planView(traces, depthSlice?, colorBy?)`
Prepare traces for a plan (top-down) view.

#### `sectionView(traces, origin, azimuth, width, colorBy?)`
Prepare traces for a vertical section view.

---

### 3D payload builders

#### `tracesAsSegments(traces, colorBy?)`
Convert trace rows into segment arrays for the 3D scene.

#### `intervalsAsTubes(intervals, options?)`
Convert interval rows into tube descriptor objects for 3D rendering.

#### `annotationsFromIntervals(intervals)`
Build annotation label objects from interval rows.

---

### Structural visualisation

#### `buildTadpoleConfig(structuralRows, holeRows)`
Build a Plotly trace config for tadpole symbols on a strip log.

#### `buildStructuralStripConfig(structuralRows)`
Build a Plotly config for a structural strip track.

#### `buildCommentsConfig(rows, commentsColumn)`
Build a Plotly config for a free-text comments track.

#### `buildStrikeDipSymbol(dip, azimuth)`
Return SVG path data for a strike/dip symbol.

---

### Structural scene

#### `dipAzimuthToNormal(dip, azimuth)`
Convert dip/azimuth to a Three.js-compatible normal vector.

#### `buildStructuralDiscs(structuralPoints, traces)`
Build disc descriptor objects for the 3D scene.

---

## 3D Scene

### Baselode3DScene

```js
import { Baselode3DScene } from 'baselode';
```

Thin Three.js orchestrator.  Rendering is delegated to internal domain modules (`drillholeScene`, `stripLogScene`, `blockModelScene`, `structuralScene`, `sceneClickHandler`, `selectionGlow`).

**Lifecycle**

| Method | Description |
|---|---|
| `new Baselode3DScene()` | Construct (does not create WebGL context yet) |
| `init(container)` | Attach renderer to a DOM container element and start animation loop |
| `resize()` | Update camera/renderer when the container is resized |
| `dispose()` | Cancel animation, remove DOM element, free all GPU resources |

**Drillholes**

| Method | Description |
|---|---|
| `setDrillholes(holes, options?)` | Render desurveyed hole traces as cylinders; fits camera |
| `setDrillholeClickHandler(fn)` | Register `({ holeId, project })` or `{ type:'structure', ... }` click callback |

`options`: `{ preserveView, assayIntervalsByHole, selectedAssayVariable }`

**Strip logs (floating 3D traces)**

Floating line traces rendered beside drillholes in 3D space.  Each trace is a solid ribbon mesh with no background panel — the scene is fully visible through it.  Traces are depth-registered: `depth = 0` anchors at the collar and each sample appears at its true position along the hole axis, aligned with the drillstring geometry.

| Method | Description |
|---|---|
| `setStripLogs(holes, stripLogs)` | Add floating line traces beside drillholes; clears previous traces first |
| `clearStripLogs()` | Remove all traces and free GPU resources |

`setStripLogs(holes, stripLogs)` — `holes` is the same desurveyed array passed to `setDrillholes`.  `stripLogs` is an array of objects:

| Property | Type | Description |
|---|---|---|
| `holeId` | `string` | Must match a `hole.id` from the `holes` array |
| `depths` | `number[]` | Measured downhole depths for each sample (metres from collar) |
| `values` | `number[]` | Numeric value at each depth |
| `options.panelWidth` | `number` | Scene-unit horizontal extent of the value axis (default `20`) |
| `options.lateralOffset` | `number` | Scene-unit offset from the hole collar perpendicular to the hole axis (default `15`) |
| `options.color` | `string` | CSS/hex ribbon colour (default `'#00bcd4'`) |
| `options.valueMin` | `number` | Explicit minimum for horizontal scaling (auto if omitted) |
| `options.valueMax` | `number` | Explicit maximum for horizontal scaling (auto if omitted) |

The trace orientation is derived from the collar→toe vector of each hole.  The lateral offset direction is perpendicular to that vector in the horizontal plane.  Depth positions are normalised against the hole's measured depth at the toe (read from `point.md`), so dense geophysics logs (e.g. gamma at 0.1 m intervals) render correctly alongside sparse assay intervals.

**Pure helpers (exported for testing)**

| Symbol | Description |
|---|---|
| `normalizeStripLogOptions(options?)` | Apply defaults to a strip log options object |
| `getHoleVerticalExtent(points)` | Return `{ topZ, botZ, height }` from desurveyed hole points |
| `buildStripLogLinePoints(depths, values, panelWidth, panelHeight, valueMin, valueMax, depthScale?)` | Map depth/value arrays to panel-local `THREE.Vector3` points.  `depthScale` (hole measured depth at toe) anchors depth 0 at the collar; omit to auto-scale across the data range. |
| `buildStripLogGroup(hole, stripLog)` | Build the `THREE.Group` for one hole/log pair |
| `STRIP_LOG_DEFAULT_PANEL_WIDTH` | `20` |
| `STRIP_LOG_DEFAULT_LATERAL_OFFSET` | `15` |
| `STRIP_LOG_DEFAULT_COLOR` | `'#00bcd4'` |

**Block model**

| Method | Description |
|---|---|
| `setBlocks(data, selectedProperty, stats, options?)` | Render a merged exterior-face block mesh with vertex colours |
| `setBlockOpacity(opacity)` | Update opacity of all rendered blocks (0–1) |
| `setBlockClickHandler(fn)` | Register `(blockRow) => void` click callback |

`options`: `{ autoCenter, opacity, offset }`

**Structural discs**

| Method | Description |
|---|---|
| `setStructuralDiscs(structures, holes, opts?)` | Render disc meshes oriented to dip/azimuth or alpha/beta |
| `setStructuralDiscsVisible(visible)` | Show or hide all structural discs |

`opts`: `{ radius, discThickness, opacity, segments, colorMap, maxDiscs }`

**Camera**

| Method | Description |
|---|---|
| `recenterCameraToOrigin(distance?)` | Move camera to origin |
| `lookDown(distance?)` | Point camera straight down |
| `pan(dx, dy)` | Screen-space pan |
| `dolly(scale)` | Zoom in/out by scale factor |
| `focusOnLastBounds(padding?)` | Return to last data bounds |
| `setCameraFov(fovDeg)` | Set FOV while preserving apparent scale |
| `setControlMode(mode)` | Switch `'orbit'` / `'fly'` |
| `getViewState()` | Serialise current camera state |
| `setViewState(state)` | Restore a saved camera state |
| `setViewChangeHandler(fn)` | Register callback for camera movement (throttled 250 ms) |

**Selection glow**

| Method | Description |
|---|---|
| `selectObject(object\|null)` | Programmatically apply/clear glow |
| `getSelectedObject()` | Return currently glowing object, or `null` |
| `setSelectableObjects(objects[])` | Override the raycast candidate list |
| `disposeGlow()` | Free EffectComposer GPU resources |

---

### React component — Baselode3DControls

```jsx
import { Baselode3DControls } from 'baselode';
import 'baselode/style.css';

<Baselode3DControls
  traces={segments}
  structuralDiscs={discs}
  colorBy="au_ppm"
/>
```

Drop-in React component wrapping `Baselode3DScene` with orbit controls, viewport gizmo, and a controls panel.

---

### React component — BlockModelWidget

```jsx
import { BlockModelWidget } from 'baselode';
import 'baselode/style.css';

<BlockModelWidget
  blocks={blocks}
  colorProperty="grade"
/>
```

Interactive 3D block model viewer.

---

## Raster Overlays

### `normalizeBounds(bounds)`

Normalise a bounds descriptor to the canonical `{ minX, minY, maxX, maxY }` form.

Accepts either:
- `{ minX, minY, maxX, maxY }` — explicit corners
- `{ x, y, width, height }` — origin + size

Throws if the resulting width or height is zero or negative.

---

### `createRasterOverlay(options)`

Create a raster overlay layer from an image source.  Returns a `Promise<layer>`.

| Option | Type | Default | Description |
|---|---|---|---|
| `source` | object | required | Image source (see below) |
| `bounds` | object | required | Placement bounds in scene coordinates |
| `id` | string | auto | Unique identifier |
| `name` | string | id | Human-readable display name |
| `elevation` | number | `0` | Z position in scene units (metres) |
| `opacity` | number | `1` | Initial opacity clamped to `[0, 1]` |
| `visible` | boolean | `true` | Initial visibility |
| `renderOrder` | number | `0` | Three.js `renderOrder` for draw-order control |

**Source types:**

| `source.type` | Extra fields | Description |
|---|---|---|
| `'url'` | `url: string` | Load from a URL or data URI |
| `'file'` | `file: File` | Load from a browser `File` object |
| `'texture'` | `texture: THREE.Texture` | Use a pre-built Three.js texture |

The returned layer object has shape `{ id, name, mesh, texture, bounds, elevation, opacity, visible }`.

---

### Scene-level raster functions

These functions are also available as methods on `Baselode3DScene` (without the `sceneCtx` argument):

#### `addRasterOverlay(sceneCtx, layer)`
Add a layer (from `createRasterOverlay`) to the scene.  If a layer with the same `id` already exists it is removed first.

#### `removeRasterOverlay(sceneCtx, id)`
Remove a layer from the scene and dispose its geometry, material, and texture.

#### `setRasterOverlayOpacity(sceneCtx, id, opacity)`
Update opacity at runtime.  Value is clamped to `[0, 1]`.

#### `setRasterOverlayVisibility(sceneCtx, id, visible)`
Show or hide a layer without destroying it.

#### `setRasterOverlayElevation(sceneCtx, id, elevation)`
Update the Z position of a layer at runtime.

#### `getRasterOverlay(sceneCtx, id)`
Return the layer descriptor for `id`, or `undefined` if not found.

#### `listRasterOverlays(sceneCtx)`
Return all layers as an array in insertion order.

#### `clearRasterOverlays(sceneCtx)`
Remove all layers from the scene and dispose all GPU resources.

---

### `Baselode3DScene` — raster overlay methods

These delegate to the functions above with `sceneCtx = scene`:

| Method | Description |
|---|---|
| `scene.addRasterOverlay(layer)` | Add a layer to the scene |
| `scene.removeRasterOverlay(id)` | Remove and dispose a layer |
| `scene.setRasterOverlayOpacity(id, opacity)` | Update opacity (0–1) |
| `scene.setRasterOverlayVisibility(id, visible)` | Show or hide |
| `scene.setRasterOverlayElevation(id, elevation)` | Update Z position |
| `scene.getRasterOverlay(id)` | Get layer by id |
| `scene.listRasterOverlays()` | Get all layers |
| `scene.clearRasterOverlays()` | Remove all layers |

---

## Camera Controls

Camera control helpers operate on a `Baselode3DScene` instance.

| Function | Description |
|---|---|
| `fitCameraToBounds(scene, bounds)` | Fit camera to a bounding box |
| `recenterCameraToOrigin(scene)` | Move camera to the scene origin |
| `lookDown(scene)` | Rotate camera to look straight down |
| `pan(scene, dx, dy)` | Pan camera by screen-space delta |
| `dolly(scene, delta)` | Zoom camera in/out |
| `focusOnLastBounds(scene)` | Return camera to the last computed bounds |
| `setControlMode(scene, mode)` | Switch orbit/pan/zoom control mode |
| `setFov(scene, degrees)` | Set the camera field of view |
| `buildViewSignature(scene)` | Serialise the current view state |
| `getViewState(scene)` | Return the current view state object |
| `setViewState(scene, state)` | Restore a previously saved view state |
| `emitViewChangeIfNeeded(scene)` | Fire a view-change event if the camera moved |

**Constants:** `FOV_MIN_DEG`, `FOV_MAX_DEG`
