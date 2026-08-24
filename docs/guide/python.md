# Python Guide

The `baselode` Python package provides domain-aware data loaders, desurveying algorithms, and Plotly-based visualisation helpers for drillhole and spatial datasets.

**Requires:** Python 3.12+

```bash
pip install baselode
```

---

## Data Model

All loaders normalise source data to the **Baselode Open Data Model** — a consistent set of column names that every downstream function can rely on.

### Core field names

| Field | Constant | Description |
|---|---|---|
| `hole_id` | `HOLE_ID` | Unique drillhole identifier |
| `latitude` | `LATITUDE` | Collar latitude (WGS 84, decimal degrees) |
| `longitude` | `LONGITUDE` | Collar longitude (WGS 84, decimal degrees) |
| `elevation` | `ELEVATION` | Collar elevation (metres ASL) |
| `easting` | `EASTING` | Projected easting (metres) |
| `northing` | `NORTHING` | Projected northing (metres) |
| `crs` | `CRS` | Coordinate reference system (EPSG code or proj string) |
| `depth` | `DEPTH` | Measured depth along the hole |
| `azimuth` | `AZIMUTH` | Azimuth (degrees from north) |
| `dip` | `DIP` | Dip (degrees; negative = downward) |
| `from` | `FROM` | Start depth of an interval |
| `to` | `TO` | End depth of an interval |
| `mid` | `MID` | Mid-depth of an interval |
| `alpha` | `ALPHA` | Alpha angle for structural measurements |
| `beta` | `BETA` | Beta angle for structural measurements |
| `extra` | `EXTRA` | Per-row dict of source-specific fields outside the canonical schema |

Constants are importable from `baselode.datamodel`:

```python
from baselode.datamodel import HOLE_ID, LATITUDE, LONGITUDE, ELEVATION, DEPTH, EXTRA
```

### The `extra` column

Every baselode-model DataFrame is extensible via a single `extra` column whose value is a Python `dict` per row. It holds anything the source provided that doesn't map to the canonical schema (e.g. GSWA's `max_depth`, `hole_type`, `anumber`; or per-analyte assay values; or company-specific metadata).

This keeps the top-level columns predictable for plotting / desurveying / intercept work while preserving everything the upstream system gave you.

Use the `bundle_extras` helper to fold non-canonical columns into the dict for any wide DataFrame:

```python
import baselode.drill.data

slim = baselode.drill.data.bundle_extras(
    wide_df,
    baselode.drill.data.BASELODE_DATA_MODEL_DRILL_COLLAR.keys(),
    reserved={"geometry"},   # preserve GeoDataFrame geometry alongside canonical columns
)
# slim has the canonical columns at top level + an 'extra' dict per row.
```

Reading a value back out:

```python
slim["max_depth"] = slim["extra"].apply(lambda d: d.get("max_depth"))
```

Notes:
- `None` and `NaN` values are skipped — the per-row dict only contains values that are actually present.
- Bundling is idempotent. If the input already has an `extra` column, new extras are merged with the existing dict (existing values win on conflict).

### Column mapping

Loaders apply a default column-mapping table to handle common naming variations (`HoleID`, `Hole_Id`, `holeid`, etc.).  You can override or extend this with a `source_column_map` dict:

```python
collars = drill.load_collars(
    "collars.csv",
    source_column_map={"Company_Hole": "hole_id", "RL": "elevation"}
)
```

---

## Data Loading

All loaders live in `baselode.drill.data`.

```python
import baselode.drill.data as drill
```

### load_collars

Load drillhole collar data from a CSV, Parquet, SQL table, or an existing DataFrame.

