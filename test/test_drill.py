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

import pandas as pd

from baselode.drill import data
from baselode.drill import desurvey, view


def _sample_collars_surveys():
    collars = pd.DataFrame({
        "hole_id": ["A"],
        "easting": [500000.0],
        "northing": [6900000.0],
        "elevation": [300.0],
    })
    surveys = pd.DataFrame({
        "hole_id": ["A", "A", "A"],
        "depth": [0.0, 50.0, 100.0],
        "azimuth": [0.0, 10.0, 20.0],
        "dip": [-60.0, -65.0, -70.0],
    })
    return collars, surveys


def test_desurvey_variants_return_traces():
    collars, surveys = _sample_collars_surveys()
    methods = [
        desurvey.minimum_curvature_desurvey,
        desurvey.tangential_desurvey,
        desurvey.balanced_tangential_desurvey,
        desurvey.build_traces,
    ]
    for fn in methods:
        traces = fn(collars, surveys, step=10.0)
        assert not traces.empty
        for col in ["hole_id", "md", "easting", "northing", "elevation", "azimuth", "dip"]:
            assert col in traces.columns


def test_attach_assay_positions_merges_midpoints():
    collars, surveys = _sample_collars_surveys()
    traces = desurvey.minimum_curvature_desurvey(collars, surveys, step=5.0)
    assays = pd.DataFrame({
        "hole_id": ["A", "A"],
        "from": [10.0, 40.0],
        "to": [20.0, 50.0],
        "grade": [1.2, 2.3],
    })
    merged = desurvey.attach_assay_positions(assays, traces)
    assert len(merged) == len(assays)
    assert merged["mid"].notna().all()
    for col in ["easting", "northing", "elevation"]:
        assert col in merged.columns


def test_compute_interval_points_builds_midpoints():
    df = pd.DataFrame({"from": [0, 10], "to": [10, 20], "grade": [1.0, 2.0]})
    pts = view.compute_interval_points(df, "grade")
    assert list(pts.columns) == ["z", "val", "from_val", "to_val", "err_plus", "err_minus"]
    assert pts.shape[0] == 2
    assert pts.iloc[0]["z"] > pts.iloc[1]["z"]


def test_plot_numeric_and_categorical_traces():
    df = pd.DataFrame({"from": [0, 10], "to": [10, 20], "grade": [1.0, 2.0], "lith": ["a", "b"]})
    num_fig = view.plot_numeric_trace(view.compute_interval_points(df, "grade"), "grade")
    cat_fig = view.plot_categorical_trace(view.compute_interval_points(df, "lith"), "lith")
    assert len(num_fig.data) == 1
    assert len(cat_fig.data) == 3


def test_plot_drillhole_trace_variants():
    df = pd.DataFrame({
        "hole_id": ["A", "A"],
        "from": [0, 10],
        "to": [10, 20],
        "grade": [1.0, 2.0],
        "lith": ["a", "b"],
    })
    fig_num = view.plot_drillhole_trace(df, value_col="grade")
    fig_cat = view.plot_drillhole_trace(df, value_col="lith", categorical_props={"lith"})
    assert len(fig_num.data) == 1
    assert len(fig_cat.data) == 3


def test_plot_drillhole_traces_multiple_tracks():
    df = pd.DataFrame({
        "hole_id": ["A", "A", "A"],
        "from": [0, 10, 20],
        "to": [10, 20, 30],
        "grade": [1.0, 2.0, 3.0],
        "density": [2.5, 2.6, 2.7],
    })
    fig = view.plot_drillhole_traces(df, hole_id="A", value_cols=["grade", "density"])
    assert len(fig.data) == 2


def test_plot_drillhole_traces_subplots_multi_hole():
    df = pd.DataFrame({
        "hole_id": ["A", "A", "B", "B"],
        "from": [0, 10, 0, 10],
        "to": [10, 20, 10, 20],
        "grade": [1.0, 2.0, 1.5, 1.6],
    })
    fig = view.plot_drillhole_traces_subplots(df, value_col="grade", hole_ids=["A", "B"])
    assert len(fig.data) == 2


