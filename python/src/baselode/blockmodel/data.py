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

"""Block model data loading, the :class:`BlockModel` primitive, and operations.

A block model is a table of rectangular blocks plus a
:class:`~baselode.blockmodel.definition.BlockModelDefinition` describing
the grid they sit on.  Blocks may be *sub-blocked*: the definition fixes a
base block size, and every block spans a whole number of base blocks in
each axis (one base block for the finest sub-block, several for a parent
block).  Attributes are any further columns on the table.

Two equivalent geometry encodings are supported on the blocks table and
either can be loaded; the other is derived from the definition:

- ``i, j, k, ni, nj, nk`` — base-cell index of the block's minimum corner
  and its extent in base blocks (exact, integer);
- ``x, y, z, dx, dy, dz`` — world centroid and block size along the grid
  axes (what CSV / Parquet exports and the 3D viewer use).

Models loaded without a definition (legacy metadata, or none) still work
for volume / attribute statistics; grid-aware operations raise
``ValueError`` until a definition is attached.
"""

import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

from baselode.blockmodel.definition import BlockModelDefinition
from baselode.datamodel import (
    BLOCK_X, BLOCK_Y, BLOCK_Z, BLOCK_DX, BLOCK_DY, BLOCK_DZ,
    BLOCK_I, BLOCK_J, BLOCK_K, BLOCK_NI, BLOCK_NJ, BLOCK_NK,
)

# ---------------------------------------------------------------------------
# Column name constants
# ---------------------------------------------------------------------------

X = BLOCK_X
Y = BLOCK_Y
Z = BLOCK_Z
DX = BLOCK_DX
DY = BLOCK_DY
DZ = BLOCK_DZ
I = BLOCK_I
J = BLOCK_J
K = BLOCK_K
NI = BLOCK_NI
NJ = BLOCK_NJ
NK = BLOCK_NK

# Canonical geometry columns that every block table must have.
BLOCK_GEOMETRY_COLS = [X, Y, Z, DX, DY, DZ]
# Base-grid index columns, present whenever a definition is attached.
BLOCK_INDEX_COLS = [I, J, K, NI, NJ, NK]

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
    DX: ["dx", "size_x", "sx", "sizex", "dim_x", "block_size_x", "xinc"],
    DY: ["dy", "size_y", "sy", "sizey", "dim_y", "block_size_y", "yinc"],
    DZ: ["dz", "size_z", "sz", "sizez", "dim_z", "block_size_z", "zinc"],
    I: ["i", "ii", "ix", "i_index", "index_i", "col"],
    J: ["j", "jj", "iy", "j_index", "index_j", "row"],
    K: ["k", "kk", "iz", "k_index", "index_k", "level"],
    NI: ["ni", "nx_sub", "n_i", "sub_i", "isub"],
    NJ: ["nj", "ny_sub", "n_j", "sub_j", "jsub"],
    NK: ["nk", "nz_sub", "n_k", "sub_k", "ksub"],
}

# Reverse lookup: normalised source name -> canonical name
_BLOCK_COL_LOOKUP = {}
for _canon, _variants in BLOCK_COLUMN_MAP.items():
    for _v in _variants:
        _BLOCK_COL_LOOKUP[_v.lower().strip()] = _canon

_VALID_AGGREGATIONS = ("mean", "sum", "min", "max", "majority", "first")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _standardize_block_columns(df, source_column_map=None):
    """Rename df columns to canonical block model names."""
    lookup = dict(_BLOCK_COL_LOOKUP)
    if source_column_map:
        for raw, target in source_column_map.items():
            lookup[str(raw).lower().strip()] = str(target).lower().strip()

    renamed = {col: lookup.get(str(col).lower().strip(), col) for col in df.columns}
    out = df.rename(columns=renamed)
    if not out.columns.is_unique:
        out = out.T.groupby(level=0, sort=False).first().T
    return out


def _calculate_bbox(df):
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


def _calculate_outline_2d(bbox):
    """Build a GeoJSON polygon from the 2-D (x/y) portion of a bbox."""
    coords = [
        [bbox["min_x"], bbox["min_y"]],
        [bbox["max_x"], bbox["min_y"]],
        [bbox["max_x"], bbox["max_y"]],
        [bbox["min_x"], bbox["max_y"]],
        [bbox["min_x"], bbox["min_y"]],
    ]
    return {"type": "Polygon", "coordinates": [coords]}


