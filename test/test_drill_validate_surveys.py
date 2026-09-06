# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

"""Survey-usability checks and fixes (GitHub issue #96 items 3, 4 and 7).

Desurvey silently ignores survey rows with a null depth / azimuth / dip and
drops holes left without a usable station.  These tests pin the validator
checks that surface that, the fix helpers that repair it, and the
dataset-precedence rule on the overlap resolver.
"""

import pandas as pd

import baselode.drill.desurvey as desurvey
import baselode.drill.validate as validate


def _collar(rows, columns=("hole_id", "easting", "northing", "elevation", "max_depth")):
    return pd.DataFrame(rows, columns=list(columns))


def _survey(rows):
    return pd.DataFrame(rows, columns=["hole_id", "depth", "azimuth", "dip"])


def _checks_with(report, name):
    return [issue for issue in report["issues"] if issue["check"] == name]


# --------------------------------------------------------------- validation

def test_null_azimuth_or_dip_row_is_an_error_with_fix_recipe():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([
        ("A", 0.0, 0.0, -90.0),
        ("A", 50.0, None, -90.0),
        ("A", 100.0, 0.0, None),
    ])
    report = validate.validate_drillhole_db(collar, survey)
    issues = _checks_with(report, "survey_null_orientation")
    assert [issue["row_index"] for issue in issues] == [1, 2]
    assert {issue["severity"] for issue in issues} == {"error"}
    assert "azimuth" in issues[0]["message"]
    assert "dip" in issues[1]["message"]
    assert "drop_unusable_survey_rows" in issues[0]["fix"]
    assert "synthesise_collar_station" in issues[0]["fix"]
    # The hole still has a usable station, so it is not reported as unusable.
    assert _checks_with(report, "survey_no_usable_stations") == []


def test_non_numeric_depth_is_flagged_too():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([("A", "n/a", 0.0, -90.0), ("A", 10.0, 0.0, -90.0)])
    report = validate.validate_drillhole_db(collar, survey)
    issues = _checks_with(report, "survey_null_orientation")
    assert len(issues) == 1
    assert "depth" in issues[0]["message"]


def test_hole_whose_only_rows_are_unusable_gets_a_warning():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0), ("B", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([
        ("A", 0.0, 0.0, -90.0), ("A", 50.0, 0.0, -90.0),
        ("B", 0.0, None, None),
    ])
    report = validate.validate_drillhole_db(collar, survey)
    warnings = _checks_with(report, "survey_no_usable_stations")
    assert len(warnings) == 1
    assert warnings[0]["hole_id"] == "B"
    assert warnings[0]["severity"] == "warning"
    assert "1 survey row(s)" in warnings[0]["message"]
    assert "synthesise_collar_station" in warnings[0]["fix"]
    # Matches what desurvey actually does with this input.
    assert set(desurvey.build_traces(collar, survey)["hole_id"]) == {"A"}


def test_collar_hole_with_no_survey_rows_gets_a_warning():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0), ("C", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([("A", 0.0, 0.0, -90.0), ("A", 50.0, 0.0, -90.0)])
    report = validate.validate_drillhole_db(collar, survey)
    warnings = _checks_with(report, "survey_no_usable_stations")
    assert [w["hole_id"] for w in warnings] == ["C"]
    assert "no survey rows" in warnings[0]["message"]


def test_no_usable_station_check_skipped_when_survey_table_is_empty():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([])
    report = validate.validate_drillhole_db(collar, survey)
    assert _checks_with(report, "survey_no_usable_stations") == []


def test_single_station_check_counts_only_usable_rows():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([("A", 0.0, 0.0, -90.0), ("A", 50.0, None, -90.0)])
    report = validate.validate_drillhole_db(collar, survey)
    single = _checks_with(report, "single_station_surveys")
    assert len(single) == 1
    assert single[0]["row_index"] == 0


# ------------------------------------------------------------- fix helpers

def test_drop_unusable_survey_rows_removes_null_and_non_numeric():
    survey = _survey([
        ("A", 0.0, 0.0, -90.0),
        ("A", 50.0, None, -90.0),
        ("A", "bad", 0.0, -90.0),
        ("B", 0.0, 10.0, "x"),
    ])
    out = validate.drop_unusable_survey_rows(survey)
    assert len(out) == 1
    assert out.iloc[0]["hole_id"] == "A"
    assert list(out.index) == [0]
    assert len(survey) == 4  # input untouched


def test_synthesise_collar_station_uses_collar_orientation():
    collar = _collar(
        [("A", 0.0, 0.0, 0.0, 100.0, 45.0, -60.0), ("B", 0.0, 0.0, 0.0, 80.0, 90.0, -70.0)],
        columns=("hole_id", "easting", "northing", "elevation", "max_depth", "azimuth", "dip"),
    )
    survey = _survey([
        ("A", 0.0, 0.0, -90.0), ("A", 50.0, 0.0, -90.0),
        ("B", 30.0, None, None),
    ])
    out, report = validate.synthesise_collar_station(survey, collar, return_diagnostics=True)

    assert report == {
        "holes_synthesised": 1,
        "from_collar": 1,
        "vertical_fallback": 0,
        "vertical_fallback_holes": [],
        "rows_dropped": 1,
    }
    b_rows = out[out["hole_id"] == "B"]
    assert len(b_rows) == 1
    assert b_rows.iloc[0][["depth", "azimuth", "dip"]].tolist() == [0.0, 90.0, -70.0]
    # Hole A untouched.
    assert len(out[out["hole_id"] == "A"]) == 2
    assert list(out.columns) == ["hole_id", "depth", "azimuth", "dip"]


def test_synthesise_collar_station_falls_back_to_vertical_and_reports_it():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0), ("B", 0.0, 0.0, 0.0, 80.0)])
    survey = _survey([("A", 0.0, 0.0, -90.0), ("A", 50.0, 0.0, -90.0)])
    out, report = validate.synthesise_collar_station(survey, collar, return_diagnostics=True)
    assert report["holes_synthesised"] == 1
    assert report["vertical_fallback"] == 1
    assert report["vertical_fallback_holes"] == ["B"]
    b_row = out[out["hole_id"] == "B"].iloc[0]
    assert (b_row["depth"], b_row["azimuth"], b_row["dip"]) == (0.0, 0.0, -90.0)


