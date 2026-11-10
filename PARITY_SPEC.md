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


### Gravity land topography

Python executes `calculate_bouguer_plate`, `apply_bouguer_plate` and
`correct_gravity_terrain`; JavaScript exposes identical JSON descriptors and
public types, native ledger/context/model inspection and historical
reprojection replay. Terrain uses pinned optional Harmonica 0.7.0; the core
plate calculation needs no optional backend. Both saved observation operations
are Python-only, explicitly gated during JavaScript preflight. The independent
50-digit Newtonian integration fixture verifies known disturbances after
plate/hill/valley effects; Python tests exchange live ledgers with JavaScript.
Shared static native-history fixtures exercise npm exports, guards and types.


### Corrected radiometric products

Python and JavaScript natively stack exactly aligned corrected K(%), eU(ppm),
eTh(ppm) grids and calculate quantitative ratios/fixed-stretch ternary RGB.
Shared descriptors, context/parameter schemas and versioned raster-workflow
operations define independent dependency masks, explicit denominator floors,
ppm/% ratio semantics and K-red/eTh-green/eU-blue display mapping. Source
uncertainty is archived, not inferred from corrected grids. Hand-computed
mixtures and live Python/JavaScript replay cover masks, unit/context guards,
source lineage and exports. Inputs consumed exclusively by pointwise branches accept geographic and
sheared affines, independently of unrelated spatial-filter branches. Spatial
requirements propagate to source inputs through all dependent steps.

### Controlled magnetic grid microlevelling

Python and JavaScript natively estimate and subtract the same directional
Gaussian residual correction using the existing map-wavevector-aware FFT.
Shared model/parameter schemas, current-grid correction states, caller evidence,
geological-overlap acknowledgement, protection/training/edge rules, caps and
pre-FFT budgets are portable. The estimate retains an over-cap candidate with
an explicit application flag; subtraction rejects it atomically. Both saved
raster operations require named verified original inputs. Source history and
uncertainty remain archived, with no inferred propagation. Independent analytic
stripe/geological/plane amplitudes, protected-feature no-leakage, rotated and
scaled coordinates, failure gates and ERS/GeoTIFF exports are tested in both
runtimes; live numeric and recipe replay uses an absolute tolerance of 1e-10 nT.

### Spatial spectrum diagnostics

Native NumPy and JavaScript FFT implementations share radial/axial-wavevector
spatial periodogram schemas and normalization, explicit detrend/window/missing
policies, zero padding, inscribed Nyquist support, DC/corner accounting and
source lineage. Typed observation workflows consume actual grid/filter outputs
and return report ports with atomic failure behavior. Independent direct DFT and
Parseval references, known amplitudes/wavelengths/directions, rotation/unit
scaling, Nyquist/empty bins and fault/input guards validate both runtimes.
Live report/recipe parity uses absolute tolerance 1e-10 for power and 1e-9 for
mean density on the documented nT/metre fixtures; no inference of independent
resolution, calibrated uncertainty or geological depth is made.

### Polynomial regional/residual separation

Native Python/JS least-squares and Huber IRLS fits share explicit normalized-index
polynomial bases, field-unit thresholds/tolerances, training exclusions,
source-footprint policy, weighted-normal conditioning, work caps and atomic
failure states. Full-resolution regional/residual/training-mask outputs archive
source uncertainty/history and preserve field/unit semantics. Typed observation
workflows compose actual fit residuals with spectrum reports. Independent SVD and
closed-form Huber references, true held-out spatial validation, excluded-feature
no-leakage, unit scaling, masks/rank/condition/convergence and ERS/GeoTIFF cases
validate the algorithms. Live parity uses absolute tolerance 1e-7 in the nT
fixtures; diagnostics do not imply calibrated geological uncertainty.

## Analytical gravity forward modelling v1

