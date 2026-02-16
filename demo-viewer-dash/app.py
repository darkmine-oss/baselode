# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

from pathlib import Path

from dash import Dash, dcc, html, Input, Output, State, callback_context, no_update
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import baselode.drill.data
import baselode.drill.desurvey 
import baselode.drill.view 

REPO_ROOT = Path(__file__).resolve().parents[1]

DATA_DIR = REPO_ROOT / "demo-viewer-react" / "app" / "public" / "data" / "gswa"
COLLARS_CSV = DATA_DIR / "demo_gswa_sample_collars.csv"
SURVEY_CSV = DATA_DIR / "demo_gswa_sample_survey.csv"
ASSAYS_CSV = DATA_DIR / "demo_gswa_sample_assays.csv"
PRECOMPUTED_DESURVEY_CSV = DATA_DIR / "demo_gswa_precomputed_desurveyed.csv"

# Non-value fields for assay data (metadata and structural columns)
ASSAY_NON_VALUE_FIELDS = {
    "hole_id",
    "datasource_hole_id",
    "project_id",
    "from",
    "to",
    "mid",
    "x",
    "y",
    "z",
    "lat",
    "lon",
    "easting",
    "northing",
    "elevation",
    "latitude",
    "longitude",
    "azimuth",
    "dip",
    "depth",
    "md",
}
CHART_TYPES = ["markers+line", "markers", "line", "bar", "categorical"]


def _safe_float(value, default=0.0):
    numeric = pd.to_numeric(value, errors="coerce")
    return float(numeric) if pd.notna(numeric) else float(default)


def _trace_coordinates(row):
    easting = row.get("easting")
    northing = row.get("northing")
    elevation = row.get("elevation")

    if pd.isna(easting):
        easting = row.get("x")
    if pd.isna(northing):
        northing = row.get("y")
    if pd.isna(elevation):
        elevation = row.get("z")

    return {
        "easting": _safe_float(easting),
        "northing": _safe_float(northing),
        "elevation": _safe_float(elevation),
    }


def build_drillhole_data(traces_df, max_holes=100):
    if traces_df.empty:
        return {}

    drillhole_data = {}
    unique_holes = traces_df["hole_id"].dropna().unique()[:max_holes]

    for hole_id in unique_holes:
        hole_traces = traces_df[traces_df["hole_id"] == hole_id].sort_values("md")
        drillhole_data[str(hole_id)] = []

        for _, row in hole_traces.iterrows():
            coords = _trace_coordinates(row)
            drillhole_data[str(hole_id)].append(
                {
                    "easting": coords["easting"],
                    "northing": coords["northing"],
                    "elevation": coords["elevation"],
                    "md": _safe_float(row.get("md")),
                    "project_id": row.get("project_id") if pd.notna(row.get("project_id")) else None,
                }
            )

    return drillhole_data


def build_scene_assay_rows(assays_df, hole_ids, numeric_props):
    if assays_df.empty or not hole_ids:
        return []

    hole_keys = {str(h).strip() for h in hole_ids if str(h).strip()}
    if not hole_keys:
        return []

    assays = assays_df.copy()
    assays["_hole_key"] = assays["hole_id"].astype(str).str.strip()
    assays = assays[assays["_hole_key"].isin(hole_keys)]

    rows = []
    for _, row in assays.iterrows():
        from_value = pd.to_numeric(row.get("from"), errors="coerce")
        to_value = pd.to_numeric(row.get("to"), errors="coerce")
        if pd.isna(from_value) or pd.isna(to_value) or float(to_value) <= float(from_value):
            continue

        interval = {
            "hole_id": row.get("_hole_key"),
            "from": float(from_value),
            "to": float(to_value),
        }

        for var in numeric_props:
            value = pd.to_numeric(row.get(var), errors="coerce")
            if pd.notna(value):
                interval[var] = float(value)

        rows.append(interval)

    return rows


