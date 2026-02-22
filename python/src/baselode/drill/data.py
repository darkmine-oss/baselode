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

"""Data loading and table normalization helpers for drillhole datasets.

Supports CSV, Parquet, or SQL sources and applies column
standardization towards the baselode open data model, 
so downstream functions can expect consistent keys.
"""

import pandas as pd
import geopandas as gpd

from baselode.datamodel import (
    HOLE_ID,
    LATITUDE,
    LONGITUDE,
    ELEVATION,
    AZIMUTH,
    DIP,
    FROM,
    TO,
    MID,
    PROJECT_ID,
    EASTING,
    NORTHING,
    CRS,
    DEPTH,
    GEOLOGY_CODE,
    GEOLOGY_DESCRIPTION,
)


"""
Baselode Open Data Model

Provides a consistent schema for data handling throughout the library.

Individual data loaders apply common column mapping, but also accept user-provided column maps to handle variations in source data.
"""

# Minimum expected columns for drillhole collars
# The collar forms the basis for hole_id and spatial location, so it is expected to exist in all datasets and be standardized as much as possible.
BASELODE_DATA_MODEL_DRILL_COLLAR = {
    # A unique hole identifier across the entire dataset and all future data sets
    HOLE_ID: str,
    # The hole ID from the original collar source
    "datasource_hole_id": str,
    # The project ID or project code from the original collar source, if available
    PROJECT_ID: str,
    # The latitude of the collar, in decimal degrees (WGS84)
    LATITUDE: float,
    # The longitude of the collar, in decimal degrees (WGS84)
    LONGITUDE: float,
    # The elevation of the collar, in meters above sea level (WGS84)
    ELEVATION: float,
    # The easting coordinate of the collar, in meters (projected CRS)
    EASTING: float,
    # The northing coordinate of the collar, in meters (projected CRS)
    NORTHING: float,
    # The coordinate reference system of the collar coordinates for easting/northing, as an EPSG code or proj string
    CRS: str
}

BASELODE_DATA_MODEL_DRILL_SURVEY = {
    # The unique hole id that maps to the collar and any other data tables
    HOLE_ID: str,
    # The depth along the hole where the survey measurement was taken / started
    DEPTH: float,
    # The depth along the hole where the survey measurement ended, if applicable (some surveys are point measurements and may not have a 'to' depth)
    TO: float,
    # The azimuth of the hole at the survey depth, in degrees from north
    AZIMUTH: float,
    # The dip of the hole at the survey depth, in degrees from horizontal (negative values indicate downward inclination)
    DIP: float
}

BASELODE_DATA_MODEL_DRILL_ASSAY = {
    # The unique hole id that maps to the collar and any other data tables
    HOLE_ID: str,
    # The depth along the hole where the assay interval starts
    FROM: float,
    # The depth along the hole where the assay interval ends
    TO: float,
    # The midpoint depth of the assay interval
    MID: float,
    # assay value columns are variable and not standardized here. 
    # Assays may be flattened (one column per assay type) or long (one row per assay type with an additional 'assay_type' column)
}

BASELODE_DATA_MODEL_DRILL_GEOLOGY = {
    # The unique hole id that maps to the collar and any other data tables
    HOLE_ID: str,
    # The depth along the hole where the geology interval starts
    FROM: float,
    # The depth along the hole where the geology interval ends
    TO: float,
    # The midpoint depth of the geology interval
    MID: float,
    # Standardized lithology/geology code for categorical strip-log plotting
    GEOLOGY_CODE: str,
    # Human-readable geology/lithology description
    GEOLOGY_DESCRIPTION: str,
}


