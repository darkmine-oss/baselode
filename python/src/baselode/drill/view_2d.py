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

"""2D plan and section projection helpers.

These functions prepare data frames suitable for plotting in matplotlib or
plotly without binding to any viewer.
"""

import math

import pandas as pd


def project_trace_to_section(traces, origin, azimuth):
    if traces.empty:
        return traces.copy()
    ox, oy = origin
    az_rad = math.radians(azimuth)
    cos_a = math.cos(az_rad)
    sin_a = math.sin(az_rad)
    projected = traces.copy()
    dx = projected["x"] - ox
    dy = projected["y"] - oy
    projected["along"] = dx * sin_a + dy * cos_a
    projected["across"] = dx * cos_a - dy * sin_a
    return projected


def section_window(traces, origin, azimuth, width):
    projected = project_trace_to_section(traces, origin=origin, azimuth=azimuth)
    window = projected[projected["across"].abs() <= 0.5 * width]
    return window


def plan_view(traces, depth_slice=None, color_by=None):
    if traces.empty:
        return traces.copy()
    df = traces.copy()
    if depth_slice is not None:
        top, bottom = depth_slice
        df = df[(df["z"] <= top) & (df["z"] >= bottom)]
    if color_by is not None and color_by in df.columns:
        df["color_value"] = df[color_by]
    return df


def section_view(traces, origin, azimuth, width=50, color_by=None):
    section = section_window(traces, origin=origin, azimuth=azimuth, width=width)
    if color_by is not None and color_by in section.columns:
        section["color_value"] = section[color_by]
    return section
