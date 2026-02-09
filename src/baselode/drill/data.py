"""Data loading and table normalization helpers for drillhole datasets.

Supports CSV, Parquet, or SQL sources and applies lightweight column
standardization so downstream functions can expect consistent keys.
"""

import pandas as pd
import geopandas as gpd


DEFAULT_COLUMN_MAP = {
    "holeid": "hole_id",
    "hole_id": "hole_id",
    "collarid": "collar_id",
    "collar_id": "collar_id",
    "companyholeid": "company_hole_id",
    "company_hole_id": "company_hole_id",
    "project": "project_id",
    "projectid": "project_id",
    "project_id": "project_id",
    "project_code": "project_code",
    "from": "from",
    "to": "to",
    "depth_from": "from",
    "depth_to": "to",
    "fromdepth": "from",
    "todepth": "to",
    "samp_from": "from",
    "samp_to": "to",
    "sample_from": "from",
    "sample_to": "to",
    "easting": "x",
    "northing": "y",
    "surveydepth": "from",
    "latitude": "lat",
    "lat": "lat",
    "longitude": "lon",
    "lon": "lon",
    "elevation": "z",
    "rl": "z",
    "azimuth": "azimuth",
    "dip": "dip",
    "declination": "declination",
}


def _frame(df):
    if df is None:
        return pd.DataFrame()
    if isinstance(df, pd.DataFrame):
        return df.copy()
    return pd.DataFrame(df)


def _canonicalize_hole_id(df, hole_id_col=None):
    col = hole_id_col or "hole_id"
    if col not in df.columns:
        normalized = DEFAULT_COLUMN_MAP.get(col.lower().strip(), col)
        if normalized != col and normalized in df.columns:
            col = normalized
    if col not in df.columns:
        if "hole_id" in df.columns:
            col = "hole_id"
        else:
            raise ValueError(f"hole id column '{col}' not found; available: {list(df.columns)}")
    if "hole_id" not in df.columns:
        df = df.copy()
        df["hole_id"] = df[col]
    df.attrs["hole_id_col"] = col
    return df


def standardize_columns(df, column_map=None):
    column_map = column_map or DEFAULT_COLUMN_MAP
    renamed = {}
    for col in df.columns:
        key = col.lower().strip()
        renamed[col] = column_map.get(key, key)
    out = df.rename(columns=renamed)
    return out


def load_table(source, kind="csv", connection=None, query=None, table=None, column_map=None, **kwargs):
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
    return standardize_columns(df, column_map=column_map)


def load_collars(source, crs=None, hole_id_col=None, **kwargs):
    df = load_table(source, **kwargs)
    df = _canonicalize_hole_id(df, hole_id_col=hole_id_col)
    has_xy = "x" in df.columns and "y" in df.columns
    has_latlon = "lat" in df.columns and "lon" in df.columns
    if not has_xy and has_latlon:
        df = df.assign(x=df["lon"], y=df["lat"])
        has_xy = True
    required = ["hole_id", "x", "y"]
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Collar table missing column: {col}")

    if has_latlon:
        geom = gpd.points_from_xy(df["lon"], df["lat"])
        resolved_crs = crs or "EPSG:4326"
    else:
        geom = gpd.points_from_xy(df["x"], df["y"])
        resolved_crs = crs

    return gpd.GeoDataFrame(df, geometry=geom, crs=resolved_crs)


def load_surveys(source, hole_id_col=None, **kwargs):
    df = load_table(source, **kwargs)
    df = _canonicalize_hole_id(df, hole_id_col=hole_id_col)
    required = ["hole_id", "from", "azimuth", "dip"]
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Survey table missing column: {col}")
    return df.sort_values(["hole_id", "from"])


def load_assays(source, hole_id_col=None, **kwargs):
    df = load_table(source, **kwargs)
    df = _canonicalize_hole_id(df, hole_id_col=hole_id_col)
    required = ["hole_id", "from", "to"]
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Assay table missing column: {col}")
    return df.sort_values(["hole_id", "from", "to"])


def join_assays_to_traces(assays, traces, on_cols=("hole_id",)):
    if traces.empty:
        return assays.copy()
    merged = assays.merge(traces, on=list(on_cols), how="left", suffixes=("", "_trace"))
    return merged


def filter_by_project(df, project_id=None):
    if project_id is None or df.empty or "project_id" not in df.columns:
        return df.copy()
    return df.loc[df["project_id"] == project_id].copy()


def coerce_numeric(df, columns):
    out = df.copy()
    for col in columns:
        if col in out.columns:
            out[col] = pd.to_numeric(out[col], errors="coerce")
    return out


def assemble_dataset(collars=None, surveys=None, assays=None, structures=None, metadata=None):
    return {
        "collars": _frame(collars),
        "surveys": _frame(surveys),
        "assays": _frame(assays),
        "structures": _frame(structures),
        "metadata": metadata or {},
    }
