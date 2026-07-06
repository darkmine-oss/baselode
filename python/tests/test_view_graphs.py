# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd

"""Tests for the numeric strip-log graph types ported from the JS viz:
graded (value-coloured) line, colour-by-categorical, multi-assay stacked
line/bar, interval-width bars, and the depth-unified hover; plus the
filled/stepped/heat-strip chart types, log scaling, two-curve fill,
composition, pattern fills, and depth annotations."""

import pandas as pd
import pytest

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


def test_colour_by_line_only_colours_the_line_without_markers():
    fig = view.plot_drillhole_trace(
        ROWS, "Au_ppm", chart_type="line", color_by="lithology",
    )
    # Every trace is a line — no marker traces, no neutral grey connector.
    assert fig.data and all(t.mode == "lines" for t in fig.data)
    assert all(t.line.color != "rgba(136,136,136,0.5)" for t in fig.data)
    # Legend lists each category once.
    legend_names = [t.name for t in fig.data if t.showlegend]
    assert legend_names == list(dict.fromkeys(legend_names))


def test_colour_by_categorical_bar_variant_has_no_connecting_line():
    fig = view.plot_drillhole_trace(ROWS, "Au_ppm", chart_type="bar", color_by="lithology")
    bars = [t for t in fig.data if t.type == "bar"]
    assert bars and all(t.orientation == "h" for t in bars)
    assert not any(getattr(t, "mode", None) == "lines" for t in fig.data)


def test_new_chart_types_take_precedence_over_colour_by():
    """filled-line / step-line / heat-strip keep their geometry when colour-by
    is requested — the category-coloured builder can't render them."""
    stepped = view.plot_drillhole_trace(ROWS, "Au_ppm", chart_type="step-line", color_by="lithology")
    assert len(stepped.data) == 1
    assert list(stepped.data[0].x) == [0.10, 0.10, 0.35, 0.35, 0.90, 0.90]

    filled = view.plot_drillhole_trace(ROWS, "Au_ppm", chart_type="filled-line", color_by="lithology")
    assert filled.data[0].fill == "tozerox"

    heat = view.plot_drillhole_trace(ROWS, "Au_ppm", chart_type="heat-strip", color_by="lithology")
    assert heat.data[0].type == "bar"
    assert heat.data[0].marker.showscale is True


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


# ---------------------------------------------------------------------------
# filled-line / step-line / heat-strip chart types
# ---------------------------------------------------------------------------


def test_filled_line_shades_back_to_zero_without_error_bars():
    fig = view.plot_numeric_trace(_points("Au_ppm"), "Au_ppm", chart_type="filled-line")
    trace = fig.data[0]
    assert trace.mode == "lines"
    assert trace.fill == "tozerox"
    # Fill is the series colour at alpha 0.35; the line on top stays solid.
    assert trace.fillcolor == "rgba(139, 30, 63, 0.35)"
    assert trace.line.color == "#8b1e3f"
    assert trace.error_y.array is None


def test_bar_floors_below_detection_with_raw_in_hover():
    """Bars never extend left of zero for below-detection sentinels; the raw
    value stays in the hover customdata."""
    fig = view.plot_numeric_trace(_points("Bi_ppm"), "Bi_ppm", chart_type="bar")
    bar = fig.data[0]
    assert min(bar.x) == 0
    raw_values = [row[2] for row in bar.customdata]
    assert -2 in raw_values
    assert "%{customdata[2]}" in bar.hovertemplate


def test_filled_line_floors_below_detection_with_raw_in_hover():
    """Negative below-detection sentinels floor at 0 so the fill never paints
    a phantom band across zero; the raw value stays in the hover customdata."""
    fig = view.plot_numeric_trace(_points("Bi_ppm"), "Bi_ppm", chart_type="filled-line")
    trace = fig.data[0]
    assert min(trace.x) == 0
    raw_values = [row[2] for row in trace.customdata]
    assert -2 in raw_values
    assert "%{customdata[2]}" in trace.hovertemplate


def test_step_line_builds_two_points_per_interval_shallow_to_deep():
    fig = view.plot_numeric_trace(_points("Au_ppm"), "Au_ppm", chart_type="step-line")
    assert len(fig.data) == 1
    trace = fig.data[0]
    assert trace.mode == "lines"
    # (val, from) and (val, to) per interval, connected across boundaries.
    assert list(trace.x) == [0.10, 0.10, 0.35, 0.35, 0.90, 0.90]
    assert list(trace.y) == [0.0, 4.0, 4.0, 8.0, 8.0, 12.0]
    assert trace.error_y.array is None


