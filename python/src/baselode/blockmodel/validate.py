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

"""Validation helpers for block model data.

Two layers:

- The row-level helpers (``validate_block_sizes``, ``validate_blocks_in_bbox``,
  ``validate_no_overlap``, ``validate_alignment``, ``validate_within_grid``,
  ``validate_parent_containment``) each return a list of issue dicts and
  emit a :mod:`warnings` warning when anything is found, so callers can
  decide whether to raise, warn, or ignore.
- :func:`validate_block_model` runs the grid-aware checks over a
  :class:`~baselode.blockmodel.data.BlockModel` and returns a structured
  ``{"summary", "issues"}`` report in the same shape as
  :func:`baselode.drill.validate.validate_drillhole_db`.
"""

import warnings

import numpy as np
import pandas as pd

from baselode.blockmodel.data import (
    X, Y, Z, DX, DY, DZ, I, J, K, NI, NJ, NK, BLOCK_GEOMETRY_COLS, BLOCK_INDEX_COLS,
)

SEVERITY_ERROR = "error"
SEVERITY_WARNING = "warning"
SEVERITY_INFO = "info"


def _warn(prefix, issues):
    if issues:
        warnings.warn(f"{prefix}: {len(issues)} issue(s) found.", UserWarning, stacklevel=3)


def validate_block_sizes(blocks, max_block_size):
    """Check that every block's dimensions are integer divisors of *max_block_size*.

    A dimension d is an acceptable divisor of max D when D / d is (very close to)
    a positive integer.

    Parameters
    ----------
    blocks : pd.DataFrame
        Block table with ``dx``, ``dy``, ``dz`` columns.
    max_block_size : dict
        Mapping with keys ``dx``, ``dy``, ``dz`` giving the maximum block size.

    Returns
    -------
    list[dict]
        Issue dicts with keys ``row_index``, ``type``, ``axis``,
        ``block_size``, ``max_size``.
    """
    issues = []
    tol = 1e-6

    for axis, dim_col in [(DX, DX), (DY, DY), (DZ, DZ)]:
        max_val = max_block_size.get(axis)
        if max_val is None or max_val <= 0:
            continue

        for idx, row in blocks.iterrows():
            d = row.get(dim_col)
            if pd.isna(d) or d <= 0:
                issues.append({
                    "row_index": idx,
                    "type": "non_positive_block_size",
                    "axis": axis,
                    "block_size": d,
                    "max_size": max_val,
                })
                continue
            ratio = max_val / d
            if abs(ratio - round(ratio)) > tol:
                issues.append({
                    "row_index": idx,
                    "type": "invalid_block_size_divisor",
                    "axis": axis,
                    "block_size": float(d),
                    "max_size": float(max_val),
                    "ratio": float(ratio),
                })

    _warn("validate_block_sizes", issues)
    return issues


def validate_blocks_in_bbox(blocks, bbox_3d):
    """Check that every block lies entirely within *bbox_3d*.

    Parameters
    ----------
    blocks : pd.DataFrame
        Block table with x/y/z/dx/dy/dz columns.
    bbox_3d : dict
        Keys: ``min_x``, ``max_x``, ``min_y``, ``max_y``, ``min_z``, ``max_z``.

    Returns
    -------
    list[dict]
    """
    issues = []

    checks = [
        (X, DX, "min_x", "max_x"),
        (Y, DY, "min_y", "max_y"),
        (Z, DZ, "min_z", "max_z"),
    ]

    for centre_col, dim_col, bbox_min_key, bbox_max_key in checks:
        bbox_min = bbox_3d.get(bbox_min_key)
        bbox_max = bbox_3d.get(bbox_max_key)
        if bbox_min is None or bbox_max is None:
            continue

        block_min = blocks[centre_col] - blocks[dim_col] / 2
        block_max = blocks[centre_col] + blocks[dim_col] / 2

        outside = blocks[(block_min < bbox_min - 1e-6) | (block_max > bbox_max + 1e-6)]
        for idx, row in outside.iterrows():
            issues.append({
                "row_index": idx,
                "type": "block_outside_bbox",
                "axis": centre_col,
                "block_centre": float(row[centre_col]),
                "block_dim": float(row[dim_col]),
            })

    _warn("validate_blocks_in_bbox", issues)
    return issues


def _index_frame(blocks):
    """Index columns as float arrays (NaN where missing / non-numeric)."""
    return [pd.to_numeric(blocks[c], errors="coerce").to_numpy(dtype=float) for c in BLOCK_INDEX_COLS]


