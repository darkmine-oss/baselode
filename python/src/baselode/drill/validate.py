# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

# This file is part of baselode.

# baselode is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the license, or
# (at your option) any later version.

# baselode is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.

# You should have received a copy of the GNU General Public License
# along with baselode.  If not, see <https://www.gnu.org/licenses/>.

"""QA/QC helpers for drillhole tables."""

import re

import numpy as np
import pandas as pd

import baselode.drill.intervals
from baselode.datamodel import AZIMUTH, DEPTH, DIP, FROM, HOLE_ID, MAX_DEPTH, TO

SEVERITY_ERROR = "error"
SEVERITY_WARNING = "warning"
SEVERITY_INFO = "info"

_BDL_PATTERN = re.compile(r"^\s*<\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*$")


def validate_intervals(df, from_col="from", to_col="to", hole_col="hole_id"):
    issues = []
    for hole_id, group in df.groupby(hole_col):
        prev_to = None
        for _, row in group.sort_values(from_col).iterrows():
            f = row[from_col]
            t = row[to_col]
            if pd.isna(f) or pd.isna(t):
                issues.append({"hole_id": hole_id, "type": "missing_depth", "row": row.to_dict()})
                continue
            if t <= f:
                issues.append({"hole_id": hole_id, "type": "non_positive_length", "row": row.to_dict()})
            if prev_to is not None and f < prev_to:
                issues.append({"hole_id": hole_id, "type": "overlap", "row": row.to_dict()})
            prev_to = t
    return issues


def validate_surveys(df, hole_col="hole_id", depth_col="from"):
    issues = []
    for hole_id, group in df.groupby(hole_col):
        depths = group[depth_col].values
        if not pd.Series(depths).is_monotonic_increasing:
            issues.append({"hole_id": hole_id, "type": "non_monotonic_survey"})
    return issues


def report_missing_columns(df, required):
    missing = [col for col in required if col not in df.columns]
    return missing


def validate_structural_points(df, dip_col=DIP, az_col=AZIMUTH, hole_col=HOLE_ID, depth_col=DEPTH):
    """Validate structural point measurements.

    Returns a list of issue dicts: dip out of [0, 90], azimuth out of [0, 360), missing depth.
    """
    issues = []
    for idx, row in df.iterrows():
        hole_id = row.get(hole_col)
        depth = row.get(depth_col)
        dip = row.get(dip_col)
        az = row.get(az_col)

        if pd.isna(depth):
            issues.append({"hole_id": hole_id, "row_index": idx, "type": "missing_depth", "row": row.to_dict()})
            continue

        if dip is not None and not pd.isna(dip):
            if dip < 0 or dip > 90:
                issues.append({"hole_id": hole_id, "row_index": idx, "type": "dip_out_of_range",
                                "value": dip, "row": row.to_dict()})

        if az is not None and not pd.isna(az):
            if az < 0 or az >= 360:
                issues.append({"hole_id": hole_id, "row_index": idx, "type": "azimuth_out_of_range",
                                "value": az, "row": row.to_dict()})

    return issues


def validate_structural_intervals(df, from_col=FROM, to_col=TO, dip_col=DIP, az_col=AZIMUTH, hole_col=HOLE_ID):
    """Validate structural interval measurements.

    Reuses validate_intervals() for from/to consistency, then checks dip/azimuth ranges.
    """
    issues = list(validate_intervals(df, from_col=from_col, to_col=to_col, hole_col=hole_col))

    for idx, row in df.iterrows():
        hole_id = row.get(hole_col)
        dip = row.get(dip_col)
        az = row.get(az_col)

        if dip is not None and not pd.isna(dip):
            if dip < 0 or dip > 90:
                issues.append({"hole_id": hole_id, "row_index": idx, "type": "dip_out_of_range",
                                "value": dip, "row": row.to_dict()})

        if az is not None and not pd.isna(az):
            if az < 0 or az >= 360:
                issues.append({"hole_id": hole_id, "row_index": idx, "type": "azimuth_out_of_range",
                                "value": az, "row": row.to_dict()})

    return issues


