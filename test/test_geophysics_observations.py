# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Analytical survey-QC outcomes and portable immutable observation records."""
import copy
import json
import pathlib

import pytest

import baselode.geophysics
import baselode.geophysics.observations

ROOT = pathlib.Path(__file__).resolve().parents[1]


def survey():
    records = [{"id": f"r{i}", "x": i * 5, "y": 0, "time": i, "line_id": "L1", "clearance": 30,
                "values": {"mag": value}} for i, value in enumerate([10, 10, 10, 100, 10, 10, 10])]
    records += [
        {"id": "gap", "x": 500, "y": 0, "time": 50, "line_id": "L1", "clearance": 5, "values": {"mag": 10}},
        {"id": "reverse", "x": 505, "y": 0, "time": 49, "line_id": "L1", "clearance": 30, "values": {"mag": 10}},
        {"id": "dropout", "x": None, "y": 0, "time": 50, "line_id": "L1", "clearance": 30, "values": {"mag": None}},
        {"id": "after", "x": 510, "y": 0, "time": 51, "line_id": "L1", "clearance": 30, "values": {"mag": 10}},
    ]
    records += [{"id": f"base{i}", "station_id": "BASE", "x": 100, "y": 200, "time": 100 + 10 * i,
                 "line_id": "L2", "clearance": 30, "values": {"mag": value}} for i, value in enumerate([10, 12, 14])]
    records += [{"id": "other", "x": 1000, "y": 1000, "time": 130, "line_id": "L3", "clearance": 30, "values": {"mag": 10}},
                {"id": "return", "x": 10, "y": 0, "time": 2, "line_id": "L1", "clearance": 30, "values": {"mag": 10}}]
    return {"records": records, "channels": {"mag": {"field_type": "magnetic_total_field", "units": "nT"}}, "crs_units": "m",
            "metadata": {"height_units": "m", "height_datum": "measured AGL", "corrections": {"diurnal": "applied", "igrf": "unknown"}}}


def options():
    return {"max_speed": 4, "max_distance_gap": 20, "max_time_gap": 10, "min_clearance": 20, "spike_thresholds": {"mag": 20}}


def test_known_speed_spike_gaps_dropouts_and_station_statistics():
    payload = survey()
    original = copy.deepcopy(payload)
    report = baselode.geophysics.qc_observations(payload, options())
    assert report["state"] == "needs_input"  # missing spatial fix on the dropout
    assert payload == original
    flags = report["flags"]
    assert [item["id"] for item in flags if item["code"] == "spike_candidate"] == ["r3"]
    assert [item["speed"] for item in flags if item["code"] == "high_speed"] == [5] * 6
    assert any(item["id"] == "reverse" and item["code"] == "non_increasing_time" for item in flags)
    assert any(item["id"] == "gap" and item["code"] == "time_gap" and item["seconds"] == 44 for item in flags)
    assert any(item["id"] == "gap" and item["code"] == "distance_gap" and item["distance"] == 470 for item in flags)
    assert any(item["id"] == "gap" and item["code"] == "low_clearance" for item in flags)
    assert any(item["id"] == "dropout" and item["code"] == "missing_value" for item in flags)
    assert report["coincident_locations"] == [[2, 15], [11, 12, 13]]
    assert report["repeats"][0]["same_location"] is True
    stats = report["repeats"][0]["channels"]["mag"]
    assert stats == {"count": 3, "mean": 12, "min": 10, "max": 14, "range": 4, "sample_std": 2}
    assert report["summary"]["corrections"] == payload["metadata"]["corrections"]
    assert report["segments"][-1]["start"] == 15  # no reconnecting noncontiguous L1
    assert report["coverage"]["spike_windows"] == 3
    assert report["flags_truncated"] is False


def test_creation_is_independent_idempotent_and_lossless_for_declared_values():
    payload = survey()
    payload["records"][0]["extra"] = {"operator": "α"}
    normalized = baselode.geophysics.create_observations(payload)
    assert normalized == baselode.geophysics.create_observations(json.loads(json.dumps(normalized)))
    assert normalized["records"][9]["x"] is None
    assert normalized["records"][0]["station_id"] is None
    normalized["records"][0]["extra"]["operator"] = "changed"
    normalized["metadata"]["corrections"]["diurnal"] = "unapplied"
    assert payload["records"][0]["extra"]["operator"] == "α"
    assert payload["metadata"]["corrections"]["diurnal"] == "applied"


def test_empty_singleton_and_unknown_line_context():
    payload = survey()
    payload["records"] = []
    assert baselode.geophysics.qc_observations(payload)["state"] == "ok"
    payload["records"] = [survey()["records"][0]]
    assert baselode.geophysics.qc_observations(payload)["state"] == "ok"
    assert baselode.geophysics.qc_observations(payload, {"max_speed": 5})["state"] == "needs_input"
    payload["records"] = survey()["records"][:7]
    for row in payload["records"]:
        row.pop("line_id")
    report = baselode.geophysics.qc_observations(payload, {"max_time_gap": 5, "spike_thresholds": {"mag": 5}})
    assert report["state"] == "needs_input" and report["edges"] == []
    assert len(report["segments"]) == 7
    assert all(segment["reason"] == "unassigned_line" for segment in report["segments"])


