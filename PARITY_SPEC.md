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

## Geophysics scalar raster alignment v1

Python `describe_alignment`, `align_raster`, `match_raster` correspond to JavaScript `describeGeophysicsAlignment`, `alignGeophysicsRaster`, `matchGeophysicsRaster`. Both package the identical descriptor and accept snake_case target/options. Same-CRS shared fixtures use 1e-10 numeric tolerance; independent affine-plane, Web Mercator and UTM central-meridian tests establish analytical expectations. Producer/backend versions intentionally differ. Both reuse existing nearest/bilinear nodata and outer-edge rules (1e-7 pixel tolerance), support rotated/sheared affine geometry, and return raster/support/footprint/coordinate_valid artifacts. Python missing values are NaN, JavaScript null.

Cross-CRS pairs are limited to the descriptor's shared horizontal EPSG set and require explicit `datum_policy='backend'`. Python uses pyproj/PROJ with always_xy and allow_ballpark=False; JS uses the existing proj4 registry, including approximate Australian datum definitions. Backend identity/version is recorded; datum changes have no cross-runtime accuracy or exact numeric parity guarantee. Neither runtime transforms heights, rotates vector components, converts field units, propagates uncertainty, performs antialiasing or area-conservative averaging. Categorical safe-integer codes require nearest. Local grids require matching explicit frame IDs and coordinate units; custom equal CRS labels require units. Target shape/transform/CRS are explicit, with bounded work and no automatic extent inference. Stale geometry/uncertainty metadata remains in flat input lineage. Reference grids supply geometry only. Direct APIs leave raster workflow v1 unchanged.

## Elevation-aware equivalent sources v1 (Python numerical backend)

Python `describe_equivalent_sources`, `grid_equivalent_sources`, `cross_validate_equivalent_sources` and `run_equivalent_sources` provide an optional Harmonica 0.7.x adapter. JavaScript `describeGeophysicsEquivalentSources` (main and geophysics entries) returns the identical packaged descriptor, request schema, resource limits and result contract. The public TypeScript request/report types describe transport to a Python host. This is an intentional numerical parity gap: there is no JavaScript equivalent-source solver, no built-in RPC/network client, and no implicit addition to raster workflow v1. The JSON runner dispatches only registered grid/cross_validate operations and returns full-resolution raster payloads suitable for the JS raster constructor; unsupported field cells are null. Direct Python grid calls return GeophysicsRaster instances.

The bounded adapter models one scalar anomaly using a 1/r kernel, fixed training-derived source plane and explicit depth/damping. It requires actual elevations, positive-up convention and shared vertical datum with matching linear XY/height units. Common-height grid prediction allows only heights at/above the used observation maximum. Line/block holdouts refit after XY colocation/buffer exclusions; all fit-derived geometry comes from each training subset. Exact XYZ duplicates are explicitly averaged/rejected, while different heights remain separate. Geometric support/hull diagnostics and paired-only errors accompany predictions; ranking requires complete held-out coverage. Tuning scores are not independent final generalization error. Coefficients are a field representation, not recovered geology. Tests use independent harmonic fields, including noise/gaps/off-layer sources, plus portable request/schema, package and provenance checks; no cross-runtime numerical equivalence is claimed.

## Observation correction ledger and magnetic base correction v1

Python `describe_corrections`, `inspect_corrections`, `declare_corrections` and `correct_magnetic_base` correspond to JavaScript `describeGeophysicsCorrections`, `inspectGeophysicsCorrections`, `declareGeophysicsCorrections` and `correctGeophysicsMagneticBase` in both public entries. The descriptor/ledger schema, registered aliases, snake_case options, report and shared numeric/SHA-256 fixture are identical. JS inspection/declaration/correction APIs return Promises because they use native Web Crypto (Node 20+ or a secure browser context); descriptor access is synchronous. Python uses hashlib. No new dependency is introduced. Cross-runtime replay validates a Python-corrected document in JS, applies a second channel there, and validates that result in Python. Producer package version strings intentionally differ and are outside the data binding.

SHA-256 input is compact UTF-8 JSON arrays in the exact order documented by the shared descriptor: fixed version marker, CRS/coordinate-unit labels, ASCII-sorted channel name/field-type/unit tuples, and acquisition-order observation IDs/geometry/time/clearance/station/line/readings. Numeric fields are lowercase big-endian binary64 hexadecimal strings; signed zero canonicalizes and null remains null. Finite binary64 values up to +/-1e100 are supported; Python integers must be exactly representable to avoid lossy hashing. Metadata/extensions are excluded. Unicode scalar normalization follows the observations API. This is a consistency guard, not authentication against stripped/rewritten history. Ledger events validate binding continuity, producer/ID/schema, per-channel transitions and complete application counts. Unknown is the default; known history cannot be reset. Legacy aggregate aliases are conservatively imported and synchronized with per-channel states.

