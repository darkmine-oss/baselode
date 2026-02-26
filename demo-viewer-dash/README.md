# baselode-viewer (Dash)

Python/Dash demo application for the [`baselode`](../python) Python library. It mirrors the [React demo](../demo-viewer-react/app) and showcases interactive drillhole data loading, desurveying, map-based collar viewing, 2D strip-log visualisation, and an embedded 3D scene.

> The 3D page intentionally embeds the JavaScript baselode viewer so 3D rendering stays powered by the JS library — only the map and strip-log pages use the Python library directly.

## Pages

| Route | Description |
|---|---|
| `/` | **Map** — Plotly scatter-map of collar locations. Click a collar to open a strip-log popup with a property selector. Search bar filters visible collars by hole ID. |
| `/drillhole` | **3D viewer** — Embedded JS baselode viewer (`drillhole3d.html`) rendered inside an iframe. |
| `/drillhole-2d` | **Strip logs** — Multi-track Plotly strip logs for a selected hole (numeric, categorical, comments tracks). |

## Development

The app depends on the local `baselode` Python package installed as an editable install from `python/src`.

```bash
# from repo root — activate the venv
source .venv/bin/activate

# install Python deps (first time only)
pip install -r demo-viewer-dash/requirements.txt
pip install -e python/src

# start the dev server with hot reload
cd demo-viewer-dash
uvicorn asgi:app --host 127.0.0.1 --port 8050 --reload
```

The app is available at **http://127.0.0.1:8050**.

`--reload` watches for source changes and restarts automatically. Note that changes to `assets/` (CSS, JS) are served statically and take effect immediately without restart.

### Using Conda

```bash
conda activate env-baselode
cd demo-viewer-dash
uvicorn asgi:app --host 127.0.0.1 --port 8050 --reload
```

## Data

The app reads the canonical GSWA dataset directly from the repo's test data directory:

```
test/data/gswa/
  gswa_sample_collars.csv
  gswa_sample_assays.csv
  gswa_sample_survey.csv
  gswa_sample_structure.csv
  demo_gswa_precomputed_desurveyed.csv   # pre-built 3D traces with true elevation
```

The precomputed desurvey file contains UTM Zone 50S easting/northing (centroid-relative) and true elevation (metres ASL). When the file is present it is used directly; otherwise the app falls back to desurveying on-the-fly from the collar and survey CSVs.

To regenerate the precomputed desurvey file see the [React app scripts](../demo-viewer-react/app/scripts/generate_precomputed_desurvey.mjs).

## Dependencies

| Package | Purpose |
|---|---|
| `baselode` | Local Python library — data loading, desurveying, Plotly strip-log builders |
| `dash` | Web application framework |
| `plotly` | Map and strip-log charts |
| `pandas` | Data manipulation |
| `geopandas` / `pyproj` | Geospatial coordinate handling |
| `uvicorn` / `starlette` | ASGI server |