def test_heat_strip_fills_track_width_and_colours_by_value():
    fig = view.plot_numeric_trace(_points("Au_ppm"), "Au_ppm", chart_type="heat-strip")
    bar = fig.data[0]
    assert bar.type == "bar"
    assert bar.orientation == "h"
    # Dummy full-width bars: base 0, length 1, thickness = interval extent.
    assert list(bar.x) == [1.0, 1.0, 1.0]
    assert bar.base == 0
    assert list(bar.width) == [4.0, 4.0, 4.0]
    # Value drives the colour ramp with a slim colour bar.
    assert list(bar.marker.color) == [0.90, 0.35, 0.10]
    assert bar.marker.showscale is True
    assert bar.marker.colorbar.thickness == 8
    # X axis is hidden and fixed; hover reports the value, not the dummy x.
    assert fig.layout.xaxis.range == (0, 1)
    assert fig.layout.xaxis.showticklabels is False
    assert not fig.layout.xaxis.title.text
    assert "Au_ppm: %{customdata[0]}" in bar.hovertemplate


def test_heat_strip_floors_below_detection_in_the_colour_ramp():
    """Sentinels colour as zero grade instead of dragging cmin below zero;
    the raw value stays in the hover customdata."""
    fig = view.plot_numeric_trace(_points("Bi_ppm"), "Bi_ppm", chart_type="heat-strip")
    bar = fig.data[0]
    assert min(bar.marker.color) == 0
    assert bar.marker.cmin == 0
    raw_values = [row[0] for row in bar.customdata]
    assert -2 in raw_values


def test_two_curve_fill_floors_below_detection_before_interpolation():
    """Sentinels are floored before interpolation so they cannot fabricate
    slopes, crossings, or fill below zero."""
    rows = pd.DataFrame([
        {"from": 0, "to": 4, "density": -1.0, "neutron": 2.0},
        {"from": 4, "to": 8, "density": 5.0, "neutron": 2.0},
        {"from": 8, "to": 12, "density": -1.0, "neutron": 2.0},
    ])
    fig = view.plot_two_curve_fill(rows, "density", "neutron")
    for trace in fig.data:
        assert min(trace.x) >= 0


# ---------------------------------------------------------------------------
# log_scale option
# ---------------------------------------------------------------------------


def test_log_scale_switches_value_axis_for_line_charts():
    fig = view.plot_numeric_trace(_points("Au_ppm"), "Au_ppm", chart_type="line", log_scale=True)
    assert fig.layout.xaxis.type == "log"


def test_log_scale_is_ignored_for_heat_strip_and_graded_line():
    for chart_type in ("heat-strip", "colored-line"):
        fig = view.plot_numeric_trace(_points("Au_ppm"), "Au_ppm", chart_type=chart_type, log_scale=True)
        assert fig.layout.xaxis.type != "log"


def test_log_scale_threads_through_the_dispatcher_and_colour_by():
    fig = view.plot_drillhole_trace(ROWS, "Au_ppm", chart_type="bar", log_scale=True)
    assert fig.layout.xaxis.type == "log"
    fig = view.plot_drillhole_trace(
        ROWS, "Au_ppm", chart_type="markers", color_by="lithology", log_scale=True,
    )
    assert fig.layout.xaxis.type == "log"


def test_log_scale_defaults_off():
    fig = view.plot_numeric_trace(_points("Au_ppm"), "Au_ppm", chart_type="line")
    assert fig.layout.xaxis.type != "log"


# ---------------------------------------------------------------------------
# Two-curve fill
# ---------------------------------------------------------------------------


TWO_CURVE_ROWS = pd.DataFrame([
    {"from": 0, "to": 4, "density": 1.0, "neutron": 3.0},
    {"from": 4, "to": 8, "density": 3.0, "neutron": 1.0},
    {"from": 8, "to": 12, "density": 5.0, "neutron": 1.0},
])


def test_two_curve_fill_splits_shading_at_the_crossover():
    fig = view.plot_two_curve_fill(TWO_CURVE_ROWS, "density", "neutron")
    # Two dominance runs → (anchor + fill) per run, plus the two main curves.
    fills = [t for t in fig.data if t.fill == "tonextx"]
    curves = [t for t in fig.data if t.showlegend]
    assert len(fills) == 2
    assert [t.name for t in curves] == ["density", "neutron"]
    assert len(fig.data) == 6
    # Where A (density) > B: A's colour at alpha 0.4; where B > A: B's colour.
    fill_colours = {t.fillcolor for t in fills}
    assert fill_colours == {"rgba(78, 121, 167, 0.4)", "rgba(242, 142, 43, 0.4)"}
    # Fill traces stay silent — hover lives on the curves.
    assert all(t.hoverinfo == "skip" and t.showlegend is False for t in fills)


