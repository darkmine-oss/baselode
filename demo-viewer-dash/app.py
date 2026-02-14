# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

from pathlib import Path

from dash import Dash, dcc, html, Input, Output, State, callback_context, no_update
import numpy as np
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

DEFAULT_CONFIG = {"primary_key": "companyHoleId", "custom_key": ""}
KEY_MAP = {
    "companyHoleId": "company_hole_id",
    "holeId": "hole_id",
    "collarId": "collar_id",
    "anumber": "anumber",
}
ASSAY_NON_VALUE_FIELDS = {
    "hole_id",
    "company_hole_id",
    "collar_id",
    "project_id",
    "project_code",
    "from",
    "to",
    "mid_md",
    "x",
    "y",
    "z",
    "lat",
    "lon",
    "longitude",
    "latitude",
    "azimuth",
    "dip",
    "declination",
    "sample_id",
    "id",
    "anumber",
}
CHART_TYPES = ["markers+line", "markers", "line", "bar", "categorical"]


def detect_table_key(table_df, preferred_keys):
    for key in preferred_keys:
        if key in table_df.columns:
            return key
    return ""


def detect_shared_join_key(collars_df, surveys_df, assays_df):
    preferred = ["company_hole_id", "hole_id", "collar_id", "anumber"]
    for key in preferred:
        if key in collars_df.columns and key in surveys_df.columns:
            return key

    fallback = detect_table_key(collars_df, preferred)
    if fallback:
        return fallback

    raise ValueError(
        f"No compatible drillhole key found. Collars columns: {list(collars_df.columns)}; "
        f"Survey columns: {list(surveys_df.columns)}; Assay columns: {list(assays_df.columns)}"
    )


def load_demo_dataset(collars_csv, survey_csv, assays_csv):
    collars_raw = baselode.drill.data.load_table(collars_csv, kind="csv")
    surveys_raw = baselode.drill.data.load_table(survey_csv, kind="csv")
    assays_raw = baselode.drill.data.load_table(assays_csv, kind="csv")

    shared_key = detect_shared_join_key(collars_raw, surveys_raw, assays_raw)
    assay_key = detect_table_key(assays_raw, [shared_key, "company_hole_id", "hole_id", "collar_id", "anumber"])
    if not assay_key:
        assay_key = "hole_id"

    collars = baselode.drill.data.load_collars(collars_csv, kind="csv", hole_id_col=shared_key)
    surveys = baselode.drill.data.load_surveys(survey_csv, kind="csv", hole_id_col=shared_key)
    assays = baselode.drill.data.load_assays(assays_csv, kind="csv", hole_id_col=assay_key)

    collars = collars.drop(columns=["geometry"], errors="ignore")
    collars = collars.copy()
    surveys = surveys.copy()
    assays = assays.copy()

    for frame in [collars, surveys, assays]:
        for col in ["hole_id", "company_hole_id", "collar_id", "anumber", "project_code"]:
            if col in frame.columns:
                frame[col] = frame[col].astype(str).str.strip()

    traces = baselode.drill.desurvey.minimum_curvature_desurvey(collars, surveys, step=5.0)

    return {
        "collars": collars,
        "surveys": surveys,
        "assays": assays,
        "traces": traces,
        "shared_key": shared_key,
        "assay_key": assay_key,
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


def primary_field_from_config(config):
    config = config or DEFAULT_CONFIG
    key = config.get("primary_key", "companyHoleId")
    if key == "custom":
        custom = (config.get("custom_key") or "").strip().lower()
        return custom or "company_hole_id"
    return KEY_MAP.get(key, "company_hole_id")


def with_primary_id(df, config):
    if df is None or df.empty:
        out = df.copy()
        out["primary_id"] = ""
        return out

    primary_field = primary_field_from_config(config)
    out = df.copy()

    if primary_field not in out.columns:
        out[primary_field] = ""

    candidates = [
        primary_field,
        "company_hole_id",
        "hole_id",
        "collar_id",
        "anumber",
    ]
    available = [c for c in candidates if c in out.columns]

    out["primary_id"] = ""
    for col in available:
        values = out[col].fillna("").astype(str).str.strip()
        out["primary_id"] = np.where((out["primary_id"] == "") & (values != ""), values, out["primary_id"])

    return out


def build_map_figure(collars_df, search_value):
    frame = collars_df.copy()
    if search_value:
        q = str(search_value).strip().lower()
        frame = frame[frame["primary_id"].str.lower().str.contains(q, na=False)]

    if frame.empty:
        fig = go.Figure()
        fig.update_layout(template="plotly_white", margin=dict(l=10, r=10, t=20, b=10), height=640)
        fig.add_annotation(text="No matching collars", showarrow=False, x=0.5, y=0.5, xref="paper", yref="paper")
        return fig

    lat_col = "lat" if "lat" in frame.columns else "y"
    lon_col = "lon" if "lon" in frame.columns else "x"
    hover_candidates = ["project_code", "project_id", "hole_id", "company_hole_id", "collar_id", "anumber"]
    hover_data = {col: True for col in hover_candidates if col in frame.columns}

    fig = px.scatter_map(
        frame,
        lat=lat_col,
        lon=lon_col,
        hover_name="primary_id",
        hover_data=hover_data,
        zoom=5,
        height=640,
    )
    fig.update_traces(marker=dict(size=8, color="#8b1e3f", opacity=0.85))
    fig.update_layout(map_style="open-street-map", margin=dict(l=10, r=10, t=10, b=10))
    return fig


def hole_options(assays_df, config):
    frame = with_primary_id(assays_df, config)
    vals = sorted([v for v in frame["primary_id"].dropna().astype(str).unique().tolist() if v])
    return [{"label": v, "value": v} for v in vals]


def build_trace_figure(
    assays_df,
    selected_hole,
    selected_property,
    chart_type,
    categorical_props,
):
    if not selected_hole or not selected_property:
        fig = go.Figure()
        fig.update_layout(template="plotly_white", margin=dict(l=40, r=10, t=20, b=30), height=280)
        return fig

    subset = assays_df[assays_df["primary_id"] == selected_hole].copy()
    if subset.empty or selected_property not in subset.columns:
        fig = go.Figure()
        fig.update_layout(template="plotly_white", margin=dict(l=40, r=10, t=20, b=30), height=280)
        return fig

    is_cat = selected_property in categorical_props
    resolved_type = "categorical" if (is_cat and chart_type != "bar") else chart_type
    fig = baselode.drill.view.plot_drillhole_trace(
        df=subset,
        value_col=selected_property,
        chart_type=resolved_type,
        categorical_props=categorical_props,
    )
    fig.update_layout(height=620, template="plotly_white")
    return fig


def build_popup_figure(assays_df, selected_hole, selected_property, categorical_props):
    if not selected_hole or not selected_property:
        return go.Figure()
    subset = assays_df[assays_df["primary_id"] == selected_hole].copy()
    if subset.empty:
        return go.Figure()
    chart = "line"
    fig = baselode.drill.view.plot_drillhole_trace(
        df=subset,
        value_col=selected_property,
        chart_type=chart,
        categorical_props=[],
    )
    fig.update_layout(height=420, template="plotly_white", margin=dict(l=45, r=10, t=20, b=30))
    return fig


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
        dcc.Store(id="config-store", storage_type="local", data=DEFAULT_CONFIG),
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
                sidebar_link("Config", "/config"),
                html.Div(id="sidebar-panel", className="sidebar-panel"),
                html.Div(id="sidebar-zoom", className="sidebar-footer"),
            ],
        ),
        html.Main(id="main-content", className="main-content", children=[
            html.Div(id="page-content")
        ]),
    ],
)