Python `describe_gravity_forward` / `calculate_gravity_forward` correspond to
JavaScript `describeGeophysicsGravityForward` / `calculateGeophysicsGravityForward`
in the root and geophysics entries. Both execute natively and package an identical
request/result JSON descriptor. The strict local Cartesian metre frame, height
datum, IDs, source kinds/contrasts, explicit point-mass exclusion distance,
atomic states and budgets are shared. Sphere interiors/centres/exteriors and
fixed-geometry mass/density sensitivities are supported. Responses are synthetic
contrasts with negative Newtonian potential, vertical up and `g_down=-gz_up`;
no observation reduction, reference field, inversion or datum transform occurs.

Independent direct Newtonian sphere volume/potential quadrature and finite
differences check the science. Live cross-runtime fixtures compare vectors and
sensitivities at relative 2e-13 with absolute 1e-15/1e-18 tolerances respectively;
models, units, request structure and negative state/code pairs compare exactly.
Producer package versions and numeric serialization formatting are runtime-native;
bitwise numeric JSON identity is not promised. Zero-valued field/sensitivity
components are canonical positive zero. Python additionally rejects integer
objects that cannot be represented exactly in binary64; JavaScript numeric
inputs already are binary64. Request/result depth budgets are separate so the
request echo preserves the deepest valid request. The standalone JSON API is
separate from raster and acquisition-observation workflow execution.

## Magnetic dipole forward modelling v1

Python `describe_magnetic_forward` / `calculate_magnetic_forward` correspond to
JavaScript `describeGeophysicsMagneticForward` / `calculateGeophysicsMagneticForward`
in the root and geophysics entries. Both execute natively, share request/result
JSON descriptors and use the gravity forward model's extracted scalar-JSON and
compensated-sum guards. Gravity numerical formulae/API remain unchanged.
Moments are independent x/y/up vectors in A m², positions local Cartesian metres,
background explicitly supplied in nT or null. Signed-vector superposition precedes
both linear projection and the nonlinear total-field magnitude difference.
Per-moment-component derivatives cover vectors and LINEAR TMI only.

Independent axial/equatorial laws, Biot-Savart current-loop quadrature and
80-digit magnitude differences validate results beyond runtime agreement.
Live fixtures compare fields/derivatives at relative 3e-13 and absolute
1e-15/1e-18 respectively; descriptors/models/units/request structure and
negative state/code pairs match exactly. Native package version and binary64
serialization formatting can differ. As for gravity, Python rejects integer
objects not exactly representable in binary64, and field zero is canonical
positive zero. No bitwise JSON identity or geological uniqueness is promised.
No background/IGRF, induced-only direction, finite-body interior, geometry
inversion or observation correction is inferred. Missing-background context
is distinct from explicit null vector-only intent. This standalone JSON API
is outside raster/acquisition-observation workflow operation catalogues.

## Rectangular-prism gravity v1

Python `describe_gravity_prisms` / `validate_gravity_prisms` correspond to
JavaScript `describeGeophysicsGravityPrisms` / `validateGeophysicsGravityPrisms`
in the root and geophysics entries. Shared JSON descriptors, strict Cartesian
metre/up requests, work/conditioning domains and validation states/codes/
diagnostics/snapshots match. Live JSON replay validates in JavaScript and then
executes that copied request in Python. Producer versions/serialization differ.

`calculate_gravity_prisms` is intentionally Python-only, using the existing
potential-fields extra, pinned Harmonica 0.7.0 and Choclo 0.3.2 (Python 3.10
compatible). JavaScript has portable result types; it does not claim numerical
execution. NumPy backend version is recorded; G and backend versions are checked.
All potential/acceleration components support prism interiors and boundaries;
no singular tensors are requested. Backend positive potential/downward gravity
are explicitly normalised to negative Newtonian potential and x/y/up components.
Density sensitivities have fixed geometry; no inversion or propagated uncertainty.

