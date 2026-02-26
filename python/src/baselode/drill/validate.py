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

from baselode.datamodel import AZIMUTH, DIP, HOLE_ID, DEPTH, FROM, TO


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


def validate_structural_points(df, dip_col=DIP, az_col=AZIMUTH, hole_col=HOLE_ID, depth_col=DEPTH):
    """Validate structural point measurements.

    Returns a list of issue dicts: dip out of [0, 90], azimuth out of [0, 360), missing depth.
    """
    issues = []
    for idx, row in df.iterrows():
        hole_id = row.get(hole_col)
        depth = row.get(depth_col)
        dip = row.get(dip_col)
        az = row.get(az_col)

        if pd.isna(depth):
            issues.append({"hole_id": hole_id, "row_index": idx, "type": "missing_depth", "row": row.to_dict()})
            continue

        if dip is not None and not pd.isna(dip):
            if dip < 0 or dip > 90:
                issues.append({"hole_id": hole_id, "row_index": idx, "type": "dip_out_of_range",
                                "value": dip, "row": row.to_dict()})

        if az is not None and not pd.isna(az):
            if az < 0 or az >= 360:
                issues.append({"hole_id": hole_id, "row_index": idx, "type": "azimuth_out_of_range",
                                "value": az, "row": row.to_dict()})

    return issues


def validate_structural_intervals(df, from_col=FROM, to_col=TO, dip_col=DIP, az_col=AZIMUTH, hole_col=HOLE_ID):
    """Validate structural interval measurements.

    Reuses validate_intervals() for from/to consistency, then checks dip/azimuth ranges.
    """
    issues = list(validate_intervals(df, from_col=from_col, to_col=to_col, hole_col=hole_col))

    for idx, row in df.iterrows():
        hole_id = row.get(hole_col)
        dip = row.get(dip_col)
        az = row.get(az_col)

        if dip is not None and not pd.isna(dip):
            if dip < 0 or dip > 90:
                issues.append({"hole_id": hole_id, "row_index": idx, "type": "dip_out_of_range",
                                "value": dip, "row": row.to_dict()})

        if az is not None and not pd.isna(az):
            if az < 0 or az >= 360:
                issues.append({"hole_id": hole_id, "row_index": idx, "type": "azimuth_out_of_range",
                                "value": az, "row": row.to_dict()})

    return issues
