# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

# This file is part of baselode.

# baselode is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

# baselode is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.

# You should have received a copy of the GNU General Public License
# along with baselode.  If not, see <https://www.gnu.org/licenses/>.

"""Assay interval visualization helpers (Plotly) akin to the Drillhole 2D viewer.

Functions here mirror the JS behavior: numeric assays plot at interval mid-depths
with asymmetric error bars spanning from/to, while categorical assays render
banded rectangles. All plots keep depth increasing downward.

"""

import math

import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots


def _first_present(row, candidates):
    for key in candidates:
        if key in row and row[key] not in (None, ""):
            return row[key]
    return None


def compute_interval_points(df,
    value_col,
    from_cols=("samp_from", "sample_from", "from", "depth_from", "SampFrom", "FromDepth", "mid_md"),
    to_cols=("samp_to", "sample_to", "to", "depth_to", "SampTo", "ToDepth", "mid_md"),
    drop_null_values=True):
    """Convert assay rows into midpoint-based interval points.

    Returns a pandas DataFrame with columns:
    - z (mid-depth)
    - val (value or category)
    - from_val, to_val
    - err_plus, err_minus (for asymmetric error bars)

    Rows with invalid from/to or missing values are dropped.
    """

    records = []
    seen = set()

    for _, row in df.iterrows():
        f = _first_present(row, from_cols)
        t = _first_present(row, to_cols)
        val = row.get(value_col)
        if f is None or t is None:
            continue
        try:
            f_num = float(f)
            t_num = float(t)
        except (TypeError, ValueError):
            continue
        if not (t_num > f_num):
            continue
        if drop_null_values and (val is None or (isinstance(val, str) and val.strip() == "")):
            continue
        key = (value_col, f_num, t_num)
        if key in seen:
            continue
        seen.add(key)
        mid = 0.5 * (f_num + t_num)
        try:
            val_num = float(val)
        except (TypeError, ValueError):
            val_num = val
        records.append(
            {
                "z": mid,
                "val": val_num,
                "from_val": f_num,
                "to_val": t_num,
                "err_plus": t_num - mid,
                "err_minus": mid - f_num,
            }
        )

    if not records:
        return pd.DataFrame(columns=["z", "val", "from_val", "to_val", "err_plus", "err_minus"])

    out = pd.DataFrame.from_records(records)
    return out.sort_values("z", ascending=False).reset_index(drop=True)


def plot_numeric_trace(interval_df, value_col, chart_type="markers+line", color="#8b1e3f"):
    """Plot numeric assay intervals with mid-depth markers and optional error bars.

    chart_type options:
    - "bar": horizontal bars
    - "markers": markers with error bars
    - "markers+line": markers + line with error bars (default)
    - "line": line only (no error bars)

    Returns a plotly.graph_objects.Figure.
    """
    if interval_df.empty:
        return go.Figure()

    is_bar = chart_type == "bar"
    is_markers = chart_type == "markers"
    is_line_only = chart_type == "line"

    error_config = dict(
        type="data",
        symmetric=False,
        array=interval_df["err_plus"],
        arrayminus=interval_df["err_minus"],
        thickness=1.5,
        width=2,
        color="#6b7280",
    )

    trace_common = dict(
        x=interval_df["val"],
        y=interval_df["z"],
        customdata=interval_df[["from_val", "to_val"]],
        hovertemplate=f"{value_col}: %{{x}}<br>from: %{{customdata[0]}} to: %{{customdata[1]}}<extra></extra>",
    )

    if is_bar:
        trace = go.Bar(
            orientation="h",
            marker=dict(color=color),
            error_y=error_config,
            **trace_common,
        )
    else:
        scatter_mode = "lines" if is_line_only else ("markers" if is_markers else "lines+markers")
        trace = go.Scatter(
            mode=scatter_mode,
            line=dict(color=color, width=2),
            marker=dict(size=7, color="#a8324f"),
            error_y=None if is_line_only else error_config,
            **trace_common,
        )

    layout = go.Layout(
        height=260,
        margin=dict(l=50, r=10, t=10, b=30),
        xaxis=dict(title=value_col, zeroline=False),
        yaxis=dict(title="Depth (m)", autorange="reversed", zeroline=False),
        showlegend=False,
    )

    fig = go.Figure(data=[trace], layout=layout)
    return fig


