# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

import importlib.util
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import baselode.drill.omf as omf_io

HAS_OMF = importlib.util.find_spec("omf") is not None
omf_only = pytest.mark.skipif(not HAS_OMF, reason="omf optional extra not installed")
omf_pkg = __import__("omf") if HAS_OMF else None


def _sample_collars():
    return pd.DataFrame({
        "hole_id": ["A", "B"],
        "easting": [500000.0, 500100.0],
        "northing": [6900000.0, 6900050.0],
        "elevation": [300.0, 305.0],
        "max_depth": [100.0, 80.0],
    })


def _sample_traces():
    holes = []
    for hole_id, easting, northing in [("A", 500000.0, 6900000.0), ("B", 500100.0, 6900050.0)]:
        mds = np.arange(0.0, 101.0, 10.0)
        for md in mds:
            holes.append({
                "hole_id": hole_id,
                "md": md,
                "easting": easting,
                "northing": northing,
                "elevation": 300.0 - md,
                "azimuth": 0.0,
                "dip": -90.0,
            })
    return pd.DataFrame(holes)


def _sample_assays():
    return pd.DataFrame({
        "hole_id": ["A", "A", "B"],
        "from": [0.0, 10.0, 20.0],
        "to": [10.0, 20.0, 30.0],
        "au_ppm": [0.10, 0.25, 0.05],
        "lithology": ["granite", "schist", "granite"],
    })


@omf_only
def test_collars_to_omf_points_builds_pointset():
    element = omf_io.collars_to_omf_points(_sample_collars())
    assert isinstance(element, omf_pkg.PointSetElement)
    assert element.geometry.vertices.array.shape == (2, 3)
    data_names = [data.name for data in element.data]
    assert "hole_id" in data_names


@omf_only
def test_collars_to_omf_points_includes_attribute_cols():
    element = omf_io.collars_to_omf_points(_sample_collars(), attribute_cols=["max_depth"])
    data_names = [data.name for data in element.data]
    assert "max_depth" in data_names


@omf_only
def test_collars_to_omf_points_drops_missing_xyz():
    collars = _sample_collars()
    collars.loc[1, "easting"] = np.nan
    element = omf_io.collars_to_omf_points(collars)
    assert element.geometry.vertices.array.shape == (1, 3)


@omf_only
def test_collars_to_omf_points_raises_when_no_rows_have_xyz():
    collars = _sample_collars()
    collars["easting"] = np.nan
    with pytest.raises(ValueError, match="nothing to write"):
        omf_io.collars_to_omf_points(collars)


@omf_only
def test_traces_to_omf_lines_concatenates_holes_with_per_segment_hole_id():
    element = omf_io.traces_to_omf_lines(_sample_traces())
    assert isinstance(element, omf_pkg.LineSetElement)
    vertices = element.geometry.vertices.array
    segments = element.geometry.segments.array
    assert vertices.shape[1] == 3
    assert segments.shape[1] == 2

    hole_id_data = next(data for data in element.data if data.name == "hole_id")
    segment_holes = list(hole_id_data.array.array)
    assert "A" in segment_holes and "B" in segment_holes
    assert len(segment_holes) == len(segments)


@omf_only
def test_traces_to_omf_lines_skips_holes_with_a_single_sample():
    traces = _sample_traces()
    single_sample = pd.DataFrame([{
        "hole_id": "C", "md": 0.0,
        "easting": 0.0, "northing": 0.0, "elevation": 0.0,
        "azimuth": 0.0, "dip": -90.0,
    }])
    element = omf_io.traces_to_omf_lines(pd.concat([traces, single_sample], ignore_index=True))
    segment_holes = list(next(data for data in element.data if data.name == "hole_id").array.array)
    assert "C" not in segment_holes