```python
collars = drill.load_collars("collars.csv")
# Returns a geopandas.GeoDataFrame with geometry from lat/lon or easting/northing
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `source` | path / DataFrame | CSV path, Parquet path, or DataFrame |
| `crs` | str, optional | Override the coordinate reference system |
| `source_column_map` | dict, optional | Custom column name overrides |
| `keep_all` | bool | Keep all source columns (default `True`) |

### load_surveys

Load survey (directional) data.

```python
surveys = drill.load_surveys("surveys.csv")
# Returns a pandas.DataFrame sorted by hole_id, depth
```

**Required columns after mapping:** `hole_id`, `depth`, `azimuth`, `dip`

### load_assays

Load assay interval data.

```python
assays = drill.load_assays("assays.csv")
# Returns a pandas.DataFrame with a computed `mid` column
```

**Required columns after mapping:** `hole_id`, `from`, `to`

### load_structures

Load structural point measurement data (alpha/beta measurements).

```python
structures = drill.load_structures("structures.csv")
# Returns a pandas.DataFrame sorted by hole_id, depth
```

### load_geotechnical

Load geotechnical interval data (RQD, fracture count, weathering, etc.).

```python
geotechnical = drill.load_geotechnical("geotech.csv")
```

### load_unified_dataset

Load and merge assay and structural data into a single DataFrame.  This is the recommended entry point for the 2D strip-log view.

```python
combined = drill.load_unified_dataset("assays.csv", "structures.csv")
# Returns a combined DataFrame with a unified `depth` column and `_source` tag
```

### assemble_dataset

Combine pre-loaded DataFrames into a single dataset dictionary.

```python
dataset = drill.assemble_dataset(
    collars=collars,
    surveys=surveys,
    assays=assays,
    structures=structures,
    geotechnical=geotechnical
)
# Returns dict with keys: collars, surveys, assays, structures, geotechnical, metadata
```

### load_table

Low-level loader with full format support.

```python
df = drill.load_table("data.csv", kind="csv")                           # CSV
df = drill.load_table("data.parquet", kind="parquet")                   # Parquet
df = drill.load_table(None, kind="sql", connection=conn, query="SELECT …")  # SQL
```

---

## Desurveying

Desurveying converts depth-based survey tables into 3D spatial coordinates.  All methods are available in `baselode.drill.desurvey`.

```python
import baselode.drill.desurvey as desurvey
```

### Supported methods

| Method | Description |
|---|---|
| `minimum_curvature` | Industry-standard method — most accurate (default) |
| `tangential` | Simple first-order method |
| `balanced_tangential` | Average of start/end orientations per segment |

### desurvey_holes

```python
traces = desurvey.desurvey_holes(
    collars,
    surveys,
    step=1.0,                       # output step size in metres
    method="minimum_curvature"      # desurveying method
)
# Returns a pandas.DataFrame with columns: hole_id, md, easting, northing, elevation, azimuth, dip
```

`elevation` is true RL (height above the collar's reference datum, positive going up) — a vertical hole from a 0 m collar lands at –100 m at 100 m depth.  This matches OMF / Leapfrog / Surpac and any standard +Z-up 3D scene.  To recover TVD (positive going down), use `collar.elevation - trace.elevation`.

### Joining assay positions to traces

```python
from baselode.drill.data import join_assays_to_traces

joined = join_assays_to_traces(assays, traces)
# Merges 3D coordinates onto the assay DataFrame using hole_id
```

### Interpolating the trace at arbitrary depths

```python
import baselode.drill.desurvey as desurvey

# (hole_id, depth) → (easting, northing, elevation, azimuth, dip)
positions = desurvey.interpolate_trajectory(
    traces,
    {"DH001": [47.3, 52.1], "DH002": [10.0, 20.0]},
)
```

Linear interpolation per coordinate.  `depths` accepts a scalar (broadcast to every hole in traces), a list (also broadcast), a per-hole dict, or a DataFrame with `hole_id` + `depth` columns.  Out-of-range depths and unknown holes produce `NaN` rows.

---

## DrillholeSet — the composition root

`DrillholeSet` bundles the collar + survey table plus N named interval tables into one object, so you can call `db.validate()` / `db.desurvey()` / `db.composite(...)` / `db.to_omf(...)` instead of threading three separate DataFrames through every function.  No new algorithmic logic — every method delegates to the existing function-based API.

```python
from baselode.drill import DrillholeSet
import baselode.drill.data as drill

collar = drill.load_collars("collars.csv")
survey = drill.load_surveys("surveys.csv")
assays = drill.load_assays("assays.csv")
litho  = drill.load_geology("litho.csv")

db = (
    DrillholeSet(collar, survey, crs="EPSG:32750", project="goldfields-2026")
    .add_table("assay", assays)
    .add_table("geology", litho, kind="litho")
)

report  = db.validate()
traces  = db.desurvey(step=1.0)          # cached on the object
db.to_omf("project.omf",
          value_cols={"assay": ["au_ppm", "cu_pct"]})
