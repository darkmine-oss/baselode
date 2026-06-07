# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

"""Open Mining Format (OMF v1) interop for baselode drilling primitives.

Round-trip helpers between baselode's DataFrame-based drilling tables and
Open Mining Format v1 line/point elements.  OMF is the de-facto open
mining exchange format (MIT-licensed, Global Mining Guidelines Group),
read/written by Leapfrog, 3DEXPERIENCE, Deswik and Micromine, so making
baselode OMF-native plugs it directly into those workflows.

This module requires the optional ``omf`` dependency:

    pip install baselode[omf]

Each entry point raises a clear :class:`ImportError` with the install
instruction when the package is missing.

API
---

- :func:`collars_to_omf_points` — collar table → ``PointSetElement``.
- :func:`traces_to_omf_lines` — desurveyed traces → ``LineSetElement``
  with one segment per trace step and a per-segment ``hole_id``.
- :func:`intervals_to_omf_lines` — interval table (e.g. assay, geology)
  → ``LineSetElement`` with one segment per interval, endpoints
  interpolated from the trace and value columns attached as per-segment
  attributes.
- :func:`build_omf_project` — build a Project wrapper around a list of
  elements.
- :func:`write_omf` / :func:`read_omf` — round-trip helpers.
"""

import numpy as np
import pandas as pd

from baselode.datamodel import (
    EASTING, ELEVATION, FROM, HOLE_ID, NORTHING, TO,
)

try:
    import omf as _omf
except ImportError:
    _omf = None


def _require_omf():
    if _omf is None:
        raise ImportError(
            "OMF support requires the optional 'omf' package. "
            "Install it via: pip install baselode[omf]"
        )


def collars_to_omf_points(
    collars,
    name="collars",
    hole_col=HOLE_ID,
    easting_col=EASTING,
    northing_col=NORTHING,
    elevation_col=ELEVATION,
    attribute_cols=None,
):
    """Convert a collar table to an OMF :class:`PointSetElement`.

    Each row becomes one vertex at ``(easting, northing, elevation)``.
    The ``hole_id`` column is attached as a per-vertex
    :class:`StringData`.  Any extra columns listed in *attribute_cols*
    are attached as :class:`ScalarData` (numeric) or :class:`StringData`
    (object dtype).

    Parameters
    ----------
    collars : pd.DataFrame
        Collar table.  Rows with missing easting / northing / elevation
        are dropped.
    name : str
        OMF element name (default ``"collars"``).
    hole_col, easting_col, northing_col, elevation_col : str
        Column-name overrides (defaults from :mod:`baselode.datamodel`).
    attribute_cols : iterable of str, optional
        Extra columns to attach as per-vertex data.

    Returns
    -------
    omf.PointSetElement
    """
    _require_omf()
    required = [easting_col, northing_col, elevation_col]
    valid = collars.dropna(subset=required)
    if valid.empty:
        raise ValueError(
            "No collars have complete easting / northing / elevation — nothing to write."
        )
    vertices = valid[required].to_numpy(dtype=float)
    geometry = _omf.PointSetGeometry(vertices=vertices)

    data = []
    if hole_col in valid.columns:
        data.append(_omf.StringData(
            name=hole_col,
            array=[str(value) for value in valid[hole_col].tolist()],
            location="vertices",
        ))
    for col in attribute_cols or []:
        if col not in valid.columns:
            continue
        data.append(_column_to_data(valid[col], col, "vertices"))

    return _omf.PointSetElement(name=name, geometry=geometry, data=data)


def traces_to_omf_lines(
    traces,
    name="traces",
    hole_col=HOLE_ID,
    easting_col=EASTING,
    northing_col=NORTHING,
    elevation_col=ELEVATION,
    md_col="md",
):
    """Convert desurveyed traces to a single OMF :class:`LineSetElement`.

    Each hole contributes a sequence of segments connecting consecutive
    trace samples.  Holes are concatenated into one element with a
    per-segment ``hole_id`` :class:`StringData` so they're individually
    selectable downstream without forcing a 4 000-element project.

    Parameters
    ----------
    traces : pd.DataFrame
        Desurveyed trace table (e.g. from
        ``baselode.drill.desurvey.minimum_curvature_desurvey``).
    name : str
        OMF element name (default ``"traces"``).
    hole_col, easting_col, northing_col, elevation_col, md_col : str
        Column-name overrides.

    Returns
    -------
    omf.LineSetElement
    """
    _require_omf()
    vertices = []
    segments = []
    segment_hole_ids = []

    for hole_id, group in traces.groupby(hole_col):
        ordered = group.sort_values(md_col).dropna(
            subset=[md_col, easting_col, northing_col, elevation_col]
        )
        xyz = ordered[[easting_col, northing_col, elevation_col]].to_numpy(dtype=float)
        if len(xyz) < 2:
            continue
        base_index = len(vertices)
        vertices.extend(xyz.tolist())
        for offset in range(len(xyz) - 1):
            segments.append([base_index + offset, base_index + offset + 1])
            segment_hole_ids.append(str(hole_id))

    if not segments:
        raise ValueError("No hole has at least two trace samples — nothing to write.")

    geometry = _omf.LineSetGeometry(
        vertices=np.array(vertices, dtype=float),
        segments=np.array(segments, dtype=int),
    )
    data = [_omf.StringData(
        name=hole_col, array=segment_hole_ids, location="segments",
    )]
    return _omf.LineSetElement(name=name, geometry=geometry, data=data)