# This column map is used to make a 'best guess' for mapping common variations in source column names to the baselode data model.
# It is applied in the standardize_columns function, but users can also provide their own column map to override or extend this mapping as needed.
# The keys from the input source are normalized to lowercase and stripped of whitespace for more robust matching.
# this dictionary is stored for human readability,then pivoted to make lookup quicker in code.
# Be cautious of not mapping a source column to multiple baselode columns, as this can lead to unpredictable results. 
DEFAULT_COLUMN_MAP = {
    HOLE_ID: ["hole_id", "holeid", "hole id", "hole-id"],
    "datasource_hole_id": ["datasource_hole_id", "datasourceholeid", "datasource hole id", "datasource-hole-id", "company_hole_id", "companyholeid", "company hole id", "company-hole-id"],
    PROJECT_ID: ["project_id", "projectid", "project id", "project-id", "project_code", "projectcode", "project code", "project-code", "companyId", "company_id", "companyid", "company id", "company-id", "dataset", "project"],
    LATITUDE: ["latitude", "lat"],
    LONGITUDE: ["longitude", "lon"],
    ELEVATION: ["elevation", "rl", "elev", "z"],
    EASTING: ["easting", "x"],
    NORTHING: ["northing", "y"],
    CRS: ["crs", "epsg", "projection"],
    FROM: ["from", "depth_from", "from_depth", "samp_from", "sample_from", "sampfrom", "fromdepth"],
    TO: ["to", "depth_to", "to_depth", "samp_to", "sample_to", "sampto", "todepth"],
    GEOLOGY_CODE: [
        "geology_code",
        "geologycode",
        "lith1",
        "lith1code",
        "lith1_code",
        "lithology",
        "plot_lithology",
        "rock1",
    ],
    GEOLOGY_DESCRIPTION: [
        "geology_description",
        "geologydescription",
        "geology_comment",
        "geologycomment",
        "geology comment",
        "lithology_comment",
        "lithology comment",
        "description",
        "comments",
    ],
    AZIMUTH: ["azimuth", "az", "dipdir", "dip_direction"],
    DIP: ["dip"],
    "declination": ["declination", "dec"],
    DEPTH: ["depth", "survey_depth", "surveydepth"]
}

# Pivot the DEFAULT_COLUMN_MAP for efficient reverse lookup
# Maps normalized column names -> standardized baselode column names
_COLUMN_LOOKUP = {}
for standard_col, variations in DEFAULT_COLUMN_MAP.items():
    for variation in variations:
        normalized = variation.lower().strip()
        _COLUMN_LOOKUP[normalized] = standard_col


def _frame(df):
    if df is None:
        return pd.DataFrame()
    if isinstance(df, pd.DataFrame):
        return df.copy()
    return pd.DataFrame(df)


def _validate_non_overlapping_intervals(df, label):
    if df.empty:
        return
    ordered = df.sort_values([HOLE_ID, FROM, TO]).reset_index(drop=True)
    for hole_id, group in ordered.groupby(HOLE_ID, sort=False):
        prev_to = None
        for _, row in group.iterrows():
            frm = round(float(row[FROM]), 3)
            to = round(float(row[TO]), 3)
            if prev_to is not None and frm < prev_to:
                raise ValueError(
                    f"{label} intervals overlap for hole '{hole_id}': from={frm} is less than previous to={prev_to}"
                )
            prev_to = to


def _normalize_interval_bounds(df):
    out = df.copy()
    out[FROM] = pd.to_numeric(out[FROM], errors="coerce")
    out[TO] = pd.to_numeric(out[TO], errors="coerce")

    out[FROM] = out[FROM].round(3)
    out[TO] = out[TO].round(3)

    equal_mask = out[FROM].notna() & out[TO].notna() & (out[TO] == out[FROM])
    if equal_mask.any():
        out.loc[equal_mask, TO] = (out.loc[equal_mask, FROM] + 0.001).round(3)

    return out


def _first_present_column(df, candidates):
    for col in candidates:
        if col in df.columns:
            return col
    return None


def _flatten_long_interval_table(df, label, code_candidates, value_candidates):
    code_col = _first_present_column(df, code_candidates)
    value_col = _first_present_column(df, value_candidates)

    if code_col is None or value_col is None:
        raise ValueError(
            f"{label} long-format table requires code and value columns; found code={code_col}, value={value_col}"
        )

    base_cols = [col for col in df.columns if col not in {code_col, value_col}]
    if HOLE_ID not in base_cols or FROM not in base_cols or TO not in base_cols:
        raise ValueError(f"{label} long-format table must include columns: {HOLE_ID}, {FROM}, {TO}")

    wide = (
        df.pivot_table(
            index=base_cols,
            columns=code_col,
            values=value_col,
            aggfunc="first",
            sort=False,
        )
        .reset_index()
    )

    if isinstance(wide.columns, pd.MultiIndex):
        wide.columns = [
            "_".join([str(part) for part in col if str(part) not in ("", "None")]).strip("_")
            for col in wide.columns.values
        ]

    wide.columns = [str(col).strip() for col in wide.columns]
    return wide