def test_monotonic_trend_is_not_a_median_spike_and_gaps_block_windows():
    payload = survey()
    payload["records"] = payload["records"][:7]
    for i, row in enumerate(payload["records"]):
        row["values"]["mag"] = i * 100
    report = baselode.geophysics.qc_observations(payload, {"spike_thresholds": {"mag": 1}})
    assert report["state"] == "ok" and not any(item["code"] == "spike_candidate" for item in report["flags"])
    payload["records"][3]["values"]["mag"] = None
    report = baselode.geophysics.qc_observations(payload, {"spike_thresholds": {"mag": 1}})
    assert report["state"] == "needs_input" and report["coverage"]["skipped_spike_windows"] == 3
    assert report["coverage"]["spike_windows"] == 0


@pytest.mark.parametrize("crs,units", [(None, None), ("EPSG:4326", None), (None, "degree"), ("EPSG:28350", "ft")])
def test_distance_checks_request_usable_coordinates(crs, units):
    payload = survey(); payload["crs"] = crs; payload["crs_units"] = units
    report = baselode.geophysics.qc_observations(payload, {"max_speed": 5})
    assert report["state"] == "needs_input"
    assert report["edges"] == [] and report["summary"]["distance_units"] is None


def test_projected_and_foot_units_and_explicit_measured_clearance():
    payload = survey(); payload["crs_units"] = "ft"
    report = baselode.geophysics.qc_observations(payload, {"max_speed": 4})
    assert report["summary"]["distance_units"] == "ft"
    assert report["edges"][0]["speed"] == 5  # no implicit metre conversion
    payload["metadata"]["height_units"] = "degree"
    assert baselode.geophysics.qc_observations(payload, {"min_clearance": 20})["state"] == "needs_input"
    payload["metadata"]["height_units"] = "m"; payload["records"][0].pop("clearance")
    report = baselode.geophysics.qc_observations(payload, {"min_clearance": 20})
    assert report["state"] == "needs_input"
    assert any(item["code"] == "missing_clearance" for item in report["flags"])


def test_repeat_identity_does_not_imply_colocation_or_precision():
    payload = survey(); payload["records"][12]["x"] += 1
    payload["records"][13]["values"]["mag"] = None
    report = baselode.geophysics.qc_observations(payload)
    assert report["repeats"][0]["same_location"] is False
    assert report["repeats"][0]["channels"]["mag"]["sample_std"] == pytest.approx(2 ** 0.5)
    assert len([item for item in report["flags"] if item["code"] == "station_location_mismatch"]) == 3


@pytest.mark.parametrize("options", [{"typo": 1}, {"max_speed": True}, {"max_time_gap": -1}, {"max_speed": float("nan")}, {"spike_window": 4}, {"spike_window": 103}, {"spike_thresholds": {"unknown": 1}}, {"spike_thresholds": {"mag": 0}}, {"max_speed": "5"}])
def test_bad_options_are_structured(options):
    assert baselode.geophysics.qc_observations(survey(), options)["state"] == "rejected"


@pytest.mark.parametrize("change", ["future", "null_schema", "duplicate_id", "unknown_channel", "string_value", "boolean_x", "nan", "bad_correction", "extra_field", "bad_units"])
def test_bad_observation_contracts(change):
    payload = survey()
    if change == "future": payload["version"] = 2
    if change == "null_schema": payload["schema"] = None
    if change == "duplicate_id": payload["records"][1]["id"] = payload["records"][0]["id"]
    if change == "unknown_channel": payload["records"][0]["values"]["bad"] = 1
    if change == "string_value": payload["records"][0]["values"]["mag"] = "10"
    if change == "boolean_x": payload["records"][0]["x"] = True
    if change == "nan": payload["records"][0]["time"] = float("nan")
    if change == "bad_correction": payload["metadata"]["corrections"]["igrf"] = "maybe"
    if change == "extra_field": payload["records"][0]["oops"] = 1
    if change == "bad_units": payload["channels"]["mag"]["units"] = ""
    assert baselode.geophysics.qc_observations(payload)["state"] == "rejected"
    with pytest.raises(ValueError): baselode.geophysics.create_observations(payload)


def test_shared_schema_descriptor_and_reference():
    for name in ("geophysics_observations.schema.json", "geophysics_observation_qc.json"):
        assert json.loads((ROOT / "python/src/baselode/geophysics" / name).read_text()) == json.loads((ROOT / "javascript/packages/baselode/src/data" / name).read_text())
    schema = baselode.geophysics.observation_schema(); schema.clear()
    assert baselode.geophysics.observation_schema()["properties"]
    reference = json.loads((ROOT / "test/data/geophysics_observations_reference.json").read_text())
    report = baselode.geophysics.qc_observations(reference["input"], reference["options"])
    report.pop("producer")
    assert report == reference["report"]