def validate_drillhole_db(
    collar,
    survey,
    interval_tables=None,
    hole_col=HOLE_ID,
    depth_col=DEPTH,
    azimuth_col=AZIMUTH,
    dip_col=DIP,
    from_col=FROM,
    to_col=TO,
    max_depth_col=MAX_DEPTH,
    allow_full_circle=False,
):
    """Run the full drillhole-database validation suite.

    Returns a structured report (not exceptions) so callers can drive a
    review UI or QA log.  Each issue carries a ``check`` name, a
    ``severity`` (``error`` / ``warning`` / ``info``), the affected
    ``hole_id`` / ``table`` / ``row_index``, a human-readable ``message``,
    and a ``fix`` recipe when one is available.

    Survey rows are "usable" when ``depth``, ``azimuth`` and ``dip`` are all
    numeric.  Desurvey silently ignores anything else, so the survey checks
    flag them here: ``survey_null_orientation`` (error, per row) and
    ``survey_no_usable_stations`` (warning, per hole — the hole will drop
    out of the desurvey entirely).  ``single_station_surveys`` counts only
    usable rows.

    Parameters
    ----------
    collar : pd.DataFrame
        Collar table.  Required columns: *hole_col*.  Optional: *max_depth_col*.
    survey : pd.DataFrame
        Survey table.  Required columns: *hole_col*, *depth_col*,
        *azimuth_col*, *dip_col*.
    interval_tables : dict[str, pd.DataFrame] or None
        Mapping ``{name: interval_df}`` for each interval table to validate
        (e.g. ``{"assay": assays, "geology": litho}``).  Each frame must
        carry *hole_col*, *from_col*, *to_col*.  ``None`` skips all
        interval-level checks.
    hole_col, depth_col, azimuth_col, dip_col, from_col, to_col, max_depth_col : str
        Column-name overrides (defaults from :mod:`baselode.datamodel`).
    allow_full_circle : bool
        When ``True``, accept ``azimuth = 360`` as valid (closed interval
        ``[0, 360]``); when ``False`` (default) the strict mathematical
        convention ``[0, 360)`` is used and ``360`` is reported as an error
        with a fix recipe pointing at :func:`normalize_azimuth`.

    Returns
    -------
    dict
        ``{"summary": {"error": int, "warning": int, "info": int},
        "issues": [dict, ...]}``.
    """
    issues = []
    issues.extend(_check_duplicate_hole_ids(collar, hole_col))
    issues.extend(_check_survey_null_orientation(survey, hole_col, depth_col, azimuth_col, dip_col))
    issues.extend(_check_survey_no_usable_stations(collar, survey, hole_col, depth_col, azimuth_col, dip_col))
    issues.extend(_check_single_station_surveys(survey, hole_col, depth_col, azimuth_col, dip_col))
    issues.extend(_check_azimuth_range(survey, hole_col, depth_col, azimuth_col, allow_full_circle))
    issues.extend(_check_dip_range(survey, hole_col, depth_col, dip_col))

    if interval_tables:
        collar_hole_ids = set(collar[hole_col].dropna().tolist()) if hole_col in collar.columns else set()
        max_depth_lookup = _build_max_depth_lookup(collar, hole_col, max_depth_col)
        for table_name, table in interval_tables.items():
            issues.extend(_check_orphan_intervals(table, table_name, collar_hole_ids, hole_col))
            issues.extend(_check_negative_lengths(table, table_name, hole_col, from_col, to_col))
            issues.extend(_check_intervals_beyond_max_depth(
                table, table_name, max_depth_lookup, hole_col, to_col,
            ))
            issues.extend(_check_interval_gaps(table, table_name, hole_col, from_col, to_col))
            issues.extend(_check_interval_overlaps(table, table_name, hole_col, from_col, to_col))
            issues.extend(_check_below_detection_limit(table, table_name, hole_col, from_col, to_col))

    summary = {
        SEVERITY_ERROR: sum(1 for issue in issues if issue["severity"] == SEVERITY_ERROR),
        SEVERITY_WARNING: sum(1 for issue in issues if issue["severity"] == SEVERITY_WARNING),
        SEVERITY_INFO: sum(1 for issue in issues if issue["severity"] == SEVERITY_INFO),
    }
    return {"summary": summary, "issues": issues}


def fix_single_station_surveys(survey, collar=None, hole_col=HOLE_ID, depth_col=DEPTH, max_depth_col=MAX_DEPTH):
    """Synthesize a second survey station for any hole with only one.

    Desurvey requires at least two stations per hole; a hole with exactly
    one row breaks min-curvature / balanced-tangential / tangential
    calculations.  This helper duplicates the single station at a deeper
    depth — using ``collar.max_depth`` when available, otherwise the
    station's own depth plus ``1.0`` — and copies azimuth/dip unchanged
    (constant-orientation assumption).

    Equivalent to PyGSLIB's ``fix_survey_one_interval_err``.

    Parameters
    ----------
    survey : pd.DataFrame
        Survey table.
    collar : pd.DataFrame, optional
        Collar table; if provided and contains *max_depth_col*, that value
        is used as the synthetic station depth.
    hole_col, depth_col, max_depth_col : str

    Returns
    -------
    pd.DataFrame
        Survey table with synthetic stations appended; original rows
        unchanged.  Index is reset.
    """
    if survey.empty:
        return survey.copy()

    max_depth_lookup = _build_max_depth_lookup(collar, hole_col, max_depth_col) if collar is not None else {}
    usable = _usable_station_mask(survey, depth_col, AZIMUTH, DIP)
    new_rows = []
    for hole_id, group in survey[usable].groupby(hole_col):
        if len(group) != 1:
            continue
        original = group.iloc[0]
        synthetic = original.to_dict()
        anchor_depth = max_depth_lookup.get(hole_id)
        if anchor_depth is None or pd.isna(anchor_depth) or anchor_depth <= float(original[depth_col]):
            anchor_depth = float(original[depth_col]) + 1.0
        synthetic[depth_col] = float(anchor_depth)
        new_rows.append(synthetic)

    if not new_rows:
        return survey.reset_index(drop=True)

    extended = pd.concat([survey, pd.DataFrame(new_rows)], ignore_index=True)
    return extended.sort_values([hole_col, depth_col]).reset_index(drop=True)


def drop_unusable_survey_rows(survey, hole_col=HOLE_ID, depth_col=DEPTH, azimuth_col=AZIMUTH, dip_col=DIP):
    """Drop survey rows whose depth, azimuth or dip is null or non-numeric.

    The complement of the ``survey_null_orientation`` validation check.
    Desurvey already ignores these rows, so removing them changes no trace;
    it just makes the table honest about what it contains.  Holes left
    with no rows at all are reported by ``survey_no_usable_stations`` and
    can be rebuilt with :func:`synthesise_collar_station`.

    Parameters
    ----------
    survey : pd.DataFrame
        Survey table.
    hole_col, depth_col, azimuth_col, dip_col : str
        Column-name overrides (defaults from :mod:`baselode.datamodel`).

    Returns
    -------
    pd.DataFrame
        Filtered copy of *survey* with the index reset.
    """
    if survey.empty:
        return survey.copy()
    usable = _usable_station_mask(survey, depth_col, azimuth_col, dip_col)
    return survey[usable].reset_index(drop=True)


def _resolve_column(df, name):
    """Return the column of *df* matching *name* exactly or case-insensitively, else ``None``."""
    if name is None:
        return None
    if name in df.columns:
        return name
    wanted = str(name).strip().lower()
    for col in df.columns:
        if str(col).strip().lower() == wanted:
            return col
    return None