@app.callback(Output("page-content", "children"), Input("url", "pathname"), State("config-store", "data"), State("selected-hole-store", "data"))
def render_page(pathname, config, selected_hole):
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
        options_holes = hole_options(DATASET["assays"], config)
        first_hole = selected_hole or (options_holes[0]["value"] if options_holes else "")
        property_options = [{"label": p, "value": p} for p in PROPERTY_INFO["all"]]
        assays_with_primary = with_primary_id(DATASET["assays"], config)
        initial_chart = "markers+line"
        initial_figure = build_trace_figure(
            assays_with_primary,
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

    if pathname == "/config":
        cfg = config or DEFAULT_CONFIG
        return html.Div(
            className="page",
            children=[
                html.Div(className="page-header", children=[html.H1("Drillhole Key Config")]),
                html.Div(
                    className="card",
                    children=[
                        html.Label("Primary key", className="label"),
                        dcc.Dropdown(
                            id="config-primary-key",
                            options=[
                                {"label": "CompanyHoleId (default)", "value": "companyHoleId"},
                                {"label": "HoleId", "value": "holeId"},
                                {"label": "CollarId", "value": "collarId"},
                                {"label": "Anumber", "value": "anumber"},
                                {"label": "Custom", "value": "custom"},
                            ],
                            value=cfg.get("primary_key", "companyHoleId"),
                        ),
                        html.Label("Custom column name", className="label"),
                        dcc.Input(
                            id="config-custom-key",
                            type="text",
                            value=cfg.get("custom_key", ""),
                            placeholder="e.g. collar_uid",
                            className="text-input",
                        ),
                        html.Button("Save", id="config-save", n_clicks=0, className="btn"),
                        html.Div(id="config-status", className="meta"),
                    ],
                ),
            ],
        )

    cfg = config or DEFAULT_CONFIG
    collars = with_primary_id(DATASET["collars"], cfg)
    primary_label = primary_field_from_config(cfg)

    return html.Div(
        className="page map-page",
        children=[
            dcc.Graph(
                id="collar-map",
                figure=build_map_figure(collars, ""),
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
    if not url:
        return no_update
    return url


@app.callback(
    Output("config-store", "data"),
    Output("config-status", "children"),
    Input("config-save", "n_clicks"),
    State("config-primary-key", "value"),
    State("config-custom-key", "value"),
    prevent_initial_call=True,
)
def save_config(n_clicks, primary_key, custom_key):
    if primary_key == "custom" and not (custom_key or "").strip():
        return no_update, "Enter a custom column name."
    config = {"primary_key": primary_key or "companyHoleId", "custom_key": (custom_key or "").strip()}
    return config, "Saved. This will be used across map and drillhole viewers."


@app.callback(
    Output("open-mode-store", "data"),
    Input("open-mode-check", "value"),
    prevent_initial_call=True,
)
def update_open_mode(values):
    return {"open_in_popup": "popup" in (values or [])}


@app.callback(
    Output("collar-map", "figure"),
    Input("map-search", "value"),
    State("config-store", "data"),
)
def update_map(search_value, config):
    collars = with_primary_id(DATASET["collars"], config)
    return build_map_figure(collars, search_value)


@app.callback(
    Output("popup-hole-store", "data"),
    Output("selected-hole-store", "data"),
    Output("url", "pathname", allow_duplicate=True),
    Input("collar-map", "clickData"),
    Input("popup-close", "n_clicks"),
    Input("popup-open-page", "n_clicks"),
    State("open-mode-store", "data"),
    State("config-store", "data"),
    State("popup-hole-store", "data"),
    prevent_initial_call=True,
)
def handle_map_click_or_popup(click_data, close_clicks, open_page_clicks, open_mode, config, popup_hole):
    trigger = callback_context.triggered[0]["prop_id"].split(".")[0]

    if trigger == "popup-close":
        return "", no_update, no_update

    if trigger == "popup-open-page":
        if popup_hole:
            return "", popup_hole, "/drillhole-2d"
        return no_update, no_update, no_update

    if trigger != "collar-map" or not click_data:
        return no_update, no_update, no_update

    point = (click_data.get("points") or [{}])[0]
    lat = point.get("lat")
    lon = point.get("lon")
    if lat is None or lon is None:
        return no_update, no_update, no_update

    collars = with_primary_id(DATASET["collars"], config)
    dlat = (collars["lat"] - float(lat)).abs() if "lat" in collars.columns else (collars["y"] - float(lat)).abs()
    dlon = (collars["lon"] - float(lon)).abs() if "lon" in collars.columns else (collars["x"] - float(lon)).abs()
    nearest = collars.loc[(dlat + dlon).idxmin()]
    hole_id = nearest.get("primary_id", "")
    if not hole_id:
        return no_update, no_update, no_update

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
    Input("config-store", "data"),
)
def update_popup(hole_id, selected_property, config):
    if not hole_id:
        return "popup hidden", "", go.Figure()
    assays = with_primary_id(DATASET["assays"], config)
    default_numeric = PROPERTY_INFO["numeric"][0] if PROPERTY_INFO["numeric"] else ""
    prop = selected_property or default_numeric
    fig = build_popup_figure(assays, hole_id, prop, PROPERTY_INFO["categorical"])
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
    Input("config-store", "data"),
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
    config,
):
    assays = with_primary_id(DATASET["assays"], config)
    figs = [
        build_trace_figure(assays, hole0, prop0, chart0, PROPERTY_INFO["categorical"]),
        build_trace_figure(assays, hole1, prop1, chart1, PROPERTY_INFO["categorical"]),
        build_trace_figure(assays, hole2, prop2, chart2, PROPERTY_INFO["categorical"]),
        build_trace_figure(assays, hole3, prop3, chart3, PROPERTY_INFO["categorical"]),
    ]
    return figs[0], figs[1], figs[2], figs[3]


@app.callback(Output("sidebar-zoom", "children"), Input("url", "pathname"))
def update_sidebar_footer(pathname):
    return f"Page: {pathname or '/'}"


@app.callback(
    Output("sidebar-panel", "children"),
    Output("sidebar", "className"),
    Output("main-content", "className"),
    Input("url", "pathname"),
    Input("config-store", "data"),
    Input("open-mode-store", "data"),
)
def update_sidebar_panel(pathname, config, open_mode):
    if pathname != "/":
        return [], "sidebar", "main-content content-main"

    cfg = config or DEFAULT_CONFIG
    collars = with_primary_id(DATASET["collars"], cfg)
    primary_label = primary_field_from_config(cfg)
    open_in_popup = bool((open_mode or {}).get("open_in_popup", True))

    panel = [
        html.Div("Map Controls", className="controls-title"),
        dcc.Input(id="map-search", type="text", placeholder=f"Search {primary_label}", className="text-input"),
        dcc.Checklist(
            id="open-mode-check",
            options=[{"label": "Open hole in popup viewer", "value": "popup"}],
            value=["popup"] if open_in_popup else [],
            className="checklist",
        ),
        html.Div(f"Primary key: {primary_label}", className="meta"),
        html.Div("Data source: demo_gswa_sample_collars.csv + demo_gswa_sample_assays.csv", className="meta"),
        html.Div(f"Loaded {len(collars)} collars", className="meta"),
    ]
    return panel, "sidebar sidebar-map", "main-content map-main"


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=8050)