def _apply_criteria(df, criteria):
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


def attach_block_indices(blocks, definition, overwrite=False):
    """Derive ``i, j, k, ni, nj, nk`` from world centroids and sizes.

    The block's minimum corner is mapped into the grid frame and snapped
    to the nearest base cell; sizes are snapped to the nearest whole
    number of base blocks (at least one).  Snapping never fails — a block
    that does not sit on the grid still gets the closest indices, and
    :func:`baselode.blockmodel.validate.validate_alignment` reports the
    residual.

    Parameters
    ----------
    blocks : pd.DataFrame
        Table with ``x, y, z, dx, dy, dz``.
    definition : BlockModelDefinition
    overwrite : bool, optional
        Recompute even when index columns already exist.  Default
        ``False`` keeps existing indices untouched.

    Returns
    -------
    pd.DataFrame
        Copy of *blocks* with the six index columns (integer dtype).
    """
    out = blocks.copy()
    if not overwrite and all(col in out.columns for col in BLOCK_INDEX_COLS):
        for col in BLOCK_INDEX_COLS:
            out[col] = pd.to_numeric(out[col], errors="coerce").astype("Int64")
        return out
    missing = [c for c in BLOCK_GEOMETRY_COLS if c not in out.columns]
    if missing:
        raise ValueError(f"cannot derive block indices without geometry columns {missing}")
    if out.empty:
        for col in BLOCK_INDEX_COLS:
            out[col] = pd.Series(dtype="Int64")
        return out

    bx, by, bz = definition.block_size
    dx = pd.to_numeric(out[DX], errors="coerce").to_numpy(dtype=float)
    dy = pd.to_numeric(out[DY], errors="coerce").to_numpy(dtype=float)
    dz = pd.to_numeric(out[DZ], errors="coerce").to_numpy(dtype=float)
    u, v, w = definition.world_to_local(
        pd.to_numeric(out[X], errors="coerce").to_numpy(dtype=float),
        pd.to_numeric(out[Y], errors="coerce").to_numpy(dtype=float),
        pd.to_numeric(out[Z], errors="coerce").to_numpy(dtype=float),
    )
    with np.errstate(invalid="ignore"):
        ni = np.maximum(1, np.rint(dx / bx))
        nj = np.maximum(1, np.rint(dy / by))
        nk = np.maximum(1, np.rint(dz / bz))
        i = np.rint((u - dx / 2.0) / bx)
        j = np.rint((v - dy / 2.0) / by)
        k = np.rint((w - dz / 2.0) / bz)
    for col, values in ((I, i), (J, j), (K, k), (NI, ni), (NJ, nj), (NK, nk)):
        out[col] = pd.Series(values, index=out.index).astype("Int64")
    return out


def attach_block_centroids(blocks, definition, overwrite=False):
    """Derive ``x, y, z, dx, dy, dz`` from base-grid indices and the definition.

    Parameters
    ----------
    blocks : pd.DataFrame
        Table with ``i, j, k, ni, nj, nk`` (``ni/nj/nk`` default to 1
        when absent).
    definition : BlockModelDefinition
    overwrite : bool, optional
        Recompute even when geometry columns already exist.

    Returns
    -------
    pd.DataFrame
        Copy of *blocks* with the six geometry columns.
    """
    out = blocks.copy()
    if not overwrite and all(col in out.columns for col in BLOCK_GEOMETRY_COLS):
        return out
    for col in (I, J, K):
        if col not in out.columns:
            raise ValueError(f"cannot derive block centroids without index column '{col}'")
    for col in (NI, NJ, NK):
        if col not in out.columns:
            out[col] = 1
    i = pd.to_numeric(out[I], errors="coerce").to_numpy(dtype=float)
    j = pd.to_numeric(out[J], errors="coerce").to_numpy(dtype=float)
    k = pd.to_numeric(out[K], errors="coerce").to_numpy(dtype=float)
    ni = pd.to_numeric(out[NI], errors="coerce").to_numpy(dtype=float)
    nj = pd.to_numeric(out[NJ], errors="coerce").to_numpy(dtype=float)
    nk = pd.to_numeric(out[NK], errors="coerce").to_numpy(dtype=float)
    x, y, z = definition.index_to_world(i, j, k, ni, nj, nk)
    bx, by, bz = definition.block_size
    out[X] = x
    out[Y] = y
    out[Z] = z
    out[DX] = ni * bx
    out[DY] = nj * by
    out[DZ] = nk * bz
    return out


