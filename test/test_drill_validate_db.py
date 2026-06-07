# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

import pandas as pd

import baselode.drill.validate as validate


def _collar(rows):
    return pd.DataFrame(rows, columns=["hole_id", "easting", "northing", "elevation", "max_depth"])


def _survey(rows):
    return pd.DataFrame(rows, columns=["hole_id", "depth", "azimuth", "dip"])


def _assays(rows):
    return pd.DataFrame(rows, columns=["hole_id", "from", "to", "au_ppm"])


def _checks_with(report, name):
    return [issue for issue in report["issues"] if issue["check"] == name]


def test_clean_db_reports_no_issues():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([
        ("A", 0.0, 0.0, -90.0),
        ("A", 50.0, 0.0, -90.0),
    ])
    assays = _assays([("A", 0.0, 1.0, 0.1), ("A", 1.0, 2.0, 0.2)])
    report = validate.validate_drillhole_db(collar, survey, {"assay": assays})
    assert report["summary"] == {"error": 0, "warning": 0, "info": 0}
    assert report["issues"] == []


def test_duplicate_hole_ids_in_collar_flagged_as_error():
    collar = _collar([
        ("A", 0.0, 0.0, 0.0, 100.0),
        ("A", 0.0, 0.0, 0.0, 100.0),
    ])
    survey = _survey([("A", 0.0, 0.0, -90.0), ("A", 100.0, 0.0, -90.0)])
    report = validate.validate_drillhole_db(collar, survey)
    issues = _checks_with(report, "duplicate_hole_ids")
    assert len(issues) == 1
    assert issues[0]["severity"] == "error"
    assert issues[0]["hole_id"] == "A"


def test_single_station_survey_flagged_with_fix_recipe():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([("A", 0.0, 0.0, -90.0)])
    report = validate.validate_drillhole_db(collar, survey)
    issues = _checks_with(report, "single_station_surveys")
    assert len(issues) == 1
    assert issues[0]["severity"] == "warning"
    assert "fix_single_station_surveys" in issues[0]["fix"]


def test_azimuth_out_of_range_flagged():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([
        ("A", 0.0, 400.0, -90.0),
        ("A", 100.0, 0.0, -90.0),
    ])
    report = validate.validate_drillhole_db(collar, survey)
    assert _checks_with(report, "azimuth_range")[0]["severity"] == "error"


def test_azimuth_360_flagged_by_default():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([
        ("A", 0.0, 360.0, -90.0),
        ("A", 100.0, 0.0, -90.0),
    ])
    report = validate.validate_drillhole_db(collar, survey)
    issues = _checks_with(report, "azimuth_range")
    assert len(issues) == 1
    assert "normalize_azimuth" in issues[0]["fix"]


def test_azimuth_360_accepted_when_full_circle_allowed():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([
        ("A", 0.0, 360.0, -90.0),
        ("A", 100.0, 0.0, -90.0),
    ])
    report = validate.validate_drillhole_db(collar, survey, allow_full_circle=True)
    assert _checks_with(report, "azimuth_range") == []


def test_azimuth_above_360_still_flagged_when_full_circle_allowed():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([
        ("A", 0.0, 360.1, -90.0),
        ("A", 100.0, 0.0, -90.0),
    ])
    report = validate.validate_drillhole_db(collar, survey, allow_full_circle=True)
    assert len(_checks_with(report, "azimuth_range")) == 1


def test_dip_out_of_range_flagged():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([
        ("A", 0.0, 0.0, -100.0),
        ("A", 100.0, 0.0, -90.0),
    ])
    report = validate.validate_drillhole_db(collar, survey)
    assert _checks_with(report, "dip_range")[0]["severity"] == "error"


def test_orphan_intervals_flagged():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([("A", 0.0, 0.0, -90.0), ("A", 100.0, 0.0, -90.0)])
    assays = _assays([("B", 0.0, 1.0, 0.1)])
    report = validate.validate_drillhole_db(collar, survey, {"assay": assays})
    issues = _checks_with(report, "orphan_intervals")
    assert len(issues) == 1
    assert issues[0]["severity"] == "error"
    assert issues[0]["hole_id"] == "B"
    assert issues[0]["table"] == "assay"


def test_negative_lengths_flagged():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([("A", 0.0, 0.0, -90.0), ("A", 100.0, 0.0, -90.0)])
    assays = _assays([("A", 5.0, 2.0, 0.1)])
    report = validate.validate_drillhole_db(collar, survey, {"assay": assays})
    issues = _checks_with(report, "negative_lengths")
    assert len(issues) == 1
    assert issues[0]["severity"] == "error"


def test_intervals_beyond_max_depth_flagged():
    collar = _collar([("A", 0.0, 0.0, 0.0, 10.0)])
    survey = _survey([("A", 0.0, 0.0, -90.0), ("A", 10.0, 0.0, -90.0)])
    assays = _assays([("A", 0.0, 15.0, 0.1)])
    report = validate.validate_drillhole_db(collar, survey, {"assay": assays})
    issues = _checks_with(report, "intervals_beyond_max_depth")
    assert len(issues) == 1
    assert issues[0]["severity"] == "warning"


