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


def load_demo_dataset(collars_csv, survey_csv, assays_csv):
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
    surveys = baselode.drill.data.load_surveys(
        survey_csv, 
        kind="csv"
    )
    assays = baselode.drill.data.load_assays(
        assays_csv, 
        kind="csv"
    )

    # Drop geometry column for simpler DataFrame handling
    collars = collars.drop(columns=["geometry"], errors="ignore")
    
    # Clean string columns
    for frame in [collars, surveys, assays]:
        if "hole_id" in frame.columns:
            frame["hole_id"] = frame["hole_id"].astype(str).str.strip()

    # Desurvey to create 3D traces
    traces = baselode.drill.desurvey.minimum_curvature_desurvey(collars, surveys, step=5.0)
    
    # Attach spatial positions to assays for 3D visualization
    assays_with_positions = baselode.drill.desurvey.attach_assay_positions(assays, traces)

    return {
        "collars": collars,
        "surveys": surveys,
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
    fig.update_layout(height=420, template="plotly_white", margin=dict(l=45, r=10, t=20, b=30))
    return fig


# Initialize app with demo data
DATASET = load_demo_dataset(COLLARS_CSV, SURVEY_CSV, ASSAYS_CSV)
PROPERTY_INFO = infer_property_lists(DATASET["assays"])
DEFAULT_PROPERTY = (PROPERTY_INFO["numeric"] + PROPERTY_INFO["categorical"] + [""])[0]

app = Dash(__name__, suppress_callback_exceptions=True, title="Baselode Dash Viewer")


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
                html.H2("Baselode Viewer", className="sidebar-title"),
                sidebar_link("Map", "/"),
                sidebar_link("Drillhole", "/drillhole"),
                sidebar_link("Drillhole 2D", "/drillhole-2d"),
                html.Div(id="sidebar-panel", className="sidebar-panel"),
                html.Div(id="sidebar-zoom", className="sidebar-footer"),
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
        hole_count = len(DATASET["traces"]["hole_id"].unique()) if not DATASET["traces"].empty else 0
        return html.Div(
            className="page",
            children=[
                html.Div(
                    className="page-header",
                    children=[
                        html.H1("Drillhole Viewer (3D)"),
                        html.Div(f"{hole_count} desurveyed drillholes available from Python preprocessing", className="meta"),
                    ],
                ),
                html.Div(
                    className="card",
                    children=[
                        html.Label("JS viewer URL", className="label"),
                        dcc.Input(id="js-3d-url", type="text", value="http://localhost:3000/drillhole", className="text-input"),
                        html.Div("The 3D window is intentionally provided by JavaScript Baselode for parity.", className="meta"),
                        html.Iframe(id="drillhole-3d-iframe", src="http://localhost:3000/drillhole", className="viewer-iframe"),
                    ],
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
                        html.Div("Data source: demo_gswa_sample_assays.csv", className="meta"),
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
                    dcc.Graph(id="popup-graph"),
                    html.Button("Open page", id="popup-open-page", n_clicks=0, className="btn"),
                ],
            ),
        ],
    )


@app.callback(
    Output("drillhole-3d-iframe", "src"),
    Input("js-3d-url", "value"),
    prevent_initial_call=True,
)
def update_iframe_src(url):
    """Update 3D iframe source URL."""
    if not url:
        return no_update
    return url


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


@app.callback(Output("sidebar-zoom", "children"), Input("url", "pathname"))
def update_sidebar_footer(pathname):
    """Display current page in sidebar footer."""
    return f"Page: {pathname or '/'}"


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

    collars = DATASET["collars"]
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
        html.Div("Data source: demo_gswa_sample_collars.csv + demo_gswa_sample_assays.csv", className="meta"),
        html.Div(f"Loaded {len(collars)} collars", className="meta"),
    ]
    return panel, "sidebar sidebar-map", "main-content map-main"


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=8050)
