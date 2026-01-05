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

"""Compositing and resampling helpers."""

import numpy as np
import pandas as pd

from baselode.datamodel import EASTING, NORTHING, ELEVATION


def composite_intervals(df, value_col, from_col="from", to_col="to", length=1.0, method="average"):
    if df.empty:
        return df.copy()
    df_sorted = df.sort_values(["hole_id", from_col])
    composites = []
    for hole_id, group in df_sorted.groupby("hole_id"):
        start = group[from_col].min()
        end = group[to_col].max()
        bins = np.arange(start, end + length, length)
        for i in range(len(bins) - 1):
            c_from = bins[i]
            c_to = bins[i + 1]
            window = group[(group[from_col] < c_to) & (group[to_col] > c_from)]
            if window.empty:
                continue
            overlap_len = (np.minimum(window[to_col], c_to) - np.maximum(window[from_col], c_from)).clip(lower=0)
            weights = overlap_len / overlap_len.sum()
            if method == "sum":
                val = (window[value_col] * overlap_len).sum()
            else:
                val = (window[value_col] * weights).sum()
            composites.append({"hole_id": hole_id, from_col: c_from, to_col: c_to, value_col: val})
    return pd.DataFrame(composites)


def resample_trace(trace_df, step=1.0):
    if trace_df.empty:
        return trace_df.copy()
    resampled = []
    for hole_id, group in trace_df.groupby("hole_id"):
        group_sorted = group.sort_values("md")
        mds = group_sorted["md"].values
        start = mds.min()
        end = mds.max()
        sample_mds = np.arange(start, end + step, step)
        res_e = np.interp(sample_mds, mds, group_sorted[EASTING].values)
        res_n = np.interp(sample_mds, mds, group_sorted[NORTHING].values)
        res_z = np.interp(sample_mds, mds, group_sorted[ELEVATION].values)
        for md_val, easting, northing, elevation in zip(sample_mds, res_e, res_n, res_z):
            resampled.append({"hole_id": hole_id, "md": md_val, EASTING: easting, NORTHING: northing, ELEVATION: elevation})
    return pd.DataFrame(resampled)


def merge_numeric_categorical(numeric_df, categorical_df, on_cols=("hole_id", "from", "to")):
    if numeric_df.empty and categorical_df.empty:
        return pd.DataFrame()
    if numeric_df.empty:
        return categorical_df.copy()
    if categorical_df.empty:
        return numeric_df.copy()
    return numeric_df.merge(categorical_df, on=list(on_cols), how="outer")
