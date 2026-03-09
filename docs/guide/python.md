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

Constants are importable from `baselode.datamodel`:

```python
from baselode.datamodel import HOLE_ID, LATITUDE, LONGITUDE, ELEVATION, DEPTH
```

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

### Joining assay positions to traces

```python
from baselode.drill.data import join_assays_to_traces

joined = join_assays_to_traces(assays, traces)
# Merges 3D coordinates onto the assay DataFrame using hole_id
```

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

## Using with Jupyter Notebooks

Example notebooks are provided in the repository under [`notebooks/`](https://github.com/darkmine-oss/baselode/tree/main/notebooks):

| Notebook | Description |
|---|---|
| `test_drillholes.ipynb` | Load collars, surveys and assays; desurvey; visualise on map |
| `test_sample_data.ipynb` | Explore the GSWA sample data |

Open notebooks locally:

```bash
pip install baselode jupyter
jupyter notebook notebooks/test_drillholes.ipynb
```
