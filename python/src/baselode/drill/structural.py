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

"""Structural measurement processing and geometry helpers."""

import math

import numpy as np
import pandas as pd

from baselode.datamodel import (
    AZIMUTH, DEPTH, DIP, EASTING, HOLE_ID, MID, NORTHING, ELEVATION, STRIKE,
)


def normalize_dip_azimuth(df, dip_col=DIP, az_col=AZIMUTH):
    """Clamp dip to [0, 90] and azimuth to [0, 360)."""
    out = df.copy()
    if dip_col in out.columns:
        out[dip_col] = out[dip_col].clip(lower=0, upper=90)
    if az_col in out.columns:
        out[az_col] = out[az_col] % 360
    return out


def compute_strike(az_series):
    """Compute strike from dip-direction azimuth. Strike = (azimuth - 90) % 360."""
    return (az_series - 90) % 360


def compute_plane_normal(dip, azimuth):
    """Unit normal vector (nx, ny, nz) for a plane with given dip and azimuth.

    Convention: azimuth clockwise from North, dip from horizontal.
    Normal points upward (positive z in elevation-positive convention).

    Returns (nx, ny, nz) in ENU (East-North-Up) coordinates.

    Examples
    --------
    Horizontal plane (dip=0) → normal points straight up: (0, 0, 1)
    Vertical plane (dip=90, az=270) → normal points West: (-1, 0, 0)
    """
    az_rad = math.radians(azimuth)
    dip_rad = math.radians(dip)
    nx = math.sin(az_rad) * math.sin(dip_rad)
    ny = math.cos(az_rad) * math.sin(dip_rad)
    nz = math.cos(dip_rad)
    return (nx, ny, nz)


def attach_structure_positions(structures, traces, depth_col=DEPTH):
    """Attach (easting, northing, elevation) at each structure depth.

    Linear interpolation against the desurveyed trace via
    :func:`baselode.drill.desurvey.interpolate_trajectory`.  More accurate
    than the previous nearest-sample lookup.

    Parameters
    ----------
    structures : pd.DataFrame
        Structural point or interval data (already standardized).
    traces : pd.DataFrame
        Desurveyed trace table with ``md``, ``easting``, ``northing``,
        ``elevation`` columns.
    depth_col : str
        Column in *structures* to use as the measured depth for lookup.
        Defaults to ``DEPTH`` for point data; use ``MID`` for interval data.
    """
    import baselode.drill.desurvey as desurvey_module

    if structures.empty or traces.empty:
        return structures.copy()

    out = structures.copy()
    out[depth_col] = pd.to_numeric(out[depth_col], errors="coerce")
    out = out[out[HOLE_ID].notna() & out[depth_col].notna()].reset_index(drop=True)
    if out.empty:
        return out

    depth_requests = out[[HOLE_ID, depth_col]].rename(columns={depth_col: "depth"})
    positions = desurvey_module.interpolate_trajectory(traces, depth_requests).rename(
        columns={"depth": depth_col},
    )
    # interpolate_trajectory returns azimuth/dip too; drop them — the
    # structure rows already carry their own azimuth/dip semantics.
    positions = positions[[HOLE_ID, depth_col, EASTING, NORTHING, ELEVATION]]
    return out.merge(positions, on=[HOLE_ID, depth_col], how="left")


def poles_from_dip_dipdir(dip, dipdir):
    """Convert dip/dip-direction to pole trend and plunge."""
    strike = (dipdir - 90) % 360
    pole_trend = strike
    pole_plunge = 90 - dip
    return pole_trend, pole_plunge


def structural_to_tadpole(structures, depth_col=DEPTH, dip_col=DIP, dipdir_col=AZIMUTH, scale=1.0):
    """Compute tadpole tail vectors for 2D log display.

    Adds 'tadpole_tail_x', 'tadpole_tail_y', 'tadpole_depth' columns.
    """
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
    """Project structure positions onto a vertical section plane.

    Parameters
    ----------
    structures : pd.DataFrame
        Must contain easting and northing columns.
    origin : tuple (x, y)
        Section origin in the same coordinate space.
    azimuth : float
        Section azimuth in degrees clockwise from North.

    Returns a DataFrame with 'section_along' and 'section_depth' columns added.
    """
    if structures.empty:
        return structures.copy()
    ox, oy = origin
    az_rad = math.radians(azimuth)
    cos_a = math.cos(az_rad)
    sin_a = math.sin(az_rad)
    projected = []
    for _, row in structures.iterrows():
        dx = row[EASTING] - ox
        dy = row[NORTHING] - oy
        along = dx * sin_a + dy * cos_a
        projected.append({
            **row.to_dict(),
            "section_along": along,
            "section_depth": row.get(DEPTH, row.get(MID, 0)),
        })
    return pd.DataFrame(projected)
