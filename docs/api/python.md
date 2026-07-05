# Python API Reference

Complete reference for the `baselode` Python package (v0.1.x).

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

### desurvey_holes

```python
desurvey_holes(collars, surveys, step=1.0, method="minimum_curvature")
```

Desurvey all holes in `collars` using the matching rows in `surveys`.

**Parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `collars` | GeoDataFrame | — | Collar table |
| `surveys` | DataFrame | — | Survey table |
| `step` | float | `1.0` | Output vertex spacing (metres) |
| `method` | str | `"minimum_curvature"` | `"minimum_curvature"`, `"tangential"`, or `"balanced_tangential"` |

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

Run desurvey via the registered method (one of `"minimum_curvature"`, `"tangential"`, `"balanced_tangential"`).  Cached unless `force=True` or args change.

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
| `single_station_surveys` | warning | A hole has only one survey row — desurvey will fail.  Fix recipe points at `fix_single_station_surveys` |
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
                            hole_col=HOLE_ID, depth_col=DEPTH, max_depth_col=MAX_DEPTH)
```

For any hole with exactly one survey row, append a synthetic second station with the same azimuth/dip at `collar.max_depth` (when available) or `depth + 1.0` otherwise.  Equivalent to PyGSLIB's `fix_survey_one_interval_err`.

**Returns:** `pandas.DataFrame` — original survey rows plus synthetics, sorted by `hole_id`, `depth`, with the index reset.

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
             return_diagnostics=False)
```

Auto-resolve safe interval overlaps and surface only genuine value-conflicts for human review.  Handles three classes:

| Class | Pattern | Action |
|---|---|---|
| **Touching** | `A.to > B.from` by less than `touching_tol` metres | Snap `A.to = B.from` (float-rounding cleanup) |
| **Duplicate** | Identical `(hole_id, from, to)` *and* identical `value_cols` | Drop all but the first |
| **Resampled superset** | A longer interval fully contains shorter ones whose length-weighted mean ≈ the longer's value within `merge_tol`, with coverage ≥ `coverage_min` | Drop the longer, keep the higher-resolution rows |
| **Conflict** | Anything else — partial overlap, same depth-zone with materially different values | Leave untouched, return in the `conflicts` frame |

| Parameter | Type | Default | Description |
|---|---|---|---|
| `table` | `pandas.DataFrame` | — | Interval table |
| `value_cols` | iterable of str | `None` | Columns to compare for duplicate / superset detection; defaults to every column other than `hole_col`/`from_col`/`to_col` |
| `touching_tol` | float | `0.01` | Max overlap (m) treated as a snap-me glitch |
| `merge_tol` | float | `0.05` | Max relative diff between superset value and inner mean |
| `coverage_min` | float | `0.95` | Min coverage of a superset by inner rows before it qualifies |
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

`log_scale=True` switches the value axis to a log scale for the `bar`, `markers`, `markers+line`, `line`, `filled-line`, and `step-line` chart types (silently ignored elsewhere). Also accepted by `plot_drillhole_trace`.

### plot_two_curve_fill

```python
plot_two_curve_fill(df, value_col_a, value_col_b, from_cols=None, to_cols=None,
                    color_a=None, color_b=None, log_scale=False, template=None)
```

Two numeric curves with the region between them shaded by dominance, split at every crossing (classic neutron–density display).  Where A > B the fill uses A's colour at alpha 0.4; where B > A it uses B's.  Curve colours default to the commodity colour for each column name, falling back to `MULTI_SERIES_COLORWAY[0]` / `[1]`.

**Returns:** `plotly.graph_objects.Figure`

### plot_composition_log

```python
plot_composition_log(df, value_cols, from_col=FROM, to_col=TO,
                     colour_map=None, normalize=True, template=None)
```

Percent-composition track: divided horizontal stacked bars per interval, one trace per component (*value_cols* order = legend + stack order).  With `normalize=True` (default) each interval's components are scaled to fractions of their sum and the axis is fixed to [0, 1] with percent ticks; with `normalize=False` raw values are stacked and the axis autoranges.  All-null/zero intervals are skipped; negative values are clamped to 0 for the bar (raw value in hover).

**Returns:** `plotly.graph_objects.Figure`

### plot_depth_annotations

```python
plot_depth_annotations(df, depth_col=DEPTH, text_col=COMMENTS,
                       marker_color=None, template=None)
```

Depth-pinned text annotations: a tick at the track's left edge with the note text alongside.  Long notes are word-truncated to ~40 characters for display; the full text stays in hover.  Composes with the other strip-log tracks (reversed depth axis, hidden [0, 1] x-axis).

**Returns:** `plotly.graph_objects.Figure`

### plot_dip_azimuth_log

```python
plot_dip_azimuth_log(df, depth_col=DEPTH, dip_col=DIP, azimuth_col=AZIMUTH,
                     color_by=None, template=None)
```

Split dip-magnitude / dip-azimuth tracks sharing one reversed depth axis: dip markers on a fixed [0, 90] axis, azimuth markers on a fixed [0, 360] axis with ticks every 90°.  `color_by` (e.g. defect type) renders one trace per category with a legend shared across both tracks.

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