def load_demo_dataset(collars_csv, survey_csv, assays_csv, precomputed_desurvey_csv=None):
    """Load demo dataset using library's standardization.
    
    The library automatically maps common column name variations to standard names
    (hole_id, from, to, mid, lat, lon, etc.) via DEFAULT_COLUMN_MAP.
    For GSWA data, we just need to map their specific column names.
    """

    # Load data - library handles column standardization
    collars = baselode.drill.data.load_collars(
        collars_csv, 
        kind="csv"
    )
    
    # Load precomputed desurvey if available (has easting/northing in projected coordinates)
    if precomputed_desurvey_csv and Path(precomputed_desurvey_csv).exists():
        print(f"\nDEBUG: Loading precomputed desurvey from: {precomputed_desurvey_csv}")
        traces = pd.read_csv(precomputed_desurvey_csv)
        print(f"DEBUG: Loaded {len(traces)} trace rows")
        print(f"DEBUG: Original columns: {traces.columns.tolist()}")
        
        # Standardize column names
        traces.rename(columns={
            'x': 'easting',
            'y': 'northing', 
            'z': 'elevation'
        }, inplace=True)
        print(f"DEBUG: After renaming columns: {traces.columns.tolist()}")
        
        if not traces.empty:
            print("DEBUG: First trace row:")
            print(traces.head(1)[['hole_id', 'md', 'easting', 'northing', 'elevation']].to_string())
            print()
    else:
        surveys = baselode.drill.data.load_surveys(
            survey_csv, 
            kind="csv"
        )
        
        # Drop geometry column for simpler DataFrame handling
        collars = collars.drop(columns=["geometry"], errors="ignore")
        
        # Clean string columns
        for frame in [collars, surveys]:
            if "hole_id" in frame.columns:
                frame["hole_id"] = frame["hole_id"].astype(str).str.strip()

        # Desurvey to create 3D traces
        traces = baselode.drill.desurvey.minimum_curvature_desurvey(collars, surveys, step=5.0)
    
    assays = baselode.drill.data.load_assays(
        assays_csv, 
        kind="csv"
    )
    
    # Clean string columns
    if "hole_id" in assays.columns:
        assays["hole_id"] = assays["hole_id"].astype(str).str.strip()
    if "hole_id" in traces.columns:
        traces["hole_id"] = traces["hole_id"].astype(str).str.strip()

    # Join collar project metadata by normalized hole id (geometry remains from traces)
    if {"hole_id", "project_id"}.issubset(collars.columns) and "hole_id" in traces.columns:
        collar_projects = collars[["hole_id", "project_id"]].copy()
        collar_projects["_hole_id_key"] = collar_projects["hole_id"].astype(str).str.strip().str.lower()
        traces["_hole_id_key"] = traces["hole_id"].astype(str).str.strip().str.lower()
        traces = traces.merge(
            collar_projects[["_hole_id_key", "project_id"]],
            on="_hole_id_key",
            how="left",
            suffixes=("", "_collar"),
        )
        if "project_id_collar" in traces.columns:
            traces["project_id"] = traces["project_id"].where(traces["project_id"].notna(), traces["project_id_collar"])
            traces = traces.drop(columns=["project_id_collar"])
        traces = traces.drop(columns=["_hole_id_key"])
    
    # Attach spatial positions to assays for 3D visualization
    assays_with_positions = baselode.drill.desurvey.attach_assay_positions(assays, traces)

    return {
        "collars": collars,
        "assays": assays_with_positions,
        "traces": traces,
    }


def infer_property_lists(df):
    props = [col for col in df.columns if col not in ASSAY_NON_VALUE_FIELDS]
    numeric = []
    categorical = []
    for col in props:
        series = pd.to_numeric(df[col], errors="coerce")
        valid_ratio = float(series.notna().mean()) if len(series) else 0.0
        if valid_ratio > 0.7:
            numeric.append(col)
        else:
            categorical.append(col)
    return {
        "numeric": sorted(set(numeric)),
        "categorical": sorted(set(categorical)),
        "all": sorted(set(props)),
    }





def build_map_figure(collars_df, search_value):
    """Build map figure with collar locations."""
    frame = collars_df.copy()
    
    # Filter by search if provided
    if search_value:
        q = str(search_value).strip().lower()
        frame = frame[frame["hole_id"].str.lower().str.contains(q, na=False)]

    if frame.empty:
        fig = go.Figure()
        fig.update_layout(template="plotly_white", margin=dict(l=10, r=10, t=20, b=10), height=640)
        fig.add_annotation(text="No matching collars", showarrow=False, x=0.5, y=0.5, xref="paper", yref="paper")
        return fig

    # Use standard column names from library
    lat_col = "latitude" if "latitude" in frame.columns else "y"
    lon_col = "longitude" if "longitude" in frame.columns else "x"
    
    hover_data = {col: True for col in ["datasource_hole_id", "project_id"] if col in frame.columns}

    fig = px.scatter_map(
        frame,
        lat=lat_col,
        lon=lon_col,
        hover_name="hole_id",
        hover_data=hover_data,
        zoom=5,
        height=640,
    )
    fig.update_traces(marker=dict(size=8, color="#8b1e3f", opacity=0.85))
    fig.update_layout(map_style="open-street-map", margin=dict(l=10, r=10, t=10, b=10))
    return fig


