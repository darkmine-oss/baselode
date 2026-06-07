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

from baselode.datamodel import HOLE_ID, AZIMUTH, DIP, FROM, TO, EASTING, NORTHING, ELEVATION, DEPTH, MID


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
        # Canonical Walstrom 1969 / Harvey & Eppink 1972 form: average
        # the direction cosines at the upper and lower stations, not
        # the cosines of the averaged angles.  The two coincide on
        # gentle doglegs but diverge meaningfully on strong direction
        # changes.  Matches the wellpathpy / PyGSLIB reference impls.
        ca_avg = 0.5 * (ca0 + ca1)
        cb_avg = 0.5 * (cb0 + cb1)
        cc_avg = 0.5 * (cc0 + cc1)
        az_avg = 0.5 * (az0 + az1)
        dip_avg = 0.5 * (dip0 + dip1)
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
        hole_surveys = surveys[surveys[HOLE_ID] == hole_id].sort_values(DEPTH)
        if hole_surveys.empty:
            continue
        x, y, z = float(collar_row.get(EASTING, 0)), float(collar_row.get(NORTHING, 0)), float(collar_row.get(ELEVATION, 0))
        md_cursor = float(hole_surveys.iloc[0][DEPTH])
        az_prev = float(hole_surveys.iloc[0][AZIMUTH])
        dip_prev = float(hole_surveys.iloc[0][DIP])
        first_record = {HOLE_ID: hole_id, "md": md_cursor, EASTING: x, NORTHING: y, ELEVATION: z, AZIMUTH: az_prev, DIP: dip_prev}
        traces.append(first_record)

        for idx in range(len(hole_surveys) - 1):
            s0 = hole_surveys.iloc[idx]
            s1 = hole_surveys.iloc[idx + 1]
            md0 = float(s0[DEPTH])
            md1 = float(s1[DEPTH])
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


def interpolate_trajectory(
    traces,
    depths,
    hole_col=HOLE_ID,
    md_col="md",
    easting_col=EASTING,
    northing_col=NORTHING,
    elevation_col=ELEVATION,
    azimuth_col=AZIMUTH,
    dip_col=DIP,
):
    """Look up trace position + orientation at arbitrary downhole depths.

    Given a desurveyed trace and a set of (hole, depth) requests, return
    the interpolated ``(easting, northing, elevation, azimuth, dip)`` at
    each request.  Linear interpolation per coordinate; this is accurate
    enough as long as the trace was sampled at a small step (default 1 m
    in :func:`build_traces` / friends) so adjacent samples bracket the
    requested depth tightly.

    Depths that fall outside the trace's ``md`` range for their hole, or
    whose hole isn't in ``traces`` at all, return ``NaN`` in every output
    column except ``hole_id`` and ``depth``.

    Parameters
    ----------
    traces : pd.DataFrame
        Desurveyed trace table (e.g. from
        :func:`minimum_curvature_desurvey`).  Must carry *hole_col*,
        *md_col*, *easting_col*, *northing_col*, *elevation_col*,
        *azimuth_col*, *dip_col*.
    depths : dict, pd.DataFrame, list, or float
        Per-hole depths to interpolate at.  One of:

        - dict ``{hole_id: [d1, d2, ...]}`` — per-hole list of depths
        - DataFrame with ``hole_id`` and ``depth`` columns
        - list/array of depths — applied to every hole in *traces*
        - single float — applied to every hole in *traces*
    hole_col, md_col, easting_col, northing_col, elevation_col, azimuth_col, dip_col : str
        Column-name overrides (defaults from :mod:`baselode.datamodel`).

    Returns
    -------
    pd.DataFrame
        One row per ``(hole_id, depth)`` request with columns ``hole_id``,
        ``depth``, ``easting``, ``northing``, ``elevation``, ``azimuth``,
        ``dip``.

    Notes
    -----
    Azimuth is interpolated as a plain scalar, which gives the wrong
    answer for trajectories that wrap across the 0°/360° boundary
    between adjacent samples.  Real-world drillholes don't do this
    because they always rotate via the short arc, but if you feed a
    contrived survey that goes 350° → 10° in one step, the
    interpolated azimuth will spuriously cross through 180°.
    """
    # azimuth / dip aren't always present on every trace (e.g. structural
    # workflows skip them).  Treat them as best-effort columns.
    all_coord_cols = [easting_col, northing_col, elevation_col, azimuth_col, dip_col]
    out_columns = [hole_col, "depth", *all_coord_cols]

    requests = _normalize_depth_requests(depths, traces, hole_col)
    if requests.empty:
        return pd.DataFrame(columns=out_columns)

    coord_cols_present = [col for col in all_coord_cols if col in traces.columns]

    traces_by_hole = {}
    for hole_id, group in traces.groupby(hole_col):
        ordered = group.sort_values(md_col).dropna(subset=[md_col, *coord_cols_present])
        if len(ordered) < 1:
            continue
        traces_by_hole[hole_id] = ordered

    def _missing_row(hole_id, depth_value):
        return {
            hole_col: hole_id,
            "depth": depth_value,
            **{col: float("nan") for col in all_coord_cols},
        }

    rows = []
    for hole_id, group in requests.groupby(hole_col):
        trace_for_hole = traces_by_hole.get(hole_id)
        depth_values = group["depth"].to_numpy(dtype=float)
        if trace_for_hole is None or len(trace_for_hole) == 0:
            rows.extend(_missing_row(hole_id, float(depth)) for depth in depth_values)
            continue
        mds = trace_for_hole[md_col].to_numpy(dtype=float)
        min_md, max_md = mds[0], mds[-1]
        for depth in depth_values:
            depth_value = float(depth)
            if depth_value < min_md or depth_value > max_md:
                rows.append(_missing_row(hole_id, depth_value))
                continue
            row = _missing_row(hole_id, depth_value)
            for col in coord_cols_present:
                row[col] = float(np.interp(
                    depth_value, mds, trace_for_hole[col].to_numpy(dtype=float),
                ))
            rows.append(row)

    return pd.DataFrame(rows, columns=out_columns)


