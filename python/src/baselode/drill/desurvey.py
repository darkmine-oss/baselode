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

Rows missing a hole identifier, usable collar coordinates, or usable survey
measurements are ignored. Missing collar elevation defaults to zero. This lets
valid holes be processed even when a canonical table contains incomplete rows.
"""

import math

import numpy as np
import pandas as pd

from baselode.datamodel import HOLE_ID, AZIMUTH, DIP, FROM, TO, EASTING, NORTHING, ELEVATION, DEPTH, MID


_TRACE_COLUMNS = [HOLE_ID, "md", EASTING, NORTHING, ELEVATION, AZIMUTH, DIP]


def _direction_cosines(azimuth, dip):
    """Unit direction cosines for a hole-orientation reading.

    Convention: ``dip`` is degrees below horizontal — a value of ``-90``
    means "straight down" and a value of ``0`` means "horizontal".  The
    returned ``cc`` (Z component) follows the standard 3D-space
    convention where +Z is up, so a downward-pointing hole produces a
    *negative* dz — its `elevation` decreases as you walk down the
    trace.  This matches how every downstream consumer (OMF, Leapfrog,
    Surpac, the 3D scene with the standard +Z=up camera) interprets the
    field.
    """
    az_rad = math.radians(azimuth)
    dip_rad = math.radians(dip)
    ca = math.cos(dip_rad) * math.sin(az_rad)
    cb = math.cos(dip_rad) * math.cos(az_rad)
    cc = math.sin(dip_rad)
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


def _prepare_desurvey_inputs(collars, surveys):
    """Return usable collar and survey rows without changing caller data."""
    collar_columns = [HOLE_ID, EASTING, NORTHING]
    survey_columns = [HOLE_ID, DEPTH, AZIMUTH, DIP]
    if (
        collars.empty
        or surveys.empty
        or not set(collar_columns).issubset(collars.columns)
        or not set(survey_columns).issubset(surveys.columns)
    ):
        return (
            pd.DataFrame(columns=[*collar_columns, ELEVATION]),
            pd.DataFrame(columns=survey_columns),
        )

    selected_collar_columns = [*collar_columns]
    if ELEVATION in collars.columns:
        selected_collar_columns.append(ELEVATION)
    prepared_collars = collars[selected_collar_columns].copy()
    if ELEVATION not in prepared_collars.columns:
        prepared_collars[ELEVATION] = 0.0

    prepared_surveys = surveys[survey_columns].copy()
    for column in [EASTING, NORTHING, ELEVATION]:
        prepared_collars[column] = pd.to_numeric(prepared_collars[column], errors="coerce")
    prepared_collars = prepared_collars.replace([np.inf, -np.inf], np.nan)
    prepared_collars[ELEVATION] = prepared_collars[ELEVATION].fillna(0.0)
    for column in [DEPTH, AZIMUTH, DIP]:
        prepared_surveys[column] = pd.to_numeric(prepared_surveys[column], errors="coerce")
    prepared_surveys = prepared_surveys.replace([np.inf, -np.inf], np.nan)

    prepared_collars = prepared_collars.dropna(subset=[HOLE_ID, EASTING, NORTHING])
    prepared_surveys = prepared_surveys.dropna(subset=survey_columns)
    if prepared_collars.empty or prepared_surveys.empty:
        return prepared_collars.iloc[0:0], prepared_surveys.iloc[0:0]

    valid_holes = set(prepared_collars[HOLE_ID]).intersection(prepared_surveys[HOLE_ID])
    prepared_collars = prepared_collars[prepared_collars[HOLE_ID].isin(valid_holes)]
    prepared_collars = prepared_collars.drop_duplicates(subset=[HOLE_ID], keep="first")
    prepared_surveys = prepared_surveys[prepared_surveys[HOLE_ID].isin(valid_holes)]
    return prepared_collars, prepared_surveys


def _desurvey(collars, surveys, step=1.0, method="minimum_curvature"):
    collars, surveys = _prepare_desurvey_inputs(collars, surveys)
    if collars.empty or surveys.empty:
        return pd.DataFrame(columns=_TRACE_COLUMNS)

    traces = []
    collars_by_hole = collars.set_index(HOLE_ID)
    for hole_id, hole_surveys in surveys.groupby(HOLE_ID, sort=False):
        collar_row = collars_by_hole.loc[hole_id]
        hole_surveys = hole_surveys.sort_values(DEPTH)
        x = float(collar_row[EASTING])
        y = float(collar_row[NORTHING])
        z = float(collar_row[ELEVATION])
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
    """Build traces with minimum curvature, ignoring incomplete input rows."""
    return _desurvey(collars=collars, surveys=surveys, step=step, method="minimum_curvature")


def tangential_desurvey(collars, surveys, step=1.0,):
    """Use starting orientations per segment, ignoring incomplete rows."""
    return _desurvey(collars=collars, surveys=surveys, step=step, method="tangential")


def balanced_tangential_desurvey(collars, surveys, step=1.0):
    """Use averaged endpoint orientations, ignoring incomplete input rows."""
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
        *md_col*, *easting_col*, *northing_col*, *elevation_col*.
        *azimuth_col* and *dip_col* are optional; when absent (e.g. on
        traces produced by a structural workflow that only tracks
        position) those columns are returned as ``NaN``.
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
    """Build minimum-curvature traces from usable canonical input rows.

    Collar rows require ``hole_id``, ``easting``, and ``northing``. Survey
    rows require ``hole_id``, ``depth``, ``azimuth``, and ``dip``. Missing or
    non-numeric required values are ignored, while absent or null collar
    elevation defaults to zero. Inputs are not modified.

    Parameters
    ----------
    collars : pd.DataFrame
        Canonical collar records.
    surveys : pd.DataFrame
        Canonical downhole survey records.
    step : float, optional
        Maximum measured-depth interval between output vertices.

    Returns
    -------
    pd.DataFrame
        Trace vertices with hole identifier, measured depth, coordinates,
        azimuth, and dip.
    """
    return minimum_curvature_desurvey(collars=collars, surveys=surveys, step=step)
