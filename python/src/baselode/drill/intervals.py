# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

"""From-to interval algebra primitives.

Pure, dependency-light operations on drillhole interval tables.  All
functions accept a pandas ``DataFrame`` keyed by ``HOLE_ID`` with from-/to-
depth columns, and return either a derived ``Series`` (lengths, midpoints)
or a new ``DataFrame``.  Functions never mutate inputs.

The module sits underneath :mod:`baselode.drill.composite` and
:mod:`baselode.drill.validate`, providing the boundary-arithmetic
primitives those higher-level operations consume.
"""

import numpy as np
import pandas as pd

from baselode.datamodel import FROM, HOLE_ID, TO


def interval_length(df, from_col=FROM, to_col=TO):
    """Length of each interval row.

    Parameters
    ----------
    df : pd.DataFrame
        Interval table with from-/to-depth columns.
    from_col, to_col : str
        Column names for the from- and to-depths.

    Returns
    -------
    pd.Series
        Length per row (``to - from``), indexed like *df*.
    """
    return df[to_col] - df[from_col]


def from_to_midpoints(df, from_col=FROM, to_col=TO):
    """Midpoint depth of each interval row.

    Parameters
    ----------
    df : pd.DataFrame
        Interval table with from-/to-depth columns.
    from_col, to_col : str
        Column names for the from- and to-depths.

    Returns
    -------
    pd.Series
        ``(from + to) / 2`` per row, indexed like *df*.
    """
    return (df[from_col] + df[to_col]) / 2.0


def detect_gaps(df, from_col=FROM, to_col=TO, hole_col=HOLE_ID, min_gap=0.0):
    """Uncovered downhole ranges between consecutive intervals, per hole.

    Sorts intervals by from-depth within each hole.  A gap is reported
    whenever the next from-depth exceeds the running maximum to-depth by
    more than *min_gap*.  Surface-to-first-interval and last-interval-to-EOH
    gaps are not reported (no anchor to compare against).

    Parameters
    ----------
    df : pd.DataFrame
        Interval table.
    from_col, to_col : str
        From-/to-depth columns.
    hole_col : str
        Hole identifier column.
    min_gap : float
        Minimum gap length to report.  Defaults to ``0.0`` (any positive
        gap reported).

    Returns
    -------
    pd.DataFrame
        One row per gap with columns ``hole_id``, ``from``, ``to``,
        ``length``.  Empty (with the same columns) when no gaps exist.
    """
    out_cols = [hole_col, from_col, to_col, "length"]
    if df.empty:
        return pd.DataFrame(columns=out_cols)

    gaps = []
    for hole_id, group in df.groupby(hole_col):
        group_sorted = group.sort_values(from_col)
        prev_to = None
        for _, row in group_sorted.iterrows():
            from_depth = float(row[from_col])
            to_depth = float(row[to_col])
            if prev_to is not None and from_depth - prev_to > min_gap:
                gaps.append({
                    hole_col: hole_id,
                    from_col: prev_to,
                    to_col: from_depth,
                    "length": from_depth - prev_to,
                })
            if prev_to is None or to_depth > prev_to:
                prev_to = to_depth

    if not gaps:
        return pd.DataFrame(columns=out_cols)
    return pd.DataFrame(gaps, columns=out_cols)


