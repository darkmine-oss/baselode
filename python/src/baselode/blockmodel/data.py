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

"""Block model data loading, class definition, and calculations.

Supports loading block model data from CSV, Parquet, or SQL sources.
Each block is described by a centre location (x/y/z) and a size (dx/dy/dz)
plus any number of numeric or categorical attribute columns.

A :class:`BlockModel` object stores the block data table together with
top-level metadata (name, CRS, origin, bbox, block size bounds, etc.).
"""

import json
import warnings

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Column name constants
# ---------------------------------------------------------------------------

X = "x"
Y = "y"
Z = "z"
DX = "dx"
DY = "dy"
DZ = "dz"

# Canonical geometry columns that every block table must have.
BLOCK_GEOMETRY_COLS = [X, Y, Z, DX, DY, DZ]

# Mapping from accepted source column name variants to canonical names.
# Keys are normalised (lower-cased, stripped) source names; values are
# canonical names used internally.
BLOCK_COLUMN_MAP = {
    X: ["x", "easting", "center_x", "xc", "xcentre", "xcenter",
        "x_centre", "x_center", "cx"],
    Y: ["y", "northing", "center_y", "yc", "ycentre", "ycenter",
        "y_centre", "y_center", "cy"],
    Z: ["z", "elevation", "center_z", "zc", "zcentre", "zcenter",
        "z_centre", "z_center", "cz"],
    DX: ["dx", "size_x", "sx", "sizex", "dim_x", "block_size_x"],
    DY: ["dy", "size_y", "sy", "sizey", "dim_y", "block_size_y"],
    DZ: ["dz", "size_z", "sz", "sizez", "dim_z", "block_size_z"],
}

# Reverse lookup: normalised source name -> canonical name
_BLOCK_COL_LOOKUP: dict[str, str] = {}
for _canon, _variants in BLOCK_COLUMN_MAP.items():
    for _v in _variants:
        _BLOCK_COL_LOOKUP[_v.lower().strip()] = _canon


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _standardize_block_columns(df: pd.DataFrame, source_column_map: dict | None = None) -> pd.DataFrame:
    """Rename df columns to canonical block model names."""
    lookup = dict(_BLOCK_COL_LOOKUP)
    if source_column_map:
        for raw, target in source_column_map.items():
            lookup[str(raw).lower().strip()] = str(target).lower().strip()

    renamed = {col: lookup.get(col.lower().strip(), col) for col in df.columns}
    out = df.rename(columns=renamed)
    if not out.columns.is_unique:
        out = out.T.groupby(level=0, sort=False).first().T
    return out


def _calculate_bbox(df: pd.DataFrame) -> dict:
    """Calculate 3-D bounding box from block centres and sizes."""
    min_x = (df[X] - df[DX] / 2).min()
    max_x = (df[X] + df[DX] / 2).max()
    min_y = (df[Y] - df[DY] / 2).min()
    max_y = (df[Y] + df[DY] / 2).max()
    min_z = (df[Z] - df[DZ] / 2).min()
    max_z = (df[Z] + df[DZ] / 2).max()
    return {
        "min_x": float(min_x), "max_x": float(max_x),
        "min_y": float(min_y), "max_y": float(max_y),
        "min_z": float(min_z), "max_z": float(max_z),
    }


def _calculate_outline_2d(bbox: dict) -> dict:
    """Build a GeoJSON polygon from the 2-D (x/y) portion of a bbox."""
    coords = [
        [bbox["min_x"], bbox["min_y"]],
        [bbox["max_x"], bbox["min_y"]],
        [bbox["max_x"], bbox["max_y"]],
        [bbox["min_x"], bbox["max_y"]],
        [bbox["min_x"], bbox["min_y"]],
    ]
    return {"type": "Polygon", "coordinates": [coords]}


def _apply_criteria(df: pd.DataFrame, criteria) -> pd.Series:
    """Return a boolean mask for *criteria* applied to *df*.

    *criteria* may be:
    - A callable ``(df) -> bool Series``
    - A dict ``{col: value}`` for exact equality  (categorical or numeric)
    - A dict ``{col: dict}`` with operator keys ``gt``, ``gte``, ``lt``,
      ``lte``, ``eq``, ``ne``, ``in``
    - A pandas query string
    """
    if callable(criteria):
        return criteria(df)

    if isinstance(criteria, str):
        return df.eval(criteria)

    if isinstance(criteria, dict):
        mask = pd.Series([True] * len(df), index=df.index)
        for col, condition in criteria.items():
            if col not in df.columns:
                continue
            if isinstance(condition, dict):
                if "gt" in condition:
                    mask &= df[col] > condition["gt"]
                if "gte" in condition:
                    mask &= df[col] >= condition["gte"]
                if "lt" in condition:
                    mask &= df[col] < condition["lt"]
                if "lte" in condition:
                    mask &= df[col] <= condition["lte"]
                if "eq" in condition:
                    mask &= df[col] == condition["eq"]
                if "ne" in condition:
                    mask &= df[col] != condition["ne"]
                if "in" in condition:
                    mask &= df[col].isin(condition["in"])
            else:
                mask &= df[col] == condition
        return mask

    raise TypeError(f"Unsupported criteria type: {type(criteria)}")