@omf_only
def test_traces_to_omf_lines_drops_rows_with_nan_xyz_or_md():
    traces = _sample_traces()
    traces.loc[0, "easting"] = np.nan  # one row in hole A
    traces.loc[len(traces) - 1, "md"] = np.nan  # last row in hole B
    element = omf_io.traces_to_omf_lines(traces)
    vertices = element.geometry.vertices.array
    assert not np.isnan(vertices).any()


@omf_only
def test_intervals_to_omf_lines_attaches_value_columns():
    element = omf_io.intervals_to_omf_lines(
        _sample_assays(), _sample_traces(), name="assay", value_cols=["au_ppm", "lithology"],
    )
    assert isinstance(element, omf_pkg.LineSetElement)
    assert element.geometry.segments.array.shape == (3, 2)
    data_names = [data.name for data in element.data]
    assert "hole_id" in data_names
    assert "au_ppm" in data_names
    assert "lithology" in data_names


@omf_only
def test_intervals_to_omf_lines_skips_intervals_with_missing_from_or_to():
    intervals = _sample_assays()
    intervals.loc[1, "from"] = np.nan
    element = omf_io.intervals_to_omf_lines(intervals, _sample_traces(), name="assay")
    assert element.geometry.segments.array.shape == (2, 2)


@omf_only
def test_intervals_to_omf_lines_skips_intervals_whose_trace_has_nan_xyz():
    traces = _sample_traces()
    traces.loc[traces["hole_id"] == "A", "easting"] = np.nan
    element = omf_io.intervals_to_omf_lines(_sample_assays(), traces, name="assay")
    vertices = element.geometry.vertices.array
    assert not np.isnan(vertices).any()
    assert element.geometry.segments.array.shape == (1, 2)


@omf_only
def test_intervals_to_omf_lines_raises_when_nothing_locatable():
    intervals = pd.DataFrame({
        "hole_id": ["Z"], "from": [0.0], "to": [1.0], "au_ppm": [0.1],
    })
    with pytest.raises(ValueError, match="nothing to write"):
        omf_io.intervals_to_omf_lines(intervals, _sample_traces(), name="assay")


@omf_only
def test_traces_to_omf_lines_raises_when_no_two_sample_holes():
    traces = pd.DataFrame([{
        "hole_id": "A", "md": 0.0,
        "easting": 0.0, "northing": 0.0, "elevation": 0.0,
        "azimuth": 0.0, "dip": -90.0,
    }])
    with pytest.raises(ValueError, match="nothing to write"):
        omf_io.traces_to_omf_lines(traces)


@omf_only
def test_write_and_read_round_trip_via_tempfile():
    with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / "round-trip.omf"
        elements = [
            omf_io.collars_to_omf_points(_sample_collars()),
            omf_io.traces_to_omf_lines(_sample_traces()),
            omf_io.intervals_to_omf_lines(
                _sample_assays(), _sample_traces(),
                name="assay", value_cols=["au_ppm"],
            ),
        ]
        omf_io.write_omf(elements, path, name="round-trip", author="agent", description="test")
        assert path.exists()
        project = omf_io.read_omf(path)
        element_names = [element.name for element in project.elements]
        assert "collars" in element_names
        assert "traces" in element_names
        assert "assay" in element_names


@omf_only
def test_write_omf_accepts_project_directly():
    project = omf_io.build_omf_project(
        "manual", "agent", "manual project",
        [omf_io.collars_to_omf_points(_sample_collars())],
    )
    with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / "from-project.omf"
        result = omf_io.write_omf(project, path)
        assert result is project
        assert path.exists()


def test_module_raises_without_omf(monkeypatch):
    monkeypatch.setattr(omf_io, "_omf", None)
    with pytest.raises(ImportError, match="pip install baselode\\[omf\\]"):
        omf_io.collars_to_omf_points(_sample_collars())
    with pytest.raises(ImportError, match="pip install baselode\\[omf\\]"):
        omf_io.traces_to_omf_lines(_sample_traces())
    with pytest.raises(ImportError, match="pip install baselode\\[omf\\]"):
        omf_io.read_omf("nowhere.omf")
