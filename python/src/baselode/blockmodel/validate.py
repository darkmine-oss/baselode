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

Functions return lists of issue dicts so callers can decide whether to
raise, warn, or ignore.  Warnings are also emitted via :mod:`warnings`
when issues are found.
"""

import warnings

import numpy as np
import pandas as pd

from baselode.blockmodel.data import X, Y, Z, DX, DY, DZ


def validate_block_sizes(blocks: pd.DataFrame, max_block_size: dict) -> list[dict]:
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
    issues: list[dict] = []
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

    if issues:
        warnings.warn(
            f"validate_block_sizes: {len(issues)} block size issue(s) found.",
            UserWarning,
            stacklevel=2,
        )
    return issues


def validate_blocks_in_bbox(blocks: pd.DataFrame, bbox_3d: dict) -> list[dict]:
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
    issues: list[dict] = []

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

    if issues:
        warnings.warn(
            f"validate_blocks_in_bbox: {len(issues)} block(s) outside bbox.",
            UserWarning,
            stacklevel=2,
        )
    return issues


def validate_no_overlap(blocks: pd.DataFrame) -> list[dict]:
    """Check that no two blocks intersect / overlap each other.

    Uses pairwise axis-aligned bounding-box tests.  This is O(n²) and
    intended for moderately-sized block models (thousands of blocks).

    Parameters
    ----------
    blocks : pd.DataFrame
        Block table with x/y/z/dx/dy/dz columns.

    Returns
    -------
    list[dict]
        Each issue identifies the two overlapping block row indices.
    """
    issues: list[dict] = []

    if blocks.empty or len(blocks) < 2:
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

    for i in range(n):
        for j in range(i + 1, n):
            # AABB overlap test: two boxes overlap iff they overlap on all three axes
            if (
                abs(cx[i] - cx[j]) < hdx[i] + hdx[j] - tol
                and abs(cy[i] - cy[j]) < hdy[i] + hdy[j] - tol
                and abs(cz[i] - cz[j]) < hdz[i] + hdz[j] - tol
            ):
                issues.append({
                    "type": "overlap",
                    "block_i": int(indices[i]),
                    "block_j": int(indices[j]),
                })

    if issues:
        warnings.warn(
            f"validate_no_overlap: {len(issues)} overlapping block pair(s) found.",
            UserWarning,
            stacklevel=2,
        )
    return issues
