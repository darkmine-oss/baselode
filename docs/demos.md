# Demos

Baselode ships two full-featured demo applications built on the same GSWA drillhole dataset.  They are the best way to see every feature working together, and serve as reference implementations for building your own apps.

## Sample Dataset

Both demos use the **GSWA Geochemistry** sample data included in the repository under `test/data/gswa/`:

| File | Description |
|---|---|
| `gswa_sample_collars.csv` | Collar locations (lat/lon + easting/northing) |
| `gswa_sample_surveys.csv` | Directional survey measurements |
| `gswa_sample_assays.csv` | Geochemical assay intervals |
| `gswa_sample_structure.csv` | Structural point measurements |
| `demo_gswa_precomputed_desurveyed.csv` | Pre-built 3D traces (UTM Zone 50S) |

Data is derived from the GSWA Geochemistry dataset (CC BY 4.0, Government of Western Australia).  See [`ATTRIBUTION.md`](https://github.com/darkmine-oss/baselode/blob/main/ATTRIBUTION.md) for the required attribution statement.

---

## React Demo App

**Stack:** Vite + React + MapLibre GL JS + Plotly + Three.js

The React demo is the primary showcase for the `baselode` JavaScript library.

### Pages

| Route | Description |
|---|---|
| `/` | **Map** — MapLibre map of collar locations.  Click a collar to open a strip-log popup with a property selector.  Search bar filters visible collars by hole ID. |
| `/drillhole` | **3D viewer** — Three.js scene with desurveyed drillhole traces and structural disc markers. |
| `/drillhole2d` | **2D strip logs** — Multi-track Plotly strip logs for a selected hole (numeric, categorical, comments, and tadpole tracks). |

### Setup and run

1. Clone the repository:

   ```bash
   git clone https://github.com/darkmine-oss/baselode.git
   cd baselode
   ```

2. Install all dependencies (installs both the library and the app):

   ```bash
   npm install
   ```

3. Start the library watcher and app dev server together:

   ```bash
   npm run dev:local --workspace=demo-viewer-react/app
   # or
   cd demo-viewer-react/app
   npm run dev:local
   ```

4. Open `http://localhost:5173` in your browser.

The `dev:local` script runs the library in watch mode (`vite build --watch`) so changes to the library source are reflected in the app immediately.

### Build for production

```bash
cd demo-viewer-react/app
npm run build
# Output in demo-viewer-react/app/dist/
```

---

## Dash Demo App

**Stack:** Python + Plotly Dash + uvicorn/Starlette + embedded JS 3D viewer

The Dash demo mirrors the React demo and is the primary showcase for the `baselode` Python library.  The map and strip-log pages are rendered entirely in Python with Plotly; the 3D page embeds the JavaScript viewer inside an `<iframe>`.

### Pages

| Route | Description |
|---|---|
| `/` | **Map** — Plotly scatter-map of collar locations.  Click a collar to open a strip-log popup with a property selector. |
| `/drillhole` | **3D viewer** — Embedded JS baselode viewer rendered inside an iframe. |
| `/drillhole-2d` | **Strip logs** — Multi-track Plotly strip logs for a selected hole. |

### Setup and run

**Option A — pip / venv**

```bash
# from repo root
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate

pip install -r demo-viewer-dash/requirements.txt
pip install -e python/src

cd demo-viewer-dash
uvicorn asgi:app --host 127.0.0.1 --port 8050 --reload
```

**Option B — Conda**

```bash
# Assumes conda is installed
conda env create -f environment.yml
conda activate env-baselode

cd demo-viewer-dash
uvicorn asgi:app --host 127.0.0.1 --port 8050 --reload
```

Open `http://127.0.0.1:8050` in your browser.

The `--reload` flag watches for source changes and restarts the server automatically.

---

## Jupyter Notebooks

Example Jupyter notebooks live in the [`notebooks/`](https://github.com/darkmine-oss/baselode/tree/main/notebooks) directory.

| Notebook | Description |
|---|---|
| `test_drillholes.ipynb` | Load collars, surveys and assays; desurvey; visualise on map and strip log |
| `test_sample_data.ipynb` | Explore the GSWA sample data and validate column mapping |

### Running notebooks

```bash
# from repo root (with venv or conda env active)
pip install baselode jupyter

jupyter notebook notebooks/
```

---

## Regenerating Precomputed Desurvey

The `demo_gswa_precomputed_desurveyed.csv` file is built by the React demo's Node.js script and is committed for convenience.  To regenerate it:

```bash
cd demo-viewer-react/app
node scripts/generate_precomputed_desurvey.mjs
```

This writes the file to `test/data/gswa/demo_gswa_precomputed_desurveyed.csv`.
