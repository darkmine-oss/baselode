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

"""Compositing and resampling helpers."""

import numpy as np
import pandas as pd

from baselode.datamodel import (
    AZIMUTH,
    DIP,
    EASTING,
    ELEVATION,
    HOLE_ID,
    NORTHING,
)
from baselode.drill.desurvey import interpolate_trajectory


_SOFT = "soft"
_HARD = "hard"
_VALID_MODES = (_SOFT, _HARD)

_RESIDUAL_DISCARD = "discard"
_RESIDUAL_ADD_TO_PREVIOUS = "add_to_previous"
_RESIDUAL_DISTRIBUTE = "distribute"
_VALID_RESIDUALS = (_RESIDUAL_DISCARD, _RESIDUAL_ADD_TO_PREVIOUS, _RESIDUAL_DISTRIBUTE)

_VALID_METHODS = ("average", "sum")


def composite_intervals(
    df,
    value_col,
    from_col="from",
    to_col="to",
    length=1.0,
    method="average",
    *,
    mode="soft",
    boundary_col=None,
    residual="discard",
):
    """Length-weighted compositing of downhole intervals.

    Two boundary modes are supported:

    * ``mode="soft"`` (default) — uniform bins of *length* spanning
      each hole's full ``[min(from), max(to))`` range.  Each output
      bin's value is the length-weighted average (or sum) of the
      source intervals overlapping it.  This is the FractalGeoAnalytics
      ``dhcomp`` (2023) default, also called "smear" or
      "soft-boundary" compositing — composites freely cross geological
      contacts.
    * ``mode="hard"`` — bins reset at every change in *boundary_col*
      within a hole.  No composite straddles a coded contact, so each
      output row carries a single ``boundary_col`` value.  Useful for
      domain-aware compositing (lithology, regolith, alteration).

    The *residual* parameter controls how a short tail inside a
    ``mode="hard"`` domain is handled when its length isn't an exact
    multiple of *length*:

    * ``"discard"`` (default) — drop the residual run.
    * ``"add_to_previous"`` — merge the residual into the previous
      composite within the same domain; the prior composite's ``to``
      extends to the domain end.
    * ``"distribute"`` — choose ``n_bins = max(1, round(D / length))``
      where ``D`` is the domain length, then split the domain into
      *n_bins* equal-length composites.  Net effect: bin length is
      stretched (or compressed) so the integer bin count exactly
      covers the domain.

    Parameters
    ----------
    df : pd.DataFrame
        Interval table.  Must carry ``hole_id``, *from_col*, *to_col*
        and *value_col*; when ``mode="hard"`` also *boundary_col*.
    value_col : str
        Numeric column to composite.
    from_col, to_col : str
        Interval depth columns.  Default ``"from"`` / ``"to"``.
    length : float
        Composite length in metres (downhole).  Default ``1.0``.
    method : {"average", "sum"}
        Length-weighted average (default) or sum.  Average is
        :math:`\\sum v_i w_i / \\sum w_i`; sum is :math:`\\sum v_i w_i`
        where ``w_i`` is the overlap length between source interval
        ``i`` and the composite bin.
    mode : {"soft", "hard"}
        Boundary handling.  Default ``"soft"`` preserves prior
        behaviour.
    boundary_col : str, optional
        Domain column for ``mode="hard"``.  Required in hard mode;
        ignored in soft mode.
    residual : {"discard", "add_to_previous", "distribute"}
        Tail-of-domain handling for ``mode="hard"``.  Ignored in soft
        mode.  Default ``"discard"``.

    Returns
    -------
    pd.DataFrame
        Composites with columns ``hole_id``, *from_col*, *to_col*,
        *value_col*, plus *boundary_col* when ``mode="hard"``.

    Notes
    -----
    Mass-balance: in either mode, ``sum(value × overlap)`` over each
    source interval equals the corresponding contribution into the
    composites.  In ``method="sum"`` the per-hole grand total of
    ``value × overlap`` is preserved (modulo intervals dropped by
    residual handling).  In ``method="average"`` the per-composite
    weighted average equals the source weighted average within that
    bin's coverage window.

    References
    ----------
    FractalGeoAnalytics, *dhcomp — downhole compositing utility*
    (2023).  https://github.com/FractalGeoAnalytics/dhcomp
    """
    if mode not in _VALID_MODES:
        raise ValueError(f"mode must be one of {_VALID_MODES}, got {mode!r}")
    if method not in _VALID_METHODS:
        raise ValueError(f"method must be one of {_VALID_METHODS}, got {method!r}")
    if not (length > 0):
        raise ValueError(f"length must be > 0, got {length!r}")
    if mode == _HARD:
        if not boundary_col:
            raise ValueError("mode='hard' requires a boundary_col")
        if residual not in _VALID_RESIDUALS:
            raise ValueError(f"residual must be one of {_VALID_RESIDUALS}, got {residual!r}")
        if boundary_col not in df.columns:
            raise ValueError(f"boundary_col {boundary_col!r} not in DataFrame columns")
    if df.empty:
        return df.copy()

    df_sorted = df.sort_values(["hole_id", from_col])
    if mode == _SOFT:
        return _composite_soft(df_sorted, value_col, from_col, to_col, length, method)
    return _composite_hard(
        df_sorted, value_col, from_col, to_col, length, method, boundary_col, residual
    )


