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

import numpy as np
import pandas as pd

from . import data


def _deg_to_rad(angle):
    return math.radians(angle)


def _direction_cosines(azimuth, dip):
    az_rad = _deg_to_rad(azimuth)
    dip_rad = _deg_to_rad(dip)
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


def _desurvey(collars, surveys, step=1.0, hole_id_col=None, method="minimum_curvature"):
    collars = data._canonicalize_hole_id(data._frame(collars), hole_id_col=hole_id_col)
    surveys = data._canonicalize_hole_id(data._frame(surveys), hole_id_col=hole_id_col)
    alias_col = collars.attrs.get("hole_id_col", hole_id_col or "hole_id")
    if collars.empty or surveys.empty:
        return pd.DataFrame(columns=["hole_id", "md", "x", "y", "z", "azimuth", "dip"])

    traces = []
    for hole_id, collar in collars.groupby("hole_id"):
        collar_row = collar.iloc[0]
        hole_surveys = surveys[surveys["hole_id"] == hole_id].sort_values("from")
        if hole_surveys.empty:
            continue
        x, y, z = float(collar_row.get("x", 0)), float(collar_row.get("y", 0)), float(collar_row.get("z", 0))
        md_cursor = float(hole_surveys.iloc[0]["from"])
        az_prev = float(hole_surveys.iloc[0]["azimuth"])
        dip_prev = float(hole_surveys.iloc[0]["dip"])
        first_record = {"hole_id": hole_id, "md": md_cursor, "x": x, "y": y, "z": z, "azimuth": az_prev, "dip": dip_prev}
        if alias_col != "hole_id" and alias_col in collar_row:
            first_record[alias_col] = collar_row[alias_col]
        traces.append(first_record)

        for idx in range(len(hole_surveys) - 1):
            s0 = hole_surveys.iloc[idx]
            s1 = hole_surveys.iloc[idx + 1]
            md0 = float(s0["from"])
            md1 = float(s1["from"])
            delta_md = md1 - md0
            if delta_md <= 0:
                continue
            az0, dip0 = float(s0["azimuth"]), float(s0["dip"])
            az1, dip1 = float(s1["azimuth"]), float(s1["dip"])

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
                    "hole_id": hole_id,
                    "md": md_cursor,
                    "x": x,
                    "y": y,
                    "z": z,
                    "azimuth": az_interp if method == "minimum_curvature" else az_for_record,
                    "dip": dip_interp if method == "minimum_curvature" else dip_for_record,
                }
                if alias_col != "hole_id" and alias_col in collar_row:
                    record[alias_col] = collar_row[alias_col]
                traces.append(record)
    out = pd.DataFrame(traces)
    out.attrs["hole_id_col"] = alias_col
    return out


def minimum_curvature_desurvey(collars, surveys, step=1.0, hole_id_col=None):
    return _desurvey(collars=collars, surveys=surveys, step=step, hole_id_col=hole_id_col, method="minimum_curvature")


def tangential_desurvey(collars, surveys, step=1.0, hole_id_col=None):
    """Simpler desurvey: uses the starting station orientation for each segment."""
    return _desurvey(collars=collars, surveys=surveys, step=step, hole_id_col=hole_id_col, method="tangential")


def balanced_tangential_desurvey(collars, surveys, step=1.0, hole_id_col=None):
    """Balanced tangential desurvey using the average of start/end orientations per segment."""
    return _desurvey(collars=collars, surveys=surveys, step=step, hole_id_col=hole_id_col, method="balanced_tangential")


def attach_assay_positions(assays, traces, hole_id_col=None):
    assays = data._canonicalize_hole_id(data._frame(assays), hole_id_col=hole_id_col)
    traces = data._canonicalize_hole_id(data._frame(traces), hole_id_col=hole_id_col)
    alias_col_raw = traces.attrs.get("hole_id_col", hole_id_col or "hole_id")
    alias_col = data.DEFAULT_COLUMN_MAP.get(str(alias_col_raw).lower().strip(), alias_col_raw)
    if assays.empty or traces.empty:
        return assays.copy()
    if alias_col not in traces.columns and "hole_id" in traces.columns:
        traces = traces.copy()
        traces[alias_col] = traces["hole_id"]
    if alias_col not in assays.columns and "hole_id" in assays.columns:
        assays = assays.copy()
        assays[alias_col] = assays["hole_id"]

    traces_sorted = traces.copy()
    traces_sorted["md"] = pd.to_numeric(traces_sorted["md"], errors="coerce")
    traces_sorted = traces_sorted[traces_sorted[alias_col].notna() & traces_sorted["md"].notna()]
    traces_sorted = traces_sorted.sort_values([alias_col, "md"], kind="mergesort").reset_index(drop=True)

    assays_sorted = assays.copy()
    assays_sorted["from"] = pd.to_numeric(assays_sorted["from"], errors="coerce")
    assays_sorted["to"] = pd.to_numeric(assays_sorted["to"], errors="coerce")
    assays_sorted = assays_sorted[assays_sorted[alias_col].notna()]
    assays_sorted = assays_sorted.sort_values([alias_col, "from", "to"], kind="mergesort")
    assays_sorted["mid_md"] = 0.5 * (assays_sorted["from"] + assays_sorted["to"])
    assays_sorted = assays_sorted[assays_sorted["mid_md"].notna()]

    merged_groups = []
    for hid, group in assays_sorted.groupby(alias_col, sort=False):
        tgroup = traces_sorted[traces_sorted[alias_col] == hid]
        if tgroup.empty:
            merged_groups.append(group)
            continue
        pos_cols = [c for c in ["md", "x", "y", "z", "azimuth", "dip"] if c in tgroup.columns]
        tgroup_use = tgroup[[alias_col] + pos_cols].sort_values("md", kind="mergesort")
        merged = pd.merge_asof(
            group.sort_values("mid_md", kind="mergesort"),
            tgroup_use,
            left_on="mid_md",
            right_on="md",
            by=alias_col,
            direction="nearest",
            suffixes=("", "_trace"),
        )
        drop_cols = [col for col in [f"{alias_col}_trace", "hole_id_trace"] if col in merged.columns]
        if drop_cols:
            merged = merged.drop(columns=drop_cols)
        merged_groups.append(merged)

    if not merged_groups:
        return assays_sorted
    return pd.concat(merged_groups, ignore_index=True)


def build_traces(collars, surveys, step=1.0, hole_id_col=None):
    return minimum_curvature_desurvey(collars=collars, surveys=surveys, step=step, hole_id_col=hole_id_col)