def test_two_curve_fill_interpolates_the_crossing_depth():
    fig = view.plot_two_curve_fill(TWO_CURVE_ROWS, "density", "neutron")
    fills = [t for t in fig.data if t.fill == "tonextx"]
    # Curves cross midway between mids 6 and 2 (values 3/1 vs 1/3) → depth 4.
    boundary_depths = [t.y[-1] for t in fills[:1]] + [t.y[0] for t in fills[1:]]
    assert all(depth == pytest.approx(4.0) for depth in boundary_depths)


def test_two_curve_fill_interpolates_offset_grids_without_zero_fill():
    """Curves sampled on different interval grids are linearly interpolated
    onto the union of mid-depths — never zero-filled (which would fabricate
    crossovers and bogus fill dominance)."""
    offset_rows = pd.DataFrame([
        {"from": 0, "to": 4, "density": 10.0},   # mid 2
        {"from": 4, "to": 8, "density": 10.0},   # mid 6
        {"from": 2, "to": 6, "neutron": 4.0},    # mid 4 — no density sample here
    ])
    fig = view.plot_two_curve_fill(offset_rows, "density", "neutron")
    curves = {t.name: t for t in fig.data if t.showlegend}
    density_by_depth = dict(zip(curves["density"].y, curves["density"].x))
    # At neutron's mid-depth 4 density is interpolated (10.0), not 0.
    assert density_by_depth[4.0] == pytest.approx(10.0)
    # Constant 10 vs constant 4 never cross → a single dominance run.
    fills = [t for t in fig.data if t.fill == "tonextx"]
    assert len(fills) == 1


def test_two_curve_fill_respects_colour_overrides_and_log_scale():
    fig = view.plot_two_curve_fill(
        TWO_CURVE_ROWS, "density", "neutron",
        color_a="#111111", color_b="#222222", log_scale=True,
    )
    curves = {t.name: t for t in fig.data if t.showlegend}
    assert curves["density"].line.color == "#111111"
    assert curves["neutron"].line.color == "#222222"
    assert fig.layout.xaxis.type == "log"
    assert fig.layout.yaxis.autorange == "reversed"


def test_two_curve_fill_empty_when_a_column_is_missing():
    fig = view.plot_two_curve_fill(TWO_CURVE_ROWS, "density", "gamma")
    assert list(fig.data) == []


# ---------------------------------------------------------------------------
# Composition log
# ---------------------------------------------------------------------------


COMPOSITION_ROWS = pd.DataFrame([
    {"from": 0, "to": 4, "sand": 50.0, "silt": 30.0, "clay": 20.0},
    {"from": 4, "to": 8, "sand": 0.0, "silt": 0.0, "clay": 0.0},
    {"from": 8, "to": 12, "sand": -5.0, "silt": 60.0, "clay": 40.0},
])


def test_composition_log_normalizes_each_interval_to_fractions():
    fig = view.plot_composition_log(COMPOSITION_ROWS, ["sand", "silt", "clay"])
    assert [t.name for t in fig.data] == ["sand", "silt", "clay"]
    assert fig.layout.barmode == "stack"
    # The all-zero interval is skipped: two intervals remain (mids 2 and 10).
    sand = fig.data[0]
    assert list(sand.y) == [2.0, 10.0]
    assert list(sand.width) == [4.0, 4.0]
    # Fractions per interval sum to 1.
    for point_index in range(2):
        total = sum(t.x[point_index] for t in fig.data)
        assert total == pytest.approx(1.0)
    # Normalized axis: fixed [0, 1], percent ticks, "Fraction" title.
    assert fig.layout.xaxis.range == (0, 1)
    assert fig.layout.xaxis.tickformat == ".0%"
    assert fig.layout.xaxis.title.text == "Fraction"


def test_composition_log_drops_components_without_readings():
    """Absent or all-null components never render as measured zeros."""
    with_empty = COMPOSITION_ROWS.assign(ash=float("nan"))
    fig = view.plot_composition_log(with_empty, ["sand", "ash", "no_such_column", "silt"])
    assert [trace.name for trace in fig.data] == ["sand", "silt"]


def test_composition_log_clamps_negatives_but_keeps_raw_in_hover():
    fig = view.plot_composition_log(COMPOSITION_ROWS, ["sand", "silt", "clay"])
    sand = fig.data[0]
    # -5 is clamped to a 0-width stack slice; the raw value rides in customdata.
    assert sand.x[1] == pytest.approx(0.0)
    assert sand.customdata[1][0] == -5.0


