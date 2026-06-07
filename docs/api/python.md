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

### replace_below_detection_limit

```python
replace_below_detection_limit(df, columns=None, sentinel_factor=0.5)
```

Replace `<MDL` strings (e.g. `"<0.005"`) with `MDL * sentinel_factor`.  Defaults to half-MDL, the industry-standard convention for QAQC statistics.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `df` | `pandas.DataFrame` | — | Source table |
| `columns` | iterable of str | `None` | Columns to scan; defaults to every string-dtype column |
| `sentinel_factor` | float | `0.5` | Multiplier applied to the detection limit |

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
                   color="#8b1e3f", intervals=True)
```

Plot a single numeric assay column as a Plotly figure.

**`chart_type` options:** `"bar"`, `"markers"`, `"markers+line"`, `"line"`

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
