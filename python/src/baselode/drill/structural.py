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

"""Structural measurement helpers and tadpole prep."""

import math

import pandas as pd


def poles_from_dip_dipdir(dip, dipdir):
    strike = (dipdir - 90) % 360
    pole_trend = strike
    pole_plunge = 90 - dip
    return pole_trend, pole_plunge


def structural_to_tadpole(structures, depth_col="from", dip_col="dip", dipdir_col="dipdir", scale=1.0):
    if structures.empty:
        return structures.copy()
    out = structures.copy()
    tail_dx = scale * out[dip_col].apply(lambda d: math.sin(math.radians(d)))
    tail_dy = scale * out[dip_col].apply(lambda d: math.cos(math.radians(d)))
    out["tadpole_tail_x"] = tail_dx
    out["tadpole_tail_y"] = tail_dy
    out["tadpole_depth"] = out[depth_col]
    return out


def project_structures_to_section(structures, origin, azimuth):
    if structures.empty:
        return structures.copy()
    ox, oy = origin
    az_rad = math.radians(azimuth)
    cos_a = math.cos(az_rad)
    sin_a = math.sin(az_rad)
    projected = []
    for _, row in structures.iterrows():
        dx = row["x"] - ox
        dy = row["y"] - oy
        along = dx * sin_a + dy * cos_a
        projected.append({
            **row.to_dict(),
            "section_along": along,
            "section_depth": row.get("from", row.get("depth", 0)),
        })
    return pd.DataFrame(projected)
