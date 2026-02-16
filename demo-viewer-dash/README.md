# Baselode Demo Viewer - Dash (Python)

This Dash app mirrors the React demo viewer functionality using the Python `baselode` package for data loading, desurveying, map and 2D traces.

The only exception is the 3D window, which is intentionally embedded from the JavaScript Baselode demo so the 3D rendering remains powered by the JS module.

## Features parity

- Map-style collar viewer with search by configurable primary key
- Drillhole 2D page with 4 configurable traces
- Drillhole key configuration page (shared across app state)
- Drillhole 3D page embedding the JS Baselode viewer window

## Run

### Quick Start (After Git Checkout)

From the repository root:

```bash
# 1. Activate the virtual environment
source .venv/bin/activate

# 2. Install Python dependencies
pip install -r demo-viewer-dash/requirements.txt
pip install -e python/src

# 3. Run the Dash app
cd demo-viewer-dash
python app.py
```

The app will be available at: **http://127.0.0.1:8050**

### Alternative: Using Conda

If you're using conda:

```bash
# 1. Activate the conda environment
conda activate env-baselode

# 2. Install dependencies and run
cd demo-viewer-dash
python app.py
```

