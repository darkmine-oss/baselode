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

"""Desurveying utilities.

Supports multiple methods that trade simplicity for accuracy:
- minimum_curvature (default): standard industry approach.
- tangential: keeps the initial station orientation through the segment.
- balanced_tangential: averages start/end orientations per segment.

All methods output a trace table with x, y, z coordinates at chosen step size,
plus measured depth and azimuth/dip per vertex. Dependencies are limited to
pandas and numpy for portability.
"""

import math
import pandas as pd

from baselode.datamodel import HOLE_ID, AZIMUTH, DIP, FROM, TO, EASTING, NORTHING, ELEVATION


def _direction_cosines(azimuth, dip):
    az_rad = math.radians(azimuth)
    dip_rad = math.radians(dip)
    ca = math.cos(dip_rad) * math.sin(az_rad)
    cb = math.cos(dip_rad) * math.cos(az_rad)
    cc = math.sin(dip_rad) * -1
    return ca, cb, cc


def _segment_displacement(delta_md, az0, dip0, az1, dip1, method="minimum_curvature"):
    ca0, cb0, cc0 = _direction_cosines(az0, dip0)
    ca1, cb1, cc1 = _direction_cosines(az1, dip1)
    if method == "tangential":
        return delta_md * ca0, delta_md * cb0, delta_md * cc0, az0, dip0
    if method == "balanced_tangential":
        az_avg = 0.5 * (az0 + az1)
        dip_avg = 0.5 * (dip0 + dip1)
        ca_avg, cb_avg, cc_avg = _direction_cosines(az_avg, dip_avg)
        return delta_md * ca_avg, delta_md * cb_avg, delta_md * cc_avg, az_avg, dip_avg

    # Minimum curvature (default)
    dogleg = math.acos(max(-1.0, min(1.0, ca0 * ca1 + cb0 * cb1 + cc0 * cc1)))
    rf = 1.0
    if dogleg > 1e-6:
        rf = 2 * math.tan(dogleg / 2) / dogleg
    dx = 0.5 * delta_md * (ca0 + ca1) * rf
    dy = 0.5 * delta_md * (cb0 + cb1) * rf
    dz = 0.5 * delta_md * (cc0 + cc1) * rf
    return dx, dy, dz, az1, dip1


def _desurvey(collars, surveys, step=1.0, method="minimum_curvature"):
    if collars.empty or surveys.empty:
        return pd.DataFrame(columns=[HOLE_ID, "md", EASTING, NORTHING, ELEVATION, AZIMUTH, DIP])

    traces = []
    for hole_id, collar in collars.groupby(HOLE_ID):
        collar_row = collar.iloc[0]
        hole_surveys = surveys[surveys[HOLE_ID] == hole_id].sort_values(FROM)
        if hole_surveys.empty:
            continue
        x, y, z = float(collar_row.get(EASTING, 0)), float(collar_row.get(NORTHING, 0)), float(collar_row.get(ELEVATION, 0))
        md_cursor = float(hole_surveys.iloc[0][FROM])
        az_prev = float(hole_surveys.iloc[0][AZIMUTH])
        dip_prev = float(hole_surveys.iloc[0][DIP])
        first_record = {HOLE_ID: hole_id, "md": md_cursor, EASTING: x, NORTHING: y, ELEVATION: z, AZIMUTH: az_prev, DIP: dip_prev}
        traces.append(first_record)

        for idx in range(len(hole_surveys) - 1):
            s0 = hole_surveys.iloc[idx]
            s1 = hole_surveys.iloc[idx + 1]
            md0 = float(s0[FROM])
            md1 = float(s1[FROM])
            delta_md = md1 - md0
            if delta_md <= 0:
                continue
            az0, dip0 = float(s0[AZIMUTH]), float(s0[DIP])
            az1, dip1 = float(s1[AZIMUTH]), float(s1[DIP])

            segment_steps = max(1, int(math.ceil(delta_md / step)))
            md_increment = delta_md / segment_steps
            for step_idx in range(segment_steps):
                md_cursor += md_increment
                weight = (md_cursor - md0) / delta_md
                az_interp = az0 + weight * (az1 - az0)
                dip_interp = dip0 + weight * (dip1 - dip0)
                dx, dy, dz, az_for_record, dip_for_record = _segment_displacement(
                    md_increment,
                    az0=az0,
                    dip0=dip0,
                    az1=az1,
                    dip1=dip1,
                    method=method,
                )
                x += dx
                y += dy
                z += dz
                record = {
                    HOLE_ID: hole_id,
                    "md": md_cursor,
                    EASTING: x,
                    NORTHING: y,
                    ELEVATION: z,
                    AZIMUTH: az_interp if method == "minimum_curvature" else az_for_record,
                    DIP: dip_interp if method == "minimum_curvature" else dip_for_record,
                }
                traces.append(record)
    out = pd.DataFrame(traces)
    return out