def _normalize_depth_requests(depths, traces, hole_col):
    """Coerce the ``depths`` argument of :func:`interpolate_trajectory` to a
    DataFrame keyed by ``(hole_id, depth)``."""
    if isinstance(depths, pd.DataFrame):
        if hole_col not in depths.columns or "depth" not in depths.columns:
            raise ValueError(
                f"Depths DataFrame must carry '{hole_col}' and 'depth' columns"
            )
        return depths[[hole_col, "depth"]].dropna()
    if isinstance(depths, dict):
        rows = []
        for hole_id, values in depths.items():
            if values is None:
                continue
            if np.isscalar(values):
                rows.append({hole_col: hole_id, "depth": float(values)})
                continue
            for depth in values:
                rows.append({hole_col: hole_id, "depth": float(depth)})
        return pd.DataFrame(rows, columns=[hole_col, "depth"])
    # Broadcast: float or iterable of floats applied to every trace hole.
    if np.isscalar(depths):
        depth_list = [float(depths)]
    else:
        depth_list = [float(value) for value in depths]
    if traces.empty or hole_col not in traces.columns:
        return pd.DataFrame(columns=[hole_col, "depth"])
    rows = []
    for hole_id in traces[hole_col].dropna().unique():
        for depth in depth_list:
            rows.append({hole_col: hole_id, "depth": depth})
    return pd.DataFrame(rows, columns=[hole_col, "depth"])


def attach_assay_positions(assays, traces):
    """Attach (easting, northing, elevation, azimuth, dip) at each assay midpoint.

    Linear interpolation against the desurveyed trace (via
    :func:`interpolate_trajectory`).  This is more accurate than the
    earlier nearest-sample lookup; the change is sub-step (<1 m at the
    default 1 m trace step).
    """
    if assays.empty or traces.empty:
        return assays.copy()

    out = assays.copy()
    out[FROM] = pd.to_numeric(out[FROM], errors="coerce")
    out[TO] = pd.to_numeric(out[TO], errors="coerce")
    if MID not in out.columns:
        out[MID] = 0.5 * (out[FROM] + out[TO])
    out = out[out[HOLE_ID].notna() & out[MID].notna()].reset_index(drop=True)

    if out.empty:
        return out

    depth_requests = out[[HOLE_ID, MID]].rename(columns={MID: "depth"})
    positions = interpolate_trajectory(traces, depth_requests).rename(
        columns={"depth": MID},
    )
    return out.merge(positions, on=[HOLE_ID, MID], how="left")


def build_traces(collars, surveys, step=1.0):
    return minimum_curvature_desurvey(collars=collars, surveys=surveys, step=step)