Independent direct Newtonian volume quadrature (including singularity-free Duffy
octants at boundaries/interiors), cube analytic values, finite differences and
partition/translation/rotation/signed-cancellation cases check numerical science.
Exterior/boundary references use relative 2e-11/2e-12 and absolute 1e-14/1e-13
comparison limits; worst supported aspect/distance uses relative 2e-9 and
absolute 1e-16. These are test tolerances for bounded synthetic cases, not field
accuracy guarantees. No cross-runtime numerical solver parity is claimed.

## Magnetic rectangular-prism modelling v1

Python `describe_magnetic_prisms` / `validate_magnetic_prisms` correspond to
JavaScript `describeGeophysicsMagneticPrisms` / `validateGeophysicsMagneticPrisms`
in root/geophysics entries. Packaged JSON descriptor, scalar types, explicit
local frame/background/magnetisation vectors, external min-distance geometry,
conditioning/work limits, states/codes and copied requests agree. Prism geometry
validation is extracted and shared with gravity without changing its contracts
or numerical formulae. Live JavaScript-validated requests execute in Python.

`calculate_magnetic_prisms` is intentionally Python-only using the existing
optional Harmonica0.7.0/Choclo0.3.2 backend. JavaScript provides portable result
and sensitivity types, not a numerical stub. Backend nT/up fields are explicitly
rescaled from Choclo's 2018 permeability to the native dipole model's pinned
CODATA2022 constant, with both values/scale recorded and checked. Lower-corner
origins preserve represented coordinates. Exact TMI is computed after vector
superposition; derivatives are vector/LINEAR-TMI magnetisation columns only.

Independent dipole-volume quadrature and cube-axis solid-angle solutions,
dipole-limit convergence, finite differences and 80-digit total-field references
validate physics beyond runtime agreement. Volume checks use relative 2e-11 /
absolute 2e-12 nT; these are synthetic test tolerances, not geological accuracy
guarantees. Native package versions and serialization formats differ. No
cross-runtime numerical solver parity, induced-only direction, interior magnetic
field, inversion or uncertainty propagation is claimed. Input geometry is
atomic, including zero sources and every prism-point exclusion pair.

Magnetic-prism external-distance and background-magnitude guards compare
fixed-axis-order binary64 squared norms `(x*x + y*y) + z*z` in both runtimes,
including the squared minimum-distance threshold; equal computed squares pass.
Distance diagnostics use the square root of that same sum. Runtime-specific
`hypot` rounding is avoided in these validation decisions. Diagonal near-boundary
replay and exact 3-4-12 / background magnitude limits have regression coverage.

## Residual and misfit QC v1

Python describe_misfit/calculate_misfit correspond to native JS
describeGeophysicsMisfit/calculateGeophysicsMisfit. Identical request/result
schemas, context matching, exact-ID pairing, exception/coverage/group semantics
and supplied-sigma statistics are shared. Live fixtures replay permuted/missing
data and negative state/code reports; producer versions/float serialization
differ. Compensated sums and scaled RMS/distance arithmetic preserve extreme
values; tolerance-based numerical parity applies (relative/absolute1e-12 for
statistics), not bitwise arithmetic. Fixed-order scaled coordinate norms avoid
hypot boundary drift and squared-distance underflow. No interpolation, reference
conversion, reduced chi-square, inferred uncertainty or observation mutation.

## Block forward v1

`describe_block_forward` / `prepare_block_forward` correspond to native
`describeGeophysicsBlockForward` / `prepareGeophysicsBlockForward`. Portable
Baselode definition plus indexed records maps to validated prism batches,
with identical IDs/masks/property units/geometry gates and replay. Python
`calculate_block_forward` executes the pinned potential-fields extra;
JavaScript supplies result types, with no numerical solver parity claim.
Unrotated grids only. No snapping, bounding-box rotation approximation,
partial-fill assumption or susceptibility conversion. Global vectors precede
exact TMI, and global work/sensitivity budgets apply across batches.

## Density inversion v1