```

The original function-based API stays — `validate.validate_drillhole_db(collar, survey, intervals)` and friends keep working unchanged.  `DrillholeSet` is a thin convenience layer on top.

### Why bother

- **Discoverability:** `db.<TAB>` shows the whole drilling API instead of having to know which module to import.
- **Metadata travels with the tables:** `crs`, `project`, datasource — no side-channel variables.
- **Derived state is cached:** `db.desurvey()` runs once, then `db.to_omf()` reuses the trace.
- **Familiar shape:** mirrors PyGSLIB's `Drillhole(collar, survey)` + `addtable(...)`.

---

## Database Validation

`validate_drillhole_db` runs every QA check in one pass and returns a structured report — never raises.  Each issue carries a check name, severity, the affected hole/table/row, a human-readable message, and (where possible) a fix recipe.

```python
import baselode.drill.validate as validate

report = validate.validate_drillhole_db(
    collar,
    survey,
    interval_tables={"assay": assays, "geology": litho},
)

# report["summary"]: {"error": N, "warning": M, "info": K}
errors = [issue for issue in report["issues"] if issue["severity"] == "error"]
```

### What it checks

| Check | Severity | Drives |
|---|---|---|
| `duplicate_hole_ids` | error | Collar table integrity |
| `single_station_surveys` | warning | Desurvey reliability — fix recipe is `fix_single_station_surveys` |
| `azimuth_range`, `dip_range` | error | Survey angle sanity |
| `orphan_intervals` | error | Interval `hole_id` must exist in collar |
| `negative_lengths` | error | `to <= from` |
| `intervals_beyond_max_depth` | warning | Interval `to` exceeds collar `max_depth` |
| `interval_gaps` | info | Consumes `intervals.detect_gaps` |
| `interval_overlaps` | warning | Consumes `intervals.detect_overlaps`; reports pairwise row indices |
| `below_detection_limit` | info | Detects `<NUMBER` sentinels in object columns |

### Fix helpers

```python
# Synthesize a second station for single-station holes so desurvey can run
survey_fixed = validate.fix_single_station_surveys(survey, collar)

# Wrap azimuths into [0, 360); converts 360 to 0, normalizes negatives
survey_wrapped = validate.normalize_azimuth(survey)

# Drop interval rows whose hole_id is not in collar
assays_matched = validate.drop_orphan_intervals(assays, collar)

# Swap from/to where they're inverted (fixes the common data-entry typo)
assays_swapped = validate.swap_inverted_intervals(assays)

# Auto-resolve safe interval overlaps (touching / duplicate / resampled
# superset) and surface only the genuine value-conflicts for review.
assays_clean, conflicts, report = validate.fix_overlaps(
    assays, return_diagnostics=True,
)

# Substitute below-detection sentinels with half-MDL — handles both
# `"<X"` strings AND numeric negatives (V < 0 → BDL at MDL = abs(V)).
# `strategy` ∈ {"half-mdl" (default), "mdl", "zero", "nan"}.
assays_bdl = validate.replace_below_detection_limit(
    assays, columns=["au_ppm", "cu_pct"], strategy="half-mdl",
)
```

All helpers are pure — they return new DataFrames and leave the source unchanged.

To treat `azimuth = 360` as valid without normalizing first, pass `allow_full_circle=True` to `validate_drillhole_db`:

```python
report = validate.validate_drillhole_db(collar, survey, allow_full_circle=True)
```

---

## OMF interop (Open Mining Format)

`baselode.drill.omf` round-trips drilling tables through Open Mining Format v1, the MIT-licensed mining interchange format read/written by Leapfrog, 3DEXPERIENCE, Deswik and Micromine.

Install the optional extra:

```bash
pip install baselode[omf]
```

```python
import baselode.drill.omf as omf_io
import baselode.drill.data as drill
import baselode.drill.desurvey as desurvey

collars = drill.load_collars("collars.csv")
surveys = drill.load_surveys("surveys.csv")
assays  = drill.load_assays("assays.csv")
traces  = desurvey.minimum_curvature_desurvey(collars, surveys, step=1.0)

collar_element = omf_io.collars_to_omf_points(collars, attribute_cols=["max_depth"])
trace_element  = omf_io.traces_to_omf_lines(traces)
assay_element  = omf_io.intervals_to_omf_lines(
    assays, traces, name="assay", value_cols=["au_ppm", "lithology"],
)