def validate_no_overlap(blocks, definition=None):
    """Check that no two blocks intersect / overlap each other.

    With a *definition* (and ``i, j, k, ni, nj, nk`` on the table) the
    check walks each block's base cells once and reports every cell
    claimed twice — O(n · cells per block), fine for large models.
    Without one it falls back to pairwise axis-aligned bounding-box
    tests, which is O(n²) and intended for moderately-sized models
    (thousands of blocks).

    Parameters
    ----------
    blocks : pd.DataFrame
        Block table with x/y/z/dx/dy/dz (and, with a definition, the
        index columns).
    definition : BlockModelDefinition, optional

    Returns
    -------
    list[dict]
        Each issue identifies the two overlapping block row indices
        (``block_i`` < ``block_j``); with a definition it also carries
        the first shared base ``cell``.
    """
    issues = []

    if blocks.empty or len(blocks) < 2:
        return issues

    if definition is not None and all(c in blocks.columns for c in BLOCK_INDEX_COLS):
        i, j, k, ni, nj, nk = _index_frame(blocks)
        indices = blocks.index.to_numpy()
        occupancy = {}
        seen_pairs = set()
        for row in range(len(blocks)):
            if any(np.isnan(v[row]) for v in (i, j, k, ni, nj, nk)):
                continue
            i0, j0, k0 = int(i[row]), int(j[row]), int(k[row])
            for di in range(max(1, int(ni[row]))):
                for dj in range(max(1, int(nj[row]))):
                    for dk in range(max(1, int(nk[row]))):
                        cell = (i0 + di, j0 + dj, k0 + dk)
                        first = occupancy.setdefault(cell, row)
                        if first != row and (first, row) not in seen_pairs:
                            seen_pairs.add((first, row))
                            issues.append({
                                "type": "overlap",
                                "block_i": int(indices[first]),
                                "block_j": int(indices[row]),
                                "cell": cell,
                            })
        _warn("validate_no_overlap", issues)
        return issues

    cx = blocks[X].to_numpy(dtype=float)
    cy = blocks[Y].to_numpy(dtype=float)
    cz = blocks[Z].to_numpy(dtype=float)
    hdx = blocks[DX].to_numpy(dtype=float) / 2.0
    hdy = blocks[DY].to_numpy(dtype=float) / 2.0
    hdz = blocks[DZ].to_numpy(dtype=float) / 2.0

    tol = 1e-6
    n = len(cx)
    indices = blocks.index.to_numpy()

    for a in range(n):
        for b in range(a + 1, n):
            # AABB overlap test: two boxes overlap iff they overlap on all three axes
            if (
                abs(cx[a] - cx[b]) < hdx[a] + hdx[b] - tol
                and abs(cy[a] - cy[b]) < hdy[a] + hdy[b] - tol
                and abs(cz[a] - cz[b]) < hdz[a] + hdz[b] - tol
            ):
                issues.append({
                    "type": "overlap",
                    "block_i": int(indices[a]),
                    "block_j": int(indices[b]),
                })

    _warn("validate_no_overlap", issues)
    return issues


def validate_alignment(blocks, definition, tol=1e-6):
    """Check that every block sits on the definition's base grid.

    A block is aligned when, in the grid frame, its minimum corner lies
    on a base-cell boundary and each of its sizes is a whole (positive)
    number of base blocks.  Uses the world geometry columns, so it also
    catches ``i/j/k`` values that disagree with ``x/y/z``.

    Parameters
    ----------
    blocks : pd.DataFrame
        Block table with x/y/z/dx/dy/dz.
    definition : BlockModelDefinition
    tol : float, optional
        Tolerance in base-block units (default ``1e-6``).

    Returns
    -------
    list[dict]
        Issue dicts with ``row_index``, ``type`` (``misaligned_corner``,
        ``size_not_multiple`` or ``non_positive_block_size``), ``axis``
        and the offending value.
    """
    issues = []
    missing = [c for c in BLOCK_GEOMETRY_COLS if c not in blocks.columns]
    if blocks.empty or missing:
        return issues

    u, v, w = definition.world_to_local(
        blocks[X].to_numpy(dtype=float), blocks[Y].to_numpy(dtype=float), blocks[Z].to_numpy(dtype=float),
    )
    sizes = {
        "x": (u, blocks[DX].to_numpy(dtype=float), definition.block_size[0]),
        "y": (v, blocks[DY].to_numpy(dtype=float), definition.block_size[1]),
        "z": (w, blocks[DZ].to_numpy(dtype=float), definition.block_size[2]),
    }
    indices = blocks.index.to_numpy()
    for axis, (centre, size, base) in sizes.items():
        with np.errstate(invalid="ignore"):
            multiples = size / base
            corners = (centre - size / 2.0) / base
        for row in range(len(blocks)):
            if not np.isfinite(size[row]) or size[row] <= 0:
                issues.append({
                    "row_index": int(indices[row]), "type": "non_positive_block_size",
                    "axis": axis, "block_size": float(size[row]) if np.isfinite(size[row]) else None,
                })
                continue
            if abs(multiples[row] - round(multiples[row])) > tol or round(multiples[row]) < 1:
                issues.append({
                    "row_index": int(indices[row]), "type": "size_not_multiple",
                    "axis": axis, "block_size": float(size[row]), "base_size": float(base),
                    "multiple": float(multiples[row]),
                })
            if not np.isfinite(corners[row]):
                continue
            residual = corners[row] - round(corners[row])
            if abs(residual) > tol:
                issues.append({
                    "row_index": int(indices[row]), "type": "misaligned_corner",
                    "axis": axis, "offset": float(residual * base), "base_size": float(base),
                })
    _warn("validate_alignment", issues)
    return issues


