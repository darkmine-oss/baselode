# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd

"""Tests for the numeric strip-log graph types ported from the JS viz:
graded (value-coloured) line, colour-by-categorical, multi-assay stacked
line/bar, interval-width bars, and the depth-unified hover."""

import pandas as pd

from baselode.drill import view


# Three 4 m intervals; Bi is below detection (-2) at the top and bottom.
ROWS = pd.DataFrame([
    {"from": 0, "to": 4, "Au_ppm": 0.10, "Cu_ppm": 40, "Bi_ppm": -2, "lithology": "SAP"},
    {"from": 4, "to": 8, "Au_ppm": 0.35, "Cu_ppm": 55, "Bi_ppm": 3, "lithology": "SAP"},
    {"from": 8, "to": 12, "Au_ppm": 0.90, "Cu_ppm": 20, "Bi_ppm": -2, "lithology": "BAS"},
])


def _points(col):
    return view.compute_interval_points(ROWS, col)


def test_striplog_layout_uses_depth_unified_hover():
    fig = view.plot_numeric_trace(_points("Au_ppm"), "Au_ppm", chart_type="markers+line")
    assert fig.layout.hovermode == "y unified"


def test_bar_sized_to_interval_with_no_error_bars():
    fig = view.plot_numeric_trace(_points("Au_ppm"), "Au_ppm", chart_type="bar")
    bar = fig.data[0]
    assert bar.type == "bar"
    assert bar.orientation == "h"
    # Bar thickness equals the interval length (4 m each here).
    assert list(bar.width) == [4.0, 4.0, 4.0]
    # No error bars — extent is the bar itself.
    assert bar.error_y.array is None


def test_markers_keep_error_bars():
    fig = view.plot_numeric_trace(_points("Au_ppm"), "Au_ppm", chart_type="markers+line")
    assert fig.data[0].error_y.array is not None


def test_graded_line_colours_markers_by_value_with_colourbar():
    fig = view.plot_numeric_trace(_points("Au_ppm"), "Au_ppm", chart_type="colored-line")
    marker = fig.data[0].marker
    assert fig.data[0].mode == "lines+markers"
    assert marker.showscale is True
    assert marker.colorbar.thickness == 8
    assert marker.cmin == 0.10 and marker.cmax == 0.90
    # Right gutter widened so the colour bar sits outside the plot area.
    assert fig.layout.margin.r > 20


def test_colour_numeric_by_categorical_emits_legend_traces_and_line():
    fig = view.plot_drillhole_trace(
        ROWS, "Au_ppm", chart_type="markers+line", color_by="lithology",
    )
    assert fig.layout.showlegend is True
    named = sorted(t.name for t in fig.data if t.showlegend)
    assert named == ["BAS", "SAP"]
    # A neutral connecting line (not in the legend) is present for line types.
    assert any(t.mode == "lines" and t.showlegend is False for t in fig.data)
    # Category hover surfaces the colour-by label.
    assert "lithology" in [t for t in fig.data if t.showlegend][0].hovertemplate


def test_colour_by_uses_the_configured_colour_map_for_categories():
    fig = view.plot_drillhole_trace(
        ROWS, "Au_ppm", chart_type="markers",
        color_by="lithology", colour_map={"SAP": "#111111", "BAS": "#222222"},
    )
    by_name = {t.name: t.marker.color for t in fig.data if t.showlegend}
    assert by_name["SAP"] == "#111111"
    assert by_name["BAS"] == "#222222"


def test_colour_by_categorical_bar_variant_has_no_connecting_line():
    fig = view.plot_drillhole_trace(ROWS, "Au_ppm", chart_type="bar", color_by="lithology")
    bars = [t for t in fig.data if t.type == "bar"]
    assert bars and all(t.orientation == "h" for t in bars)
    assert not any(getattr(t, "mode", None) == "lines" for t in fig.data)


def test_assign_categories_by_depth_uses_mid_depth_and_ignores_blanks():
    points = _points("Au_ppm")  # mid-depths 10, 6, 2 (deep→shallow)
    segments = view.compute_interval_points(ROWS, "lithology")
    cats = view.assign_categories_by_depth(points, segments)
    assert cats == ["BAS", "SAP", "SAP"]
    # A nan/blank category segment yields no assignment.
    blank = pd.DataFrame([{"from_val": 0, "to_val": 12, "val": "NaN"}])
    assert view.assign_categories_by_depth(points, blank) == [None, None, None]


def test_multi_line_stacks_raw_values_as_areas_and_floors_below_detection():
    fig = view.plot_multi_assay(ROWS, ["Au_ppm", "Cu_ppm", "Bi_ppm"], mode="multi-line")
    assert len(fig.data) == 3
    assert all(t.type == "scatter" and t.stackgroup == "assays" and t.orientation == "h" for t in fig.data)
    bi = next(t for t in fig.data if t.name == "Bi_ppm")
    # Below-detection (-2) floored to 0 in the plotted x; true value in hover.
    assert list(bi.x) == [0.0, 3.0, 0.0]
    assert [cd[0] for cd in bi.customdata] == [-2.0, 3.0, -2.0]
    assert fig.layout.hovermode == "y unified"
    # Element label precedes the value (colour swatch alone is not enough).
    assert bi.hovertemplate.startswith("Bi_ppm: ")


def test_multi_stacked_uses_stacked_horizontal_bars():
    fig = view.plot_multi_assay(ROWS, ["Au_ppm", "Cu_ppm"], mode="multi-stacked")
    assert fig.layout.barmode == "stack"
    assert all(t.type == "bar" and t.orientation == "h" for t in fig.data)


def test_multi_assay_aligns_sparse_series_onto_shared_depth_grid():
    # As present only in the middle interval; Au in all three.
    sparse = pd.DataFrame([
        {"from": 0, "to": 4, "Au_ppm": 0.1},
        {"from": 4, "to": 8, "Au_ppm": 0.3, "As_ppm": 5},
        {"from": 8, "to": 12, "Au_ppm": 0.9},
    ])
    fig = view.plot_multi_assay(sparse, ["Au_ppm", "As_ppm"], mode="multi-line")
    au = next(t for t in fig.data if t.name == "Au_ppm")
    as_ = next(t for t in fig.data if t.name == "As_ppm")
    assert len(au.x) == len(as_.x) == 3
    # The two intervals As does not cover are filled with 0 (deep→shallow order).
    assert list(as_.x) == [0.0, 5.0, 0.0]


def test_multi_assay_empty_when_no_series_have_points():
    fig = view.plot_multi_assay(pd.DataFrame({"Au_ppm": []}), ["Au_ppm"], mode="multi-line")
    assert list(fig.data) == []