def test_resource_limits_reject_before_expensive_work(monkeypatch):
    payload = survey()
    payload["records"] = [payload["records"][0]] * 100001
    assert baselode.geophysics.qc_observations(payload)["state"] == "rejected"
    payload = survey()
    monkeypatch.setitem(baselode.geophysics.observations._LIMITS, "max_spike_window_values", 1)
    assert baselode.geophysics.qc_observations(payload, options())["state"] == "rejected"


def test_flag_limit_is_explicitly_partial_and_rejected(monkeypatch):
    monkeypatch.setitem(baselode.geophysics.observations._LIMITS, "max_flags", 2)
    report = baselode.geophysics.qc_observations(survey(), options())
    assert report["state"] == "rejected" and report["flags_truncated"] is True
    assert len(report["flags"]) == 2
    assert report["summary"]["flags_by_code"]["high_speed"] == 6


def test_extreme_speed_is_structured_and_report_stays_json_finite():
    payload = survey(); payload["records"] = payload["records"][:2]
    payload["records"][1]["time"] = 1e-320
    report = baselode.geophysics.qc_observations(payload)
    assert report["state"] == "rejected" and report["edges"] == []
    json.dumps(report, allow_nan=False)


def test_repeat_mean_retains_small_values_through_cancellation():
    payload = survey(); payload["records"] = payload["records"][11:14]
    for row, value in zip(payload["records"], [1e16, 1, -1e16]): row["values"]["mag"] = value
    result = baselode.geophysics.qc_observations(payload)
    assert result["repeats"][0]["channels"]["mag"]["mean"] == pytest.approx(1 / 3)


def test_requested_time_gap_checks_never_bridge_unknown_timestamps():
    payload = survey(); payload["records"] = payload["records"][:7]
    payload["records"][3].pop("time")
    result = baselode.geophysics.qc_observations(payload, {"max_time_gap": 10, "spike_thresholds": {"mag": 20}})
    assert result["state"] == "needs_input"
    assert any(flag["id"] == "r3" and flag["code"] == "missing_time" for flag in result["flags"])
    assert result["coverage"]["spike_windows"] == 0
    assert len(result["segments"]) == 3


@pytest.mark.parametrize("value", ["\ud800", "\udc00", "a\ud800b"])
def test_unpaired_unicode_is_rejected(value):
    payload = survey(); payload["records"][0]["id"] = value
    assert baselode.geophysics.qc_observations(payload)["state"] == "rejected"
    payload = survey(); payload["metadata"][value] = "invalid key"
    assert baselode.geophysics.qc_observations(payload)["state"] == "rejected"


def test_paired_surrogates_are_normalized_as_valid_unicode_scalars():
    payload = survey(); payload["records"][0]["id"] = "\ud83d\ude00"
    assert baselode.geophysics.create_observations(payload)["records"][0]["id"] == "😀"


def test_coordinate_free_base_station_series_can_use_sample_window_qc():
    payload = survey(); payload["records"] = payload["records"][:7]; payload.pop("crs_units")
    for row in payload["records"]: row.pop("x"); row.pop("y")
    report = baselode.geophysics.qc_observations(payload, {"spike_thresholds": {"mag": 20}})
    assert report["state"] == "ok"
    assert [flag["id"] for flag in report["flags"] if flag["code"] == "spike_candidate"] == ["r3"]
    assert len(report["segments"]) == 1


def test_numeric_overflow_is_deduplicated_and_preserves_coverage():
    payload = survey(); payload["records"] = payload["records"][:3]
    for i, row in enumerate(payload["records"]): row["time"] = i * 1e-320
    report = baselode.geophysics.qc_observations(payload)
    assert report["state"] == "rejected" and len(report["issues"]) == 1
    assert report["coverage"]["within_line_edges"] == report["coverage"]["speed_edges"] + report["coverage"]["skipped_speed_edges"] == 2
    assert len(report["segments"]) == 3
    assert len([flag for flag in report["flags"] if flag["code"] == "numeric_range"]) == 2


@pytest.mark.parametrize("blank", ["\x1c", "\x1d", "\x1e", "\x1f", "\x85", "\ufeff", "\xa0", "\u3000"])
def test_shared_blank_string_contract(blank):
    for kind in ("id", "crs", "units"):
        payload = survey()
        if kind == "id": payload["records"][0]["id"] = blank
        if kind == "crs": payload["crs"] = blank
        if kind == "units": payload["channels"]["mag"]["units"] = blank
        assert baselode.geophysics.qc_observations(payload)["state"] == "rejected"


def test_shared_context_whitespace_is_normalized_for_unit_interpretation():
    payload = survey(); payload["crs_units"] = "\x85m\ufeff"; payload["metadata"]["height_units"] = "\ufeffm\x85"
    report = baselode.geophysics.qc_observations(payload, {"min_clearance": 20})
    assert report["state"] == "ok" and report["summary"]["distance_units"] == "m"
    assert any(flag["code"] == "low_clearance" for flag in report["flags"])
