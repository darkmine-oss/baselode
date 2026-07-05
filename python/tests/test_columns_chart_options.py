# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd

"""Tests that the numeric CHART_OPTIONS list matches the JS columnMeta list
exactly (same values, labels, and order) so both dropdowns stay in sync."""

from baselode.drill.columns import CHART_OPTIONS, DISPLAY_NUMERIC, available_chart_types


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
    ]


def test_new_chart_type_values_are_available():
    types = available_chart_types(DISPLAY_NUMERIC)
    for value in ("filled-line", "step-line", "heat-strip", "colored-line", "multi-line", "multi-stacked"):
        assert value in types
