# Getting Started

Baselode is an open-source, multi-language toolkit for working with drillhole and spatial datasets in the mineral exploration and mining industries.  It is available as:

- **`baselode` (Python)**: data loading, validation, desurveying, compositing, block models, geophysics grids, and map and strip-log visualisation
- **`baselode` (JavaScript/npm)**: the same data layer, plus 2D strip logs, a 3D scene (drillholes, block models, terrain, raster overlays) and a geophysics grid viewer

## Prerequisites

| Language | Minimum version |
|---|---|
| Python | 3.12+ |
| Node.js | 18+ |

## Installation

### Python

Install from [PyPI](https://pypi.org/project/baselode/) using `pip`:

```bash
pip install baselode
```

Recommended: create a virtual environment first.

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install baselode
```

#### Optional extras

Some features need extra dependencies. Install them with `pip install "baselode[<extra>]"`:

| Extra | Adds |
|---|---|
| `viz` | Folium collar maps |
| `sql` | SQL loaders (SQLAlchemy) |
| `las` | LAS well-log files (lasio) |
| `raster` | GeoTIFF and other GDAL grids (rasterio). ER Mapper `.ers` grids load without it. |
| `api` | Remote data APIs (requests) |
| `omf` | Open Mining Format import and export |
| `all` | Everything above |

### JavaScript / npm

Install from [npm](https://www.npmjs.com/package/baselode):

```bash
npm install baselode
```

`baselode` has peer dependencies that must also be installed in your app:

```bash
npm install baselode react react-dom three three-viewport-gizmo plotly.js-dist-min papaparse zod
```

`@assistant-ui/react` is an optional peer, needed only for the `baselode/assistant-ui` entry point.

If you only need geophysics loading and processing, for example in a Web Worker, import from `baselode/geophysics`. That entry has no React, DOM or THREE.js dependencies.

---

## Quick Start

### Python — load and inspect a drillhole dataset

```python
import baselode.drill.data as drill

COLLAR_CSV  = "path/to/collars.csv"
SURVEY_CSV  = "path/to/surveys.csv"
ASSAY_CSV   = "path/to/assays.csv"

collars = drill.load_collars(COLLAR_CSV)
surveys = drill.load_surveys(SURVEY_CSV)
assays  = drill.load_assays(ASSAY_CSV)

print(collars.head())
print(surveys.head())
```

All loaders return a normalised `pandas.DataFrame` (or `GeoDataFrame` for collars) using the [Baselode Open Data Model](/guide/python#data-model).

### Python — desurvey and visualise in 3D (requires the JS module)

```python
import baselode.drill.data as drill
import baselode.drill.desurvey as desurvey

collars = drill.load_collars("collars.csv")
surveys = drill.load_surveys("surveys.csv")
assays  = drill.load_assays("assays.csv")

traces = desurvey.desurvey_holes(collars, surveys)
```

### JavaScript — load CSV and desurvey

```js
import { loadAssayFile, minimumCurvatureDesurvey } from 'baselode';

const collars = [{ hole_id: 'DH001', easting: 500000, northing: 6900000, elevation: 300 }];
const surveys = [
  { hole_id: 'DH001', depth: 0, azimuth: 90, dip: -60 },
  { hole_id: 'DH001', depth: 100, azimuth: 90, dip: -60 }
];
const traces = minimumCurvatureDesurvey(collars, surveys, { step: 1 });
```

### Python — load and filter a geophysics grid

```python
import baselode.geophysics

grid = baselode.geophysics.load_raster("magnetics.ers")
rtp = baselode.geophysics.reduce_to_pole(grid, inclination=-60, declination=1)
tilt = baselode.geophysics.tilt_derivative(rtp)
payload = tilt.to_payload()   # render in JS with <GeophysicsRasterViewer raster={payload} />
```

See [Geophysics rasters](/guide/python#geophysics-rasters) for filters, hillshade and colour scales.

---

## Running the Demo Applications

Two demo applications ship with the repository so you can see every feature in action with real GSWA data.

| Demo | Stack | Description |
|---|---|---|
| React demo | Vite + React | Map, 2D strip logs, 3D viewer |
| Dash demo | Python + Plotly Dash | Map, 2D strip logs, embedded 3D viewer |

For full setup instructions see the [Demos page](/demos).

---

## Project Layout

```
baselode/
├── python/src/baselode/   Python package source
├── javascript/packages/baselode/  JavaScript package source
├── demo-viewer-react/app/  React demo application
├── demo-viewer-dash/       Dash demo application
├── notebooks/              Jupyter notebooks
├── test/data/gswa/         Sample GSWA drillhole data
└── docs/                   This documentation site
```