def test_synthesise_collar_station_matches_collar_columns_case_insensitively():
    collar = _collar(
        [("B", 0.0, 0.0, 0.0, 80.0, 120.0, -55.0)],
        columns=("hole_id", "easting", "northing", "elevation", "max_depth", "Azimuth", "DIP"),
    )
    survey = _survey([])
    out = validate.synthesise_collar_station(survey, collar)
    assert out.iloc[0][["azimuth", "dip"]].tolist() == [120.0, -55.0]


def test_synthesise_collar_station_returns_plain_frame_by_default():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0)])
    out = validate.synthesise_collar_station(_survey([]), collar)
    assert isinstance(out, pd.DataFrame)
    assert len(out) == 1


def test_synthesise_then_pad_produces_full_length_trace():
    """The end-to-end recipe the fix skill applies for a hole with no usable survey."""
    collar = _collar(
        [("B", 100.0, 200.0, 50.0, 80.0, 90.0, -60.0)],
        columns=("hole_id", "easting", "northing", "elevation", "max_depth", "azimuth", "dip"),
    )
    survey = _survey([("B", 40.0, None, None)])
    assert desurvey.build_traces(collar, survey).empty

    fixed = validate.synthesise_collar_station(survey, collar)
    fixed = validate.fix_single_station_surveys(fixed, collar)
    assert fixed["depth"].tolist() == [0.0, 80.0]
    traces = desurvey.build_traces(collar, fixed)
    assert traces["md"].iloc[-1] == 80.0
    assert validate.validate_drillhole_db(collar, fixed)["summary"] == {"error": 0, "warning": 0, "info": 0}


def test_fix_single_station_surveys_ignores_unusable_rows_when_counting():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([("A", 0.0, 0.0, -90.0), ("A", 50.0, None, -90.0)])
    out = validate.fix_single_station_surveys(survey, collar)
    assert out["depth"].tolist() == [0.0, 50.0, 100.0]


# ------------------------------------------------------- overlap precedence

def _assays(rows):
    return pd.DataFrame(rows, columns=["hole_id", "from", "to", "au_ppm", "project_id"])


def test_fix_overlaps_precedence_drops_lower_ranked_dataset_where_it_overlaps():
    table = _assays([
        ("A", 0.0, 1.0, 1.0, "campaign_1m"),
        ("A", 1.0, 2.0, 2.0, "campaign_1m"),
        ("A", 2.0, 3.0, 3.0, "campaign_1m"),      # no 0.5 m coverage: kept
        ("A", 0.0, 0.5, 0.9, "campaign_0.5m"),
        ("A", 0.5, 1.0, 5.0, "campaign_0.5m"),    # mean 2.95 vs 1.0: not a superset match
        ("A", 1.0, 1.5, 2.1, "campaign_0.5m"),
        ("A", 1.5, 2.0, 7.0, "campaign_0.5m"),
    ])
    fixed, conflicts, report = validate.fix_overlaps(
        table,
        precedence_col="project_id",
        precedence=["campaign_0.5m", "campaign_1m"],
        return_diagnostics=True,
    )
    assert conflicts.empty
    assert fixed["project_id"].tolist() == ["campaign_1m"] + ["campaign_0.5m"] * 4
    assert fixed[fixed["project_id"] == "campaign_1m"]["from"].tolist() == [2.0]
    dropped = report[report["kind"] == "precedence"]
    assert len(dropped) == 2
    assert dropped["action"].eq("dropped").all()
    assert "project_id=campaign_1m yields to campaign_0.5m" in dropped["note"].iloc[0]


def test_fix_overlaps_precedence_ignores_unlisted_datasets():
    table = _assays([
        ("A", 0.0, 1.0, 1.0, "campaign_1m"),
        ("A", 0.0, 0.5, 9.0, "other"),
    ])
    fixed, conflicts, _ = validate.fix_overlaps(
        table, precedence_col="project_id", precedence=["campaign_1m"], return_diagnostics=True,
    )
    assert len(fixed) == 2
    assert len(conflicts) == 2


def test_fix_overlaps_without_precedence_leaves_campaign_conflicts():
    table = _assays([
        ("A", 0.0, 1.0, 1.0, "campaign_1m"),
        ("A", 0.0, 0.5, 9.0, "campaign_0.5m"),
    ])
    fixed, conflicts, _ = validate.fix_overlaps(table, return_diagnostics=True)
    assert len(fixed) == 2
    assert len(conflicts) == 2