omf_io.write_omf(
    [collar_element, trace_element, assay_element],
    "project.omf",
    name="my-project", author="agent", description="example",
)
```

The output is a single `.omf` file that opens directly in any OMF-compatible viewer.  Read it back with `omf_io.read_omf(path)` (returns an `omf.Project`).

### Design notes

- Each call returns one OMF element, not a per-hole element — segments carry a `hole_id` attribute so downstream tools can still select per hole without a 4 000-element project.
- For interval lines, endpoints are interpolated from the trace at the interval's `from` / `to` depths.  Rows whose hole isn't in the trace are skipped silently.
- Collar positions need projected `easting`/`northing` columns — for collars carrying only lat/lon, project them to your local CRS first (e.g. via `baselode.extent.Extent.to_crs`) or derive collar positions from the first sample of each trace.
- JavaScript OMF support is deferred — consume read-side via Python until a JS need lands.

---

## Interval Algebra

`baselode.drill.intervals` provides pure from-to interval primitives that the higher-level compositing, validation, and DB-container modules build on.  Every function operates on a pandas `DataFrame` keyed by `hole_id`, `from`, `to` (the canonical columns from `baselode.datamodel`).

```python
import baselode.drill.intervals as intervals
```

### QC checks: gaps and overlaps

`detect_gaps` and `detect_overlaps` return structured rows you can join back to the source for review, rather than raising exceptions:

```python
gaps     = intervals.detect_gaps(assays, min_gap=0.5)
overlaps = intervals.detect_overlaps(assays)
# gaps:     hole_id | from | to | length
# overlaps: hole_id | from | to | length | first_index | second_index
```

`first_index` / `second_index` are *positional* indices into the input — safe to use with `.iloc` even when the DataFrame has a non-default pandas index.

### Splitting at boundaries

`split_at` introduces new boundaries at given depths (e.g. lithology contacts) and replaces each straddling row with sub-intervals that inherit all other columns:

```python
litho_contacts = {"DH001": [12.5, 47.0]}
assays_split = intervals.split_at(assays, litho_contacts)
```

`depths` also accepts a `DataFrame` with `hole_id` and `depth` columns, a single float, or a list applied to every hole.

### Clipping to a depth window

```python
top_200m = intervals.clip(assays, from_depth=0.0, to_depth=200.0)
```

Intervals entirely outside the window are dropped; straddling intervals are pulled to the boundary.  All other columns are preserved.

### Merging interval tables onto a common support

`merge_tables` left-joins multiple interval tables onto a common from-to support via boundary intersection.  The first table anchors the support; each output row carries one value per source, looked up at the sub-interval midpoint:

```python
merged = intervals.merge_tables({"assay": assays, "litho": geology})
# columns: hole_id, from, to, assay_<col>, ..., litho_<col>, ...
```

This is the more general form of `composite.merge_numeric_categorical`, which requires inputs to already share the same from/to support.

### Per-row helpers

```python
assays["length"]   = intervals.interval_length(assays)
assays["mid"]      = intervals.from_to_midpoints(assays)
```

---

## Compositing

Length-weighted compositing of downhole intervals.  `baselode.drill.composite` ships three modes:

| Mode | When to use |
|---|---|
| **Soft** (default) | Fixed-length bins extending across each hole.  Bins may cross geological contacts; values are length-weighted across whatever overlaps each bin.  Matches the dhcomp / Leapfrog default. |
| **Hard-boundary** | Bins reset at every change in a coded domain column (lithology, regolith, alteration).  No composite straddles a contact. |
| **True-thickness** | Bins are equal *true thickness* perpendicular to a reference plane, computed via interpolated midpoint orientation.  This is "economic compositing" — what you want for resource estimation across a known orebody plane. |

### Soft mode — the default

```python
from baselode.drill.composite import composite_intervals