def standardize_columns(df, column_map=None, source_column_map=None):
    column_map = column_map or DEFAULT_COLUMN_MAP

    lookup = dict(_COLUMN_LOOKUP)
    if source_column_map:
        normalized_map = {
            str(raw_name).lower().strip(): str(expected_name).lower().strip()
            for raw_name, expected_name in source_column_map.items()
            if raw_name is not None and expected_name is not None
        }
        lookup.update(normalized_map)

    renamed = {}
    for col in df.columns:
        key = col.lower().strip()
        mapped = lookup.get(key, key)
        renamed[col] = mapped
    out = df.rename(columns=renamed)
    if not out.columns.is_unique:
        out = out.T.groupby(level=0, sort=False).first().T
    return out


def load_table(source,
    kind="csv",
    connection=None,
    query=None,
    table=None,
    column_map=None,
    source_column_map=None,
    keep_all=True,
    **kwargs):
    # keep_all is accepted for API compatibility with specialized loaders.
    # Base table loading does not drop columns because it has no schema context.
    _ = keep_all
    if isinstance(source, pd.DataFrame):
        df = source.copy()
    elif kind == "csv":
        df = pd.read_csv(source, **kwargs)
    elif kind == "parquet":
        df = pd.read_parquet(source, **kwargs)
    elif kind == "sql":
        if query is None and table is None:
            raise ValueError("For SQL sources, provide query or table")
        if query is not None:
            df = pd.read_sql_query(query, connection, **kwargs)
        else:
            df = pd.read_sql_table(table, connection, **kwargs)
    else:
        raise ValueError(f"Unsupported kind: {kind}")
    return standardize_columns(df, column_map=column_map, source_column_map=source_column_map)


def load_collars(source, crs=None, source_column_map=None, keep_all=True, **kwargs):
    df = load_table(source, source_column_map=source_column_map, **kwargs)

    if HOLE_ID not in df.columns:
        raise ValueError(f"Collar table missing column: {HOLE_ID}")

    required_cols = set(BASELODE_DATA_MODEL_DRILL_COLLAR.keys())

    has_xy = EASTING in df.columns and NORTHING in df.columns 
    has_latlon = LATITUDE in df.columns and LONGITUDE in df.columns
    if not has_xy and has_latlon:
        required_cols -= {EASTING, NORTHING, CRS}
    elif has_xy and not has_latlon:
        required_cols -= {LATITUDE, LONGITUDE}
        
    if has_latlon:
        geom = gpd.points_from_xy(df[LONGITUDE], df[LATITUDE])
        resolved_crs = crs or "EPSG:4326"
    else:
        geom = gpd.points_from_xy(df[EASTING], df[NORTHING])
        resolved_crs = crs

    # if dataset_hole_id was not populated, copy it from hole_id
    if "datasource_hole_id" not in df.columns:
        hole_series = df[HOLE_ID]
        if isinstance(hole_series, pd.DataFrame):
            hole_series = hole_series.bfill(axis=1).iloc[:, 0]
        df["datasource_hole_id"] = hole_series

    for col in sorted(required_cols):
        if col not in df.columns:
            raise ValueError(f"Collar table missing column: {col}")

    if not keep_all:
        df = df[[col for col in BASELODE_DATA_MODEL_DRILL_COLLAR.keys() if col in required_cols]]

    return gpd.GeoDataFrame(df, geometry=geom, crs=resolved_crs)


def load_surveys(source, source_column_map=None, keep_all=True, **kwargs):
    df = load_table(source, source_column_map=source_column_map, **kwargs)
    required_cols = set(BASELODE_DATA_MODEL_DRILL_SURVEY.keys())

    if TO not in df.columns:
        required_cols -= {TO}

    required = [HOLE_ID, DEPTH, AZIMUTH, DIP]
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Survey table missing column: {col}")

    if not keep_all:
        df = df[[col for col in BASELODE_DATA_MODEL_DRILL_SURVEY.keys() if col in required_cols]]

    return df.sort_values([HOLE_ID, DEPTH])


