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
    ALPHA,
    AZIMUTH,
    BASELODE_DATA_MODEL_DRILL_ASSAY,
    BASELODE_DATA_MODEL_DRILL_COLLAR,
    BASELODE_DATA_MODEL_DRILL_GEOLOGY,
    BASELODE_DATA_MODEL_DRILL_SURVEY,
    BASELODE_DATA_MODEL_GEOPHYSICS,
    BASELODE_DATA_MODEL_STRUCTURAL_POINT,
    BETA,
    COMMENTS,
    CRS,
    DATASOURCE_HOLE_ID,
    DEPTH,
    DIP,
    EASTING,
    ELEVATION,
    EXTRA,
    FROM,
    GEOLOGY_CODE,
    GEOPHYSICS_NULL,
    HOLE_ID,
    LATITUDE,
    LONGITUDE,
    MID,
    NORTHING,
    PROJECT_ID,
    TO,
)

# This column map is used to make a 'best guess' for mapping common variations in source column names to the baselode data model.
# It is applied in the standardize_columns function, but users can also provide their own column map to override or extend this mapping as needed.
# The keys from the input source are normalized to lowercase and stripped of whitespace for more robust matching.
# this dictionary is stored for human readability,then pivoted to make lookup quicker in code.
# Be cautious of not mapping a source column to multiple baselode columns, as this can lead to unpredictable results. 
DEFAULT_COLUMN_MAP = {
    HOLE_ID: ["hole_id", "holeid", "hole id", "hole-id"],
    DATASOURCE_HOLE_ID: ["datasource_hole_id", "datasourceholeid", "datasource hole id", "datasource-hole-id", "company_hole_id", "companyholeid", "company hole id", "company-hole-id"],
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
    AZIMUTH: ["azimuth", "az", "dip_direction", "dipdir", "dip direction", "dipdrn", "dipdirection", "dip_dir", "computed_plane_azimuth", "calc_dipdir", "calc_dipdir_deg", "dipdir_calc", "dipdirect_calc"],
    DIP: ["dip", "computed_plane_dip", "calc_dip", "calc_dip_deg", "dip_calc"],
    DEPTH: ["depth", "survey_depth", "surveydepth", "md", "measured_depth", "dept"],
    ALPHA: ["alpha", "alpha_angle", "alpha_angle_deg", "alpha_2"],
    BETA: ["beta", "beta_angle", "beta_angle_deg", "beta_2"],
    COMMENTS: ["comment", "comments", "structcomment", "geology_comment", "geologycomment", "geology comment", "lithology_comment", "lithology comment", "geology_description", "geologydescription"]
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

    # Truly required: a hole id and a location pair. Everything else in the
    # canonical model (project_id, hole_type, max_depth, _collar_id, extra,
    # ...) is optional metadata that may or may not be present in any
    # given source. Listing required columns explicitly (rather than
    # subtracting from ``BASELODE_DATA_MODEL_DRILL_COLLAR.keys()``) keeps
    # the contract stable when fields are added to the canonical schema.
    if HOLE_ID not in df.columns:
        raise ValueError(f"Collar table missing column: {HOLE_ID}")

    has_xy = EASTING in df.columns and NORTHING in df.columns
    has_latlon = LATITUDE in df.columns and LONGITUDE in df.columns
    if not (has_xy or has_latlon):
        raise ValueError(
            f"Collar table missing location columns: needs either "
            f"({LATITUDE}, {LONGITUDE}) or ({EASTING}, {NORTHING})"
        )

    if has_latlon:
        geom = gpd.points_from_xy(df[LONGITUDE], df[LATITUDE])
        resolved_crs = crs or "EPSG:4326"
    else:
        geom = gpd.points_from_xy(df[EASTING], df[NORTHING])
        resolved_crs = crs

    # If datasource_hole_id wasn't populated, copy it from hole_id.
    if DATASOURCE_HOLE_ID not in df.columns:
        hole_series = df[HOLE_ID]
        if isinstance(hole_series, pd.DataFrame):
            hole_series = hole_series.bfill(axis=1).iloc[:, 0]
        df[DATASOURCE_HOLE_ID] = hole_series

    if not keep_all:
        # Project to the canonical model — but only columns that are
        # actually present (so optional fields like ``_collar_id`` /
        # ``extra`` don't trigger KeyError when absent).
        keep_cols = [
            col for col in BASELODE_DATA_MODEL_DRILL_COLLAR.keys()
            if col in df.columns
        ]
        df = df[keep_cols]

    return gpd.GeoDataFrame(df, geometry=geom, crs=resolved_crs)


def load_surveys(source, source_column_map=None, keep_all=True, **kwargs):
    df = load_table(source, source_column_map=source_column_map, **kwargs)

    required = [HOLE_ID, DEPTH, AZIMUTH, DIP]
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Survey table missing column: {col}")

    if not keep_all:
        # Project to canonical model columns that are actually present.
        # Optional fields (TO, EXTRA, ...) absent in the input are skipped.
        keep_cols = [
            col for col in BASELODE_DATA_MODEL_DRILL_SURVEY.keys()
            if col in df.columns
        ]
        df = df[keep_cols]

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
        keep_cols = [
            col for col in BASELODE_DATA_MODEL_DRILL_ASSAY.keys()
            if col in df.columns
        ]
        df = df[keep_cols]

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


def load_geology(source, source_column_map=None, flat=True, keep_all=True, **kwargs):
    """Load geology/lithology interval data.

    Accepts interval tables (hole_id, from, to, geology_code, comments, ...).
    """
    df = load_table(source, source_column_map=source_column_map, **kwargs)

    if not flat:
        df = _flatten_long_interval_table(
            df,
            label="Geology",
            code_candidates=[GEOLOGY_CODE, "lith_code", "code"],
            value_candidates=[COMMENTS, "geology_value", "value", "description"],
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
        has_comments = COMMENTS in df.columns
        if not has_code and not has_comments:
            raise ValueError(
                f"Geology table missing categorical columns: {GEOLOGY_CODE} or {COMMENTS}"
            )

        if not has_code and has_comments:
            df[GEOLOGY_CODE] = df[COMMENTS]

    _validate_non_overlapping_intervals(df, "Geology")

    if not keep_all:
        df = df[[col for col in BASELODE_DATA_MODEL_DRILL_GEOLOGY.keys() if col in df.columns]]

    return df.sort_values([HOLE_ID, FROM, TO])


def load_geophysics(source, source_column_map=None, keep_all=True, null_sentinel=GEOPHYSICS_NULL, **kwargs):
    """Load geophysics interval data (gamma, density, resistivity, magnetic susceptibility, etc.).

    Accepts interval tables (hole_id, from, to, ...) with one or more numeric value columns.
    Null sentinels (default -999.25, common in LAS-derived sources) are replaced with NaN.

    Parameters
    ----------
    source : path, file-like, or DataFrame
    source_column_map : dict, optional
        Extra column-name overrides (e.g. ``{'HoleId': 'hole_id'}``).
    keep_all : bool, optional
        If False, drop columns outside the base schema (hole_id, from, to, mid).
        Default True retains all value columns.
    null_sentinel : float, optional
        Value to replace with NaN. Default -999.25.
    **kwargs
        Forwarded to :func:`load_table`.
    """
    df = load_table(source, source_column_map=source_column_map, **kwargs)

    if HOLE_ID not in df.columns:
        raise ValueError(f"Geophysics table missing column: {HOLE_ID}")

    required = [FROM, TO]
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Geophysics table missing column: {col}")

    # Blank hole_id must stay blank: ``astype(str)`` on older pandas turns
    # NaN into the literal "nan", which would then pass the invalid-row
    # filter below.
    df[HOLE_ID] = df[HOLE_ID].where(df[HOLE_ID].notna(), "").astype(str).str.strip()
    df = _normalize_interval_bounds(df)

    invalid = (
        df[HOLE_ID].isna()
        | (df[HOLE_ID] == "")
        | df[FROM].isna()
        | df[TO].isna()
        | (df[TO] < df[FROM])
    )
    if invalid.any():
        df = df.loc[~invalid].copy()

    # Replace null sentinel with NaN across all numeric columns
    if null_sentinel is not None:
        value_cols = [
            col for col in df.columns
            if col not in {HOLE_ID, FROM, TO, MID}
            and pd.api.types.is_numeric_dtype(df[col])
        ]
        for col in value_cols:
            df[col] = df[col].replace(null_sentinel, float("nan"))

    df[MID] = 0.5 * (df[FROM] + df[TO])

    if not keep_all:
        base_cols = [col for col in BASELODE_DATA_MODEL_GEOPHYSICS.keys() if col in df.columns]
        df = df[base_cols]

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


def _present(value):
    """True iff ``value`` is a real, present scalar (not None / NaN / NaT / NA).

    Uses ``pd.isna`` so we catch every pandas missing-value sentinel
    (``pd.NA``, ``pd.NaT``, ``numpy.nan``) — not just ``float('nan')``.
    Containers like ``dict``/``list`` are short-circuited to True so
    ``pd.isna`` doesn't try to elementwise-check them.
    """
    if value is None:
        return False
    if isinstance(value, (dict, list, tuple, set)):
        return True
    try:
        return not pd.isna(value)
    except (TypeError, ValueError):
        return True


def bundle_extras(df, canonical, extra_col=EXTRA, reserved=None):
    """Move non-canonical columns into a per-row dict in ``extra_col``.

    Every baselode-model DataFrame is expected to have a single ``extra``
    column (a Python ``dict`` per row) holding source-specific fields that
    don't belong in the canonical schema. This helper produces that shape
    from a wide DataFrame.

    Parameters
    ----------
    df : pd.DataFrame
        Input DataFrame (may be a ``geopandas.GeoDataFrame``).
    canonical : iterable of str
        Column names to keep as top-level columns. Typically pass
        ``BASELODE_DATA_MODEL_*.keys()``.
    extra_col : str, optional
        Name of the dict column (default ``"extra"``).
    reserved : iterable of str, optional
        Additional names to keep at top level alongside ``canonical`` —
        e.g. ``{"geometry"}`` to preserve a GeoDataFrame geometry column.

    Returns
    -------
    Same type as ``df`` (GeoDataFrame stays GeoDataFrame).

    Notes
    -----
    - ``None`` and ``NaN`` values are skipped — the per-row dict only
      carries values that are actually present in that row.
    - If ``df`` already has an ``extra_col``, new extras are merged with
      the existing dicts (existing values win on conflict). This means
      bundling is idempotent: applying it twice produces the same result.
    """
    canonical_set = set(canonical)
    reserved_set = set(reserved) if reserved else set()
    keep = canonical_set | reserved_set | {extra_col}
    extras_cols = [c for c in df.columns if c not in keep]

    if not extras_cols:
        if extra_col in df.columns:
            return df.copy()
        out = df.copy()
        out[extra_col] = [{} for _ in range(len(out))]
        return out

    records = df[extras_cols].to_dict("records")
    new_extras = [
        {k: v for k, v in rec.items() if _present(v)}
        for rec in records
    ]

    out = df.drop(columns=extras_cols)
    if extra_col in out.columns:
        existing = list(out[extra_col])
        merged = []
        for new_d, ex in zip(new_extras, existing):
            base = dict(new_d)
            if isinstance(ex, dict):
                base.update(ex)  # existing wins
            merged.append(base)
        out[extra_col] = merged
    else:
        out[extra_col] = new_extras
    return out


def assemble_dataset(collars=None, surveys=None, assays=None, geology=None, structures=None, geotechnical=None, geophysics=None, metadata=None):
    return {
        "collars": _frame(collars),
        "surveys": _frame(surveys),
        "assays": _frame(assays),
        "geology": _frame(geology),
        "structures": _frame(structures),
        "geotechnical": _frame(geotechnical),
        "geophysics": _frame(geophysics),
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