def plot_categorical_trace(interval_df, value_col, palette=None):
    """Plot categorical assay intervals as colored bands with labels.

    Returns a plotly.graph_objects.Figure.
    """
    if interval_df.empty:
        return go.Figure()

    palette = palette or [
        "#8b1e3f",
        "#a8324f",
        "#b84c68",
        "#d16587",
        "#e07ba0",
        "#f091b6",
        "#f7a7c8",
        "#fbcfe8",
    ]

    segments = []
    sorted_df = interval_df.sort_values("z", ascending=False)
    for idx, row in sorted_df.iterrows():
        y0 = row["z"]
        next_row = sorted_df.iloc[idx + 1] if idx + 1 < len(sorted_df) else None
        y1 = next_row["z"] if next_row is not None else row["z"] - 20
        if y1 == y0:
            continue
        segments.append((y0, y1, str(row["val"])) )

    shapes = []
    text_y = []
    text_label = []
    for i, (y0, y1, category) in enumerate(segments):
        shapes.append(
            dict(
                type="rect",
                xref="x",
                yref="y",
                x0=0,
                x1=1,
                y0=y0,
                y1=y1,
                fillcolor=palette[i % len(palette)],
                line=dict(width=0),
            )
        )
        text_y.append(0.5 * (y0 + y1))
        text_label.append(category)

    text_trace = go.Scatter(
        x=[0.5] * len(text_y),
        y=text_y,
        mode="text",
        text=text_label,
        textposition="middle center",
        showlegend=False,
        hoverinfo="text",
        customdata=segments,
        hovertemplate="Category: %{text}<br>from: %{customdata[0]} to %{customdata[1]}<extra></extra>",
    )

    layout = go.Layout(
        height=260,
        margin=dict(l=50, r=10, t=10, b=30),
        xaxis=dict(range=[0, 1], visible=False, fixedrange=True),
        yaxis=dict(title="Depth (m)", autorange="reversed", zeroline=False),
        shapes=shapes,
        showlegend=False,
    )

    fig = go.Figure(data=[text_trace], layout=layout)
    return fig


def plot_drillhole_trace(df,
    value_col,
    chart_type=None,
    categorical_props=None,
    numeric_chart="markers+line",
    color="#8b1e3f",
    use_mid=False):
    """
    Plot a 2D downhole trace or strip log for a single drillhole, for a single varaible.

    chart_type: override to one of {"categorical", "bar", "markers", "markers+line", "line"}.
    If omitted, we infer categorical if value_col in categorical_props, else numeric_chart.
    """
    categorical_props = set(categorical_props or [])
    is_cat = value_col in categorical_props
    resolved_chart = chart_type or ("categorical" if is_cat else numeric_chart)

    if use_mid:
        if "mid_md" not in df.columns:
            return go.Figure()
        tmp = df[["mid_md", value_col]].copy()
        tmp = tmp.dropna(subset=["mid_md", value_col])
        interval_df = pd.DataFrame({
            "z": tmp["mid_md"],
            "val": tmp[value_col],
            "from_val": tmp["mid_md"],
            "to_val": tmp["mid_md"],
            "err_plus": 0,
            "err_minus": 0,
        }).sort_values("z", ascending=False)
    else:
        interval_df = compute_interval_points(df, value_col)
    if is_cat or resolved_chart == "categorical":
        return plot_categorical_trace(interval_df, value_col)
    return plot_numeric_trace(interval_df, value_col, chart_type=resolved_chart, color=color)


def combine_trace_configs(configs, df, categorical_props=None):
    """Build figures for multiple trace configs.

    configs: iterable of dicts with keys hole_id, value_col, chart_type (optional).
    Returns list of plotly Figure objects (len = len(configs)).
    """
    figs = []
    for cfg in configs:
        hole_id = cfg.get("hole_id") or cfg.get("holeId")
        value_col = cfg.get("value_col") or cfg.get("property")
        chart_type = cfg.get("chart_type") or cfg.get("chartType")
        figs.append(
            plot_drillhole_trace(
                df=df,
                hole_id=hole_id,
                value_col=value_col,
                chart_type=chart_type,
                categorical_props=categorical_props,
            )
        )
    return figs


