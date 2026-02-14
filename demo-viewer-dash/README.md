# Baselode Demo Viewer - Dash (Python)

This Dash app mirrors the React demo viewer functionality using the Python `baselode` package for data loading, desurveying, map and 2D traces.

The only exception is the 3D window, which is intentionally embedded from the JavaScript Baselode demo so the 3D rendering remains powered by the JS module.

## Features parity

- Map-style collar viewer with search by configurable primary key
- Drillhole 2D page with 4 configurable traces
- Drillhole key configuration page (shared across app state)
- Drillhole 3D page embedding the JS Baselode viewer window

## Run

From repo root:

```bash
python -m pip install -r demo-viewer-dash/requirements.txt
python -m pip install -e python/src
python demo-viewer-dash/app.py
```

Open: http://127.0.0.1:8050

## 3D page setup

The 3D page embeds the JS viewer route in an iframe.

Start the React demo app in another terminal:

```bash
npm run dev --workspace=demo-viewer-react/app
```

Default embedded URL is:

`http://localhost:3000/drillhole`

You can change this URL directly inside the Dash app on the Drillhole (3D) page.