def test_composition_log_raw_mode_autoranges_the_axis():
    fig = view.plot_composition_log(COMPOSITION_ROWS, ["sand", "silt", "clay"], normalize=False)
    sand = fig.data[0]
    assert list(sand.x) == [50.0, 0.0]
    assert fig.layout.xaxis.range is None
    assert fig.layout.xaxis.title.text == "Value"


def test_composition_log_uses_colour_map_with_colorway_fallback():
    fig = view.plot_composition_log(
        COMPOSITION_ROWS, ["sand", "silt", "clay"], colour_map={"Sand": "#123456"},
    )
    by_name = {t.name: t.marker.color for t in fig.data}
    assert by_name["sand"] == "#123456"  # case-insensitive map hit
    assert by_name["silt"] == "#f28e2b"  # MULTI_SERIES_COLORWAY fallback (index 1)


def test_composition_log_empty_inputs():
    assert list(view.plot_composition_log(pd.DataFrame(), ["sand"]).data) == []
    assert list(view.plot_composition_log(COMPOSITION_ROWS, ["gamma"]).data) == []


# ---------------------------------------------------------------------------
# Pattern (hatch) fills on categorical bands
# ---------------------------------------------------------------------------


LITHOLOGY_ROWS = pd.DataFrame([
    {"from": 0, "to": 5, "lithology": "Sandstone"},
    {"from": 5, "to": 9, "lithology": "shale"},
    {"from": 9, "to": 15, "lithology": "pegmatite"},
])


def test_strip_log_applies_builtin_lithology_patterns_case_insensitively():
    fig = view.plot_strip_log(
        LITHOLOGY_ROWS, label_col="lithology",
        colour_map="lithology", pattern_map="lithology",
    )
    by_name = {t.name: t for t in fig.data}
    assert by_name["Sandstone"].marker.pattern.shape == "."
    assert by_name["shale"].marker.pattern.shape == "-"
    # Hatch reads as a light overlay on the band colour.
    pattern = by_name["Sandstone"].marker.pattern
    assert pattern.solidity == 0.3
    assert pattern.fgcolor == "#ffffff"
    assert pattern.bgcolor == by_name["Sandstone"].marker.color
    assert pattern.size == 6
    # Categories absent from the map stay solid (no pattern emitted).
    assert not by_name["pegmatite"].marker.pattern.shape


def test_strip_log_without_pattern_map_matches_previous_output():
    fig = view.plot_strip_log(LITHOLOGY_ROWS, label_col="lithology")
    assert all(not t.marker.pattern.shape for t in fig.data)


def test_categorical_trace_accepts_a_custom_pattern_map():
    points = view.compute_interval_points(LITHOLOGY_ROWS, "lithology")
    fig = view.plot_categorical_trace(
        points, "lithology", pattern_map={"PEGMATITE": "x"},
    )
    by_name = {t.name: t for t in fig.data}
    assert by_name["pegmatite"].marker.pattern.shape == "x"
    assert not by_name["shale"].marker.pattern.shape


def test_unknown_builtin_pattern_map_name_raises():
    with pytest.raises(ValueError, match="pattern map"):
        view.plot_strip_log(LITHOLOGY_ROWS, label_col="lithology", pattern_map="nope")


# ---------------------------------------------------------------------------
# Depth-pinned annotations
# ---------------------------------------------------------------------------


def test_depth_annotations_pin_text_at_depth_with_truncation():
    long_note = "Highly fractured zone with clay gouge and minor quartz veining throughout"
    df = pd.DataFrame({
        "depth": [12.5, 48.0],
        "comments": ["Water inflow", long_note],
    })
    fig = view.plot_depth_annotations(df)
    trace = fig.data[0]
    assert trace.mode == "markers+text"
    assert trace.marker.symbol == "line-ew-open"
    assert list(trace.x) == [0, 0]
    assert list(trace.y) == [12.5, 48.0]
    assert trace.textposition == "middle right"
    # Long text is word-truncated to ~40 chars with an ellipsis...
    assert trace.text[1].endswith("…")
    assert len(trace.text[1]) <= 41
    # ...while the full text stays available in hover.
    assert long_note in trace.hovertext[1]
    # Composes with the other tracks: hidden fixed x, reversed depth axis.
    assert fig.layout.xaxis.range == (0, 1)
    assert fig.layout.xaxis.visible is False
    assert fig.layout.yaxis.autorange == "reversed"


def test_depth_annotations_skip_blank_rows_and_empty_frames():
    df = pd.DataFrame({"depth": [1.0, 2.0, None], "comments": ["ok", "  ", "missing depth"]})
    fig = view.plot_depth_annotations(df)
    assert list(fig.data[0].y) == [1.0]
    assert list(view.plot_depth_annotations(pd.DataFrame()).data) == []