def minimum_curvature_desurvey(collars, surveys, step=1.0):
    return _desurvey(collars=collars, surveys=surveys, step=step, method="minimum_curvature")


def tangential_desurvey(collars, surveys, step=1.0,):
    """Simpler desurvey: uses the starting station orientation for each segment."""
    return _desurvey(collars=collars, surveys=surveys, step=step, method="tangential")


def balanced_tangential_desurvey(collars, surveys, step=1.0):
    """Balanced tangential desurvey using the average of start/end orientations per segment."""
    return _desurvey(collars=collars, surveys=surveys, step=step, method="balanced_tangential")


def attach_assay_positions(assays, traces):

    if assays.empty or traces.empty:
        return assays.copy()

    traces_sorted = traces.copy()
    traces_sorted["md"] = pd.to_numeric(traces_sorted["md"], errors="coerce")
    traces_sorted = traces_sorted[traces_sorted[HOLE_ID].notna() & traces_sorted["md"].notna()]
    traces_sorted = traces_sorted.sort_values([HOLE_ID, "md"], kind="mergesort").reset_index(drop=True)

    assays_sorted = assays.copy()
    assays_sorted["from"] = pd.to_numeric(assays_sorted[FROM], errors="coerce")
    assays_sorted["to"] = pd.to_numeric(assays_sorted[TO], errors="coerce")
    assays_sorted = assays_sorted[assays_sorted[HOLE_ID].notna()]
    assays_sorted = assays_sorted.sort_values([HOLE_ID, FROM, TO], kind="mergesort")
    assays_sorted["mid_md"] = 0.5 * (assays_sorted[FROM] + assays_sorted[TO])
    assays_sorted = assays_sorted[assays_sorted["mid_md"].notna()]

    merged_groups = []
    for hid, group in assays_sorted.groupby(HOLE_ID, sort=False):
        tgroup = traces_sorted[traces_sorted[HOLE_ID] == hid]
        if tgroup.empty:
            merged_groups.append(group)
            continue
        pos_cols = [c for c in ["md", EASTING, NORTHING, ELEVATION, AZIMUTH, DIP] if c in tgroup.columns]
        tgroup_use = tgroup[[HOLE_ID] + pos_cols].sort_values("md", kind="mergesort")
        merged = pd.merge_asof(
            group.sort_values("mid_md", kind="mergesort"),
            tgroup_use,
            left_on="mid_md",
            right_on="md",
            by=HOLE_ID,
            direction="nearest",
            suffixes=("", "_trace"),
        )
        drop_cols = [col for col in [f"{HOLE_ID}_trace", "hole_id_trace"] if col in merged.columns]
        if drop_cols:
            merged = merged.drop(columns=drop_cols)
        merged_groups.append(merged)

    if not merged_groups:
        return assays_sorted
    return pd.concat(merged_groups, ignore_index=True)


def build_traces(collars, surveys, step=1.0):
    return minimum_curvature_desurvey(collars=collars, surveys=surveys, step=step)