def synthesise_collar_station(
    survey,
    collar,
    hole_col=HOLE_ID,
    depth_col=DEPTH,
    azimuth_col=AZIMUTH,
    dip_col=DIP,
    collar_azimuth_col=AZIMUTH,
    collar_dip_col=DIP,
    return_diagnostics=False,
):
    """Build a survey station at the collar for every hole that has none.

    Targets holes that would otherwise drop out of the desurvey: collar
    holes with no survey rows, and holes whose every survey row lacks a
    usable depth / azimuth / dip.  For each one a station at depth ``0``
    is appended, oriented from the collar table's *collar_azimuth_col* /
    *collar_dip_col* (matched case-insensitively) when both are numeric,
    otherwise vertical (``azimuth 0``, ``dip -90``).  The hole's existing
    unusable rows are dropped so the synthetic station is its only one.

    Pair with :func:`fix_single_station_surveys` afterwards: the synthetic
    station is a single-station survey, and that helper pads it to
    ``collar.max_depth`` so the trace runs the full hole length.

    Holes that already have at least one usable station are left alone.

    Parameters
    ----------
    survey : pd.DataFrame
        Survey table.
    collar : pd.DataFrame
        Collar table.  Provides the set of holes and, optionally, the
        orientation columns.
    hole_col, depth_col, azimuth_col, dip_col : str
        Survey column-name overrides (defaults from :mod:`baselode.datamodel`).
    collar_azimuth_col, collar_dip_col : str
        Collar columns holding the planned hole orientation.  Default to
        the canonical ``azimuth`` / ``dip`` names.  Dip follows the survey
        convention (negative = down).
    return_diagnostics : bool, optional
        When ``True`` return ``(survey, report)`` where *report* is a dict
        with ``holes_synthesised``, ``from_collar``, ``vertical_fallback``,
        ``vertical_fallback_holes`` and ``rows_dropped``.

    Returns
    -------
    pd.DataFrame, or tuple of (pd.DataFrame, dict)
        Survey with synthetic stations appended, sorted by ``hole_col`` /
        ``depth_col`` with the index reset.  See ``return_diagnostics``.
    """
    report = {
        "holes_synthesised": 0,
        "from_collar": 0,
        "vertical_fallback": 0,
        "vertical_fallback_holes": [],
        "rows_dropped": 0,
    }
    if collar is None or collar.empty or hole_col not in collar.columns:
        out = survey.copy()
        return (out, report) if return_diagnostics else out

    if survey.empty:
        columns = list(survey.columns)
        for col in (hole_col, depth_col, azimuth_col, dip_col):
            if col not in columns:
                columns.append(col)
        work = pd.DataFrame(columns=columns)
    else:
        work = survey.copy()
    for col in (depth_col, azimuth_col, dip_col):
        if col not in work.columns:
            work[col] = np.nan

    usable = _usable_station_mask(work, depth_col, azimuth_col, dip_col)
    holes_with_station = set(work.loc[usable, hole_col].dropna().tolist())

    az_source = _resolve_column(collar, collar_azimuth_col)
    dip_source = _resolve_column(collar, collar_dip_col)
    collar_by_hole = collar.drop_duplicates(subset=[hole_col], keep="first").set_index(hole_col)

    new_rows = []
    for hole_id in collar_by_hole.index:
        if hole_id is None or pd.isna(hole_id) or hole_id in holes_with_station:
            continue
        collar_row = collar_by_hole.loc[hole_id]
        azimuth = _to_float(collar_row.get(az_source)) if az_source is not None else None
        dip = _to_float(collar_row.get(dip_source)) if dip_source is not None else None
        if azimuth is not None and dip is not None:
            report["from_collar"] += 1
        else:
            azimuth, dip = 0.0, -90.0
            report["vertical_fallback"] += 1
            report["vertical_fallback_holes"].append(hole_id)
        report["holes_synthesised"] += 1
        new_rows.append({hole_col: hole_id, depth_col: 0.0, azimuth_col: azimuth, dip_col: dip})

    if not new_rows:
        out = work.reset_index(drop=True)
        return (out, report) if return_diagnostics else out

    synthesised_holes = {row[hole_col] for row in new_rows}
    drop_mask = work[hole_col].isin(synthesised_holes) & ~usable
    report["rows_dropped"] = int(drop_mask.sum())
    kept = work[~drop_mask]
    extended = pd.concat([kept, pd.DataFrame(new_rows, columns=kept.columns)], ignore_index=True)
    out = extended.sort_values([hole_col, depth_col]).reset_index(drop=True)
    return (out, report) if return_diagnostics else out


def drop_orphan_intervals(table, collar, hole_col=HOLE_ID):
    """Drop interval rows whose ``hole_id`` is not in the collar table.

    The complement of the ``orphan_intervals`` validation check: useful
    when a downstream pipeline needs a strict subset of intervals that
    matches the collar.  Pure — returns a new DataFrame.

    Parameters
    ----------
    table : pd.DataFrame
        Interval table to filter.
    collar : pd.DataFrame
        Collar table providing the valid hole_ids.
    hole_col : str
        Hole identifier column (default :data:`baselode.datamodel.HOLE_ID`).

    Returns
    -------
    pd.DataFrame
        Filtered copy of *table* with the index reset.
    """
    if table.empty:
        return table.copy()
    if collar is None or collar.empty or hole_col not in collar.columns:
        return table.iloc[0:0].copy()
    valid_hole_ids = set(collar[hole_col].dropna().tolist())
    return table[table[hole_col].isin(valid_hole_ids)].reset_index(drop=True)


def swap_inverted_intervals(table, from_col=FROM, to_col=TO):
    """Swap ``from`` and ``to`` where the values are inverted.

    Fixes the common data-entry typo where ``to < from``.  Rows where
    ``to == from`` are genuinely malformed (zero-length intervals) and
    are left untouched — they need human review.  All other columns are
    preserved.

    Parameters
    ----------
    table : pd.DataFrame
        Interval table.
    from_col, to_col : str
        From-/to-depth columns.

    Returns
    -------
    pd.DataFrame
        Copy of *table* with inverted rows corrected.
    """
    if table.empty or from_col not in table.columns or to_col not in table.columns:
        return table.copy()
    out = table.copy()
    inverted_mask = out[to_col] < out[from_col]
    if inverted_mask.any():
        from_values = out.loc[inverted_mask, from_col].copy()
        out.loc[inverted_mask, from_col] = out.loc[inverted_mask, to_col]
        out.loc[inverted_mask, to_col] = from_values
    return out