def load_assays(source, source_column_map=None, flat=True, keep_all=True, **kwargs):
    df = load_table(source, source_column_map=source_column_map, **kwargs)

    if not flat:
        df = _flatten_long_interval_table(
            df,
            label="Assay",
            code_candidates=["assay_code", "assay_type", "analyte", "element", "code"],
            value_candidates=["assay_value", "value", "result", "assay_result"],
        )

    required_cols = set(BASELODE_DATA_MODEL_DRILL_ASSAY.keys())

    required = [HOLE_ID, FROM, TO]
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Assay table missing column: {col}")

    df[HOLE_ID] = df[HOLE_ID].astype(str).str.strip()
    df = _normalize_interval_bounds(df)

    invalid = (
        df[HOLE_ID].isna()
        | (df[HOLE_ID] == "")
        | df[FROM].isna()
        | df[TO].isna()
        | (df[TO] < df[FROM])
    )
    if invalid.any():
        raise ValueError("Assay table has missing or invalid interval values")

    # Calculate midpoint depth
    df[MID] = 0.5 * (df[FROM] + df[TO])

    if not keep_all:
        df = df[[col for col in BASELODE_DATA_MODEL_DRILL_ASSAY.keys() if col in required_cols]]

    return df.sort_values([HOLE_ID, FROM, TO])


def load_geology(source, source_column_map=None, flat=True, keep_all=True, **kwargs):
    df = load_table(source, source_column_map=source_column_map, **kwargs)

    if not flat:
        df = _flatten_long_interval_table(
            df,
            label="Geology",
            code_candidates=[GEOLOGY_CODE, "lith_code", "code"],
            value_candidates=[GEOLOGY_DESCRIPTION, "geology_value", "value", "description"],
        )

    required_cols = set(BASELODE_DATA_MODEL_DRILL_GEOLOGY.keys())

    required = [HOLE_ID, FROM, TO]
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Geology table missing column: {col}")

    df[HOLE_ID] = df[HOLE_ID].astype(str).str.strip()
    df = _normalize_interval_bounds(df)

    missing_hole = df[HOLE_ID].isna() | (df[HOLE_ID] == "")
    missing_from = df[FROM].isna()
    missing_to = df[TO].isna()
    non_positive_interval = (df[TO] < df[FROM]).fillna(False)

    invalid = missing_hole | missing_from | missing_to | non_positive_interval
    if invalid.any():
        invalid_rows = df.loc[invalid, [HOLE_ID, FROM, TO]].head(5).to_dict("records")
        details = {
            "total_invalid": int(invalid.sum()),
            "missing_hole_id": int(missing_hole.sum()),
            "missing_from": int(missing_from.sum()),
            "missing_to": int(missing_to.sum()),
            "to_le_from": int(non_positive_interval.sum()),
            "sample_rows": invalid_rows,
        }
        raise ValueError(f"Geology table has missing or invalid interval values: {details}")

    df[MID] = 0.5 * (df[FROM] + df[TO])

    if flat:
        has_code = GEOLOGY_CODE in df.columns
        has_description = GEOLOGY_DESCRIPTION in df.columns
        if not has_code and not has_description:
            raise ValueError(
                f"Geology table missing categorical columns: {GEOLOGY_CODE} or {GEOLOGY_DESCRIPTION}"
            )

        if not has_code and has_description:
            df[GEOLOGY_CODE] = df[GEOLOGY_DESCRIPTION]
        if has_code and not has_description:
            df[GEOLOGY_DESCRIPTION] = df[GEOLOGY_CODE]

    _validate_non_overlapping_intervals(df, "Geology")

    if not keep_all:
        df = df[[col for col in BASELODE_DATA_MODEL_DRILL_GEOLOGY.keys() if col in required_cols]]

    return df.sort_values([HOLE_ID, FROM, TO])


def join_assays_to_traces(assays, traces, on_cols=(HOLE_ID,)):
    if traces.empty:
        return assays.copy()
    merged = assays.merge(traces, on=list(on_cols), how="left", suffixes=("", "_trace"))
    return merged


def filter_by_project(df, project_id=None):
    if project_id is None or df.empty or PROJECT_ID not in df.columns:
        return df.copy()
    return df.loc[df[PROJECT_ID] == project_id].copy()


def coerce_numeric(df, columns):
    out = df.copy()
    for col in columns:
        if col in out.columns:
            out[col] = pd.to_numeric(out[col], errors="coerce")
    return out


def assemble_dataset(collars=None, surveys=None, assays=None, geology=None, structures=None, metadata=None):
    return {
        "collars": _frame(collars),
        "surveys": _frame(surveys),
        "assays": _frame(assays),
        "geology": _frame(geology),
        "structures": _frame(structures),
        "metadata": metadata or {},
    }
