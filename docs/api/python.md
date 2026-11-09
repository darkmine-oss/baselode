# Python API Reference

Complete reference for the `baselode` Python package (v0.1.x).

---

## baselode.geophysics

```python
import baselode.geophysics
```

### Observation records and survey QC

`create_observations(payload)` validates and copies an acquisition-order JSON document.
`observation_schema()` returns its normalized v1 JSON Schema;
`describe_observation_qc()` returns QC parameters, assumptions and resource limits.
`qc_observations(payload, options=None)` returns a versioned report without changing readings,
order, extensions or declared correction states. These are direct APIs; raster workflow v1
continues to accept raster artifacts only.

```python
import baselode.geophysics

observations = baselode.geophysics.create_observations({
    "crs_units": "m",  # or provide a projected CRS
    "channels": {"mag": {"field_type": "magnetic_total_field", "units": "nT"}},
    "records": [
        {"id": "a", "line_id": "L1", "x": 0, "y": 0, "time": 1000, "values": {"mag": 50100}},
        {"id": "b", "line_id": "L1", "x": 10, "y": 0, "time": 1001, "values": {"mag": None}},
    ],
    "metadata": {"corrections": {"diurnal": "applied", "igrf": "unknown"}},
})
report = baselode.geophysics.qc_observations(observations, {"max_speed": 8})
# The speed is 10 m/s; the missing reading stays None. No correction is applied.
```

A normalized document has `schema="baselode.geophysics.observations"`, `version=1`,
`records`, `channels`, `crs`, `crs_units`, `metadata`. The constructor defaults omitted
schema/version/CRS/metadata. Each record has unique `id`, nullable `x`, `y`, `z`, `time`,
`clearance`, `line_id`, `station_id`, channel `values`, and JSON-object `extra`.
Absent nullable fields/readings become null. JSON normalization canonicalizes signed zero (`-0`) to `0` in the copied data/options; originals remain untouched. Unknown record/top-level fields and undeclared
channels are rejected: retain source-specific fields under `extra` or survey `metadata`.
Time is UTC Unix epoch **seconds**, not milliseconds; all XY values use one declared CRS.
Z and measured clearance use `metadata.height_units`; `metadata.height_datum` may preserve
the supplied datum. Clearance is never inferred from Z or terrain. Station IDs group repeat
measurements, while record IDs identify individual readings. No IDs, dates, datums or
corrections are inferred. The correction map uses `applied`, `unapplied` or `unknown`;
missing entries remain unspecified/unknown. QC does not implement a correction ledger.

Each channel declares nonempty `units` and a `field_type`: `magnetic_total_field`,
`magnetic_anomaly`, `gravity_observed`, `gravity_anomaly`, `radiometric`,
`radiometric_counts`, or `other`. Blank labels use the same explicit whitespace set in both runtimes (Unicode whitespace, BOM and legacy record separators). No numeric strings, booleans as numbers, nonfinite values,
cycles, unpaired Unicode surrogates or opaque objects are accepted. Record numbers lie within ±1e100 to keep baseline
statistics finite. All channel readings are numbers or null; full raw spectra/calibration
and spatial gridding are separate later capabilities.

QC always reports missing readings/coordinates, unassigned lines, exact coincident XY
locations, non-increasing within-line times and same-station repeat summaries. It connects
**only consecutive records with the same non-null line ID**; interleaved/returning lines
start a new segment. Nonpositive time intervals break segments. Missing distance context breaks segments when distance-gap checks are requested; missing timestamps do so when time-gap checks are requested. Coordinate-free base-station series can still use sample-window spike QC.
Optional `max_distance_gap` and `max_time_gap` thresholds also break segments; no speed or
spike window crosses those boundaries. Distance is horizontal in native linear CRS units,
speed is those units/second; no implicit unit conversion or geographic-distance calculation.
Same-station statistics include count, mean, min/max/range and sample standard deviation
(null for a single available reading), plus a same-location indicator. Position mismatches
are flagged; these descriptive statistics are not instrument precision or geological uncertainty. Python and JavaScript statistics agree within floating-point tolerance rather than bitwise identity.

Options use snake_case in both languages. `max_speed`, `max_distance_gap`, `max_time_gap`
and per-channel `spike_thresholds` must be positive, finite values; thresholds have no
invented defaults. `min_clearance` compares measured clearance in declared linear height units.
`spike_window` is an odd integer 3..101 (default 5). Only complete windows inside a segment
are tested: a reading is a candidate when its absolute departure from the window median
exceeds its channel threshold. Edges and windows containing missing readings are not
filled or tested. A candidate can be real geology; QC never deletes or replaces it.
These are sample windows, not a time/distance-calibrated noise filter. Use explicit gap
thresholds to exclude unwanted continuity in irregular acquisition.

Reports contain `state`, actionable `issues`, row/channel `flags`, contiguous `segments`
(zero-based inclusive start/end), `edges`, `coincident_locations` (index groups), `repeats`,
`summary`, `coverage`, effective `parameters`, producer/algorithm version and assumptions. Summary retains channel definitions/units, CRS and supplied height datum so flags remain interpretable.
`ok` means the checks completed, **not survey acceptance**. `needs_input` returns available
checks when requested physical checks lack context or no complete spike windows exist.
`rejected` identifies bad contracts/options or resource failures. The normalizer raises
`ValueError` for invalid input; QC returns structured rejection. Missing speed/clearance
context is never invented. Coverage counts evaluated/skipped speed edges and spike windows,
plus spike edge rows; line transitions are not candidate speed edges.

Limits: 100,000 records, 32 channels, 250,000 record×channel readings, 16 MiB compact UTF-8
JSON before/after normalization, 10,000,000 requested spike-window values, and 250,000 flags.
If flags exceed the bound, the report is explicitly `rejected`/`flags_truncated=True`;
summary counts still reflect all checks. Use smaller, scientifically meaningful survey
partitions for large inputs; partition boundaries do not automatically reconnect. There
is no file/network I/O, automatic correction, crossover levelling or gridding in this API.

### Baseline observation gridding and spatial validation

`describe_gridding()` returns the shared v1 parameter contracts, assumptions and limits.
`grid_observations(payload, options)` converts v1 observations to full-resolution field and
support rasters. `cross_validate_gridding(payload, options, validation)` evaluates the same
predictor on held-out lines or spatial blocks. These direct APIs leave raster workflow v1
unchanged and never edit input observations or apply corrections.

```python
import baselode.geophysics

interpolation = {
    "channels": ["mag"], "method": "idw", "radius": 200,
    "duplicate_policy": "mean", "elevation_policy": "ignore",
}
# observations is a v1 payload with declared field/unit and linear CRS context.
result = baselode.geophysics.grid_observations(observations, {
    **interpolation, "bounds": [400000, 6500000, 401000, 6501000], "shape": [40, 40],
})
if result["state"] == "ok":
    grid = result["artifacts"]["grid"]
    support = result["artifacts"]["support"]
    baselode.geophysics.save_raster(grid, "magnetic-grid.tif")
validation = baselode.geophysics.cross_validate_gridding(
    observations, interpolation, {"by": "line", "buffer_distance": 25},
)
```

Options require a unique nonempty `channels` selection, positive `radius` in native linear
CRS units, `duplicate_policy="mean"|"reject"`, and `elevation_policy="ignore"`. Coordinate
units must come from a projected CRS or explicit local linear `crs_units`; no geographic
interpolation or unit conversion is inferred. All selected channels share `field_type`,
while each retains its unit label. Missing XY/channel values are excluded with counts;
each gridded channel needs at least one eligible reading. QC flags are not automatically
used to discard data. Select/filter observations explicitly after interpreting QC.

`method` is `idw` (default) or `nearest`. `neighbors` is 1..64 (default 8) and
`min_neighbors` is 1..neighbors (default 1). Neighbour support counts **unique XY locations**
with available channel readings, among the nearest selected neighbours within the inclusive
radius. Coincident readings are averaged only under the explicit mean policy, and otherwise
rejected. Exact sample locations return their grouped value after the minimum-support
check; they do not bypass an explicit minimum density rule. `nearest` returns the closest
selected value; ties use first location occurrence in acquisition order. IDW uses
`power` in (0,16] (default 2), weighting by inverse distance to that power. Weights are
scaled by the smallest nonzero distance to avoid overflow. No smoothing/calibration is inferred.

Grid `bounds=[min_x,min_y,max_x,max_y]` are **outer edges** with positive extent;
`shape=[rows,columns]` contains positive integers. Predictions are at cell centres with a
north-up affine; all five artifacts have the same full-resolution bands/grid:

| Artifact | Meaning |
|---|---|
| `grid` | Field values, missing when unsupported |
| `support` | 1 supported, 0 unsupported |
| `neighbor_count` | Selected unique valid locations within radius (capped by neighbors) |
| `nearest_distance` | Nearest valid channel location, even if outside radius |
| `extrapolation` | 1 outside the per-channel convex hull, 0 inside/on its boundary |

`extrapolation="mask"` is the default. `"allow"` permits predictions outside the hull only
when radius and neighbour requirements still hold. One-point/collinear hulls are treated
as a point/segment. Hull orientation uses normalized vectors with a 1e-12 angular tolerance
for numerical boundaries. These diagnostics describe geometric/data support, not calibrated
geological uncertainty. Diagnostic rasters have field type `other` and appropriate units;
field rasters retain selected channel units/type, source references, declared corrections,
observation metadata and processing parameters through the existing ERS/GeoTIFF provenance.

This is **XY interpolation only**, even when Z varies. The required elevation policy
acknowledges that heights are ignored; known/missing height counts and ranges are reported.
No target height, common-surface continuation, drape correction or datum transformation is
performed. Use a later elevation-aware equivalent-source adapter for that problem. Raw total
magnetic/gravity observations retain their raw field type, so this does not make them ready
for operations requiring corrected anomalies.