def validate_within_grid(blocks, definition):
    """Check that every block's base cells fall inside the definition's extent.

    Returns
    -------
    list[dict]
        Issue dicts with ``row_index``, ``type`` (``block_outside_grid`` or
        ``missing_index``), ``axis`` and the offending range.
    """
    issues = []
    if blocks.empty or not all(c in blocks.columns for c in BLOCK_INDEX_COLS):
        return issues
    i, j, k, ni, nj, nk = _index_frame(blocks)
    indices = blocks.index.to_numpy()
    for row in range(len(blocks)):
        if any(np.isnan(v[row]) for v in (i, j, k, ni, nj, nk)):
            issues.append({"row_index": int(indices[row]), "type": "missing_index"})
            continue
        for axis, start, count, extent in (
            ("x", i[row], ni[row], definition.n_blocks[0]),
            ("y", j[row], nj[row], definition.n_blocks[1]),
            ("z", k[row], nk[row], definition.n_blocks[2]),
        ):
            if start < 0 or start + count > extent:
                issues.append({
                    "row_index": int(indices[row]), "type": "block_outside_grid", "axis": axis,
                    "first_cell": int(start), "last_cell": int(start + count - 1), "n_cells": int(extent),
                })
    _warn("validate_within_grid", issues)
    return issues


def validate_parent_containment(blocks, definition):
    """Check that no block straddles a parent-block boundary.

    Only meaningful when the definition declares ``parent_size``; returns
    an empty list otherwise.  A straddling block cannot be aggregated to
    a single parent, which is why :meth:`BlockModel.to_parent_blocks`
    assigns it by its minimum corner and this check flags it.

    Returns
    -------
    list[dict]
        Issue dicts with ``row_index``, ``type`` (``straddles_parent`` or
        ``larger_than_parent``) and ``axis``.
    """
    issues = []
    if definition.parent_size is None or blocks.empty:
        return issues
    if not all(c in blocks.columns for c in BLOCK_INDEX_COLS):
        return issues
    i, j, k, ni, nj, nk = _index_frame(blocks)
    indices = blocks.index.to_numpy()
    for row in range(len(blocks)):
        if any(np.isnan(v[row]) for v in (i, j, k, ni, nj, nk)):
            continue
        for axis, start, count, parent in (
            ("x", i[row], ni[row], definition.parent_size[0]),
            ("y", j[row], nj[row], definition.parent_size[1]),
            ("z", k[row], nk[row], definition.parent_size[2]),
        ):
            if count > parent:
                issues.append({
                    "row_index": int(indices[row]), "type": "larger_than_parent", "axis": axis,
                    "n_cells": int(count), "parent_cells": int(parent),
                })
            elif int(start) // parent != int(start + count - 1) // parent:
                issues.append({
                    "row_index": int(indices[row]), "type": "straddles_parent", "axis": axis,
                    "first_cell": int(start), "last_cell": int(start + count - 1), "parent_cells": int(parent),
                })
    _warn("validate_parent_containment", issues)
    return issues