composites = composite_intervals(assays, value_col="au_ppm", length=2.0)
# columns: hole_id, from, to, au_ppm
```

`method="sum"` returns total contribution (`value × overlap`) per bin instead of the length-weighted average.

### Hard-boundary by domain

Composite within each contiguous run of a coded boundary column — no composite spans a contact.

```python
composites = composite_intervals(
    assays_with_litho,
    value_col="au_ppm",
    length=2.0,
    mode="hard",
    boundary_col="lithology",
    residual="distribute",  # or "discard" / "add_to_previous"
)
# columns: hole_id, from, to, au_ppm, lithology
```

Three `residual` rules control what happens when a domain length isn't an exact multiple of `length`:

- `"discard"` (default) — drop the sub-length tail.
- `"add_to_previous"` — extend the previous composite to the domain end.
- `"distribute"` — choose `round(D / length)` equal-length bins covering the whole domain (slightly compressed or stretched bin length).

Non-abutting same-domain intervals are treated as separate runs — an unsampled gap breaks the run, matching how downhole-compositing tools handle interval breaks.

### True-thickness compositing

Composite in true-thickness space relative to a reference plane.  Needs a desurveyed trace because the midpoint orientation of each interval is what converts downhole length → true thickness.

```python
from baselode.drill.composite import composite_true_thickness
from baselode.drill.desurvey import minimum_curvature_desurvey

traces = minimum_curvature_desurvey(collars, surveys, step=1.0)

composites = composite_true_thickness(
    assays, traces,
    value_col="au_ppm",
    ref_dip=60.0,           # plane dipping 60° below horizontal
    ref_dip_azimuth=270.0,  # downdip points west
    length=1.0,             # 1 m of TRUE thickness per composite
)
# columns: hole_id, from, to, au_ppm, length_md, length_true
```

Each composite represents the same vertical (or near-vertical) slice across the orebody regardless of how steeply the hole was drilled through it.  A hole drilled parallel to the plane (`|T · N| ≈ 0`) produces no composites — no economic thickness is being captured.

True-thickness compositing is Python-only.

### How baselode compares to other OSS compositors

| Feature | dhcomp | PyGSLIB | baselode |
|---|---|---|---|
| Soft-boundary | ✓ | ✓ | ✓ (default) |
| Hard-boundary by coded domain | ✓ | ✗ | ✓ |
| Residual rules (`discard` / `add_to_previous` / `distribute`) | ✗ | `minlen` filter only | ✓ all three |
| True-thickness | ✗ | ✗ | ✓ |
| JS implementation | ✗ | ✗ | ✓ (soft + hard) |
| Pure-function pandas API | ~ | ✗ (needs `Drillhole` container object) | ✓ |

---

## Visualization

### Map

Plot collar locations on an interactive Folium or Plotly map.

```python
import baselode.map as bmap

# Create a Folium map
m = bmap.map_collars(collars, tooltip_cols=["hole_id", "elevation"])
m.save("collar_map.html")
```

### 2D Strip Logs

Plotly-based multi-track strip logs with depth increasing downward.

```python
import baselode.drill.view as view

fig = view.plot_striplog(
    assays,
    hole_id="MY_HOLE_001",
    columns=["au_ppm", "ag_ppm", "lithology"],
)
fig.show()
```

The strip-log renderer automatically classifies columns as:

- **Numeric** — line + marker plot with optional interval error bars
- **Categorical** — banded colour rectangles
- **Structural** — tadpole symbols for alpha/beta measurements
- **Comments** — free-text annotations at depth

Numeric and categorical tracks hover **horizontally along depth** (`hovermode="y unified"`): hovering shows a spike line at the depth and a single box listing each trace's value there.

### Numeric chart types

A numeric track is drawn with `plot_drillhole_trace(df, value_col, chart_type=...)`. Beyond `"markers"`, `"line"`, and `"markers+line"`:

```python
# Bar: each bar is sized to its own interval (thickness = to − from), so the
# sampled extent is shown by the bar itself — no error bars.
view.plot_drillhole_trace(df, "au_ppm", chart_type="bar")

# Graded line: markers coloured by value on the magma ASSAY_COLOR_PALETTE_10
# ramp, with a colour bar.
view.plot_drillhole_trace(df, "au_ppm", chart_type="colored-line")

# Filled line: the area between the curve and zero is shaded with the series
# colour at alpha 0.35 — quick visual weight for grade runs.
view.plot_drillhole_trace(df, "au_ppm", chart_type="filled-line")

# Stepped line: honours interval extents (blocked / composited assays) — the
# value is drawn flat from `from` to `to` with a vertical jump at boundaries.
view.plot_drillhole_trace(df, "au_ppm", chart_type="step-line")