# ---------------------------------------------------------------------------
# BlockModel class
# ---------------------------------------------------------------------------

class BlockModel:
    """A block model: a collection of rectangular prism blocks with metadata.

    Parameters
    ----------
    blocks : pd.DataFrame
        One row per block; must include canonical columns x, y, z, dx, dy, dz
        plus any attribute columns.
    metadata : dict, optional
        Top-level metadata dict (see :func:`load_block_metadata`).

    Attributes
    ----------
    blocks : pd.DataFrame
    name : str
    description : str
    crs : str
    origin : dict  – keys: x, y, z, rotation_deg
    max_block_size : dict  – keys: dx, dy, dz
    min_block_size : dict  – keys: dx, dy, dz
    bbox_3d : dict  – keys: min_x, max_x, min_y, max_y, min_z, max_z
    outline_2d : dict  – GeoJSON Polygon
    extra : dict
    """

    def __init__(self, blocks: pd.DataFrame, metadata: dict | None = None):
        self.blocks = blocks.reset_index(drop=True)
        meta = metadata or {}
        self.name: str = meta.get("name", "")
        self.description: str = meta.get("description", "")
        self.crs: str = meta.get("crs", "")
        self.origin: dict = meta.get("origin", {})
        self.max_block_size: dict = meta.get("max_block_size", {})
        self.min_block_size: dict = meta.get("min_block_size", {})
        self.extra: dict = meta.get("extra", {})

        # Compute bbox and outline from blocks if not provided
        has_geom = all(c in self.blocks.columns for c in BLOCK_GEOMETRY_COLS)
        if meta.get("bbox_3d"):
            self.bbox_3d = meta["bbox_3d"]
        elif has_geom and not self.blocks.empty:
            self.bbox_3d = _calculate_bbox(self.blocks)
        else:
            self.bbox_3d = {}

        if meta.get("outline_2d"):
            self.outline_2d = meta["outline_2d"]
        elif self.bbox_3d:
            self.outline_2d = _calculate_outline_2d(self.bbox_3d)
        else:
            self.outline_2d = {}

        # Derive max/min block size from blocks if not provided
        if has_geom and not self.blocks.empty:
            if not self.max_block_size:
                self.max_block_size = {
                    "dx": float(self.blocks[DX].max()),
                    "dy": float(self.blocks[DY].max()),
                    "dz": float(self.blocks[DZ].max()),
                }
            if not self.min_block_size:
                self.min_block_size = {
                    "dx": float(self.blocks[DX].min()),
                    "dy": float(self.blocks[DY].min()),
                    "dz": float(self.blocks[DZ].min()),
                }

    # ------------------------------------------------------------------
    # Calculations
    # ------------------------------------------------------------------

    def total_volume(self) -> float:
        """Return the total volume of all blocks (sum of dx*dy*dz)."""
        if self.blocks.empty:
            return 0.0
        return float((self.blocks[DX] * self.blocks[DY] * self.blocks[DZ]).sum())

    def filtered_volume(self, criteria) -> float:
        """Return the total volume of blocks that satisfy *criteria*.

        Parameters
        ----------
        criteria : callable | dict | str
            See :func:`_apply_criteria` for accepted forms.

        Examples
        --------
        >>> bm.filtered_volume({"grade": {"gte": 1.0}})
        >>> bm.filtered_volume({"classification": "ore"})
        >>> bm.filtered_volume(lambda df: df["grade"] > 1.0)
        """
        if self.blocks.empty:
            return 0.0
        mask = _apply_criteria(self.blocks, criteria)
        subset = self.blocks[mask]
        return float((subset[DX] * subset[DY] * subset[DZ]).sum())

    def attribute_stats(self, attribute: str, filter_criteria=None) -> dict:
        """Return summary statistics for a block attribute column.

        Parameters
        ----------
        attribute : str
            Name of the attribute column.
        filter_criteria : optional
            If provided, statistics are computed only on matching blocks.
            See :func:`_apply_criteria`.

        Returns
        -------
        dict
            For numeric columns: ``{type, count, min, max, mean, std, sum}``.
            For categorical columns: ``{type, count, value_counts}``.
        """
        if attribute not in self.blocks.columns:
            raise KeyError(f"Attribute '{attribute}' not found in block model columns")

        df = self.blocks
        if filter_criteria is not None:
            mask = _apply_criteria(df, filter_criteria)
            df = df[mask]

        series = df[attribute].dropna()

        if pd.api.types.is_numeric_dtype(series):
            return {
                "type": "numeric",
                "count": int(series.count()),
                "min": float(series.min()) if not series.empty else None,
                "max": float(series.max()) if not series.empty else None,
                "mean": float(series.mean()) if not series.empty else None,
                "std": float(series.std()) if not series.empty else None,
                "sum": float(series.sum()),
            }

        value_counts = series.value_counts().to_dict()
        return {
            "type": "categorical",
            "count": int(series.count()),
            "value_counts": {str(k): int(v) for k, v in value_counts.items()},
        }

    def block_size_stats(self) -> dict:
        """Return minimum and maximum block dimensions present in the model."""
        if self.blocks.empty:
            return {"min": {}, "max": {}}
        return {
            "min": {
                "dx": float(self.blocks[DX].min()),
                "dy": float(self.blocks[DY].min()),
                "dz": float(self.blocks[DZ].min()),
            },
            "max": {
                "dx": float(self.blocks[DX].max()),
                "dy": float(self.blocks[DY].max()),
                "dz": float(self.blocks[DZ].max()),
            },
        }

    def query_metadata(self) -> dict:
        """Return a snapshot of the block model metadata as a plain dict."""
        return {
            "name": self.name,
            "description": self.description,
            "crs": self.crs,
            "origin": self.origin,
            "max_block_size": self.max_block_size,
            "min_block_size": self.min_block_size,
            "bbox_3d": self.bbox_3d,
            "outline_2d": self.outline_2d,
            "extra": self.extra,
            "block_count": len(self.blocks),
        }

    def __repr__(self) -> str:
        return (
            f"BlockModel(name={self.name!r}, blocks={len(self.blocks)}, "
            f"crs={self.crs!r})"
        )


