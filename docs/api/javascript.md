# JavaScript API Reference

Complete reference for the `baselode` npm package (v0.1.x).

All exports are available as named imports from `'baselode'`:

```js
import { loadCollars, minimumCurvatureDesurvey, TracePlot } from 'baselode';
```

---

## Data Model Constants

Block model geometry keys `BLOCK_X … BLOCK_DZ`, `BLOCK_I … BLOCK_NK` and the `BASELODE_DATA_MODEL_BLOCK` schema are exported alongside the drilling constants (see the `block` table in the JSON schemas).

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
Parse a desurveyed-trace CSV (`hole_id`, `easting`/`x`, `northing`/`y`, `elevation`/`z`, `md`/`depth`, …).  Returns `{ holes: [{ id, points: [...] }] }`.

Source column-name aliases are standardised on read — `md`, `measured_depth`, `survey_depth` all collapse to the canonical `depth` field.  Each output point carries both `point.depth` (canonical) and `point.md` (preserved alias) so consumers reading either name get a finite value.

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

### Block model primitive

Functions over a `{ definition, blocks }` object; see the guide for the conventions.

#### Definition
`createBlockModelDefinition({ origin, blockSize, nBlocks, parentSize?, rotation?, crs?, name?, description?, extra? })` → frozen definition (`matrix`, `inverse` included).
`blockModelDefinitionFromDict(meta)` — reads Python `to_dict()` output (or a `*_meta.json` with a `definition` key) and legacy metadata.
`blockModelDefinitionToDict(definition)` — the same JSON shape Python writes.
`blockModelRotationMatrix(azimuth, dip, plunge)`, `localToWorld(d, u, v, w)`, `worldToLocal(d, x, y, z)`, `indexToWorld(d, i, j, k, ni=1, nj=1, nk=1)`, `worldToIndex(d, x, y, z)`, `containsIndex(d, i, j, k, ni, nj, nk)`, `parentIndex(d, i, j, k)`, `blockModelExtent(d)`, `parentBlockSize(d)`, `blockModelCorners(d)`, `blockModelBounds(d)`, `blockModelOutline2d(d)`, `sameGrid(a, b, tol)`.

#### Model
`createBlockModel({ definition, blocks })` — normalises rows so both geometry encodings are present.
`attachBlockIndices(rows, definition, { overwrite })`, `attachBlockCentroids(rows, definition, { overwrite })`, `blockAttributeKeys(rows)`, `BLOCK_GEOMETRY_KEYS`, `BLOCK_INDEX_KEYS`.
`validateBlockModel(model, { tol })` → `{ summary, issues }`.
`regularizeBlocks(model)`, `aggregateToParentBlocks(model, { aggregations, densityKey })`.
`buildBlockOccupancy(model)`, `findBlockAt(model, x, y, z, occupancy?)`, `sampleBlocksAt(model, points, { attributes })`.
`selectBlocks(model, criteria)`, `clipBlocks(model, bounds)`.
`blockVolume(row)`, `blockModelVolume(model)`, `blockModelTonnage(model, { densityKey, density, criteria })`, `gradeTonnage(model, gradeKey, cutoffs, { densityKey, density })`.
`diffBlockModels(a, b, { attributes, tol })` → `{ summary, cells }`.

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

#### `alphaBetaToDipAzimuth(holeDip, holeAzimuth, alpha, beta)`
Convert oriented-core alpha/beta angles into `{ dip, dipDirection }` (degrees)
using the hole orientation. `holeDip` uses the survey convention (negative =
downward), `beta` is measured clockwise looking downhole from the bottom-of-hole
line (from north for near-vertical holes). Accepts scalars or index-aligned
arrays (scalars broadcast). Matches the Python `alpha_beta_to_dip_azimuth`.

#### `alphaBetaToNormal(alpha, beta, traceOrientation)`
Convert alpha/beta angles to a 3D normal vector.

#### `computeStructuralPositions(structuralRows, traces)`
Attach 3D positions and normal vectors to all structural measurement rows.

---

## DrillholeSet

Composition root for the drilling tables of a project.  Mirrors the Python `baselode.drill.DrillholeSet` class — holds collar + survey + N interval tables and exposes the existing function-based API as methods.  No new logic; the trace is cached after the first `desurvey()` call.

```js
import { DrillholeSet } from 'baselode';

const db = new DrillholeSet(collarRows, surveyRows, {
  crs: 'EPSG:32750',
  project: 'goldfields-2026',
});

db.addTable('assay', assayRows).addTable('geology', lithoRows, 'litho');

const report = db.validate();
const traces = db.desurvey({ step: 1 });
```

| Method / property | Mirrors Python |
|---|---|
| `new DrillholeSet(collar, survey, { crs, project, holeCol })` | `DrillholeSet(collar, survey, crs=..., project=..., hole_col=...)` |
| `db.addTable(name, rows, kind?)` | `db.add_table(name, df, kind=...)` |
| `db.holes` | `db.holes` |
| `db.traces` | `db.traces` |
| `db.desurvey({ method, step, force })` | `db.desurvey(method=..., step=..., force=...)` |
| `db.validate(options)` | `db.validate(**kwargs)` |
| `db.get(name)` / `db.has(name)` | `db[name]` / `name in db` |
| `db.toString()` | `repr(db)` |

OMF export is Python-only (`db.to_omf`), per the TRK-111 scope.

---

## Drillhole DB Validation

Mirror of `baselode.drill.validate.validate_drillhole_db`.  Returns a structured `{ summary, issues }` report covering duplicate collar IDs, single-station surveys, az/dip range, orphan intervals, gaps/overlaps, beyond-`max_depth` intervals, and `<MDL` sentinels.

```js
import {
  validateDrillholeDb,
  fixSingleStationSurveys,
  normalizeAzimuth,
  dropOrphanIntervals,
  swapInvertedIntervals,
  replaceBelowDetectionLimit,
  SEVERITY_ERROR,
  SEVERITY_WARNING,
  SEVERITY_INFO,
} from 'baselode';
```

#### `validateDrillholeDb({ collar, survey, intervalTables }, options?)`

Run all checks in one pass.

```js
const report = validateDrillholeDb({
  collar: collarRows,
  survey: surveyRows,
  intervalTables: { assay: assayRows, geology: geologyRows },
});
// {
//   summary: { error, warning, info },
//   issues: [{ check, severity, hole_id, table, row_index, message, fix }, ...]
// }
```

`options` accepts column-name overrides (`holeCol`, `depthCol`, `azimuthCol`, `dipCol`, `fromCol`, `toCol`, `maxDepthCol` — defaults from the data-model constants) plus `allowFullCircle` (default `false`).  When `true`, `azimuth = 360` is accepted as valid (closed interval `[0, 360]`); otherwise the strict mathematical convention `[0, 360)` is used and `360` is reported as an error.

#### `fixSingleStationSurveys(survey, collar?, options?)`

Append a synthetic second station for any hole with only one row.  Uses `collar.max_depth` when present, otherwise `depth + 1.0`.  Returns a new sorted array.

#### `dropOrphanIntervals(table, collar, options?)`

Drop interval rows whose `hole_id` is not in `collar`.  Complement of the `orphan_intervals` validation check.  `options.holeCol` overrides the column name.

#### `swapInvertedIntervals(table, options?)`

Swap `from`/`to` where `to < from`.  Fixes the common data-entry typo; rows where `to === from` (zero-length) are left untouched for manual review.  All other fields preserved.  `options.fromCol` / `options.toCol` override the column names.