OVERLAP_REPORT_COLUMNS = ("hole_id", "kind", "action", "from", "to", "note")


def _values_agree(outer_idx, inner_idxs, value_cols, work, from_col, to_col, merge_tol):
    """Return True if outer-row values agree with inner-rows length-weighted.

    For each value column:

    - If the outer value is NaN, the column is skipped (nothing to compare).
    - If the column is non-numeric, every non-NaN inner value must equal
      the outer value exactly.
    - If the column is numeric, the length-weighted mean of inner non-NaN
      values must be within ``merge_tol`` (relative) of the outer value.
    """
    for col in value_cols:
        outer_val = work.at[outer_idx, col]
        if pd.isna(outer_val):
            continue
        try:
            outer_float = float(outer_val)
        except (TypeError, ValueError):
            outer_float = None

        if outer_float is None:
            for inner_idx in inner_idxs:
                inner_val = work.at[inner_idx, col]
                if pd.isna(inner_val):
                    continue
                if inner_val != outer_val:
                    return False
            continue

        weighted_sum = 0.0
        total_weight = 0.0
        for inner_idx in inner_idxs:
            inner_val = work.at[inner_idx, col]
            if pd.isna(inner_val):
                continue
            try:
                inner_float = float(inner_val)
            except (TypeError, ValueError):
                return False
            weight = float(work.at[inner_idx, to_col]) - float(work.at[inner_idx, from_col])
            weighted_sum += inner_float * weight
            total_weight += weight
        if total_weight == 0:
            continue
        inner_mean = weighted_sum / total_weight
        denom = max(abs(outer_float), 1e-9)
        if abs(inner_mean - outer_float) / denom > merge_tol:
            return False
    return True