def _composite_soft(df_sorted, value_col, from_col, to_col, length, method):
    composites = []
    for hole_id, group in df_sorted.groupby("hole_id"):
        start = group[from_col].min()
        end = group[to_col].max()
        bins = np.arange(start, end + length, length)
        for i in range(len(bins) - 1):
            c_from = bins[i]
            c_to = bins[i + 1]
            row = _composite_bin(group, value_col, from_col, to_col, c_from, c_to, method)
            if row is None:
                continue
            row["hole_id"] = hole_id
            composites.append(row)
    return pd.DataFrame(composites)


def _composite_hard(
    df_sorted, value_col, from_col, to_col, length, method, boundary_col, residual
):
    composites = []
    for hole_id, hole_group in df_sorted.groupby("hole_id"):
        # Walk the hole top-to-bottom and split into contiguous domain
        # runs.  A "run" is a maximal stretch of rows where
        # boundary_col holds the same value AND the rows abut (the
        # `to` of one equals the `from` of the next, within tolerance).
        # Non-abutting same-domain rows are still treated as separate
        # runs, which matches how hard-boundary compositing treats
        # unsurveyed gaps as breaks.
        runs = _group_runs(hole_group, from_col, to_col, boundary_col)
        for run in runs:
            domain_value = run[boundary_col].iloc[0]
            start = run[from_col].min()
            end = run[to_col].max()
            domain_length = end - start
            if domain_length <= 0:
                continue
            edges = _bin_edges_for_domain(start, end, length, residual)
            for c_from, c_to in zip(edges[:-1], edges[1:]):
                row = _composite_bin(run, value_col, from_col, to_col, c_from, c_to, method)
                if row is None:
                    continue
                row["hole_id"] = hole_id
                row[boundary_col] = domain_value
                composites.append(row)
    return pd.DataFrame(composites)


def _group_runs(hole_group, from_col, to_col, boundary_col):
    """Split a hole's intervals into contiguous, same-domain runs."""
    if hole_group.empty:
        return []
    runs = []
    current = []
    prev_to = None
    prev_domain = None
    tol = 1e-9
    for _, row in hole_group.iterrows():
        domain = row[boundary_col]
        same_domain = (prev_domain is not None and domain == prev_domain)
        abuts = prev_to is None or abs(row[from_col] - prev_to) <= tol
        if current and same_domain and abuts:
            current.append(row)
        else:
            if current:
                runs.append(pd.DataFrame(current))
            current = [row]
        prev_to = row[to_col]
        prev_domain = domain
    if current:
        runs.append(pd.DataFrame(current))
    return runs


