# baselode-viewer

React demo application for the [`baselode`](../../javascript/packages/baselode) JavaScript library. It showcases interactive drillhole data loading, desurveying, 2D strip-log visualisation, and 3D scene rendering.

## Pages

| Route | Description |
|---|---|
| `/` | **Map** — MapLibre map of collar locations. Click a collar to open a strip-log popup with a property selector. Search bar filters visible collars by hole ID. |
| `/drillhole` | **3D viewer** — Three.js scene with desurveyed drillhole traces and structural disc markers. |
| `/drillhole2d` | **2D strip logs** — Multi-track Plotly strip logs for a selected hole (numeric, categorical, comments tracks). |

## Development

The app depends on the local `baselode` library package (linked via `file:../../javascript/packages/baselode`). Use the combined dev script to watch both simultaneously:

```bash
# from repo root
npm install

# start library watch + app dev server together (recommended)
npm run dev:local --workspace=demo-viewer-react/app
# or from this directory:
cd demo-viewer-react/app
npm run dev:local
```

The Vite dev server starts at **http://localhost:5173** (or next available port). The `dev:local` script runs the library in watch mode (`vite build --watch`) and the app dev server concurrently, so changes to the library are reflected immediately.

## Data

In dev mode, Vite serves `../../test/data/` under `/data` via a custom middleware. The app auto-loads the canonical GSWA dataset from:

```
test/data/gswa/
  gswa_sample_collars.csv
  gswa_sample_assays.csv
  gswa_sample_survey.csv
  demo_gswa_precomputed_desurveyed.csv   # pre-built 3D traces
```
