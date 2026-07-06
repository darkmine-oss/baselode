# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd

"""Tests that the CHART_OPTIONS lists match the JS columnMeta lists exactly
(same values, labels, and order) so both dropdowns stay in sync."""

from baselode.drill.columns import (
    CHART_OPTIONS,
    DISPLAY_CATEGORICAL,
    DISPLAY_COMMENT,
    DISPLAY_NUMERIC,
    DISPLAY_TADPOLE,
    available_chart_types,
)


def test_numeric_chart_options_match_js_column_meta():
    assert CHART_OPTIONS[DISPLAY_NUMERIC] == [
        {"value": "bar", "label": "Bars"},
        {"value": "markers", "label": "Markers"},
        {"value": "markers+line", "label": "Markers + Line"},
        {"value": "line", "label": "Line only"},
        {"value": "colored-line", "label": "Graded line"},
        {"value": "multi-line", "label": "Multiple: lines"},
        {"value": "multi-stacked", "label": "Multiple: stacked bars"},
        {"value": "filled-line", "label": "Filled line"},
        {"value": "step-line", "label": "Stepped line"},
        {"value": "heat-strip", "label": "Heat strip"},
        {"value": "two-curve", "label": "Two-curve fill"},
        {"value": "composition", "label": "Composition"},
    ]


def test_categorical_chart_options_match_js_column_meta():
    assert CHART_OPTIONS[DISPLAY_CATEGORICAL] == [
        {"value": "categorical", "label": "Categorical bands"},
        {"value": "point-log", "label": "Point log"},
    ]


def test_comment_chart_options_match_js_column_meta():
    assert CHART_OPTIONS[DISPLAY_COMMENT] == [
        {"value": "comment", "label": "Comments"},
        {"value": "annotations", "label": "Annotations"},
    ]


def test_tadpole_chart_options_match_js_column_meta():
    assert CHART_OPTIONS[DISPLAY_TADPOLE] == [
        {"value": "tadpole", "label": "Tadpole"},
        {"value": "dip-azimuth", "label": "Dip / azimuth"},
    ]


def test_new_chart_type_values_are_available():
    types = available_chart_types(DISPLAY_NUMERIC)
    for value in ("filled-line", "step-line", "heat-strip", "colored-line", "multi-line", "multi-stacked", "two-curve", "composition"):
        assert value in types
    assert "point-log" in available_chart_types(DISPLAY_CATEGORICAL)
    assert "annotations" in available_chart_types(DISPLAY_COMMENT)
    assert "dip-azimuth" in available_chart_types(DISPLAY_TADPOLE)
