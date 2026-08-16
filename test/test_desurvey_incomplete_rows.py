# SPDX-License-Identifier: GPL-3.0-or-later

import pandas as pd
import pandas.testing
import pytest

import baselode.drill.desurvey


DESURVEY_FUNCTIONS = [
    baselode.drill.desurvey.minimum_curvature_desurvey,
    baselode.drill.desurvey.tangential_desurvey,
    baselode.drill.desurvey.balanced_tangential_desurvey,
    baselode.drill.desurvey.build_traces,
]


@pytest.mark.parametrize("desurvey_function", DESURVEY_FUNCTIONS)
def test_desurvey_ignores_incomplete_rows_without_mutating_inputs(desurvey_function):
    collars = pd.DataFrame({
        "hole_id": ["valid", "no_elevation", "bad_easting", "missing_northing"],
        "easting": [500000.0, "500100", "not-a-number", 500300.0],
        "northing": [6900000.0, "6900100", 6900200.0, None],
        "elevation": [300.0, None, 320.0, 330.0],
    })
    surveys = pd.DataFrame({
        "hole_id": [
            "valid", "valid", "valid", "valid", "no_elevation", "no_elevation",
            "bad_easting", "bad_easting",
        ],
        "depth": [0.0, "invalid", 5.0, 10.0, "0", "10", 0.0, 10.0],
        "azimuth": [0.0, 5.0, float("inf"), 10.0, "0", "10", 0.0, 10.0],
        "dip": [-60.0, None, -62.5, -65.0, "-60", "-65", -60.0, -65.0],
    })
    original_collars = collars.copy(deep=True)
    original_surveys = surveys.copy(deep=True)

    traces = desurvey_function(collars, surveys, step=5.0)

    assert set(traces["hole_id"]) == {"valid", "no_elevation"}
    assert traces[["easting", "northing", "elevation", "azimuth", "dip"]].notna().all().all()
    no_elevation = traces[traces["hole_id"] == "no_elevation"].iloc[0]
    assert no_elevation["elevation"] == 0.0
    pandas.testing.assert_frame_equal(collars, original_collars)
    pandas.testing.assert_frame_equal(surveys, original_surveys)


def test_desurvey_returns_canonical_empty_frame_for_unusable_inputs():
    collars = pd.DataFrame({
        "hole_id": ["bad"],
        "easting": [None],
        "northing": [6900000.0],
    })
    surveys = pd.DataFrame({
        "hole_id": ["bad"],
        "depth": [0.0],
        "azimuth": [0.0],
        "dip": [-90.0],
    })

    traces = baselode.drill.desurvey.build_traces(collars, surveys)

    assert traces.empty
    assert traces.columns.tolist() == [
        "hole_id", "md", "easting", "northing", "elevation", "azimuth", "dip",
    ]


def test_desurvey_returns_empty_frame_when_required_columns_are_absent():
    collars = pd.DataFrame({"hole_id": ["A"], "easting": [500000.0]})
    surveys = pd.DataFrame({
        "hole_id": ["A"],
        "depth": [0.0],
        "azimuth": [0.0],
        "dip": [-90.0],
    })

    traces = baselode.drill.desurvey.build_traces(collars, surveys)

    assert traces.empty
    assert traces.columns.tolist() == [
        "hole_id", "md", "easting", "northing", "elevation", "azimuth", "dip",
    ]
