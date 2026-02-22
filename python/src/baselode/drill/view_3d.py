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

"""3D-ready payload generation for drill traces and intervals."""

import math

import pandas as pd

from baselode.datamodel import AZIMUTH, DIP, EASTING, HOLE_ID, NORTHING, ELEVATION, STRUCTURE_TYPE


def traces_as_segments(traces, color_by=None):
    if traces.empty:
        return []
    segments = []
    for hole_id, group in traces.sort_values(["hole_id", "md"]).groupby("hole_id"):
        xs = group[EASTING].tolist()
        ys = group[NORTHING].tolist()
        zs = group[ELEVATION].tolist()
        colors = None
        if color_by is not None and color_by in group.columns:
            colors = group[color_by].tolist()
        segments.append({
            "hole_id": hole_id,
            EASTING: xs,
            NORTHING: ys,
            ELEVATION: zs,
            "color": colors,
        })
    return segments


def intervals_as_tubes(intervals, radius=1.0, color_by=None):
    if intervals.empty:
        return []
    payloads = []
    for _, row in intervals.iterrows():
        payload = {
            "hole_id": row.get("hole_id"),
            "from": row.get("from"),
            "to": row.get("to"),
            "radius": radius,
            "color": row.get(color_by) if color_by else None,
            "value": row.get(color_by) if color_by else None,
        }
        payloads.append(payload)
    return payloads


def structures_as_discs(structures, radius=2.0, color_by=STRUCTURE_TYPE):
    """Generate 3D disc payload list for each structure measurement.

    Each disc has:
    - center: (easting, northing, elevation) — from attach_structure_positions()
    - normal: (nx, ny, nz) — from compute_plane_normal(dip, azimuth) in ENU coords
    - radius: configurable
    - color_value: from color_by column
    - metadata: hole_id, depth, structure_type, dip, azimuth, comments

    Returns a list of dicts ready for Three.js consumption.
    """
    if structures.empty:
        return []

    payloads = []
    for _, row in structures.iterrows():
        x = row.get(EASTING)
        y = row.get(NORTHING)
        z = row.get(ELEVATION)
        dip = row.get(DIP)
        az = row.get(AZIMUTH)

        if x is None or y is None or z is None or dip is None or az is None:
            continue
        try:
            dip_f = float(dip)
            az_f = float(az)
            x_f = float(x)
            y_f = float(y)
            z_f = float(z)
        except (TypeError, ValueError):
            continue

        az_rad = math.radians(az_f)
        dip_rad = math.radians(dip_f)
        nx = math.sin(az_rad) * math.sin(dip_rad)
        ny = math.cos(az_rad) * math.sin(dip_rad)
        nz = math.cos(dip_rad)

        color_value = row.get(color_by) if color_by and color_by in row.index else None

        payload = {
            "hole_id": row.get(HOLE_ID),
            "center": [x_f, y_f, z_f],
            "normal": [nx, ny, nz],
            "radius": radius,
            "color_value": color_value,
            "dip": dip_f,
            "azimuth": az_f,
            "structure_type": row.get(STRUCTURE_TYPE),
            "comments": row.get("comments"),
        }
        # Include optional depth fields
        for col in ["depth", "mid", "from", "to"]:
            if col in row.index:
                payload[col] = row.get(col)
        payloads.append(payload)
    return payloads


def annotations_from_intervals(intervals, label_col=None):
    if intervals.empty or label_col is None or label_col not in intervals.columns:
        return []
    annotations = []
    for _, row in intervals.iterrows():
        annotations.append({
            "hole_id": row.get("hole_id"),
            "label": row[label_col],
            "depth": 0.5 * (row.get("from", 0) + row.get("to", 0)),
        })
    return annotations