def _bin_edges_for_domain(start, end, length, residual):
    """Compute composite bin edges within a hard-boundary domain.

    Returns a list of monotonically-increasing edges; the bins are the
    consecutive pairs.  Honors the three residual rules.
    """
    domain_length = end - start
    if domain_length <= 0:
        return []
    n_full = int(np.floor(domain_length / length + 1e-9))
    remainder = domain_length - n_full * length
    has_residual = remainder > 1e-9

    if residual == _RESIDUAL_DISTRIBUTE:
        # Round to nearest integer bin count, minimum one bin.
        n_bins = max(1, int(np.rint(domain_length / length)))
        bin_len = domain_length / n_bins
        return [start + i * bin_len for i in range(n_bins + 1)]

    edges = [start + i * length for i in range(n_full + 1)]
    if not has_residual:
        return edges

    if residual == _RESIDUAL_DISCARD:
        # Drop the residual: if no full bin fits, return an empty
        # cover so the caller emits nothing for this domain.
        if n_full == 0:
            return []
        return edges

    if residual == _RESIDUAL_ADD_TO_PREVIOUS:
        if n_full == 0:
            # No prior composite to extend — fall back to a single
            # bin covering the whole domain so the data isn't lost.
            return [start, end]
        # Extend the last composite to the domain end.
        edges[-1] = end
        return edges

    return edges  # unreachable; mode is validated upstream


def _composite_bin(group, value_col, from_col, to_col, c_from, c_to, method):
    """Compute one composite row over [c_from, c_to) from *group*.

    Returns ``None`` when no source interval overlaps the bin, so the
    caller can skip rather than emit an all-zero composite.
    """
    window = group[(group[from_col] < c_to) & (group[to_col] > c_from)]
    if window.empty:
        return None
    overlap_len = (
        np.minimum(window[to_col], c_to) - np.maximum(window[from_col], c_from)
    ).clip(lower=0)
    total_overlap = overlap_len.sum()
    if total_overlap <= 0:
        return None
    if method == "sum":
        val = (window[value_col] * overlap_len).sum()
    else:
        weights = overlap_len / total_overlap
        val = (window[value_col] * weights).sum()
    return {from_col: c_from, to_col: c_to, value_col: val}


