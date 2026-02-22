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

"""Tests for the column display-type classification module."""

import pandas as pd
import pytest

from baselode.drill.columns import (
    DISPLAY_CATEGORICAL,
    DISPLAY_COMMENT,
    DISPLAY_HIDDEN,
    DISPLAY_NUMERIC,
    available_chart_types,
    classify_columns,
)


# ---------------------------------------------------------------------------
# classify_columns
# ---------------------------------------------------------------------------


def test_classify_numeric_column():
    df = pd.DataFrame({"hole_id": ["A", "A"], "au_ppm": [0.5, 1.2]})
    result = classify_columns(df)
    assert result["by_type"]["au_ppm"] == DISPLAY_NUMERIC
    assert "au_ppm" in result["numeric_cols"]


def test_classify_categorical_column():
    df = pd.DataFrame({"hole_id": ["A", "A"], "lithology": ["granite", "basalt"]})
    result = classify_columns(df)
    assert result["by_type"]["lithology"] == DISPLAY_CATEGORICAL
    assert "lithology" in result["categorical_cols"]


def test_classify_comment_column():
    df = pd.DataFrame({
        "hole_id": ["A", "A"],
        "from": [0.0, 10.0],
        "to": [10.0, 20.0],
        "comments": ["good core", ""],
    })
    result = classify_columns(df)
    assert result["by_type"]["comments"] == DISPLAY_COMMENT
    assert "comments" in result["comment_cols"]


def test_classify_empty_comment_column_is_hidden():
    df = pd.DataFrame({
        "hole_id": ["A"],
        "from": [0.0],
        "to": [10.0],
        "comments": [None],
    })
    result = classify_columns(df)
    assert result["by_type"]["comments"] == DISPLAY_HIDDEN
    assert "comments" not in result["comment_cols"]


def test_classify_all_nan_column_is_hidden():
    df = pd.DataFrame({"hole_id": ["A"], "cu_ppm": [float("nan")]})
    result = classify_columns(df)
    assert result["by_type"]["cu_ppm"] == DISPLAY_HIDDEN


def test_classify_id_columns_are_hidden():
    df = pd.DataFrame({
        "hole_id": ["A"],
        "from": [0.0],
        "to": [10.0],
        "depth": [5.0],
        "easting": [500000.0],
    })
    result = classify_columns(df)
    for col in ["hole_id", "from", "to", "depth", "easting"]:
        assert result["by_type"][col] == DISPLAY_HIDDEN


def test_classify_mixed_nan_numeric_is_numeric():
    """Column with some NaN and some finite values → DISPLAY_NUMERIC."""
    df = pd.DataFrame({"au_ppm": [float("nan"), 0.5, float("nan")]})
    result = classify_columns(df)
    assert result["by_type"]["au_ppm"] == DISPLAY_NUMERIC


def test_classify_empty_df():
    result = classify_columns(pd.DataFrame())
    assert result == {"by_type": {}, "numeric_cols": [], "categorical_cols": [], "comment_cols": [], "tadpole_cols": []}


# ---------------------------------------------------------------------------
# available_chart_types
# ---------------------------------------------------------------------------


def test_chart_types_numeric():
    types = available_chart_types(DISPLAY_NUMERIC)
    assert "bar" in types
    assert "line" in types
    assert "markers" in types


def test_chart_types_categorical():
    types = available_chart_types(DISPLAY_CATEGORICAL)
    assert types == ["categorical"]


def test_chart_types_comment():
    types = available_chart_types(DISPLAY_COMMENT)
    assert types == ["comment"]


def test_chart_types_hidden():
    assert available_chart_types(DISPLAY_HIDDEN) == []


def test_chart_types_unknown():
    assert available_chart_types("unknown_type") == []
