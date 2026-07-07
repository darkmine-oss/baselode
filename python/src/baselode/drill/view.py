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

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots

from baselode.datamodel import MID, AZIMUTH, DIP, HOLE_ID, DEPTH, COMMENTS, NORTHING, EASTING, FROM, TO
from baselode.colours import (
    get_colour,
    get_pattern,
    resolve_colour_map,
    resolve_pattern_map,
    commodity_colour_for_property,
    ASSAY_COLOR_PALETTE_10,
    MULTI_SERIES_COLORWAY,
    build_plotly_colorscale,
    series_colour,
    with_alpha,
)
from baselode.drill.columns import GRADED_COLOR_BY
from baselode.template import BASELODE_TEMPLATE_NAME


STRIPLOG_COMPACT_MARGIN = dict(l=4, r=4, t=4, b=4)
STRIPLOG_AXIS_TICK_FONT_SIZE = 10
STRIPLOG_AXIS_TITLE_FONT_SIZE = 12

# Chart types whose value axis may meaningfully switch to a log scale.
# ``log_scale`` is silently ignored for every other chart type.
LOG_SCALE_CHART_TYPES = {"bar", "markers", "markers+line", "line", "filled-line", "step-line"}


def _first_present(row, candidates):
    for key in candidates:
        if key in row and row[key] not in (None, ""):
            return row[key]
    return None


def _apply_striplog_defaults(fig, template=None):
    """Apply compact strip-log layout defaults and the Baselode template.

    The ``template`` argument defaults to the Baselode template. Pass a
    different Plotly template name or object to override the visual style.
    """
    updates = dict(
        template=template if template is not None else BASELODE_TEMPLATE_NAME,
        autosize=True,
        height=None,
        width=None,
        # Strip logs read down-hole, so hover horizontally along depth: a spike
        # line at the hovered depth and a single unified box listing every
        # trace's value there. Depth is the shared Y axis, hence unify on Y.
        hovermode="y unified",
    )
    # Respect an explicit margin (e.g. a widened right gutter for a colour bar);
    # otherwise fall back to the compact strip-log default. Only pass `margin`
    # when unset — `update_layout(margin=None)` would clear an existing one.
    margin = fig.layout.margin
    if not any(v is not None for v in (margin.l, margin.r, margin.t, margin.b)):
        updates["margin"] = STRIPLOG_COMPACT_MARGIN
    fig.update_layout(**updates)
    fig.update_xaxes(
        tickfont=dict(size=STRIPLOG_AXIS_TICK_FONT_SIZE),
        title_font=dict(size=STRIPLOG_AXIS_TITLE_FONT_SIZE),
    )
    fig.update_yaxes(
        tickfont=dict(size=STRIPLOG_AXIS_TICK_FONT_SIZE),
        title_font=dict(size=STRIPLOG_AXIS_TITLE_FONT_SIZE),
    )
    return fig


def _empty_striplog_figure(template=None):
    """Empty figure that still carries the resolved template, so a blank track
    renders with the correct theme background instead of Plotly's white."""
    return _apply_striplog_defaults(go.Figure(), template=template)


def _depth_bounds(interval_df):
    """Depth extent of interval points (from/to preferred, mid fallback)."""
    candidates = []
    for column in ("from_val", "to_val", "z"):
        if column in interval_df.columns:
            candidates.append(pd.to_numeric(interval_df[column], errors="coerce"))
    if not candidates:
        return None
    stacked = pd.concat(candidates)
    if stacked.dropna().empty:
        return None
    return float(stacked.min()), float(stacked.max())


def _apply_depth_axis_range(fig, bounds, start_from_zero):
    """Pin the depth axis to an explicit, consistently padded range so every
    chart type over the same data shares the same vertical scale — Plotly's
    autorange pads filled traces, bars and scatters differently, which knocks
    adjacent tracks out of depth alignment. With *start_from_zero* the shallow
    end pins to exactly 0 so every track of a hole can align regardless of
    where its sampling starts. Mirrors the JS applyDepthAxisRange."""
    if bounds is None:
        return fig
    min_depth, max_depth = bounds
    pad = max(max_depth - min_depth, 1e-9) * 0.02
    shallow = 0 if start_from_zero else min_depth - pad
    fig.update_yaxes(autorange=False, range=[max_depth + pad, shallow])
    return fig


