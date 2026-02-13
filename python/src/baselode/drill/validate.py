# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

# This file is part of baselode.

# baselode is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the license, or
# (at your option) any later version.

# baselode is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.

# You should have received a copy of the GNU General Public License
# along with baselode.  If not, see <https://www.gnu.org/licenses/>.

"""QA/QC helpers for drillhole tables."""

import pandas as pd


def validate_intervals(df, from_col="from", to_col="to", hole_col="hole_id"):
    issues = []
    for hole_id, group in df.groupby(hole_col):
        prev_to = None
        for _, row in group.sort_values(from_col).iterrows():
            f = row[from_col]
            t = row[to_col]
            if pd.isna(f) or pd.isna(t):
                issues.append({"hole_id": hole_id, "type": "missing_depth", "row": row.to_dict()})
                continue
            if t <= f:
                issues.append({"hole_id": hole_id, "type": "non_positive_length", "row": row.to_dict()})
            if prev_to is not None and f < prev_to:
                issues.append({"hole_id": hole_id, "type": "overlap", "row": row.to_dict()})
            prev_to = t
    return issues


def validate_surveys(df, hole_col="hole_id", depth_col="from"):
    issues = []
    for hole_id, group in df.groupby(hole_col):
        depths = group[depth_col].values
        if not pd.Series(depths).is_monotonic_increasing:
            issues.append({"hole_id": hole_id, "type": "non_monotonic_survey"})
    return issues


def report_missing_columns(df, required):
    missing = [col for col in required if col not in df.columns]
    return missing