def test_plot_strip_log_shapes():
    df = pd.DataFrame({"from": [0, 10], "to": [10, 20], "lithology": ["A", "B"]})
    fig = view.plot_strip_log(df)
    assert len(fig.layout.shapes) == 2


def test_load_geology_standardizes_common_fields():
    geology = pd.DataFrame({
        "HoleId": ["A", "A"],
        "FromDepth": [0.0, 10.0],
        "ToDepth": [10.0, 20.0],
        "Lith1": ["FG", "SBIF"],
        "GeologyComment": ["Granite", "Banded iron formation"],
    })
    loaded = data.load_geology(geology)
    assert "geology_code" in loaded.columns
    assert "geology_description" in loaded.columns
    assert loaded["mid"].tolist() == [5.0, 15.0]


def test_plot_geology_strip_log_shapes():
    geology = pd.DataFrame({
        "from": [0, 10],
        "to": [10, 20],
        "geology_code": ["FG", "SBIF"],
    })
    fig = view.plot_geology_strip_log(geology)
    assert len(fig.layout.shapes) == 2


def test_load_geology_rejects_overlapping_intervals():
    geology = pd.DataFrame({
        "HoleId": ["A", "A"],
        "FromDepth": [0.0, 9.5],
        "ToDepth": [10.0, 20.0],
        "Lith1": ["FG", "SBIF"],
    })
    try:
        data.load_geology(geology)
        assert False, "Expected overlap validation error"
    except ValueError as exc:
        assert "overlap" in str(exc).lower()


def test_load_geology_equal_from_to_expands_to_1mm():
    geology = pd.DataFrame({
        "HoleId": ["A"],
        "FromDepth": [10.1234],
        "ToDepth": [10.1234],
        "Lith1": ["FG"],
    })
    loaded = data.load_geology(geology)
    assert loaded.iloc[0]["from"] == 10.123
    assert loaded.iloc[0]["to"] == 10.124


def test_load_geology_overlap_check_uses_3dp():
    geology = pd.DataFrame({
        "HoleId": ["A", "A"],
        "FromDepth": [10.12349, 10.12351],
        "ToDepth": [10.12349, 12.0],
        "Lith1": ["FG", "SBIF"],
    })
    loaded = data.load_geology(geology)
    assert len(loaded) == 2


def test_load_assays_equal_from_to_expands_to_1mm():
    assays = pd.DataFrame({
        "hole_id": ["A"],
        "from": [20.0004],
        "to": [20.0004],
        "au_ppm": [1.0],
    })
    loaded = data.load_assays(assays, flat=True)
    assert loaded.iloc[0]["from"] == 20.0
    assert loaded.iloc[0]["to"] == 20.001


def test_load_assays_flat_false_flattens_long_format():
    assays_long = pd.DataFrame({
        "hole_id": ["A", "A", "A", "A"],
        "from": [0.0, 0.0, 10.0, 10.0],
        "to": [10.0, 10.0, 20.0, 20.0],
        "assay_code": ["au_ppm", "cu_ppm", "au_ppm", "cu_ppm"],
        "assay_value": [1.2, 300.0, 2.5, 500.0],
    })
    loaded = data.load_assays(assays_long, flat=False, keep_all=True)
    assert "au_ppm" in loaded.columns
    assert "cu_ppm" in loaded.columns
    assert loaded.shape[0] == 2


def test_load_geology_flat_false_flattens_long_format():
    geology_long = pd.DataFrame({
        "hole_id": ["A", "A", "A", "A"],
        "from": [0.0, 0.0, 10.0, 10.0],
        "to": [10.0, 10.0, 20.0, 20.0],
        "geology_code": ["lith1", "weath", "lith1", "weath"],
        "geology_description": ["FG", "OX", "SBIF", "FR"],
    })
    loaded = data.load_geology(geology_long, flat=False, keep_all=True)
    assert "lith1" in loaded.columns
    assert "weath" in loaded.columns
    assert loaded.shape[0] == 2


def test_plot_tadpole_log_shapes():
    df = pd.DataFrame({"md": [10, 20], "dip": [45, 60], "azimuth": [90, 180]})
    fig = view.plot_tadpole_log(df)
    assert len(fig.layout.shapes) == 2