def intervals_to_omf_lines(
    intervals,
    traces,
    name,
    value_cols=None,
    hole_col=HOLE_ID,
    from_col=FROM,
    to_col=TO,
    easting_col=EASTING,
    northing_col=NORTHING,
    elevation_col=ELEVATION,
    md_col="md",
):
    """Convert an interval table to a single OMF :class:`LineSetElement`.

    Each interval row becomes one OMF segment whose endpoints are the
    trace's ``(easting, northing, elevation)`` interpolated at the
    interval's *from_col* and *to_col* depths.  Value columns become
    per-segment :class:`ScalarData` (numeric) or :class:`StringData`
    (categorical); ``hole_id`` is always attached.

    Parameters
    ----------
    intervals : pd.DataFrame
        Interval table (e.g. assay, geology).  Rows whose hole isn't in
        *traces* are skipped silently.
    traces : pd.DataFrame
        Desurveyed trace table.
    name : str
        OMF element name (typically the interval-table label, e.g.
        ``"assay"``).
    value_cols : iterable of str, optional
        Columns to attach as per-segment data.  ``None`` skips value
        attachment (segments still carry ``hole_id``).
    hole_col, from_col, to_col, easting_col, northing_col, elevation_col, md_col : str
        Column-name overrides.

    Returns
    -------
    omf.LineSetElement
    """
    _require_omf()
    vertices = []
    segments = []
    rows_used = []

    trace_groups = {
        hole_id: group.sort_values(md_col).dropna(
            subset=[md_col, easting_col, northing_col, elevation_col]
        )
        for hole_id, group in traces.groupby(hole_col)
    }

    for hole_id, group in intervals.groupby(hole_col):
        trace_sorted = trace_groups.get(hole_id)
        if trace_sorted is None or len(trace_sorted) < 2:
            continue
        mds = trace_sorted[md_col].to_numpy(dtype=float)
        eastings = trace_sorted[easting_col].to_numpy(dtype=float)
        northings = trace_sorted[northing_col].to_numpy(dtype=float)
        elevations = trace_sorted[elevation_col].to_numpy(dtype=float)

        for original_index, row in group.iterrows():
            from_depth = _safe_float(row.get(from_col))
            to_depth = _safe_float(row.get(to_col))
            if from_depth is None or to_depth is None:
                continue
            start_xyz = (
                float(np.interp(from_depth, mds, eastings)),
                float(np.interp(from_depth, mds, northings)),
                float(np.interp(from_depth, mds, elevations)),
            )
            end_xyz = (
                float(np.interp(to_depth, mds, eastings)),
                float(np.interp(to_depth, mds, northings)),
                float(np.interp(to_depth, mds, elevations)),
            )
            base_index = len(vertices)
            vertices.append(start_xyz)
            vertices.append(end_xyz)
            segments.append([base_index, base_index + 1])
            rows_used.append(original_index)

    if not segments:
        raise ValueError(
            f"No intervals in '{name}' could be located on the trace — nothing to write."
        )

    geometry = _omf.LineSetGeometry(
        vertices=np.array(vertices, dtype=float),
        segments=np.array(segments, dtype=int),
    )

    used_intervals = intervals.loc[rows_used]
    data = [_omf.StringData(
        name=hole_col,
        array=[str(value) for value in used_intervals[hole_col].tolist()],
        location="segments",
    )]
    for col in value_cols or []:
        if col not in used_intervals.columns:
            continue
        data.append(_column_to_data(used_intervals[col], col, "segments"))

    return _omf.LineSetElement(name=name, geometry=geometry, data=data)


def build_omf_project(name, author, description, elements):
    """Wrap a list of OMF elements in a :class:`omf.Project`."""
    _require_omf()
    return _omf.Project(
        name=name,
        author=author,
        description=description,
        elements=list(elements),
    )


def write_omf(project_or_elements, path, name="baselode", author="baselode", description=""):
    """Write an OMF file from a :class:`omf.Project` or list of elements.

    Parameters
    ----------
    project_or_elements : omf.Project or iterable of OMF elements
        Source data.  Lists are wrapped via :func:`build_omf_project`
        with the *name* / *author* / *description* arguments.
    path : str or pathlib.Path
        Output ``.omf`` path.

    Returns
    -------
    omf.Project
        The project that was actually serialised.
    """
    _require_omf()
    if isinstance(project_or_elements, _omf.Project):
        project = project_or_elements
    else:
        project = build_omf_project(name, author, description, project_or_elements)
    _omf.OMFWriter(project, str(path))
    return project


def read_omf(path):
    """Load an OMF file into a :class:`omf.Project`."""
    _require_omf()
    return _omf.OMFReader(str(path)).get_project()


def _column_to_data(series, name, location):
    """Wrap a pandas Series in the appropriate OMF data type."""
    if pd.api.types.is_numeric_dtype(series):
        return _omf.ScalarData(
            name=name,
            array=series.to_numpy(dtype=float),
            location=location,
        )
    return _omf.StringData(
        name=name,
        array=[str(value) if value is not None and not _is_na(value) else "" for value in series.tolist()],
        location=location,
    )


def _safe_float(value):
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


def _is_na(value):
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False