def detect_overlaps(df, from_col=FROM, to_col=TO, hole_col=HOLE_ID):
    """Pairwise overlapping intervals, per hole.

    All ordered pairs of intervals within a hole whose downhole ranges
    intersect are reported.  The reported ``from``/``to`` columns give the
    intersection range; ``length`` is its width.

    Parameters
    ----------
    df : pd.DataFrame
        Interval table.
    from_col, to_col : str
        From-/to-depth columns.
    hole_col : str
        Hole identifier column.

    Returns
    -------
    pd.DataFrame
        One row per overlapping pair with columns ``hole_id``, ``from``,
        ``to``, ``length``, ``first_index``, ``second_index`` (positional
        indices into *df*).
    """
    out_cols = [hole_col, from_col, to_col, "length", "first_index", "second_index"]
    if df.empty:
        return pd.DataFrame(columns=out_cols)

    overlaps = []
    df_with_pos = df.reset_index(drop=True).copy()
    df_with_pos["_pos"] = np.arange(len(df_with_pos))
    for hole_id, group in df_with_pos.groupby(hole_col):
        group_sorted = group.sort_values(from_col).reset_index(drop=True)
        rows = group_sorted.to_dict("records")
        row_count = len(rows)
        for first_idx in range(row_count):
            first_from = float(rows[first_idx][from_col])
            first_to = float(rows[first_idx][to_col])
            for second_idx in range(first_idx + 1, row_count):
                second_from = float(rows[second_idx][from_col])
                if second_from >= first_to:
                    break
                second_to = float(rows[second_idx][to_col])
                overlap_from = max(first_from, second_from)
                overlap_to = min(first_to, second_to)
                if overlap_to > overlap_from:
                    overlaps.append({
                        hole_col: hole_id,
                        from_col: overlap_from,
                        to_col: overlap_to,
                        "length": overlap_to - overlap_from,
                        "first_index": int(rows[first_idx]["_pos"]),
                        "second_index": int(rows[second_idx]["_pos"]),
                    })

    if not overlaps:
        return pd.DataFrame(columns=out_cols)
    return pd.DataFrame(overlaps, columns=out_cols)


def split_at(df, depths, from_col=FROM, to_col=TO, hole_col=HOLE_ID):
    """Split intervals at boundary depths.

    For each row, any *depth* falling strictly inside ``(from, to)`` is
    introduced as a new boundary; the row is replaced by the resulting
    sub-intervals, inheriting all other columns from the parent row.

    Parameters
    ----------
    df : pd.DataFrame
        Interval table.
    depths : dict, pd.DataFrame, list, or float
        Boundaries to split at, one of:

        - dict ``{hole_id: [d1, d2, ...]}`` — per-hole depths
        - DataFrame with ``hole_id`` and ``depth`` columns
        - list/array of depths — applied to every hole
        - single float — applied to every hole
    from_col, to_col : str
        From-/to-depth columns.
    hole_col : str
        Hole identifier column.

    Returns
    -------
    pd.DataFrame
        New table with the same columns as *df*; sub-intervals replace any
        row that contained a boundary.  Row order follows the input.
    """
    if df.empty:
        return df.copy()

    depths_by_hole = _normalize_depths_arg(depths, hole_col)

    out_rows = []
    for _, row in df.iterrows():
        hole_id = row[hole_col]
        from_depth = float(row[from_col])
        to_depth = float(row[to_col])

        if hole_id in depths_by_hole:
            candidate = depths_by_hole[hole_id]
        else:
            candidate = depths_by_hole.get("__ALL__", [])

        inner = sorted({float(depth) for depth in candidate if from_depth < float(depth) < to_depth})
        if not inner:
            out_rows.append(row.to_dict())
            continue

        boundaries = [from_depth, *inner, to_depth]
        for seg_from, seg_to in zip(boundaries[:-1], boundaries[1:]):
            new_row = row.to_dict()
            new_row[from_col] = seg_from
            new_row[to_col] = seg_to
            out_rows.append(new_row)

    return pd.DataFrame(out_rows, columns=df.columns)


def clip(df, from_depth=None, to_depth=None, from_col=FROM, to_col=TO):
    """Clip intervals to a downhole depth window.

    Intervals entirely outside ``[from_depth, to_depth]`` are dropped.
    Intervals straddling a boundary have their ``from`` and/or ``to`` value
    pulled to the window edge; all other columns are preserved.

    Parameters
    ----------
    df : pd.DataFrame
        Interval table.
    from_depth : float, optional
        Lower depth bound.  ``None`` means no lower bound.
    to_depth : float, optional
        Upper depth bound.  ``None`` means no upper bound.
    from_col, to_col : str
        From-/to-depth columns.

    Returns
    -------
    pd.DataFrame
        Clipped table; index is reset.
    """
    if df.empty:
        return df.copy()

    out = df.copy()
    if from_depth is not None:
        out = out.loc[out[to_col] > from_depth].copy()
        out.loc[:, from_col] = np.maximum(out[from_col], from_depth)
    if to_depth is not None:
        out = out.loc[out[from_col] < to_depth].copy()
        out.loc[:, to_col] = np.minimum(out[to_col], to_depth)
    return out.reset_index(drop=True)