Validation options are `{"by": "line"}` (every eligible observation needs a line ID), or
`{"by": "block", "block_size": [dx,dy], "origin": [x,y]}`. At least two groups are needed;
block indices use floor, including negative coordinates. Each whole group is held out in turn.
Training observations at **any held-out XY location** are always excluded before training
aggregation, even when `buffer_distance=0`; a nonnegative buffer excludes a wider halo.
Test values never enter training means. This deliberately uses spatial holdouts rather
than a random point split ([background in Verde](https://www.fatiando.org/verde/latest/gallery/blockkfold.html));
this implementation does not depend on Verde.

Reports include per-fold/per-channel `tested`, `supported`, `unsupported`, `coverage`,
`rmse`, `mae`, `bias`, observation-level predictions and training/exclusion counts. Errors
are **predicted minus observed** and only supported pairs enter scores; no supported pairs
means null scores, never zero error. Pooled scores weight individual supported observations,
not fold means. Coverage must accompany errors, especially for held-out outer lines that
fall outside the training hull. Spatial folds/buffers are user choices, not automatically
selected correlation lengths or a proof of independence.

States are `ok`, `needs_input` (required settings/context/readings/groups missing), and
`rejected` (bad contracts or resource limits), with actionable issues. Rejected results
return no partial artifacts/folds. Limits are 100,000 grid cells, 250,000 band values,
10,000,000 conservative pair evaluations and 64 folds, in addition to observation limits.
Pair estimates include hull-support checks and validation exclusion work; native baseline
searches are bounded but are not a large-survey spatial index or a wall-time/peak-memory
sandbox. Use scientifically meaningful partitions or a later scalable adapter for larger
problems; no silent truncation or decimation occurs. Minimum-curvature gridding,
grid matching, equivalent sources and observation workflow graphs are separate increments.

### GeophysicsRaster

```python
GeophysicsRaster(data, transform=None, crs=None, nodata=None,
                 band_names=None, metadata=None)
```

In-memory geophysics raster. `data` accepts `(row, column)` or `(band, row,
column)` numeric arrays and is stored as bands-first. `to_payload()` returns
a JSON-safe object for the JavaScript raster viewer; `from_payload(payload)`
reconstructs the model.

| Member | Description |
|---|---|
| `bounds`, `cell_size` | Extent `(min_x, min_y, max_x, max_y)` and `(x_size, y_size)` from the affine transform |
| `band(index=1)` | One band, GDAL one-based numbering |
| `copy_with(data=None, processing=None, **changes)` | Derived raster; appends `processing` to `metadata["processing"]` |
| `decimate(max_cells=160_000)` | NaN-aware block mean to at most `max_cells` cells per band |
| `to_tool_ui_payload(title=None, band=1, units=None, palette="viridis", stretch=None, hillshade=None, show_controls=False, max_cells=160_000, ...)` | Chat-sized `baselode_geophysics_raster` Tool UI result: one band, decimated and rounded |

### load_raster

```python
load_raster(source, bands=None, masked=True, engine=None, include_provenance=True, **kwargs)
```

Reads a raster into a `GeophysicsRaster`. ER Mapper `.ers` headers load with
the native NumPy reader (`read_ers`) on a core install. GeoTIFF/COG, ENVI and
other GDAL formats use Rasterio and need the optional `raster` extra:
`pip install 'baselode[raster]'`. `engine="ers"` or `"rasterio"` overrides
the choice.

`metadata["crs_units"]` records the coordinate units — `"degree"`, `"metre"`,
`"foot"` or `"us_survey_foot"`, or `None` when the source does not say — so
callers can express distances (filter wavelengths, continuation heights) in
the grid's units. Reproject geographic grids before scientific processing.

Scientific filters and enhancements require projected or local Cartesian coordinates.
Geographic and geocentric CRSs, angular coordinate units and conflicting
CRS/unit metadata raise an error. Distances remain in the native linear units;
metres are not silently converted to feet. For local grids, set
`metadata["crs_units"]` to `m`/`metre`, `ft`/`foot`,
`us-ft`/`us_survey_foot`, or `km`/`kilometre`. Without a CRS or declared
unit, derivatives explicitly use `coordinate_unit`. Unresolved external CRS
identifiers/definitions require explicit linear `crs_units`, matching the
JavaScript caller contract; without those units a `ValueError` is raised.

Derived `metadata["units"]` follows the calculation: `nT/m` for first
derivatives and analytic signal, `nT/m^2` for 2VD, and `degree` for tilt.
Unknown input band units remain `None` for derivatives. Filtering,
continuation and RTP preserve band units. Tool UI payloads and raster writers
use these corrected labels. Geographic grids still support display and sampling.

### read_ers

```python
read_ers(path, masked=True, include_provenance=True)
```

Native ER Mapper reader: band-interleaved-by-line binary with all integer and
IEEE real cell types, either byte order, `NullCellValue` as no-data, and
`RegistrationCoord` / `RegistrationCellX/Y` georeferencing (matching GDAL).
GDA94, GDA2020, AGD66/84 and WGS84 datum/projection pairs map to `EPSG:`
codes; `BandId` values become band names and their `Units` are kept in
`metadata["units"]`. Rotated grids are rejected.

### hillshade / hillshade_z_factor

```python
hillshade(raster, azimuth=315.0, altitude=45.0, z_factor="auto", band=1)
hillshade_z_factor(raster, band=1)
```

Illumination grid in `0..1` (`NaN` where data are missing). Azimuth is degrees
clockwise from north; altitude is the sun elevation in degrees. `z_factor` is
the vertical exaggeration; `"auto"` scales the 95th-percentile gradient to a
45° slope so relief is comparable whatever the data units.

### low_pass / high_pass / band_pass

```python
low_pass(raster, wavelength, method="gaussian", order=4, detrend=True)
high_pass(raster, wavelength, method="gaussian", order=4, detrend=True)
band_pass(raster, long_wavelength, short_wavelength, method="gaussian", order=4, detrend=True)
```

FFT wavelength filters for every band. Cut-offs are wavelengths in CRS units
(metres for MGA/UTM grids); the response is 0.5 at the cut-off. `method` is
`"gaussian"` (no ringing) or `"butterworth"` (sharper, steepness `order`). A
best-fit plane is removed first (restored by `low_pass` only), gaps are
filled from that plane and the grid mirror-padded to a power-of-two size;
missing cells stay missing. Each step is recorded in `metadata["processing"]`.

### Potential-field enhancements

```python
vertical_derivative(raster, order=1)
horizontal_derivative(raster, direction="east")      # or "north"
total_horizontal_derivative(raster)
tilt_derivative(raster)
analytic_signal(raster)
upward_continuation(raster, height)
reduce_to_pole(raster, inclination, declination)
```

Standard magnetic and gravity enhancements for every band, returning a new
`GeophysicsRaster` with the step recorded in `metadata["processing"]`.
Distances are in CRS units and derivatives are per CRS unit.

| Function | Result |
| --- | --- |
| `vertical_derivative` | 1VD (`order=1`), 2VD (`order=2`), ... via the Fourier domain; sharpens shallow sources |
| `horizontal_derivative` | Gradient along map east or north (central differences, any grid orientation) |
| `total_horizontal_derivative` | Horizontal gradient magnitude (THD); peaks over contacts and edges |
| `tilt_derivative` | `atan2(1VD, THD)` in degrees, -90 to 90; positive over sources, zero near edges |
| `analytic_signal` | `sqrt(dx² + dy² + dz²)`; peaks over magnetic sources whatever the magnetisation direction |
| `upward_continuation` | Field as if measured `height` higher; emphasises deeper, regional sources |
| `reduce_to_pole` | TMI as if the field and induced magnetisation were vertical; anomalies move over their sources |

`reduce_to_pole` takes the geomagnetic inclination (degrees, positive down,
negative in the southern hemisphere) and declination (degrees east of true
north) for the survey, from its report or an IGRF model. It does not model
remanence and raises `ValueError` within 15° of the magnetic equator, where it
is unstable; use `analytic_signal` there.

### Sampling grids at points and along lines

```python
sample_points(raster, x, y, band=1, method="bilinear", crs=None)       # -> ndarray
sample_table(raster, table, x_col="easting", y_col="northing", column=None,
             band=1, method="bilinear", crs=None)                     # -> DataFrame copy
sample_profile(raster, vertices, spacing, band=1, method="bilinear",
               crs=None, column="value")                              # -> DataFrame
profile_stations(vertices, spacing)                                   # -> DataFrame
```

Read grid values at collars, surface samples, desurveyed trace stations or
along a section line. Cell values sit at cell centres:

| Method | Result |
|---|---|
| `"bilinear"` (default) | Interpolates between the four surrounding cell centres. Within half a cell of the grid edge the edge cells are used as they are, without extrapolation. |
| `"nearest"` | Value of the cell containing the point |

Points outside the grid give `NaN`. So does a bilinear sample that would draw
on a missing cell: values are never invented across gaps. Points exactly on
a cell centre use only that cell.

`crs` is the coordinate system of the points (or of the line vertices). When
it differs from `raster.crs` the points are reprojected with pyproj first,
so MGA collars can be sampled against a GDA94 lat/long grid. Passing `crs`
for a raster without a CRS raises `ValueError`.

`sample_table` returns a copy of the table with a new column, named after the
band unless `column` is given. `profile_stations` spaces stations every
`spacing` units along the polyline through its bends and always includes the
last vertex; `sample_profile` returns `distance`, `x`, `y` (in the line's
CRS) and the value. Space a line in a projected CRS so distances are in
metres.

JavaScript's `sampleGeophysicsRaster` family returns the same values,
checked against a shared fixture.

### Cropping, clipping, combining and filling gaps

```python
crop(raster, bounds)                          # (min_x, min_y, max_x, max_y)
clip(raster, polygon, crop=True)
combine(left, right, operation, include_provenance=True)  # "add", "subtract", "multiply", "divide"
fill_gaps(raster, max_distance=None, iterations=100)
```

Each returns a new `GeophysicsRaster` and records the step in
`metadata["processing"]`. Coordinates are in the raster's CRS.

| Function | Result |
| --- | --- |
| `crop` | The whole cells that overlap the box, so the result can reach up to a cell beyond it. Values and `nodata` are unchanged. |
| `clip` | Cells whose centres lie outside the polygon become `NaN`. Takes one ring of `(x, y)` points, a list of rings (inner rings cut holes), a GeoJSON `Polygon`, `MultiPolygon` or `Feature`, or a Shapely geometry. With `crop=True` (the default) the grid is also cut to the polygon's bounding box. |
| `combine` | Cell-by-cell arithmetic with a number or a raster on the same grid (same shape, transform and CRS); a one-band raster applies to every band. `combine(tmi, regional, "subtract")` gives a residual. A cell is `NaN` when either input is missing or it is divided by zero. Rasters on different grids raise `ValueError`; resample one first. |
| `fill_gaps` | Fills missing cells with a smooth surface that joins the data without steps: block means from coarser and coarser levels, then `iterations` relaxation passes towards a harmonic surface. Data cells never change. `max_distance` limits filling to cells within that many cells of data (diagonal steps count as one); the default fills every gap, including areas outside the survey. |

Missing cells in results are `NaN` with `nodata` cleared, except `crop`, which
keeps the original values.

### Writing grids

```python
write_ers(raster, path, dtype=None, nodata=None)     # -> (header_path, data_path)
write_geotiff(raster, path, dtype=None, nodata=None, compress="deflate")
save_raster(raster, path, **kwargs)                  # by extension: .ers, .tif, .tiff
```

Both round-trip through `load_raster`. Float grids are written as `float32`
unless `dtype="float64"`. Missing cells get `nodata`, or the raster's own
`nodata`. When neither is set, ERS uses `-99999` and GeoTIFF uses `NaN`.

- **ERS** needs only NumPy. It writes the header and its data file (the same
  path without `.ers`), and requires a north-up grid. The CRS is written as an
  ERS datum and projection when it is a GDA94, GDA2020, AGD66/84 or WGS84
  system. Any other CRS is written as `RAW`.
- **GeoTIFF** needs the `raster` extra. Band names are kept as band
  descriptions and units as band units.

### Discoverable operations and saved workflows

`list_operations()` returns independent JSON contracts; `describe_operation(id)` returns one
(or raises `ValueError` for an unknown ID). `workflow_schema()` returns the v1 JSON Schema.
The catalogue covers the ten filtering/enhancement operators and `combine` (add/subtract).
Each contract includes parameter schemas/defaults, field applicability, unit/coordinate
requirements, assumptions, algorithm version, backend and resource limits.

```python
import baselode.geophysics

# grid is an existing, already-corrected magnetic anomaly raster.
# Supply metadata at acquisition/import, based on known survey information:
# {"field_type": "magnetic_anomaly", "units": ["nT"], "crs_units": "m"}
recipe = baselode.geophysics.magnetic_grid_recipe()
recipe["steps"][0]["parameters"]["height"] = 100  # choose for your survey, in CRS units
check = baselode.geophysics.validate_workflow(recipe, {"magnetic": grid})
result = baselode.geophysics.run_workflow(recipe, {"magnetic": grid})
if result["state"] == "ok":
    baselode.geophysics.save_raster(result["artifacts"]["edges"], "edges.tif")
else:
    print(result["issues"])
```

A workflow is finite JSON with exactly `schema="baselode.geophysics.workflow"`, `version=1`,
`steps` and `outputs`. Each step has exactly `id`, `operation`, `version=1`, `inputs` (one
reference, or two for combine), and `parameters`. Parameter names use snake_case in both
runtimes. Defaults are expanded into the returned `plan` and recorded in processing history.
References name explicit inputs or earlier steps. Input and step IDs are unique and match
`[A-Za-z][A-Za-z0-9_]{0,63}`. Outputs name available inputs/steps. Unknown operations,
versions, parameters, forward references and extra fields are rejected. The JSON Schema
checks document shape; `validate_workflow` additionally checks parameter and scientific semantics.

`validate_workflow(workflow, inputs)` never runs numerical kernels. `run_workflow` performs
the complete preflight before executing any step, with no generated code, eval, implicit
file/network I/O, or plugin lookup. Results contain `state`, actionable `issues`, `plan`,
`resource_estimate`, and (for execution) `artifacts`, `diagnostics`, `completed_steps`.
States are `ok`, `needs_input` for absent context/parameters/inputs, `rejected` for invalid
contracts, and `failed` for backend exceptions. Failed execution returns no partial artifacts.
Artifacts retain full resolution; this API does not generate decimated display previews.

Workflow inputs need explicit `metadata.field_type` for all bands: `magnetic_anomaly`,
`gravity_anomaly`, `radiometric`, or `other`, plus one nonempty `metadata.units` string
per band and finite invertible rectangular affine coordinates (rotations supported; shear rejected). Use separate rasters for mixed field
families. A projected CRS supplies linear units; a local grid must declare `crs_units`.
Angular coordinates are rejected for spatial filters. Inputs used exclusively by pointwise radiometric branches also accept geographic or sheared affine grids; no spatial distances are used. Potential-field operators reject radiometric/other
fields; RTP requires magnetic anomalies, explicit inclination/declination and
`|inclination| >= 15°`. In this workflow contract declination is **east of grid north**:
the caller must apply survey-appropriate convergence before supplying it. No field date,
IGRF, correction, calibration or north convergence is inferred. Analytic-signal amplitude,
tilt and total-horizontal-gradient magnitude become field type `other`; they cannot be
continued as though they were potential fields. Combine requires exactly matching shape,
transform, CRS, field types and per-band unit strings; no implicit resampling or conversion.

Limits are 64 steps, 1,000,000 cell values per input, 16,000,000 retained cell values
(inputs plus all step results), and 4,194,304 padded FFT cells per band using the kernel’s operation-specific padding.
The estimates bound these counts, not peak backend memory or wall time; callers needing
hard time/memory isolation should execute in their own worker process. Original inputs
and nested metadata are preserved. Workflow operation/library/backend versions and effective
parameters join the existing persisted lineage. There are no input hashes or correction
ledger yet; this recipe is **processed grid → regional/residual → edge product**, not
survey observations → calibrated corrections → validated gridding. Edge/gap assumptions
are returned per step; diagnostics are execution metadata, not a calibrated geological QC report.

### Embedded processing provenance

ERS and GeoTIFF writers embed lineage by default. After loading,
`raster.metadata["processing"]` contains the recorded steps and
`raster.metadata["baselode_provenance"]` contains the versioned manifest. This namespaced key is reserved; ordinary
`metadata["provenance"]` remains user metadata. Set
`include_provenance=False` on `save_raster`, `write_ers`, `write_geotiff` or
`ers_header` to omit it explicitly. Legacy files without a manifest still load.

The manifest is UTF-8 JSON encoded as ASCII base64 in the ERS header field
`BASELODE_PROVENANCE` or the GeoTIFF GDAL metadata item with that name:

```json
{
  "schema": "baselode.geophysics.provenance",
  "version": 1,
  "producer": {"library": "baselode", "version": "<exporter version>"},
  "sources": ["original-survey.ers"],
  "metadata": {"processing": [{"operation": "upward_continuation", "height": 100}]},
  "export": {"format": "GeoTIFF", "dtype": "float32"}
}
```

Metadata, including source references and calibration notes, must be acyclic
JSON objects/lists with string keys and finite numbers. Python integers must
be exactly representable as JavaScript numbers for cross-language interchange. Non-JSON values fail
before files are written. This default intentionally changes the old writers,
which ignored most metadata: normalize metadata to JSON to retain it, or use
`include_provenance=False` for the previous metadata-agnostic export behaviour.
For in-memory `combine` with opaque metadata, the same flag skips right-input
capture and records `lineage_omitted: true`. Opaque metadata is retained in
memory; a later provenance-bearing export still requires JSON metadata. Malformed manifests, unsupported versions and
manifests above 16 MiB fail clearly on reading. To read cells from a future or
damaged record explicitly, set `include_provenance=False` on `load_raster` or
`read_ers`. The reader skips that record, sets `provenance_ignored=True` and
records `provenance_omitted_on_import`; history is never silently discarded. The previous manifest and its
transport tag are excluded from the next snapshot, so repeated saves do not
recursively embed prior envelopes. Source references are accumulated uniquely.

Known source URL fields (`source`, `*_source`, and source-reference lists) have
userinfo, query strings and fragments removed from persisted snapshots and
references (including imported historical manifests). The current in-memory
`metadata["source"]` remains the live locator, so it can still reopen signed
URLs. Recorded source references are sanitized locators, not exact fetch URLs. Other arbitrary metadata
is retained, so the opt-out remains available when metadata should be omitted.

On loading, prior format-specific reader fields (including ERS cell type,
datum/projection, GDAL tags, and dimensions) remain only in the historical
snapshot; they are not revived as current fields in another format.
The file's current source, driver, tags and band units take
precedence over the snapshot. Geometry and CRS always come from the file.
An explicit band selection, including on legacy files, appends a one-based
`select_bands` view step;
JavaScript downsampling also records its existing `decimate` step.
Raster arithmetic stores a flat graph of input metadata/source records in
`metadata["input_lineage"]`, alongside the left-hand history. Each binary
processing step's zero-based `operand_lineage` points to its right-hand record.
These nodes describe metadata/history, not unique data identities: inputs with
identical descriptions may share a record. Supply stable artifact identifiers
in metadata when distinct inputs need to be distinguished.
Records reference earlier graph entries through their own processing steps;
merging graphs remaps references and deduplicates identical records. This avoids
recursive duplication when repeatedly combining derived grids.

The producer identifies the exporter package, not every upstream calculation.
The record documents lineage; it does not authenticate cell values, guarantee
numerical replay, or contain an executable workflow. Other software can strip
custom metadata. Use Baselode's native ERS reader for its custom header field.

### Colour scales

```python
baselode.geophysics.COLOUR_SCALES            # name -> RGB stops
stretch_values(values, stretch=None, nodata=None)  # -> (ratios, (low, high))
colourize(values, palette="viridis", stretch=None, reverse=False, nodata=None,
          shade=None, shade_strength=0.65)    # -> uint8 RGBA
```

Scales: `viridis`, `magma`, `inferno`, `plasma`, `cividis`, `turbo`,
`diverging`, `rainbow`, `magnetic`, `terrain`, `grayscale`. Stretches:

| Stretch | Meaning |
|---|---|
| `{"mode": "relative", "low": 2, "high": 98}` | Percentile clip (default) |
| `{"mode": "absolute", "min": -200, "max": 400}` | Fixed limits in data units |
| `{"mode": "equalize"}` | Histogram equalisation |

The JavaScript renderer uses the same stops and arithmetic.

---

## baselode.drill.data

Data loading and table normalisation helpers for drillhole datasets.

```python
import baselode.drill.data as drill
```

---

### load_table

```python
load_table(source, kind="csv", connection=None, query=None, table=None,
           column_map=None, source_column_map=None, **kwargs)
```

Low-level loader.  Reads data from a CSV, Parquet, or SQL source and applies column standardisation.

**Parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `source` | path / DataFrame | — | File path, `pandas.DataFrame`, or `None` (for SQL) |
| `kind` | `"csv"` \| `"parquet"` \| `"sql"` | `"csv"` | Source format |
| `connection` | SQLAlchemy engine, optional | `None` | Database connection for SQL sources |
| `query` | str, optional | `None` | SQL query string |
| `table` | str, optional | `None` | SQL table name (alternative to `query`) |
| `column_map` | dict, optional | `None` | Override the default column map |
| `source_column_map` | dict, optional | `None` | Extra raw→standard column overrides |
| `**kwargs` | — | — | Forwarded to `pandas.read_csv` / `read_parquet` |

**Returns:** `pandas.DataFrame`

---

### standardize_columns

```python
standardize_columns(df, column_map=None, source_column_map=None)
```

Rename DataFrame columns to the Baselode standard using the default column map (and optional overrides).

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `df` | `pandas.DataFrame` | Input DataFrame |
| `column_map` | dict, optional | Override the default column map |
| `source_column_map` | dict, optional | Additional raw→standard overrides applied on top |

**Returns:** `pandas.DataFrame`

---

### load_collars

```python
load_collars(source, crs=None, source_column_map=None, keep_all=True, **kwargs)
```

Load drillhole collar data.  Returns a `geopandas.GeoDataFrame` with point geometry built from lat/lon (preferred) or easting/northing.

**Required columns (after mapping):** `hole_id`, and either (`latitude`, `longitude`) or (`easting`, `northing`).

**Returns:** `geopandas.GeoDataFrame`

---

### load_surveys

```python
load_surveys(source, source_column_map=None, keep_all=True, **kwargs)
```

Load directional survey data.

**Required columns (after mapping):** `hole_id`, `depth`, `azimuth`, `dip`

**Returns:** `pandas.DataFrame` sorted by `hole_id`, `depth`

---

### load_assays

```python
load_assays(source, source_column_map=None, keep_all=True, **kwargs)
```

Load assay interval data.  Computes a `mid` column as `0.5 * (from + to)`.

**Required columns (after mapping):** `hole_id`, `from`, `to`

**Returns:** `pandas.DataFrame` sorted by `hole_id`, `from`, `to`

---

### load_structures

```python
load_structures(source, source_column_map=None, keep_all=True, **kwargs)
```

Load structural point measurement data (alpha/beta measurements).

**Required columns (after mapping):** `hole_id`, `depth`

**Returns:** `pandas.DataFrame` sorted by `hole_id`, `depth`

---

### load_geotechnical

```python
load_geotechnical(source, source_column_map=None, keep_all=True, **kwargs)
```

Load geotechnical interval data (RQD, fracture count, weathering, etc.).

**Required columns (after mapping):** `hole_id`, `from`, `to`

**Returns:** `pandas.DataFrame` sorted by `hole_id`, `from`

---

### load_unified_dataset

```python
load_unified_dataset(assays_source, structures_source,
                     source_column_map=None, **kwargs)
```

Load and merge assay intervals and structural data into one DataFrame.  Recommended entry point for the 2D strip-log view.

- Assay rows: `depth` is set to the interval midpoint (`mid`).
- Structural rows: a synthetic ±0.05 m interval is added around `depth`.
- All rows are tagged with a `_source` column (`'assay'` | `'structural'`).

**Returns:** `pandas.DataFrame` sorted by `hole_id`, `depth`

---

### assemble_dataset

```python
assemble_dataset(collars=None, surveys=None, assays=None,
                 structures=None, geotechnical=None, metadata=None)
```

Wrap pre-loaded DataFrames into a dataset dictionary.

**Returns:**

```python
{
    "collars":       GeoDataFrame,
    "surveys":       DataFrame,
    "assays":        DataFrame,
    "structures":    DataFrame,
    "geotechnical":  DataFrame,
    "metadata":      dict
}
```

---

### join_assays_to_traces

```python
join_assays_to_traces(assays, traces, on_cols=(HOLE_ID,))
```

Left-join 3D trace coordinates onto an assay DataFrame using `hole_id`.

---

### filter_by_project

```python
filter_by_project(df, project_id=None)
```

Filter a DataFrame to a single `project_id`.  Returns a copy of `df` unchanged if `project_id` is `None`.

---

### coerce_numeric

```python
coerce_numeric(df, columns)
```

Convert listed columns to numeric dtype, coercing invalid values to `NaN`.

---

## baselode.drill.desurvey

Desurveying utilities — converts depth-based surveys into 3D spatial coordinates.

```python
import baselode.drill.desurvey as desurvey
```

### minimum_curvature_desurvey and other methods

```python
minimum_curvature_desurvey(collars, surveys, step=1.0)
tangential_desurvey(collars, surveys, step=1.0)
balanced_tangential_desurvey(collars, surveys, step=1.0)
midpoint_tangential_desurvey(collars, surveys, step=1.0)
```

Desurvey all holes in `collars` using the matching rows in `surveys`, one
function per method. Rows missing a hole ID, usable collar coordinates or
usable survey measurements are ignored.

**Parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `collars` | GeoDataFrame | — | Collar table |
| `surveys` | DataFrame | — | Survey table |
| `step` | float | `1.0` | Output vertex spacing (metres) |

Every trace starts at the collar (`md = 0`).  If the first survey station is deeper than the collar, its orientation is extended straight up to `md = 0` (Vulcan / Surpac convention), so single-station holes recorded at depth still produce a full trace.

**Returns:** `pandas.DataFrame` with columns `hole_id`, `md`, `easting`, `northing`, `elevation`, `azimuth`, `dip`

---

### interpolate_trajectory

```python
interpolate_trajectory(
    traces,
    depths,
    hole_col=HOLE_ID,
    md_col="md",
    easting_col=EASTING,
    northing_col=NORTHING,
    elevation_col=ELEVATION,
    azimuth_col=AZIMUTH,
    dip_col=DIP,
)
```

Look up `(easting, northing, elevation, azimuth, dip)` at arbitrary downhole depths.  Linear interpolation per coordinate against the desurveyed trace — accurate enough as long as the trace was sampled at a small step (default 1 m in `minimum_curvature_desurvey` and friends).

`depths` accepts four forms:

- `dict` `{hole_id: [d1, d2, ...]}` — per-hole depths
- `pd.DataFrame` with `hole_id` and `depth` columns
- `list` / array of depths — broadcast to every hole in *traces*
- `float` — broadcast to every hole

**Returns:** `pandas.DataFrame` with columns `hole_id`, `depth`, `easting`, `northing`, `elevation`, `azimuth`, `dip`.  Depths outside a hole's trace range (or whose hole isn't in *traces*) produce `NaN` in every output column except `hole_id` and `depth`.

Note: azimuth is interpolated as a plain scalar.  This produces the wrong answer for trajectories that wrap across the 0°/360° boundary between adjacent samples — real-world drillholes don't do this, but a contrived survey going 350° → 10° in one step will spuriously interpolate through 180°.

---

### Cross-validation against wellpathpy

The three desurvey methods are cross-validated against [`wellpathpy`](https://github.com/Zabamund/wellpathpy) (MIT-licensed) on four reference trajectories — vertical, constant-build, strong-dogleg, and long low-dip.  The committed fixture file at `test/data/desurvey_reference.json` carries the wellpathpy outputs; `test/test_desurvey_reference.py` runs our methods against it with a 1 cm tolerance.

Wellpathpy is **not** a CI dependency — the fixture is the contract.  To refresh it locally:

```bash
source .venv/bin/activate
pip install wellpathpy
python scripts/dev/regenerate_desurvey_fixtures.py
```

| Method | Status |
|---|---|
| `minimum_curvature` | Matches wellpathpy to machine precision on every trajectory |
| `tangential` | Matches wellpathpy `tan_method(choice="low")` to machine precision |
| `balanced_tangential` | Matches wellpathpy `tan_method(choice="bal")` to ≤1 cm on every trajectory — including the strong-dogleg stress case. Uses the canonical Walstrom 1969 / Harvey & Eppink 1972 form (average of direction cosines) |
| `midpoint_tangential` | No wellpathpy equivalent.  Vulcan's default "Tangent": each station is the midpoint of its straight segment (orientation changes halfway between stations).  Verified against analytic cases in `test/test_desurvey_collar_and_midpoint.py`; agrees with the other methods on straight holes |

---

## baselode.drill.intervals

Pure from-to interval algebra primitives.  All functions are stateless and operate on plain pandas `DataFrame` interval tables keyed by `hole_id`, `from`, `to`.

```python
import baselode.drill.intervals as intervals
```

Field-name defaults come from `baselode.datamodel.FROM`, `TO`, `HOLE_ID`; pass `from_col` / `to_col` / `hole_col` to override.

---

### interval_length

```python
interval_length(df, from_col=FROM, to_col=TO)
```

Per-row length (`to - from`).

**Returns:** `pandas.Series` indexed like `df`.

---

### from_to_midpoints

```python
from_to_midpoints(df, from_col=FROM, to_col=TO)
```

Per-row midpoint depth (`(from + to) / 2`).

**Returns:** `pandas.Series` indexed like `df`.

---

### detect_gaps

```python
detect_gaps(df, from_col=FROM, to_col=TO, hole_col=HOLE_ID, min_gap=0.0)
```

Find uncovered downhole ranges between consecutive intervals, per hole.  Surface-to-first-interval and last-interval-to-EOH gaps are not reported (no anchor to compare against).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `df` | `pandas.DataFrame` | — | Interval table |
| `from_col`, `to_col` | str | `FROM`, `TO` | From-/to-depth columns |
| `hole_col` | str | `HOLE_ID` | Hole identifier column |
| `min_gap` | float | `0.0` | Minimum gap length to report |

**Returns:** `pandas.DataFrame` with columns `hole_id`, `from`, `to`, `length`.

---

### detect_overlaps

```python
detect_overlaps(df, from_col=FROM, to_col=TO, hole_col=HOLE_ID)
```

All pairs of overlapping intervals per hole.  Reported `from`/`to`/`length` describe the intersection range; `first_index`/`second_index` are positional indices into `df` (0-based, independent of the input's pandas index).

**Returns:** `pandas.DataFrame` with columns `hole_id`, `from`, `to`, `length`, `first_index`, `second_index`.

---

### split_at

```python
split_at(df, depths, from_col=FROM, to_col=TO, hole_col=HOLE_ID)
```

Split intervals at boundary depths (e.g. coded lithology contacts).  Any depth falling strictly inside `(from, to)` becomes a new boundary; the row is replaced by sub-intervals, inheriting all other columns from the parent.

`depths` accepts four forms:
- `dict` `{hole_id: [d1, d2, ...]}` — per-hole boundaries
- `pandas.DataFrame` with `hole_id` and `depth` columns
- `list` / array of depths — applied to every hole
- `float` — applied to every hole

**Returns:** `pandas.DataFrame` with the same columns as `df`.

---

### clip

```python
clip(df, from_depth=None, to_depth=None, from_col=FROM, to_col=TO)
```

Clip intervals to a downhole depth window.  Intervals entirely outside `[from_depth, to_depth]` are dropped; straddling intervals have their `from`/`to` pulled to the window edge; all other columns preserved.  Pass `None` for either bound to disable that side.

**Returns:** `pandas.DataFrame` with the index reset.

---

### merge_tables

```python
merge_tables(tables, from_col=FROM, to_col=TO, hole_col=HOLE_ID)
```

Left-join multiple interval tables onto a common from-to support via boundary intersection.  Per hole, builds a fine-grained support by collecting all unique boundary depths across every input table; each output row carries `<table>_<col>` values looked up at the sub-interval midpoint.

The first table in `tables` anchors the support — only depth ranges it covers appear in the output ("left" semantics).  Where a later table has no row covering the midpoint, its columns are `NaN`.

```python
merged = intervals.merge_tables({"assay": assays, "litho": geology})
# columns: hole_id, from, to, assay_<col>, ..., litho_<col>, ...
```

**Returns:** `pandas.DataFrame`.

---

## baselode.drill.composite

Length-weighted compositing of downhole intervals.  Soft + hard boundary modes plus a true-thickness (economic) compositor.

```python
from baselode.drill.composite import composite_intervals, composite_true_thickness
```

### composite_intervals

```python
composite_intervals(
    df, value_col, from_col="from", to_col="to",
    length=1.0, method="average", *,
    mode="soft", boundary_col=None, residual="discard",
)
```

Composite a column of an interval table into fixed-length downhole bins.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `df` | `pandas.DataFrame` | — | Interval table with `hole_id`, *from_col*, *to_col*, *value_col*; in `mode="hard"` also *boundary_col* |
| `value_col` | `str` | — | Numeric column to composite |
| `length` | `float` | `1.0` | Composite length in metres (downhole).  Must be > 0 |
| `method` | `{"average", "sum"}` | `"average"` | Length-weighted average or sum |
| `mode` | `{"soft", "hard"}` | `"soft"` | Soft = bins extend across the full hole and may cross contacts (dhcomp / Leapfrog default).  Hard = bins reset at every change in `boundary_col` |
| `boundary_col` | `str` | `None` | Domain column for hard mode (required when `mode="hard"`) |
| `residual` | `{"discard", "add_to_previous", "distribute"}` | `"discard"` | Tail-of-domain handling for hard mode.  `discard` drops a sub-length tail; `add_to_previous` extends the previous composite to the domain end; `distribute` chooses `round(D/length)` equal-length bins covering the whole domain |

**Returns:** `pandas.DataFrame` of composites with `hole_id`, *from_col*, *to_col*, *value_col*, plus *boundary_col* in hard mode.

**Mass balance:** `sum(value × overlap)` is conserved between source intervals and composites (within each composite's coverage window in `"average"` mode; over the full hole in `"sum"` mode, modulo intervals dropped by residual handling).

### composite_true_thickness

```python
composite_true_thickness(
    intervals, traces, value_col, ref_dip, ref_dip_azimuth,
    from_col="from", to_col="to",
    length=1.0, method="average", hole_col=HOLE_ID,
)
```

Composite in **true-thickness** space relative to a reference plane.  For each source interval the midpoint orientation is looked up in *traces* via `interpolate_trajectory`; true thickness is `L_downhole · |T · N|` where `T` is the hole's unit tangent and `N` is the unit normal of the reference plane.  Composites span `length` of true thickness, with downhole `from`/`to` recovered from the inverse cumulative map.

Use this for "economic compositing" — composites that represent equal stratigraphic thickness across a known orebody plane.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `intervals` | `pandas.DataFrame` | — | Interval table |
| `traces` | `pandas.DataFrame` | — | Desurveyed trace with `azimuth` + `dip` columns (e.g. output of `minimum_curvature_desurvey`) |
| `value_col` | `str` | — | Numeric column to composite |
| `ref_dip` | `float` | — | Reference plane dip in degrees (0 = horizontal, 90 = vertical) |
| `ref_dip_azimuth` | `float` | — | Dip azimuth (downdip direction) clockwise from grid north, in degrees |
| `length` | `float` | `1.0` | Composite true-thickness in metres.  Must be > 0 |
| `method` | `{"average", "sum"}` | `"average"` | Length-weighting applied with true thickness as the weight |
| `hole_col` | `str` | `HOLE_ID` | Hole identifier column (propagates into the output) |

**Returns:** `pandas.DataFrame` with `hole_id`, *from_col*, *to_col* (downhole metres), *value_col*, `length_md` (downhole length covered) and `length_true` (true thickness — usually equal to `length` except possibly the last bin per hole).

A hole drilled parallel to the reference plane (`|T · N| ≈ 0`) produces no composites — no economic thickness is being captured.

True-thickness compositing is **Python-only**; the JavaScript build ships `compositeIntervals` (soft + hard modes) but no true-thickness primitive, since it depends on a desurveyed trace.

---

## baselode.drill.DrillholeSet

Composition root for the drilling tables of a project.  Holds a collar + survey table plus N named interval tables (assay, geology, structural, …) and exposes the existing function-based API as methods.  No new algorithmic logic — every method is a thin delegator.  The trace is cached after the first `desurvey()` call.

```python
from baselode.drill import DrillholeSet
```

### Construction

```python
DrillholeSet(collar, survey, crs=None, project=None, hole_col=HOLE_ID)
```

### Registering interval tables

```python
db.add_table(name, df, kind="assay")   # chainable; returns self
```

### Attributes

| Attribute | Description |
|---|---|
| `db.collar`, `db.survey` | The source tables |
| `db.tables`, `db.table_kinds` | Dict of registered interval tables + their kind tags |
| `db.holes` | List of distinct hole IDs (property) |
| `db.traces` | Cached desurvey output (property; runs `desurvey()` on first access) |
| `db.crs`, `db.project` | Metadata passed at construction |

### Methods

#### `db.validate(**kwargs)`

Delegate to `baselode.drill.validate.validate_drillhole_db(collar, survey, interval_tables=db.tables, **kwargs)`.  Forwards keyword arguments such as `allow_full_circle=True`.

**Returns:** `{"summary": {...}, "issues": [...]}`.

#### `db.desurvey(method="minimum_curvature", step=1.0, force=False)`

Run desurvey via the registered method (one of `"minimum_curvature"`, `"tangential"`, `"balanced_tangential"`, `"midpoint_tangential"`).  Cached unless `force=True` or args change.

**Returns:** `pandas.DataFrame` trace table.

#### `db.composite(table_name, value_col, length=1.0, method="average", from_col="from", to_col="to")`

Thin wrapper around `baselode.drill.composite.composite_intervals` on a registered interval table.

#### `db.to_omf(path, include=None, value_cols=None, name=None, author="baselode", description="")`

Serialise the set to an OMF v1 file.  `include` defaults to all registered elements (`"collars"`, `"traces"`, every interval table name).  `value_cols` is a per-table dict naming value columns to attach as OMF segment data, e.g. `{"assay": ["au_ppm", "cu_pct"]}`.

**Returns:** the path written.

### Indexing

```python
db["assay"]       # equivalent to db.tables["assay"]
"assay" in db     # True if registered
repr(db)          # "<DrillholeSet holes=20 survey_rows=14608 tables=['assay']>"
```

---

## baselode.drill.omf

Open Mining Format (OMF v1) interop.  OMF is the de-facto open mining interchange format (MIT-licensed, Global Mining Guidelines Group), supported by Leapfrog, 3DEXPERIENCE, Deswik and Micromine.  Baselode being OMF-native plugs it directly into those workflows.

Optional dependency — install via `pip install baselode[omf]`.

```python
import baselode.drill.omf as omf_io
```

JavaScript support is deferred per TRK-111 scope — consume read-side via Python until a JS need lands.

---

### collars_to_omf_points

```python
collars_to_omf_points(
    collars,
    name="collars",
    hole_col=HOLE_ID,
    easting_col=EASTING,
    northing_col=NORTHING,
    elevation_col=ELEVATION,
    attribute_cols=None,
)
```

Convert a collar table to an OMF `PointSetElement`.  Vertices are `(easting, northing, elevation)`; rows with missing xyz are dropped.  `hole_id` is attached as per-vertex `StringData`.  Any extra columns in `attribute_cols` are attached as `ScalarData` (numeric dtype) or `StringData` (object dtype).

**Returns:** `omf.PointSetElement`

---

### traces_to_omf_lines

```python
traces_to_omf_lines(
    traces,
    name="traces",
    hole_col=HOLE_ID,
    easting_col=EASTING,
    northing_col=NORTHING,
    elevation_col=ELEVATION,
    md_col="md",
)
```

Convert desurveyed traces to a single OMF `LineSetElement`.  Each hole contributes a sequence of segments connecting consecutive trace samples (sorted by `md_col`); holes are concatenated into one element with a per-segment `hole_id` so they're individually selectable downstream without forcing a 4 000-element project.  Holes with fewer than two trace samples are skipped.

**Returns:** `omf.LineSetElement`

---

### intervals_to_omf_lines

```python
intervals_to_omf_lines(
    intervals,
    traces,
    name,
    value_cols=None,
    hole_col=HOLE_ID,
    from_col=FROM,
    to_col=TO,
    easting_col=EASTING,
    northing_col=NORTHING,
    elevation_col=ELEVATION,
    md_col="md",
)
```

Convert an interval table (assay, geology, etc.) to a single OMF `LineSetElement` with one segment per interval.  Endpoints are interpolated from the trace at the interval's `from_col` / `to_col` depths.  Value columns become per-segment `ScalarData` (numeric) or `StringData` (categorical); `hole_id` is always attached.

Rows whose hole isn't in `traces` are skipped silently; rows with non-numeric `from` / `to` are skipped silently.

**Returns:** `omf.LineSetElement`

---

### build_omf_project / write_omf / read_omf

```python
project = build_omf_project(name, author, description, elements)
write_omf(project_or_elements, path, name="baselode", author="baselode", description="")
project = read_omf(path)
```

`write_omf` accepts either an `omf.Project` directly or a list of elements (in which case it wraps them via `build_omf_project` using the `name` / `author` / `description` kwargs).  Returns the project that was serialised.

---

## baselode.drill.validate

QA/QC helpers for drillhole tables.  The headline entry point is `validate_drillhole_db`, which runs every check in one pass and returns a structured report.

```python
import baselode.drill.validate as validate
```

---

### validate_drillhole_db

```python
validate_drillhole_db(
    collar,
    survey,
    interval_tables=None,
    hole_col=HOLE_ID,
    depth_col=DEPTH,
    azimuth_col=AZIMUTH,
    dip_col=DIP,
    from_col=FROM,
    to_col=TO,
    max_depth_col=MAX_DEPTH,
    allow_full_circle=False,
)
```

`allow_full_circle=True` accepts `azimuth = 360` as valid (closed interval `[0, 360]`); the default `False` uses the strict mathematical convention `[0, 360)` and reports `360` as an error with a fix recipe pointing at `normalize_azimuth`.

Run the full drillhole-database validation suite.  Returns a structured report (never raises).

**Returns**

```python
{
    "summary": {"error": int, "warning": int, "info": int},
    "issues": [
        {
            "check": str,           # e.g. "orphan_intervals"
            "severity": str,        # "error" | "warning" | "info"
            "hole_id": str | None,
            "table": str | None,    # "collar" | "survey" | <interval table name>
            "row_index": int | None,
            "message": str,
            "fix": str | None,
        },
        ...
    ],
}
```

**Checks**

| Check | Severity | Notes |
|---|---|---|
| `duplicate_hole_ids` | error | Collar table contains the same `hole_id` more than once |
| `survey_null_orientation` | error | A survey row has a null / non-numeric `depth`, `azimuth` or `dip`.  Desurvey silently ignores such rows.  Fix recipe points at `drop_unusable_survey_rows` and `synthesise_collar_station` |
| `survey_no_usable_stations` | warning | A hole has no usable survey row — every row unusable, or (for collar holes) no survey rows at all — so it silently drops out of the desurvey.  Skipped when the survey table is empty.  Fix recipe points at `synthesise_collar_station` |
| `single_station_surveys` | warning | A hole has only one *usable* survey row — desurvey will fail.  Fix recipe points at `fix_single_station_surveys` |
| `azimuth_range` | error | Survey azimuth outside `[0, 360)` |
| `dip_range` | error | Survey dip outside `[-90, 90]` |
| `orphan_intervals` | error | Interval `hole_id` not present in collar table |
| `negative_lengths` | error | Interval `to <= from` |
| `intervals_beyond_max_depth` | warning | Interval `to` exceeds collar `max_depth` (only when collar carries the column) |
| `interval_gaps` | info | Consumes `baselode.drill.intervals.detect_gaps` |
| `interval_overlaps` | warning | Consumes `baselode.drill.intervals.detect_overlaps`; records the pairwise indices |
| `below_detection_limit` | info | Detects `<NUMBER` sentinels in object/string columns.  Fix recipe points at `replace_below_detection_limit` |

---

### fix_single_station_surveys

```python
fix_single_station_surveys(survey, collar=None,
                            hole_col=HOLE_ID, depth_col=DEPTH, max_depth_col=MAX_DEPTH,
                            azimuth_col=AZIMUTH, dip_col=DIP)
```

For any hole with exactly one usable survey row, append a synthetic second station with the same azimuth/dip at `collar.max_depth` (when available) or `depth + 1.0` otherwise.  Equivalent to PyGSLIB's `fix_survey_one_interval_err`.

**Returns:** `pandas.DataFrame` — original survey rows plus synthetics, sorted by `hole_id`, `depth`, with the index reset.

---

### drop_unusable_survey_rows

```python
drop_unusable_survey_rows(survey, hole_col=HOLE_ID, depth_col=DEPTH,
                          azimuth_col=AZIMUTH, dip_col=DIP)
```

Drop survey rows whose depth, azimuth or dip is null or non-numeric — the complement of the `survey_null_orientation` check.  Desurvey already ignores these rows, so no trace changes.

**Returns:** `pandas.DataFrame` — filtered copy with the index reset.

---

### synthesise_collar_station

```python
synthesise_collar_station(survey, collar,
                          hole_col=HOLE_ID, depth_col=DEPTH, azimuth_col=AZIMUTH, dip_col=DIP,
                          collar_azimuth_col=AZIMUTH, collar_dip_col=DIP,
                          return_diagnostics=False)
```

Build a survey station at the collar for every hole that has none — collar holes with no survey rows, and holes whose every row lacks a usable depth / azimuth / dip.  Each gets a row at depth `0` oriented from the collar table's `collar_azimuth_col` / `collar_dip_col` (matched case-insensitively; dip negative = down) when both are numeric, otherwise vertical (`azimuth 0`, `dip -90`).  The hole's existing unusable rows are dropped.  Holes with at least one usable station are untouched.

Chain with `fix_single_station_surveys` to pad the synthetic station to `collar.max_depth`.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `collar_azimuth_col` | str | `"azimuth"` | Collar column holding the planned azimuth |
| `collar_dip_col` | str | `"dip"` | Collar column holding the planned dip |
| `return_diagnostics` | bool | `False` | When `True`, return `(survey, report)` where `report` carries `holes_synthesised`, `from_collar`, `vertical_fallback`, `vertical_fallback_holes`, `rows_dropped` |

**Returns:** `pandas.DataFrame` (or `(DataFrame, dict)`) — survey with synthetic stations, sorted by `hole_id`, `depth`, index reset.

---

### drop_orphan_intervals

```python
drop_orphan_intervals(table, collar, hole_col=HOLE_ID)
```

Drop interval rows whose `hole_id` is not in the collar table.  Complement of the `orphan_intervals` validation check.

**Returns:** `pandas.DataFrame` — filtered copy of `table` with the index reset.

---

### swap_inverted_intervals

```python
swap_inverted_intervals(table, from_col=FROM, to_col=TO)
```

Swap `from` and `to` where the values are inverted (`to < from`).  Fixes the common data-entry typo.  Rows where `to == from` (zero-length, genuinely malformed) are left untouched and require manual review.  All other columns preserved.

**Returns:** `pandas.DataFrame` — copy of `table` with inverted rows corrected.

---

### normalize_azimuth

```python
normalize_azimuth(survey, azimuth_col=AZIMUTH)
```

Wrap survey azimuths into `[0, 360)` by applying `value mod 360`.  Folds `360` to `0`, brings negatives like `-30` to `330`, and is idempotent for already-valid values.  NaNs and non-numeric cells are left untouched.

**Returns:** `pandas.DataFrame` — copy of `survey` with the azimuth column wrapped.

---

### fix_overlaps

```python
fix_overlaps(table,
             hole_col=HOLE_ID, from_col=FROM, to_col=TO,
             value_cols=None,
             touching_tol=0.01, merge_tol=0.05, coverage_min=0.95,
             precedence_col=None, precedence=None,
             return_diagnostics=False)
```

Auto-resolve safe interval overlaps and surface only genuine value-conflicts for human review.  Handles three classes automatically, plus an opt-in fourth:

| Class | Pattern | Action |
|---|---|---|
| **Touching** | `A.to > B.from` by less than `touching_tol` metres | Snap `A.to = B.from` (float-rounding cleanup) |
| **Duplicate** | Identical `(hole_id, from, to)` *and* identical `value_cols` | Drop all but the first |
| **Resampled superset** | A longer interval fully contains shorter ones whose length-weighted mean ≈ the longer's value within `merge_tol`, with coverage ≥ `coverage_min` | Drop the longer, keep the higher-resolution rows |
| **Dataset precedence** (opt-in) | Two overlapping rows come from different datasets listed in `precedence` | Drop the row from the lower-ranked dataset; rows from unlisted datasets are never dropped this way |
| **Conflict** | Anything else — partial overlap, same depth-zone with materially different values | Leave untouched, return in the `conflicts` frame |

| Parameter | Type | Default | Description |
|---|---|---|---|
| `table` | `pandas.DataFrame` | — | Interval table |
| `value_cols` | iterable of str | `None` | Columns to compare for duplicate / superset detection; defaults to every column other than `hole_col`/`from_col`/`to_col` |
| `touching_tol` | float | `0.01` | Max overlap (m) treated as a snap-me glitch |
| `merge_tol` | float | `0.05` | Max relative diff between superset value and inner mean |
| `coverage_min` | float | `0.95` | Min coverage of a superset by inner rows before it qualifies |
| `precedence_col` | str | `None` | Column naming each row's dataset / campaign (e.g. `project_id`) |
| `precedence` | iterable of str | `None` | Dataset values in priority order, highest first.  With `precedence_col`, enables the dataset-precedence class; audit rows carry `kind="precedence"` |
| `return_diagnostics` | bool | `False` | When `True`, return `(fixed, conflicts, report)` instead of just `fixed` |

**Returns:** `pandas.DataFrame`, or `(pandas.DataFrame, pandas.DataFrame, pandas.DataFrame)` when `return_diagnostics=True`.  The report has columns `hole_id, kind, action, from, to, note` — one row per resolved or flagged overlap.

---

### replace_below_detection_limit

```python
replace_below_detection_limit(df,
                              columns=None,
                              sentinel_factor=0.5,
                              strategy=None,
                              numeric_negative_sentinels=True)
```

Replace below-detection-limit (BDL) sentinels with imputed values.  Handles both common BDL conventions:

- **String sentinels** like `"<0.005"` (common in lab CSV exports).  The numeric is parsed as the MDL.
- **Numeric negative sentinels** like `-0.005` (common in WAMEX / GSWA legacy exports).  A value `V < 0` is treated as BDL with `MDL = abs(V)`.  Set `numeric_negative_sentinels=False` to leave numeric negatives untouched when they're real signed measurements.

The replacement is controlled by `strategy` (preferred) or `sentinel_factor` (legacy):

| `strategy` | Replacement |
|---|---|
| `"half-mdl"` | `MDL * 0.5` (industry default for stats) |
| `"mdl"` | `MDL` (full detection limit) |
| `"zero"` | `0.0` |
| `"nan"` | `NaN` (best for visualisation — colour ramps tighten around real measurements) |

When `strategy` is omitted, falls back to `sentinel_factor` (default `0.5`) so existing callers keep working.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `df` | `pandas.DataFrame` | — | Source table |
| `columns` | iterable of str | `None` | Columns to scan; defaults to every numeric or string column |
| `sentinel_factor` | float | `0.5` | Multiplier applied to the detection limit; ignored if `strategy` is set |
| `strategy` | str | `None` | One of `BDL_STRATEGIES`; takes precedence over `sentinel_factor` |
| `numeric_negative_sentinels` | bool | `True` | Treat numeric negatives as BDL |

**Returns:** `pandas.DataFrame` — copy of `df` with replacements applied; touched columns are coerced numeric where possible.

---

## baselode.drill.view

Plotly-based strip-log visualisation helpers.

```python
import baselode.drill.view as view
```

### compute_interval_points

```python
compute_interval_points(df, value_col, from_cols=(...), to_cols=(...), drop_null_values=True)
```

Convert assay rows into midpoint-based interval points suitable for Plotly error-bar plots.

**Returns:** `pandas.DataFrame` with columns `z`, `val`, `from_val`, `to_val`, `err_plus`, `err_minus`

### plot_numeric_trace

```python
plot_numeric_trace(interval_df, value_col, chart_type="markers+line",
                   color="#8b1e3f", intervals=True, template=None,
                   color_by=None, log_scale=False)
```

Plot a single numeric assay column as a Plotly figure.

**`chart_type` options:** `"bar"`, `"markers"`, `"markers+line"`, `"line"`, `"colored-line"`, `"filled-line"`, `"step-line"`, `"heat-strip"`

| Chart type | Rendering |
|---|---|
| `"colored-line"` | Graded line — markers coloured by value on the magma ramp + colour bar |
| `"filled-line"` | Line with the area back to zero shaded (series colour at alpha 0.35) |
| `"step-line"` | Stepped line drawn along each interval's from/to extent |
| `"heat-strip"` | Full-track-width bars coloured by value on the magma ramp |

`log_scale=True` switches the value axis to a log scale for the `bar`, `markers`, `markers+line`, `line`, `filled-line`, and `step-line` chart types (silently ignored elsewhere). Also accepted by `plot_drillhole_trace` (where it additionally applies to `two-curve`).

### plot_drillhole_trace

```python
plot_drillhole_trace(df, value_col, chart_type=None, categorical_props=None,
                     numeric_chart="markers+line", color=None, use_mid=False,
                     intervals=True, colour_map=None, color_by=None,
                     multi_props=None, log_scale=False, template=None)
```

Chart-type dispatcher: plots one track for a single drillhole, routing to the matching track builder.  When `chart_type` is omitted it is inferred — `"categorical"` if `value_col` is in `categorical_props`, else `numeric_chart`.

**`chart_type` options:** every `plot_numeric_trace` option plus `"categorical"`, `"multi-line"`, `"multi-stacked"`, `"two-curve"`, `"composition"`, `"point-log"`, `"annotations"`, `"dip-azimuth"`

| Chart type | Route |
|---|---|
| `"multi-line"` / `"multi-stacked"` | `plot_multi_assay` over `value_col` + `multi_props` |
| `"two-curve"` | `plot_two_curve_fill` — `value_col` is curve A, the first `multi_props` entry is curve B; without an extra property an empty templated figure is returned |
| `"composition"` | `plot_composition_log` over `value_col` + `multi_props` (stack order) |
| `"point-log"` | `plot_point_log` — depth per row from a `depth` (or `mid`) column, else interval from/to mid-depths |
| `"annotations"` | `plot_depth_annotations` — same per-row depth resolution as `"point-log"` |
| `"dip-azimuth"` | `plot_dip_azimuth_log` — the frame supplies `depth`/`dip`/`azimuth` columns |

Unresolvable inputs (missing columns, no resolvable depths) return an empty figure that still carries the resolved template.

**Returns:** `plotly.graph_objects.Figure`

### plot_two_curve_fill

```python
plot_two_curve_fill(df, value_col_a, value_col_b, from_cols=None, to_cols=None,
                    color_a=None, color_b=None, log_scale=False, template=None)
```

Two numeric curves with the region between them shaded by dominance, split at every crossing (classic neutron–density display).  Where A > B the fill uses A's colour at alpha 0.4; where B > A it uses B's.  Curve colours default to the commodity colour for each column name, falling back to `MULTI_SERIES_COLORWAY[0]` / `[1]`.  Also reachable through `plot_drillhole_trace` as the `"two-curve"` chart type.

**Returns:** `plotly.graph_objects.Figure`

### plot_composition_log

```python
plot_composition_log(df, value_cols, from_col=FROM, to_col=TO,
                     colour_map=None, normalize=True, template=None)
```

Percent-composition track: divided horizontal stacked bars per interval, one trace per component (*value_cols* order = legend + stack order).  With `normalize=True` (default) each interval's components are scaled to fractions of their sum and the axis is fixed to [0, 1] with percent ticks; with `normalize=False` raw values are stacked and the axis autoranges.  All-null/zero intervals are skipped; negative values are clamped to 0 for the bar (raw value in hover).  Also reachable through `plot_drillhole_trace` as the `"composition"` chart type.

**Returns:** `plotly.graph_objects.Figure`

### plot_depth_annotations

```python
plot_depth_annotations(df, depth_col=DEPTH, text_col=COMMENTS,
                       marker_color=None, template=None)
```

Depth-pinned text annotations: a tick at the track's left edge with the note text alongside.  Long notes are word-truncated to ~40 characters for display; the full text stays in hover.  Composes with the other strip-log tracks (reversed depth axis, hidden [0, 1] x-axis).  Also reachable through `plot_drillhole_trace` as the `"annotations"` chart type.

**Returns:** `plotly.graph_objects.Figure`

### plot_dip_azimuth_log

```python
plot_dip_azimuth_log(df, depth_col=DEPTH, dip_col=DIP, azimuth_col=AZIMUTH,
                     color_by=None, template=None)
```

Split dip-magnitude / dip-azimuth tracks sharing one reversed depth axis: dip markers on a fixed [0, 90] axis, azimuth markers on a fixed [0, 360] axis with ticks every 90°.  `color_by` (e.g. defect type) renders one trace per category with a legend shared across both tracks.  Also reachable through `plot_drillhole_trace` as the `"dip-azimuth"` chart type.

**Returns:** `plotly.graph_objects.Figure`

### Pattern (hatch) fills

`plot_strip_log` and `plot_categorical_trace` accept an optional `pattern_map` — category → Plotly `marker.pattern` shape (`"/"`, `"\\"`, `"x"`, `"-"`, `"|"`, `"+"`, `"."`, or `""` = solid), looked up case-insensitively like the colour maps.  Pass a `dict` or the built-in name `"lithology"` (`baselode.colours.LITHOLOGY_PATTERNS`, resolved via `resolve_pattern_map`).  Matched categories render a light white hatch over the band colour; unmapped categories stay solid.

---

## baselode.drill.structural

Structural measurement processing and geometry helpers.

```python
import baselode.drill.structural as structural
```

### alpha_beta_to_dip_azimuth

```python
alpha_beta_to_dip_azimuth(hole_dip, hole_azimuth, alpha, beta)
```

Convert core-frame alpha/beta measurements to true dip / dip direction.  Vectorised with numpy — accepts scalars or array-likes (broadcast together).

| Parameter | Convention |
|---|---|
| `hole_dip` | Survey convention, negative = downward (e.g. −60) |
| `hole_azimuth` | Degrees clockwise from north |
| `alpha` | Acute angle between the planar feature and the core axis (90° = perpendicular) |
| `beta` | Degrees clockwise (looking downhole) from the bottom-of-hole reference line to the down-hole apex of the ellipse trace |

For a near-vertical hole (`|hole_dip| > 89.9`) the bottom-of-hole reference is degenerate and falls back to north projected perpendicular to the core axis (beta is then measured from north).

**Returns:** `(dip, dip_direction)` in degrees — dip in [0, 90] positive down, dip direction in [0, 360) as the azimuth of steepest descent.  Cross-validated against the committed golden fixture `test/data/structural_reference.json` (shared with the JS implementation).

---

## baselode.drill.view_3d

3D-ready payload generation.

```python
import baselode.drill.view_3d as view3d
```

### traces_as_segments

```python
traces_as_segments(traces, color_by=None)
```

Convert a desurveyed trace DataFrame into a list of segment dicts ready for the JS `Baselode3DScene`.

### intervals_as_tubes

```python
intervals_as_tubes(intervals, radius=1.0, color_by=None)
```

Convert an assay/interval DataFrame into tube payload dicts for 3D rendering.

---

## baselode.blockmodel

Block models as a primitive: a sub-blocked grid definition plus a blocks table.

```python
import baselode.blockmodel as blockmodel
```

### BlockModelDefinition

```python
BlockModelDefinition(origin, block_size, n_blocks, parent_size=None, rotation=None,
                     crs="", name="", description="", extra=None)
```

| Parameter | Type | Description |
|---|---|---|
| `origin` | `(x, y, z)` or dict | World coordinates of the grid's minimum corner |
| `block_size` | `(dx, dy, dz)` or dict | Base block size — the finest cell; every block spans whole base blocks |
| `n_blocks` | `(nx, ny, nz)` or dict | Grid extent in base blocks |
| `parent_size` | `(nx, ny, nz)` or dict, optional | Parent block size in base-block multiples |
| `rotation` | `{azimuth, dip, plunge}` or `(az, dip, plunge)`, optional | Degrees. `azimuth` = bearing of the grid y axis clockwise from north; `dip` tilts the y axis down; `plunge` tilts the x axis down. `R = Rz(azimuth) · Rx(dip) · Ry(plunge)` |
| `crs`, `name`, `description`, `extra` | | Metadata carried through `to_dict()` |

Properties: `is_rotated`, `is_subblocked`, `n_parent_blocks`, `parent_block_size`, `extent`, `base_cell_count`, `base_cell_volume`, `azimuth` / `dip` / `plunge`.

| Method | Returns |
|---|---|
| `rotation_matrix()` | 3×3 `R` with `world = origin + R @ local` |
| `local_to_world(u, v, w)` / `world_to_local(x, y, z)` | Scalars or arrays |
| `index_to_world(i, j, k, ni=1, nj=1, nk=1)` | World centroid of the block spanning those base cells |
| `world_to_index(x, y, z)` | Base cell containing each point (may fall outside the grid) |
| `contains_index(i, j, k, ni=1, nj=1, nk=1)` | Boolean (arrays ok) |
| `parent_index(i, j, k)` | Parent block index; identity without parents |
| `corners()` / `bounds()` / `outline_2d()` | Eight world corners / axis-aligned world bbox / GeoJSON footprint |
| `to_dict()` / `BlockModelDefinition.from_dict(meta)` | JSON round-trip; `from_dict` also accepts legacy `*_meta.json` (`origin.rotation_deg`, `min_block_size`, `max_block_size`, `bbox_3d`) |
| `same_grid(other, tol=1e-6)` | True when origin, base block size and rotation match |

### BlockModel

```python
BlockModel(blocks, metadata=None, *, definition=None)
```

`blocks` must carry either `x, y, z, dx, dy, dz` or (with a definition) `i, j, k` (+ optional `ni, nj, nk`); the other encoding is derived.  Attribute columns are everything else (`attribute_columns`).  `definition` may be a `BlockModelDefinition` or its dict; when omitted, one is built from legacy `metadata` if it carries enough.

| Method | Description |
|---|---|
| `total_volume()`, `filtered_volume(criteria)`, `attribute_stats(attribute, filter_criteria=None)`, `block_size_stats()`, `query_metadata()` | Unchanged legacy API |
| `validate()` | `validate_block_model(self)` |
| `occupancy()` | `{(i, j, k): row}` map of covered base cells (cached) |
| `block_at(x, y, z)` | Row position of the covering block, or `None` |
| `sample_at(points, attributes=None)` | DataFrame `x, y, z, block_row, <attributes>` (`block_row = -1` where uncovered) |
| `select(criteria)` / `clip(bounds)` | New models; `bounds` is any subset of `min_x … max_z` |
| `regularize()` | Every block split into base blocks (attributes copied, volume preserved) |
| `to_parent_blocks(aggregations=None, density_col=None)` | Sub-blocks merged to parents. Numerics: volume-weighted mean (mass-weighted with `density_col`; the density column itself stays volume-weighted). Categoricals: volume-weighted majority. Rules per column: `"mean"`, `"sum"`, `"min"`, `"max"`, `"majority"`, `"first"` or a callable `(values, weights)`. Adds `n_subblocks` and `fill_fraction` |
| `tonnage(density_col=None, density=None, criteria=None)` | `sum(volume × density)`; parent rows are scaled by `fill_fraction` |
| `grade_tonnage(grade_col, cutoffs, density_col=None, density=None)` | DataFrame `cutoff, n_blocks, volume, tonnes, grade, metal` (grade ≥ cutoff, tonnage-weighted grade) |
| `diff(other, attributes=None, tol=1e-9)` | `{"summary": {added, removed, changed, unchanged, cells_a, cells_b}, "cells": DataFrame}` on the shared base grid |
| `to_dict()` / `save(path_stem, formats=("parquet", "csv"))` | Metadata dict (includes `definition`) / writes `<stem>.parquet`, `<stem>.csv`, `<stem>_meta.json` |

### Module functions

```python
load_blocks(source, kind="csv", metadata=None, definition=None, source_column_map=None, ...)
attach_block_indices(blocks, definition, overwrite=False)     # x/y/z/dx/dy/dz -> i/j/k/ni/nj/nk
attach_block_centroids(blocks, definition, overwrite=False)   # i/j/k/ni/nj/nk -> x/y/z/dx/dy/dz
load_block_metadata(source)
```

### baselode.blockmodel.validate

| Function | Issue types |
|---|---|
| `validate_alignment(blocks, definition, tol=1e-6)` | `misaligned_corner`, `size_not_multiple`, `non_positive_block_size` |
| `validate_index_consistency(blocks, definition)` | `index_mismatch` — supplied `i…nk` disagree with the geometry |
| `validate_within_grid(blocks, definition)` | `block_outside_grid`, `missing_index` |
| `validate_parent_containment(blocks, definition)` | `straddles_parent`, `larger_than_parent` |
| `validate_no_overlap(blocks, definition=None)` | `overlap` — cell walk with a definition, pairwise AABB without |
| `validate_block_sizes(blocks, max_block_size)`, `validate_blocks_in_bbox(blocks, bbox_3d)` | Legacy helpers, unchanged |
| `validate_block_model(model)` | `{"summary", "issues"}` report over `alignment` (error), `index_consistency` (error), `within_grid` (error), `overlap` (error), `duplicate_index` (error), `nan_centre` (error), `parent_containment` (warning) |

---

## baselode.map

Folium/Plotly map helpers.

```python
import baselode.map as bmap
```

### create_leaflet_map

```python
create_leaflet_map(center=None, zoom_start=2)
```

Create a Folium `Map` with OpenStreetMap tiles.

### map_collar_points

```python
map_collar_points(collars, color_by=None)
```

Prepare collar points for 2D map plotting.  Optionally attach a `color_value` column.

### map_collars

```python
map_collars(collars, color="#2563eb", radius=5, fill_opacity=0.7, tooltip_cols=None, ...)
```

Plot collar points on a Folium map.  Returns the updated `folium.Map`.

---

## baselode.datamodel

Constants for the Baselode Open Data Model.

```python
from baselode.datamodel import (
    HOLE_ID, LATITUDE, LONGITUDE, ELEVATION,
    AZIMUTH, DIP, FROM, TO, MID,
    PROJECT_ID, EASTING, NORTHING, CRS,
    DEPTH, ALPHA, BETA, COMMENTS
)
```

---

## GSWA flat SQL queries

`baselode.adaptors.raw_gswa.queries` builds parameterised SQL for a caller-owned
PostgreSQL connection. Select the shape of the database snapshot explicitly:

```python
import baselode.adaptors.raw_gswa.queries

sql, params = baselode.adaptors.raw_gswa.queries.build_assay_flat_query(
    hole_ids=["stable-hole-id"],
    analyte_columns=["Au_PPM", "SiO2_PCT"],
    schema="postgres_gswa",
    source_release="2026-05",
)
```

`build_assay_flat_query` and `build_surface_sample_assay_flat_query` accept
`source_release="2025-10"` (the default) or `"2026-05"`. The builders do not
inspect the database and cannot infer the release from a schema name. Specify
`"2026-05"` after changing the database snapshot; choose analyte columns present
in that release. Omit `analyte_columns` to select all publisher columns.

The drill builder obtains the stable `HoleId` through a left join to
`dbo_collar`, retaining unmatched flat rows when no hole filter is requested.
It uses `Latitude`/`Longitude`/`Dip` for 2025-10 and
`CollarLatitude`/`CollarLongitude`/`DIP` for 2026-05. These output columns keep
their publisher names. Surface projections retain `SurfaceSampleId` and
`SurfaceSampleType` only in 2025-10; in 2026-05 `Id` is the surface parent key.

Queries preserve rows, values and unit suffixes, including `_PPM` and `_PCT`.
They do not normalise chemistry or certify publisher quality. The caller must
retain provenance and apply its own recorded QAQC policy before interpreting
suspected inconsistencies.

Copyright (C) 2026 Darkmine Pty Ltd.

### Raster alignment, resampling and horizontal reprojection

`describe_alignment()` exposes the shared v1 target/options schemas, EPSG list,
resource limits and assumptions. `align_raster(source, target, options)` returns a
structured `ok`, `needs_input` or `rejected` report; check its state before using
artifacts. `match_raster(source, reference, options)` takes only the reference
shape, affine transform, CRS, coordinate units and frame ID. Source bands, field
units and correction declarations are retained; inputs are never modified.

```python
import baselode.geophysics

report = baselode.geophysics.align_raster(source, {
    "shape": [100, 120],
    "transform": [50, 0, 400000, 0, -50, 6800000],
    "crs": "EPSG:28350",
}, {"method": "bilinear", "value_kind": "continuous"})
if report["state"] == "ok":
    aligned = report["artifacts"]["raster"]
    supported = report["artifacts"]["support"]
```

Shape is `[rows, columns]`; Python also accepts tuples for shape/transform.
Transform `[a,b,c,d,e,f]` maps pixel-edge coordinates
`x=a*column+b*row+c`, `y=d*column+e*row+f`. Sampling occurs at target cell centres;
rotation and shear are supported. Specify nearest or bilinear explicitly.
Categorical safe-integer codes require nearest. Bilinear requires every cell with
nonzero weight to be valid; edge cells cover the outer half-cell. Unsupported
values stay NaN. Per-band `support` records finite samples; single-band
`footprint` records source coverage irrespective of missing values, and
`coordinate_valid` records finite transformed coordinates, even outside coverage.
Masks contain 0/1 and use dimensionless units.

For a CRS change, add `datum_policy: "backend"`. The descriptor lists supported
2D EPSG codes (WGS84 geographic/Web Mercator/UTM and supported Australian systems).
Python uses [pyproj/PROJ](https://pyproj4.github.io/pyproj/stable/api/transformer.html)
with XY axis order and ballpark transformations disabled. JavaScript uses the
existing [proj4](https://proj4js.org/) definitions, including approximate Australian
datum transforms. Reports and processing lineage record the backend/version;
this acknowledgement accepts those differences and makes no survey-grade datum
accuracy guarantee. An unavailable transformation is rejected; invalid point
coordinates have zero coordinate_valid/support.

Unreferenced local grids need matching source metadata and target `frame_id`, plus
matching `crs_units` (`m`, `ft`, `us-ft`, `km`, or `degree`). Equal custom CRS labels
can be resampled with explicit coordinate units. A local grid cannot be assigned
an unrelated global CRS. No height/epoch transformation, field-unit conversion,
vector rotation, antialiasing, conservative averaging or uncertainty propagation
is performed. Decimation can alias fine-scale content. Historical geometry,
transport fields and uncertainty move into flat source lineage; active metadata
sets `uncertainty_propagated=False`. Scientific declarations are preserved.

The direct APIs do not extend raster workflow v1. Limits are one million source
band values, 100,000 target cells and 250,000 target band values; no automatic
truncation or decimation is used. Portable finite JSON metadata is required
(up to 16 MiB). A reference raster contributes no values or scientific metadata.

### Elevation-aware equivalent-source gridding

Install `pip install 'baselode[potential-fields]'` for the supported Harmonica
0.7.x backend. This optional BSD-3-Clause dependency is used through its public
API; no third-party implementation or survey fixtures are bundled.
`describe_equivalent_sources()` exposes parameter schemas, a versioned JSON
request schema, result contract, backend requirements and resource limits.

`grid_equivalent_sources(observations, options)` fits one `magnetic_anomaly` or
`gravity_anomaly` channel at its actual XYZ coordinates and predicts a constant
height grid. The underlying [Harmonica equivalent-source engine](https://www.fatiando.org/harmonica/v0.7.0/api/generated/harmonica.EquivalentSources.html)
uses a generic harmonic 1/r basis. Coefficients describe the field; they are not
an interpretation of geological source geometry or physical masses.

```python
import baselode.geophysics

observations = {
    "records": [
        {"id": "a", "x": 0, "y": 0, "z": 20, "values": {"mag": 10}},
        {"id": "b", "x": 100, "y": 0, "z": 25, "values": {"mag": 11}},
        {"id": "c", "x": 0, "y": 100, "z": 30, "values": {"mag": 9}},
        {"id": "d", "x": 100, "y": 100, "z": 35, "values": {"mag": 10}},
    ],
    "channels": {"mag": {"field_type": "magnetic_anomaly", "units": "nT"}},
    "crs": "EPSG:28350", "crs_units": "m",
    "metadata": {"height_units": "m", "height_datum": "AHD", "z_positive": "up"},
}
interpolation = {
    "channel": "mag", "depth": 100, "damping": 1e-6,
    "radius": 150, "duplicate_policy": "mean", "extrapolation": "mask",
}
report = baselode.geophysics.grid_equivalent_sources(observations, {
    **interpolation, "bounds": [0, 0, 100, 100], "shape": [5, 5], "target_height": 50,
})
if report["state"] == "ok":
    grid = report["artifacts"]["grid"]
    support = report["artifacts"]["support"]
```

Bounds are outer edges, shape is `[rows, columns]`, and centres follow north-up
raster conventions. Horizontal coordinates must be projected/local Cartesian;
local observations also need a `metadata.frame_id`. `height_units` must match
linear XY units (aliases are normalized; values are never converted).
`height_datum` must name a shared datum; `z_positive` must be `up`. Missing usable
observation elevations require input rather than invented heights. Unsupported
field families, geographic coordinates, conflicting units and target heights
below the maximum used observation elevation are rejected.

A source occupies each unique training XY, all on the plane
`min(training z) - depth`. Depth is explicit and positive. Damping is an explicit
positive scalar or `None` for undamped fitting; no depth/damping is estimated
silently. Exact XYZ duplicates require mean/reject policy. Repeated XY at
different heights are distinct measurements. At least three noncollinear XY
locations are required. The backend works on centred coordinates and reports
versions, source geometry, fit warnings and work estimates.

Artifacts are `grid`, `support`, `nearest_distance` and `extrapolation`.
Unsupported grid values are NaN. Support uses nearest XY distance within `radius`
and the convex-hull policy (`mask` default, or explicit `allow`). The dense model
uses all training measurements; radius does not localize the fit. Diagnostics are
geometric support, not calibrated uncertainty. Fitted-observation residuals use
**predicted minus observed**, including each original duplicate reading. Inputs,
field units and correction declarations are preserved; stale geometry/uncertainty
is retained in flat lineage. ERS/GeoTIFF exports retain effective parameters,
backend and source geometry. No uncertainty propagation is claimed.

`cross_validate_equivalent_sources(payload, interpolation, validation, candidates=None)`
refits entire models for held-out lines or explicit-origin blocks, using the
[baseline spatial split contract](/api/python#baseline-observation-gridding-and-spatial-validation).
All training observations at held-out XY are excluded even if elevations differ;
a buffer can exclude a wider halo. Fold source planes use training elevations
only. Unsupported fold geometry or predictions below its source plane remain
unsupported. Candidate pairs contain exactly `depth` and `damping`:

```python
validation = baselode.geophysics.cross_validate_equivalent_sources(
    survey_with_line_ids, interpolation,
    {"by": "line", "buffer_distance": 25},
    [{"depth": 100, "damping": 1e-6}, {"depth": 200, "damping": 1e-3}],
)
```

Each candidate returns per-fold predictions, coverage and paired-only RMSE/MAE/bias.
`best_index` selects the lowest-RMSE candidate **only among complete-coverage
candidates**; it is None when none qualifies. Partial-coverage errors must be read
with coverage. Selection scores are tuning results, not independent final test
errors; use a separate survey/outer holdout for that assessment. No model is fit
to held-out observations. An explicit `allow` extrapolation policy can be needed
for boundary lines; it remains constrained by radius and vertical domain.

`run_equivalent_sources(request)` accepts the descriptor's versioned JSON
contract, dispatching `operation="grid"` or `"cross_validate"`. It returns the
same reports with grid artifacts converted to full-resolution `to_payload()`
objects (null for missing values). It performs no file/network I/O and executes
no user code. A hosting application can route these requests from JavaScript;
this library supplies no implicit RPC client. Direct grid/validation APIs return
structured `ok`, `needs_input`, `rejected` or backend `failed` states. A missing
optional backend raises ImportError with installation instructions.

Limits: 512 input records, 10,000 grid cells, 16 folds, 8 candidates, cumulative
sum of fit record-count cubed <=250 million and prediction-pair estimate <=10
million. These bound dense work, not exact memory/time. Nothing is truncated or
decimated. The adapter does not perform downward continuation, vertical datum
conversion, arbitrary target surfaces, vector rotation, RTP, joint inversion,
Earth-curvature modelling or large-survey windowing. Independent tests recover
an exact synthetic 1/r field at varying elevations (relative tolerance 1e-7) and
an off-layer/off-grid source with small injected noise and gaps (absolute error
<=0.05 in the synthetic field units). These cases establish bounded examples,
not a general survey accuracy guarantee.

### Observation correction ledger and magnetic base correction

`describe_corrections()` returns the shared ledger/declaration/base schemas,
registered correction names/aliases, data-binding protocol and limits.
`inspect_corrections(payload)` validates history and returns per-channel states;
`declare_corrections(payload, declarations)` appends evidence-backed history to a
copied observation document. Every successful operation returns an independent
`ledger` in the report; declaration/correction also return `observations`.
Neither inspection nor declaration changes readings. Missing history
is **unknown**. A declaration can resolve unknown state, but cannot change a
known applied/unapplied state to a different state. Declarations record knowledge;
they do not apply a numerical correction.

`correct_magnetic_base(survey, base, options)` performs the first guarded
correction in this family. Both selected channels need known **unapplied**
`magnetic_diurnal` history, including the base monitor. Legacy
`metadata.corrections` aliases such as `diurnal`/`base_station` are imported
conservatively. Conflicting aliases are rejected. The scalar legacy summary is
kept consistent with per-channel history; mixed channel states summarize as
unknown. Already applied history and reused event IDs are rejected.

```python
import baselode.geophysics

# Source history/QC must establish these declarations; do not infer them.
survey_history = baselode.geophysics.declare_corrections(survey, [{
    "id": "survey-source-check", "correction": "magnetic_diurnal",
    "channels": ["mag"], "state": "unapplied", "evidence": "Raw contractor export checked",
}])
base_history = baselode.geophysics.declare_corrections(base, [{
    "id": "base-source-check", "correction": "magnetic_diurnal",
    "channels": ["base"], "state": "unapplied", "evidence": "Raw stationary monitor checked",
}])
if survey_history["state"] == base_history["state"] == "ok":
    report = baselode.geophysics.correct_magnetic_base(
        survey_history["observations"], base_history["observations"], {
            "channel": "mag", "base_channel": "base", "reference": 50000,
            "max_gap": 30, "event_id": "diurnal-1", "evidence": "Base QC and clocks checked",
            "clock_policy": "synchronized",
        },
    )
    if report["state"] == "ok":
        corrected = report["observations"]
```

Survey input is a v1 observation document with a `magnetic_total_field` or
`magnetic_anomaly` channel in nT. Base input has a `magnetic_total_field` channel
in nT, one nonnull `station_id` across all records, and stationary XYZ wherever
positions are present. All base records, including null-reading gap markers,
need UTC Unix timestamps in strictly increasing acquisition order. Duplicate or
unsorted base times need explicit input QC. Survey order may differ from time
order and is retained. `reference` is an explicit baseline in nT; it is never
estimated from the base series. `max_gap` is a positive bracket length in seconds.
The caller must establish clock synchronization, base geographic suitability,
calibration and disturbance-free recording; those cannot be inferred here.

The calculation is
`variation = linear_interpolated_base - reference` and
`corrected = observed - variation`. The base variation subtraction is consistent
with the [EPA magnetic survey description](https://archive.epa.gov/esd/archive-geophysics/web/html/magnetic_methods.html).
Interpolation requires two nonnull bracketing base samples separated by no more
than max_gap; it never crosses a null sample or extrapolates outside the base
span. Exact nonnull base samples remain usable even when adjacent gaps are long.
Each nonnull survey reading needs a time and supported base value before the
operation commits. Otherwise state is `needs_input`, `observations` is None and
per-reading `proposals` explain coverage/reasons. Null survey readings remain
null and are excluded from the application count. Numerical range/field/unit or
history violations return `rejected`. No partial corrected dataset or ledger
application is returned. There is no repeat/force override.

A successful ledger event records input/output/base bindings, exact parameters,
station identity, affected reading count, evidence and producer version. All
records/other channels and field type/units are preserved. Diurnal correction
alone does not remove IGRF or relabel total field as anomaly. Existing metadata uncertainty/variance/standard_deviation
moves into flat input lineage and `uncertainty_propagated=False` marks the output;
no uncertainty estimate is computed. Source/base metadata and processing history
survive downstream gridding and ERS/GeoTIFF exports.

The versioned `metadata.correction_ledger` validates event transitions, unique
IDs and chain continuity. Its SHA-256 binding covers normalized observation
identities/order, geometry/time/clearance, channel definitions/units and readings.
Numeric values use a shared binary64 encoding and magnitude <=1e100. Python integers that cannot be represented exactly as binary64 are rejected rather than hashed with lost precision; use an explicit float conversion only when that rounding is intended. Editing, adding or dropping bound data makes its ledger stale. Retained
processing records of base correction also block reinitializing a missing ledger. Arbitrary metadata and row
extensions are excluded from the binding; correction summaries are checked
separately. This guards ordinary workflows and records provenance; it does not
authenticate stripped or maliciously rewritten metadata. Preserve traceable raw
inputs when changing datasets. Ledger-bound subsetting/merging is not supplied
by this increment.

Limits: 64 ledger events, 256 KiB options/declarations, 32 MiB binding snapshots,
and the existing observation limits (100,000 rows, 250,000 readings, 16 MiB JSON).
The 16 MiB output-document limit includes embedded source/base lineage and is
reported as a resource error before returning any corrected observations.
No rows/history are silently truncated. Correction IDs for later magnetic,
gravity and radiometric operations can be declared/inspected, but only magnetic
base correction is numerically implemented here. These direct APIs leave raster
workflow v1 unchanged.

### IGRF14 reference fields and scalar removal

Install `pip install 'baselode[magnetics]'`. `describe_igrf()` exposes shared
request/result schemas, removal options, model identity and limits; it works
without the optional backend. `calculate_igrf(request)` returns a JSON report:

```python
import baselode.geophysics

reference = baselode.geophysics.calculate_igrf({
    "model": "IGRF14",
    "points": [{"id": "station-1", "longitude": 115.86, "latitude": -31.95,
                "height_m": 100, "time": 1735689600}],  # 2025-01-01 UTC
})
```

Coordinates are WGS84 geodetic longitude east/latitude north in degrees, height
in metres above the WGS84 ellipsoid, and time in UTC Unix seconds. Each point
has its own date. North/east/down, horizontal and total intensity are nT;
declination is east-positive and inclination down-positive, in degrees.
The adapter maps UTC dates to official decimal-year interpolation. Supported
dates are 1900-01-01 through 2030-01-01 inclusive, without extrapolation.
The first adapter accepts heights -1000 to 100000 m, excludes exact poles,
and limits a request to 512 points and 512 distinct times. Partition explicitly.
The local ppigrf 2.1.0 IGRF14 coefficient file is selected explicitly and its
SHA-256 is verified; no model data is downloaded during processing.

`remove_igrf(observations, {"channel": "mag", "model": "IGRF14",
"event_id": "igrf-1", "evidence": "source correction history checked"})`
requires a `magnetic_total_field` channel in `nT`, bound or legacy **unapplied**
`magnetic_igrf` history, `crs="EPSG:4326"`, `crs_units="degree"` or `"degrees"`, and metadata
`height_units="m"`, `height_datum="WGS84_ellipsoid"`, `z_positive="up"`.
Use `declare_corrections` with evidence if history is unknown. Heights above
mean sea level need an explicit datum conversion before this API.

Removal subtracts model **F** from each nonnull reading and relabels the selected
channel `magnetic_anomaly`. Every such reading needs valid XYZ/time; failures
return no observations/ledger. Nulls, other channels, acquisition order and
extensions are preserved. Ledger events record bindings, options and the fixed
model identity, reject repeat removal, and remain inspectable in JavaScript.
Source metadata is retained in flat input lineage; uncertainty is not propagated.

IGRF describes the main internal field. This scalar residual does not remove
external/diurnal fields or supply a geological interpretation. See the
[official IGRF14 model](https://www.ncei.noaa.gov/products/international-geomagnetic-reference-field)
and [ppigrf backend](https://github.com/IAGA-VMOD/ppigrf).

### Magnetic survey lag correction

`correct_magnetic_lag(observations, options)` aligns one recorded magnetic
signal to the unchanged navigation coordinates and times. Options and ledger
schemas are discoverable through `describe_corrections()`.

```python
lagged = baselode.geophysics.correct_magnetic_lag(observations, {
    "channel": "mag", "lag_seconds": 0.5, "max_gap": 1,
    "unsupported_policy": "mask", "event_id": "lag-1",
    "evidence": "Calibrated sensor delay checked against navigation clock",
    "clock_policy": "synchronized",
})
```

The sign convention is **corrected(t) = input(t + lag_seconds)**. Positive lag
advances delayed magnetic readings; negative lag delays them. A pulse recorded
at time 2 appears at time 1 with lag_seconds=1. The caller supplies a calibrated
constant time lag; the library does not estimate it or convert a sensor offset
in metres into a time lag. See the [BGS processing description](https://earthwise.bgs.ac.uk/index.php/OR/14/014_Part_3:_Data_processing).

The selected channel must be `magnetic_total_field` or `magnetic_anomaly` in
`nT`, with known `unapplied` magnetic_lag history. All records require nonnull
`line_id` and UTC Unix seconds, including missing-reading gap markers. Times
must increase strictly within each acquisition-contiguous line segment. A line
ID reused after another line starts a separate segment. Interpolation uses the
original selected values, never crosses a segment boundary, never extrapolates,
and never bridges null source readings or a bracket wider than max_gap.
Existing target nulls stay null; exact valid source samples remain usable.
Timestamp comparisons use binary64 arithmetic with no implicit snapping tolerance.

Coverage is explicit: `unsupported_policy="reject"` returns `needs_input`,
proposals and diagnostics with no committed observations or ledger if any
nonnull reading lacks support. `"mask"` replaces unsupported readings with null
and archives their original IDs/values in the application event's
`masked_records`; at least one reading must remain supported. Record IDs/order,
XYZ/time, other channels, field types and extensions are preserved. Reports
include originals, proposed values, source IDs/times, interpolation weights,
segment indices and reasons. Input is never modified. An application requires
a unique event ID and cannot reset known history or run again on that channel.

Lag execution is bounded to 4096 records and +/-3600 seconds, alongside existing
correction option, ledger, binding and output limits. Normally align lag before
time/location-dependent base or IGRF corrections; existing stages are processed
as supplied and are never inverted or reordered. This API makes no claim that
those operations commute. Prior application counts are checked at the original
event position by accounting backwards for later masks. Mask originals and
ledger/source metadata persist through gridding and ERS/GeoTIFF exports.
Supported uncertainty fields move into standard flat source lineage, with
`uncertainty_propagated=false`; no calibrated uncertainty is calculated.

### Calibrated magnetic heading bias

`correct_magnetic_heading(observations, options)` subtracts a supplied scalar
heading bias from one magnetic channel. Shared options, context schema and
binding protocol are available in `describe_corrections()`.

Headings come from `record.extra[heading_key]`, with this explicit metadata:

```python
# Required declaration for the selected recorded heading field:
# metadata.heading = {"key": "sensor_heading", "units": "degrees",
#                     "reference": "true_north", "positive": "clockwise"}
heading_result = baselode.geophysics.correct_magnetic_heading(observations, {
    "channel": "mag", "heading_key": "sensor_heading",
    "heading_reference": "true_north", "calibration_id": "calibration-2026-01",
    "calibration": [{"heading_degrees": 0, "bias_nT": 2},
                    {"heading_degrees": 180, "bias_nT": -2}],
    "max_heading_gap": 180, "bias_convention": "observed_minus_reference",
    "event_id": "heading-1", "evidence": "Instrument calibration checked",
})
```

**corrected = observed - bias(heading)**. Positive bias means the instrument
reads too high. An external additive correction table therefore needs an
explicit sign conversion before use. The caller supplies a calibration valid
for the instrument/configuration and conditions; this API does not fit a model.

Calibration accepts 2–72 unique `heading_degrees` in `[0,360)`, paired with
finite nT biases. The copied table is sorted without changing input. Recorded
headings must be in `[0,360]`; 360 evaluates as north (0). Interpolation is
piecewise linear around the circle, including the north seam. Exact calibrated
headings remain supported; other headings need a bracketing arc no wider than
`max_heading_gap` in `(0,180]` degrees. Missing headings or unsupported arcs
return `needs_input` and proposals with no committed observations or event.
There is no heading masking or extrapolation in this API.

`metadata.heading` contains exactly `key`, `units`, `reference` and `positive`,
matching the selected key/reference, `degrees` and `clockwise`. Reference can
be `true_north`, `magnetic_north` or `grid_north`, and must match the supplied
calibration. No yaw, north-reference or coordinate conversion is inferred.
Every supplied nonnull heading must be valid, even on missing magnetic rows;
missing headings on already-null magnetic readings are permitted. Missing
magnetic readings remain null. No heading is derived from the flight track.

Selected data must be magnetic total field/anomaly in nT, with known unapplied
`magnetic_heading` history. A unique event ID and calibration evidence are
required. The result retains records/order, geometry/time, field type, extras
and other channels. Proposals report original/corrected values, bias, normalized
heading, calibration bracket, angular gap, weight and support reason.

A supplementary `heading_binding` SHA-256 covers the semantic model/options,
declared heading context and all record IDs/raw headings. Generic observation
bindings intentionally exclude metadata/extra fields; this additional binding
detects later heading, calibration or frame edits, including after lag masking.
Absent and null headings bind identically; raw 0/360 headings bind distinctly.
History remains a provenance guard, without authentication against rewriting.
Source uncertainty moves into standard remappable flat lineage; uncertainty is
not propagated. Work is bounded to 4096 records plus existing correction limits.

This supplied scalar table is distinct from full aircraft magnetic compensation:
it does not model attitude, manoeuvres, altitude or eddy currents, nor reorder
previous corrections. See [heading-table processing](https://help.seequent.com/UXO/2026.1/Content/usace_rtf/uceheading_gx.htm)
and the [USGS compensation workflow](https://www.usgs.gov/software/uasmagpy-python-code-compensating-rotary-wing-sling-load-uas-aeromagnetic-data).

### Crossover QC and fixed-reference line levelling

`describe_crossovers()` returns shared parameter/result schemas, limits and
assumptions. `analyze_crossovers(observations, options)` reports scalar mis-ties
without modifying the dataset:

```python
crossing_options = {
    "channel": "mag", "max_segment_length": 100, "min_crossing_angle": 30,
    "intersection_tolerance": 0.000001,
    "elevation_policy": "limit", "max_height_difference": 5,
}
qc = baselode.geophysics.analyze_crossovers(observations, crossing_options)
levelled = baselode.geophysics.level_magnetic_lines(observations, {
    **crossing_options, "reference_lines": ["T1", "T2"],
    "target_lines": ["L1", "L2"], "min_crossovers": 2,
    "min_reference_lines": 2, "max_abs_correction": 20,
    "max_rms_residual": 2, "event_id": "level-1",
    "evidence": "Fixed references and survey corrections checked",
})
```

All records require XY and `line_id`. Each line ID must have one contiguous
acquisition run; no cross-run joining or same-line self-crossovers is inferred.
Coordinates must describe a common projected/local Cartesian frame with linear
units (`m`, `ft`, `us-ft`, `km`), bounded to +/-1e12. Geographic coordinates need
explicit reprojection before this API; it does not transform observation data
or repair a stale ledger after external edits.

Adjacent points form straight segments. `max_segment_length` excludes geometry
across acquisition gaps. `intersection_tolerance` is in XY units, from 1e-9 to
1e6 and at most max_segment_length/100. It snaps near endpoints and allows at
most that separation between evaluated points, without extrapolating values.
Consecutive geometry no longer than twice the tolerance requires QC. A scaled
cross-product threshold of 1e-12 excludes near-parallel/collinear overlap
candidates. `min_crossing_angle` is an acute angle in `(0,90]` degrees.
Shared-vertex intersections count once by measurement topology; distinct
repeat-path measurements stay distinct. Eligible representatives are preferred,
then larger angle, then acquisition segment order. Exact endpoint values need
no valid far endpoint; interior interpolation needs both readings.

Crossovers expose coordinates, line IDs, source record brackets/fractions,
angle, interpolated values/heights and signed **value_a-value_b** differences.
Ineligible comparisons remain visible with reasons for missing readings,
shallow angle, missing heights or height mismatch. `elevation_policy="limit"`
requires linear metadata.height_units, a known height_datum and up/down
z_positive; max_height_difference uses those native height units.
`"ignore"` requires max_height_difference=null and explicitly acknowledges an
XY-only comparison. No height reduction, datum conversion or comparability
inference is performed. Geometry resource failures return no partial table.

Levelling requires a magnetic total-field/anomaly channel in nT and known
unapplied magnetic_levelling history. Reference and target lists must be disjoint
and cover every line. References stay fixed at zero bias. Each target bias is
the equally weighted mean of eligible **target-minus-reference** crossover
differences; corrected=observed-bias. One constant DC error is assumed for the
entire target line, including beyond tie positions. Every target must pass
minimum crossing/distinct-reference counts, maximum absolute correction and
post-fit RMS residual bounds before an output/event is committed. Quality
failures return reviewable crossing/proposal tables and no corrected data.
Nulls, references, XYZ/time, field type, order/extras and other channels remain.

A strict application stores the canonical reference-then-target line-offset
model and a supplementary levelling_binding over semantic options, roles,
offsets and horizontal/elevation context. Existing observation bindings protect
geometry/line IDs/readings. Editing the model or relevant context invalidates
history; later lag masks preserve historical application counts. Source
uncertainty is retained in remappable lineage, without propagation.

Execution is bounded to 4096 records/segments, 128 lines, one million active
pair tests, 8192 unique and 32768 raw crossing candidates, plus existing
correction limits. Numerical geometry uses binary64; no exact-arithmetic claim
is made. Partition complete lines with their required references, not arbitrary
point blocks. This is fixed-reference constant-offset levelling, without a global
network solve, polynomial drift, robust outlier removal or microlevelling. The
caller verifies reference quality, preprocessing order and physical compatibility.
See the [crossover/levelling methodology context](https://help.seequent.com/Oasismontaj/2023.2/Content/levelling/xlevel_gx.htm).

### History-preserving observation reprojection

`describe_reprojection()` documents `reproject_observations(observations, options)`.
It returns a correction report; successful `observations` and `ledger` are independent
copies. Supply `target_crs`, `datum_policy="backend"`, a unique `event_id` and
`evidence`. Source and target support WGS84 `EPSG:4326` and UTM
`EPSG:32601`–`32660` / `32701`–`32760`. Source units must be `degree`/`degrees`
or `m`/`metre`/`meter`; output uses `degree` or `m`. Coordinates always use XY
(longitude/latitude or easting/northing).

```python
projected = baselode.geophysics.reproject_observations(
    igrf_result["observations"],
    {"target_crs": "EPSG:32750", "datum_policy": "backend",
     "event_id": "project-utm50s", "evidence": "Survey is WGS84 in UTM zone 50S"},
)
# Check projected["state"] == "ok" before using projected["observations"].
```

The API appends an explicit reprojection event, preserving earlier correction
entries, bindings and per-channel states. Historical levelling is validated in
its original horizontal context. Exchanged JSON remains inspectable in either
runtime; exact coordinate hashes depend on the producing backend. Earlier
readers without reprojection-event support reject this ledger extension.

Both missing XY coordinates survive; partial pairs, failed transforms and points
outside the source or target UTM six-degree zone, hemisphere or latitude range
(0–84° N / 80–0° S) reject the entire operation. Boundary tolerance is 1e-8°;
Norway/Svalbard zone exceptions are not inferred. At least one complete XY pair
is required. Existing limits apply: 100,000 records, 64 ledger events and 16 MiB
output JSON including lineage.

Measurements, heights, times, order, IDs and extras remain unchanged. Measured
headings retain their acquisition reference, including the original grid north;
they are not rotated to the target grid. There is no datum shift, geoid/height
conversion or uncertainty propagation. Source metadata is archived through flat
lineage; root uncertainty fields are archived and marked unpropagated. Use
projected results with crossover/gridding APIs after checking their own contracts.
The projection backend contract follows [pyproj](https://pyproj4.github.io/pyproj/stable/api/transformer.html)
and [PROJ UTM](https://proj.org/en/stable/operations/projections/utm.html).

### Declarative observation-to-grid workflows

`describe_observation_workflow()` returns the saved-workflow JSON Schema,
registered operation/parameter contracts, typed output ports, backend support and
resource limits. `validate_observation_workflow(workflow, inputs)` performs
**structural preflight**: document/history validation, versions, parameter keys
and required fields, references, backend availability and known resource sizes.
It runs no numerical kernels. An `ok` preflight does not establish that later
scientific contexts or parameter values are valid; each native stage checks them
when executed.

```python
workflow = baselode.geophysics.magnetic_observation_recipe()
# Synthetic example: replace line roles, calibration/quality thresholds,
# gridding geometry/radius and processing choices for your survey.
result = baselode.geophysics.run_observation_workflow(workflow, {"survey": survey})
if result["state"] == "ok":
    corrected = result["artifacts"]["corrected"]
    edges = result["artifacts"]["edges"]
    baselode.geophysics.save_raster(edges, "edges.tif", dtype="float64")
```

The example executes QC, fixed-reference DC levelling, nearest gridding and total
horizontal derivative. It requires a `magnetic_anomaly` mag channel in nT and known unapplied
magnetic_levelling; raw total-field inputs need explicit reference-field removal
before the derived stage. It expects R1/R2 reference lines, A😀/B targets and synthetic
0–10 m bounds; these are example choices, not supplied survey calibration.
Persist the workflow as ordinary JSON alongside original observation inputs.
Results contain native full-resolution objects, so export raster artifacts with
`save_raster`; do not treat the whole result as a JSON raster transport format.

A workflow has `schema="baselode.geophysics.observation_workflow"`, `version=1`,
ordered `steps` and named `outputs`. Every step has `id`, `operation`, `version=1`,
`inputs` and `parameters`. Input references are exactly `{"input": "survey"}`;
step references are `{"step": "level", "output": "observations"}`. References
must resolve to earlier typed ports. Input and step IDs are distinct. Operations
include QC, correction inspection/declarations, magnetic base/lag/heading/IGRF,
reprojection, crossover analysis/levelling, gridding and the existing raster
operations under `raster_` names. The descriptor lists each operation's ports:
corrections expose `observations`/`report`; gridding exposes `grid`, `support`,
`neighbor_count`, `nearest_distance`, `extrapolation` and `report`; raster stages
expose `raster`/`report`. QC, inspection and crossover analysis expose `report`.

QC requires `parameters={"qc": {...}, "max_flags": 0}` (choose the threshold
explicitly). More flags stop the workflow for review; truncated QC rejects.
Execution follows all supplied stages in order, including report-only gates.
The first non-`ok` stage stops execution and withholds **all** final artifacts,
including requested raw inputs. `completed_steps`, bounded `step_reports`,
`input_bindings`, the copied workflow/plan and resource estimates remain for audit.
They are not an automatic resume mechanism. A backend exception returns `failed`.

No corrections, clocks, datums, line roles, calibration, order or uncertainty are
inferred. Native correction ledgers, assumptions and source lineage remain intact;
workflow-step metadata is added. A valid workflow can still embody an unsuitable
physical sequence. IGRF execution requires `baselode[magnetics]`; known missing
backends stop preflight before any earlier stage executes.

Limits: 8 observation inputs, 16 stages, 32 named outputs, 1 MiB workflow JSON,
32 MiB aggregate input JSON, 250,000 retained observation records / 1,000,000
readings across versions, 4,000,000 retained raster values across **all** ports,
and 8 MiB step-report JSON. Native kernel/provenance/FFT limits also apply.
Estimates include unused intermediate ports; runtime checks actual retained sizes.
These are work/output budgets, not a timeout facility or process sandbox.
The existing raster workflow v1 API is unchanged.

### Normal gravity and gravity disturbances

Install `baselode[gravity]` for the pinned Boule 0.6.0 backend.
`describe_normal_gravity()` returns shared schemas, constants and conventions.
`calculate_normal_gravity({"model": "WGS84", "points": [...]})` accepts up to
512 `{id, longitude, latitude, height_m}` points: geodetic degrees and ellipsoidal metres, heights 0–100,000 m by
default, poles included. Explicit `height_policy="analytic_continuation"` also
allows −1,000–0 m for below-ellipsoid stations; results flag each continued point
with `height_extrapolated`. This mathematically continues the external potential
and does not specify an interior-Earth density model.
Models are WGS84 and GRS80. Results contain full normal-gravity magnitude in mGal,
ellipsoidal u/beta components, and the forward-1-m height sensitivity in mGal/m.
Boule supplies the u-component and coordinate conversion; the adapter adds the
analytic beta derivative of the normal potential before taking the orthogonal
norm. This matters above the surface. Independent 80-digit potential-gradient
benchmarks and published surface values test both models. Sensitivity is not
propagated uncertainty; no constant free-air or geoid conversion is applied.

```python
result = baselode.geophysics.remove_normal_gravity(observations, {
    "channel": "g", "model": "WGS84", "reference_policy": "caller_verified",
    "event_id": "normal-1", "evidence": "Calibrated absolute data; datums checked",
})
```

Removal requires positive calibrated absolute `gravity_observed` in `mGal`,
known unapplied `gravity_normal`, `gravity_free_air`, `gravity_bouguer` and
`gravity_terrain` history. WGS84 requires EPSG:4326 and `WGS84_ellipsoid` height
datum; GRS80 requires EPSG:4283/7844 and `GRS80_ellipsoid`. Declare degree/degrees,
`height_units="m"`, `z_positive="up"`, a non-unknown `gravity_datum`, and
`tide_system` (`tide_free`, `zero_tide`, `mean_tide`). `caller_verified` records
that reference comparability was checked; no absolute-datum/permanent-tide
transformation is inferred. Drift/tide correction states remain visible.

Success subtracts normal gravity at the observation's actual height and labels
the selected channel `gravity_disturbance`, distinct from a reduced anomaly.
All nonnull selected readings must succeed atomically; nulls, other channels,
geometry/time/order/extras remain. Fixed model/context/data bindings reject stale
or repeated applications, including after supported horizontal reprojection.
Source uncertainty is archived in flat lineage, not propagated. The field works
with gridding, generic potential-field products and equivalent sources.
The `remove_normal_gravity` observation-workflow operation exposes the same
contract; missing optional backends block preflight before any earlier stage.
[Boule conventions](https://www.fatiando.org/boule/latest/api/generated/boule.Ellipsoid.html)
and [gravity disturbances](https://www.fatiando.org/boule/latest/user_guide/gravity_disturbance.html)
provide the reference context.

### Gravity tides, drift and repeat-station QC

`describe_gravity_temporal()` exposes native parameter/model schemas, bounds and
assumptions. Readings must already be scale-calibrated in mGal. Use
`gravity_relative` for calibrated instrument readings with an arbitrary zero
(including negative/zero values), and `gravity_observed` for positive absolute
gravity. No raw dial scale or reference value is invented. Declare one
`instrument_id`, `gravity_scale_calibration_id`, height datum/metres/up and
permanent `tide_system` per document. A selected gravity datum comes from
`metadata.gravity_channel_datums[channel]`, falling back to `metadata.gravity_datum`;
normal-gravity removal and history replay use the same selection rule.

`apply_gravity_tide(observations, options)` subtracts explicitly supplied
`effects=[{"record_id": ..., "effect_mGal": ...}]`, with exactly one entry per
nonnull selected reading. Supply channel, model_id, max_abs_effect_mGal,
`effect_convention="observed_minus_reference"`, `clock_policy="synchronized"`,
`reference_policy="caller_verified"`, event_id and evidence. Every affected record
needs finite XY/Z and UTC time; the caller verifies the supplied effects at those
positions/heights/times. Tide/normal/free-air/Bouguer/terrain history must be known
unapplied. No astronomical, loading or permanent-tide transformation is calculated;
the declared permanent tide system remains unchanged.

`correct_gravity_drift(observations, options)` requires known applied tide history
and known unapplied drift/reference/height reductions. Supply:

- `controls=[{"record_id": ..., "reference_mGal": ...}]`: 2–128 nonnull control
  records with positive absolute references and station IDs; controls are sorted
  by UTC time while observations retain their order.
- channel, model_id, target_gravity_datum, max_gap_seconds,
  max_abs_correction_mGal, max_drift_rate_mGal_per_s,
  synchronized/caller_verified policies, event_id and evidence.

The fit uses `bias = calibrated_reading - reference` at each control and linear
interpolation between controls. Subtract bias from every nonnull reading. Exact
knots are supported; interior predictions need a sufficiently short bracket;
extrapolation is rejected. The correction cap includes any relative-to-absolute
datum offset. Each adjacent control slope must satisfy the drift-rate cap.
Every reading and quality gate must pass before one atomic output/event.
Successful selected readings become positive `gravity_observed` in the explicit
target datum; only that channel's datum override changes. Other channels retain
their original data and datums.

Reports retain original/proposed readings, bound tie models, consecutive-control
loop/delta diagnostics and before/after repeat statistics. Fitted tie residuals
are zero by construction; validate using independent non-control repeats.
This is fixed-reference piecewise-linear loop adjustment, not a global network
least-squares solve, tare detection or automatic reference selection.
`analyze_gravity_repeats(observations, {"channel": "g"})` reuses native station
statistics with same-location/height and `geometry_comparable` flags. These are
raw QC statistics, not inferred instrument drift or propagated uncertainty.

Both correction operations preserve nulls/IDs/order/geometry/extras/other channels,
archive source uncertainty in standard lineage, and reject stale/repeated/unknown
history. Offset-datum-invariant tide bindings survive absolute base tying;
drift bindings protect original/target datums and tie/calibration context. Native
observation workflows register all three operations. Limits: 4,096 records/effects,
128 controls, 256 KiB options, plus existing event/output/workflow budgets.
[GA gravity practice](https://www.ga.gov.au/image_cache/GA2236.pdf) and
[USGS field processing](https://pubs.usgs.gov/tm/02/d04/tm2d4.pdf) describe the
underlying loop-drift assumptions and independent repeat checks.


### Gravity land plate and finite-zone terrain

`baselode.geophysics.describe_gravity_topography()` exposes the schemas,
fixed model identities and resource limits. `calculate_bouguer_plate` accepts
`{density_kg_m3, thicknesses_m}` and returns positive plate attractions in
mGal and exact linear density derivatives. No default reduction density is
inferred.

```python
import baselode.geophysics

plate = baselode.geophysics.calculate_bouguer_plate({
    "density_kg_m3": 2670, "thicknesses_m": [0, 100],
})
options = {
    "channel": "g", "density_kg_m3": 2670, "reference_height_m": 0,
    "height_datum": "WGS84_ellipsoid", "reference_policy": "caller_verified",
    "max_abs_correction_mGal": 100, "event_id": "plate", "evidence": "checked",
}
reduced = baselode.geophysics.apply_bouguer_plate(survey, options)
```

`apply_bouguer_plate` subtracts `2*pi*G*density*(z-reference_height_m)` from
`gravity_disturbance` in mGal. It requires applied normal/drift/tide and
unapplied free-air/Bouguer/terrain histories, explicit height datum/m/up,
selected gravity datum and tide system. All nonnull readings require land
heights 0..10000 m above reference; density is in (0,10000] kg/m3. Output
retains gravity disturbance semantics, all geometry, other channels/datums and
nulls. It appends a bound native event and archives source uncertainty.

`correct_gravity_terrain(reduced["observations"], terrain_options)` adds a
finite-zone signed-prism correction using the pinned optional Harmonica 0.7.0
backend (`pip install 'baselode[potential-fields]'`). It requires the native
plate event with identical density, reference height and height datum.
`terrain_options` contains the plate options with a new event ID and:

- `dem`: `id`, `crs`, `crs_units="m"`, `frame_id` (null for projected CRS),
  `height_datum`, `bounds=[west,south,east,north]` and a rectangular north-up
  `heights` matrix of finite cell heights in metres. No NoData cells.
- `outside_dem_policy="flat_at_station_height"`, explicit
  `min_edge_distance_m` in (0,50000], and `ground_tolerance_m` in [0,1].

The DEM and survey must share a projected/local metre frame and height datum.
Nonnull ground station heights must match the containing DEM cell within the
supplied tolerance. At most 512 observations, 1024 cells and 100 km per DEM
axis are accepted. Each cell becomes a signed prism between its height and
the station level; the negative downward attraction is added to the
plate-reduced disturbance. Per-record proposals report the correction,
density derivative and distance to the DEM boundary.

This model explicitly assumes flat station-level terrain outside the DEM.
It is a finite-zone approximation, with no airborne/marine, curvature, far-zone
or geoid conversion. Density sensitivity describes the supplied linear model;
it does not estimate density or propagate uncertainty. Saved observation
workflows register both operations. Native input/output bindings cover XY and
readings; supplementary model/context/height bindings replay through explicit
horizontal reprojection without reconstructing historical XY from rounded
inverse transforms.


### Corrected radiometric concentrations and products

`describe_radiometrics()` exposes schemas for corrected source/stack metadata,
parameter contracts, band roles/units, mask conventions and resource limits.
Use already corrected and calibrated concentrations: K in percent, eU and eTh
in ppm. The equivalent labels do not assert radioactive equilibrium or direct
chemical concentrations. Raw spectra/counts require external processing.

```python
import baselode.geophysics

# Each one-band source declares metadata.field_type="radiometric", units and
# metadata.radiometric={element:"K"/"eU"/"eTh", state:"corrected_concentration",
# calibration_id, reference_height_m, height_datum}.
stack = baselode.geophysics.stack_radiometric_grids(
    potassium, uranium, thorium,
    reference_policy="caller_verified", evidence="source processing checked",
)
ratios = baselode.geophysics.radiometric_ratios(
    stack, potassium_floor=0.1, thorium_floor=0.5,
    reference_policy="caller_verified", evidence="source processing checked",
)
rgb = baselode.geophysics.radiometric_ternary(
    stack, k_min=0, k_max=4, u_min=0, u_max=8, th_min=0, th_max=16,
    gamma=1, reference_policy="caller_verified", evidence="source processing checked",
)
```

The example thresholds/stretches are explicit demonstration choices, not
survey-independent recommendations. Stacking requires exactly matching shape,
affine, CRS, coordinate units/local frame, reference height and height datum.
It never aligns or resamples implicitly. Each source's calibration and metadata
are retained in flat input lineage. A canonical stack has bands `K,eU,eTh`,
units `%,ppm,ppm`, field type `radiometric`, and
`metadata.radiometric={state:"corrected_concentration", calibration_ids:[K,eU,eTh],
reference_height_m, height_datum}`. A local grid needs `frame_id`; all grids
need explicit `crs_units` and finite invertible affine coordinates.

Ratio bands are `eTh_K,eU_K,eU_eTh`, with units `ppm/%,ppm/%,1`. These are
concentration ratios using the stated units; percent-to-ppm conversion is not
silently applied. A denominator equal to its positive floor is accepted.
Missing/negative dependencies, denominators below the floor and nonfinite
results are masked independently for each ratio, without pseudocounts or
negative clipping. A missing K does not remove valid eU/eTh. Diagnostics report
per-band support, unsupported and overflow counts.

Ternary output is a georeferenced three-band normalized RGB raster: K red,
eTh green, eU blue. Each component uses
`clamp((value-low)/(high-low),0,1)**(1/gamma)` with explicit nonnegative low/high
stretches and gamma in [0.1,10]. A missing/negative component masks all RGB
bands. Valid zeros remain valid black when stretches begin at zero. Clipping
counts remain visible; there is no per-tile histogram refit or compositional
closure. Output units are `fraction`; this is a display product.

Products use `field_type="other"` and archive quantitative input calibration,
processing and uncertainty in `input_lineage`; `uncertainty_propagated=False`.
Corrected/merged grids do not justify a raw-count Poisson or covariance-free
uncertainty estimate. No input mutation. At most 1,000,000 total input cell
values and bounded parameters/provenance are accepted. Invalid context or
parameters, or no supported cells, raise `ValueError`.

Saved raster workflows register `radiometric_ratios` and `radiometric_ternary`
with the same snake_case parameters. Preflight checks calibration/context and
pointwise support before retaining products; absent support returns
`needs_input`. Inputs used only by pointwise radiometric branches accept geographic and
general finite invertible affine grids and use no FFT budget. Unrelated
spatial-filter branches do not constrain them. Inputs with any spatial-filter
descendant retain projected/local rectangular-grid requirements. Derived products retain full resolution and export through the
existing ERS/GeoTIFF writers with source lineage and units.


Radiometric product steps consume named verified workflow input stacks. They
reject references to earlier transform outputs, whose actual values/derived
units cannot be checked from a cached structural context. Run an upstream
filter/combine recipe separately, inspect its output calibration/units/support,
then supply a compatible verified stack as an input to the product recipe.

Optional raster `metadata.frame_id` must be null or a known bounded string,
even with a projected CRS. Evidence length/type schema violations are rejected;
missing required evidence remains `needs_input` during recipe preflight.

Radiometric products require declared affine geometry. JavaScript rasters keep
`hasExplicitTransform=false` when the constructor supplies its default pixel
transform; clones and decimation preserve that marker, and radiometric kernels
reject it. Existing pixel/display raster defaults remain available. Catalogue
`outputs.units` remains a string; optional `outputs.band_units` gives exact
per-band units for radiometric operations.

When attaching verified geometry to a JavaScript raster copied from an
undeclared source, supply both fields explicitly:
`createGeophysicsRaster({...raster, transform: verifiedTransform, hasExplicitTransform: true})`.
The same options apply to `geophysicsRasterFromBands`. A carried `false` remains
authoritative even when transform numbers change: numerical editing cannot
verify geometry. Python `GeophysicsRaster.from_payload` maps `false` to
`transform=None`, so transfer preserves this distinction. To declare verified
geometry in a portable payload, supply its transform and set the marker to true.

### Controlled magnetic grid microlevelling

`describe_microlevelling()` publishes the shared model, complete parameter
schema, current-grid state requirements and limits. The core-only NumPy
implementation estimates residual directional striping on a one-band
`magnetic_anomaly` grid in `nT`. Verify its prior line levelling, anomaly
reference and geometry, then explicitly declare
`metadata.grid_corrections={"magnetic_levelling":"applied",
"magnetic_microlevelling":"unapplied"}`. Archived observation states remain
source history and are not promoted automatically.

```python
options = {
    "flight_azimuth": 0, "line_spacing": 40,
    "along_line_wavelength": 640, "across_line_wavelength": 160,
    "max_abs_correction": 5, "protected_bounds": [],
    "edge_margin_cells": 8, "min_training_fraction": 0.75,
    "reference_policy": "caller_verified",
    "evidence": "Verified levelled anomaly, sampling and projected grid geometry",
    "geology_policy": "directional_overlap_acknowledged",
}
candidate = baselode.geophysics.estimate_magnetic_microlevelling(grid, options)
qc = candidate.metadata["microlevelling"]["diagnostics"]
# Inspect the candidate, protection and geological retention before application.
corrected = baselode.geophysics.microlevel_magnetic_grid(grid, options)
```

Both functions take the original verified grid and the same explicit options.
Estimation returns an `other/nT` candidate subtraction grid with
`application_supported=False` when its peak exceeds the cap. Application
recomputes and rejects an exceeded cap atomically; it never clips. Applied
products declare current microlevelling state and reject repetition. Source
history and uncertainty are archived in `input_lineage`; uncertainty is not
propagated.

Azimuth is clockwise from **CRS north**; the caller resolves true/grid
convergence. All wavelengths, measured line spacing and protection boxes use
CRS linear units. Rectangular rotated grids are supported; geographic/sheared
or undeclared geometry is rejected. Require cell sizes <= half line spacing,
across cutoff >= twice spacing, along cutoff >= twice across cutoff, an along
extent >= the along cutoff and an across extent >= four spacings. These are
support gates, not proof of survey sampling quality.

For spatial frequencies in cycles per CRS unit, the response is
`exp(-ln(2)*(f_along*along_cutoff)^2) * -expm1(-ln(2)*(f_across*across_cutoff)^2)`.
It removes a plane using valid unprotected training cells, fills gaps/protected
areas with that plane internally and uses the existing symmetric mirror-padded
FFT. Oblique Nyquist bins follow the real inverse FFT's conjugate-pair average.
The candidate is zero within the explicit edge margin and protected boxes
(inclusive cell centres); original missing cells stay missing. Protection boxes
must have positive area and include a valid cell. The hard unchanged boundary
can introduce a transition; inspect boundaries and gap artefacts.

Limits: 16x16 minimum, 262144 source cells, 4194304 padded FFT cells, 16 boxes,
64 training cells and explicit minimum training fraction in [0.25,1] of **all**
cells. At least one unprotected interior application cell is required. Metadata,
options and provenance budgets also apply. Corrections below
`64*double_epsilon*max(1,max_abs_training_value)` are zeroed. Diagnostics report
training/protected/application support, FFT shape, peak/RMS, numerical tolerance
and cap eligibility.

Real line-parallel geology can share the noise spectrum. The required
acknowledgement, protections and cap do not make those components identifiable;
RMS reduction alone does not establish geological recovery. This original
Gaussian grid filter follows directional separation principles discussed by
[Minty (1991)](https://doi.org/10.1071/EG991591) and the
[GA Lissadell report](https://www.ga.gov.au/pdf/GA1410.pdf). It does not claim a
vendor-equivalent algorithm or located-flight-line correction.

Saved raster workflows register `estimate_magnetic_microlevelling` and
`microlevel_magnetic_grid` at version 1, with the same option object. Each must
consume a named verified input grid, so an estimate and application can branch
independently from the original. Run prior transforms separately and verify
their output state/support first. Preflight checks parameters, geometry,
training and FFT budgets without executing FFTs. A numerical application cap
failure returns workflow state `failed` with no output artifacts.

### Spatial power spectra

`describe_spectrum()` exposes the shared parameter schema, normalization,
resource limits and assumptions. `analyze_grid_spectrum(grid, options)` returns
a versioned JSON report with `ok`, `needs_input`, `rejected` or `failed` state.
It preserves the raster and its source uncertainty/history.

```python
report = baselode.geophysics.analyze_grid_spectrum(grid, {
    "band": 1, "detrend": "mean", "window": "hann_periodic",
    "radial_bins": 32, "direction_bins": 12, "missing_policy": "reject",
})
if report["state"] == "ok":
    radial = report["radial"]
    directional = report["directional"]
    conservation = report["diagnostics"]["parseval_absolute_error"]
```

The selected band must be complete and have declared units and field type.
Projected/local rectangular affine geometry and explicit linear coordinate
units are required; rotated grids are supported. Missing cells produce
`needs_input`: crop/select a complete region explicitly. Other bands may be
missing. Mean or plane removal precedes the explicit boxcar or periodic Hann
window. The existing FFT computes a two-sided DFT, zero-padded at the array
origin to powers of two without mirror extension.

For padded cell count `M` and window energy `U=sum(window**2)`, integrated
frequency-bin power is `abs(DFT(residual*window))**2/(M*U)`. Its sum equals
`sum(residual**2*window**2)/U` by Parseval. Density divides bin power by
`1/(M*abs(affine determinant))`, the two-dimensional map-frequency cell area.
Source values in nT and coordinates in metres yield power in nT² and density
in nT²·m². This spatial normalization follows the DFT conventions in
[NumPy](https://numpy.org/doc/stable/reference/routines.fft.html) and
window-energy density scaling described by
[SciPy](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.periodogram.html).
It is not an amplitude-normalized spectrum.

Radial bins cover non-DC frequencies inside the conservative inscribed Nyquist
circle, `min(1/(2*column_spacing),1/(2*row_spacing))`. Each reports frequency
and wavelength intervals, frequency-sample count, integrated `power_sum` and
`mean_power_density`; an empty bin has null mean density. Radial mean density
is not a one-dimensional annular PSD. DC and excluded corner power/count are
reported separately; included + outside + DC power accounts for the total.
Opposing frequencies are included once each, without additional doubling.

Directional bins are **axial wavevector azimuths**, [0,180), clockwise from CRS
north. This is the direction of spatial variation, generally orthogonal to an
ideal stripe's elongation. It is not an inferred flight direction or geological
strike. Scaled bin indices within 1e-10 of an integer snap to that boundary;
the last radial edge is included, and direction 180 wraps to 0.

Zero padding interpolates frequency samples; it adds no independent physical
resolution. Counts are not independent degrees of freedom. Windowing, region
selection and detrending alter the result. The numerical amplitude floor is a
diagnostic estimate; weak energy is retained. Spectra alone cannot label noise,
recover source depth, quantify geological uncertainty or choose filter cutoffs.
Compare explicit processing choices and independent geological evidence.

Limits: 8x8 minimum, 262144 selected cells, 1000000 total source values, 1048576
FFT cells, 512 KiB source metadata and 2 MiB report. Band is 1-based (1..64),
radial bins 4..128 and direction bins 4..36. Invalid/failed reports contain no
scientific arrays. Native Python/JavaScript share the contract and algorithm.

The typed observation workflow registers `analyze_grid_spectrum` with a raster
input and report output, usable after `grid_observations` or a raster filter.
Structural preflight defers actual support checks until that stage; a failed
spectrum withholds all requested workflow artifacts. The raster-only catalogue
continues to describe raster-producing operations. A complete saved example is
provided in `test/data/spectrum_example.json`.