def hole_options(assays_df):
    """Get unique hole IDs from assays for dropdown options."""
    vals = sorted([v for v in assays_df["hole_id"].dropna().astype(str).unique().tolist() if v])
    return [{"label": v, "value": v} for v in vals]


def build_trace_figure(
    assays_df,
    selected_hole,
    selected_property,
    chart_type,
    categorical_props,
):
    """Build a single drillhole trace figure using library's plot function."""
    if not selected_hole or not selected_property:
        fig = go.Figure()
        fig.update_layout(template="plotly_white", margin=dict(l=40, r=10, t=20, b=30), height=280)
        return fig

    subset = assays_df[assays_df["hole_id"] == selected_hole].copy()
    if subset.empty or selected_property not in subset.columns:
        fig = go.Figure()
        fig.update_layout(template="plotly_white", margin=dict(l=40, r=10, t=20, b=30), height=280)
        return fig

    is_cat = selected_property in categorical_props
    resolved_type = "categorical" if (is_cat and chart_type != "bar") else chart_type
    
    # Use library's visualization function
    fig = baselode.drill.view.plot_drillhole_trace(
        df=subset,
        value_col=selected_property,
        chart_type=resolved_type,
        categorical_props=categorical_props,
    )
    fig.update_layout(height=620, template="plotly_white")
    return fig


def build_popup_figure(assays_df, selected_hole, selected_property, categorical_props):
    """Build popup figure for quick preview."""
    if not selected_hole or not selected_property:
        return go.Figure()
    subset = assays_df[assays_df["hole_id"] == selected_hole].copy()
    if subset.empty:
        return go.Figure()
    
    fig = baselode.drill.view.plot_drillhole_trace(
        df=subset,
        value_col=selected_property,
        chart_type="line",
        categorical_props=[],
    )
    fig.update_layout(template="plotly_white", margin=dict(l=45, r=10, t=10, b=30))
    return fig


# Initialize app with demo data
DATASET = load_demo_dataset(COLLARS_CSV, SURVEY_CSV, ASSAYS_CSV, PRECOMPUTED_DESURVEY_CSV)
PROPERTY_INFO = infer_property_lists(DATASET["assays"])
DEFAULT_PROPERTY = (PROPERTY_INFO["numeric"] + PROPERTY_INFO["categorical"] + [""])[0]

app = Dash(
    __name__,
    suppress_callback_exceptions=True,
    title="Baselode Dash Viewer",
    external_stylesheets=["https://fonts.googleapis.com/css2?family=Lexend:wght@600&display=swap"]
)

# Serve baselode-module.js with correct MIME type for ES modules
@app.server.route('/assets/baselode-module.js')
def serve_baselode_module():
    from flask import Response
    assets_dir = Path(__file__).parent / 'assets'
    
    with open(assets_dir / 'baselode-module.js', 'r', encoding='utf-8') as f:
        content = f.read()
    
    return Response(
        content,
        mimetype='text/javascript',
        headers={
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        }
    )

