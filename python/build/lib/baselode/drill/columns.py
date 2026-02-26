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

"""Column display type classification for strip log visualization.

Every loaded column is assigned a display type that drives:
- which columns appear in strip log property dropdowns
- which chart type options are offered for a given column
"""

import pandas as pd
from baselode.datamodel import COMMENTS

# Display type constants
DISPLAY_NUMERIC = "numeric"
DISPLAY_CATEGORICAL = "categorical"
DISPLAY_COMMENT = "comment"
DISPLAY_HIDDEN = "hidden"

# Chart type options for each display type
CHART_OPTIONS = {
    DISPLAY_NUMERIC: [
        {"value": "bar", "label": "Bars"},
        {"value": "markers", "label": "Markers"},
        {"value": "markers+line", "label": "Markers + Line"},
        {"value": "line", "label": "Line only"},
    ],
    DISPLAY_CATEGORICAL: [
        {"value": "categorical", "label": "Categorical bands"},
    ],
    DISPLAY_COMMENT: [
        {"value": "comment", "label": "Comments"},
    ],
    DISPLAY_HIDDEN: [],
}

# Column names (lowercased) that are always hidden from strip log views
HIDDEN_COLUMNS = {
    # Hole identifiers
    "hole_id", "holeid", "id", "holetype",
    "datasource_hole_id",
    "anumber", "collarid", "companyholeid", "company_hole_id", "company_id", "company_holeid_x", "company_holeid_y",
    # Project codes
    "project_id", "project_code", "project", "projectcode", "projectid",
    # Geographic coordinates
    "latitude", "longitude", "lat", "lon", "lng",
    "easting", "northing", "x", "y", "z",
    "elevation", "elev", "rl",
    # Depth / interval columns
    "from", "to", "mid", "depth", "md",
    "samp_from", "samp_to", "sample_from", "sample_to",
    "depth_from", "depth_to", "fromdepth", "todepth",
    # Geometry / CRS
    "shape", "geometry", "crs", "epsg",
    # Internal / synthetic columns
    "_source", "data_source", "_hole_key", "_hole_id_key",
}

# Column names (lowercased) that map to the comment display type
COMMENT_COLUMN_NAMES = {
    COMMENTS
}


def classify_columns(df):
    """Classify DataFrame columns into display types for strip log visualization.

    Rules applied in order:
    1. Columns in HIDDEN_COLUMNS → DISPLAY_HIDDEN
    2. Columns in COMMENT_COLUMN_NAMES with ≥1 non-empty value → DISPLAY_COMMENT
    3. All-null/empty columns → DISPLAY_HIDDEN (silently dropped)
    4. Columns with at least one finite number → DISPLAY_NUMERIC
    5. Remaining non-empty columns → DISPLAY_CATEGORICAL

    Parameters
    ----------
    df : pd.DataFrame

    Returns
    -------
    dict
        {
            "by_type": {col_name: display_type},
            "numeric_cols": [...],
            "categorical_cols": [...],
            "comment_cols": [...],
        }
    """
    by_type = {}

    for col in df.columns:
        normalized = col.lower().strip()

        # Always hidden: ID / coordinate / depth columns
        if normalized in HIDDEN_COLUMNS:
            by_type[col] = DISPLAY_HIDDEN
            continue

        # Comment-type: named free-text columns
        if normalized in COMMENT_COLUMN_NAMES:
            series = df[col].dropna().astype(str).str.strip()
            has_value = (
                len(series) > 0
                and not series.isin(["", "nan", "none", "null"]).all()
            )
            by_type[col] = DISPLAY_COMMENT if has_value else DISPLAY_HIDDEN
            continue

        series = df[col]

        # All-null → hidden (dropped from display)
        if series.isna().all():
            by_type[col] = DISPLAY_HIDDEN
            continue

        # Try numeric
        numeric = pd.to_numeric(series, errors="coerce")
        if numeric.notna().any():
            by_type[col] = DISPLAY_NUMERIC
        else:
            str_series = series.dropna().astype(str).str.strip()
            has_value = (str_series.str.len() > 0).any()
            by_type[col] = DISPLAY_CATEGORICAL if has_value else DISPLAY_HIDDEN

    numeric_cols = [c for c, t in by_type.items() if t == DISPLAY_NUMERIC]
    categorical_cols = [c for c, t in by_type.items() if t == DISPLAY_CATEGORICAL]
    comment_cols = [c for c, t in by_type.items() if t == DISPLAY_COMMENT]

    return {
        "by_type": by_type,
        "numeric_cols": numeric_cols,
        "categorical_cols": categorical_cols,
        "comment_cols": comment_cols,
    }


def available_chart_types(display_type):
    """Return list of available chart type value strings for a display type.

    Parameters
    ----------
    display_type : str
        One of DISPLAY_NUMERIC, DISPLAY_CATEGORICAL, DISPLAY_COMMENT, DISPLAY_HIDDEN.

    Returns
    -------
    list[str]
    """
    return [opt["value"] for opt in CHART_OPTIONS.get(display_type, [])]
