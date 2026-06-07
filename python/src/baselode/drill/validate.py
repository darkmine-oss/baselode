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
    issues.extend(_check_single_station_surveys(survey, hole_col, depth_col))
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
    new_rows = []
    for hole_id, group in survey.groupby(hole_col):
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


def replace_below_detection_limit(df, columns=None, sentinel_factor=0.5):
    """Replace ``<MDL`` strings with ``MDL * sentinel_factor``.

    The industry convention is to substitute below-detection-limit assay
    values (e.g. ``"<0.005"``) with half the reported limit when running
    statistics.  This helper detects strings matching ``<NUMBER`` and
    rewrites the cell to a float; other values are left untouched.

    Parameters
    ----------
    df : pd.DataFrame
        Source table.
    columns : iterable of str, optional
        Columns to scan.  Defaults to every column whose dtype is
        ``object`` (i.e. potentially contains strings).
    sentinel_factor : float
        Multiplier applied to the detection limit (default ``0.5`` —
        half-MDL).

    Returns
    -------
    pd.DataFrame
        Copy of *df* with BDL strings replaced; columns where any
        substitution happened are coerced to numeric via
        :func:`pandas.to_numeric` (``errors='ignore'``).
    """
    if df.empty:
        return df.copy()

    out = df.copy()
    target_columns = list(columns) if columns is not None else [
        col for col in out.columns if pd.api.types.is_string_dtype(out[col])
    ]

    for col in target_columns:
        if col not in out.columns:
            continue
        column_data = out[col]
        if not pd.api.types.is_string_dtype(column_data):
            continue
        new_values = []
        any_replaced = False
        for value in column_data:
            if isinstance(value, str):
                match = _BDL_PATTERN.match(value)
                if match is not None:
                    new_values.append(float(match.group(1)) * sentinel_factor)
                    any_replaced = True
                    continue
            new_values.append(value)
        if any_replaced:
            replaced = pd.Series(new_values, index=column_data.index)
            out[col] = pd.to_numeric(replaced, errors="coerce").combine_first(replaced)
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
        value = row.get(max_depth_col)
        if hole_id is None or pd.isna(hole_id):
            continue
        if value is None or pd.isna(value):
            continue
        lookup[hole_id] = float(value)
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


def _check_single_station_surveys(survey, hole_col, depth_col):
    if survey.empty or hole_col not in survey.columns:
        return []
    issues = []
    for hole_id, group in survey.groupby(hole_col):
        if len(group) == 1:
            issues.append(_issue(
                check="single_station_surveys",
                severity=SEVERITY_WARNING,
                hole_id=str(hole_id),
                table="survey",
                row_index=int(group.index[0]) if isinstance(group.index[0], (int, np.integer)) else None,
                message=f"Hole '{hole_id}' has only one survey station; desurvey will fail",
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
        value = row.get(azimuth_col)
        if value is None or pd.isna(value):
            continue
        out_of_range = value < 0 or (value > 360 if upper_bound_inclusive else value >= 360)
        if out_of_range:
            issues.append(_issue(
                check="azimuth_range",
                severity=SEVERITY_ERROR,
                hole_id=str(row.get(hole_col)) if row.get(hole_col) is not None else None,
                table="survey",
                row_index=int(idx) if isinstance(idx, (int, np.integer)) else None,
                message=f"Azimuth {value} outside {interval_text}",
                fix="Call normalize_azimuth(survey) to wrap into [0, 360) or correct the source value",
            ))
    return issues


def _check_dip_range(survey, hole_col, depth_col, dip_col):
    if survey.empty or dip_col not in survey.columns:
        return []
    issues = []
    for idx, row in survey.iterrows():
        value = row.get(dip_col)
        if value is None or pd.isna(value):
            continue
        if value < -90 or value > 90:
            issues.append(_issue(
                check="dip_range",
                severity=SEVERITY_ERROR,
                hole_id=str(row.get(hole_col)) if row.get(hole_col) is not None else None,
                table="survey",
                row_index=int(idx) if isinstance(idx, (int, np.integer)) else None,
                message=f"Dip {value} outside [-90, 90]",
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
        from_depth = row.get(from_col)
        to_depth = row.get(to_col)
        if from_depth is None or to_depth is None or pd.isna(from_depth) or pd.isna(to_depth):
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
        to_depth = row.get(to_col)
        if to_depth is None or pd.isna(to_depth):
            continue
        if float(to_depth) > max_depth:
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
        table, from_col=from_col, to_col=to_col, hole_col=hole_col,
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
        table, from_col=from_col, to_col=to_col, hole_col=hole_col,
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