Native `describe_density_inversion` / `validate_density_inversion` correspond to
`describeGeophysicsDensityInversion` / `validateGeophysicsDensityInversion`.
Identical shared schemas, zero-property template, ordered density bounds/priors,
matched supplied-sigma data and explicit edge/solver/resource gates replay live.
Python `invert_density` uses the declared `inversion` extra; numerical solver
parity is not claimed. Native validation cannot establish augmented numerical
rank. Exact dense BVLS fits scaled deviations with L2 penalties, followed by
bounds/KKT checks and re-execution through the released forward adapter. Data
nullity is distinct from augmented rank. No inferred covariance, geological
uniqueness, posterior uncertainty, sparse regularisation or automatic corrections.

## Scalar susceptibility inversion v1

Native Python describe_susceptibility_inversion/validate_susceptibility_inversion
correspond to describeGeophysicsSusceptibilityInversion/
validateGeophysicsSusceptibilityInversion. Shared request/result schemas and live
positive/negative replay cover explicit induced-only SI/constant-field/linear-TMI
policies, reference binding, zero-J/distinct property columns and weak response.
Background magnitude uses fixed-axis-order squared norm and sqrt in native gates.
Python invert_susceptibility reuses bounded BVLS and unit-J prism columns with
J=chi*B0(T)/mu0. Analytic cube solid angles independently check induced units/signs;
field reversal, finite differences, negative chi, prior/bounds and remanent mismatch
cases verify physical meaning. Full-vector applicability is checked postfit.
Linear objective QC and exact-TMI magnitude QC are separate; numerical JS solver
parity, nonlinear exact-TMI inversion, demagnetisation, remanence or uniqueness/
posterior uncertainty are not claimed. All numerical failures withhold both QC
reports, conversion/model fields and fitted properties atomically.

## Magnetic vector inversion v1

Python describe_magnetic_vector_inversion/validate_magnetic_vector_inversion map
to native describeGeophysicsMagneticVectorInversion/
validateGeophysicsMagneticVectorInversion. Shared schemas and live native replay
cover independent Cartesian-J parameter order, zero-J/distinct properties,
nonredundant component or single-TMI dataset arrays, independent supplied sigma,
reference binding, explicit cap/null policies and total resource gates.
Python invert_magnetic_vector reuses pinned BVLS/prism operators. Componentwise
L2 edges, data nullity versus augmented rank, bounds and KKT remain explicit.
Independent analytic cube tensor/signs validate all three J components and their
amplitude/unit direction; zero amplitude has no direction. Weighted noisy channels,
ID/channel order, scalar-versus-vector remanent synthetic fits, selected nonunique
models and full-vector TMI policy have scientific regressions. Component objectives
are linear without weak approximation; linear TMI requires a fixed field/cap and
exposes separate exact magnitude QC. No numerical JS solver parity, nonlinear exact
objective, geographic angle, geological uniqueness, uncertainty or induced/remanent
split is claimed. Raw forward constants/units and fitted replay requests are retained.

## Terrain-aware matrix-free potential fields v1

Python describe/validate_potential_field_operator and
describe/validate_potential_field_grid_inversion map to native JavaScript
describe/validateGeophysicsPotentialFieldOperator and
describe/validateGeophysicsPotentialFieldGridInversion. Shared schemas, exact
terrain-ID/volume selection, geometry/work budgets, explicit physical assumptions,
parameter order and complete context/sigma validation have native replay tests.
Numerical calculate_potential_field_operator/invert_potential_field_grid require
the Python3.12+ pinned scalable extra. Analytic cube, independent volume quadrature,
weighted dense-small/adjoint, subdivision and conservative-terrain tests validate
physical conventions and matrix-free products. Bounded L2 TRF/LSMR reports a
conservative augmented condition bound and independent projected-gradient gate;
data rank remains unknown. No numerical JS parity, partial terrain volume,
arbitrary survey scale, geological uniqueness or posterior uncertainty is claimed.