def fix_overlaps(
    table,
    hole_col=HOLE_ID,
    from_col=FROM,
    to_col=TO,
    value_cols=None,
    touching_tol=0.01,
    merge_tol=0.05,
    coverage_min=0.95,
    precedence_col=None,
    precedence=None,
    return_diagnostics=False,
):
    """Resolve interval overlaps where it's safe, leave the rest flagged.

    Handles three classes of overlap automatically:

    * **Touching overlap** — consecutive intervals where the later one
      starts inside the earlier by less than ``touching_tol`` metres.
      Caused by floating-point rounding.  Snaps the earlier ``to`` down
      to the later ``from``.
    * **Exact duplicate** — rows with identical ``(hole_id, from, to)``
      *and* identical values in every column of ``value_cols``.  Drops
      all but the first row of each duplicate group.
    * **Resampled superset** — a longer interval fully contains shorter
      ones whose length-weighted mean of ``value_cols`` matches the
      longer's value within ``merge_tol`` (relative), and the shorter
      intervals cover at least ``coverage_min`` of the longer.  Drops
      the longer interval, keeps the higher-resolution rows.

    * **Dataset precedence** (opt-in via ``precedence_col`` +
      ``precedence``) — when two overlapping rows come from different
      datasets / campaigns, drop the row from the lower-ranked dataset.
      Resolves the common case of two sampling campaigns (say 0.5 m and
      1 m intervals) interleaved over the same depths by rule instead of
      by hand.  Rows whose dataset isn't listed in ``precedence`` are
      never dropped this way.

    Anything else — same depth zone, materially different values, or
    partial overlaps — is left untouched and returned in the
    *conflicts* frame for human review.

    Parameters
    ----------
    table : pd.DataFrame
        Interval table.
    hole_col, from_col, to_col : str
        Column-name overrides (defaults from :mod:`baselode.datamodel`).
    value_cols : iterable of str, optional
        Columns to compare for duplicate / superset classification.
        Default: every column other than ``hole_col``/``from_col``/``to_col``.
    touching_tol : float, optional
        Maximum overlap, in metres, treated as a "snap me" rounding
        glitch.  Default ``0.01``.
    merge_tol : float, optional
        Maximum relative difference, per value column, allowed between
        a candidate superset interval and the length-weighted mean of
        its inner intervals.  Default ``0.05`` (5%).
    coverage_min : float, optional
        Minimum fraction of a candidate superset that must be covered by
        inner intervals before it qualifies as a "resampled superset".
        Default ``0.95``.
    precedence_col : str, optional
        Column identifying the dataset / campaign each row came from
        (e.g. ``project_id``).  Enables the dataset-precedence pass when
        given together with ``precedence``.
    precedence : iterable of str, optional
        Dataset values in priority order, highest first.  Where two rows
        from different listed datasets overlap, the row from the dataset
        that appears later in this list is dropped.
    return_diagnostics : bool, optional
        When ``True``, return ``(fixed, conflicts, report)``: the fixed
        table, the rows still in conflict, and an audit-log frame with
        one row per resolved overlap.  Default ``False`` (returns just
        the fixed table).

    Returns
    -------
    pd.DataFrame, or tuple of (pd.DataFrame, pd.DataFrame, pd.DataFrame)
        See ``return_diagnostics``.
    """
    empty_report = pd.DataFrame(columns=list(OVERLAP_REPORT_COLUMNS))

    if table.empty:
        if return_diagnostics:
            return table.copy(), table.iloc[0:0].copy(), empty_report
        return table.copy()

    required = {hole_col, from_col, to_col}
    if not required.issubset(table.columns):
        if return_diagnostics:
            return table.copy(), table.iloc[0:0].copy(), empty_report
        return table.copy()

    if value_cols is None:
        value_cols = [c for c in table.columns if c not in (hole_col, from_col, to_col)]
    else:
        value_cols = [c for c in value_cols if c in table.columns]

    work = table.copy().reset_index(drop=True)
    work[from_col] = pd.to_numeric(work[from_col], errors="coerce")
    work[to_col] = pd.to_numeric(work[to_col], errors="coerce")

    keep = pd.Series(True, index=work.index)
    report_rows = []

    def _emit(hole_id, kind, action, frm, to, note=""):
        report_rows.append({
            "hole_id": hole_id,
            "kind": kind,
            "action": action,
            "from": frm,
            "to": to,
            "note": note,
        })

    # ---- Pass 1: drop exact duplicates -------------------------------------
    dup_keys = [hole_col, from_col, to_col] + value_cols
    dup_keys = [k for k in dup_keys if k in work.columns]
    duplicated_mask = work.duplicated(subset=dup_keys, keep="first")
    for idx in work.index[duplicated_mask]:
        row = work.loc[idx]
        _emit(row[hole_col], "duplicate", "dropped", row[from_col], row[to_col])
    keep &= ~duplicated_mask

    # ---- Pass 2: snap touching overlaps ------------------------------------
    for hole_id, group in work.loc[keep].groupby(hole_col, sort=False):
        ordered = group.sort_values([from_col, to_col])
        prev_idx = None
        for idx in ordered.index:
            if prev_idx is None:
                prev_idx = idx
                continue
            a_to = float(work.at[prev_idx, to_col])
            b_from = float(work.at[idx, from_col])
            if a_to > b_from and (a_to - b_from) <= touching_tol:
                work.at[prev_idx, to_col] = b_from
                _emit(hole_id, "touching", "snapped",
                      float(work.at[prev_idx, from_col]), a_to,
                      f"{to_col}: {a_to} -> {b_from}")
            prev_idx = idx

    # ---- Pass 3: resampled supersets ---------------------------------------
    for hole_id, group in work.loc[keep].groupby(hole_col, sort=False):
        ordered_idxs = list(group.sort_values([from_col, to_col]).index)
        for outer_idx in ordered_idxs:
            if not keep[outer_idx]:
                continue
            outer_from = float(work.at[outer_idx, from_col])
            outer_to = float(work.at[outer_idx, to_col])
            outer_length = outer_to - outer_from
            if outer_length <= 0:
                continue
            inner_idxs = []
            for inner_idx in ordered_idxs:
                if inner_idx == outer_idx or not keep[inner_idx]:
                    continue
                inner_from = float(work.at[inner_idx, from_col])
                inner_to = float(work.at[inner_idx, to_col])
                if inner_from >= outer_from and inner_to <= outer_to and (
                    inner_from > outer_from or inner_to < outer_to
                ):
                    inner_idxs.append(inner_idx)
            if not inner_idxs:
                continue
            covered = sum(
                float(work.at[i, to_col]) - float(work.at[i, from_col])
                for i in inner_idxs
            )
            if covered / outer_length < coverage_min:
                continue
            if not _values_agree(outer_idx, inner_idxs, value_cols, work,
                                 from_col, to_col, merge_tol):
                continue
            keep[outer_idx] = False
            _emit(hole_id, "superset", "dropped",
                  outer_from, outer_to,
                  f"covered by {len(inner_idxs)} finer rows ({covered / outer_length:.0%})")

    # ---- Pass 3b: dataset precedence ----------------------------------------
    if precedence_col is not None and precedence and precedence_col in work.columns:
        rank = {str(value): position for position, value in enumerate(precedence)}

        def _rank(idx):
            value = work.at[idx, precedence_col]
            if pd.isna(value):
                return None
            return rank.get(str(value))

        for hole_id, group in work.loc[keep].groupby(hole_col, sort=False):
            ordered_idxs = list(group.sort_values([from_col, to_col]).index)
            for a_pos, a_idx in enumerate(ordered_idxs):
                if not keep[a_idx]:
                    continue
                a_rank = _rank(a_idx)
                if a_rank is None:
                    continue
                for b_idx in ordered_idxs[a_pos + 1:]:
                    if not keep[a_idx]:
                        break
                    if not keep[b_idx]:
                        continue
                    if float(work.at[b_idx, from_col]) >= float(work.at[a_idx, to_col]):
                        break
                    b_rank = _rank(b_idx)
                    if b_rank is None or b_rank == a_rank:
                        continue
                    loser_idx, winner_idx = (b_idx, a_idx) if b_rank > a_rank else (a_idx, b_idx)
                    keep[loser_idx] = False
                    _emit(hole_id, "precedence", "dropped",
                          float(work.at[loser_idx, from_col]), float(work.at[loser_idx, to_col]),
                          f"{precedence_col}={work.at[loser_idx, precedence_col]} yields to "
                          f"{work.at[winner_idx, precedence_col]}")

    # ---- Pass 4: surface remaining real conflicts --------------------------
    conflict_idx_set = []
    seen = set()
    for hole_id, group in work.loc[keep].groupby(hole_col, sort=False):
        ordered_idxs = list(group.sort_values([from_col, to_col]).index)
        for a_pos, a_idx in enumerate(ordered_idxs):
            a_from = float(work.at[a_idx, from_col])
            a_to = float(work.at[a_idx, to_col])
            for b_idx in ordered_idxs[a_pos + 1:]:
                b_from = float(work.at[b_idx, from_col])
                if b_from >= a_to:
                    break
                b_to = float(work.at[b_idx, to_col])
                if a_idx not in seen:
                    conflict_idx_set.append(a_idx)
                    seen.add(a_idx)
                if b_idx not in seen:
                    conflict_idx_set.append(b_idx)
                    seen.add(b_idx)
                _emit(hole_id, "conflict", "kept",
                      min(a_from, b_from), max(a_to, b_to),
                      "unresolved overlap")

    fixed = work.loc[keep].reset_index(drop=True)
    conflicts = work.loc[conflict_idx_set].reset_index(drop=True) if conflict_idx_set else work.iloc[0:0].copy()
    report = pd.DataFrame(report_rows, columns=list(OVERLAP_REPORT_COLUMNS))

    if return_diagnostics:
        return fixed, conflicts, report
    return fixed