# Heat strip: value → colour ramp filling the full track width (continuous
# grade display); hover reports the value and interval.
view.plot_drillhole_trace(df, "au_ppm", chart_type="heat-strip")
```

#### Log-scale value axis

Pass `log_scale=True` to switch the value axis to a log scale — useful for assays spanning orders of magnitude. It applies to the `bar`, `markers`, `markers+line`, `line`, `filled-line`, `step-line`, and `two-curve` chart types and is silently ignored elsewhere. Values ≤ 0 are dropped from the axis by Plotly but keep their raw value in hover.

```python
view.plot_drillhole_trace(df, "au_ppm", chart_type="line", log_scale=True)
```

#### Colour a numeric track by a categorical column

Pass `color_by` to colour a numeric line or bar track by a *separate* categorical column (e.g. lithology), joining each numeric interval to the categorical interval that contains its mid-depth. A per-category legend is added.

```python
view.plot_drillhole_trace(
    df, "au_ppm", chart_type="markers+line",
    color_by="lithology", colour_map="lithology",
)
```

#### Multiple assays in one track

Plot several numeric columns together — either overlaid stacked areas or horizontal stacked bars. Each assay is aligned onto a shared depth grid; below-detection (negative) values are floored at 0 while the hover still reports the true value.

```python
# Stacked filled areas (raw values), one band per assay.
view.plot_multi_assay(df, ["au_ppm", "cu_ppm", "as_ppm"], mode="multi-line")

# Horizontal stacked bars per interval.
view.plot_multi_assay(df, ["au_ppm", "cu_ppm"], mode="multi-stacked")

# Equivalently through the dispatcher:
view.plot_drillhole_trace(
    df, "au_ppm", chart_type="multi-stacked", multi_props=["cu_ppm", "as_ppm"],
)
```

#### Two-curve fill (cross-plot track)

Compare two numeric curves with the region between them shaded by dominance — the classic neutron–density display. Both columns are aligned onto the union of their depth grids and the shading is split at every crossing: where A > B the fill uses A's colour at alpha 0.4, where B > A it uses B's.

```python
view.plot_two_curve_fill(df, "density", "neutron")

# Colours default to the commodity colour for each column name, falling back
# to MULTI_SERIES_COLORWAY[0] / [1]; both are overridable, and log_scale works.
view.plot_two_curve_fill(df, "au_ppm", "cu_ppm", color_a="#8b1e3f", log_scale=True)

# Or through the dispatcher as a multi-property chart type: value_col is
# curve A and the first multi_props entry is curve B.
view.plot_drillhole_trace(df, "density", chart_type="two-curve", multi_props=["neutron"])
```

#### Percent-composition track

Divided horizontal stacked bars per interval — one trace per component in `value_cols` order. With `normalize=True` (default) each interval's components are scaled to fractions of their sum and the axis is fixed to [0, 1] with percent ticks; pass `normalize=False` to stack raw values. Intervals whose components are all null/zero are skipped and negative values are clamped to 0 for the bar (raw value stays in hover).

```python
view.plot_composition_log(
    df, ["sand_pct", "silt_pct", "clay_pct"],
    colour_map={"sand_pct": "#F5CBA7", "silt_pct": "#90A4AE", "clay_pct": "#607D8B"},
)

# Or through the dispatcher: value_col plus multi_props are the components,
# in stack order.
view.plot_drillhole_trace(
    df, "sand_pct", chart_type="composition", multi_props=["silt_pct", "clay_pct"],
)
```

#### Lithology pattern / hatch fills

Categorical band tracks (`plot_strip_log`, `plot_categorical_trace`) accept a `pattern_map` — category → Plotly pattern shape (`"/"`, `"\\"`, `"x"`, `"-"`, `"|"`, `"+"`, `"."`, or `""` for solid) — rendered as a light white hatch over the band colour. Lookup is case-insensitive like the colour maps, and a built-in `"lithology"` map ships with conventional hatches (sandstone `.`, shale `-`, limestone `+`, basalt `x`, …).

```python
view.plot_strip_log(
    geology_df, label_col="lithology",
    colour_map="lithology", pattern_map="lithology",
)

