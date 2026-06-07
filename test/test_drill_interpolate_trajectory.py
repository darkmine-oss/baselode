# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

import math

import numpy as np
import pandas as pd
import pytest

import baselode.drill.desurvey as desurvey


def _vertical_trace():
    """Vertical hole, 0..100 m, 1 m step, collar at (500000, 6900000, 300)."""
    mds = np.arange(0.0, 100.5, 1.0)
    return pd.DataFrame({
        "hole_id": ["A"] * len(mds),
        "md": mds,
        "easting": [500000.0] * len(mds),
        "northing": [6900000.0] * len(mds),
        "elevation": [300.0 + md for md in mds],  # baselode TVD-positive convention
        "azimuth": [0.0] * len(mds),
        "dip": [-90.0] * len(mds),
    })


def _two_hole_traces():
    return pd.concat([
        _vertical_trace(),
        _vertical_trace().assign(
            hole_id="B",
            easting=600000.0,
            northing=6800000.0,
        ),
    ], ignore_index=True)


def test_depth_at_exact_station_returns_station_value():
    traces = _vertical_trace()
    result = desurvey.interpolate_trajectory(traces, {"A": [0.0, 50.0, 100.0]})
    assert len(result) == 3
    assert list(result["depth"]) == [0.0, 50.0, 100.0]
    assert list(result["elevation"]) == [300.0, 350.0, 400.0]
    assert list(result["easting"]) == [500000.0] * 3
    assert list(result["dip"]) == [-90.0] * 3


def test_depth_between_stations_interpolates_monotonically():
    traces = _vertical_trace()
    result = desurvey.interpolate_trajectory(traces, {"A": [0.0, 25.0, 50.0, 75.0]})
    elevations = result["elevation"].tolist()
    # Monotonic increase
    assert elevations == sorted(elevations)
    # Linear midpoint = average of bracketing stations
    assert math.isclose(elevations[1], 325.0, abs_tol=1e-9)
    assert math.isclose(elevations[3], 375.0, abs_tol=1e-9)


def test_out_of_range_depth_returns_nan():
    traces = _vertical_trace()
    result = desurvey.interpolate_trajectory(traces, {"A": [-5.0, 150.0]})
    assert len(result) == 2
    assert all(np.isnan(result["easting"]))
    assert all(np.isnan(result["northing"]))
    assert all(np.isnan(result["elevation"]))


def test_unknown_hole_returns_nan_row():
    traces = _vertical_trace()
    result = desurvey.interpolate_trajectory(traces, {"B": [25.0]})
    assert len(result) == 1
    assert result.iloc[0]["hole_id"] == "B"
    assert math.isnan(result.iloc[0]["elevation"])


def test_per_hole_dict_independent_holes():
    traces = _two_hole_traces()
    result = desurvey.interpolate_trajectory(
        traces, {"A": [25.0], "B": [50.0]},
    )
    assert len(result) == 2
    by_hole = {row["hole_id"]: row for _, row in result.iterrows()}
    assert by_hole["A"]["easting"] == 500000.0
    assert by_hole["B"]["easting"] == 600000.0


def test_broadcast_list_applies_to_every_hole_in_traces():
    traces = _two_hole_traces()
    result = desurvey.interpolate_trajectory(traces, [25.0, 75.0])
    assert len(result) == 4
    assert set(result["hole_id"]) == {"A", "B"}
    assert sorted(result["depth"].unique().tolist()) == [25.0, 75.0]


def test_broadcast_scalar_applies_to_every_hole():
    traces = _two_hole_traces()
    result = desurvey.interpolate_trajectory(traces, 30.0)
    assert len(result) == 2
    assert all(result["depth"] == 30.0)


def test_dataframe_input_form():
    traces = _vertical_trace()
    depths = pd.DataFrame({"hole_id": ["A", "A"], "depth": [10.0, 20.0]})
    result = desurvey.interpolate_trajectory(traces, depths)
    assert list(result["depth"]) == [10.0, 20.0]
    assert list(result["elevation"]) == [310.0, 320.0]


def test_dataframe_input_requires_hole_id_and_depth_columns():
    traces = _vertical_trace()
    bad = pd.DataFrame({"hole_id": ["A"], "downhole": [10.0]})
    with pytest.raises(ValueError, match="hole_id"):
        desurvey.interpolate_trajectory(traces, bad)


def test_empty_request_returns_empty_dataframe_with_expected_columns():
    traces = _vertical_trace()
    result = desurvey.interpolate_trajectory(traces, {})
    assert result.empty
    expected_cols = {"hole_id", "depth", "easting", "northing", "elevation", "azimuth", "dip"}
    assert expected_cols.issubset(set(result.columns))


def test_deviated_hole_x_y_change_with_depth():
    """Hole at azimuth 045° dip -45° — both N and E should grow with md."""
    mds = np.arange(0.0, 100.5, 1.0)
    horizontal = math.cos(math.radians(45.0))
    vertical = math.sin(math.radians(45.0))
    azimuth_rad = math.radians(45.0)
    eastings = [500000.0 + md * horizontal * math.sin(azimuth_rad) for md in mds]
    northings = [6900000.0 + md * horizontal * math.cos(azimuth_rad) for md in mds]
    elevations = [300.0 + md * vertical for md in mds]
    traces = pd.DataFrame({
        "hole_id": ["A"] * len(mds),
        "md": mds,
        "easting": eastings,
        "northing": northings,
        "elevation": elevations,
        "azimuth": [45.0] * len(mds),
        "dip": [-45.0] * len(mds),
    })

    result = desurvey.interpolate_trajectory(traces, {"A": [50.0]})
    expected_horizontal = 50.0 * horizontal
    expected_easting = 500000.0 + expected_horizontal * math.sin(azimuth_rad)
    expected_northing = 6900000.0 + expected_horizontal * math.cos(azimuth_rad)
    expected_elevation = 300.0 + 50.0 * vertical
    row = result.iloc[0]
    assert math.isclose(row["easting"], expected_easting, abs_tol=1e-9)
    assert math.isclose(row["northing"], expected_northing, abs_tol=1e-9)
    assert math.isclose(row["elevation"], expected_elevation, abs_tol=1e-9)