def normalize_azimuth(survey, azimuth_col=AZIMUTH):
    """Wrap survey azimuths into ``[0, 360)``.

    Applies ``value mod 360`` to every numeric value in the azimuth
    column, which folds ``360`` to ``0``, brings negative values like
    ``-30`` to ``330``, and is idempotent for already-valid values.  NaNs
    and non-numeric cells are left untouched.

    Parameters
    ----------
    survey : pd.DataFrame
        Survey table.
    azimuth_col : str
        Azimuth column name (default :data:`baselode.datamodel.AZIMUTH`).

    Returns
    -------
    pd.DataFrame
        Copy of *survey* with the azimuth column wrapped.
    """
    if survey.empty or azimuth_col not in survey.columns:
        return survey.copy()
    out = survey.copy()
    numeric = pd.to_numeric(out[azimuth_col], errors="coerce")
    wrapped = numeric.mod(360.0)
    out[azimuth_col] = wrapped.where(numeric.notna(), out[azimuth_col])
    return out


BDL_STRATEGIES = ("half-mdl", "mdl", "zero", "nan")


def replace_below_detection_limit(
    df,
    columns=None,
    sentinel_factor=0.5,
    strategy=None,
    numeric_negative_sentinels=True,
):
    """Replace below-detection-limit (BDL) sentinels with imputed values.

    Handles two BDL conventions:

    - **String sentinels** like ``"<0.005"`` (common in lab CSV
      exports).  The numeric is parsed out and treated as the MDL.
    - **Numeric negative sentinels** like ``-0.005`` (common in legacy
      WAMEX / GSWA exports).  A value ``V < 0`` is treated as BDL with
      ``MDL = abs(V)``.  Set ``numeric_negative_sentinels=False`` to
      leave numeric negatives untouched (e.g. when they're real signed
      measurements).

    The replacement is controlled by ``strategy`` (preferred) or, for
    backward compatibility, ``sentinel_factor``:

    ============  ==============================  =================
    ``strategy``  Replacement                     Equivalent factor
    ============  ==============================  =================
    ``half-mdl``  ``MDL * 0.5``                   ``0.5``
    ``mdl``       ``MDL``                         ``1.0``
    ``zero``      ``0.0``                         ``0.0``
    ``nan``       ``NaN``                         —
    ============  ==============================  =================

    When ``strategy`` is omitted, falls back to
    ``sentinel_factor`` (default ``0.5`` = half-MDL) so existing
    callers stay green.

    Parameters
    ----------
    df : pd.DataFrame
        Source table.
    columns : iterable of str, optional
        Columns to scan.  Defaults to every numeric or string column.
    sentinel_factor : float
        Multiplier applied to the detection limit (default ``0.5``).
        Ignored if ``strategy`` is set.
    strategy : str, optional
        One of :data:`BDL_STRATEGIES`.  Takes precedence over
        ``sentinel_factor``.
    numeric_negative_sentinels : bool
        When ``True`` (default), values ``< 0`` in numeric columns are
        treated as BDL with MDL = ``abs(value)``.  Set to ``False`` to
        leave them alone.

    Returns
    -------
    pd.DataFrame
        Copy of *df* with BDL sentinels replaced.  Columns where any
        substitution happened are coerced via :func:`pandas.to_numeric`.
    """
    if df.empty:
        return df.copy()

    if strategy is not None:
        if strategy not in BDL_STRATEGIES:
            raise ValueError(
                f"Unknown strategy {strategy!r}; expected one of {BDL_STRATEGIES}"
            )

    def _imputed(mdl):
        if strategy == "half-mdl":
            return mdl * 0.5
        if strategy == "mdl":
            return mdl
        if strategy == "zero":
            return 0.0
        if strategy == "nan":
            return float("nan")
        return mdl * sentinel_factor

    out = df.copy()
    target_columns = list(columns) if columns is not None else [
        col for col in out.columns
        if pd.api.types.is_string_dtype(out[col])
        or pd.api.types.is_numeric_dtype(out[col])
    ]

    for col in target_columns:
        if col not in out.columns:
            continue
        column_data = out[col]
        any_replaced = False

        # --- String "<X" path -------------------------------------------------
        if pd.api.types.is_string_dtype(column_data):
            new_values = []
            for value in column_data:
                if isinstance(value, str):
                    match = _BDL_PATTERN.match(value)
                    if match is not None:
                        new_values.append(_imputed(abs(float(match.group(1)))))
                        any_replaced = True
                        continue
                new_values.append(value)
            if any_replaced:
                replaced = pd.Series(new_values, index=column_data.index)
                out[col] = pd.to_numeric(replaced, errors="coerce").combine_first(replaced)
            continue

        # --- Numeric negative path -------------------------------------------
        if numeric_negative_sentinels and pd.api.types.is_numeric_dtype(column_data):
            negatives = column_data < 0
            if negatives.any():
                mdl_series = column_data.where(negatives).abs()
                replacement = mdl_series.apply(_imputed) if strategy != "nan" else pd.Series(
                    float("nan"), index=column_data.index
                ).where(negatives)
                out[col] = column_data.where(~negatives, replacement)

    return out


def _to_float(value):
    """Coerce *value* to a float; return ``None`` for NaN or unparseable input.

    Allows the validator to keep its "never raises" contract when fed string
    columns (e.g. an azimuth column that came back as object dtype from a
    CSV with a stray header row).
    """
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if pd.isna(result):
        return None
    return result


def _numeric_view(table, *columns):
    """Return a copy of *table* with *columns* coerced to numeric (NaN on failure)."""
    out = table.copy()
    for col in columns:
        if col in out.columns:
            out[col] = pd.to_numeric(out[col], errors="coerce")
    return out


def _issue(check, severity, message, hole_id=None, table=None, row_index=None, fix=None):
    return {
        "check": check,
        "severity": severity,
        "hole_id": hole_id,
        "table": table,
        "row_index": row_index,
        "message": message,
        "fix": fix,
    }


def _build_max_depth_lookup(collar, hole_col, max_depth_col):
    if collar is None or collar.empty or max_depth_col not in collar.columns:
        return {}
    lookup = {}
    for _, row in collar.iterrows():
        hole_id = row.get(hole_col)
        if hole_id is None or pd.isna(hole_id):
            continue
        numeric_value = _to_float(row.get(max_depth_col))
        if numeric_value is None:
            continue
        lookup[hole_id] = numeric_value
    return lookup