def plot_drillhole_traces_subplots(df,
    value_col,
    hole_id_col="hole_id",
    hole_ids=None,
    chart_type="markers+line",
    categorical_props=None,
    colors=None,
    use_mid=False,
    height=400,
    width_per=220):
    """Plot multiple drillhole traces side-by-side with shared depth axis.

    Only numeric traces are handled; categorical props will still render as numeric markers/lines.
    """
    categorical_props = set(categorical_props or [])
    hole_ids = list(hole_ids) if hole_ids is not None else sorted(df[hole_id_col].unique())
    if not hole_ids:
        return go.Figure()
    colors = colors or ["#8b1e3f", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#0ea5e9", "#ef4444"]

    fig = make_subplots(rows=1, cols=len(hole_ids), shared_yaxes=True, horizontal_spacing=0.02)
    for idx, hid in enumerate(hole_ids):
        subset = df[df[hole_id_col] == hid]
        resolved_chart = "categorical" if value_col in categorical_props else chart_type
        if use_mid:
            if "mid_md" not in subset.columns:
                continue
            tmp = subset[["mid_md", value_col]].dropna(subset=["mid_md", value_col])
            interval_df = pd.DataFrame({
                "z": tmp["mid_md"],
                "val": tmp[value_col],
                "from_val": tmp["mid_md"],
                "to_val": tmp["mid_md"],
                "err_plus": 0,
                "err_minus": 0,
            }).sort_values("z", ascending=False)
        else:
            interval_df = compute_interval_points(subset, value_col)
        if interval_df.empty:
            continue
        trace = plot_numeric_trace(interval_df, value_col, chart_type=resolved_chart, color=colors[idx % len(colors)]).data[0]
        fig.add_trace(trace, row=1, col=idx + 1)
        fig.update_xaxes(title_text=str(hid), row=1, col=idx + 1)

    fig.update_yaxes(title_text="Depth (m)", autorange="reversed")
    fig.update_layout(height=height, width=width_per * len(hole_ids), showlegend=False, margin=dict(l=40, r=10, t=10, b=40))
    return fig


def plot_drillhole_traces(df,
    hole_id_col="hole_id",
    hole_id=None,
    value_cols=None,
    chart_type="markers+line",
    categorical_props=None,
    colors=None,
    use_mid=False,
    height=400,
    width_per=220):
    """Plot multiple tracks for a single hole side-by-side with shared depth axis."""
    categorical_props = set(categorical_props or [])
    if hole_id is None:
        raise ValueError("hole_id is required")
    value_cols = list(value_cols or [])
    if not value_cols:
        raise ValueError("value_cols must be provided")
    colors = colors or ["#8b1e3f", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#0ea5e9", "#ef4444"]

    subset = df[df[hole_id_col] == hole_id]
    if subset.empty:
        return go.Figure()

    fig = make_subplots(rows=1, cols=len(value_cols), shared_yaxes=True, horizontal_spacing=0.02)
    for idx, col in enumerate(value_cols):
        resolved_chart = "categorical" if col in categorical_props else chart_type
        if use_mid:
            if "mid_md" not in subset.columns:
                continue
            tmp = subset[["mid_md", col]].dropna(subset=["mid_md", col])
            interval_df = pd.DataFrame({
                "z": tmp["mid_md"],
                "val": tmp[col],
                "from_val": tmp["mid_md"],
                "to_val": tmp["mid_md"],
                "err_plus": 0,
                "err_minus": 0,
            }).sort_values("z", ascending=False)
        else:
            interval_df = compute_interval_points(subset, col)
        if interval_df.empty:
            continue
        trace = plot_numeric_trace(interval_df, col, chart_type=resolved_chart, color=colors[idx % len(colors)]).data[0]
        fig.add_trace(trace, row=1, col=idx + 1)
        fig.update_xaxes(title_text=str(col), row=1, col=idx + 1)

    fig.update_yaxes(title_text="Depth (m)", autorange="reversed")
    fig.update_layout(height=height, width=width_per * len(value_cols), showlegend=False, margin=dict(l=40, r=10, t=10, b=40))
    return fig


def plot_strip_log(df,
    from_col="from",
    to_col="to",
    label_col="lithology",
    palette=None,
    height=400,
    width=220):
    """Render a simple strip log (categorical intervals) as colored bands."""
    if df.empty:
        return go.Figure()
    palette = palette or [
        "#1f77b4",
        "#2ca02c",
        "#d62728",
        "#9467bd",
        "#8c564b",
        "#e377c2",
        "#7f7f7f",
        "#bcbd22",
    ]
    records = []
    for _, row in df.iterrows():
        try:
            f = float(row[from_col])
            t = float(row[to_col])
        except (TypeError, ValueError, KeyError):
            continue
        if t <= f:
            continue
        records.append((f, t, str(row.get(label_col, ""))))
    if not records:
        return go.Figure()
    records = sorted(records, key=lambda r: r[0], reverse=True)
    shapes = []
    texts = []
    y_text = []
    for idx, (f, t, label) in enumerate(records):
        shapes.append(dict(type="rect", xref="x", yref="y", x0=0, x1=1, y0=f, y1=t, fillcolor=palette[idx % len(palette)], line=dict(width=0)))
        y_text.append(0.5 * (f + t))
        texts.append(label)

    text_trace = go.Scatter(
        x=[0.5] * len(texts),
        y=y_text,
        mode="text",
        text=texts,
        textposition="middle center",
        showlegend=False,
        hoverinfo="text",
    )
    fig = go.Figure(data=[text_trace])
    fig.update_layout(
        height=height,
        width=width,
        margin=dict(l=40, r=10, t=10, b=40),
        xaxis=dict(range=[0, 1], visible=False, fixedrange=True),
        yaxis=dict(title="Depth (m)", autorange="reversed"),
        shapes=shapes,
        showlegend=False,
    )
    return fig


def plot_tadpole_log(df,
    md_col="md",
    dip_col="dip",
    az_col="azimuth",
    size_col=None,
    tail_scale=0.2,
    height=400,
    width=220):
    """Plot a tadpole log for structural measurements.

    Each measurement renders a circle at the measured depth with a "tail" pointing
    toward the dip direction. Tail length scales with dip magnitude and tail_scale.
    """
    if df.empty or md_col not in df.columns or dip_col not in df.columns or az_col not in df.columns:
        return go.Figure()

    safe = df[[md_col, dip_col, az_col] + ([size_col] if size_col else [])].dropna(subset=[md_col, dip_col, az_col])
    if safe.empty:
        return go.Figure()

    base_x = 0.0
    xs = []
    ys = []
    sizes = []
    tail_x0 = []
    tail_y0 = []
    tail_x1 = []
    tail_y1 = []

    for _, row in safe.iterrows():
        depth = float(row[md_col])
        dip = float(row[dip_col])
        az = float(row[az_col])
        size = float(row[size_col]) if size_col and not pd.isna(row[size_col]) else 8.0
        xs.append(base_x)
        ys.append(depth)
        sizes.append(size)
        az_rad = math.radians(az)
        length = tail_scale * (abs(dip) / 90.0)
        dx = math.sin(az_rad) * length
        dy = math.cos(az_rad) * length
        tail_x0.append(base_x)
        tail_y0.append(depth)
        tail_x1.append(base_x + dx)
        tail_y1.append(depth + dy)

    head_trace = go.Scatter(
        x=xs,
        y=ys,
        mode="markers",
        marker=dict(size=sizes, color="#0f172a"),
        showlegend=False,
        hovertemplate="Depth: %{y}<br>Dip: %{customdata[0]}<br>Az: %{customdata[1]}<extra></extra>",
        customdata=list(zip(safe[dip_col], safe[az_col])),
    )

    fig = go.Figure(data=[head_trace])
    for x0, y0, x1, y1 in zip(tail_x0, tail_y0, tail_x1, tail_y1):
        fig.add_shape(type="line", x0=x0, y0=y0, x1=x1, y1=y1, line=dict(color="#0f172a", width=2))

    fig.update_layout(
        height=height,
        width=width,
        margin=dict(l=40, r=10, t=10, b=40),
        xaxis=dict(range=[-0.5, 0.5], visible=False, fixedrange=True),
        yaxis=dict(title="Depth (m)", autorange="reversed"),
        showlegend=False,
    )
    return fig
