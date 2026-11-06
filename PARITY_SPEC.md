# Baselode JS/Python Parity Spec

## Goal

Keep the JavaScript module and Python package aligned in capability and naming intent, while allowing language-native return types and runtime differences.

## Scope

The two implementations should remain aligned for:

1. Data loading + column normalization for collar, survey, assay tables
2. Desurveying workflows
3. 1D strip/trace plotting helpers
4. 2D plan/section mapping helpers
5. 3D drillhole payload/scene helpers
6. Spatial extent bounds, CRS normalisation, reprojection, and center helpers
7. Block model primitive: grid definition + transforms, sub-block operations, validation, tonnage, diff
8. Geophysics raster filters and enhancements: numerical results, coordinate validation, derived band units, processing records and embedded version 1 provenance

## Runtime differences (intentional)

- JavaScript favors browser/runtime-native structures (arrays/objects, interactive scene APIs).
- Python favors DataFrame-centric workflows and figure/dataframe utilities.
- JS `loadTable` supports CSV/array sources in-browser; SQL/Parquet are out of runtime scope and should fail clearly.
- JavaScript specialized loaders expose synchronous `*FromRows` cores so
  external format decoders can supply structured rows without a CSV round
  trip; CSV functions remain adapters over the same domain transformations.
- 3D parity target is payload-level parity in both languages; interactive renderer remains JS-first.
- JavaScript `Extent` adds GeoJSON Polygon/Feature helpers; Python callers can
  use the existing Shapely `bbox` geometry for equivalent geometry workflows.
- Scientific processing of unresolved CRS identifiers/definitions requires explicit
  linear `metadata.crs_units`. The Python CRS database can resolve identifiers
  that the JavaScript proj4 registry cannot; JS requires that metadata in those
  cases rather than guessing a physical unit.
- CRS engines are runtime-native (`proj4` in JavaScript, `pyproj` in Python),
  with shared EPSG behavior and tolerance-based numeric parity checks.

### Python-first (no JS counterpart yet)

These belong in JS eventually but aren't there today. Listed here so the gap is intentional and tracked, not silent:

- **`baselode.adaptors.raw_gswa`** — HTTP client + SQL builders + DataFrame
  converters for the GSWA raw schema. Python-only. JS callers wanting GSWA
  data should hit the HTTP API directly through their own client and feed
  the results to JS loaders manually until a JS adaptor exists.
- **`baselode.drill.data.bundle_extras`** — folds non-canonical columns
  into a per-row `extra` dict matching the canonical
  `BASELODE_DATA_MODEL_*` schemas. JS publishes the matching `EXTRA`
  constant and includes the field in every schema, but does not yet have
  a JS `bundleExtras` helper to populate it.

When a JS counterpart lands, move the entry into the appropriate parity
contract capability and remove it from this list.

## Canonical parity contract

Machine-readable contract lives at:

- [test/data/parity_contract.json](test/data/parity_contract.json)

This file is the primary checklist for symbol-level parity and should be updated alongside API changes.

## Parity checks

Automated checks live at:

- [test/test_parity_contract.py](test/test_parity_contract.py)

Checks include:

- Python symbols listed in the contract are importable and present.
- JS barrel export file declares all contracted symbols.

## Change process

When adding/removing parity APIs:

1. Implement API change in both languages (or document intentional divergence).
2. Update [test/data/parity_contract.json](test/data/parity_contract.json).
3. Ensure [test/test_parity_contract.py](test/test_parity_contract.py) passes.
4. If divergence is intentional, add rationale under "Runtime differences" in this file.

## Geophysics operation catalogue and workflow v1

Python `baselode.geophysics.{list_operations,describe_operation,workflow_schema,magnetic_grid_recipe,validate_workflow,run_workflow}` corresponds to JavaScript `{listGeophysicsOperations,describeGeophysicsOperation,geophysicsWorkflowSchema,magneticGridRecipe,validateGeophysicsWorkflow,runGeophysicsWorkflow}` (main and `baselode/geophysics` entries). Both use the packaged operation catalogue, workflow schema and magnetic-grid recipe; a Python test checks the JSON copies match. Snake_case parameter names, graph semantics, structured states and resource bounds are shared. The workflow reference fixture checks numerical replay at 1e-10 tolerance; analytical plane tests independently check gradient and regional/residual wiring.