def _check_duplicate_hole_ids(collar, hole_col):
    if collar.empty or hole_col not in collar.columns:
        return []
    counts = collar[hole_col].value_counts()
    duplicates = counts[counts > 1]
    return [
        _issue(
            check="duplicate_hole_ids",
            severity=SEVERITY_ERROR,
            hole_id=str(hole_id),
            table="collar",
            message=f"Hole '{hole_id}' appears {count} times in the collar table",
            fix="Remove or merge duplicate collar rows so each hole_id is unique",
        )
        for hole_id, count in duplicates.items()
    ]


def _usable_station_mask(survey, depth_col, azimuth_col, dip_col):
    """Boolean Series: True where depth, azimuth and dip are all finite numbers.

    This is exactly the row filter :mod:`baselode.drill.desurvey` applies,
    so "usable" here means "will contribute to a trace".
    """
    mask = pd.Series(True, index=survey.index)
    for col in (depth_col, azimuth_col, dip_col):
        if col not in survey.columns:
            return pd.Series(False, index=survey.index)
        numeric = pd.to_numeric(survey[col], errors="coerce")
        mask &= numeric.notna() & np.isfinite(numeric.fillna(0.0))
    return mask


def _check_survey_null_orientation(survey, hole_col, depth_col, azimuth_col, dip_col):
    """Error per survey row whose depth / azimuth / dip is null or non-numeric."""
    if survey.empty or hole_col not in survey.columns:
        return []
    columns = [col for col in (depth_col, azimuth_col, dip_col) if col in survey.columns]
    if not columns:
        return []
    issues = []
    for idx, row in survey.iterrows():
        missing = [col for col in columns if _to_float(row.get(col)) is None]
        if not missing:
            continue
        hole_id = row.get(hole_col)
        issues.append(_issue(
            check="survey_null_orientation",
            severity=SEVERITY_ERROR,
            hole_id=str(hole_id) if hole_id is not None and not pd.isna(hole_id) else None,
            table="survey",
            row_index=int(idx) if isinstance(idx, (int, np.integer)) else None,
            message=(
                f"Survey row for hole '{hole_id}' has no usable {' / '.join(missing)}; "
                "desurvey ignores this row"
            ),
            fix=(
                "Fill the value from the source survey, or call "
                "drop_unusable_survey_rows(survey); holes left without a station "
                "can be rebuilt with synthesise_collar_station(survey, collar)"
            ),
        ))
    return issues


def _check_survey_no_usable_stations(collar, survey, hole_col, depth_col, azimuth_col, dip_col):
    """Warning per hole that has no survey row desurvey can use.

    Covers both holes whose every survey row is unusable and collar holes
    with no survey rows at all — either way the hole silently drops out of
    the desurvey.  Skipped when the survey table is empty (nothing to
    compare against).
    """
    if survey.empty or hole_col not in survey.columns:
        return []
    usable = _usable_station_mask(survey, depth_col, azimuth_col, dip_col)
    survey_rows = survey[hole_col].dropna().value_counts()
    usable_rows = survey.loc[usable, hole_col].dropna().value_counts()

    candidate_holes = list(survey_rows.index)
    if collar is not None and not collar.empty and hole_col in collar.columns:
        seen = set(candidate_holes)
        for hole_id in collar[hole_col].dropna().unique():
            if hole_id not in seen:
                candidate_holes.append(hole_id)
                seen.add(hole_id)

    issues = []
    for hole_id in candidate_holes:
        if usable_rows.get(hole_id, 0) > 0:
            continue
        row_count = int(survey_rows.get(hole_id, 0))
        if row_count:
            message = (
                f"Hole '{hole_id}' has {row_count} survey row(s) but none with usable "
                "depth / azimuth / dip; it will be dropped by desurvey"
            )
        else:
            message = f"Hole '{hole_id}' has no survey rows; it will be dropped by desurvey"
        issues.append(_issue(
            check="survey_no_usable_stations",
            severity=SEVERITY_WARNING,
            hole_id=str(hole_id),
            table="survey",
            message=message,
            fix=(
                "Call synthesise_collar_station(survey, collar) to build a station at "
                "the collar from the collar azimuth/dip columns (vertical fallback)"
            ),
        ))
    return issues


def _check_single_station_surveys(survey, hole_col, depth_col, azimuth_col=AZIMUTH, dip_col=DIP):
    if survey.empty or hole_col not in survey.columns:
        return []
    usable = _usable_station_mask(survey, depth_col, azimuth_col, dip_col)
    issues = []
    for hole_id, group in survey[usable].groupby(hole_col):
        if len(group) == 1:
            issues.append(_issue(
                check="single_station_surveys",
                severity=SEVERITY_WARNING,
                hole_id=str(hole_id),
                table="survey",
                row_index=int(group.index[0]) if isinstance(group.index[0], (int, np.integer)) else None,
                message=f"Hole '{hole_id}' has only one usable survey station; desurvey will fail",
                fix="Call fix_single_station_surveys(survey, collar) to add a synthetic station",
            ))
    return issues


def _check_azimuth_range(survey, hole_col, depth_col, azimuth_col, allow_full_circle=False):
    if survey.empty or azimuth_col not in survey.columns:
        return []
    upper_bound_inclusive = bool(allow_full_circle)
    interval_text = "[0, 360]" if upper_bound_inclusive else "[0, 360)"
    issues = []
    for idx, row in survey.iterrows():
        numeric_value = _to_float(row.get(azimuth_col))
        if numeric_value is None:
            continue
        out_of_range = numeric_value < 0 or (
            numeric_value > 360 if upper_bound_inclusive else numeric_value >= 360
        )
        if out_of_range:
            issues.append(_issue(
                check="azimuth_range",
                severity=SEVERITY_ERROR,
                hole_id=str(row.get(hole_col)) if row.get(hole_col) is not None else None,
                table="survey",
                row_index=int(idx) if isinstance(idx, (int, np.integer)) else None,
                message=f"Azimuth {numeric_value} outside {interval_text}",
                fix="Call normalize_azimuth(survey) to wrap into [0, 360) or correct the source value",
            ))
    return issues