def validate_index_consistency(blocks, definition):
    """Check that supplied ``i, j, k, ni, nj, nk`` agree with ``x, y, z, dx, dy, dz``.

    A table can carry both encodings; lookup, regularize and aggregate
    all trust the indices, so an index that points at a different cell
    than the geometry does must be reported.

    Returns
    -------
    list[dict]
        Issue dicts with ``row_index``, ``type`` (``index_mismatch``),
        ``column``, ``supplied`` and ``derived``.
    """
    issues = []
    if blocks.empty or not all(c in blocks.columns for c in BLOCK_INDEX_COLS + BLOCK_GEOMETRY_COLS):
        return issues
    import baselode.blockmodel.data as data_module
    derived = data_module.attach_block_indices(blocks[BLOCK_GEOMETRY_COLS], definition, overwrite=True)
    indices = blocks.index.to_numpy()
    supplied = _index_frame(blocks)
    for position, col in enumerate(BLOCK_INDEX_COLS):
        derived_values = pd.to_numeric(derived[col], errors="coerce").to_numpy(dtype=float)
        for row in range(len(blocks)):
            a, b = supplied[position][row], derived_values[row]
            if np.isnan(a) or np.isnan(b) or a == b:
                continue
            issues.append({
                "row_index": int(indices[row]), "type": "index_mismatch", "column": col,
                "supplied": int(a), "derived": int(b),
            })
    _warn("validate_index_consistency", issues)
    return issues


def _issue(check, severity, message, row_index=None, **details):
    out = {"check": check, "severity": severity, "row_index": row_index, "message": message}
    out.update(details)
    return out


def validate_block_model(model):
    """Run every grid-aware check over a :class:`BlockModel`.

    Checks (severity): ``alignment`` (error), ``index_consistency``
    (error, supplied indices disagree with the geometry), ``within_grid``
    (error), ``overlap`` (error), ``parent_containment`` (warning),
    ``duplicate_index`` (error, identical ``i, j, k, ni, nj, nk``),
    ``nan_centre`` (error).
    Models without a definition only get ``nan_centre`` and the pairwise
    ``overlap`` check.

    Returns
    -------
    dict
        ``{"summary": {"error": n, "warning": n, "info": n},
        "issues": [dict, ...]}`` — each issue carries ``check``,
        ``severity``, ``row_index``, ``message`` and the raw detail keys
        from the underlying helper.
    """
    blocks = model.blocks
    definition = model.definition
    issues = []

    if not blocks.empty and all(c in blocks.columns for c in (X, Y, Z)):
        nan_rows = blocks.index[blocks[[X, Y, Z]].isna().any(axis=1)]
        for idx in nan_rows:
            issues.append(_issue("nan_centre", SEVERITY_ERROR, "Block has a NaN centre coordinate", row_index=int(idx)))

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        if definition is not None:
            for raw in validate_alignment(blocks, definition):
                issues.append(_issue(
                    "alignment", SEVERITY_ERROR,
                    f"Block {raw['row_index']} is not on the base grid along {raw['axis']} ({raw['type']})",
                    **raw,
                ))
            for raw in validate_index_consistency(blocks, definition):
                issues.append(_issue(
                    "index_consistency", SEVERITY_ERROR,
                    f"Block {raw['row_index']}: {raw['column']}={raw['supplied']} but its geometry gives {raw['derived']}",
                    **raw,
                ))
            for raw in validate_within_grid(blocks, definition):
                issues.append(_issue(
                    "within_grid", SEVERITY_ERROR,
                    f"Block {raw['row_index']} lies outside the grid extent"
                    + (f" along {raw['axis']}" if "axis" in raw else ""),
                    **raw,
                ))
            for raw in validate_parent_containment(blocks, definition):
                issues.append(_issue(
                    "parent_containment", SEVERITY_WARNING,
                    f"Block {raw['row_index']} straddles a parent block boundary along {raw['axis']}",
                    **raw,
                ))
            if all(c in blocks.columns for c in BLOCK_INDEX_COLS) and not blocks.empty:
                dup = blocks.duplicated(subset=BLOCK_INDEX_COLS, keep="first")
                for idx in blocks.index[dup]:
                    issues.append(_issue("duplicate_index", SEVERITY_ERROR, f"Block {idx} duplicates another block's cells", row_index=int(idx)))
        for raw in validate_no_overlap(blocks, definition):
            issues.append(_issue(
                "overlap", SEVERITY_ERROR,
                f"Blocks {raw['block_i']} and {raw['block_j']} overlap",
                row_index=raw["block_j"], **raw,
            ))

    summary = {
        SEVERITY_ERROR: sum(1 for issue in issues if issue["severity"] == SEVERITY_ERROR),
        SEVERITY_WARNING: sum(1 for issue in issues if issue["severity"] == SEVERITY_WARNING),
        SEVERITY_INFO: sum(1 for issue in issues if issue["severity"] == SEVERITY_INFO),
    }
    return {"summary": summary, "issues": issues}