Execution uses existing kernels. Backend/library version strings intentionally differ by runtime. Python artifacts are GeophysicsRaster instances; JS artifacts use its portable raster shape. In workflow v1, arithmetic is restricted to add/subtract with exactly aligned, equally banded grids and matching unit strings/field types, although direct arithmetic APIs support additional cases. Direct APIs retain their existing metadata/context contracts. Sampling, display products, file I/O, gap filling/cropping, observation corrections, hashes, correction ledgers and arbitrary plugin registration are not workflow v1 operations. Later increments extend the allowlist/contracts explicitly.

## Geophysics observations and survey QC v1

Python `create_observations`, `observation_schema`, `describe_observation_qc`, `qc_observations` correspond to JavaScript `createGeophysicsObservations`, `geophysicsObservationSchema`, `describeGeophysicsObservationQc`, `qcGeophysicsObservations` (main and geophysics entries). Both use the shared v1 observation schema/QC descriptor and snake_case data/options. A shared synthetic survey fixture plus independent analytical checks cover flags, acquisition-order line segments, native-unit speeds, median-window candidates, missing context and sample standard deviation. Producer package versions intentionally differ. Python fsum and JS Neumaier sums can differ in last-bit rounding; the shared QC report fixture compares numbers at relative/absolute 1e-12 tolerance (structural fields/flags exact). This documented numerical trade-off does not promise bitwise statistics across runtimes. Unpaired Unicode surrogates in strings/keys are rejected in both; valid pairs normalize to Unicode scalars. Blank labels and unit/CRS context use an explicit shared whitespace set, including BOM and legacy separators. JSON copying canonicalizes signed zero to zero in both data and QC options.

Observation normalization preserves declared values/order and correction states, copies JSON extensions and fills absent nullable fields/readings with null. It neither applies corrections nor converts coordinates. QC never repairs/drops data. Record ID is a unique measurement identity; station_id may repeat. All records in one payload use the same CRS and per-channel units. Physical thresholds require linear coordinates and measured clearance has explicit height_units. Geographic/basic observation records remain usable for checks that do not need distances. The direct observation QC API is outside the existing raster-only workflow v1; observation graphs, gridding, crossovers/levelling, correction ledgers and equivalent sources remain subsequent increments.

## Geophysics baseline gridding and spatial validation v1

Python `describe_gridding`, `grid_observations`, `cross_validate_gridding` correspond to JavaScript `describeGeophysicsGridding`, `gridGeophysicsObservations`, `crossValidateGeophysicsGridding` (main and geophysics entries). Both package the same gridding descriptor and use snake_case options. Shared fixtures compare grid/support/distance/count/extrapolation artifacts and line-validation reports at relative/absolute 1e-10 tolerance; independent analytical tests check IDW weights, symmetric affine samples, injected held-out offsets, hull/radius boundaries and leakage exclusions. Numeric producer versions intentionally differ. Coordinate orientation uses normalized vectors with a 1e-12 angular cross-product tolerance; no exact-arithmetic geometry is claimed.

These are direct observation APIs, separate from raster-only workflow v1. They produce full-resolution north-up cell-centred rasters, with NaN (Python) / null (JS) for unsupported field values. Bounds are outer edges and shape is rows/columns. Same-field-type channels retain distinct unit labels without conversion. Explicit duplicate mean/reject and elevation_policy=ignore are mandatory. Elevation is not reduced to a common surface. Extrapolation is masked by default; allowing it retains radius/minimum support and returns hull diagnostics. Holdouts leave out entire declared lines or explicit-origin blocks; all colocated training rows are excluded before duplicate aggregation and a buffer can remove a wider halo. Coverage accompanies paired-only errors, which are not calibrated geological uncertainty. Resource caps bound grid/pair/fold work rather than exact peak memory or wall time.
