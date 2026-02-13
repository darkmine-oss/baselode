# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

"""Top-level mapping helpers for plan and section workflows.

This module provides stable entry points that wrap the lower-level drill
projection helpers, so users can import map-oriented functions from
`baselode.map` directly.
"""

from .drill.view_2d import plan_view, section_view, project_trace_to_section, section_window


def map_collar_points(collars, color_by=None):
    """Prepare collar points for 2D map plotting.

    Parameters
    ----------
    collars : pandas.DataFrame
        Collar table expected to contain x/y (or equivalent preprocessed fields).
    color_by : str, optional
        Column name to expose as `color_value` for plotting.

    Returns
    -------
    pandas.DataFrame
        Copy of collars with optional color field.
    """
    if collars is None or collars.empty:
        return collars.copy() if collars is not None else collars

    out = collars.copy()
    if color_by is not None and color_by in out.columns:
        out["color_value"] = out[color_by]
    return out


__all__ = [
    "map_collar_points",
    "plan_view",
    "section_view",
    "project_trace_to_section",
    "section_window",
]