def compute_interval_points(df,
    value_col,
    from_cols=("samp_from", "sample_from", "from", "depth_from", "SampFrom", "FromDepth", "mid"),
    to_cols=("samp_to", "sample_to", "to", "depth_to", "SampTo", "ToDepth", "mid"),
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
        if drop_null_values:
            if val is None or (isinstance(val, float) and math.isnan(val)):
                continue
            if isinstance(val, str) and val.strip().lower() in ("", "nan", "null", "none"):
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


def _resolve_point_depth_rows(df, value_col):
    """Resolve per-row depths for the point-style chart types (point-log,
    annotations).

    Structural tables already carry a measured DEPTH; desurveyed tables carry
    MID; interval tables carry from/to pairs which are reduced to mid-depths
    via :func:`compute_interval_points` (the same resolution the numeric
    dispatcher path uses).

    Returns a ``(rows, depth_col)`` tuple, or ``(None, None)`` when no depth
    can be resolved.
    """
    if value_col not in df.columns:
        return None, None
    if DEPTH in df.columns:
        return df, DEPTH
    if MID in df.columns:
        return df, MID
    points = compute_interval_points(df, value_col)
    if points.empty:
        return None, None
    return points.rename(columns={"z": DEPTH, "val": value_col}), DEPTH


def _numeric_layout(value_col, extra_xaxis=None):
    """Shared numeric strip-log layout (depth axis reversed, value axis titled)."""
    xaxis = dict(title=value_col, zeroline=False)
    if extra_xaxis:
        xaxis.update(extra_xaxis)
    return go.Layout(
        xaxis=xaxis,
        yaxis=dict(title="Depth (m)", autorange="reversed", zeroline=False),
        barmode="overlay",
        showlegend=False,
    )


def _normalize_segments(segments):
    """Return categorical colour-by segments as a list of ``{from, to, val}`` dicts.

    Accepts a DataFrame (``from_val``/``to_val``/``val`` or ``from``/``to``/``val``)
    or an iterable of dicts. Blank / nan categories and inverted intervals are
    dropped; the result is sorted shallow → deep.
    """
    rows = []
    if isinstance(segments, pd.DataFrame):
        from_col = "from_val" if "from_val" in segments.columns else "from"
        to_col = "to_val" if "to_val" in segments.columns else "to"
        iterable = (
            {"from": r[from_col], "to": r[to_col], "val": r["val"]}
            for _, r in segments.iterrows()
        )
    else:
        iterable = (
            {"from": s.get("from", s.get("from_val")), "to": s.get("to", s.get("to_val")), "val": s.get("val")}
            for s in (segments or [])
        )
    for seg in iterable:
        try:
            f_num = float(seg["from"])
            t_num = float(seg["to"])
        except (TypeError, ValueError):
            continue
        if not (t_num >= f_num):
            continue
        label = str(seg["val"]).strip() if seg["val"] is not None else ""
        if label == "" or label.lower() in ("nan", "null", "none"):
            continue
        rows.append({"from": f_num, "to": t_num, "val": label})
    rows.sort(key=lambda s: s["from"])
    return rows


def assign_categories_by_depth(points_df, segments):
    """Assign each numeric interval point the category covering its mid-depth.

    Parameters
    ----------
    points_df : pd.DataFrame
        Numeric interval points (with ``z`` mid-depth, ``from_val``, ``to_val``).
    segments : pd.DataFrame or list of dict
        Categorical interval rows (e.g. lithology). See :func:`_normalize_segments`.

    Returns
    -------
    list
        Category per point (``None`` where no segment contains the mid-depth),
        index-aligned with *points_df*.
    """
    safe = _normalize_segments(segments)
    categories = []
    for _, point in points_df.iterrows():
        depth = point["z"]
        if depth is None or (isinstance(depth, float) and math.isnan(depth)):
            depth = 0.5 * (point["from_val"] + point["to_val"])
        hit = next((s["val"] for s in safe if s["from"] <= depth <= s["to"]), None)
        categories.append(hit)
    return categories


def _build_graded_line(interval_df, value_col, template, mode="lines+markers"):
    """Graded (value-coloured) markers: a neutral connecting line (unless
    *mode* is markers-only) with markers coloured by the assay value on the
    magma ramp, plus a slim colour bar."""
    vals = interval_df["val"]
    trace = go.Scatter(
        x=vals,
        y=interval_df["z"],
        mode=mode,
        line=dict(color="rgba(136,136,136,0.45)", width=1),
        marker=dict(
            size=8,
            color=vals,
            colorscale=build_plotly_colorscale(ASSAY_COLOR_PALETTE_10),
            cmin=float(vals.min()),
            cmax=float(vals.max()),
            showscale=True,
            colorbar=dict(thickness=8, len=0.92, x=1.02, xanchor="left", tickfont=dict(size=9)),
        ),
        customdata=interval_df[["from_val", "to_val"]],
        hovertemplate=f"{value_col}: %{{x}}<br>from: %{{customdata[0]:.3f}} to: %{{customdata[1]:.3f}}<extra></extra>",
    )
    layout = _numeric_layout(value_col)
    # Widen the right gutter so the colour bar sits outside the plot area.
    layout.margin = dict(l=4, r=30, t=4, b=4)
    fig = go.Figure(data=[trace], layout=layout)
    return _apply_striplog_defaults(fig, template=template)


def _build_step_line(interval_df, value_col, color, template, fill_area=False):
    """Stepped line honouring interval extents: two points per interval at
    (val, from) and (val, to), one polyline shallow → deep. Consecutive
    intervals connect with a vertical jump at the shared boundary; gaps are
    still bridged by the polyline (no nulls inserted). With *fill_area* the
    step becomes area geometry: the area back to zero is shaded and
    below-detection sentinels are floored at 0 (raw value stays in hover)."""
    ordered = interval_df.sort_values("from_val", ascending=True)
    xs = []
    ys = []
    customdata = []
    for _, point in ordered.iterrows():
        plot_val = max(point["val"], 0) if fill_area else point["val"]
        xs.extend([plot_val, plot_val])
        ys.extend([point["from_val"], point["to_val"]])
        customdata.extend([[point["from_val"], point["to_val"], point["val"]]] * 2)
    value_ref = "%{customdata[2]}" if fill_area else "%{x}"
    trace = go.Scatter(
        x=xs,
        y=ys,
        mode="lines",
        line=dict(color=color, width=2),
        fill="tozerox" if fill_area else None,
        fillcolor=with_alpha(color, 0.35) if fill_area else None,
        customdata=customdata,
        hovertemplate=f"{value_col}: {value_ref}<br>from: %{{customdata[0]:.3f}} to: %{{customdata[1]:.3f}}<extra></extra>",
    )
    fig = go.Figure(data=[trace], layout=_numeric_layout(value_col))
    return _apply_striplog_defaults(fig, template=template)


def _build_heat_strip(interval_df, value_col, template):
    """Heat strip: one full-width horizontal bar per interval, coloured by the
    assay value on the magma ramp, with a slim colour bar. The x axis is a
    dummy [0, 1] span — hover reports the value and interval instead."""
    vals = interval_df["val"].astype(float)
    # Floor below-detection sentinels (negative) at 0 for the colour ramp so
    # they read as zero grade instead of dragging cmin below zero and skewing
    # the whole scale; hover keeps the raw value via customdata.
    floored = vals.clip(lower=0)
    trace = go.Bar(
        orientation="h",
        x=[1.0] * len(interval_df),
        base=0,
        y=interval_df["z"],
        width=(interval_df["to_val"] - interval_df["from_val"]).abs().clip(lower=0.01),
        marker=dict(
            color=floored,
            colorscale=build_plotly_colorscale(ASSAY_COLOR_PALETTE_10),
            cmin=float(floored.min()),
            cmax=float(floored.max()),
            showscale=True,
            colorbar=dict(thickness=8, len=0.92, x=1.02, xanchor="left", tickfont=dict(size=9)),
            line=dict(width=0),
        ),
        customdata=interval_df[["val", "from_val", "to_val"]],
        hovertemplate=(
            f"{value_col}: %{{customdata[0]}}<br>"
            f"from: %{{customdata[1]:.3f}} to: %{{customdata[2]:.3f}}<extra></extra>"
        ),
    )
    layout = _numeric_layout(
        value_col,
        extra_xaxis=dict(title=None, range=[0, 1], showticklabels=False, fixedrange=True),
    )
    # Widen the right gutter so the colour bar sits outside the plot area.
    layout.margin = dict(l=4, r=30, t=4, b=4)
    fig = go.Figure(data=[trace], layout=layout)
    return _apply_striplog_defaults(fig, template=template)


def _build_category_coloured_numeric(interval_df, value_col, chart_type, color_by, template):
    """Colour a numeric track by a separate categorical column: one trace per
    category (legend), coloured markers or horizontal bars, with a neutral
    connecting line under line-bearing chart types."""
    categories = assign_categories_by_depth(interval_df, color_by.get("segments"))
    resolved_cmap = resolve_colour_map(color_by.get("colour_map"))
    colour_by_label = color_by.get("label") or color_by.get("property") or "category"
    unique_cats = list(dict.fromkeys(c for c in categories if c is not None))

    def _colour_for(cat, idx):
        if resolved_cmap:
            mapped = get_colour(cat, resolved_cmap, fallback=None)
            if mapped is not None:
                return mapped
        return MULTI_SERIES_COLORWAY[idx % len(MULTI_SERIES_COLORWAY)]

    colour_for_cat = {cat: _colour_for(cat, idx) for idx, cat in enumerate(unique_cats)}
    uncategorised = "#9ca3af"

    is_bar = chart_type == "bar"
    is_line = chart_type == "line"
    froms = interval_df["from_val"].tolist()
    tos = interval_df["to_val"].tolist()
    vals = interval_df["val"].tolist()
    zs = interval_df["z"].tolist()

    def _name(cat):
        return "Uncategorised" if cat is None else cat

    def _colour(cat):
        return uncategorised if cat is None else colour_for_cat[cat]

    hovertemplate = (
        f"{value_col}: %{{x}}<br>{colour_by_label}: %{{customdata[2]}}<br>"
        f"from: %{{customdata[0]:.3f}} to: %{{customdata[1]:.3f}}<extra></extra>"
    )
    all_customdata = [
        [min(froms[i], tos[i]), max(froms[i], tos[i]), c if c is not None else "—"]
        for i, c in enumerate(categories)
    ]

    data = []
    if is_line:
        # "Line only": colour the line itself by category. One segment per
        # consecutive category run (no markers), each bridged to the next point
        # so the downhole line stays continuous across category boundaries.
        seen_legend = set()
        start = 0
        n = len(categories)
        while start < n:
            end = start
            while end + 1 < n and categories[end + 1] == categories[start]:
                end += 1
            run = list(range(start, end + 1))
            if end + 1 < n:
                run.append(end + 1)  # bridge to the next run
            name = _name(categories[start])
            show = name not in seen_legend
            seen_legend.add(name)
            data.append(go.Scatter(
                x=[vals[i] for i in run], y=[zs[i] for i in run],
                mode="lines", line=dict(color=_colour(categories[start]), width=2),
                name=name, legendgroup=name, showlegend=show,
                customdata=[all_customdata[i] for i in run], hovertemplate=hovertemplate,
            ))
            start = end + 1
    else:
        if chart_type == "markers+line":
            # A neutral connecting line keeps the downhole trend readable across
            # category changes (markers+line only; markers/bar draw none).
            data.append(go.Scatter(
                x=vals, y=zs, mode="lines",
                line=dict(color="rgba(136,136,136,0.5)", width=1.5),
                hoverinfo="skip", showlegend=False,
            ))
        for cat in [*unique_cats, None]:
            idxs = [i for i, c in enumerate(categories) if c == cat]
            if not idxs:
                continue
            common = dict(
                x=[vals[i] for i in idxs], y=[zs[i] for i in idxs],
                name=_name(cat), showlegend=True,
                customdata=[all_customdata[i] for i in idxs], hovertemplate=hovertemplate,
            )
            if is_bar:
                data.append(go.Bar(
                    orientation="h",
                    width=[max(abs(tos[i] - froms[i]), 0.01) for i in idxs],
                    marker=dict(color=_colour(cat)), **common,
                ))
            else:
                data.append(go.Scatter(
                    mode="markers", marker=dict(size=8, color=_colour(cat)), **common,
                ))

    layout = _numeric_layout(value_col)
    layout.showlegend = True
    layout.legend = dict(orientation="h", y=1.02, yanchor="bottom", x=0, font=dict(size=9))
    fig = go.Figure(data=data, layout=layout)
    return _apply_striplog_defaults(fig, template=template)


def _apply_log_scale(fig, chart_type, log_scale):
    """Switch the value axis to log when requested and valid for the chart type.

    Values <= 0 are left to Plotly (it drops them from a log axis); the raw
    value still appears in hover.
    """
    if log_scale and chart_type in LOG_SCALE_CHART_TYPES:
        fig.update_xaxes(type="log")
    return fig


def plot_numeric_trace(interval_df, value_col, chart_type="markers+line", color="#8b1e3f",
                       intervals=True, template=None, color_by=None, log_scale=False,
                       stepped=False, fill_area=False, graded=False):
    """Plot numeric assay intervals with mid-depth markers and interval extent.

    chart_type options:
    - "bar": horizontal bars, each sized to its own interval (thickness = to-from)
    - "markers": markers with error bars
    - "markers+line": markers + line with error bars (default)
    - "line": line only (no error bars)
    - "colored-line": graded line coloured by value on the magma ramp + colour bar
    - "filled-line": line with the area back to zero shaded (no error bars)
    - "step-line": stepped line drawn along each interval's from/to extent
    - "heat-strip": full-track-width bars coloured by value on the magma ramp

    color_by : dict, optional
        Colour the track by a separate categorical column instead of by value.
        ``{"property"/"label": str, "segments": DataFrame|list, "colour_map": ...}``
        where *segments* are categorical interval rows (from/to/val). Ignored
        for the ``filled-line``, ``step-line`` and ``heat-strip`` chart types,
        whose geometry or colour already encodes the value.

    intervals : bool, optional
        When True (default) draw error-bar markers showing each interval's depth
        extent for the marker/line chart types. The ``bar`` type shows extent via
        the bar thickness instead, so it never draws error bars.

    template : str or plotly template, optional
        Plotly template to apply. Defaults to the Baselode template.

    log_scale : bool, optional
        When True, switch the value axis to a log scale. Only applied for the
        ``bar``, ``markers``, ``markers+line``, ``line``, ``filled-line``, and
        ``step-line`` chart types; silently ignored elsewhere.

    Returns a plotly.graph_objects.Figure.
    """
    if interval_df.empty:
        return _empty_striplog_figure(template)

    # Normalise the legacy variant chart types onto "line" + toggles (and
    # graded onto the colour choice) so both spellings render identically:
    # the dropdown now offers geometries only.
    if chart_type == "filled-line":
        chart_type, fill_area = "line", True
    if chart_type == "step-line":
        chart_type, stepped = "line", True
    if graded or chart_type == "colored-line":
        mode = "markers" if chart_type == "markers" else "lines+markers"
        return _build_graded_line(interval_df, value_col, template, mode=mode)

    # Colour-by only composes with the chart types the category-coloured
    # builder implements; stepped / filled lines keep their geometry and
    # heat-strip's colour already encodes the value, so those win.
    chart_type_overrides_color_by = stepped or fill_area or chart_type == "heat-strip"
    if color_by and not chart_type_overrides_color_by and len(_normalize_segments(color_by.get("segments"))):
        fig = _build_category_coloured_numeric(interval_df, value_col, chart_type, color_by, template)
        return _apply_log_scale(fig, chart_type, log_scale)
    if chart_type == "line" and stepped:
        fig = _build_step_line(interval_df, value_col, color, template, fill_area=fill_area)
        return _apply_log_scale(fig, "step-line", log_scale)
    if chart_type == "heat-strip":
        return _build_heat_strip(interval_df, value_col, template)

    is_bar = chart_type == "bar"
    is_markers = chart_type == "markers"
    is_line_only = chart_type == "line"
    is_filled_line = chart_type == "line" and fill_area

    error_config = dict(
        type="data",
        symmetric=False,
        array=interval_df["err_plus"],
        arrayminus=interval_df["err_minus"],
        thickness=1.5,
        width=2,
        color="#6b7280",
    ) if intervals else None

    if is_filled_line or is_bar:
        # Floor below-detection sentinels (negative) at 0 — a fill band across
        # zero or a leftward bar reads as negative grade; hover keeps the raw
        # value (same convention as the multi-assay tracks).
        trace_common = dict(
            x=interval_df["val"].clip(lower=0),
            y=interval_df["z"],
            customdata=interval_df[["from_val", "to_val", "val"]],
            hovertemplate=f"{value_col}: %{{customdata[2]}}<br>from: %{{customdata[0]:.3f}} to: %{{customdata[1]:.3f}}<extra></extra>",
        )
    else:
        trace_common = dict(
            x=interval_df["val"],
            y=interval_df["z"],
            customdata=interval_df[["from_val", "to_val"]],
            hovertemplate=f"{value_col}: %{{x}}<br>from: %{{customdata[0]:.3f}} to: %{{customdata[1]:.3f}}<extra></extra>",
        )

    if is_bar:
        # Each bar spans its own down-hole interval (thickness = to-from), so the
        # interval extent is shown by the bar itself — no error bars.
        trace = go.Bar(
            orientation="h",
            width=(interval_df["to_val"] - interval_df["from_val"]).abs().clip(lower=0.01),
            marker=dict(color=color),
            **trace_common,
        )
    else:
        scatter_mode = "lines" if (is_line_only or is_filled_line) else ("markers" if is_markers else "lines+markers")
        trace = go.Scatter(
            mode=scatter_mode,
            line=dict(color=color, width=2),
            marker=dict(size=7, color="#a8324f"),
            # Filled line: shade back to zero (value is on x). Extent is implied
            # by the fill, so no error bars, matching "line".
            fill="tozerox" if is_filled_line else None,
            fillcolor=with_alpha(color, 0.35) if is_filled_line else None,
            error_y=None if (is_line_only or is_filled_line) else error_config,
            **trace_common,
        )

    fig = go.Figure(data=[trace], layout=_numeric_layout(value_col))
    fig = _apply_striplog_defaults(fig, template=template)
    return _apply_log_scale(fig, chart_type, log_scale)


def _align_series_to_common_depths(series):
    """Align several assay series onto a shared depth grid (the union of every
    series' intervals, keyed by from/to).

    Assays are sampled on the same intervals but individual cells may be blank,
    so each series carries a different subset of points. Filling every series
    across the full grid (missing cells → 0, as below-detection is treated) keeps
    the rows aligned so a stacked area/bar hover always resolves. Ordered
    deep → shallow, matching :func:`compute_interval_points`.
    """
    grid = {}
    for entry in series:
        for _, point in entry["points"].iterrows():
            key = (point["from_val"], point["to_val"])
            if key not in grid:
                grid[key] = {"z": point["z"], "from_val": point["from_val"], "to_val": point["to_val"]}
    ordered = sorted(grid.values(), key=lambda cell: cell["z"], reverse=True)

    aligned = []
    for entry in series:
        by_key = {
            (point["from_val"], point["to_val"]): point
            for _, point in entry["points"].iterrows()
        }
        rows = []
        for cell in ordered:
            hit = by_key.get((cell["from_val"], cell["to_val"]))
            if hit is not None:
                rows.append({"z": hit["z"], "val": hit["val"], "from_val": hit["from_val"], "to_val": hit["to_val"]})
            else:
                rows.append({"z": cell["z"], "val": 0, "from_val": cell["from_val"], "to_val": cell["to_val"]})
        aligned.append({**entry, "points": pd.DataFrame(rows)})
    return aligned


def plot_multi_assay_trace(series, mode="multi-line", template=None):
    """Plot several numeric assays in one track.

    Two modes:
    - ``"multi-line"`` (default): a stacked area per assay (Plotly ``stackgroup``),
      plotting raw values; below-detection sentinels (negative) are floored at 0.
    - ``"multi-stacked"``: horizontal bars per interval, stacked across assays
      (``barmode='stack'``), so each interval shows the assays' additive contribution.

    Parameters
    ----------
    series : list of dict
        One entry per assay: ``{"property": str, "points": DataFrame, "color": optional}``
        where *points* is the output of :func:`compute_interval_points`.
    mode : str, optional
        ``"multi-line"`` or ``"multi-stacked"``.
    template : str or plotly template, optional

    Returns a plotly.graph_objects.Figure.
    """
    usable = [
        s for s in (series or [])
        if s and s.get("property") and isinstance(s.get("points"), pd.DataFrame) and not s["points"].empty
    ]
    if not usable:
        return _empty_striplog_figure(template)

    stacked = mode == "multi-stacked"
    aligned = _align_series_to_common_depths(usable)

    data = []
    for idx, entry in enumerate(aligned):
        points = entry["points"]
        colour = entry.get("color") or series_colour(entry["property"], idx)
        name = entry["property"]
        vals = points["val"].astype(float)
        floored = vals.clip(lower=0)
        # [trueValue, fromDepth, toDepth] — hover reports the true reported value.
        customdata = [
            [v, min(f, t), max(f, t)]
            for v, f, t in zip(points["val"], points["from_val"], points["to_val"])
        ]
        # Depth-unified hover: the shared depth is the box header, so each row
        # only needs its label + value.
        hovertemplate = f"{name}: %{{customdata[0]:.4~r}}<extra></extra>"
        if stacked:
            data.append(go.Bar(
                orientation="h",
                x=floored,
                y=points["z"],
                width=(points["to_val"] - points["from_val"]).abs().clip(lower=0.01),
                marker=dict(color=colour),
                name=name, showlegend=True,
                customdata=customdata, hovertemplate=hovertemplate,
            ))
        else:
            data.append(go.Scatter(
                mode="lines",
                stackgroup="assays",
                orientation="h",
                x=floored,
                y=points["z"],
                line=dict(color=colour, width=1.5),
                fillcolor=with_alpha(colour, 0.5),
                name=name, showlegend=True,
                customdata=customdata, hovertemplate=hovertemplate,
            ))

    layout = go.Layout(
        xaxis=dict(title="Value (stacked)", zeroline=False),
        yaxis=dict(title="Depth (m)", autorange="reversed", zeroline=False),
        barmode="stack" if stacked else "overlay",
        showlegend=True,
        legend=dict(orientation="h", y=1.02, yanchor="bottom", x=0, font=dict(size=9)),
    )
    fig = go.Figure(data=data, layout=layout)
    return _apply_striplog_defaults(fig, template=template)


def _interpolate_series_at_depths(points_df, depths):
    """Sample a series at the given depths by linear interpolation.

    End-clamped: depths outside the series' span take the first/last value.
    Mirrors the JS ``interpolateSeriesAtDepths`` helper — unlike
    :func:`_align_series_to_common_depths`, missing cells are never
    zero-filled (zero-fill is only correct for stacked multi-assay plots).
    """
    ordered = points_df.sort_values("z")
    return np.interp(
        depths, ordered["z"].astype(float), ordered["val"].astype(float)
    ).tolist()


def _split_fill_runs(depths, vals_a, vals_b):
    """Split two aligned curves into runs of constant A-vs-B dominance.

    Crossing depths are found by linear interpolation and inserted as shared
    boundary points so the shaded region flips exactly at the crossover.
    Returns a list of ``(sign, points)`` tuples where *sign* is +1 (A > B) or
    -1 (B > A) and *points* are ``(depth, val_a, val_b)`` triples.
    """
    points = []
    for index in range(len(depths)):
        points.append((depths[index], vals_a[index], vals_b[index]))
        if index + 1 < len(depths):
            diff_here = vals_a[index] - vals_b[index]
            diff_next = vals_a[index + 1] - vals_b[index + 1]
            if diff_here * diff_next < 0:
                frac = diff_here / (diff_here - diff_next)
                depth_cross = depths[index] + frac * (depths[index + 1] - depths[index])
                val_cross = vals_a[index] + frac * (vals_a[index + 1] - vals_a[index])
                points.append((depth_cross, val_cross, val_cross))

    runs = []
    run_points = []
    run_sign = 0
    for point in points:
        diff = point[1] - point[2]
        sign = 1 if diff > 0 else (-1 if diff < 0 else 0)
        if not run_points:
            run_points = [point]
            run_sign = sign
            continue
        if sign == 0 or run_sign == 0 or sign == run_sign:
            run_points.append(point)
            if run_sign == 0:
                run_sign = sign
        else:
            runs.append((run_sign, run_points))
            # The new run starts at the shared boundary (crossing) point.
            run_points = [run_points[-1], point]
            run_sign = sign
    if run_points:
        runs.append((run_sign, run_points))
    return runs


def plot_two_curve_fill(df, value_col_a, value_col_b, from_cols=None, to_cols=None,
                        color_a=None, color_b=None, log_scale=False, template=None):
    """Plot two numeric curves with the region between them shaded by dominance.

    The classic neutron–density cross-plot track: both columns are converted to
    interval mid-points, aligned onto the union of their depth grids, and drawn
    as lines. The area between them is shaded, split at every crossing:

    - where A > B the fill uses A's colour at alpha 0.4
    - where B > A the fill uses B's colour at alpha 0.4

    Parameters
    ----------
    df : pd.DataFrame
        Assay rows for a single hole containing both value columns.
    value_col_a, value_col_b : str
        The two numeric columns to compare.
    from_cols, to_cols : iterable of str, optional
        Interval column candidates passed to :func:`compute_interval_points`.
        Defaults to that function's standard candidates.
    color_a, color_b : str, optional
        Curve colours. Default to the commodity colour for the column name,
        falling back to ``MULTI_SERIES_COLORWAY[0]`` / ``[1]``.
    log_scale : bool, optional
        When True, switch the value axis to a log scale.
    template : str or plotly template, optional
        Plotly template to apply. Defaults to the Baselode template.

    Returns a plotly.graph_objects.Figure.
    """
    interval_kwargs = {}
    if from_cols is not None:
        interval_kwargs["from_cols"] = from_cols
    if to_cols is not None:
        interval_kwargs["to_cols"] = to_cols
    points_a = compute_interval_points(df, value_col_a, **interval_kwargs)
    points_b = compute_interval_points(df, value_col_b, **interval_kwargs)
    if points_a.empty or points_b.empty:
        return _empty_striplog_figure(template)

    # Floor below-detection sentinels (negative) at 0 before interpolating —
    # interpolating through a sentinel fabricates slopes, crossings and fill
    # below zero (same convention as the multi-assay tracks).
    points_a = points_a.assign(val=points_a["val"].astype(float).clip(lower=0))
    points_b = points_b.assign(val=points_b["val"].astype(float).clip(lower=0))

    # Union of both series' mid-depths, each curve linearly interpolated onto
    # it (end-clamped) — matching the JS implementation.
    depths = sorted(
        set(points_a["z"].astype(float)) | set(points_b["z"].astype(float))
    )
    vals_a = _interpolate_series_at_depths(points_a, depths)
    vals_b = _interpolate_series_at_depths(points_b, depths)

    colour_a = color_a or commodity_colour_for_property(value_col_a) or MULTI_SERIES_COLORWAY[0]
    colour_b = color_b or commodity_colour_for_property(value_col_b) or MULTI_SERIES_COLORWAY[1]

    # Shaded runs first (under the curves): per run an invisible anchor trace
    # on curve B, then curve A filled back to it. Hover lives on the curves.
    data = []
    for sign, run_points in _split_fill_runs(depths, vals_a, vals_b):
        if sign == 0 or len(run_points) < 2:
            continue
        run_depths = [point[0] for point in run_points]
        fill_colour = with_alpha(colour_a if sign > 0 else colour_b, 0.4)
        data.append(go.Scatter(
            x=[point[2] for point in run_points], y=run_depths,
            mode="lines", line=dict(width=0),
            showlegend=False, hoverinfo="skip",
        ))
        data.append(go.Scatter(
            x=[point[1] for point in run_points], y=run_depths,
            mode="lines", line=dict(width=0),
            fill="tonextx", fillcolor=fill_colour,
            showlegend=False, hoverinfo="skip",
        ))

    # The two visible curves carry the hover and the legend, drawn on the
    # shared interpolated grid so they meet the fills exactly.
    for name, vals, colour in ((value_col_a, vals_a, colour_a), (value_col_b, vals_b, colour_b)):
        data.append(go.Scatter(
            x=vals, y=depths,
            mode="lines", line=dict(color=colour, width=2),
            name=name, showlegend=True,
            hovertemplate=f"{name}: %{{x}}<br>depth: %{{y:.3f}}<extra></extra>",
        ))

    layout = go.Layout(
        xaxis=dict(title=f"{value_col_a} / {value_col_b}", zeroline=False),
        yaxis=dict(title="Depth (m)", autorange="reversed", zeroline=False),
        showlegend=True,
        legend=dict(orientation="h", y=1.02, yanchor="bottom", x=0, font=dict(size=9)),
    )
    fig = go.Figure(data=data, layout=layout)
    fig = _apply_striplog_defaults(fig, template=template)
    if log_scale:
        fig.update_xaxes(type="log")
    return fig


def plot_composition_log(df, value_cols, from_col=FROM, to_col=TO, colour_map=None,
                         normalize=True, template=None):
    """Plot a percent-composition track: divided horizontal stacked bars per interval.

    One trace per component (*value_cols* order = legend + stack order), each
    interval a full-width stacked bar. With ``normalize=True`` (default) every
    interval's components are scaled to fractions of their sum and the value
    axis is fixed to [0, 1]; otherwise raw values are stacked and the axis
    autoranges.

    Intervals whose components are all null/zero are skipped. Negative values
    are clamped to 0 for the bar while the raw value stays in hover (the same
    convention as the multi-assay below-detection handling).

    Parameters
    ----------
    df : pd.DataFrame
        Interval rows with *from_col*, *to_col*, and the component columns.
    value_cols : iterable of str
        Component columns, in legend / stack order.
    from_col, to_col : str
        Depth interval columns.
    colour_map : dict or str or None, optional
        Semantic colour map for components; values not found fall back to
        ``MULTI_SERIES_COLORWAY`` cycling.
    normalize : bool, optional
        Scale each interval's components to fractions of their sum (default True).
    template : str or plotly template, optional
        Plotly template to apply. Defaults to the Baselode template.

    Returns a plotly.graph_objects.Figure.
    """
    # Keep only components that actually have readings — a present-but-empty
    # column would otherwise render as a legend entry of measured zeros.
    value_cols = [
        col for col in (value_cols or [])
        if col in df.columns and pd.to_numeric(df[col], errors="coerce").notna().any()
    ]
    if df.empty or not value_cols:
        return _empty_striplog_figure(template)

    resolved_cmap = resolve_colour_map(colour_map)

    intervals = []
    for _, row in df.iterrows():
        try:
            from_depth = float(row[from_col])
            to_depth = float(row[to_col])
        except (TypeError, ValueError, KeyError):
            continue
        if to_depth <= from_depth:
            continue
        raw_values = []
        clamped = []
        for col in value_cols:
            try:
                raw = float(row[col])
            except (TypeError, ValueError):
                raw = float("nan")
            raw_values.append(raw)
            clamped.append(0.0 if (math.isnan(raw) or raw < 0) else raw)
        total = sum(clamped)
        if total <= 0:
            continue
        intervals.append({
            "from": from_depth, "to": to_depth, "mid": 0.5 * (from_depth + to_depth),
            "raw": raw_values, "clamped": clamped, "total": total,
        })

    if not intervals:
        return _empty_striplog_figure(template)
    intervals.sort(key=lambda cell: cell["from"])

    def _component_colour(col, index):
        if resolved_cmap:
            mapped = get_colour(col, resolved_cmap, fallback=None)
            if mapped is not None:
                return mapped
        return MULTI_SERIES_COLORWAY[index % len(MULTI_SERIES_COLORWAY)]

    data = []
    for comp_index, col in enumerate(value_cols):
        fractions = [cell["clamped"][comp_index] / cell["total"] for cell in intervals]
        # [rawValue, fraction, from, to] — hover reports the true reported value.
        customdata = [
            [cell["raw"][comp_index], fractions[cell_index], cell["from"], cell["to"]]
            for cell_index, cell in enumerate(intervals)
        ]
        data.append(go.Bar(
            orientation="h",
            x=fractions if normalize else [cell["clamped"][comp_index] for cell in intervals],
            y=[cell["mid"] for cell in intervals],
            width=[cell["to"] - cell["from"] for cell in intervals],
            marker=dict(color=_component_colour(col, comp_index), line=dict(width=0)),
            name=col, showlegend=True,
            customdata=customdata,
            hovertemplate=(
                f"{col}: %{{customdata[0]}} (%{{customdata[1]:.1%}})<br>"
                f"from: %{{customdata[2]:.3f}} to: %{{customdata[3]:.3f}}<extra></extra>"
            ),
        ))

    if normalize:
        xaxis = dict(title="Fraction", range=[0, 1], fixedrange=True, tickformat=".0%", zeroline=False)
    else:
        xaxis = dict(title="Value", zeroline=False)
    layout = go.Layout(
        xaxis=xaxis,
        yaxis=dict(title="Depth (m)", autorange="reversed", zeroline=False),
        barmode="stack",
        bargap=0,
        showlegend=True,
        legend=dict(orientation="h", y=1.02, yanchor="bottom", x=0, font=dict(size=9)),
    )
    fig = go.Figure(data=data, layout=layout)
    return _apply_striplog_defaults(fig, template=template)


def _band_marker(colour, shape):
    """Marker dict for a categorical band, with an optional light hatch overlay.

    A non-empty *shape* emits a Plotly ``marker.pattern`` reading as a white
    overlay on the category's colour fill; an empty shape leaves the marker
    identical to the pattern-free output.
    """
    marker = dict(color=colour, line=dict(width=0))
    if shape:
        marker["pattern"] = dict(shape=shape, solidity=0.3, fgcolor="#ffffff", bgcolor=colour, size=6)
    return marker


def plot_categorical_trace(interval_df, value_col, palette=None, colour_map=None, pattern_map=None, template=None):
    """Plot categorical assay intervals as colored bands with labels.

    Parameters
    ----------
    interval_df : pd.DataFrame
        Interval data (output of :func:`compute_interval_points`).
    value_col : str
        Name of the value column (used in hover text).
    palette : list of str, optional
        Fallback colour palette (cycled by category index) used when a value
        is absent from *colour_map*.
    colour_map : dict or str or None, optional
        Semantic colour map. May be:

        * ``None`` – use *palette* only.
        * A ``dict`` mapping category strings to CSS colour strings.
        * A built-in map name (``"commodity"`` or ``"lithology"``).

        Values not found in the map fall back to *palette* cycling.
    pattern_map : dict or str or None, optional
        Semantic hatch-pattern map (category → Plotly ``marker.pattern`` shape),
        looked up case-insensitively like *colour_map*. May be a ``dict`` or the
        built-in name ``"lithology"``. Categories absent from the map render
        solid (no pattern).
    template : str or plotly template, optional
        Plotly template to apply. Defaults to the Baselode template.

    Returns a plotly.graph_objects.Figure.
    """
    if interval_df.empty:
        return _empty_striplog_figure(template)

    palette = palette or [
        "#1f77b4",  # blue
        "#ff7f0e",  # orange
        "#2ca02c",  # green
        "#d62728",  # red
        "#9467bd",  # purple
        "#8c564b",  # brown
        "#e377c2",  # pink
        "#17becf",  # cyan
        "#bcbd22",  # olive
        "#7f7f7f",  # grey
    ]

    resolved_cmap = resolve_colour_map(colour_map)
    resolved_pmap = resolve_pattern_map(pattern_map)

    safe = interval_df.dropna(subset=["from_val", "to_val", "val"]).copy()
    if safe.empty:
        return _empty_striplog_figure(template)
    safe = safe[safe["to_val"] > safe["from_val"]]
    if safe.empty:
        return _empty_striplog_figure(template)
    safe = safe.sort_values(["from_val", "to_val"], ascending=[True, True])

    categories = [str(v) for v in safe["val"].tolist()]
    unique_categories = list(dict.fromkeys(categories))

    def _pick_color(cat, idx):
        if resolved_cmap:
            c = get_colour(cat, resolved_cmap, fallback=None)
            if c is not None:
                return c
        return palette[idx % len(palette)]

    color_map = {cat: _pick_color(cat, idx) for idx, cat in enumerate(unique_categories)}

    # One bar trace per unique category; barmode='overlay' lets non-overlapping
    # depth intervals from different traces coexist at the same x position.
    traces = []
    for cat in unique_categories:
        cat_rows = safe[safe["val"].astype(str) == cat]
        froms = cat_rows["from_val"].tolist()
        tos = cat_rows["to_val"].tolist()
        traces.append(
            go.Bar(
                x=[0.5] * len(froms),
                y=[t - f for f, t in zip(froms, tos)],
                base=froms,
                width=1,
                marker=_band_marker(color_map[cat], get_pattern(cat, resolved_pmap)),
                name=cat,
                showlegend=False,
                customdata=list(zip(froms, tos)),
                hovertemplate=f"{value_col}: {cat}<br>from: %{{customdata[0]:.3f}} to: %{{customdata[1]:.3f}}<extra></extra>",
            )
        )

    layout = go.Layout(
        barmode="overlay",
        bargap=0,
        xaxis=dict(range=[0, 1], visible=False, fixedrange=True),
        yaxis=dict(title="Depth (m)", autorange="reversed", zeroline=False),
        showlegend=False,
    )

    fig = go.Figure(data=traces, layout=layout)
    return _apply_striplog_defaults(fig, template=template)


def plot_multi_assay(df, value_cols, mode="multi-line", template=None):
    """Plot several numeric assays from one drillhole in a single stacked track.

    Convenience wrapper over :func:`plot_multi_assay_trace` that builds an
    interval series per column from *df*.

    Parameters
    ----------
    df : pd.DataFrame
        Assay rows for a single hole.
    value_cols : iterable of str
        Numeric columns to plot together.
    mode : str, optional
        ``"multi-line"`` (stacked areas) or ``"multi-stacked"`` (stacked bars).
    template : str or plotly template, optional

    Returns a plotly.graph_objects.Figure.
    """
    series = []
    for col in value_cols or []:
        if col not in df.columns:
            continue
        points = compute_interval_points(df, col)
        if not points.empty:
            series.append({"property": col, "points": points})
    return plot_multi_assay_trace(series, mode=mode, template=template)


def plot_drillhole_trace(df,
    value_col,
    chart_type=None,
    categorical_props=None,
    numeric_chart="markers+line",
    color=None,
    use_mid=False,
    intervals=True,
    colour_map=None,
    color_by=None,
    multi_props=None,
    log_scale=False,
    stepped=False,
    fill_area=False,
    start_from_zero=False,
    template=None):
    """
    Plot a 2D downhole trace or strip log for a single drillhole, for a single variable.

    chart_type: override to one of {"categorical", "bar", "markers", "markers+line",
    "line", "colored-line", "filled-line", "step-line", "heat-strip", "multi-line",
    "multi-stacked", "two-curve", "composition", "point-log", "annotations",
    "dip-azimuth"}. If omitted, we infer categorical if value_col in
    categorical_props, else numeric_chart.

    intervals : bool, optional
        When True (default) draw error-bar style markers showing the depth extent of each
        sample interval (from/to range). Set to False for point markers only.
    colour_map : dict or str or None, optional
        Semantic colour map for categorical traces and for the ``color_by`` legend.
    color_by : str, optional
        A separate categorical column to colour a numeric track by (joined per
        interval at its mid-depth). Ignored for categorical / multi-assay charts.
    multi_props : iterable of str, optional
        Extra numeric columns to plot alongside *value_col* for the multi-property
        chart types (``multi-line``, ``multi-stacked``, ``two-curve``,
        ``composition``). ``two-curve`` compares *value_col* against the first
        extra column and requires at least one; the others default to just
        *value_col*.
    log_scale : bool, optional
        When True, switch the value axis of a numeric track to a log scale.
        Only applied for the ``bar``, ``markers``, ``markers+line``, ``line``,
        ``filled-line``, ``step-line``, and ``two-curve`` chart types; silently
        ignored elsewhere.
    template : str or plotly template, optional
        Plotly template to apply. Defaults to the Baselode template.
    """
    categorical_props = set(categorical_props or [])
    is_cat = value_col in categorical_props
    resolved_chart = chart_type or ("categorical" if is_cat else numeric_chart)

    # Pin every chart type over the same data to one explicitly padded depth
    # range so adjacent tracks stay vertically aligned (see
    # _apply_depth_axis_range). Bounds come from the resolved from/to columns.
    def _pinned(fig, points_df):
        return _apply_depth_axis_range(fig, _depth_bounds(points_df), start_from_zero)

    if resolved_chart in ("multi-line", "multi-stacked"):
        cols = list(dict.fromkeys([value_col, *(multi_props or [])]))
        bounds_frames = [compute_interval_points(df, col) for col in cols if col in df.columns]
        bounds_df = pd.concat(bounds_frames) if bounds_frames else pd.DataFrame()
        return _pinned(plot_multi_assay(df, cols, mode=resolved_chart, template=template), bounds_df)

    if resolved_chart == "two-curve":
        extra_props = [col for col in (multi_props or []) if col != value_col]
        if not extra_props:
            return _empty_striplog_figure(template)
        pair_frames = [
            compute_interval_points(df, col)
            for col in (value_col, extra_props[0]) if col in df.columns
        ]
        return _pinned(
            plot_two_curve_fill(
                df, value_col, extra_props[0], log_scale=log_scale, template=template,
            ),
            pd.concat(pair_frames) if pair_frames else pd.DataFrame(),
        )

    if resolved_chart == "composition":
        component_cols = list(dict.fromkeys([value_col, *(multi_props or [])]))
        component_frames = [
            compute_interval_points(df, col) for col in component_cols if col in df.columns
        ]
        return _pinned(
            plot_composition_log(df, component_cols, template=template),
            pd.concat(component_frames) if component_frames else pd.DataFrame(),
        )

    if resolved_chart == "point-log":
        point_rows, depth_col = _resolve_point_depth_rows(df, value_col)
        if point_rows is None:
            return _empty_striplog_figure(template)
        return plot_point_log(
            point_rows, depth_col=depth_col, label_col=value_col, template=template,
        )

    if resolved_chart == "annotations":
        point_rows, depth_col = _resolve_point_depth_rows(df, value_col)
        if point_rows is None:
            return _empty_striplog_figure(template)
        return plot_depth_annotations(
            point_rows, depth_col=depth_col, text_col=value_col, template=template,
        )

    if resolved_chart == "dip-azimuth":
        # Structural tables carry depth/dip/azimuth; plot_dip_azimuth_log
        # guards missing columns with an empty templated figure itself.
        return plot_dip_azimuth_log(df, template=template)

    if use_mid:
        if MID not in df.columns:
            return _empty_striplog_figure(template)
        tmp = df[[MID, value_col]].copy()
        tmp = tmp.dropna(subset=[MID, value_col])
        interval_df = pd.DataFrame({
            "z": tmp[MID],
            "val": tmp[value_col],
            "from_val": tmp[MID],
            "to_val": tmp[MID],
            "err_plus": 0,
            "err_minus": 0,
        }).sort_values("z", ascending=False)
    else:
        interval_df = compute_interval_points(df, value_col)
    if is_cat or resolved_chart == "categorical":
        return _pinned(
            plot_categorical_trace(interval_df, value_col, colour_map=colour_map, template=template),
            interval_df,
        )
    resolved_color = color or commodity_colour_for_property(value_col) or "#8b1e3f"
    # The graded sentinel is a rendering choice ("colour by the value
    # itself"), not a categorical column — route it to the graded builder.
    graded = color_by == GRADED_COLOR_BY
    resolved_color_by = None
    if color_by and not graded and color_by in df.columns:
        segments = compute_interval_points(df, color_by)
        if not segments.empty:
            resolved_color_by = {"property": color_by, "segments": segments, "colour_map": colour_map}
    return _pinned(
        plot_numeric_trace(
            interval_df, value_col, chart_type=resolved_chart, color=resolved_color,
            intervals=intervals, template=template, color_by=resolved_color_by,
            log_scale=log_scale, stepped=stepped, fill_area=fill_area, graded=graded,
        ),
        interval_df,
    )


def combine_trace_configs(configs, df, categorical_props=None):
    """Build figures for multiple trace configs.

    Parameters
    ----------
    configs : iterable of dict
        Each dict may contain ``hole_id`` / ``holeId``, ``value_col`` /
        ``property``, and optionally ``chart_type`` / ``chartType``.
        When ``hole_id`` is present ``df`` is pre-filtered to that hole before
        being passed to :func:`plot_drillhole_trace`.
    df : pandas.DataFrame
        Full (or pre-filtered) dataset.
    categorical_props : list of str, optional

    Returns
    -------
    list of plotly.graph_objects.Figure
        One figure per config entry.
    """
    figs = []
    for cfg in configs:
        hole_id = cfg.get(HOLE_ID) or cfg.get("holeId")
        value_col = cfg.get("value_col") or cfg.get("property")
        chart_type = cfg.get("chart_type") or cfg.get("chartType")
        subset = df[df[HOLE_ID] == hole_id] if hole_id else df
        figs.append(
            plot_drillhole_trace(
                df=subset,
                value_col=value_col,
                chart_type=chart_type,
                categorical_props=categorical_props,
            )
        )
    return figs


def plot_drillhole_traces_subplots(df,
    value_col,
    hole_id_col=HOLE_ID,
    hole_ids=None,
    chart_type="markers+line",
    categorical_props=None,
    colors=None,
    use_mid=False,
    template=None):
    """Plot multiple drillhole traces side-by-side with shared depth axis.

    Only numeric traces are handled; categorical props will still render as numeric markers/lines.

    template : str or plotly template, optional
        Plotly template to apply. Defaults to the Baselode template.
    """
    categorical_props = set(categorical_props or [])
    hole_ids = list(hole_ids) if hole_ids is not None else sorted(df[hole_id_col].unique())
    if not hole_ids:
        return _empty_striplog_figure(template)
    colors = colors or ["#8b1e3f", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#0ea5e9", "#ef4444"]

    fig = make_subplots(rows=1, cols=len(hole_ids), shared_yaxes=True, horizontal_spacing=0.02)
    for idx, hid in enumerate(hole_ids):
        subset = df[df[hole_id_col] == hid]
        resolved_chart = "categorical" if value_col in categorical_props else chart_type
        if use_mid:
            if MID not in subset.columns:
                continue
            tmp = subset[[MID, value_col]].dropna(subset=[MID, value_col])
            interval_df = pd.DataFrame({
                "z": tmp[MID],
                "val": tmp[value_col],
                "from_val": tmp[MID],
                "to_val": tmp[MID],
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
    fig.update_layout(
        template=template if template is not None else BASELODE_TEMPLATE_NAME,
        showlegend=False,
        margin=dict(l=40, r=10, t=10, b=40),
    )
    return fig


def plot_drillhole_traces(df,
    hole_id_col=HOLE_ID,
    hole_id=None,
    value_cols=None,
    chart_type="markers+line",
    categorical_props=None,
    colors=None,
    use_mid=False,
    template=None):
    """Plot multiple tracks for a single hole side-by-side with shared depth axis.

    template : str or plotly template, optional
        Plotly template to apply. Defaults to the Baselode template.
    """
    categorical_props = set(categorical_props or [])
    if hole_id is None:
        raise ValueError("hole_id is required")
    value_cols = list(value_cols or [])
    if not value_cols:
        raise ValueError("value_cols must be provided")
    colors = colors or ["#8b1e3f", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#0ea5e9", "#ef4444"]

    subset = df[df[hole_id_col] == hole_id]
    if subset.empty:
        return _empty_striplog_figure(template)

    fig = make_subplots(rows=1, cols=len(value_cols), shared_yaxes=True, horizontal_spacing=0.02)
    for idx, col in enumerate(value_cols):
        resolved_chart = "categorical" if col in categorical_props else chart_type
        if use_mid:
            if MID not in subset.columns:
                continue
            tmp = subset[[MID, col]].dropna(subset=[MID, col])
            interval_df = pd.DataFrame({
                "z": tmp[MID],
                "val": tmp[col],
                "from_val": tmp[MID],
                "to_val": tmp[MID],
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
    fig.update_layout(
        template=template if template is not None else BASELODE_TEMPLATE_NAME,
        showlegend=False,
        margin=dict(l=40, r=10, t=10, b=40),
    )
    return fig


def _wrap_comment(text, chars_per_line=18):
    """Wrap comment text at word boundaries using Plotly HTML line breaks."""
    if not text:
        return ""
    words = str(text).split()
    lines = []
    current = ""
    for word in words:
        if current and len(current) + 1 + len(word) > chars_per_line:
            lines.append(current)
            current = word
        else:
            current = (current + " " + word).strip()
    if current:
        lines.append(current)
    return "<br>".join(lines)


# A comments track renders roughly this many 10px text lines top to bottom;
# an interval covering a fraction of the depth span fits that fraction of
# lines. Mirrored by the JS buildCommentsConfig.
_COMMENT_TEXT_LINES_PER_TRACK = 60


def plot_comments_log(df,
    from_col="from",
    to_col="to",
    comment_col="comments",
    bg_color="rgba(148, 163, 184, 0.2)",
    bg_color_alt="rgba(148, 163, 184, 0.07)",
    border_color="rgba(148, 163, 184, 0.4)",
    text_color=None,
    chars_per_line=18,
    template=None):
    """Render a comments log track — depth intervals with text annotations overlaid.

    Only intervals with a non-empty comment render — unified per-hole datasets
    mix assay / structural / geology rows, and drawing every interval would
    bury the commented ones under empty overlapping boxes. Each rendered
    interval carries a full-width hover target reporting the interval and the
    complete comment. Inline text is budgeted to the lines that fit the
    interval's share of the track and truncated with an ellipsis beyond that,
    so long comments in thin intervals never spill over their neighbours.

    Parameters
    ----------
    df : pd.DataFrame
        Data with from, to, and comment columns.
    from_col, to_col : str
        Depth interval columns.
    comment_col : str
        Column containing comment text.
    bg_color : str
        Fill color for intervals that have a comment. The translucent default
        reads on both the light and dark templates.
    bg_color_alt : str
        Alternate fill applied to every second rendered interval, so adjacent
        boxes stay visually distinct.
    border_color : str
        Rectangle border color.
    text_color : str, optional
        Comment text color. Default None inherits the template font colour.
    chars_per_line : int
        Approximate characters before wrapping to next line.
    template : str or plotly template, optional
        Plotly template to apply. Defaults to the Baselode template.
    """
    if df.empty:
        return _empty_striplog_figure(template)

    records = []
    for _, row in df.iterrows():
        try:
            from_depth = float(row[from_col])
            to_depth = float(row[to_col])
        except (TypeError, ValueError, KeyError):
            continue
        if to_depth <= from_depth:
            continue
        raw_comment = row.get(comment_col, "")
        comment = "" if (raw_comment is None or str(raw_comment).strip() in ("", "nan")) else str(raw_comment).strip()
        if not comment:
            continue
        records.append((from_depth, to_depth, comment))

    if not records:
        return _empty_striplog_figure(template)

    records = sorted(records, key=lambda record: record[0])
    total_span = records[-1][1] - records[0][0]

    shapes = []
    text_xs = []
    text_ys = []
    texts = []

    for record_index, (from_depth, to_depth, comment) in enumerate(records):
        shapes.append(dict(
            type="rect",
            xref="x", yref="y",
            x0=0, x1=1,
            y0=from_depth, y1=to_depth,
            fillcolor=bg_color if record_index % 2 == 0 else bg_color_alt,
            line=dict(color=border_color, width=1),
            layer="below",
        ))
        if total_span <= 0:
            continue
        line_budget = int(((to_depth - from_depth) / total_span) * _COMMENT_TEXT_LINES_PER_TRACK)
        if line_budget < 1:
            continue
        wrapped_lines = _wrap_comment(comment, chars_per_line).split("<br>")
        shown_lines = wrapped_lines[:line_budget]
        if len(wrapped_lines) > line_budget:
            shown_lines[-1] = f"{shown_lines[-1]}…"
        text_xs.append(0.5)
        text_ys.append(0.5 * (from_depth + to_depth))
        texts.append("<br>".join(shown_lines))

    # Invisible full-width bar per interval: the hover target covers the whole
    # box (any depth within it), instead of one exact mid-depth text point.
    hover_bar = go.Bar(
        orientation="h",
        x=[1.0] * len(records),
        base=0,
        y=[0.5 * (from_depth + to_depth) for from_depth, to_depth, _ in records],
        width=[max(to_depth - from_depth, 0.01) for from_depth, to_depth, _ in records],
        marker=dict(color="rgba(0,0,0,0)"),
        hovertext=[
            f"{from_depth:.3f}–{to_depth:.3f} m<br>{_wrap_comment(comment, 40)}"
            for from_depth, to_depth, comment in records
        ],
        hoverinfo="text",
        showlegend=False,
    )

    data = [hover_bar]
    if text_xs:
        # Without an explicit colour the text inherits the template font, so
        # it stays legible on both the light and dark themes.
        textfont = dict(size=10) if text_color is None else dict(size=10, color=text_color)
        data.append(go.Scatter(
            x=text_xs,
            y=text_ys,
            mode="text",
            text=texts,
            textposition="middle center",
            textfont=textfont,
            hoverinfo="skip",
            showlegend=False,
        ))

    fig = go.Figure(data=data)
    fig.update_layout(
        xaxis=dict(range=[0, 1], visible=False, fixedrange=True),
        # No hover spike: the horizontal line would strike through the inline
        # comment text; the unified tooltip already marks the hovered depth.
        yaxis=dict(title="Depth (m)", autorange="reversed", showspikes=False),
        shapes=shapes,
        showlegend=False,
        bargap=0,
    )
    return _apply_striplog_defaults(fig, template=template)


def plot_strip_log(df,
    from_col="from",
    to_col="to",
    label_col="lithology",
    palette=None,
    colour_map=None,
    pattern_map=None,
    template=None):
    """Render a simple strip log (categorical intervals) as colored bands.

    Parameters
    ----------
    df : pd.DataFrame
        Interval data with *from_col*, *to_col*, and *label_col*.
    from_col, to_col : str
        Depth interval columns.
    label_col : str
        Column containing category labels.
    palette : list of str, optional
        Fallback colour palette cycled by category order when a value is
        absent from *colour_map*.
    colour_map : dict or str or None, optional
        Semantic colour map. May be ``None``, a ``dict``, or a built-in
        map name (``"commodity"`` or ``"lithology"``). Values not found
        in the map fall back to *palette* cycling.
    pattern_map : dict or str or None, optional
        Semantic hatch-pattern map (category → Plotly ``marker.pattern``
        shape), looked up case-insensitively like *colour_map*. May be a
        ``dict`` or the built-in name ``"lithology"``. Categories absent
        from the map render solid (no pattern).
    template : str or plotly template, optional
        Plotly template to apply. Defaults to the Baselode template.
    """
    if df.empty:
        return _empty_striplog_figure(template)
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
    resolved_cmap = resolve_colour_map(colour_map)
    resolved_pmap = resolve_pattern_map(pattern_map)
    records = []
    for _, row in df.iterrows():
        try:
            f = float(row[from_col])
            t = float(row[to_col])
        except (TypeError, ValueError, KeyError):
            continue
        if t <= f:
            continue
        label = str(row.get(label_col, ""))
        if label.strip().lower() in ("", "nan", "null", "none"):
            continue
        records.append((f, t, label))
    if not records:
        return _empty_striplog_figure(template)
    records = sorted(records, key=lambda r: r[0], reverse=True)

    # Build a stable colour map so every occurrence of the same label gets the same colour
    unique_labels = sorted({label for _, _, label in records})

    def _pick_color(lbl, idx):
        if resolved_cmap:
            c = get_colour(lbl, resolved_cmap, fallback=None)
            if c is not None:
                return c
        return palette[idx % len(palette)]

    color_map = {lbl: _pick_color(lbl, i) for i, lbl in enumerate(unique_labels)}

    # One bar trace per unique label; barmode='overlay' lets non-overlapping
    # depth intervals coexist at the same x position.
    traces = []
    for label in unique_labels:
        label_records = [(f, t) for f, t, lb in records if lb == label]
        froms = [r[0] for r in label_records]
        tos = [r[1] for r in label_records]
        traces.append(go.Bar(
            x=[0.5] * len(froms),
            y=[t - f for f, t in zip(froms, tos)],
            base=froms,
            width=1,
            marker=_band_marker(color_map[label], get_pattern(label, resolved_pmap)),
            name=label,
            text=[label] * len(froms),
            textposition="inside",
            insidetextanchor="middle",
            textfont=dict(color="black", size=10),
            showlegend=False,
            customdata=list(zip(froms, tos)),
            hovertemplate=f"{label}<br>%{{customdata[0]:.3f}} – %{{customdata[1]:.3f}} m<extra></extra>",
        ))

    fig = go.Figure(data=traces)
    fig.update_layout(
        template=template if template is not None else BASELODE_TEMPLATE_NAME,
        barmode="overlay",
        bargap=0,
        margin=dict(l=40, r=10, t=10, b=40),
        xaxis=dict(range=[0, 1], visible=False, fixedrange=True),
        yaxis=dict(title="Depth (m)", autorange="reversed"),
        showlegend=False,
    )
    return fig


def plot_geology_strip_log(df,
    from_col="from",
    to_col="to",
    category_col="geology_code",
    fallback_category_col="comments",
    palette=None,
    colour_map=None,
    template=None):
    """Render a geology categorical strip log using standardized geology fields.

    Parameters
    ----------
    colour_map : dict or str or None, optional
        Semantic colour map passed through to :func:`plot_strip_log`.
        Accepts ``"lithology"`` to use the built-in lithology palette or a
        custom ``dict``.
    template : str or plotly template, optional
        Plotly template to apply. Defaults to the Baselode template.
    """
    if category_col not in df.columns and fallback_category_col not in df.columns:
        return _empty_striplog_figure(template)

    resolved_col = category_col if category_col in df.columns else fallback_category_col
    return plot_strip_log(
        df=df,
        from_col=from_col,
        to_col=to_col,
        label_col=resolved_col,
        palette=palette,
        colour_map=colour_map,
        template=template,
    )


# Mid-tone hues only — these markers render on both the light and dark
# templates, so near-black slate/navy (invisible on dark) don't belong.
# Mirrors the JS structuralViz DEFAULT_PALETTE.
_DEFAULT_TADPOLE_PALETTE = [
    "#0ea5e9", "#d97706", "#7c3aed", "#dc2626", "#16a34a",
    "#db2777", "#65a30d", "#9333ea", "#14b8a6", "#f43f5e",
]


def plot_tadpole_log(df,
    md_col=DEPTH,
    dip_col=DIP,
    az_col=AZIMUTH,
    size_col=None,
    color_by=None,
    palette=None,
    tail_scale=10.0,
    template=None):
    """Plot a tadpole log for structural measurements.

    Each measurement renders a circle (head) at (dip, depth) with a tail whose
    direction encodes the dip azimuth. The x-axis shows dip in degrees (0–90).

    Parameters
    ----------
    df : pd.DataFrame
        Structural measurements.
    md_col : str
        Column for measured depth (y-axis).
    dip_col : str
        Column for dip angle in degrees (x-axis).
    az_col : str
        Column for dip direction azimuth, clockwise from North.
    size_col : str, optional
        Column to scale marker size.
    color_by : str, optional
        Column to color heads by. If None, all heads are black.
    defect_col : str
        Column name for structural class/defect (used in legend when color_by is set).
    palette : list, optional
        List of hex color strings. Defaults to built-in palette.
    tail_scale : float
        Maximum tail length in dip-degree units. Tail length scales linearly
        with dip magnitude (0° → no tail, 90° → tail_scale degrees).
    template : str or plotly template, optional
        Plotly template to apply. Defaults to the Baselode template.
    """
    if df.empty or md_col not in df.columns or dip_col not in df.columns or az_col not in df.columns:
        return _empty_striplog_figure(template)

    extra_cols = [c for c in [size_col, color_by] if c and c in df.columns]
    safe = df[[md_col, dip_col, az_col] + extra_cols].dropna(subset=[md_col, dip_col, az_col])
    if safe.empty:
        return _empty_striplog_figure(template)

    palette = palette or _DEFAULT_TADPOLE_PALETTE

    # Build color lookup for categories
    color_map = {}
    if color_by and color_by in safe.columns:
        categories = sorted(safe[color_by].dropna().unique())
        color_map = {cat: palette[i % len(palette)] for i, cat in enumerate(categories)}

    tail_shapes = []

    # Group by category to build separate traces for legend
    traces_by_cat = {}

    for _, row in safe.iterrows():
        depth = float(row[md_col])
        dip = float(row[dip_col])
        az = float(row[az_col])
        size = float(row[size_col]) if size_col and size_col in row.index and not pd.isna(row[size_col]) else 8.0

        cat = str(row[color_by]) if color_by and color_by in row.index and not pd.isna(row[color_by]) else "_default"
        # Uncategorised tadpoles take the shared series colour — a mid-tone
        # that reads on both templates (never a hardcoded dark slate).
        color = color_map.get(cat, MULTI_SERIES_COLORWAY[0])

        # Head positioned at x=dip (degrees)
        if cat not in traces_by_cat:
            traces_by_cat[cat] = {"xs": [], "ys": [], "sizes": [], "dips": [], "azs": [], "color": color}
        traces_by_cat[cat]["xs"].append(dip)
        traces_by_cat[cat]["ys"].append(depth)
        traces_by_cat[cat]["sizes"].append(size)
        traces_by_cat[cat]["dips"].append(dip)
        traces_by_cat[cat]["azs"].append(az)

        # Tail: starts at (dip, depth), direction encodes azimuth.
        # Length scales with dip magnitude (in degree units on the x-axis).
        az_rad = math.radians(az)
        length = tail_scale * (abs(dip) / 90.0)
        dx = math.sin(az_rad) * length   # x-component (degrees)
        dy = math.cos(az_rad) * length   # y-component (degrees, visual only)
        tail_shapes.append(dict(
            type="line",
            x0=dip, y0=depth,
            x1=dip + dx, y1=depth + dy,
            line=dict(color=color, width=2),
        ))

    head_traces = []
    for cat, data in traces_by_cat.items():
        label = cat if cat != "_default" else None
        head_traces.append(go.Scatter(
            x=data["xs"],
            y=data["ys"],
            mode="markers",
            name=label,
            marker=dict(size=data["sizes"], color=data["color"]),
            showlegend=bool(color_by and cat != "_default"),
            hovertemplate="Depth: %{y}<br>Dip: %{customdata[0]}<br>Az: %{customdata[1]}<extra></extra>",
            customdata=list(zip(data["dips"], data["azs"])),
        ))

    show_legend = bool(color_by and len(traces_by_cat) > 1)
    fig = go.Figure(data=head_traces)
    for shape in tail_shapes:
        fig.add_shape(**shape)

    fig.update_layout(
        template=template if template is not None else BASELODE_TEMPLATE_NAME,
        margin=dict(l=40, r=10, t=10, b=40),
        xaxis=dict(
            title="Dip (°)",
            range=[-2, 95],
            fixedrange=True,
            zeroline=False,
            tickvals=[0, 30, 60, 90],
        ),
        yaxis=dict(title="Depth (m)", autorange="reversed"),
        showlegend=show_legend,
    )
    return fig


_DEFAULT_POINT_LOG_PALETTE = [
    "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
    "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
    "#d4a6c8", "#86bcb6",
]

_DEFAULT_POINT_LOG_SYMBOLS = [
    "circle", "square", "diamond", "triangle-up", "triangle-down",
    "cross", "x", "star", "hexagon", "pentagon", "bowtie", "hourglass",
]


def plot_point_log(df,
    depth_col=DEPTH,
    label_col="defect",
    palette=None,
    marker_symbols=None,
    marker_size=8,
    template=None):
    """Plot categorical point data as a strip log with unique x-position, colour, and marker per category.

    Unlike :func:`plot_strip_log` which requires from/to interval depths, this
    function accepts point measurements indexed only by depth. Each unique
    category value is assigned:

    * a distinct x-position on the x-axis so categories never overlap
    * a distinct colour from ``palette``
    * a distinct marker symbol from ``marker_symbols``

    One Plotly trace is created per category, making the legend fully functional.

    Parameters
    ----------
    df : pandas.DataFrame
        Point measurement table. Must contain ``depth_col`` and ``label_col``.
    depth_col : str
        Column holding measured depth values (y-axis).
    label_col : str
        Column holding the categorical value to display.
    palette : list of str, optional
        Hex colours, one per category. Cycles if there are more categories than colours.
    marker_symbols : list of str, optional
        Plotly marker symbol names, one per category. Cycles if needed.
    marker_size : int, optional
        Marker size in pixels. Defaults to 8.
    template : str or plotly template, optional
        Plotly template to apply. Defaults to the Baselode template.

    Returns
    -------
    plotly.graph_objects.Figure
    """
    if df.empty or depth_col not in df.columns or label_col not in df.columns:
        return _empty_striplog_figure(template)

    palette = palette or _DEFAULT_POINT_LOG_PALETTE
    marker_symbols = marker_symbols or _DEFAULT_POINT_LOG_SYMBOLS

    # Drop rows with missing depth or label
    df_clean = df[[depth_col, label_col]].dropna(subset=[depth_col, label_col]).copy()
    df_clean[label_col] = df_clean[label_col].astype(str).str.strip()
    df_clean = df_clean[~df_clean[label_col].str.lower().isin({"nan", "null", "none", ""})]

    if df_clean.empty:
        return _empty_striplog_figure(template)

    # Stable ordering: sort alphabetically so colours are reproducible
    unique_cats = sorted(df_clean[label_col].unique())
    n = len(unique_cats)

    # Map each category to an x position spaced evenly in [0, n-1]
    x_pos = {cat: i for i, cat in enumerate(unique_cats)}
    color_map  = {cat: palette[i % len(palette)] for i, cat in enumerate(unique_cats)}
    symbol_map = {cat: marker_symbols[i % len(marker_symbols)] for i, cat in enumerate(unique_cats)}

    traces = []
    for cat in unique_cats:
        subset = df_clean[df_clean[label_col] == cat]
        traces.append(go.Scatter(
            x=[x_pos[cat]] * len(subset),
            y=subset[depth_col].tolist(),
            mode="markers",
            name=cat,
            marker=dict(
                symbol=symbol_map[cat],
                color=color_map[cat],
                size=marker_size,
                line=dict(width=0.5, color="rgba(0,0,0,0.3)"),
            ),
            hovertemplate=f"{cat}<br>depth: %{{y:.1f}} m<extra></extra>",
        ))

    fig = go.Figure(data=traces)
    fig.update_layout(
        xaxis=dict(
            tickvals=list(range(n)),
            ticktext=unique_cats,
            tickangle=-45,
            tickfont=dict(size=9),
            zeroline=False,
            showgrid=False,
            fixedrange=True,
            range=[-0.5, n - 0.5],
        ),
        yaxis=dict(title="Depth (m)", autorange="reversed", zeroline=False),
        legend=dict(title=label_col, font=dict(size=9)),
        showlegend=True,
    )
    return _apply_striplog_defaults(fig, template=template)


def _truncate_annotation(text, max_chars=40):
    """Truncate *text* at a word boundary to roughly *max_chars*, adding an ellipsis."""
    full = " ".join(str(text).split())
    if len(full) <= max_chars:
        return full
    truncated = full[:max_chars]
    if " " in truncated:
        truncated = truncated.rsplit(" ", 1)[0]
    return truncated + "…"


def plot_depth_annotations(df,
    depth_col=DEPTH,
    text_col=COMMENTS,
    marker_color=None,
    template=None):
    """Plot depth-pinned text annotations: a tick at the track's left edge with
    the note text alongside.

    Long notes are word-truncated to ~40 characters for display; the full text
    stays available in hover. The output composes with the other strip-log
    tracks (reversed depth axis, hidden [0, 1] x-axis), so an annotations track
    can sit beside numeric / categorical tracks.

    Parameters
    ----------
    df : pd.DataFrame
        Point rows with *depth_col* and *text_col*.
    depth_col : str
        Column holding the measured depth of each note.
    text_col : str
        Column holding the note text.
    marker_color : str, optional
        Colour for the left-edge tick markers (and text). Defaults to a
        neutral slate.
    template : str or plotly template, optional
        Plotly template to apply. Defaults to the Baselode template.

    Returns
    -------
    plotly.graph_objects.Figure
    """
    if df.empty or depth_col not in df.columns or text_col not in df.columns:
        return _empty_striplog_figure(template)

    clean = df[[depth_col, text_col]].dropna(subset=[depth_col, text_col]).copy()
    clean[text_col] = clean[text_col].astype(str).str.strip()
    clean = clean[~clean[text_col].str.lower().isin({"", "nan", "null", "none"})]
    if clean.empty:
        return _empty_striplog_figure(template)
    clean = clean.sort_values(depth_col)

    colour = marker_color or "#334155"
    depths = clean[depth_col].astype(float).tolist()
    full_texts = [" ".join(text.split()) for text in clean[text_col]]
    trace = go.Scatter(
        x=[0] * len(depths),
        y=depths,
        mode="markers+text",
        marker=dict(symbol="line-ew-open", size=9, color=colour),
        text=[_truncate_annotation(text) for text in full_texts],
        textposition="middle right",
        textfont=dict(size=10, color=colour),
        hovertext=[f"{depth:.1f} m<br>{text}" for depth, text in zip(depths, full_texts)],
        hoverinfo="text",
        showlegend=False,
    )
    layout = go.Layout(
        xaxis=dict(range=[0, 1], visible=False, fixedrange=True),
        yaxis=dict(title="Depth (m)", autorange="reversed", zeroline=False),
        showlegend=False,
    )
    fig = go.Figure(data=[trace], layout=layout)
    return _apply_striplog_defaults(fig, template=template)


def plot_dip_azimuth_log(df,
    depth_col=DEPTH,
    dip_col=DIP,
    azimuth_col=AZIMUTH,
    color_by=None,
    template=None):
    """Plot split dip-magnitude / dip-azimuth tracks sharing one depth axis.

    Two side-by-side subplots: the left track shows dip markers on a fixed
    [0, 90] axis, the right shows dip-direction azimuth markers on a fixed
    [0, 360] axis with ticks every 90°. Depth is shared and reversed, with
    y-unified hover.

    Parameters
    ----------
    df : pd.DataFrame
        Structural measurements with *depth_col*, *dip_col*, *azimuth_col*.
    depth_col, dip_col, azimuth_col : str
        Column names (baselode datamodel defaults).
    color_by : str, optional
        Categorical column (e.g. defect type) — one trace per category with a
        shared legend across both tracks (``legendgroup``).
    template : str or plotly template, optional
        Plotly template to apply. Defaults to the Baselode template.

    Returns
    -------
    plotly.graph_objects.Figure
    """
    required = [depth_col, dip_col, azimuth_col]
    if df.empty or any(col not in df.columns for col in required):
        return _empty_striplog_figure(template)

    extra_cols = [color_by] if color_by and color_by in df.columns else []
    safe = df[required + extra_cols].dropna(subset=required)
    if safe.empty:
        return _empty_striplog_figure(template)

    if extra_cols:
        # Rows with valid angles but a missing category still plot, under an
        # explicit "(uncategorised)" group (label mirrored by the JS
        # buildDipAzimuthConfig), instead of being silently dropped.
        # fillna before astype: Arrow-backed string columns keep missing
        # values as float nan through astype(str).
        category_labels = safe[color_by].fillna("").astype(str).str.strip()
        category_labels = category_labels.where(
            ~category_labels.str.lower().isin({"", "nan", "null", "none"}),
            "(uncategorised)",
        )
        categories = sorted(category_labels.unique())
        groups = [(cat, safe[category_labels == cat]) for cat in categories]
    else:
        groups = [(None, safe)]

    fig = make_subplots(rows=1, cols=2, shared_yaxes=True, horizontal_spacing=0.04)
    for group_index, (cat, rows) in enumerate(groups):
        colour = MULTI_SERIES_COLORWAY[group_index % len(MULTI_SERIES_COLORWAY)]
        legend_group = cat if cat is not None else "measurements"
        marker = dict(size=7, color=colour)
        fig.add_trace(go.Scatter(
            x=rows[dip_col], y=rows[depth_col], mode="markers", marker=marker,
            name=cat, legendgroup=legend_group, showlegend=cat is not None,
            hovertemplate="Dip: %{x:.1f}°<extra></extra>",
        ), row=1, col=1)
        fig.add_trace(go.Scatter(
            x=rows[azimuth_col], y=rows[depth_col], mode="markers", marker=marker,
            name=cat, legendgroup=legend_group, showlegend=False,
            hovertemplate="Azimuth: %{x:.1f}°<extra></extra>",
        ), row=1, col=2)

    fig.update_xaxes(title_text="Dip (°)", range=[0, 90], fixedrange=True,
                     tick0=0, dtick=30, zeroline=False, row=1, col=1)
    fig.update_xaxes(title_text="Azimuth (°)", range=[0, 360], fixedrange=True,
                     tick0=0, dtick=90, zeroline=False, row=1, col=2)
    fig.update_yaxes(title_text="Depth (m)", autorange="reversed", zeroline=False, row=1, col=1)
    fig.update_yaxes(autorange="reversed", zeroline=False, row=1, col=2)
    fig.update_layout(
        template=template if template is not None else BASELODE_TEMPLATE_NAME,
        hovermode="y unified",
        showlegend=bool(extra_cols),
        legend=dict(orientation="h", y=1.02, yanchor="bottom", x=0, font=dict(size=9)),
        margin=dict(l=40, r=10, t=10, b=40),
    )
    return fig


def plot_strike_dip_map(structures, collar_gdf=None, symbol_size=10, easting_col=EASTING, northing_col=NORTHING, dip_col=DIP, az_col=AZIMUTH, label_col="defect", template=None):
    """2D map view with strike/dip symbols.

    Renders each structural measurement as a line (strike direction) with a
    perpendicular tick (dip direction). Requires easting/northing on the
    structures DataFrame (from attach_structure_positions) or collar coordinates.

    Parameters
    ----------
    structures : pd.DataFrame
        Structural data with easting, northing, dip, azimuth columns.
    collar_gdf : geopandas.GeoDataFrame, optional
        Collar locations to overlay.
    symbol_size : float
        Strike line half-length in map units.
    template : str or plotly template, optional
        Plotly template to apply. Defaults to the Baselode template.
    """
    if structures.empty:
        return _empty_striplog_figure(template)

    if easting_col not in structures.columns or northing_col not in structures.columns:
        return _empty_striplog_figure(template)

    safe = structures.dropna(subset=[easting_col, northing_col, dip_col, az_col])
    if safe.empty:
        return _empty_striplog_figure(template)

    symbol_traces = []
    for _, row in safe.iterrows():
        x = float(row[easting_col])
        y = float(row[northing_col])
        dip = float(row[dip_col])
        az = float(row[az_col])
        strike_az = (az - 90) % 360
        strike_rad = math.radians(strike_az)

        # Strike line endpoints
        dx_s = symbol_size * math.sin(strike_rad)
        dy_s = symbol_size * math.cos(strike_rad)
        # Dip tick (short line in dip direction, at midpoint of strike line)
        tick_len = symbol_size * 0.4 * (dip / 90.0)
        dip_rad = math.radians(az)
        dx_d = tick_len * math.sin(dip_rad)
        dy_d = tick_len * math.cos(dip_rad)

        label = str(row.get(label_col, "")) if label_col in row.index else ""
        hover = f"{label}<br>Dip: {dip:.1f}° Az: {az:.1f}°"

        # Strike line
        symbol_traces.append(go.Scatter(
            x=[x - dx_s, x + dx_s, None],
            y=[y - dy_s, y + dy_s, None],
            mode="lines",
            line=dict(color=MULTI_SERIES_COLORWAY[0], width=2),
            showlegend=False,
            hoverinfo="skip",
        ))
        # Dip tick from center
        symbol_traces.append(go.Scatter(
            x=[x, x + dx_d, None],
            y=[y, y + dy_d, None],
            mode="lines",
            line=dict(color=MULTI_SERIES_COLORWAY[0], width=2),
            showlegend=False,
            hoverinfo="skip",
        ))
        # Invisible hover point at center
        symbol_traces.append(go.Scatter(
            x=[x],
            y=[y],
            mode="markers",
            marker=dict(size=8, color="rgba(0,0,0,0)"),
            showlegend=False,
            hovertext=hover,
            hoverinfo="text",
        ))

    fig = go.Figure(data=symbol_traces)

    if collar_gdf is not None and not collar_gdf.empty:
        try:
            collar_x = collar_gdf.geometry.x
            collar_y = collar_gdf.geometry.y
            collar_ids = collar_gdf.get(HOLE_ID, collar_gdf.index)
            fig.add_trace(go.Scatter(
                x=collar_x,
                y=collar_y,
                mode="markers+text",
                text=collar_ids,
                textposition="top center",
                marker=dict(size=6, color="#ef4444"),
                showlegend=False,
                hoverinfo="text",
            ))
        except Exception:
            pass

    fig.update_layout(
        template=template if template is not None else BASELODE_TEMPLATE_NAME,
        margin=dict(l=40, r=10, t=10, b=40),
        xaxis=dict(title="Easting (m)", scaleanchor="y", scaleratio=1),
        yaxis=dict(title="Northing (m)"),
        showlegend=False,
    )
    return fig


def plot_core_photo_log(df,
    from_col="from_depth",
    to_col="to_depth",
    image_url_col="image_url",
    photo_set_col="photo_set",
    photo_sets=None,
    depth_range=None,
    image_width=0.8,
    template=None):
    """Render depth-registered core box photographs as a Plotly figure.

    Images are placed as Plotly layout images anchored to the y (depth) axis so
    they align precisely with the depth interval they represent.  Multiple photo
    sets can be plotted side-by-side in separate subplot columns.

    Parameters
    ----------
    df : pandas.DataFrame
        Core photo table.  Must contain columns for ``from_col``, ``to_col``,
        and ``image_url_col``.  An optional ``photo_set_col`` column allows
        photos to be grouped into named sets.
    from_col : str
        Column holding the top depth (metres) of each core box. Default ``"from_depth"``.
    to_col : str
        Column holding the bottom depth (metres) of each core box. Default ``"to_depth"``.
    image_url_col : str
        Column holding the image URL or data-URI. Default ``"image_url"``.
    photo_set_col : str
        Column holding the photo set label (e.g. ``"Wet"`` / ``"Dry"``).
        Rows without this column or with null values are treated as a single
        ``"default"`` set. Default ``"photo_set"``.
    photo_sets : list of str, optional
        Ordered list of photo sets to display.  If *None*, all unique sets found
        in ``df`` are used in the order they first appear.
    depth_range : tuple of (float, float), optional
        ``(min_depth, max_depth)`` in metres.  Defaults to the full extent of
        the data.
    image_width : float
        Fractional width of each image relative to its subplot column (0–1).
        Default 0.8.
    template : str or plotly template, optional
        Plotly template to apply. Defaults to the Baselode template.

    Returns
    -------
    plotly.graph_objects.Figure
        A figure with one subplot column per photo set, each containing the
        depth-registered core box images on the y-axis.
    """
    required = [from_col, to_col, image_url_col]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"plot_core_photo_log: missing columns {missing}")

    # Normalise the photo_set column.
    if photo_set_col in df.columns:
        df = df.copy()
        df[photo_set_col] = df[photo_set_col].fillna("default").astype(str).str.strip()
        df.loc[df[photo_set_col] == "", photo_set_col] = "default"
    else:
        df = df.copy()
        df[photo_set_col] = "default"

    # Determine which sets to render and their order.
    if photo_sets is None:
        photo_sets = list(dict.fromkeys(df[photo_set_col].tolist()))

    if not photo_sets:
        return _empty_striplog_figure(template)

    # Determine depth extent.
    all_from = pd.to_numeric(df[from_col], errors="coerce").dropna()
    all_to   = pd.to_numeric(df[to_col],   errors="coerce").dropna()
    if all_from.empty:
        return _empty_striplog_figure(template)

    min_depth = float(all_from.min()) if depth_range is None else float(depth_range[0])
    max_depth = float(all_to.max())   if depth_range is None else float(depth_range[1])

    # Filter rows to the depth range so images outside the visible window are
    # not added as layout images.
    df = df.copy()
    df[from_col] = pd.to_numeric(df[from_col], errors="coerce")
    df[to_col]   = pd.to_numeric(df[to_col],   errors="coerce")
    df = df[(df[from_col] < max_depth) & (df[to_col] > min_depth)]

    n_sets = len(photo_sets)
    fig = make_subplots(
        rows=1,
        cols=n_sets,
        shared_yaxes=True,
        horizontal_spacing=0.02,
        subplot_titles=photo_sets,
    )

    for col_idx, set_name in enumerate(photo_sets, start=1):
        subset = df[df[photo_set_col] == set_name].copy()
        subset[from_col] = pd.to_numeric(subset[from_col], errors="coerce")
        subset[to_col]   = pd.to_numeric(subset[to_col],   errors="coerce")
        subset = subset.dropna(subset=[from_col, to_col]).sort_values(from_col)

        # Invisible scatter trace to anchor the y-axis.
        fig.add_trace(
            go.Scatter(
                x=[0.5] * 2,
                y=[min_depth, max_depth],
                mode="markers",
                marker=dict(opacity=0),
                showlegend=False,
                hoverinfo="skip",
            ),
            row=1,
            col=col_idx,
        )

        # Determine which x-axis / y-axis pair this subplot uses.
        axis_suffix = "" if col_idx == 1 else str(col_idx)

        for _, row in subset.iterrows():
            from_d = float(row[from_col])
            to_d   = float(row[to_col])
            url    = str(row[image_url_col])
            if not url:
                continue

            fig.add_layout_image(
                dict(
                    source=url,
                    xref=f"x{axis_suffix}",
                    yref=f"y{axis_suffix}",
                    x=0.5 - image_width / 2,
                    y=from_d,
                    sizex=image_width,
                    sizey=to_d - from_d,
                    xanchor="left",
                    yanchor="top",
                    sizing="stretch",
                    layer="below",
                )
            )

    # Shared y-axis configuration: depth increases downward.
    fig.update_yaxes(
        autorange="reversed",
        range=[max_depth, min_depth],
        title_text="Depth (m)",
        row=1,
        col=1,
    )
    for col_idx in range(2, n_sets + 1):
        fig.update_yaxes(autorange="reversed", range=[max_depth, min_depth], row=1, col=col_idx)

    fig.update_xaxes(range=[0, 1], visible=False, fixedrange=True)
    fig.update_layout(
        template=template if template is not None else BASELODE_TEMPLATE_NAME,
        margin=dict(l=40, r=10, t=30, b=40),
    )
    return fig
