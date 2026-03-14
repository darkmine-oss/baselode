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

"""Significant intercept calculation from drillhole assay intervals."""

import numpy as np
import pandas as pd


def significant_intercepts(
    df,
    assay_field,
    min_grade,
    min_length,
    from_col="from",
    to_col="to",
    hole_col="hole_id",
):
    """Calculate significant intercepts from assay interval data.

    A significant intercept is a contiguous downhole run of assay intervals
    where every interval meets or exceeds *min_grade*, and the total run length
    is at least *min_length*.

    Parameters
    ----------
    df : pd.DataFrame
        Assay intervals containing at minimum the *hole_col*, *from_col*,
        *to_col*, and *assay_field* columns.
    assay_field : str
        Name of the assay value column (e.g. ``"CU_PCT"`` or ``"AU_PPM"``).
    min_grade : float
        Minimum grade threshold.  Intervals below this value are excluded.
    min_length : float
        Minimum contiguous downhole length required to report an intercept.
    from_col : str
        Name of the from-depth column (default ``"from"``).
    to_col : str
        Name of the to-depth column (default ``"to"``).
    hole_col : str
        Name of the hole identifier column (default ``"hole_id"``).

    Returns
    -------
    pd.DataFrame
        One row per significant intercept with columns:
        ``hole_id``, ``assay_field``, ``from``, ``to``, ``length``,
        ``avg_grade``, ``n_samples``, ``label``.
    """
    empty_cols = [hole_col, "assay_field", from_col, to_col, "length", "avg_grade", "n_samples", "label"]

    if df.empty:
        return pd.DataFrame(columns=empty_cols)

    if assay_field not in df.columns:
        raise ValueError(f"Assay field '{assay_field}' not found in DataFrame columns.")

    results = []

    for hole_id, group in df.groupby(hole_col):
        group_sorted = group.sort_values(from_col).copy()
        group_sorted[assay_field] = pd.to_numeric(group_sorted[assay_field], errors="coerce")

        qualifying = group_sorted[group_sorted[assay_field] >= min_grade]

        if qualifying.empty:
            continue

        runs = []
        current_run = []
        prev_to = None

        for _, row in qualifying.iterrows():
            f = float(row[from_col])
            t = float(row[to_col])
            if prev_to is None or abs(f - prev_to) > 1e-6:
                if current_run:
                    runs.append(current_run)
                current_run = [row]
            else:
                current_run.append(row)
            prev_to = t

        if current_run:
            runs.append(current_run)

        for run in runs:
            total_from = float(run[0][from_col])
            total_to = float(run[-1][to_col])
            total_length = total_to - total_from

            if total_length < min_length:
                continue

            grades = np.array([float(r[assay_field]) for r in run])
            lengths = np.array([float(r[to_col]) - float(r[from_col]) for r in run])
            avg_grade = float(np.dot(grades, lengths) / lengths.sum())
            n_samples = len(run)
            label = f"{total_length:.1f} m @ {avg_grade:.2f} {assay_field}"

            results.append(
                {
                    hole_col: hole_id,
                    "assay_field": assay_field,
                    from_col: total_from,
                    to_col: total_to,
                    "length": total_length,
                    "avg_grade": avg_grade,
                    "n_samples": n_samples,
                    "label": label,
                }
            )

    if not results:
        return pd.DataFrame(columns=empty_cols)

    return pd.DataFrame(results)