def composite_true_thickness(
    intervals,
    traces,
    value_col,
    ref_dip,
    ref_dip_azimuth,
    from_col="from",
    to_col="to",
    length=1.0,
    method="average",
    hole_col=HOLE_ID,
):
    """Composite intervals with true-thickness reporting.

    For each source interval, the midpoint orientation is looked up in
    *traces* via :func:`~baselode.drill.desurvey.interpolate_trajectory`
    and used to compute the interval's *true thickness* — the
    perpendicular distance traversed across a reference plane defined
    by *ref_dip* and *ref_dip_azimuth*:

    .. math::

        L_{\\mathrm{true}} = L_{\\mathrm{downhole}} \\cdot
            \\lvert \\hat T \\cdot \\hat N \\rvert

    where :math:`\\hat T` is the hole's unit tangent at the interval
    midpoint and :math:`\\hat N` is the unit normal of the reference
    plane.  Compositing then runs in soft-boundary mode over the
    cumulative *true thickness* coordinate — each output composite
    spans ``length`` of true thickness, with its downhole ``from`` /
    ``to`` recovered from the inverse cumulative map.

    Use this when you need composites that represent equal stratigraphic
    thickness across a known orebody plane — the "economic compositing"
    convention in resource estimation (Sinclair & Blackwell 2002,
    *Applied Mineral Inventory Estimation*, ch. 5).

    Parameters
    ----------
    intervals : pd.DataFrame
        Interval table with ``hole_id``, *from_col*, *to_col*,
        *value_col*.
    traces : pd.DataFrame
        Desurveyed trace (e.g. output of
        :func:`~baselode.drill.desurvey.minimum_curvature_desurvey`).
        Must include orientation columns ``azimuth`` and ``dip`` —
        without them true thickness cannot be computed.
    value_col : str
        Numeric column to composite.
    ref_dip : float
        Reference plane dip in degrees (positive downward).  Use
        ``0`` for a horizontal plane (sub-horizontal seam), ``90``
        for a vertical plane (steep vein).
    ref_dip_azimuth : float
        Dip azimuth (downdip direction) of the reference plane in
        degrees clockwise from grid north.
    from_col, to_col : str
        Interval depth columns.
    length : float
        Composite true-thickness in metres.  Default ``1.0``.
    method : {"average", "sum"}
        Length-weighting mode, applied with *true thickness* as the
        weight.
    hole_col : str
        Hole identifier column.  Default from
        :mod:`baselode.datamodel`.

    Returns
    -------
    pd.DataFrame
        One row per composite with columns ``hole_id``, *from_col*,
        *to_col* (downhole metres), *value_col*, ``length_md``
        (downhole length covered), ``length_true`` (true thickness
        of the composite — usually equal to *length* except possibly
        the last bin per hole).

    Notes
    -----
    Sub-vertical drillholes through a sub-horizontal reference plane
    give :math:`L_{\\mathrm{true}} \\approx L_{\\mathrm{downhole}}`;
    a hole drilled along the plane (parallel to it) gives
    :math:`L_{\\mathrm{true}} \\approx 0` and the function emits
    nothing — no economic thickness is being captured.
    """
    if method not in _VALID_METHODS:
        raise ValueError(f"method must be one of {_VALID_METHODS}, got {method!r}")
    if not (length > 0):
        raise ValueError(f"length must be > 0, got {length!r}")
    if intervals.empty:
        return intervals.copy()
    if AZIMUTH not in traces.columns or DIP not in traces.columns:
        raise ValueError(
            "true-thickness compositing needs traces with azimuth and dip columns"
        )
    plane_normal = _plane_normal(ref_dip, ref_dip_azimuth)

    intervals_sorted = intervals.sort_values([hole_col, from_col]).reset_index(drop=True)
    midpoints = (intervals_sorted[from_col] + intervals_sorted[to_col]) / 2.0
    # `interpolate_trajectory` returns one orientation row per requested
    # (hole, depth) row in the same order it was asked.  Because
    # `intervals_sorted` (and therefore `depths_request`) is already
    # ordered by (hole, from_col), we can align the returned tangents
    # back onto the intervals by positional index — no per-row join is
    # needed.  This also means duplicate midpoints (two assay rows
    # sharing a from→to span) stay aligned with their originating row.
    depths_request = pd.DataFrame(
        {hole_col: intervals_sorted[hole_col].values, "depth": midpoints.values}
    )
    orient = interpolate_trajectory(traces, depths_request, hole_col=hole_col)
    azimuth = orient[AZIMUTH].to_numpy(dtype=float)
    dip = orient[DIP].to_numpy(dtype=float)
    tangents = _tangents_from_azimuth_dip(azimuth, dip)
    cos_to_normal = np.abs(tangents @ plane_normal)
    downhole_len = (intervals_sorted[to_col] - intervals_sorted[from_col]).to_numpy(dtype=float)
    true_per_interval = downhole_len * cos_to_normal

    composites = []
    for hole_id, hole_group in intervals_sorted.groupby(hole_col, sort=False):
        idx = hole_group.index.to_numpy()
        composites.extend(
            _composite_true_for_hole(
                hole_id,
                hole_group.reset_index(drop=True),
                true_per_interval[idx],
                value_col,
                from_col,
                to_col,
                length,
                method,
                hole_col,
            )
        )
    return pd.DataFrame(composites)


def _composite_true_for_hole(
    hole_id, hole_group, true_per_interval, value_col, from_col, to_col, length, method, hole_col
):
    out = []
    cum_true = np.concatenate(([0.0], np.cumsum(true_per_interval)))
    total_true = cum_true[-1]
    if total_true <= 0:
        return out
    n_bins = int(np.ceil(total_true / length))
    md_from_arr = hole_group[from_col].to_numpy(dtype=float)
    md_to_arr = hole_group[to_col].to_numpy(dtype=float)
    values = hole_group[value_col].to_numpy(dtype=float)
    for bin_idx in range(n_bins):
        t0 = bin_idx * length
        t1 = min((bin_idx + 1) * length, total_true)
        if t1 - t0 <= 0:
            continue
        # For each source interval, compute its true-thickness overlap with [t0, t1).
        true_starts = cum_true[:-1]
        true_ends = cum_true[1:]
        overlap_true = np.minimum(true_ends, t1) - np.maximum(true_starts, t0)
        overlap_true = np.clip(overlap_true, 0.0, None)
        total_overlap = overlap_true.sum()
        if total_overlap <= 0:
            continue
        # Per-interval scale factor true/md; safe because we already
        # rejected intervals contributing zero true thickness (their
        # overlap_true is zero).
        true_lengths = true_ends - true_starts
        md_lengths = md_to_arr - md_from_arr
        scale = np.where(true_lengths > 0, md_lengths / true_lengths, 0.0)
        overlap_md = overlap_true * scale
        # Composite md bounds: start of first contributing interval +
        # fractional offset, ending at the last contributor's
        # proportional offset.
        contrib = overlap_true > 0
        first = int(np.argmax(contrib))
        last = len(contrib) - 1 - int(np.argmax(contrib[::-1]))
        # md offset within each contributing interval
        md_from = md_from_arr[first] + max(0.0, (t0 - true_starts[first]) * scale[first])
        md_to = md_from_arr[last] + min(md_lengths[last], (t1 - true_starts[last]) * scale[last])
        if method == "sum":
            val = float((values * overlap_true).sum())
        else:
            val = float((values * overlap_true).sum() / total_overlap)
        out.append({
            hole_col: hole_id,
            from_col: float(md_from),
            to_col: float(md_to),
            value_col: val,
            "length_md": float(overlap_md.sum()),
            "length_true": float(t1 - t0),
        })
    return out