# ---------------------------------------------------------------------------
# Loading helpers
# ---------------------------------------------------------------------------

def load_block_metadata(source) -> dict:
    """Load block model metadata from a JSON file path or dict.

    Parameters
    ----------
    source : str | Path | dict
        Path to a JSON file, or a dict already in memory.

    Returns
    -------
    dict
    """
    if isinstance(source, dict):
        return source
    with open(source, encoding="utf-8") as fh:
        return json.load(fh)


def load_blocks(
    source,
    kind: str = "csv",
    metadata=None,
    source_column_map: dict | None = None,
    connection=None,
    query: str | None = None,
    table: str | None = None,
    **kwargs,
) -> "BlockModel":
    """Load block model data and return a :class:`BlockModel`.

    Parameters
    ----------
    source : str | Path | pd.DataFrame | file-like
        CSV path/file, Parquet path/file, or a pre-built DataFrame.
    kind : ``'csv'`` | ``'parquet'`` | ``'sql'``
        Source type (ignored when *source* is already a DataFrame).
    metadata : dict | str | Path | None
        Block model metadata.  Accepted forms:
        - ``None`` – metadata is derived from the blocks.
        - A ``dict`` with metadata fields.
        - A file path to a JSON metadata file.
    source_column_map : dict, optional
        Extra column-name overrides mapping raw names to baselode names.
    connection : optional
        SQLAlchemy engine/connection (SQL sources only).
    query : str, optional
        SQL query string (SQL sources only).
    table : str, optional
        SQL table name (SQL sources only; used if *query* is not provided).
    **kwargs
        Forwarded to the underlying pandas reader.

    Returns
    -------
    BlockModel
    """
    if isinstance(source, pd.DataFrame):
        df = source.copy()
    elif kind == "csv":
        df = pd.read_csv(source, **kwargs)
    elif kind == "parquet":
        df = pd.read_parquet(source, **kwargs)
    elif kind == "sql":
        if query is None and table is None:
            raise ValueError("For SQL sources, provide query or table")
        df = (
            pd.read_sql_query(query, connection, **kwargs)
            if query is not None
            else pd.read_sql_table(table, connection, **kwargs)
        )
    else:
        raise ValueError(f"Unsupported kind: {kind!r}")

    df = _standardize_block_columns(df, source_column_map=source_column_map)

    missing = [c for c in BLOCK_GEOMETRY_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"Block table missing required geometry column(s): {missing}")

    for col in BLOCK_GEOMETRY_COLS:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    if df[X].isna().any() or df[Y].isna().any() or df[Z].isna().any():
        warnings.warn("Some blocks have NaN centre coordinates and will be included as-is.", stacklevel=2)

    meta = None
    if metadata is not None:
        meta = load_block_metadata(metadata)

    return BlockModel(df, metadata=meta)