#### `normalizeAzimuth(survey, options?)`

Wrap survey azimuths into `[0, 360)` via `value mod 360`.  Folds `360` to `0`, normalizes negatives, idempotent for valid values.  `null` / non-numeric cells are left untouched.  `options.azimuthCol` overrides the column name (default `AZIMUTH`).

#### `replaceBelowDetectionLimit(rows, options?)`

Replace `<MDL` string sentinels (e.g. `"<0.005"`) with `MDL * sentinelFactor` (default `0.5`).

| Option | Type | Default | Description |
|---|---|---|---|
| `columns` | `string[]` \| `null` | `null` | Columns to scan; `null` = scan every column |
| `sentinelFactor` | `number` | `0.5` | Multiplier applied to the detected limit |

#### Severity constants

`SEVERITY_ERROR` `"error"`, `SEVERITY_WARNING` `"warning"`, `SEVERITY_INFO` `"info"` — re-exported so consumer code can group issues by severity without string literals.

---

## Interval Algebra

Pure from-to interval primitives, mirroring the Python `baselode.drill.intervals` module.  Each function takes an array of row objects keyed by `hole_id`, `from`, `to`.  All field-name defaults come from the data model constants (`HOLE_ID`, `FROM`, `TO`); override via the options object.

```js
import {
  intervalLength,
  fromToMidpoints,
  detectGaps,
  detectOverlaps,
  splitAt,
  clip,
  mergeTables,
} from 'baselode';
```

#### `intervalLength(rows, options?)`
Per-row length (`to - from`).  Returns `number[]`.

#### `fromToMidpoints(rows, options?)`
Per-row midpoint depth (`(from + to) / 2`).  Returns `number[]`.

#### `detectGaps(rows, options?)`
Uncovered downhole ranges between consecutive intervals, per hole.  Returns an array of `{ hole_id, from, to, length }`.  `options.minGap` (default `0`) sets the minimum gap length to report.

#### `detectOverlaps(rows, options?)`
All overlapping interval pairs per hole.  Returns an array of `{ hole_id, from, to, length, first_index, second_index }`, where the indices are positional into the input array.

#### `splitAt(rows, depths, options?)`
Split intervals at boundary depths.  Any depth strictly inside `(from, to)` becomes a new boundary; the row is replaced by sub-intervals inheriting all other fields.

`depths` accepts:
- a `number` — applied to every hole
- a `number[]` — applied to every hole
- `{ [hole_id]: number[] }` — per-hole boundaries
- an array of `{ hole_id, depth }` rows

#### `clip(rows, fromDepth, toDepth, options?)`
Clip intervals to a downhole window.  Intervals entirely outside `[fromDepth, toDepth]` are dropped; straddling intervals have their from/to pulled to the boundary.  Pass `null`/`undefined` for either bound to disable that side.

#### `mergeTables(tables, options?)`
Left-join multiple interval tables onto a common from-to support via boundary intersection.  `tables` is an object literal where the first key is the left (anchoring) table.  Each output row carries `<table>_<col>` values looked up at the sub-interval midpoint; columns from a later table missing a covering row are `null`.

```js
const merged = mergeTables({ assay: assayRows, litho: lithoRows });
// each row: { hole_id, from, to, assay_<col>, ..., litho_<col>, ... }
```

#### Options object

```js
{
  fromCol: string,   // default: FROM ("from")
  toCol:   string,   // default: TO ("to")
  holeCol: string,   // default: HOLE_ID ("hole_id")
  minGap:  number,   // detectGaps only; default: 0
}
```

---

## 3D Interpolation Volumes