def _check_dip_range(survey, hole_col, depth_col, dip_col):
    if survey.empty or dip_col not in survey.columns:
        return []
    issues = []
    for idx, row in survey.iterrows():
        numeric_value = _to_float(row.get(dip_col))
        if numeric_value is None:
            continue
        if numeric_value < -90 or numeric_value > 90:
            issues.append(_issue(
                check="dip_range",
                severity=SEVERITY_ERROR,
                hole_id=str(row.get(hole_col)) if row.get(hole_col) is not None else None,
                table="survey",
                row_index=int(idx) if isinstance(idx, (int, np.integer)) else None,
                message=f"Dip {numeric_value} outside [-90, 90]",
                fix="Correct the source dip value",
            ))
    return issues


def _check_orphan_intervals(table, table_name, collar_hole_ids, hole_col):
    if table.empty or hole_col not in table.columns:
        return []
    issues = []
    for idx, row in table.iterrows():
        hole_id = row.get(hole_col)
        if hole_id is None or pd.isna(hole_id):
            continue
        if hole_id not in collar_hole_ids:
            issues.append(_issue(
                check="orphan_intervals",
                severity=SEVERITY_ERROR,
                hole_id=str(hole_id),
                table=table_name,
                row_index=int(idx) if isinstance(idx, (int, np.integer)) else None,
                message=f"Hole '{hole_id}' in '{table_name}' is not present in the collar table",
                fix="Call drop_orphan_intervals(table, collar) to remove these rows, or add the hole to the collar table",
            ))
    return issues


def _check_negative_lengths(table, table_name, hole_col, from_col, to_col):
    if table.empty or from_col not in table.columns or to_col not in table.columns:
        return []
    issues = []
    for idx, row in table.iterrows():
        from_depth = _to_float(row.get(from_col))
        to_depth = _to_float(row.get(to_col))
        if from_depth is None or to_depth is None:
            continue
        if to_depth <= from_depth:
            issues.append(_issue(
                check="negative_lengths",
                severity=SEVERITY_ERROR,
                hole_id=str(row.get(hole_col)) if row.get(hole_col) is not None else None,
                table=table_name,
                row_index=int(idx) if isinstance(idx, (int, np.integer)) else None,
                message=f"Interval from={from_depth} to={to_depth} has zero or negative length",
                fix=(
                    "Call swap_inverted_intervals(table) to fix data-entry typos where to<from; "
                    "zero-length rows (to==from) require manual review"
                ),
            ))
    return issues


def _check_intervals_beyond_max_depth(table, table_name, max_depth_lookup, hole_col, to_col):
    if not max_depth_lookup or table.empty or to_col not in table.columns:
        return []
    issues = []
    for idx, row in table.iterrows():
        hole_id = row.get(hole_col)
        if hole_id is None or pd.isna(hole_id):
            continue
        max_depth = max_depth_lookup.get(hole_id)
        if max_depth is None:
            continue
        to_depth = _to_float(row.get(to_col))
        if to_depth is None:
            continue
        if to_depth > max_depth:
            issues.append(_issue(
                check="intervals_beyond_max_depth",
                severity=SEVERITY_WARNING,
                hole_id=str(hole_id),
                table=table_name,
                row_index=int(idx) if isinstance(idx, (int, np.integer)) else None,
                message=f"Interval to={to_depth} exceeds collar max_depth={max_depth} for '{hole_id}'",
                fix="Extend collar max_depth or clip the interval",
            ))
    return issues


def _check_interval_gaps(table, table_name, hole_col, from_col, to_col):
    if table.empty:
        return []
    gaps = baselode.drill.intervals.detect_gaps(
        _numeric_view(table, from_col, to_col).dropna(subset=[from_col, to_col]),
        from_col=from_col, to_col=to_col, hole_col=hole_col,
    )
    return [
        _issue(
            check="interval_gaps",
            severity=SEVERITY_INFO,
            hole_id=str(row[hole_col]),
            table=table_name,
            message=f"Gap from {row[from_col]} to {row[to_col]} ({row['length']:.3f} m) in '{table_name}'",
            fix="Re-sample the interval or document the gap",
        )
        for _, row in gaps.iterrows()
    ]


def _check_interval_overlaps(table, table_name, hole_col, from_col, to_col):
    if table.empty:
        return []
    overlaps = baselode.drill.intervals.detect_overlaps(
        _numeric_view(table, from_col, to_col).dropna(subset=[from_col, to_col]),
        from_col=from_col, to_col=to_col, hole_col=hole_col,
    )
    return [
        _issue(
            check="interval_overlaps",
            severity=SEVERITY_WARNING,
            hole_id=str(row[hole_col]),
            table=table_name,
            row_index=int(row["first_index"]),
            message=(
                f"Overlap from {row[from_col]} to {row[to_col]} ({row['length']:.3f} m) "
                f"between rows {row['first_index']} and {row['second_index']}"
            ),
            fix="Merge overlapping intervals or correct the from/to depths",
        )
        for _, row in overlaps.iterrows()
    ]


def _check_below_detection_limit(table, table_name, hole_col, from_col, to_col):
    if table.empty:
        return []
    reserved = {hole_col, from_col, to_col}
    issues = []
    for col in table.columns:
        if col in reserved:
            continue
        if not pd.api.types.is_string_dtype(table[col]):
            continue
        for idx, value in table[col].items():
            if not isinstance(value, str):
                continue
            if _BDL_PATTERN.match(value) is None:
                continue
            issues.append(_issue(
                check="below_detection_limit",
                severity=SEVERITY_INFO,
                hole_id=str(table.at[idx, hole_col]) if hole_col in table.columns else None,
                table=table_name,
                row_index=int(idx) if isinstance(idx, (int, np.integer)) else None,
                message=f"Column '{col}' contains below-detection sentinel '{value}'",
                fix="Call replace_below_detection_limit(df, columns=[...]) to substitute MDL/2",
            ))
    return issues
