# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

"""Collar extrapolation and the Vulcan-style midpoint-tangent method.

Covers GitHub issue #96 items 5 and 6: every trace starts at md 0 using
the first station's orientation, and ``midpoint_tangential`` treats each
station as the midpoint of its straight segment.
"""

import math

import pandas as pd
import pytest

import baselode.drill.desurvey as desurvey
import baselode.drill.drillhole_set


ALL_METHODS = [
    desurvey.minimum_curvature_desurvey,
    desurvey.tangential_desurvey,
    desurvey.balanced_tangential_desurvey,
    desurvey.midpoint_tangential_desurvey,
]


def _collar(hole_id="A", easting=1000.0, northing=2000.0, elevation=300.0):
    return pd.DataFrame([{
        "hole_id": hole_id, "easting": easting, "northing": northing, "elevation": elevation,
    }])


def _survey(rows, hole_id="A"):
    return pd.DataFrame(
        [{"hole_id": hole_id, "depth": d, "azimuth": a, "dip": p} for d, a, p in rows]
    )


@pytest.mark.parametrize("method_fn", ALL_METHODS)
def test_single_deep_station_extends_to_collar(method_fn):
    """TRBC041-style hole: one station at 135 m used to give a zero-length trace."""
    traces = method_fn(_collar(), _survey([(135.0, 90.0, -60.0)]), step=5.0)

    assert traces["md"].iloc[0] == 0.0
    assert traces["md"].iloc[-1] == pytest.approx(135.0)
    if method_fn is not desurvey.midpoint_tangential_desurvey:
        assert len(traces) == 28  # md 0 plus 27 x 5 m steps
    first = traces.iloc[0]
    assert (first["easting"], first["northing"], first["elevation"]) == (1000.0, 2000.0, 300.0)
    toe = traces.iloc[-1]
    horizontal = 135.0 * math.cos(math.radians(60.0))
    assert toe["easting"] == pytest.approx(1000.0 + horizontal)
    assert toe["northing"] == pytest.approx(2000.0)
    assert toe["elevation"] == pytest.approx(300.0 - 135.0 * math.sin(math.radians(60.0)))
    assert (traces["azimuth"] == 90.0).all()
    assert (traces["dip"] == -60.0).all()


@pytest.mark.parametrize("method_fn", ALL_METHODS)
def test_first_station_below_collar_is_extrapolated_straight(method_fn):
    """The first station's orientation holds from md 0 down to that station."""
    traces = method_fn(
        _collar(), _survey([(10.0, 0.0, -90.0), (20.0, 90.0, -45.0)]), step=1.0,
    )
    assert traces["md"].iloc[0] == 0.0
    at_10 = traces[(traces["md"] - 10.0).abs() < 1e-9].iloc[0]
    assert at_10["easting"] == pytest.approx(1000.0)
    assert at_10["northing"] == pytest.approx(2000.0)
    assert at_10["elevation"] == pytest.approx(290.0)


@pytest.mark.parametrize("method_fn", ALL_METHODS)
def test_first_station_at_collar_is_unchanged(method_fn):
    traces = method_fn(_collar(), _survey([(0.0, 0.0, -90.0), (10.0, 0.0, -90.0)]), step=1.0)
    assert traces["md"].iloc[0] == 0.0
    assert len(traces) == 11
    assert (traces["md"] >= 0).all()


def test_midpoint_tangential_switches_orientation_halfway_between_stations():
    """Station 1 (vertical) applies to 0-25 m, station 2 (horizontal east) to 25-50 m."""
    survey = _survey([(0.0, 0.0, -90.0), (50.0, 90.0, 0.0)])
    traces = desurvey.midpoint_tangential_desurvey(_collar(), survey, step=5.0)

    at_25 = traces[(traces["md"] - 25.0).abs() < 1e-9].iloc[0]
    assert at_25["elevation"] == pytest.approx(275.0)
    assert at_25["easting"] == pytest.approx(1000.0)
    toe = traces.iloc[-1]
    assert toe["md"] == pytest.approx(50.0)
    assert toe["elevation"] == pytest.approx(275.0)
    assert toe["easting"] == pytest.approx(1025.0)
    # Recorded orientation is the segment's orientation, not an interpolation.
    assert (traces.loc[traces["md"] <= 25.0 + 1e-9, "dip"] == -90.0).all()
    assert (traces.loc[traces["md"] > 25.0 + 1e-9, "dip"] == 0.0).all()


def test_midpoint_tangential_differs_from_top_of_segment_tangential():
    survey = _survey([(0.0, 0.0, -90.0), (50.0, 90.0, 0.0)])
    top = desurvey.tangential_desurvey(_collar(), survey, step=5.0)
    mid = desurvey.midpoint_tangential_desurvey(_collar(), survey, step=5.0)
    # Top-of-segment tangential runs the whole 50 m vertically.
    assert top.iloc[-1]["elevation"] == pytest.approx(250.0)
    assert mid.iloc[-1]["elevation"] == pytest.approx(275.0)


def test_midpoint_tangential_three_stations_last_orientation_runs_to_end():
    survey = _survey([(0.0, 0.0, -90.0), (20.0, 0.0, -90.0), (40.0, 0.0, 0.0)])
    traces = desurvey.midpoint_tangential_desurvey(_collar(), survey, step=10.0)
    # Vertical from 0 to 30 (midpoint of 20/40), then horizontal north to 40.
    at_30 = traces[(traces["md"] - 30.0).abs() < 1e-9].iloc[0]
    assert at_30["elevation"] == pytest.approx(270.0)
    assert at_30["northing"] == pytest.approx(2000.0)
    toe = traces.iloc[-1]
    assert toe["elevation"] == pytest.approx(270.0)
    assert toe["northing"] == pytest.approx(2010.0)


def test_midpoint_tangential_matches_other_methods_on_straight_hole():
    survey = _survey([(0.0, 45.0, -60.0), (50.0, 45.0, -60.0), (100.0, 45.0, -60.0)])
    reference = desurvey.minimum_curvature_desurvey(_collar(), survey, step=10.0)
    mid = desurvey.midpoint_tangential_desurvey(_collar(), survey, step=10.0)
    # Stop short of the toe: md accumulates by repeated addition, so 100.0
    # can land a hair outside the trace range and interpolate to NaN.
    depths = [0.0, 25.0, 50.0, 75.0, 99.0]
    reference_at = desurvey.interpolate_trajectory(reference, depths)
    mid_at = desurvey.interpolate_trajectory(mid, depths)
    for axis in ("easting", "northing", "elevation"):
        assert reference_at[axis].to_numpy() == pytest.approx(mid_at[axis].to_numpy(), abs=1e-9)


def test_drillhole_set_exposes_midpoint_tangential():
    holes = baselode.drill.drillhole_set.DrillholeSet(
        _collar(), _survey([(0.0, 0.0, -90.0), (50.0, 90.0, 0.0)]),
    )
    traces = holes.desurvey(method="midpoint_tangential", step=5.0)
    assert traces.iloc[-1]["elevation"] == pytest.approx(275.0)