# Custom maps work the same way; unmapped categories stay solid.
view.plot_strip_log(geology_df, label_col="lithology", pattern_map={"BIF": "-"})
```

#### Depth-pinned annotations

Pin free-text notes at depth: a tick at the track's left edge with the text alongside. Long notes are word-truncated to ~40 characters for display with the full text in hover. The output composes with the other tracks, so an annotations track can sit beside numeric / categorical tracks.

```python
view.plot_depth_annotations(structures, depth_col="depth", text_col="comments")

# Or through the dispatcher as the "annotations" chart type for a comment
# column. Depth is resolved per row: a measured `depth` (or `mid`) column is
# used directly, and interval tables fall back to from/to mid-depths.
view.plot_drillhole_trace(structures, "comments", chart_type="annotations")
```

### Structural tracks

#### Alpha/beta to dip and dip direction

Convert core-frame alpha/beta measurements to true dip / dip direction given the hole orientation at the measurement depth. Vectorised with numpy — scalars or arrays.

```python
from baselode.drill.structural import alpha_beta_to_dip_azimuth

dip, dip_direction = alpha_beta_to_dip_azimuth(
    hole_dip=-60,      # survey convention: negative = downward
    hole_azimuth=90,   # degrees clockwise from north
    alpha=45,          # acute angle between the plane and the core axis
    beta=120,          # clockwise (looking downhole) from the bottom-of-hole line
)
```

For a near-vertical hole the bottom-of-hole reference line is degenerate; the reference falls back to north projected perpendicular to the core axis (beta is then measured clockwise from north).

#### Split dip / azimuth tracks

Plot dip magnitude and dip-direction azimuth as two side-by-side tracks sharing one reversed depth axis: dip on a fixed [0, 90] axis, azimuth on a fixed [0, 360] axis with ticks every 90°. Pass `color_by` (e.g. defect type) for one trace per category with a legend shared across both tracks.

```python
view.plot_dip_azimuth_log(structures, color_by="defect")

# Or through the dispatcher as the "dip-azimuth" chart type — the frame
# carries the depth/dip/azimuth columns for structural tables.
view.plot_drillhole_trace(structures, "dip", chart_type="dip-azimuth")
```

Tadpole plots (`view.plot_tadpole_log`) and categorical point logs (`view.plot_point_log`) complete the structural track set. Point logs are also a dispatcher chart type for categorical columns — `chart_type="point-log"` places one marker per row at its measured depth (or interval mid-depth), with a distinct x-position, colour, and symbol per category:

```python
view.plot_drillhole_trace(structures, "defect", chart_type="point-log")
```

### Plotly templates

Baselode ships two named Plotly templates.

| Module | Template name | Appearance |
|---|---|---|
| `baselode.template` | `"baselode"` | White background, Inter font, neutral grey grid |
| `baselode.baselode_dark_template` | `"baselode-dark"` | Dark background (`#1b1b1f`), Inter font, subtle warm grid |

Importing either module registers the template with Plotly's global registry:

```python
import baselode.template                  # registers "baselode"
import baselode.baselode_dark_template    # registers "baselode-dark"

fig = view.plot_strip_log(assays, hole_id="MY_001", columns=["au_ppm"])
fig.update_layout(template="baselode-dark")
fig.show()
```

You can also pass a template directly to the view helpers to avoid globals:

```python
from baselode.baselode_dark_template import BASELODE_DARK_TEMPLATE

fig = view.plot_drillhole_trace(df, "au_ppm", template=BASELODE_DARK_TEMPLATE)
```

#### Building a custom template

Any `plotly.graph_objects.layout.Template` object (or plain dict with a `layout` key) can be passed as `template`.  You do not need to register it in the Plotly registry.

```python
import plotly.graph_objects as go

MY_TEMPLATE = go.layout.Template(
    layout=go.Layout(
        paper_bgcolor="#0f1117",
        plot_bgcolor="#0f1117",
        font=dict(family="JetBrains Mono, monospace", color="#e2e8f0", size=13),
        colorway=["#38bdf8", "#34d399", "#fb923c", "#f472b6", "#a78bfa"],
        xaxis=dict(showline=False, showgrid=True, gridcolor="#1e293b",
                   tickfont=dict(color="#94a3b8")),
        yaxis=dict(showline=False, showgrid=True, gridcolor="#1e293b",
                   tickfont=dict(color="#94a3b8")),
        hoverlabel=dict(bgcolor="#1e293b", bordercolor="#38bdf8",
                        font=dict(color="#e2e8f0", size=12)),
    )
)

fig = view.plot_drillhole_trace(df, "au_ppm", template=MY_TEMPLATE)
```

