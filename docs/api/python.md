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