Both selected survey and base stream must have known unapplied magnetic_diurnal history. Base correction subtracts interpolated base minus explicit reference in nT; it preserves field type, other channels, missing readings and acquisition order. Base timestamps strictly increase; stationary station identity and synchronized UTC clock acknowledgement are explicit. Null base readings, missing survey times, excessive brackets and exterior times prevent an atomic application; exact valid base samples remain usable. Reports retain proposals and coverage but return no corrected observations unless every nonnull selected reading is supported. Inputs remain unchanged. Uncertainty moves to flat input lineage and is not propagated. Other correction IDs are history-only in this increment. Raster workflow v1 remains unchanged.

Correction input and base snapshots use two ordinary processing steps (`magnetic_base_input`, then `correct_magnetic_base`), each with the standard `operand_lineage` reference. Existing graph-merging/remapping/bounds checks therefore apply to both references without a new provenance field/version. Option/declaration limits count compact UTF-8 JSON identically in Python and JS; tests exercise one byte below and above 256 KiB.

Successful inspect/declaration/application reports all return an independent ledger copy. Output observation JSON includes lineage in its 16 MiB budget; overflow is an atomic resource rejection in both runtimes.

### IGRF14 reference field contracts

Python `describe_igrf` and JavaScript `describeGeophysicsIgrf` expose identical
packaged JSON schemas, model/coefficient/convention identity and bounds.
`calculate_igrf` / `remove_igrf` execute only in Python through the optional,
version-pinned ppigrf backend (`baselode[magnetics]`). This is an intentional
numerical execution gap; JavaScript publishes request/result types and validates
IGRF application events with its existing correction-ledger APIs. A live
Python-to-JavaScript-to-Python integration test verifies replay, model integrity,
state guards and subsequent declarations. Official BGS IGRF14SYN fixture values
independently check all field components within 0.05 nT and angles within 0.001
degree, covering historical/forecast epochs, hemispheres and heights. UTC dates
map to decimal-year coefficient interpolation to match the official model.
Raster workflow v1 remains unchanged.

### Magnetic survey lag correction

Python `correct_magnetic_lag` corresponds to asynchronous JavaScript
`correctGeophysicsMagneticLag` in both main/geophysics entries. Both publish the
same correction descriptor, lag parameters, strict application-event union and
mask semantics. Independently specified affine/pulse fixtures cover sign,
fractional/integer/zero lag and irregular times; live bidirectional execution
checks shared binary64 bindings and subsequent per-channel masks. Numerical
interpolation compares at 1e-12 tolerance; structural support, masks, source IDs
and history match exactly. Timestamp equality/exterior decisions are binary64
with no implicit tolerance. Producer library versions may differ.

Lag affects one selected nT total-field/anomaly signal on unchanged XYZ/time,
inside acquisition-contiguous line segments. Explicit reject/mask policy,
calibration/clock context and gap/resource bounds prevent silent extrapolation
or data drops. Ledger affected_records counts readings immediately before each
application; validators reconstruct historical counts backwards across archived
lag masks, so prior base/IGRF applications remain valid. Source metadata,
uncertainty and remappable lineage persist through exports. Raster workflow v1
remains unchanged; no heading, inferred lag, physical sensor-path calculation,
operation reordering or uncertainty propagation is claimed.

### Calibrated magnetic heading bias

Python `correct_magnetic_heading` matches asynchronous JavaScript
`correctGeophysicsMagneticHeading` (main and geophysics entries). Both use the
shared heading parameters/context, strict event union and binding protocol.
Independent cardinal/oblique/north-seam fixtures recover signed scalar bias;
live bidirectional execution checks generic and supplementary SHA-256 bindings,
including Unicode IDs, sorted copied calibrations and later channel applications.
Numerical interpolation compares at 1e-12; structural support/model/mask history
and portable bindings match exactly, apart from producer package versions.

The extra heading binding covers semantic calibration/options, explicit frame
context and every ID/raw heading using the documented float64 hex protocol.
It catches edits to fields intentionally excluded from the original general
binding, and survives later lag masks because headings are preserved. Native
JS internal validation awaits Web Crypto; existing public APIs stay asynchronous.
Neither runtime fits calibration, derives heading from track, changes reference
frame, masks unsupported heading records or claims 3D compensation/uncertainty
propagation. Existing raster workflow v1 remains unchanged.