def test_interval_overlaps_flagged():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([("A", 0.0, 0.0, -90.0), ("A", 100.0, 0.0, -90.0)])
    assays = _assays([
        ("A", 0.0, 5.0, 0.1),
        ("A", 3.0, 7.0, 0.2),
    ])
    report = validate.validate_drillhole_db(collar, survey, {"assay": assays})
    issues = _checks_with(report, "interval_overlaps")
    assert len(issues) == 1
    assert issues[0]["severity"] == "warning"


def test_interval_gaps_flagged_as_info():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([("A", 0.0, 0.0, -90.0), ("A", 100.0, 0.0, -90.0)])
    assays = _assays([
        ("A", 0.0, 1.0, 0.1),
        ("A", 5.0, 6.0, 0.2),
    ])
    report = validate.validate_drillhole_db(collar, survey, {"assay": assays})
    issues = _checks_with(report, "interval_gaps")
    assert len(issues) == 1
    assert issues[0]["severity"] == "info"


def test_below_detection_limit_flagged_as_info():
    collar = _collar([("A", 0.0, 0.0, 0.0, 100.0)])
    survey = _survey([("A", 0.0, 0.0, -90.0), ("A", 100.0, 0.0, -90.0)])
    assays = pd.DataFrame({
        "hole_id": ["A"],
        "from": [0.0],
        "to": [1.0],
        "au_ppm": ["<0.005"],
    })
    report = validate.validate_drillhole_db(collar, survey, {"assay": assays})
    issues = _checks_with(report, "below_detection_limit")
    assert len(issues) == 1
    assert issues[0]["severity"] == "info"


def test_fix_single_station_surveys_uses_max_depth_when_available():
    collar = _collar([("A", 0.0, 0.0, 0.0, 250.0)])
    survey = _survey([("A", 0.0, 45.0, -60.0)])
    fixed = validate.fix_single_station_surveys(survey, collar)
    assert len(fixed) == 2
    assert list(fixed["depth"]) == [0.0, 250.0]
    assert list(fixed["azimuth"]) == [45.0, 45.0]
    assert list(fixed["dip"]) == [-60.0, -60.0]


def test_fix_single_station_surveys_falls_back_when_no_max_depth():
    survey = _survey([("A", 12.0, 45.0, -60.0)])
    fixed = validate.fix_single_station_surveys(survey)
    assert len(fixed) == 2
    assert list(fixed["depth"]) == [12.0, 13.0]


def test_fix_single_station_surveys_leaves_multi_station_holes_alone():
    survey = _survey([
        ("A", 0.0, 0.0, -90.0),
        ("A", 50.0, 0.0, -90.0),
        ("B", 0.0, 0.0, -90.0),
    ])
    fixed = validate.fix_single_station_surveys(survey)
    assert len(fixed) == 4
    assert sorted(fixed[fixed["hole_id"] == "A"]["depth"].tolist()) == [0.0, 50.0]
    assert sorted(fixed[fixed["hole_id"] == "B"]["depth"].tolist()) == [0.0, 1.0]


def test_normalize_azimuth_wraps_360_to_0():
    survey = _survey([("A", 0.0, 360.0, -90.0), ("A", 100.0, 0.0, -90.0)])
    fixed = validate.normalize_azimuth(survey)
    assert list(fixed["azimuth"]) == [0.0, 0.0]


def test_normalize_azimuth_wraps_negative_and_above_360():
    survey = _survey([
        ("A", 0.0, -30.0, -90.0),
        ("A", 50.0, 450.0, -90.0),
        ("A", 100.0, 180.0, -90.0),
    ])
    fixed = validate.normalize_azimuth(survey)
    assert list(fixed["azimuth"]) == [330.0, 90.0, 180.0]


def test_normalize_azimuth_leaves_nan_untouched():
    survey = pd.DataFrame({"hole_id": ["A"], "depth": [0.0], "azimuth": [float("nan")], "dip": [-90.0]})
    fixed = validate.normalize_azimuth(survey)
    assert pd.isna(fixed["azimuth"].iloc[0])


def test_replace_below_detection_limit_substitutes_half_mdl():
    df = pd.DataFrame({
        "hole_id": ["A", "A", "A"],
        "from": [0.0, 1.0, 2.0],
        "to": [1.0, 2.0, 3.0],
        "au_ppm": ["<0.005", "0.012", "<0.02"],
    })
    out = validate.replace_below_detection_limit(df, columns=["au_ppm"])
    assert list(out["au_ppm"]) == [0.0025, 0.012, 0.01]


def test_replace_below_detection_limit_respects_custom_factor():
    df = pd.DataFrame({"au_ppm": ["<0.01"]})
    out = validate.replace_below_detection_limit(df, columns=["au_ppm"], sentinel_factor=1.0)
    assert list(out["au_ppm"]) == [0.01]


def test_summary_counts_match_issue_severities():
    collar = _collar([
        ("A", 0.0, 0.0, 0.0, 100.0),
        ("A", 0.0, 0.0, 0.0, 100.0),
    ])
    survey = _survey([("A", 0.0, 400.0, -90.0)])
    assays = _assays([("Z", 5.0, 2.0, 0.1)])
    report = validate.validate_drillhole_db(collar, survey, {"assay": assays})
    counts = report["summary"]
    assert counts["error"] >= 3
    assert counts["warning"] >= 1
    assert counts["error"] + counts["warning"] + counts["info"] == len(report["issues"])