GPU-rendered IDW (inverse-distance-weighted) interpolation volumes for visualising how a drilling attribute varies between sample points in 3D.  See the [guide section](/guide/javascript#_3d-interpolation-volumes) for an end-to-end example.

#### `IDWVolumeLayer(options)`

One-call wrapper that builds the spatial index, evaluates the IDW field over a voxel grid, and renders the result as a Three.js mesh.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `samples` | `Array<InterpSamplePoint>` | `[]` | Sample points: `{ id, x, y, z, value }`.  Use `buildInterpSamplesFromAssays` to derive from raw assay rows |
| `bounds` | `VolumeBounds \| null` | auto | Axis-aligned bbox to interpolate over.  Auto-computed from `samples` if omitted |
| `boundsPadding` | `number` | `10` | Extra world units added on every side of the auto-computed bounds |
| `idw.power` | `number` | `2` | Distance exponent for the IDW weight `1 / d^p` |
| `idw.searchRadius` | `number` | `50` | Maximum distance (world units) to query for neighbours per voxel |
| `idw.maxNeighbors` | `number` | unset | Cap on neighbour count per query; null = unlimited |
| `idw.minNeighbors` | `number` | `1` | Below this, the voxel is marked no-data |
| `grid.dims` | `[nx, ny, nz]` | `[32, 32, 32]` | Voxel count per axis.  Mutually exclusive with `grid.voxelSize` |
| `grid.voxelSize` | `[vx, vy, vz]` | — | Voxel size in world units; the grid count is derived from the bounds |
| `displayMin` / `displayMax` | `number` | `0` / `1` | Value range mapped to the colour gradient |
| `opacity` | `number` | `0.4` | `[0, 1]` per-voxel alpha; `1` makes the volume fully opaque |
| `threshold` | `number \| null` | `null` | Normalised `[0, 1]` cutoff; voxels below this are skipped |
| `blockMode` | `boolean` | `true` | Crisp voxel-block look (`true`) vs trilinear-smoothed (`false`) |
| `steps` | `number` | `64` | Ray-march samples per fragment |
| `colorLow` / `colorHigh` | `[r, g, b]` | blue / red | Two-stop colour gradient |

**Methods:**

- `await layer.rebuild({ onProgress?, })` — re-build the spatial index + voxel grid.  Returns when the field is uploaded to the GPU.  Honours an internal cancellation token (back-to-back `rebuild()` calls abort the previous build).
- `layer.setOpacity(v)` / `setThreshold(v)` / `setBlockMode(b)` — display-only knobs, no rebuild.
- `layer.setClipBounds(min, max)` — per-axis clip in normalised `[0, 1]` box-local space.  `setClipBounds([0,0,0], [1,1,0.6])` slices the top 40% of Z off the rendered volume.
- `layer.setSamples(samples)` / `setIDWOptions(opts)` / `setGridOptions(opts)` — update inputs; call `rebuild()` afterwards.
- `layer.getValueAt(x, y, z)` — interpolate a single point in world coords without going through the GPU.
- `layer.dispose()` — release the GPU resources.  Remove `object3D` from the scene first.

**Property:**

- `layer.object3D` — the Three.js mesh to add to the scene.

#### `IDWVolumeRenderer()`

Lower-level renderer used internally by the layer.  Useful when you want to drive the voxel grid yourself.

- `renderer.setGrid(grid, options?)` — upload a `VoxelGrid` to a `Data3DTexture` and configure display options.
- `renderer.setDisplayOptions(options)` — update display knobs without re-uploading the texture.
- `renderer.setClipBounds(min, max)` — same as the layer method.
- `renderer.setVisible(visible)` — show/hide the volume.
- `renderer.dispose()` — release the texture + material.
- `renderer.object3D` — the Three.js mesh.

#### `IDWSampler(samples, options?)`

Pure scalar-field sampler.  No Three.js dependency — reusable for slice/probe tools or CPU-side analytics.

- `new IDWSampler(samples, { power, searchRadius, maxNeighbors, minNeighbors, nodataValue, epsilon, cellSize })`
- `sampler.getValueAt(x, y, z)` → `number | NaN`
- `sampler.setPower(p)` / `setSearchRadius(r)` / `setMaxNeighbors(n)` / `setSamples(arr)` — runtime configuration; no rebuild needed for the first three.

#### `SpatialHash3D({ cellSize? })`

Uniform 3D spatial hash for radius queries.  Used internally by `IDWSampler` but exported in case callers need a fast `queryRadius(x, y, z, r)` on their own point sets.

- `index.build(points)` — points must expose numeric `x`, `y`, `z`.
- `index.queryRadius(x, y, z, radius)` → `Array<T>`
- `index.queryKNearest(x, y, z, k)` → `Array<T>`

#### `buildVoxelGrid(sampler, bounds, dims, options?)`

Async builder that walks the sampler over a regular grid.  Returns `Promise<VoxelGrid>` with `{ bounds, dims, voxelSize, values, nodataMask }`.

| Option | Default | Meaning |
|---|---|---|
| `sync` | `false` | Disable the periodic `await new Promise(setTimeout)` yields — set when calling from a Web Worker |
| `onProgress` | — | `({ completed, total }) => void` callback fired after each XZ slab |
| `cancellationToken` | — | Object with `.cancelled` — set to `true` mid-build to abort |

Also exported:

- `voxelGridStats(bounds, dims)` → `{ voxelSize, total }` — compute size + count without building.

#### `computeVolumeBounds(points, padding?)` / `buildVolumeBoundsFromMinMax(...)`

Compute `VolumeBounds = { min, max, size, center }` from a point set, or directly from explicit min/max values.

#### `buildInterpSamplesFromAssays(assayRows, attributeName)`

Convert raw assay-interval rows into the `InterpSamplePoint` shape the IDW pipeline expects.  Uses desurveyed `x/y/z` when present on the rows, falls back to `(x_collar, y_collar, z_collar - midMd)` for vertical-hole approximations when desurvey isn't available.

---

## Compositing

Length-weighted compositing of downhole intervals.  Soft + hard boundary modes; true-thickness is Python-only because it depends on a desurveyed trace.

#### `compositeIntervals(intervals, valueCol, options?)`
Composite an array of interval rows into fixed-length downhole bins.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `intervals` | `Array<Object>` | — | Interval rows.  Each row must carry `hole_id`, `from`, `to` and `valueCol`; in `mode === 'hard'` also `boundaryCol` |
| `valueCol` | `string` | — | Property to composite |
| `options.length` | `number` | `1.0` | Composite length (positive, finite) |
| `options.method` | `'average' \| 'sum'` | `'average'` | Length-weighted average or total contribution |
| `options.mode` | `'soft' \| 'hard'` | `'soft'` | Soft = bins extend across the full hole and may cross contacts.  Hard = bins reset at every change in `boundaryCol` |
| `options.boundaryCol` | `string` | — | Domain column for hard mode (required when `mode === 'hard'`) |
| `options.residual` | `'discard' \| 'add_to_previous' \| 'distribute'` | `'discard'` | Tail-of-domain handling in hard mode |
| `options.fromCol` / `options.toCol` / `options.holeCol` | `string` | `'from'` / `'to'` / `'hole_id'` | Column-name overrides |

**Returns:** `Array<Object>` of composites with the same key names as the input plus (in hard mode) the boundary column carrying the originating domain value.

Throws if `length` is not a positive finite number, if `method` isn't `'average'` or `'sum'`, if `mode` is unknown, or if `mode === 'hard'` without a `boundaryCol`.

Mirrors `baselode.drill.composite.composite_intervals` in Python (mass-balance semantics, residual rules, run-grouping).

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

### Analytics plots (TRK-52)

Plotly config builders for the foundational analyte-exploration plot family.  Each returns `{ data, layout }` ready for `Plotly.react(container, data, layout)`.  All accept categorical colouring via the built-in `commodity` / `lithology` maps or an explicit `{category: cssColour}` object.

```js
import {
  buildScatterPlotConfig,
  buildHistogramPlotConfig,
  buildBoxPlotConfig,
  buildViolinPlotConfig,
  buildTernaryPlotConfig,
} from 'baselode';

const { data, layout } = buildScatterPlotConfig(rows, {
  xProp: 'au_ppm',
  yProp: 'ag_ppm',
  colorBy: 'lithology',
  colourMap: 'lithology',
});
```

| Builder | Required options | Optional |
|---|---|---|
| `buildScatterPlotConfig` | `xProp`, `yProp` | `colorBy`, `colourMap`, `markerColor/Size/Opacity`, `log: { x, y }`, `title`, `xTitle`, `yTitle`, `template` |
| `buildHistogramPlotConfig` | `prop` | `groupBy` (overlays per category), `colourMap`, `bins`, `opacity`, `log`, `title`, `xTitle`, `template` |
| `buildBoxPlotConfig` | `prop` | `groupBy`, `colourMap`, `showOutliers`, `log`, `title`, `yTitle`, `template` |
| `buildViolinPlotConfig` | `prop` | `groupBy`, `colourMap`, `showBox`, `showMeanLine`, `log`, `title`, `yTitle`, `template` |
| `buildTernaryPlotConfig` | `aProp`, `bProp`, `cProp` | `colorBy`, `colourMap`, `markerColor/Size/Opacity`, `title`, `template` |

Helpers exported from the same family:

```js
import {
  asNumeric,             // coerce value → number | null
  collectNumericValues,  // pull numeric values out of rows, skipping null/NaN
  groupRowsBy,           // partition rows by a categorical property
  buildCategoricalColourResolver,
  NULLISH_CATEGORY,
} from 'baselode';
```

### Analytics tool-UI components

Drop-in React wrappers — each takes `rows` + the same options as the config builder, mounts Plotly, and resizes responsively.

```jsx
import {
  BaselodeScatterPlotToolUI,
  BaselodeHistogramPlotToolUI,
  BaselodeBoxPlotToolUI,
  BaselodeViolinPlotToolUI,
  BaselodeTernaryPlotToolUI,
} from 'baselode/tool-ui';

<BaselodeScatterPlotToolUI
  rows={assayRows}
  xProp="au_ppm"
  yProp="ag_ppm"
  colorBy="lithology"
  colourMap="lithology"
  template="baselode"
  height={520}
/>
```

Zod schemas for tool-call serialisation (paired with `safeParseSerializableBaselode<PlotName>`):

- `SerializableBaselodeScatterPlotSchema`
- `SerializableBaselodeHistogramPlotSchema`
- `SerializableBaselodeBoxPlotSchema`
- `SerializableBaselodeViolinPlotSchema`
- `SerializableBaselodeTernaryPlotSchema`

---

### drillholeViz

#### `buildIntervalPoints(rows, property)`
Convert assay rows into interval point objects for plotting.

#### `buildPlotConfig(points, property, options?)`
Build a Plotly trace/layout config for a property.

Numeric chart types: `bar`, `markers`, `markers+line`, `line`, `colored-line`,
`multi-line`, `multi-stacked`, `filled-line` (line with the area to x=0 shaded
in the series colour), `step-line` (one vertex pair per interval so blocked
assays render their true extents), `heat-strip` (full-track-width bars
coloured by value on the assay ramp with a slim colour bar), `two-curve`
(two curves with the band between them shaded, flipping colour at each
crossover) and `composition` (divided stacked bars — components as fractions
of each interval's sum).

The multi-property chart types (`multi-line`, `multi-stacked`, `two-curve`,
`composition`) take their inputs from the `series` option
(`[{ property, points, color? }]`) instead of `points`. `two-curve` uses the
first two series (extras ignored; fewer than two yields an empty track);
`composition` stacks every series.

In the chart-type dropdowns (TracePlot and the strip-log tool UI) the other
display types each offer one alternative, dispatched to the structural
builders below: categorical columns add `point-log`, comment columns add
`annotations`, and structural tracks add `dip-azimuth`.

Extra options:

- `logScale` (boolean, default `false`) — log-scale the value axis. Applies to
  `bar` / `markers` / `markers+line` / `line` / `filled-line` / `step-line` /
  `two-curve`; silently ignored for other chart types.
- `patternMap` (object or built-in name, e.g. `'lithology'`) — hatch categorical
  bands per category; see `resolvePatternMap`.

#### `buildTwoCurveFillConfig({ hole, propertyA, propertyB, colorA?, colorB?, logScale?, title?, template? })`
Two numeric curves down the hole with the region between them shaded, flipping
colour exactly at each crossover (classic neutron–density display). Where
A > B the band is colour A at alpha 0.4; where B > A it is colour B.
Low-level API behind the `two-curve` chart type in `buildPlotConfig`.

#### `buildCompositionConfig({ hole, properties, colourMap?, normalize?, title?, template? })`
Percent-composition track: divided horizontal stacked bars per interval, one
trace per component. With `normalize` (default `true`) each interval is scaled
to fractions of its sum on a fixed [0, 1] percent axis; intervals whose
components are all null/zero are skipped and negatives are clamped to 0 for the
bar (raw value stays in the hover).
Low-level API behind the `composition` chart type in `buildPlotConfig`.

#### `holeHasData(rows, property)`
Return `true` if the hole has at least one non-null value for `property`.

#### Constants
`NUMERIC_LINE_COLOR`, `NUMERIC_MARKER_COLOR`, `ERROR_COLOR`

#### Colour & pattern maps
`getColour(value, colourMap, fallback?)`, `resolveColourMap(nameOrMap)`,
`resolvePatternMap(nameOrMap)` and the built-ins `COMMODITY_COLOURS`,
`LITHOLOGY_COLOURS`, `LITHOLOGY_PATTERNS` (category → Plotly
`marker.pattern.shape`, keys a subset of `LITHOLOGY_COLOURS`; built-in name
`'lithology'`).

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
Default 10-colour palette array for assay visualisation — a sequential magma-style ramp from deep purple (low) to bright cream/gold (high).  Used by both `buildEqualRangeColorScale` (legend) and the 3D scene's internal colour pipeline, so the legend and rendered geometry stay in lockstep.  Pass a custom array to `buildEqualRangeColorScale` to override.

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

#### `buildPointLogConfig({ hole?, rows?, depthKey?, categoryKey?, title?, template? })`
Categorical point measurements at depth: each unique category gets a distinct
x slot, palette colour, and marker symbol, one trace per category (functional
legend). JS port of the Python `plot_point_log`. Backs the `point-log` chart
type offered on categorical tracks.

#### `buildDepthAnnotationsConfig({ rows, depthKey?, textKey?, markerColor?, title?, template? })`
Depth-pinned text annotations: a small left-edge tick marker at each depth with
the text to its right, word-truncated to ~40 characters (full text in hover).
Composes with the multi-track strip-log layout. Backs the `annotations` chart
type offered on comment tracks.

#### `buildDipAzimuthConfig({ rows, depthKey?, dipKey?, azimuthKey?, colorBy?, title?, template? })`
Split dip-magnitude / dip-azimuth log: two shared-depth tracks — dip on a fixed
[0, 90] axis, azimuth on a fixed [0, 360] axis with ticks every 90°. Optional
`colorBy` emits one legendgrouped trace pair per category. Backs the
`dip-azimuth` chart type offered on structural (tadpole) tracks.

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

## Terrain Surface

A terrain surface is a height-grid mesh drawn under the drillholes and other layers. The grid and bounds must already be in the scene's projected or local units. This package does no reprojection, so a caller that windows a DEM must reproject the samples and convert NoData cells first.

### `createTerrainSurface(options)`

Build a terrain layer from an elevation grid. Quads with a NoData corner are left out of the mesh, so missing data shows as a real hole. Elevations are never invented. When the grid has no valid cells, the layer comes back with `empty: true` and `mesh: null` instead of throwing.

| Option | Default | Description |
|---|---|---|
| `grid` | required | `{ width, height, elevations, nodata }` with flat row-major elevations, or `{ elevations: number[][], nodata }`. Row 0 is the north edge. |
| `bounds` | required | `{ minX, minY, maxX, maxY }` in scene units |
| `id` / `name` | auto | Layer identifier and display name |
| `verticalExaggeration` | `1` | Explicit Z scale. It is only applied when you set it. |
| `vertexBudget` | `300` | Maximum vertices along the longest grid dimension. Larger grids are decimated by nearest neighbour, so NoData stays NoData. |
| `skirt` | `false` | Adds a wall around the outer perimeter so the surface doesn't look paper-thin from a low angle. The wall is for display only and is not sampled data. |
| `skirtDepth` | just below the minimum | Absolute elevation of the skirt base |
| `opacity` | `1` | Initial opacity, 0–1 |
| `visible` | `true` | Initial visibility |
| `renderOrder` | `-1` | THREE.js render order. Terrain draws before other layers. |

```js
import { Baselode3DScene, createTerrainSurface } from 'baselode';

const terrain = createTerrainSurface({
  grid: { width: 256, height: 256, elevations: dem, nodata: -9999 },
  bounds: { minX: 500000, minY: 6900000, maxX: 512800, maxY: 6912800 },
  skirt: true,
  opacity: 0.85,
});
scene.setTerrain(terrain);
```

### `Baselode3DScene` — terrain methods

A scene holds at most one terrain surface.

| Method | Description |
|---|---|
| `scene.setTerrain(layer)` | Replace the current terrain with `layer` |
| `scene.clearTerrain()` | Remove and dispose the terrain |
| `scene.setTerrainOpacity(opacity)` | Update opacity, 0–1 |
| `scene.setTerrainVisible(visible)` | Show or hide the terrain |
| `scene.getTerrain()` | Return the current terrain layer, or `null` |

The same operations are exported as functions taking the scene as their first argument: `setTerrain`, `clearTerrain`, `setTerrainOpacity`, `setTerrainVisibility` and `getTerrain`.

---

## Geophysics Rasters

Gridded geophysics (magnetics, gravity, radiometrics and similar) uses a bands-first raster object. Python's `GeophysicsRaster.to_payload()` produces the same shape, so a grid processed in Python can be rendered in JavaScript unchanged. See the [JavaScript guide](/guide/javascript#geophysics-raster-viewer) for a walkthrough.

### Worker-safe entry point

`baselode/geophysics` exports only the loaders and processing functions. It has no React, DOM or THREE.js dependencies, so you can import it inside a Web Worker to keep FFT processing off the UI thread:

```js
// geophysicsWorker.js
import { processGeophysicsRaster } from 'baselode/geophysics';

self.onmessage = ({ data }) => {
  const { raster, operation, options } = data;
  self.postMessage(processGeophysicsRaster(raster, operation, options));
};
```

Everything on that entry point is also exported from the main `baselode` entry.

### Raster object

`createGeophysicsRaster(payload)` normalises a payload into:

| Field | Description |
|---|---|
| `data` | Array of bands. Each band is `rows × columns`, with row 0 on the north edge and `null` for NoData. |
| `width`, `height`, `bandCount` | Grid dimensions |
| `transform` | Affine transform `[a, b, c, d, e, f]` mapping (column, row) to (x, y) |
| `crs` | CRS string such as `EPSG:28350`, or `null` |
| `nodata` | NoData value in the source, or `null` |
| `bandNames` | One name per band |
| `metadata` | `units` per band, `crs_units` (`degree`, `metre`, `foot` or `us_survey_foot`), and `processing`, the history of applied operations |
| `bounds` | `{ minX, minY, maxX, maxY }` computed from the transform |

| Function | Description |
|---|---|
| `createGeophysicsRaster(payload)` | Validate and normalise a payload. A single 2-D array is treated as one band. |
| `getGeophysicsRasterBand(raster, index = 1)` | Return one band (1-based) |
| `geophysicsRasterRange(raster, band = 1)` | `[min, max]` of the valid cells |
| `decimateGeophysicsRaster(raster, maxCells = 160000)` | Downsample by area-weighted mean to at most `maxCells` cells per band. Returns the input unchanged when it is already small enough. |
| `geophysicsRasterFromBands(bands, options)` | Build a raster from flat typed arrays or per-index accessor functions. `options` needs `width` and `height` and can include `maxCells` and the other payload fields. |

### Loaders

| Function | Description |
|---|---|
| `loadGeoTiff(source, { maxCells, samples })` | Read a GeoTIFF from a URL, `Blob`, `ArrayBuffer` or typed array. `samples` picks bands. Returns a promise. |
| `loadErs(header, data, { maxCells, name })` | Read an ER Mapper grid from its `.ers` header and binary data file. Each argument can be a URL, `Blob`, `ArrayBuffer` or typed array. Returns a promise. |
| `readErs(headerText, data, { maxCells, name })` | Synchronous version taking the header text and data buffer |
| `parseErsHeader(text)` | Parse an `.ers` header into nested objects, including brace lists such as `RegistrationCoord` |
| `ersCrs(datum, projection)` | Map an ER Mapper datum/projection pair to an EPSG code, or `null` |

ER Mapper `LATLONG` grids load with `crs_units: 'degree'`. Headers that describe a compressed ECW image rather than a raw grid are rejected with a clear error, because ECW decoding is not supported.

### Processing

Every function returns a new raster and appends a step to `metadata.processing`. Wavelengths and heights are in the grid's linear coordinate units. Reproject geographic grids before processing: geographic/geocentric CRSs and angular `crs_units` are rejected. NoData cells stay NoData in the output.

Projected CRS axis units determine derivative units. Local Cartesian grids can declare `metadata.crs_units` (`m`/`metre`, `ft`/`foot`, `us-ft`/`us_survey_foot`, or `km`/`kilometre`); if omitted, derivatives use `coordinate_unit`. Conflicting CRS/unit metadata is rejected for registered CRSs. For identifiers or definitions that proj4 cannot resolve, explicitly recorded linear `metadata.crs_units` supplies the coordinate contract (GeoTIFF records these from its GeoKeys); without it processing is rejected. `metadata.units` becomes, for example, `nT/m` for first derivatives and analytic signal, `nT/m^2` for 2VD, and `degree` for tilt. Unknown input band units remain `null` for derivatives. Filtering, continuation and RTP preserve band units. Display and sampling of geographic grids remain supported.

| Function | Options |
|---|---|
| `geophysicsLowPass(raster, options)` | `wavelength`, `method` (`'gaussian'` or `'butterworth'`), `order = 4`, `detrend = true` |
| `geophysicsHighPass(raster, options)` | Same as low-pass |
| `geophysicsBandPass(raster, options)` | `longWavelength`, `shortWavelength`, `method`, `order`, `detrend` |
| `geophysicsVerticalDerivative(raster, { order = 1 })` | First or second vertical derivative |
| `geophysicsHorizontalDerivative(raster, { direction = 'east' })` | `'east'` or `'north'` |
| `geophysicsTotalHorizontalDerivative(raster)` | — |
| `geophysicsTiltDerivative(raster)` | Result in degrees, -90 to 90 |
| `geophysicsAnalyticSignal(raster)` | — |
| `geophysicsUpwardContinuation(raster, { height })` | Continuation height |
| `geophysicsReduceToPole(raster, { inclination, declination })` | Degrees. Inclinations shallower than `MIN_RTP_INCLINATION` (15°) are rejected because reduce-to-pole is unstable there. |
| `processGeophysicsRaster(raster, operation, options)` | Dispatch by name: `low_pass`, `high_pass`, `band_pass`, `vertical_derivative`, `horizontal_derivative`, `total_horizontal_derivative`, `tilt_derivative`, `analytic_signal`, `upward_continuation` or `reduce_to_pole` |

**Constants:** `GEOPHYSICS_OPERATIONS`, `GEOPHYSICS_FILTER_METHODS`, `MIN_RTP_INCLINATION`

The JavaScript and Python implementations share one FFT design and are tested against a common fixture, so they agree cell for cell.

### Embedded processing provenance

`encodeErs` and `encodeGeoTiff` embed the same version 1 manifest as Python
(see [Python provenance contract](/api/python#embedded-processing-provenance)).
Set `includeProvenance: false` to omit it. This intentionally replaces the old
writers' metadata-agnostic default: non-JSON metadata now needs normalization
or that explicit opt-out. In-memory `combineGeophysicsRasters` accepts a fourth
options argument `{ includeProvenance: false }` for opaque metadata; the result
records `lineage_omitted: true`. `readErs` and `loadGeoTiff` restore
`metadata.processing` and expose the recorded manifest as `metadata.baselode_provenance`.
Non-JSON/cyclic/non-finite metadata and malformed or unknown manifest versions
raise errors. Readers accept `includeProvenance: false` to skip a damaged or
future manifest explicitly; `metadata.provenance_ignored` and a
`provenance_omitted_on_import` step mark that gap. The decoded manifest limit is 16 MiB. Imported file metadata,
units, names and geometry remain authoritative; GeoTIFF selected samples are
recorded as a one-based `select_bands` step before any decimation.

Producer versions identify the exporter package; direct, unbundled JavaScript
source reports `unversioned`. Persisted source URL fields are stripped of userinfo, query strings and
fragments; the current in-memory `metadata.source` remains the live locator.
Other source references and metadata may include local paths and calibration notes; use the opt-out when these should be omitted.
The embedded record is lineage, not content authentication or an executable recipe.

### Sampling

| Function | Description |
|---|---|
| `sampleGeophysicsRaster(raster, points, { band, method, crs })` | Values at `[x, y]` or `{ x, y }` points, as `number \| null` |
| `sampleGeophysicsRows(raster, rows, { xField, yField, field, band, method, crs })` | Copies of row objects (collars, samples, trace stations) with a sampled field. `xField` and `yField` default to `easting` and `northing`; `field` defaults to the band name. |
| `sampleGeophysicsProfile(raster, vertices, { spacing, band, method, crs })` | `{ distance, x, y, value }` stations along a polyline. `x` and `y` stay in the line's CRS. |
| `geophysicsProfileStations(vertices, spacing)` | The stations alone: every `spacing` units through bends, always including the last vertex |
| `transformCrsPoints(sourceCrs, targetCrs, points)` | Reproject `[x, y]` pairs with the same definitions, for example to lay out a profile line in metres before sampling. Non-finite pairs come back as `[NaN, NaN]`. |

`method` is `'bilinear'` (default) or `'nearest'` (`GEOPHYSICS_SAMPLING_METHODS`). Bilinear interpolates between the four surrounding cell centres and uses the edge cells as they are within half a cell of the grid edge. Points outside the grid, and bilinear samples that would draw on a missing cell, return `null`.

`crs` is the coordinate system of the points. When it differs from the raster's CRS the points are reprojected with proj4 before sampling. Built-in definitions cover WGS84, Web Mercator, WGS84 UTM zones, GDA94 and GDA2020 (geographic and MGA zones 49 to 58) and AGD66/84 (AMG zones); register others with `proj4.defs`. GDA94 and GDA2020 are treated as the same datum, a difference of about 1.8 m. Python, which uses pyproj, can apply the exact shift.

The results match Python's `sample_points`, `sample_table` and `sample_profile`, checked against a shared fixture.

### Editing

| Function | Description |
|---|---|
| `cropGeophysicsRaster(raster, [minX, minY, maxX, maxY])` | The whole cells that overlap the box. Values and `nodata` are unchanged. |
| `clipGeophysicsRaster(raster, polygon, { crop = true })` | Cells whose centres lie outside the polygon become `null`. Takes one ring of `[x, y]` points, a list of rings (inner rings cut holes), or a GeoJSON `Polygon`, `MultiPolygon` or `Feature`. |
| `combineGeophysicsRasters(left, right, operation, options?)` | `'add'`, `'subtract'`, `'multiply'` or `'divide'` (`GEOPHYSICS_COMBINE_OPERATIONS`) with a number or a raster on the same grid. `combineGeophysicsRasters(tmi, regional, 'subtract')` gives a residual. |
| `fillGeophysicsGaps(raster, { maxDistance = null, iterations = 100 })` | Fills missing cells with a smooth surface that joins the data. `maxDistance` limits filling to cells within that many cells of data. |

These follow Python's `crop`, `clip`, `combine` and `fill_gaps` and are checked
against the same fixture. Each one appends a step to `metadata.processing`.

### Writing

| Function | Description |
|---|---|
| `encodeErs(raster, { name, dtype = 'float32', nodata })` | `{ header, data }`: the `.ers` header text and the data file's `ArrayBuffer`. Save the data beside the header, named as the header without `.ers`. Requires a north-up grid. |
| `encodeGeoTiff(raster, { dtype = 'float32', nodata })` | An uncompressed GeoTIFF `ArrayBuffer` with the CRS (when it is an EPSG code), transform, nodata, band names and units |
| `ersCoordinateSpace(crs)` | `[datum, projection, coordinateType]` for an ERS header, for example `['GDA94', 'MGA50', 'EN']` |

`encodeGeoTiff` writes geographic or projected GeoTIFF keys based on what it
knows about the CRS. It checks a registered proj4 definition first, then the
Australian and WGS84 systems ERS names, then the raster's `metadata.crs_units`.
It refuses an EPSG code it cannot classify and asks for `crs_units`.

Both formats read back with `readErs`, `loadGeoTiff`, Python's `load_raster`
and GDAL. The ERS bytes match Python's `write_ers`. `dtype` is `'float32'`,
`'float64'`, `'int8'`, `'uint8'`, `'int16'`, `'uint16'`, `'int32'` or `'uint32'`.

### Rendering

| Function | Description |
|---|---|
| `renderGeophysicsRaster(raster, options)` | Colour one band into RGBA pixels. Options: `band = 1`, `palette = 'viridis'`, `reversePalette`, `stretch` and `hillshade`. Returns `{ data, width, height, range, ... }`, ready for `ImageData`. |
| `geophysicsHillshade(raster, options)` | Illumination grid for `band`, `azimuth`, `altitude` and `zFactor` (a number or `'auto'`) |
| `geophysicsHillshadeZFactor(raster, band = 1)` | The `'auto'` z-factor. It scales the 95th-percentile gradient to a 45° slope, so relief looks comparable whatever the data units. |
| `createGeophysicsStretch(values, stretch, nodata)` | Resolve a stretch into `{ limits, toRatio, valueAt }` |
| `normalizeGeophysicsStretch(stretch)` | Fill defaults for a partial stretch |
| `geophysicsScaleColor(palette, ratio, reverse)` | `[r, g, b]` for a ratio from 0 to 1 |
| `geophysicsColorGradient(palette, reverse)` | CSS `linear-gradient` for a colour bar |

Stretch modes (`GEOPHYSICS_STRETCH_MODES`):

- `{ mode: 'relative', low: 2, high: 98 }` sets percentile limits and is the default.
- `{ mode: 'absolute', min, max }` uses limits in data units.
- `{ mode: 'equalize' }` applies histogram equalisation.

**Constants:** `GEOPHYSICS_PALETTES`, `GEOPHYSICS_COLOR_SCALES`, `DEFAULT_GEOPHYSICS_STRETCH`, `DEFAULT_GEOPHYSICS_HILLSHADE`

### `<GeophysicsRasterViewer>`

React component that draws a raster on a canvas. It includes a colour bar, a summary, a cursor read-out, and controls for palette, stretch and hillshade.

| Prop | Default | Description |
|---|---|---|
| `raster` | required | Raster object or payload |
| `band` | `1` | Band to display |
| `units` | — | Label for the colour bar and read-out |
| `value` / `onViewChange` | — | Controlled view state: `{ palette, reversePalette, stretch, hillshade }` |
| `defaultView` | — | Initial view when uncontrolled |
| `showControls`, `showColorbar`, `showSummary`, `showCursorValue` | `true` | Toggle each part of the viewer |
| `height` | `420` | Canvas height in pixels |
| `className` | `''` | Extra CSS class |

`resolveGeophysicsView(view)` merges a partial view over the defaults.

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

## Local X/Y plan view

`createPlanView(container, options)` creates a Canvas plan view for points in a local coordinate frame. It has no geographic CRS, basemap, tile requests or plotting-library dependency. X and Y retain equal scale, with increasing Y upward.

```javascript
import { createPlanView } from 'baselode';

const view = createPlanView(container, {
  xProp: 'x', yProp: 'y', idProp: 'sample_id', groupProp: 'group', unit: 'm',
  colors: { samples: '#1a1c1c' },
});
view.setPoints([{ x: 120, y: -80, sample_id: 'S1', group: 'samples' }]);
view.fitToData();
// On unmount:
view.destroy();
```

Drag or use arrow keys to pan. Use the wheel, +/− buttons or keys to zoom; wheel zoom preserves the coordinate under the pointer. Home, double-click and Fit restore the data extent. Hover shows point identifiers and coordinates. A scale bar and group legend retain spatial context. Point rendering uses Canvas for dense datasets.

`setPoints(rows, {fit: true})` replaces observations and reports excluded null, blank or nonfinite coordinates through `getView().excludedCount`. Coordinate strings are accepted when numeric. `resize()` supports hidden/revealed hosts; `getView()` reports the viewport and point count. `destroy()` removes owned DOM, events and resize observers. Host colours, font, point radius and optional `onPointClick`/`onViewChange` callbacks are configurable. The math helpers `fitPlanView`, `planToScreen`, `screenToPlan`, `zoomPlanView` and `panPlanView` are also exported.

### Discoverable operations and saved workflows

The main and `baselode/geophysics` entries export `listGeophysicsOperations()`,
`describeGeophysicsOperation(id)`, `geophysicsWorkflowSchema()`, `magneticGridRecipe()`,
`validateGeophysicsWorkflow(workflow, inputs)` and `runGeophysicsWorkflow(workflow, inputs)`.
They share the [Python workflow contract](/api/python#discoverable-operations-and-saved-workflows),
including snake_case recipe parameters, scientific context, states, limits and exclusions.
Unknown descriptions throw `RangeError`; validation failures return structured issues.
Execution is synchronous and retains full-resolution artifacts.

```javascript
import { magneticGridRecipe, validateGeophysicsWorkflow, runGeophysicsWorkflow } from 'baselode/geophysics';

// grid is an already-corrected anomaly raster with explicit field_type, units and CRS.
const recipe = magneticGridRecipe();
recipe.steps[0].parameters.height = 100; // choose for this survey, in CRS linear units
const check = validateGeophysicsWorkflow(recipe, { magnetic: grid });
const result = runGeophysicsWorkflow(recipe, { magnetic: grid });
if (result.state === 'ok') console.log(result.artifacts.edges);
else console.log(result.issues);
```

Use `createGeophysicsRaster` to construct inputs. Recipes never load files, infer
calibration, generate code or silently apply observation corrections. For UI responsiveness,
run the synchronous executor in a Web Worker for larger grids.

### Observation records and survey QC

The main and `baselode/geophysics` entries export `createGeophysicsObservations(payload)`,
`geophysicsObservationSchema()`, `describeGeophysicsObservationQc()` and
`qcGeophysicsObservations(payload, options)`. They use the same snake_case payloads/options,
flags, coverage and resource limits as the [Python observation/QC contract](/api/python#observation-records-and-survey-qc).
The constructor throws for bad contracts; QC returns `ok`, `needs_input` or `rejected`.

```javascript
import { createGeophysicsObservations, qcGeophysicsObservations } from 'baselode/geophysics';
const observations = createGeophysicsObservations({
  crs_units: 'm', channels: { mag: { field_type: 'magnetic_total_field', units: 'nT' } },
  records: [
    { id: 'a', line_id: 'L1', x: 0, y: 0, time: 1000, values: { mag: 50100 } },
    { id: 'b', line_id: 'L1', x: 10, y: 0, time: 1001, values: { mag: null } },
  ],
});
const report = qcGeophysicsObservations(observations, { max_speed: 8 });
console.log(report.flags, report.coverage);
```

Time is UTC epoch seconds. QC is synchronous, preserves the observations and acquisition
order, and never converts coordinates or applies corrections. Spike flags are candidates,
not instructions to remove geological signals. Use a worker for larger surveys.

### Baseline observation gridding and spatial validation

The main and `baselode/geophysics` entries export `describeGeophysicsGridding()`,
`gridGeophysicsObservations(payload, options)` and
`crossValidateGeophysicsGridding(payload, options, validation)`. They share the
[Python gridding contract](/api/python#baseline-observation-gridding-and-spatial-validation),
including snake_case options, explicit XY/elevation assumptions, support/hull rules,
line/block holdouts, exclusion buffers, structured states and resource limits.

```javascript
import { gridGeophysicsObservations, crossValidateGeophysicsGridding } from 'baselode/geophysics';
const interpolation = { channels: ['mag'], radius: 200, duplicate_policy: 'mean', elevation_policy: 'ignore' };
const result = gridGeophysicsObservations(observations, {
  ...interpolation, bounds: [400000, 6500000, 401000, 6501000], shape: [40, 40],
});
if (result.state === 'ok') console.log(result.artifacts.grid, result.artifacts.support);
const validation = crossValidateGeophysicsGridding(observations, interpolation, { by: 'line', buffer_distance: 25 });
console.log(validation.summary, validation.issues);
```

Field raster cells are null when unsupported; support/count/distance/extrapolation artifacts
remain full resolution. APIs are synchronous: use a Web Worker for larger bounded jobs.
They never apply observation corrections or infer a common height from draped observations.

### Raster alignment, resampling and horizontal reprojection

The main and `baselode/geophysics` entries export `describeGeophysicsAlignment()`,
`alignGeophysicsRaster(source, target, options)` and
`matchGeophysicsRaster(source, reference, options)`. They follow the
[Python alignment contract](/api/python#raster-alignment-resampling-and-horizontal-reprojection),
with snake_case target/options and null for unsupported samples. Public types
include `GeophysicsAlignmentTarget`, `GeophysicsAlignmentOptions` and
`GeophysicsAlignmentReport`.

```javascript
import { alignGeophysicsRaster } from 'baselode/geophysics';
const report = alignGeophysicsRaster(source, {
  shape: [100, 120], transform: [50, 0, 400000, 0, -50, 6800000], crs: 'EPSG:28350',
}, { method: 'bilinear', value_kind: 'continuous' });
if (report.state === 'ok') {
  const { raster, support, footprint, coordinate_valid } = report.artifacts;
}
```

Use `datum_policy: 'backend'` for supported CRS changes. JS uses the existing
proj4 registry, including approximate Australian datum definitions; Python uses
pyproj/PROJ with ballpark transforms disabled. Reports record the backend/version.
Datum changes have no exact cross-runtime accuracy guarantee. Categorical codes
require nearest; local grids require matching explicit frame IDs/units. No field
unit conversion, vector/height/epoch transformation, antialiasing or uncertainty
propagation occurs. Reference grids contribute geometry only. Check report state
before reading artifacts and inspect support/footprint/coordinate-valid masks.

### Equivalent-source Python backend contracts

`describeGeophysicsEquivalentSources()` is exported from the main and
`baselode/geophysics` entries. It returns the identical descriptor used by
[Python's elevation-aware adapter](/api/python#elevation-aware-equivalent-source-gridding),
including a versioned `request_schema`, `result_contract`, applicability and
resource limits. **Numerical execution is Python-only** with the optional
`baselode[potential-fields]` extra. JavaScript provides no solver or automatic
network calls; a host routes a request to Python `run_equivalent_sources`.

```typescript
import {
  describeGeophysicsEquivalentSources,
  type GeophysicsEquivalentSourceRequest,
  type GeophysicsEquivalentSourceReport,
} from 'baselode/geophysics';
const request: GeophysicsEquivalentSourceRequest = {
  schema: 'baselode.geophysics.equivalent_source_request', version: 1,
  operation: 'grid', observations,
  options: {
    channel: 'mag', depth: 100, damping: 1e-6, radius: 150,
    duplicate_policy: 'mean', bounds: [0, 0, 100, 100], shape: [5, 5], target_height: 50,
  },
};
```

The Python JSON runner returns full-resolution raster payloads accepted by
`createGeophysicsRaster`, with null missing cells. Public request/report types
cover grid and line/block validation, depth/damping candidates, residuals,
coverage and best-index selection. Always inspect state, issues and support;
partial coverage never produces a selected candidate. Target height, height
datum, positive-up convention and matching linear XY/height units are explicit.
No uncertainty propagation or recovered-geology interpretation is implied.

### Correction ledger and magnetic base correction

Both public entries export `describeGeophysicsCorrections()` plus asynchronous
`inspectGeophysicsCorrections(payload)`,
`declareGeophysicsCorrections(payload, declarations)` and
`correctGeophysicsMagneticBase(survey, base, options)`. They follow the
[Python correction contract](/api/python#observation-correction-ledger-and-magnetic-base-correction)
and use the same snake_case schemas and JSON reports. Public types cover the
ledger, events, declarations, options, per-reading proposals and report.

```javascript
import { correctGeophysicsMagneticBase } from 'baselode/geophysics';
const report = await correctGeophysicsMagneticBase(survey, base, {
  channel: 'mag', base_channel: 'base', reference: 50000, max_gap: 30,
  event_id: 'diurnal-1', evidence: 'Raw histories, base QC and clocks checked',
  clock_policy: 'synchronized',
});
if (report.state === 'ok') {
  const corrected = report.observations;
}
```

Both selected channels require known unapplied diurnal history. Native Web Crypto
SHA-256 makes these three APIs asynchronous and requires Node 20+ or a secure
browser context. Missing Web Crypto returns actionable needs_input. Descriptor
access is synchronous. Data bindings and replay agree with Python; producer
version strings may differ. No network calls or extra dependency are needed.
Incomplete base coverage returns proposals and no corrected observations; existing
applied history cannot be reset or forced. Preserve raw data and ledger metadata.
Only magnetic base correction is executable here; the other registered names
record history for future calculators.

### IGRF14 contracts and correction history

`describeGeophysicsIgrf()` is exported from `baselode` and
`baselode/geophysics`. It returns independent copies of the shared request and
result schemas, removal options, fixed model/coefficient identity, scientific
conventions, domain limits and Python installation instructions. TypeScript
exports `GeophysicsIgrfRequest`, `GeophysicsIgrfPoint`,
`GeophysicsIgrfRemovalOptions`, `GeophysicsIgrfField`, `GeophysicsIgrfModel` and
`GeophysicsIgrfReport` and `GeophysicsIgrfRemovalReport`.

Execute `calculate_igrf` / `remove_igrf` in Python with `baselode[magnetics]`.
JavaScript has no IGRF numerical backend. Its existing asynchronous
`inspectGeophysicsCorrections` and `declareGeophysicsCorrections` validate and
replay Python IGRF application events, including model identity, bindings,
legacy summaries and known-state guards. Requests use WGS84 geodetic degrees,
ellipsoidal metres and UTC Unix seconds; results use geodetic north/east/down
nT and east/down-positive declination/inclination degrees. See the Python API
for supported dates, resource bounds and scalar-removal assumptions.

### Magnetic survey lag correction

`correctGeophysicsMagneticLag(observations, options)` is an asynchronous native
API exported from `baselode` and `baselode/geophysics`. It shares the Python
lag options, scalar interpolation, support/mask semantics and correction ledger.
`describeGeophysicsCorrections().lag_parameters` describes required options:
`channel`, `lag_seconds`, `max_gap`, `unsupported_policy` (`reject` or `mask`),
`event_id`, calibration `evidence` and `clock_policy="synchronized"`.

Positive lag advances delayed readings: **corrected(t)=input(t+lag_seconds)**.
Navigation XYZ/time and other channels remain unchanged. Only original values
within a contiguous line segment are interpolated, with no extrapolation or
bridging nulls/excessive gaps. Timestamp comparisons use binary64 with no
implicit snapping tolerance. All records need line IDs and strictly increasing
per-segment UTC times. Explicit masks archive unsupported original values in
`masked_records`; reject mode commits no output on incomplete coverage. A run
needs at least one supported reading. Existing target nulls stay null.

TypeScript exports `GeophysicsMagneticLagOptions`,
`GeophysicsMagneticLagProposal` and `GeophysicsMagneticLagReport`; application
events narrow on `correction="magnetic_lag"`. Native Web Crypto supplies the
ledger binding (Node 20+ or secure browser context). Work is bounded to 4096
records and +/-3600 seconds. Ledger validators reconstruct pre-event nonnull
counts across later masks, preserving earlier base/IGRF history. See the Python
API for calibration, processing-order and uncertainty assumptions.

### Calibrated magnetic heading bias

`correctGeophysicsMagneticHeading(observations, options)` is a native asynchronous
API in `baselode` and `baselode/geophysics`, matching Python's scalar heading
correction. Types include `GeophysicsHeadingCalibrationNode`,
`GeophysicsMagneticHeadingOptions`, `GeophysicsMagneticHeadingProposal` and
`GeophysicsMagneticHeadingReport`. `describeGeophysicsCorrections()` publishes
`heading_parameters`, `heading_context` and the supplementary binding protocol.

The supplied calibration is observed-minus-reference bias in nT:
**corrected=observed-bias(heading)**. Circular linear interpolation includes the
north seam and enforces `max_heading_gap`; exact nodes remain usable. Options
name the channel, extra heading key, reference frame, calibration ID/table,
gap limit, sign convention, event ID and evidence. Metadata declares
`heading={key,units:'degrees',reference,positive:'clockwise'}` matching options.
References are explicitly true, magnetic or grid north. Recorded headings are
[0,360], where 360 evaluates as 0; calibration nodes are unique in [0,360).

Every nonnull selected reading must be supported before committing output.
Missing magnetic readings stay null; all supplied nonnull headings must be
valid. Unsupported/missing headings return proposals and `needs_input`, with
no output/event. There is no inferred heading, automatic calibration fit,
frame conversion, heading masking, 3D compensation or uncertainty propagation.
Input, other channels, geometry/time, field types and acquisition order remain.

Native Web Crypto binds source headings/context and semantic calibration/options
in addition to observation values/geometry. All public correction methods remain
asynchronous; ledger inspection also awaits heading-binding verification.
This detects edited heading/model metadata through subsequent lag masks.
Execution is bounded to 4096 records/72 nodes; see Python API for full semantics.

### Crossover QC and fixed-reference line levelling

`describeGeophysicsCrossovers()`, `analyzeGeophysicsCrossovers(observations,
options)` and `levelGeophysicsMagneticLines(observations, options)` are exported
from main and `baselode/geophysics`. Numerical execution is native JavaScript,
matching Python. Shared schemas describe geometry/elevation policies, resource
bounds and the constant-offset strategy. TypeScript exports crossover options,
records/reports, magnetic levelling options/proposals/report and line offsets.

Analysis interpolates scalar values at straight-segment XY intersections in a
common projected/local frame. Explicit segment-length, acute-angle, endpoint
intersection-tolerance and elevation policies control support. Shared vertices
count once; repeat-path measurements remain distinct. Null source readings are
not bridged; exact endpoint readings remain usable. Geographic coordinates,
missing XY/line context, repeated/disjoint line IDs or tiny consecutive geometry
require preprocessing/QC. Resource failures return no partial crossing table.

Levelling fixes explicit reference lines and subtracts one equally weighted
mean target-minus-reference bias from each target line. Every target must pass
minimum crossing/reference counts, correction-size and post-fit RMS gates before
an atomic application. The constant applies over the whole target, including
beyond ties; no polynomial drift, global network solve or microlevelling is
claimed. Model/context SHA-256 complements the data binding and survives later
lag masks. Native Web Crypto requires Node 20+ or a secure browser context.
No new dependency or uncertainty propagation; see Python API for all contracts.