### Crossover QC and fixed-reference DC line levelling

Python describe_crossovers/analyze_crossovers/level_magnetic_lines correspond to
JS describeGeophysicsCrossovers/analyzeGeophysicsCrossovers/levelGeophysicsMagneticLines
(main and geophysics entries). Packaged descriptors, parameter/result schemas,
geometry/elevation policies and strict bound model events match. Independent
analytical affine-field fixtures recover known signed target-line offsets with
fixed references. Shared-vertex topology, endpoint support, oblique angles,
height/null/gap/quality policies, ledger replay and source exports are tested.

Both runtimes use scaled binary64 cross products and the same bounded X sweep,
Neumaier sums and topology dedup rules. Geometry/fit values compare at 1e-10;
no general bitwise arithmetic guarantee across language math libraries is made.
Actual generated data/model bindings remain portable for replay, and analytical
fixture outputs/bindings match exactly in live bidirectional execution. Native
JS correction APIs remain asynchronous for Web Crypto. Raster workflow v1 stays
unchanged. This is fixed-reference one-DC-bias-per-target levelling; higher-order,
network, outlier-removal and microlevelling methods remain separate increments.

Observation reprojection: Python `describe_reprojection` / `reproject_observations`
and JavaScript `describeGeophysicsReprojection` / `reprojectGeophysicsObservations`
share the WGS84 geographic/UTM contract, event schema, atomic support rules and
history-context replay. Python uses pyproj (always XY, no ballpark), JavaScript
uses private explicit Proj4js WGS84 definitions. Heights/measurements/headings
remain unchanged. Numerical parity tests use 1e-6 m / 1e-8° tolerances; exact
ledger replay uses exchanged JSON, preserving backend identity and exact floats.
Shared descriptor: `geophysics_reprojection.json`. Independent central-meridian
anchors and rounded published PROJ examples cover both hemispheres; live runtime
tests replay prior levelling across geographic/projected contexts in both languages.

Observation workflows: `describe_observation_workflow`,
`validate_observation_workflow`, `run_observation_workflow` and
`magnetic_observation_recipe` match asynchronous JavaScript
`describeGeophysicsObservationWorkflow`, `validateGeophysicsObservationWorkflow`,
`runGeophysicsObservationWorkflow` and `magneticObservationRecipe`. Shared contracts
and example JSON define allowlisted ordered stages, typed references, explicit QC,
atomic output gates and resource bounds. Python executes optional IGRF; JavaScript
reports `needs_input` before any execution when IGRF is requested. Preflight checks
structure/history/backend/budgets, while each native stage validates scientific
values/context. Independent line-offset recovery, exact nearest grid and analytical
grid gradient, saved JSON replay, live binding/ledger parity and export persistence
are tested. Existing raster workflow v1 remains unchanged.

Normal gravity: Python `describe_normal_gravity`, `calculate_normal_gravity` and
`remove_normal_gravity` use the optional pinned Boule 0.6.0 backend plus the analytic
normal-potential beta component to return full gradient magnitude. JavaScript
`describeGeophysicsNormalGravity` exposes identical schemas/models; native ledger
inspection/reprojection validates Python applications and supplementary context
bindings. Numerical execution stays Python-only with an explicit observation-
workflow preflight gate. `gravity_disturbance` is distinct from `gravity_anomaly`
and accepted consistently by observation, gridding, generic raster and equivalent-
source contracts. Independent high-precision potential differentiation, published
surface anchors, cross-runtime replay and export persistence are tested.

Temporal gravity: native Python `apply_gravity_tide`, `correct_gravity_drift`,
`analyze_gravity_repeats`, `describe_gravity_temporal` match JavaScript
`applyGeophysicsGravityTide`, `correctGeophysicsGravityDrift`,
`analyzeGeophysicsGravityRepeats`, `describeGeophysicsGravityTemporal`.
Supplied per-record tide effects and fixed-reference piecewise-linear loop drift
share strict parameter/model/context bindings, history/order/coverage gates and
workflow ports. Calibrated `gravity_relative` is distinct from absolute
`gravity_observed`; per-channel gravity datum overrides preserve unrelated data.
Normal-gravity context resolution honours the same overrides. Independent station
truth/tides/drift, non-control repeats, irregular times, exact model/ledger replay
and export persistence test parity (1e-8 mGal numerical tolerance). No astronomical
model, global network solve, scale calibration or uncertainty is inferred.
