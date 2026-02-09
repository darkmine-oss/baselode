"""Desurveying utilities using minimum curvature.

Outputs a trace table with x, y, z coordinates at chosen step size, plus
measured depth and azimuth/dip per vertex. This keeps dependencies to pandas
and numpy for easy portability.
"""

import math

import numpy as np
import pandas as pd

from . import data


def _deg_to_rad(angle):
    return math.radians(angle)


def _direction_cosines(azimuth, dip):
    az_rad = _deg_to_rad(azimuth)
    dip_rad = _deg_to_rad(dip)
    ca = math.cos(dip_rad) * math.sin(az_rad)
    cb = math.cos(dip_rad) * math.cos(az_rad)
    cc = math.sin(dip_rad) * -1
    return ca, cb, cc


def minimum_curvature_desurvey(collars, surveys, step=1.0, hole_id_col=None):
    collars = data._canonicalize_hole_id(data._frame(collars), hole_id_col=hole_id_col)
    surveys = data._canonicalize_hole_id(data._frame(surveys), hole_id_col=hole_id_col)
    alias_col = collars.attrs.get("hole_id_col", hole_id_col or "hole_id")
    if collars.empty or surveys.empty:
        return pd.DataFrame(columns=["hole_id", "md", "x", "y", "z", "azimuth", "dip"])

    traces = []
    for hole_id, collar in collars.groupby("hole_id"):
        collar_row = collar.iloc[0]
        hole_surveys = surveys[surveys["hole_id"] == hole_id].sort_values("from")
        if hole_surveys.empty:
            continue
        x, y, z = float(collar_row.get("x", 0)), float(collar_row.get("y", 0)), float(collar_row.get("z", 0))
        md_cursor = float(hole_surveys.iloc[0]["from"])
        az_prev = float(hole_surveys.iloc[0]["azimuth"])
        dip_prev = float(hole_surveys.iloc[0]["dip"])
        first_record = {"hole_id": hole_id, "md": md_cursor, "x": x, "y": y, "z": z, "azimuth": az_prev, "dip": dip_prev}
        if alias_col != "hole_id" and alias_col in collar_row:
            first_record[alias_col] = collar_row[alias_col]
        traces.append(first_record)

        for idx in range(len(hole_surveys) - 1):
            s0 = hole_surveys.iloc[idx]
            s1 = hole_surveys.iloc[idx + 1]
            md0 = float(s0["from"])
            md1 = float(s1["from"])
            delta_md = md1 - md0
            if delta_md <= 0:
                continue
            az0, dip0 = float(s0["azimuth"]), float(s0["dip"])
            az1, dip1 = float(s1["azimuth"]), float(s1["dip"])
            ca0, cb0, cc0 = _direction_cosines(az0, dip0)
            ca1, cb1, cc1 = _direction_cosines(az1, dip1)
            dogleg = math.acos(max(-1.0, min(1.0, ca0 * ca1 + cb0 * cb1 + cc0 * cc1)))
            rf = 1.0
            if dogleg > 1e-6:
                rf = 2 * math.tan(dogleg / 2) / dogleg

            segment_steps = max(1, int(math.ceil(delta_md / step)))
            md_increment = delta_md / segment_steps
            for _ in range(segment_steps):
                md_cursor += md_increment
                weight = (md_cursor - md0) / delta_md
                az_interp = az0 + weight * (az1 - az0)
                dip_interp = dip0 + weight * (dip1 - dip0)
                ca, cb, cc = _direction_cosines(az_interp, dip_interp)
                dx = 0.5 * delta_md * (ca0 + ca1) * rf / segment_steps
                dy = 0.5 * delta_md * (cb0 + cb1) * rf / segment_steps
                dz = 0.5 * delta_md * (cc0 + cc1) * rf / segment_steps
                x += dx
                y += dy
                z += dz
                record = {"hole_id": hole_id, "md": md_cursor, "x": x, "y": y, "z": z, "azimuth": az_interp, "dip": dip_interp}
                if alias_col != "hole_id" and alias_col in collar_row:
                    record[alias_col] = collar_row[alias_col]
                traces.append(record)
    out = pd.DataFrame(traces)
    out.attrs["hole_id_col"] = alias_col
    return out


def attach_assay_positions(assays, traces, hole_id_col=None):
    assays = data._canonicalize_hole_id(data._frame(assays), hole_id_col=hole_id_col)
    traces = data._canonicalize_hole_id(data._frame(traces), hole_id_col=hole_id_col)
    alias_col_raw = traces.attrs.get("hole_id_col", hole_id_col or "hole_id")
    alias_col = data.DEFAULT_COLUMN_MAP.get(str(alias_col_raw).lower().strip(), alias_col_raw)
    if assays.empty or traces.empty:
        return assays.copy()
    if alias_col not in traces.columns and "hole_id" in traces.columns:
        traces = traces.copy()
        traces[alias_col] = traces["hole_id"]
    if alias_col not in assays.columns and "hole_id" in assays.columns:
        assays = assays.copy()
        assays[alias_col] = assays["hole_id"]

    traces_sorted = traces.copy()
    traces_sorted["md"] = pd.to_numeric(traces_sorted["md"], errors="coerce")
    traces_sorted = traces_sorted[traces_sorted[alias_col].notna() & traces_sorted["md"].notna()]
    traces_sorted = traces_sorted.sort_values([alias_col, "md"], kind="mergesort").reset_index(drop=True)

    assays_sorted = assays.copy()
    assays_sorted["from"] = pd.to_numeric(assays_sorted["from"], errors="coerce")
    assays_sorted["to"] = pd.to_numeric(assays_sorted["to"], errors="coerce")
    assays_sorted = assays_sorted[assays_sorted[alias_col].notna()]
    assays_sorted = assays_sorted.sort_values([alias_col, "from", "to"], kind="mergesort")
    assays_sorted["mid_md"] = 0.5 * (assays_sorted["from"] + assays_sorted["to"])
    assays_sorted = assays_sorted[assays_sorted["mid_md"].notna()]

    merged_groups = []
    for hid, group in assays_sorted.groupby(alias_col, sort=False):
        tgroup = traces_sorted[traces_sorted[alias_col] == hid]
        if tgroup.empty:
            merged_groups.append(group)
            continue
        pos_cols = [c for c in ["md", "x", "y", "z", "azimuth", "dip"] if c in tgroup.columns]
        tgroup_use = tgroup[[alias_col] + pos_cols].sort_values("md", kind="mergesort")
        merged = pd.merge_asof(
            group.sort_values("mid_md", kind="mergesort"),
            tgroup_use,
            left_on="mid_md",
            right_on="md",
            by=alias_col,
            direction="nearest",
            suffixes=("", "_trace"),
        )
        drop_cols = [col for col in [f"{alias_col}_trace", "hole_id_trace"] if col in merged.columns]
        if drop_cols:
            merged = merged.drop(columns=drop_cols)
        merged_groups.append(merged)

    if not merged_groups:
        return assays_sorted
    return pd.concat(merged_groups, ignore_index=True)


def build_traces(collars, surveys, step=1.0, hole_id_col=None):
    return minimum_curvature_desurvey(collars=collars, surveys=surveys, step=step, hole_id_col=hole_id_col)