def merge_tables(tables, from_col=FROM, to_col=TO, hole_col=HOLE_ID):
    """Left-join interval tables onto a common from-to support.

    Per hole, builds a fine-grained support by collecting all unique
    boundary depths across every input table, then emits one row per
    sub-interval with the non-key columns from each input table.  Within a
    sub-interval the lookup uses the midpoint, so each output row carries
    at most one source value per table.

    The first table in *tables* anchors the support: only depth ranges
    covered by it appear in the output ("left" semantics).  Columns from
    later tables are prefixed by their table name to avoid collisions.

    Parameters
    ----------
    tables : dict[str, pd.DataFrame]
        Ordered mapping ``{name: interval_table}``; the first entry is the
        left table.  Interval tables share *hole_col*, *from_col*, *to_col*
        but may carry any additional columns.
    from_col, to_col : str
        From-/to-depth columns shared across tables.
    hole_col : str
        Hole identifier column shared across tables.

    Returns
    -------
    pd.DataFrame
        Merged table with columns ``hole_id``, ``from``, ``to`` followed by
        ``<table>_<col>`` for each non-key column in each input.
    """
    if not tables:
        return pd.DataFrame(columns=[hole_col, from_col, to_col])

    table_names = list(tables.keys())
    left_name = table_names[0]
    left = tables[left_name]
    if left.empty:
        return pd.DataFrame(columns=[hole_col, from_col, to_col])

    holes = left[hole_col].unique()

    out_rows = []
    for hole_id in holes:
        left_for_hole = left[left[hole_col] == hole_id]
        boundaries = set()
        for _, row in left_for_hole.iterrows():
            boundaries.add(float(row[from_col]))
            boundaries.add(float(row[to_col]))

        left_min = float(left_for_hole[from_col].min())
        left_max = float(left_for_hole[to_col].max())

        for other_name in table_names[1:]:
            other = tables[other_name]
            other_for_hole = other[other[hole_col] == hole_id]
            for _, row in other_for_hole.iterrows():
                other_from = float(row[from_col])
                other_to = float(row[to_col])
                if other_to < left_min or other_from > left_max:
                    continue
                if other_from > left_min:
                    boundaries.add(other_from)
                if other_to < left_max:
                    boundaries.add(other_to)

        ordered = sorted(boundaries)

        for seg_from, seg_to in zip(ordered[:-1], ordered[1:]):
            midpoint = (seg_from + seg_to) / 2.0
            left_row = _row_containing(left_for_hole, midpoint, from_col, to_col)
            if left_row is None:
                continue
            out_row = {hole_col: hole_id, from_col: seg_from, to_col: seg_to}
            for col in left.columns:
                if col in (hole_col, from_col, to_col):
                    continue
                out_row[f"{left_name}_{col}"] = left_row[col]
            for other_name in table_names[1:]:
                other = tables[other_name]
                other_for_hole = other[other[hole_col] == hole_id]
                other_row = _row_containing(other_for_hole, midpoint, from_col, to_col)
                for col in other.columns:
                    if col in (hole_col, from_col, to_col):
                        continue
                    out_row[f"{other_name}_{col}"] = other_row[col] if other_row is not None else np.nan
            out_rows.append(out_row)

    if not out_rows:
        return pd.DataFrame(columns=[hole_col, from_col, to_col])
    return pd.DataFrame(out_rows)


def _row_containing(df, depth, from_col, to_col):
    """Return the row in *df* whose interval contains *depth*, or ``None``."""
    if df.empty:
        return None
    matches = df[(df[from_col] <= depth) & (df[to_col] > depth)]
    if matches.empty:
        return None
    return matches.iloc[0]


def _normalize_depths_arg(depths, hole_col):
    """Coerce ``split_at`` *depths* arg into ``{hole_id: [...]}`` form.

    A list/array/scalar is broadcast to every hole via the special
    ``"__ALL__"`` key, which :func:`split_at` interprets as "apply to any
    hole id".
    """
    if isinstance(depths, dict):
        return {hole_id: list(values) for hole_id, values in depths.items()}
    if isinstance(depths, pd.DataFrame):
        out = {}
        for hole_id, group in depths.groupby(hole_col):
            out[hole_id] = list(group["depth"])
        return out
    if np.isscalar(depths):
        return {"__ALL__": [float(depths)]}
    return {"__ALL__": [float(depth) for depth in depths]}