# Dynamic 3D viewer with embedded drillhole data
@app.server.route('/drillhole3d')
def serve_drillhole3d():
    import json
    from flask import render_template_string
    
    # Get drillhole data
    traces_df = DATASET["traces"]
    drillhole_data = {}
    
    print(f"\nDEBUG serve_drillhole3d: traces_df has {len(traces_df)} rows")
    print(f"DEBUG serve_drillhole3d: traces_df columns: {traces_df.columns.tolist()}")
    
    if not traces_df.empty:
        MAX_SCENE_HOLES = 100
        unique_holes = traces_df["hole_id"].unique()[:MAX_SCENE_HOLES]

        if len(unique_holes) > 0:
            first_hole = unique_holes[0]
            first_traces = traces_df[traces_df["hole_id"] == first_hole].head(3)
            preview_cols = [c for c in ["hole_id", "md", "easting", "northing", "elevation", "x", "y", "z"] if c in first_traces.columns]
            print(f"\nDEBUG: First hole '{first_hole}' data:")
            print(first_traces[preview_cols].to_string())
            print()

        drillhole_data = build_drillhole_data(traces_df, max_holes=MAX_SCENE_HOLES)
    
    scene_hole_ids = list(drillhole_data.keys())
    assay_variables = ["__HAS_ASSAY__"] + PROPERTY_INFO["numeric"]
    assay_rows = build_scene_assay_rows(DATASET["assays"], scene_hole_ids, PROPERTY_INFO["numeric"])

    drillhole_json = json.dumps(drillhole_data)
    assay_variables_json = json.dumps(assay_variables)
    assay_rows_json = json.dumps(assay_rows)
    
    html_template = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Drillhole 3D Viewer</title>
    <link rel="stylesheet" href="/assets/baselode-style.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            width: 100%;
            height: 100vh;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        #scene-container {
            width: 100%;
            height: 100%;
            position: relative;
        }
        #loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            color: #666;
            z-index: 5;
        }
        #controls-panel {
            position: absolute;
            top: 16px;
            left: 16px;
            z-index: 10;
            background: rgba(255, 255, 255, 0.95);
            border: 1px solid rgba(0, 0, 0, 0.1);
            border-radius: 8px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-width: 260px;
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
        }
        #controls-panel label {
            font-size: 12px;
            color: #374151;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        #color-by-select {
            border: 1px solid #c7d0df;
            border-radius: 6px;
            padding: 6px 8px;
            font-size: 12px;
            background: #fff;
        }
        .control-buttons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
        }
        .control-btn {
            border: 1px solid #d1d5db;
            background: #fff;
            border-radius: 6px;
            padding: 6px 8px;
            font-size: 12px;
            cursor: pointer;
        }
        .control-btn:hover {
            background: #f9fafb;
        }
        #legend {
            display: none;
            border-top: 1px solid #e5e7eb;
            padding-top: 8px;
        }
        #legend.visible {
            display: block;
        }
        .legend-title {
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 6px;
            color: #374151;
        }
        .legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 4px;
        }
        .legend-swatch {
            width: 12px;
            height: 12px;
            border-radius: 2px;
            border: 1px solid rgba(0, 0, 0, 0.15);
        }
        .legend-label {
            font-size: 11px;
            color: #4b5563;
        }
    </style>
