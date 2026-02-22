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

from baselode.datamodel import ( HOLE_ID, LATITUDE, LONGITUDE, ELEVATION, AZIMUTH, DIP, FROM, TO, MID, PROJECT_ID, EASTING, NORTHING, CRS, DEPTH, ALPHA, BETA, COMMENTS )


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

# The GSWA Structure table has the following potential attributes for structure measurements:
# Alpha,Beta,Confidence,Defect,Defect_Width,Description,Dip,DipDir_Calc,
# DipDirect_calc,DipDrn,Dip_Calc,,Fill1,Fill2,FillPC,,Hole_Dip,Hole_Dip_2,Hole_Dir,Hole_dir_2,
# JWS,,Reliability,Rough,,StructComment,Structure,Type,a,alpha_2,beta_2,d

# Ignored as meta-data not structure data:
# Id,CollarId,FromDepth,ToDepth,HoleId,Geologist,Drill_code,PRIORITY,ProjectCode,Projectcode_2,Shape
BASELODE_DATA_MODEL_STRUCTURAL_POINT = {
    HOLE_ID: str,
    DEPTH: float,
    DIP: float,
    AZIMUTH: float,
    ALPHA: float,
    BETA: float,
    "comments": str,
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
    AZIMUTH: ["azimuth", "az", "dip_direction", "dipdir", "dip direction", "dipdrn", "dipdirection", "dip_dir", "computed_plane_azimuth", "calc_dipdir", "calc_dipdir_deg", "dipdrn", "dipdir_calc", "dipdirect_calc"],
    DIP: ["dip", "computed_plane_dip", "calc_dip", "calc_dip_deg", "dip_calc"],
    DEPTH: ["depth", "survey_depth", "surveydepth"],
    ALPHA: ["alpha", "alpha_angle", "alpha_angle_deg", "alpha_2"],
    BETA: ["beta", "beta_angle", "beta_angle_deg", "beta_2"],
    COMMENTS: ["comment", "comments", "structcomment", "description"]
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


def load_table(source, kind="csv", connection=None, query=None, table=None, column_map=None, source_column_map=None, **kwargs):
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


def load_assays(source, source_column_map=None, keep_all=True, **kwargs):
    df = load_table(source, source_column_map=source_column_map, **kwargs)
    required_cols = set(BASELODE_DATA_MODEL_DRILL_ASSAY.keys())

    required = [HOLE_ID, FROM, TO]
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Assay table missing column: {col}")

    # Calculate midpoint depth
    df[MID] = 0.5 * (df[FROM] + df[TO])

    if not keep_all:
        df = df[[col for col in BASELODE_DATA_MODEL_DRILL_ASSAY.keys() if col in required_cols]]

    return df.sort_values([HOLE_ID, FROM, TO])


def load_structures(source, source_column_map=None, keep_all=True, **kwargs):
    """Load structural point measurement data.

    Expects point schema: hole_id, depth, dip, azimuth.
    Structural measurements are always recorded at a single measured depth
    (a point along the hole), consistent with BASELODE_DATA_MODEL_STRUCTURAL_POINT.
    """
    df = load_table(source, source_column_map=source_column_map, **kwargs)

    if HOLE_ID not in df.columns:
        raise ValueError(f"Structural table missing column: {HOLE_ID}")

    if DEPTH not in df.columns:
        raise ValueError(f"Structural table missing column: {DEPTH}")

    df = coerce_numeric(df, [DIP, AZIMUTH, ALPHA, BETA])

    if not keep_all:
        keep_cols = [
            col for col in BASELODE_DATA_MODEL_STRUCTURAL_POINT.keys() if col in df.columns
        ]
        df = df[keep_cols]

    return df.sort_values([HOLE_ID, DEPTH])


def load_geotechnical(source, source_column_map=None, keep_all=True, **kwargs):
    """Load geotechnical interval data (RQD, fracture count, weathering, etc.).

    Accepts interval tables (hole_id, from, to, ...) with geotechnical columns.
    """
    df = load_table(source, source_column_map=source_column_map, **kwargs)

    if HOLE_ID not in df.columns:
        raise ValueError(f"Geotechnical table missing column: {HOLE_ID}")

    required = [FROM, TO]
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Geotechnical table missing column: {col}")

    geotechnical_numeric = ["rqd", "fracture_count", "fracture_frequency", "core_recovery", "tce"]
    df = coerce_numeric(df, geotechnical_numeric)

    df[MID] = 0.5 * (df[FROM] + df[TO])
    return df.sort_values([HOLE_ID, FROM])


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


def assemble_dataset(collars=None, surveys=None, assays=None, structures=None, geotechnical=None, metadata=None):
    return {
        "collars": _frame(collars),
        "surveys": _frame(surveys),
        "assays": _frame(assays),
        "structures": _frame(structures),
        "geotechnical": _frame(geotechnical),
        "metadata": metadata or {},
    }


def load_unified_dataset(assays_source, structures_source, source_column_map=None, **kwargs):
    """Load and merge assay intervals and structural data into one DataFrame.

    This is the recommended entry point for the Drillhole 2D strip-log view. The
    combined DataFrame can be used directly as the data source for the hole / property
    dropdowns and the strip-log renderer, giving a consistent experience across both
    data types.

    Rules applied:
    - **Assay rows** (interval schema): ``from``, ``to`` and ``mid`` are already
      computed by :func:`load_assays`.  A unified ``depth`` column is set to
      ``mid`` so assay points appear at the interval midpoint on the depth axis.
      Rows are tagged ``_source = 'assay'``.
    - **Structural rows** (point schema): ``depth`` is the measured depth.
      ``from`` and ``to`` are set to ``depth ± 0.05 m`` (0.1 m centred interval)
      so the bar renders at the measurement point.  ``mid`` is set to ``depth``.
      Rows are tagged ``_source = 'structural'``.

    The caller gets a single DataFrame indexed by ``hole_id``.  The hole dropdown
    should enumerate ``hole_id.unique()``, the property dropdown should show only
    columns with at least one non-null value for the selected hole, and the y-axis
    should use the ``depth`` column.

    Parameters
    ----------
    assays_source:
        Path, file-like, or DataFrame for the assay CSV (passed to
        :func:`load_assays`).
    structures_source:
        Path, file-like, or DataFrame for the structural CSV (passed to
        :func:`load_structures`).
    source_column_map : dict, optional
        Extra column-name overrides forwarded to both loaders.
    **kwargs:
        Additional keyword arguments forwarded to both loaders (e.g.
        ``kind='csv'``).

    Returns
    -------
    pd.DataFrame
        Combined DataFrame with all assay and structural rows, sorted by
        ``hole_id`` then ``depth``.  Contains a ``_source`` column
        (``'assay'`` | ``'structural'``) and a unified ``depth`` column.
    """
    assay_df = load_assays(assays_source, source_column_map=source_column_map, **kwargs)
    struct_df = load_structures(structures_source, source_column_map=source_column_map, keep_all=True, **kwargs)

    assay_df = assay_df.copy()
    struct_df = struct_df.copy()

    # --- tag sources ---
    assay_df["_source"] = "assay"
    struct_df["_source"] = "structural"

    # --- unified depth for assay rows: midpoint of the interval ---
    if not assay_df.empty and MID in assay_df.columns:
        assay_df[DEPTH] = assay_df[MID]

    # --- unified depth + interval columns for structural rows ---
    # Structural data is always point schema (depth). Add from/to/mid so
    # interval-style renderers can still consume the rows.
    # The interval is centred on depth (±0.05 m) so the bar appears at the
    # measurement point and renders at the target 0.1 m display width.
    if not struct_df.empty and DEPTH in struct_df.columns:
        struct_df[FROM] = struct_df[DEPTH] - 0.05
        struct_df[TO] = struct_df[DEPTH] + 0.05
        struct_df[MID] = struct_df[DEPTH]

    combined = pd.concat([assay_df, struct_df], ignore_index=True, sort=False)

    if HOLE_ID in combined.columns:
        combined[HOLE_ID] = combined[HOLE_ID].astype(str).str.strip()

    if DEPTH in combined.columns and HOLE_ID in combined.columns:
        combined = combined.sort_values([HOLE_ID, DEPTH], kind="mergesort").reset_index(drop=True)

    return combined

