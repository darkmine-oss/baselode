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

import pandas as pd


def traces_as_segments(traces, color_by=None):
    if traces.empty:
        return []
    segments = []
    for hole_id, group in traces.sort_values(["hole_id", "md"]).groupby("hole_id"):
        xs = group["x"].tolist()
        ys = group["y"].tolist()
        zs = group["z"].tolist()
        colors = None
        if color_by is not None and color_by in group.columns:
            colors = group[color_by].tolist()
        segments.append({
            "hole_id": hole_id,
            "x": xs,
            "y": ys,
            "z": zs,
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