</head>
<body>
    <div id="scene-container">
        <div id="loading">Loading 3D scene...</div>
        <div id="controls-panel">
            <label>
                Color by assay variable
                <select id="color-by-select">
                    <option value="None">None</option>
                </select>
            </label>
            <div class="control-buttons">
                <button id="btn-look-down" class="control-btn" type="button">Look down</button>
                <button id="btn-fit" class="control-btn" type="button">Fit to scene</button>
                <button id="btn-origin" class="control-btn" type="button">Go to 0,0,0</button>
                <button id="btn-fly" class="control-btn" type="button">Enable fly controls</button>
            </div>
            <div id="legend"></div>
        </div>
    </div>
    
    <script>
        // Embed drillhole data directly in the page
        window.drillholeData = {{ drillhole_data|safe }};
        window.assayVariables = {{ assay_variables|safe }};
        window.assayRows = {{ assay_rows|safe }};
    </script>
    
    <script type="module">
        // Import standalone baselode module (all dependencies bundled)
        const { Baselode3DScene } = await import('/assets/baselode-module.js');
        const ASSAY_COLOR_PALETTE_10 = [
            '#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8',
            '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'
        ];

        function normalizeHoleKey(value) {
            return `${value ?? ''}`.trim().toLowerCase();
        }

        function buildAssayIntervalsByHole(assayRows) {
            const byHole = {};
            (assayRows || []).forEach((row) => {
                const holeKey = normalizeHoleKey(row?.hole_id);
                const from = Number(row?.from);
                const to = Number(row?.to);
                if (!holeKey || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
                if (!Array.isArray(byHole[holeKey])) byHole[holeKey] = [];
                byHole[holeKey].push({ from, to, values: { ...row } });
            });
            Object.keys(byHole).forEach((holeKey) => {
                byHole[holeKey] = byHole[holeKey].sort((a, b) => a.from - b.from);
            });
            return byHole;
        }

        function mapIntervalsForVariable(intervalsByHole, variable) {
            const mapped = {};
            Object.entries(intervalsByHole || {}).forEach(([holeId, intervals]) => {
                const selected = (intervals || [])
                    .map((interval) => {
                        const value = Number(interval?.values?.[variable]);
                        if (!Number.isFinite(value)) return null;
                        return { from: interval.from, to: interval.to, value };
                    })
                    .filter(Boolean);
                if (selected.length) mapped[holeId] = selected;
            });
            return mapped;
        }

        function buildEqualRangeColorScale(values, colors = ASSAY_COLOR_PALETTE_10) {
            const valid = (values || []).filter((v) => Number.isFinite(v));
            if (!valid.length) return null;
            const min = Math.min(...valid);
            const max = Math.max(...valid);
            if (min === max) {
                return {
                    colors: [colors[0]],
                    bins: [{ index: 0, min, max, label: `${min.toFixed(3)} - ${max.toFixed(3)}` }]
                };
            }
            const binCount = colors.length;
            const width = (max - min) / binCount;
            const bins = Array.from({ length: binCount }, (_, idx) => {
                const binMin = min + idx * width;
                const binMax = idx === binCount - 1 ? max : min + (idx + 1) * width;
                return {
                    index: idx,
                    min: binMin,
                    max: binMax,
                    label: `${binMin.toFixed(3)} - ${binMax.toFixed(3)}`
                };
            });
            return { colors, bins };
        }

        function renderLegend(colorByVariable, legendScale) {
            const legend = document.getElementById('legend');
            if (!legend) return;

            if (colorByVariable === '__HAS_ASSAY__') {
                legend.classList.add('visible');
                legend.innerHTML = `
                    <div class="legend-title">Legend (Has Assay Data)</div>
                    <div class="legend-item"><span class="legend-swatch" style="background:#ff8c42"></span><span class="legend-label">Has assay data</span></div>
                    <div class="legend-item"><span class="legend-swatch" style="background:#9ca3af"></span><span class="legend-label">No assay data</span></div>
                `;
                return;
            }

            if (!legendScale || colorByVariable === 'None') {
                legend.classList.remove('visible');
                legend.innerHTML = '';
                return;
            }

            const items = legendScale.bins.map((bin, idx) => `
                <div class="legend-item">
                    <span class="legend-swatch" style="background:${legendScale.colors[idx]}"></span>
                    <span class="legend-label">${bin.label}</span>
                </div>
            `).join('');

            legend.classList.add('visible');
            legend.innerHTML = `<div class="legend-title">Legend (${colorByVariable})</div>${items}`;
        }
        
        // Convert drillhole data to Baselode3DScene format
        function convertToBaselodeFormat(drillholeData) {
            // Map: x = easting, y = northing, z = elevation
            return Object.entries(drillholeData).map(([holeId, points]) => ({
                id: holeId,
                project: points?.[0]?.project_id || '',
                points: points.map(p => ({
                    x: p.easting,
                    y: p.northing,
                    z: p.elevation,
                    md: p.md
                }))
            }));
        }
        
        // Initialize the 3D scene
        async function init() {
            const container = document.getElementById('scene-container');
            const loading = document.getElementById('loading');
            const colorBySelect = document.getElementById('color-by-select');
            const lookDownBtn = document.getElementById('btn-look-down');
            const fitBtn = document.getElementById('btn-fit');
            const originBtn = document.getElementById('btn-origin');
            const flyBtn = document.getElementById('btn-fly');
            
            // Create scene
            const scene = new Baselode3DScene();
            scene.init(container);
            
            // Get and convert drillhole data
            const drillholeData = window.drillholeData || {};
            const holes = convertToBaselodeFormat(drillholeData);
            const assayVariables = window.assayVariables || [];
            const assayRows = window.assayRows || [];
            const intervalsByHole = buildAssayIntervalsByHole(assayRows);
            let colorByVariable = 'None';
            let controlMode = 'orbit';
            let firstRender = true;

            assayVariables.forEach((variable) => {
                const option = document.createElement('option');
                option.value = variable;
                option.textContent = variable === '__HAS_ASSAY__' ? 'Has Assay Data' : variable;
                colorBySelect.appendChild(option);
            });

            function renderDrillholes() {
                if (!holes.length) return;

                let selectedAssayVariable = '';
                let selectedIntervalsByHole = null;
                let legendScale = null;

                if (colorByVariable !== 'None') {
                    selectedAssayVariable = colorByVariable;
                    if (colorByVariable === '__HAS_ASSAY__') {
                        selectedIntervalsByHole = intervalsByHole;
                    } else {
                        selectedIntervalsByHole = mapIntervalsForVariable(intervalsByHole, colorByVariable);
                        const values = Object.values(selectedIntervalsByHole)
                            .flatMap((intervals) => (intervals || []).map((interval) => Number(interval?.value)))
                            .filter((value) => Number.isFinite(value));
                        legendScale = buildEqualRangeColorScale(values, ASSAY_COLOR_PALETTE_10);
                    }
                }

                scene.setDrillholes(holes, {
                    selectedAssayVariable,
                    assayIntervalsByHole: selectedIntervalsByHole,
                    preserveView: !firstRender
                });
                firstRender = false;
                renderLegend(colorByVariable, legendScale);
            }
            
            console.log(`Loading ${holes.length} drillholes into 3D scene`);
            
            // Render drillholes
            if (holes.length > 0) {
                renderDrillholes();
            }

            colorBySelect.addEventListener('change', (event) => {
                colorByVariable = event.target.value || 'None';
                renderDrillholes();
            });

            lookDownBtn.addEventListener('click', () => scene.lookDown(3000));
            fitBtn.addEventListener('click', () => scene.focusOnLastBounds(1.2));
            originBtn.addEventListener('click', () => scene.recenterCameraToOrigin(2000));
            flyBtn.addEventListener('click', () => {
                controlMode = controlMode === 'orbit' ? 'fly' : 'orbit';
                scene.setControlMode(controlMode);
                flyBtn.textContent = controlMode === 'orbit' ? 'Enable fly controls' : 'Disable fly controls';
            });

            window.addEventListener('resize', () => scene.resize());
            
            loading.style.display = 'none';
        }
        
        init();
    </script>
</body>
</html>
    '''
    
    return render_template_string(
        html_template,
        drillhole_data=drillhole_json,
        assay_variables=assay_variables_json,
        assay_rows=assay_rows_json,
    )


def sidebar_link(label, href):
    return dcc.Link(label, href=href, className="sidebar-link")


app.layout = html.Div(
    className="app-shell",
    children=[
        dcc.Location(id="url", refresh=False),
        dcc.Store(id="selected-hole-store", storage_type="session", data=""),
        dcc.Store(id="popup-hole-store", storage_type="memory", data=""),
        dcc.Store(id="open-mode-store", storage_type="local", data={"open_in_popup": True}),
        html.Nav(
            id="sidebar",
            className="sidebar",
            children=[
                html.Div(
                    className="sidebar-header",
                    children=[
                        html.H2("Baselode Viewer", className="sidebar-title")
                    ]
                ),
                sidebar_link("Map", "/"),
                sidebar_link("3D Scene", "/drillhole"),
                sidebar_link("Strip Log", "/drillhole-2d"),
                html.Div(id="sidebar-panel", className="sidebar-panel"),
                html.Div(id="sidebar-footer", className="sidebar-footer"),
                html.Div(
                    className="sidebar-source-link",
                    children=[
                        html.A("Source Code", href="https://github.com/darkmine-oss/baselode", target="_blank", rel="noopener noreferrer")
                    ]
                ),
            ],
        ),
        html.Main(id="main-content", className="main-content", children=[
            html.Div(id="page-content")
        ]),
    ],
)


@app.callback(Output("page-content", "children"), Input("url", "pathname"), State("selected-hole-store", "data"))
def render_page(pathname, selected_hole):
    if pathname == "/drillhole":
        return html.Div(
            className="page",
            children=[
                html.Div(
                    className="page-header",
                    children=[
                        html.H1("Drillhole Viewer 3D")
                    ],
                ),
                html.Iframe(
                    src="/drillhole3d",
                    style={
                        "width": "100%",
                        "height": "80vh",
                        "border": "none",
                        "borderRadius": "8px",
                    },
                ),
            ],
        )

    if pathname == "/drillhole-2d":
        options_holes = hole_options(DATASET["assays"])
        first_hole = selected_hole or (options_holes[0]["value"] if options_holes else "")
        property_options = [{"label": p, "value": p} for p in PROPERTY_INFO["all"]]
        initial_chart = "markers+line"
        initial_figure = build_trace_figure(
            DATASET["assays"],
            first_hole,
            DEFAULT_PROPERTY,
            initial_chart,
            PROPERTY_INFO["categorical"],
        )

        controls = []
        for idx in range(4):
            controls.append(
                html.Div(
                    className="trace-card",
                    children=[
                        html.Div(
                            className="trace-controls",
                            children=[
                                dcc.Dropdown(id=f"trace-hole-{idx}", options=options_holes, value=first_hole, placeholder="Hole"),
                                dcc.Dropdown(id=f"trace-prop-{idx}", options=property_options, value=DEFAULT_PROPERTY, placeholder="Property"),
                                dcc.Dropdown(id=f"trace-chart-{idx}", options=[{"label": c, "value": c} for c in CHART_TYPES], value=initial_chart),
                            ],
                        ),
                        dcc.Graph(
                            id=f"trace-fig-{idx}",
                            figure=initial_figure,
                            config={"displayModeBar": True, "responsive": True},
                            style={"height": "62vh"},
                        ),
                    ],
                )
            )

        return html.Div(
            className="page",
            children=[
                html.Div(
                    className="page-header",
                    children=[
                        html.H1("Drillhole 2D Traces"),
                    ],
                ),
                html.Div(controls, className="trace-grid"),
            ],
        )

    # Default: Map page
    return html.Div(
        className="page map-page",
        children=[
            dcc.Graph(
                id="collar-map",
                figure=build_map_figure(DATASET["collars"], ""),
                config={"displayModeBar": True, "responsive": True},
                className="map-graph",
                style={"height": "100vh"},
            ),
            html.Div(
                id="popup-panel",
                className="popup hidden",
                children=[
                    html.Div(className="popup-head", children=[
                        html.Div(id="popup-title", className="popup-title"),
                        html.Button("Close", id="popup-close", n_clicks=0, className="btn btn-small"),
                    ]),
                    dcc.Dropdown(id="popup-property", options=[{"label": p, "value": p} for p in PROPERTY_INFO["numeric"]], value=(PROPERTY_INFO["numeric"][0] if PROPERTY_INFO["numeric"] else "")),
                    dcc.Graph(id="popup-graph", style={"flex": "1", "minHeight": "0"}),
                    html.Button("Open page", id="popup-open-page", n_clicks=0, className="btn"),
                ],
            ),
        ],
    )


@app.callback(
    Output("open-mode-store", "data"),
    Input("open-mode-check", "value"),
    prevent_initial_call=True,
)
def update_open_mode(values):
    """Update whether to open holes in popup or navigate to page."""
    return {"open_in_popup": "popup" in (values or [])}


@app.callback(
    Output("collar-map", "figure"),
    Input("map-search", "value"),
)
def update_map(search_value):
    """Update map based on search filter."""
    return build_map_figure(DATASET["collars"], search_value)


@app.callback(
    Output("popup-hole-store", "data"),
    Output("selected-hole-store", "data"),
    Output("url", "pathname", allow_duplicate=True),
    Input("collar-map", "clickData"),
    Input("popup-close", "n_clicks"),
    Input("popup-open-page", "n_clicks"),
    State("open-mode-store", "data"),
    State("popup-hole-store", "data"),
    prevent_initial_call=True,
)
def handle_map_click_or_popup(click_data, close_clicks, open_page_clicks, open_mode, popup_hole):
    """Handle map marker clicks and popup interactions."""
    trigger = callback_context.triggered[0]["prop_id"].split(".")[0]

    if trigger == "popup-close":
        return "", no_update, no_update

    if trigger == "popup-open-page":
        if popup_hole:
            return "", popup_hole, "/drillhole-2d"
        return no_update, no_update, no_update

    if trigger != "collar-map" or not click_data:
        return no_update, no_update, no_update

    # Extract clicked point
    point = (click_data.get("points") or [{}])[0]
    lat = point.get("lat")
    lon = point.get("lon")
    if lat is None or lon is None:
        return no_update, no_update, no_update

    # Find nearest collar
    collars = DATASET["collars"]
    lat_col = "latitude" if "latitude" in collars.columns else "y"
    lon_col = "longitude" if "longitude" in collars.columns else "x"
    dlat = (collars[lat_col] - float(lat)).abs()
    dlon = (collars[lon_col] - float(lon)).abs()
    nearest = collars.loc[(dlat + dlon).idxmin()]
    hole_id = nearest.get("hole_id", "")
    if not hole_id:
        return no_update, no_update, no_update

    # Open in popup or navigate to page
    is_popup = bool((open_mode or {}).get("open_in_popup", True))
    if is_popup:
        return hole_id, no_update, no_update
    return "", hole_id, "/drillhole-2d"


@app.callback(
    Output("popup-panel", "className"),
    Output("popup-title", "children"),
    Output("popup-graph", "figure"),
    Input("popup-hole-store", "data"),
    Input("popup-property", "value"),
)
def update_popup(hole_id, selected_property):
    """Update popup with selected hole's data."""
    if not hole_id:
        return "popup hidden", "", go.Figure()
    
    default_numeric = PROPERTY_INFO["numeric"][0] if PROPERTY_INFO["numeric"] else ""
    prop = selected_property or default_numeric
    fig = build_popup_figure(DATASET["assays"], hole_id, prop, PROPERTY_INFO["categorical"])
    return "popup", f"Hole {hole_id} — 2D assay preview", fig


@app.callback(
    Output("trace-fig-0", "figure"),
    Output("trace-fig-1", "figure"),
    Output("trace-fig-2", "figure"),
    Output("trace-fig-3", "figure"),
    Input("trace-hole-0", "value"),
    Input("trace-prop-0", "value"),
    Input("trace-chart-0", "value"),
    Input("trace-hole-1", "value"),
    Input("trace-prop-1", "value"),
    Input("trace-chart-1", "value"),
    Input("trace-hole-2", "value"),
    Input("trace-prop-2", "value"),
    Input("trace-chart-2", "value"),
    Input("trace-hole-3", "value"),
    Input("trace-prop-3", "value"),
    Input("trace-chart-3", "value"),
)
def update_traces(
    hole0,
    prop0,
    chart0,
    hole1,
    prop1,
    chart1,
    hole2,
    prop2,
    chart2,
    hole3,
    prop3,
    chart3,
):
    """Update all four trace figures."""
    assays = DATASET["assays"]
    figs = [
        build_trace_figure(assays, hole0, prop0, chart0, PROPERTY_INFO["categorical"]),
        build_trace_figure(assays, hole1, prop1, chart1, PROPERTY_INFO["categorical"]),
        build_trace_figure(assays, hole2, prop2, chart2, PROPERTY_INFO["categorical"]),
        build_trace_figure(assays, hole3, prop3, chart3, PROPERTY_INFO["categorical"]),
    ]
    return figs[0], figs[1], figs[2], figs[3]


@app.callback(
    Output("sidebar-footer", "children"),
    Input("url", "pathname"),
)
def update_sidebar_footer(pathname):
    """Display data source info in sidebar footer."""
    collars_count = len(DATASET["collars"])
    assays_count = len(DATASET["assays"]["hole_id"].unique()) if not DATASET["assays"].empty else 0
    surveys_count = len(DATASET["traces"]["hole_id"].unique()) if not DATASET["traces"].empty else 0
    
    data_source_text = html.Div(
        f"demo_gswa ({collars_count} collars, {surveys_count} surveys, {assays_count} assays)",
        className="data-source-info"
    )
    
    return [data_source_text]


@app.callback(
    Output("sidebar-panel", "children"),
    Output("sidebar", "className"),
    Output("main-content", "className"),
    Input("url", "pathname"),
    Input("open-mode-store", "data"),
)
def update_sidebar_panel(pathname, open_mode):
    """Update sidebar panel content based on current page."""
    if pathname != "/":
        return [], "sidebar", "main-content content-main"

    open_in_popup = bool((open_mode or {}).get("open_in_popup", True))

    panel = [
        html.Div("Map Controls", className="controls-title"),
        dcc.Input(id="map-search", type="text", placeholder="Search hole_id", className="text-input"),
        dcc.Checklist(
            id="open-mode-check",
            options=[{"label": "Open hole in popup viewer", "value": "popup"}],
            value=["popup"] if open_in_popup else [],
            className="checklist",
        ),
    ]
    return panel, "sidebar sidebar-map", "main-content map-main"


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=8050)
