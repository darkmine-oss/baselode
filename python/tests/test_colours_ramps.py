# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd

"""Tests for the sequential/qualitative ramps and colour helpers used by the
numeric strip logs. Mirrors the JS `buildPlotlyColorscale` / colour coverage."""

from baselode.colours import (
    ASSAY_COLOR_PALETTE_10,
    MULTI_SERIES_COLORWAY,
    build_plotly_colorscale,
    series_colour,
    with_alpha,
)


def test_build_plotly_colorscale_spreads_stops_evenly():
    scale = build_plotly_colorscale(["#000000", "#777777", "#ffffff"])
    assert scale == [[0.0, "#000000"], [0.5, "#777777"], [1.0, "#ffffff"]]


def test_build_plotly_colorscale_single_colour_no_divide_by_zero():
    assert build_plotly_colorscale(["#abcdef"]) == [[0.0, "#abcdef"], [1.0, "#abcdef"]]


def test_build_plotly_colorscale_defaults_to_assay_palette_full_range():
    scale = build_plotly_colorscale()
    assert len(scale) == len(ASSAY_COLOR_PALETTE_10)
    assert scale[0][0] == 0.0
    assert scale[-1][0] == 1.0


def test_series_colour_prefers_commodity_then_colorway():
    assert series_colour("Au_ppm", 0) == "#FFD700"  # gold commodity colour
    # An unknown element falls back to the colorway by index.
    assert series_colour("Xyz_ppm", 1) == MULTI_SERIES_COLORWAY[1]


def test_with_alpha_converts_hex_to_rgba_and_passes_through_others():
    assert with_alpha("#4e79a7", 0.5) == "rgba(78, 121, 167, 0.5)"
    assert with_alpha("#abc", 1) == "rgba(170, 187, 204, 1)"
    # Non-hex input is returned unchanged.
    assert with_alpha("rebeccapurple", 0.5) == "rebeccapurple"