### Colour mapping

#### Automatic commodity colours

Baselode automatically detects commodity elements in column names and applies a matching colour.  A column called `Au_ppm`, `au_ppb`, or `AU` will all render in gold; `Cu_pct` will render in copper-brown.

No configuration is required — pass the column name to `plot_drillhole_trace` and detection is automatic.

#### Built-in semantic colour maps

For categorical strip logs (geology codes, lithology, alteration) two built-in maps are available:

| Name | Contents |
|---|---|
| `'commodity'` | 18 commodity elements (Au, Ag, Cu, Fe, Ni, …) |
| `'lithology'` | ~30 common rock types (granite, basalt, shale, …) |

```python
from baselode.colours import get_colour, LITHOLOGY_COLOURS

fig = view.plot_geology_strip_log(
    geology_df,
    colour_map="lithology",    # use the built-in lithology map
)

# Or look up individual values
colour = get_colour("granite", LITHOLOGY_COLOURS)   # '#EF9A9A'
```

#### Custom colour maps

Supply any dict mapping category strings to CSS colour values:

```python
ALTERATION_COLOURS = {
    "potassic":       "#e53e3e",
    "phyllic":        "#d69e2e",
    "propylitic":     "#38a169",
    "argillic":       "#3182ce",
    "silicification": "#805ad5",
}

fig = view.plot_geology_strip_log(
    geology_df,
    label_col="alteration_type",
    colour_map=ALTERATION_COLOURS,
)
```

Lookup is case-insensitive, so `"Potassic"` and `"potassic"` both match.  Categories absent from the map fall back to a built-in rotation palette.

### 3D Payload

Prepare 3D geometry payloads for the JS Baselode3DScene viewer:

```python
import baselode.drill.view_3d as view3d

segments = view3d.traces_as_segments(traces)
tubes     = view3d.intervals_as_tubes(assays, color_by="au_ppm")
```

These payloads can be serialised to JSON and consumed by the JavaScript `Baselode3DScene` component.

---

## Geophysics rasters

`baselode.geophysics` provides an in-memory, bands-first raster model for
magnetics, radiometrics, gravity, conductivity grids, and other gridded
geophysics. It preserves the numeric cells, GDAL affine transform, CRS,
no-data value, band names, and source metadata without taking a dependency on
any inversion package.

```bash
pip install 'baselode[raster]'
```

```python
import baselode.geophysics

raster = baselode.geophysics.load_raster('regional_tmi.ers')
print(raster.band_names, raster.bounds, raster.crs)

# JSON-safe payload for the Baselode JavaScript raster viewer.
payload = raster.to_payload()
```

The optional Rasterio/GDAL reader supports ER Mapper `.ers`, GeoTIFF and COG,
ENVI grids, and other formats enabled by the installed GDAL drivers. Raster
arrays are always shaped `(band, row, column)`, matching GDAL/Rasterio. The
affine transform is `(a, b, c, d, e, f)` where `x = a * column + b * row + c`
and `y = d * column + e * row + f`.

`GeophysicsRaster` does not depend on SimPEG. Its array, transform, CRS, and
no-data fields are intentionally suitable inputs for a future explicit
SimPEG mesh/model adapter, while leaving inversion decisions to the caller.

---

## Using with Jupyter Notebooks

Example notebooks are provided in the repository under [`notebooks/`](https://github.com/darkmine-oss/baselode/tree/main/notebooks):

| Notebook | Description |
|---|---|
| `example_drill_tour.ipynb` | End-to-end tour of `baselode.drill` — loaders, map, strip logs, desurvey, compositing, interval algebra, validation, `DrillholeSet`, OMF |
| `example_drillhole_set.ipynb` | `DrillholeSet` composition root focused walkthrough |
| `example_omf_export.ipynb` | GSWA → OMF round-trip focused walkthrough |
| `example_darkmine_vault_api.ipynb` | Pull drillhole data from the Darkmine Vault API |

Open the tour locally:

```bash
pip install baselode jupyter
jupyter notebook notebooks/example_drill_tour.ipynb
```