def _plane_normal(dip_deg, dip_az_deg):
    """Unit normal of a plane defined by dip + dip-azimuth.

    Convention: dip ``= 0`` → horizontal plane (normal points up, +Z).
    Dip ``> 0`` rotates the plane about the strike line; dip-azimuth
    is the downdip direction (azimuth of the downdip vector,
    clockwise from grid north).
    """
    dip = np.deg2rad(dip_deg)
    az = np.deg2rad(dip_az_deg)
    # downdip vector
    dd = np.array([np.sin(az) * np.cos(dip), np.cos(az) * np.cos(dip), -np.sin(dip)])
    # strike vector — perpendicular to downdip in the horizontal plane
    strike = np.array([np.cos(az), -np.sin(az), 0.0])
    # normal = strike × downdip, then normalise
    normal = np.cross(strike, dd)
    norm = np.linalg.norm(normal)
    if norm < 1e-12:
        return np.array([0.0, 0.0, 1.0])
    return normal / norm


def _tangents_from_azimuth_dip(azimuth_deg, dip_deg):
    """Hole tangent unit vectors from per-row azimuth + dip (degrees).

    Dip is the angle below horizontal (positive downward, the survey
    convention used throughout :mod:`baselode.drill`).  Returns an
    ``(n, 3)`` ``(easting, northing, elevation)`` array.
    """
    az = np.deg2rad(azimuth_deg)
    dp = np.deg2rad(dip_deg)
    east = np.sin(az) * np.cos(dp)
    north = np.cos(az) * np.cos(dp)
    elev = -np.sin(dp)
    tangents = np.stack([east, north, elev], axis=-1)
    # Replace NaN rows (depths outside the trace's md range) with
    # zero — `_composite_true_for_hole` then sees zero true thickness
    # and drops the interval.
    nan_mask = np.isnan(tangents).any(axis=-1)
    tangents[nan_mask] = 0.0
    return tangents


def resample_trace(trace_df, step=1.0):
    if trace_df.empty:
        return trace_df.copy()
    resampled = []
    for hole_id, group in trace_df.groupby("hole_id"):
        group_sorted = group.sort_values("md")
        mds = group_sorted["md"].values
        start = mds.min()
        end = mds.max()
        sample_mds = np.arange(start, end + step, step)
        res_e = np.interp(sample_mds, mds, group_sorted[EASTING].values)
        res_n = np.interp(sample_mds, mds, group_sorted[NORTHING].values)
        res_z = np.interp(sample_mds, mds, group_sorted[ELEVATION].values)
        for md_val, easting, northing, elevation in zip(sample_mds, res_e, res_n, res_z):
            resampled.append({"hole_id": hole_id, "md": md_val, EASTING: easting, NORTHING: northing, ELEVATION: elevation})
    return pd.DataFrame(resampled)


def merge_numeric_categorical(numeric_df, categorical_df, on_cols=("hole_id", "from", "to")):
    if numeric_df.empty and categorical_df.empty:
        return pd.DataFrame()
    if numeric_df.empty:
        return categorical_df.copy()
    if categorical_df.empty:
        return numeric_df.copy()
    return numeric_df.merge(categorical_df, on=list(on_cols), how="outer")