def _weighted_mean(values, weights):
    mask = values.notna() & weights.notna()
    total = float(weights[mask].sum())
    if total <= 0:
        return float("nan")
    return float((values[mask] * weights[mask]).sum() / total)


def _majority(values, weights):
    mask = values.notna()
    if not mask.any():
        return None
    totals = weights[mask].groupby(values[mask]).sum()
    return totals.sort_values(ascending=False).index[0]


def _legacy_definition(meta):
    """Best-effort definition from legacy metadata; ``None`` when it can't be built."""
    if not meta:
        return None
    try:
        return BlockModelDefinition.from_dict(meta)
    except (ValueError, TypeError, KeyError):
        return None


# ---------------------------------------------------------------------------
# BlockModel class
# ---------------------------------------------------------------------------

class BlockModel:
    """A (sub-blocked) block model: a table of blocks on a grid definition.

    Parameters
    ----------
    blocks : pd.DataFrame
        One row per block.  Must carry either the geometry columns
        ``x, y, z, dx, dy, dz`` or (with a definition) the index columns
        ``i, j, k`` (+ optional ``ni, nj, nk``), plus any attribute
        columns.  Whichever encoding is missing is derived.
    metadata : dict, optional
        Legacy top-level metadata (``name``, ``crs``, ``origin``,
        ``max_block_size``, ``min_block_size``, ``bbox_3d``,
        ``outline_2d``, ``attributes``, ``extra``).  Still honoured for
        the legacy attributes below, and still the second positional
        argument.
    definition : BlockModelDefinition or dict, optional (keyword-only)
        The grid.  A dict is passed through
        :meth:`BlockModelDefinition.from_dict`.  When omitted, one is
        built from *metadata* if that carries enough (legacy
        ``min_block_size`` / ``max_block_size`` / ``bbox_3d`` files do).

    Attributes
    ----------
    blocks : pd.DataFrame
    definition : BlockModelDefinition or None
    name, description, crs : str
    origin : dict  – keys: x, y, z, rotation_deg
    max_block_size, min_block_size : dict  – keys: dx, dy, dz
    bbox_3d : dict  – keys: min_x, max_x, min_y, max_y, min_z, max_z
    outline_2d : dict  – GeoJSON Polygon
    attributes : dict  – attribute descriptions from metadata
    extra : dict
    """

    def __init__(self, blocks, metadata=None, *, definition=None):
        meta = dict(metadata or {})
        if definition is None:
            definition = _legacy_definition(meta)
        elif isinstance(definition, dict):
            definition = BlockModelDefinition.from_dict(definition)
        self.definition = definition

        blocks = blocks.reset_index(drop=True)
        if definition is not None:
            has_geom = all(c in blocks.columns for c in BLOCK_GEOMETRY_COLS)
            has_index = all(c in blocks.columns for c in (I, J, K))
            if not has_geom and has_index:
                blocks = attach_block_centroids(blocks, definition)
            if not blocks.empty or has_geom:
                blocks = attach_block_indices(blocks, definition)
        self.blocks = blocks
        self._occupancy = None

        self.name = meta.get("name") or (definition.name if definition else "")
        self.description = meta.get("description") or (definition.description if definition else "")
        self.crs = meta.get("crs") or (definition.crs if definition else "")
        self.attributes = dict(meta.get("attributes") or {})
        self.extra = dict(meta.get("extra") or (definition.extra if definition else {}))

        has_geom = all(c in self.blocks.columns for c in BLOCK_GEOMETRY_COLS)
        if definition is not None:
            self.origin = {
                "x": definition.origin[0], "y": definition.origin[1], "z": definition.origin[2],
                "rotation_deg": definition.azimuth,
            }
            self.bbox_3d = meta.get("bbox_3d") or definition.bounds()
            self.outline_2d = meta.get("outline_2d") or definition.outline_2d()
            base = dict(zip(("dx", "dy", "dz"), definition.block_size))
            parent = definition.parent_block_size
            self.min_block_size = meta.get("min_block_size") or base
            self.max_block_size = meta.get("max_block_size") or (
                dict(zip(("dx", "dy", "dz"), parent)) if parent else base
            )
        else:
            self.origin = dict(meta.get("origin", {}))
            self.max_block_size = dict(meta.get("max_block_size", {}))
            self.min_block_size = dict(meta.get("min_block_size", {}))
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
    # Basics
    # ------------------------------------------------------------------

    def _require_definition(self, what):
        if self.definition is None:
            raise ValueError(f"{what} needs a BlockModelDefinition; this model has none")
        return self.definition

    @property
    def attribute_columns(self):
        """Columns that are neither geometry nor base-grid indices."""
        reserved = set(BLOCK_GEOMETRY_COLS) | set(BLOCK_INDEX_COLS)
        return [c for c in self.blocks.columns if c not in reserved]

    def _copy_with(self, blocks, definition=None):
        clone = BlockModel(
            blocks,
            definition=self.definition if definition is None else definition,
            metadata={
                "name": self.name, "description": self.description, "crs": self.crs,
                "attributes": self.attributes, "extra": self.extra,
            },
        )
        return clone

    def _cell_volumes(self):
        if self.blocks.empty:
            return pd.Series(dtype=float)
        return (self.blocks[DX] * self.blocks[DY] * self.blocks[DZ]).astype(float)

    # ------------------------------------------------------------------
    # Calculations
    # ------------------------------------------------------------------

    def total_volume(self):
        """Return the total volume of all blocks (sum of dx*dy*dz)."""
        if self.blocks.empty:
            return 0.0
        return float(self._cell_volumes().sum())

    def filtered_volume(self, criteria):
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

    def attribute_stats(self, attribute, filter_criteria=None):
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

    def block_size_stats(self):
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

    def query_metadata(self):
        """Return a snapshot of the block model metadata as a plain dict."""
        out = {
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
        if self.definition is not None:
            out["definition"] = self.definition.to_dict()
        return out

    # ------------------------------------------------------------------
    # Grid-aware operations
    # ------------------------------------------------------------------

    def _index_arrays(self):
        cols = self.blocks[BLOCK_INDEX_COLS]
        return [pd.to_numeric(cols[c], errors="coerce").to_numpy(dtype=float) for c in BLOCK_INDEX_COLS]

    def occupancy(self):
        """Map ``(i, j, k)`` base cell -> row position of the block covering it.

        Built lazily and cached on the instance.  Cells covered by more
        than one block keep the first block's row; use
        :func:`baselode.blockmodel.validate.validate_no_overlap` to find
        those.
        """
        self._require_definition("occupancy")
        if self._occupancy is None:
            occupancy = {}
            if not self.blocks.empty:
                i, j, k, ni, nj, nk = self._index_arrays()
                for row in range(len(self.blocks)):
                    if any(np.isnan(v[row]) for v in (i, j, k, ni, nj, nk)):
                        continue
                    i0, j0, k0 = int(i[row]), int(j[row]), int(k[row])
                    for di in range(int(ni[row])):
                        for dj in range(int(nj[row])):
                            for dk in range(int(nk[row])):
                                occupancy.setdefault((i0 + di, j0 + dj, k0 + dk), row)
            self._occupancy = occupancy
        return self._occupancy

    def block_at(self, x, y, z):
        """Row position of the block containing world point ``(x, y, z)``, or ``None``."""
        definition = self._require_definition("block_at")
        i, j, k = definition.world_to_index(x, y, z)
        return self.occupancy().get((int(i), int(j), int(k)))

    def sample_at(self, points, attributes=None):
        """Attributes of the block under each of *points*.

        Parameters
        ----------
        points : pd.DataFrame or array-like
            Either a frame with ``x, y, z`` columns or an ``(n, 3)`` array.
        attributes : list of str, optional
            Attribute columns to return; default all.

        Returns
        -------
        pd.DataFrame
            One row per point with ``x, y, z, block_row`` (``-1`` when no
            block covers the point) and the requested attributes (``NaN``
            / ``None`` where uncovered).
        """
        definition = self._require_definition("sample_at")
        if isinstance(points, pd.DataFrame):
            xs = points["x"].to_numpy(dtype=float)
            ys = points["y"].to_numpy(dtype=float)
            zs = points["z"].to_numpy(dtype=float)
        else:
            arr = np.asarray(points, dtype=float).reshape(-1, 3)
            xs, ys, zs = arr[:, 0], arr[:, 1], arr[:, 2]
        attributes = list(attributes) if attributes is not None else self.attribute_columns
        occupancy = self.occupancy()
        i, j, k = definition.world_to_index(xs, ys, zs)
        rows = [occupancy.get((int(a), int(b), int(c)), -1) for a, b, c in zip(i, j, k)]
        out = pd.DataFrame({"x": xs, "y": ys, "z": zs, "block_row": rows})
        for col in attributes:
            values = self.blocks[col].reset_index(drop=True)
            out[col] = [values.iloc[r] if r >= 0 else None for r in rows]
            if pd.api.types.is_numeric_dtype(values):
                out[col] = pd.to_numeric(out[col], errors="coerce")
        return out

    def select(self, criteria):
        """New model holding only the blocks matching *criteria* (see :func:`_apply_criteria`)."""
        mask = _apply_criteria(self.blocks, criteria)
        return self._copy_with(self.blocks[mask].reset_index(drop=True))

    def clip(self, bounds):
        """New model with only the blocks whose centroid lies inside *bounds*.

        Parameters
        ----------
        bounds : dict
            Any subset of ``min_x, max_x, min_y, max_y, min_z, max_z`` in
            world coordinates.
        """
        mask = pd.Series(True, index=self.blocks.index)
        for axis in (X, Y, Z):
            lo = bounds.get(f"min_{axis}")
            hi = bounds.get(f"max_{axis}")
            if lo is not None:
                mask &= self.blocks[axis] >= lo
            if hi is not None:
                mask &= self.blocks[axis] <= hi
        return self._copy_with(self.blocks[mask].reset_index(drop=True))

    def regularize(self):
        """Split every block into its base blocks.

        Attributes are copied onto each sub-block (volume is preserved;
        per-block totals are not — a ``tonnes`` column would be
        duplicated, which is why tonnage is computed from density, not
        stored).  A model already at base resolution is returned as an
        equivalent copy.
        """
        definition = self._require_definition("regularize")
        if self.blocks.empty:
            return self._copy_with(self.blocks.copy())
        i, j, k, ni, nj, nk = self._index_arrays()
        counts = (ni * nj * nk).astype(int)
        parents = np.repeat(np.arange(len(self.blocks)), counts)
        sub_i = np.empty(counts.sum(), dtype=int)
        sub_j = np.empty(counts.sum(), dtype=int)
        sub_k = np.empty(counts.sum(), dtype=int)
        cursor = 0
        for row in range(len(self.blocks)):
            n = counts[row]
            di, dj, dk = np.meshgrid(
                np.arange(int(ni[row])), np.arange(int(nj[row])), np.arange(int(nk[row])), indexing="ij",
            )
            sub_i[cursor:cursor + n] = int(i[row]) + di.ravel()
            sub_j[cursor:cursor + n] = int(j[row]) + dj.ravel()
            sub_k[cursor:cursor + n] = int(k[row]) + dk.ravel()
            cursor += n
        attrs = self.blocks[self.attribute_columns].iloc[parents].reset_index(drop=True)
        out = pd.DataFrame({I: sub_i, J: sub_j, K: sub_k, NI: 1, NJ: 1, NK: 1})
        out = attach_block_centroids(out, definition, overwrite=True)
        out = pd.concat([out, attrs], axis=1)
        return self._copy_with(out)

    def to_parent_blocks(self, aggregations=None, density_col=None):
        """Merge sub-blocks into their parent blocks.

        Numeric attributes are averaged weighted by volume (or by mass
        when *density_col* is given — except *density_col* itself, which
        stays volume-weighted so parent tonnage equals sub-block tonnage),
        categorical attributes take the volume-weighted majority.  Each parent row also gets ``n_subblocks`` and
        ``fill_fraction`` (covered volume / parent volume) so partially
        filled parents stay visible.

        Parameters
        ----------
        aggregations : dict, optional
            ``{column: rule}`` overrides where *rule* is one of
            ``"mean"``, ``"sum"``, ``"min"``, ``"max"``, ``"majority"``,
            ``"first"`` or a callable ``(values, weights) -> scalar``.
        density_col : str, optional
            Density attribute used to mass-weight the means.

        Returns
        -------
        BlockModel
            Regular model on the same grid (``parent_size`` becomes the
            block size, one row per parent block that had any sub-block).
        """
        definition = self._require_definition("to_parent_blocks")
        if definition.parent_size is None:
            raise ValueError("to_parent_blocks needs a definition with parent_size")
        aggregations = dict(aggregations or {})
        for col, rule in aggregations.items():
            if not callable(rule) and rule not in _VALID_AGGREGATIONS:
                raise ValueError(f"unknown aggregation {rule!r} for '{col}'; expected one of {_VALID_AGGREGATIONS}")
        px, py, pz = definition.parent_size
        parent_cells = px * py * pz
        if self.blocks.empty:
            return self._copy_with(self.blocks.copy())

        i, j, k, ni, nj, nk = self._index_arrays()
        cells = ni * nj * nk
        volume = pd.Series(cells * definition.base_cell_volume, index=self.blocks.index)
        weights = volume
        if density_col is not None:
            weights = volume * pd.to_numeric(self.blocks[density_col], errors="coerce").fillna(0.0)
        pi, pj, pk = definition.parent_index(i, j, k)
        keys = pd.DataFrame({"_pi": pi.astype(int), "_pj": pj.astype(int), "_pk": pk.astype(int)}, index=self.blocks.index)

        rows = []
        for (a, b, c), group_index in keys.groupby(["_pi", "_pj", "_pk"], sort=True).groups.items():
            group = self.blocks.loc[group_index]
            w = weights.loc[group_index]
            vol = volume.loc[group_index]
            record = {I: a * px, J: b * py, K: c * pz, NI: px, NJ: py, NK: pz}
            for col in self.attribute_columns:
                values = group[col]
                rule = aggregations.get(col)
                if rule is None:
                    rule = "mean" if pd.api.types.is_numeric_dtype(values) else "majority"
                col_weights = vol if col == density_col else w
                if callable(rule):
                    record[col] = rule(values, col_weights)
                elif rule == "mean":
                    record[col] = _weighted_mean(pd.to_numeric(values, errors="coerce"), col_weights)
                elif rule == "sum":
                    record[col] = float(pd.to_numeric(values, errors="coerce").sum())
                elif rule == "min":
                    record[col] = values.min()
                elif rule == "max":
                    record[col] = values.max()
                elif rule == "majority":
                    record[col] = _majority(values, vol)
                elif rule == "first":
                    record[col] = values.iloc[0]
            record["n_subblocks"] = int(len(group))
            record["fill_fraction"] = float(cells[self.blocks.index.get_indexer(group_index)].sum() / parent_cells)
            rows.append(record)
        out = pd.DataFrame(rows)
        out = attach_block_centroids(out, definition, overwrite=True)
        ordered = [*BLOCK_INDEX_COLS, *BLOCK_GEOMETRY_COLS] + [c for c in out.columns if c not in BLOCK_INDEX_COLS and c not in BLOCK_GEOMETRY_COLS]
        return self._copy_with(out[ordered])

    def _mass_volumes(self, blocks):
        """Per-block volume for mass calculations.

        Parent rows produced by :meth:`to_parent_blocks` carry a
        ``fill_fraction``; the geometric block volume is scaled by it so a
        partially filled parent weighs what its sub-blocks weighed.
        """
        volume = (blocks[DX] * blocks[DY] * blocks[DZ]).astype(float)
        if "fill_fraction" in blocks.columns:
            volume = volume * pd.to_numeric(blocks["fill_fraction"], errors="coerce").fillna(1.0)
        return volume

    def tonnage(self, density_col=None, density=None, criteria=None):
        """Total tonnes: ``sum(volume * density)`` over (optionally filtered) blocks.

        On a model aggregated with :meth:`to_parent_blocks` the volume of
        each parent is scaled by its ``fill_fraction``, so tonnage is
        conserved through aggregation even for partially filled parents.

        Parameters
        ----------
        density_col : str, optional
            Per-block density column.
        density : float, optional
            Constant density used when *density_col* is not given.
        criteria : optional
            Filter (see :func:`_apply_criteria`).
        """
        if self.blocks.empty:
            return 0.0
        blocks = self.blocks
        if criteria is not None:
            blocks = blocks[_apply_criteria(blocks, criteria)]
        volume = self._mass_volumes(blocks)
        if density_col is not None:
            rho = pd.to_numeric(blocks[density_col], errors="coerce")
        elif density is not None:
            rho = pd.Series(float(density), index=blocks.index)
        else:
            raise ValueError("tonnage needs density_col or density")
        return float((volume * rho).sum())

    def grade_tonnage(self, grade_col, cutoffs, density_col=None, density=None):
        """Grade-tonnage curve: tonnes, mean grade and metal above each cut-off.

        Parameters
        ----------
        grade_col : str
            Grade attribute.
        cutoffs : iterable of float
            Cut-off grades (inclusive: blocks with ``grade >= cutoff``).
        density_col, density : optional
            As for :meth:`tonnage`.

        Returns
        -------
        pd.DataFrame
            Columns ``cutoff, n_blocks, volume, tonnes, grade, metal``
            where ``grade`` is tonnage-weighted and ``metal = tonnes *
            grade`` (in grade units × tonnes; divide by 100 for percent
            grades).  ``volume`` honours ``fill_fraction`` like
            :meth:`tonnage`.
        """
        blocks = self.blocks
        grade = pd.to_numeric(blocks[grade_col], errors="coerce")
        volume = self._mass_volumes(blocks)
        if density_col is not None:
            rho = pd.to_numeric(blocks[density_col], errors="coerce")
        elif density is not None:
            rho = pd.Series(float(density), index=blocks.index)
        else:
            raise ValueError("grade_tonnage needs density_col or density")
        tonnes = volume * rho
        rows = []
        for cutoff in cutoffs:
            mask = grade >= float(cutoff)
            t = float(tonnes[mask].sum())
            g = float((grade[mask] * tonnes[mask]).sum() / t) if t > 0 else float("nan")
            rows.append({
                "cutoff": float(cutoff),
                "n_blocks": int(mask.sum()),
                "volume": float(volume[mask].sum()),
                "tonnes": t,
                "grade": g,
                "metal": t * g if t > 0 else 0.0,
            })
        return pd.DataFrame(rows, columns=["cutoff", "n_blocks", "volume", "tonnes", "grade", "metal"])

    def diff(self, other, attributes=None, tol=1e-9):
        """Cell-by-cell comparison with *other* on the shared base grid.

        Both models are regularized, then joined on ``(i, j, k)``.

        Parameters
        ----------
        other : BlockModel
            Must share origin, base block size and rotation
            (:meth:`BlockModelDefinition.same_grid`).
        attributes : list of str, optional
            Attributes to compare; default the columns both models share.
        tol : float, optional
            Numeric differences at or below *tol* count as unchanged.

        Returns
        -------
        dict
            ``{"summary": {"added", "removed", "changed", "unchanged",
            "cells_a", "cells_b"}, "cells": DataFrame}`` where *cells* has
            ``i, j, k, x, y, z, status`` and, per attribute, ``<a>_a``,
            ``<a>_b`` and (numeric) ``<a>_delta``.  ``status`` is one of
            ``added`` (only in *other*), ``removed`` (only in this
            model), ``changed`` or ``unchanged``.
        """
        definition = self._require_definition("diff")
        if other.definition is None or not definition.same_grid(other.definition):
            raise ValueError("diff needs two models on the same base grid (origin, block_size, rotation)")
        if attributes is None:
            attributes = [c for c in self.attribute_columns if c in other.attribute_columns]
        a = self.regularize().blocks[[I, J, K, *attributes]]
        b = other.regularize().blocks[[I, J, K, *attributes]]
        merged = a.merge(b, on=[I, J, K], how="outer", suffixes=("_a", "_b"), indicator=True)
        status = merged["_merge"].map({"left_only": "removed", "right_only": "added", "both": "unchanged"}).astype(object)
        changed = pd.Series(False, index=merged.index)
        for col in attributes:
            left, right = merged[f"{col}_a"], merged[f"{col}_b"]
            both = merged["_merge"] == "both"
            if pd.api.types.is_numeric_dtype(left) and pd.api.types.is_numeric_dtype(right):
                merged[f"{col}_delta"] = right - left
                differs = (merged[f"{col}_delta"].abs() > tol) | (left.isna() != right.isna())
            else:
                differs = (left.astype(object) != right.astype(object)) & ~(left.isna() & right.isna())
            changed |= both & differs
        status[changed] = "changed"
        merged["status"] = status
        merged = merged.drop(columns=["_merge"])
        x, y, z = definition.index_to_world(merged[I].to_numpy(float), merged[J].to_numpy(float), merged[K].to_numpy(float))
        merged.insert(3, "x", x)
        merged.insert(4, "y", y)
        merged.insert(5, "z", z)
        counts = merged["status"].value_counts()
        summary = {
            "added": int(counts.get("added", 0)),
            "removed": int(counts.get("removed", 0)),
            "changed": int(counts.get("changed", 0)),
            "unchanged": int(counts.get("unchanged", 0)),
            "cells_a": int(len(a)),
            "cells_b": int(len(b)),
        }
        return {"summary": summary, "cells": merged.reset_index(drop=True)}

    def validate(self):
        """Run :func:`baselode.blockmodel.validate.validate_block_model` on this model."""
        import baselode.blockmodel.validate as validate_module
        return validate_module.validate_block_model(self)

    # ------------------------------------------------------------------
    # Serialisation
    # ------------------------------------------------------------------

    def to_dict(self):
        """Metadata dict (definition + legacy fields) suitable for a ``*_meta.json``."""
        out = self.query_metadata()
        out.pop("block_count", None)
        out["attributes"] = self.attributes
        return out

    def save(self, path_stem, formats=("parquet", "csv")):
        """Write the blocks table and a metadata JSON next to it.

        Parameters
        ----------
        path_stem : str or Path
            ``<stem>.parquet`` / ``<stem>.csv`` and ``<stem>_meta.json``
            are written.
        formats : iterable of {"parquet", "csv"}

        Returns
        -------
        dict
            ``{format_or_"meta": Path}`` of everything written.
        """
        stem = Path(path_stem)
        stem.parent.mkdir(parents=True, exist_ok=True)
        written = {}
        table = self.blocks.copy()
        for col in BLOCK_INDEX_COLS:
            if col in table.columns:
                table[col] = pd.to_numeric(table[col], errors="coerce").astype("Int64")
        for fmt in formats:
            if fmt == "parquet":
                target = stem.with_suffix(".parquet")
                table.to_parquet(target, index=False)
            elif fmt == "csv":
                target = stem.with_suffix(".csv")
                table.to_csv(target, index=False)
            else:
                raise ValueError(f"unsupported format {fmt!r}")
            written[fmt] = target
        meta_path = stem.parent / f"{stem.name}_meta.json"
        meta_path.write_text(json.dumps(self.to_dict(), indent=2, default=float) + "\n", encoding="utf-8")
        written["meta"] = meta_path
        return written

    def __repr__(self):
        return (
            f"BlockModel(name={self.name!r}, blocks={len(self.blocks)}, "
            f"crs={self.crs!r})"
        )


# ---------------------------------------------------------------------------
# Loading helpers
# ---------------------------------------------------------------------------

def load_block_metadata(source):
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
    kind="csv",
    metadata=None,
    definition=None,
    source_column_map=None,
    connection=None,
    query=None,
    table=None,
    **kwargs,
):
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
        A ``definition`` key inside it (as written by :meth:`BlockModel.save`)
        or the legacy size / bbox fields yield the grid definition.
    definition : BlockModelDefinition | dict | None
        Explicit grid definition; takes precedence over *metadata*.
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

    meta = load_block_metadata(metadata) if metadata is not None else None
    if definition is None and meta is not None and meta.get("definition"):
        definition = BlockModelDefinition.from_dict(meta["definition"])
    if isinstance(definition, dict):
        definition = BlockModelDefinition.from_dict(definition)

    has_geom = all(c in df.columns for c in BLOCK_GEOMETRY_COLS)
    has_index = all(c in df.columns for c in (I, J, K))
    if not has_geom:
        if definition is None and meta is not None:
            definition = _legacy_definition(meta)
        if has_index and definition is not None:
            df = attach_block_centroids(df, definition)
        else:
            missing = [c for c in BLOCK_GEOMETRY_COLS if c not in df.columns]
            raise ValueError(f"Block table missing required geometry column(s): {missing}")

    for col in BLOCK_GEOMETRY_COLS:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    if df[X].isna().any() or df[Y].isna().any() or df[Z].isna().any():
        warnings.warn("Some blocks have NaN centre coordinates and will be included as-is.", stacklevel=2)

    return BlockModel(df, definition=definition, metadata=meta)
