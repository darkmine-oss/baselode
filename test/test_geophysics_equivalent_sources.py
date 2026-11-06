# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent harmonic fields, spatial holdouts and adapter contracts."""
import copy
import json
import math
import pathlib

import jsonschema
import numpy as np
import pytest

import baselode.geophysics
import baselode.geophysics.equivalent_sources

pytest.importorskip("harmonica")
ROOT = pathlib.Path(__file__).resolve().parents[1]


def field(x, y, z):
    return 1000 / math.sqrt(x * x + y * y + (z + 100) ** 2)


def survey():
    records = []
    for j, y in enumerate(range(-100, 101, 50)):
        for i, x in enumerate(range(-100, 101, 50)):
            z = 20 + 0.05 * x + 0.03 * y
            records.append({"id": f"r{j}-{i}", "x": x, "y": y, "z": z, "line_id": f"line{j}", "values": {"mag": field(x, y, z)}})
    return {"records": records, "channels": {"mag": {"field_type": "magnetic_anomaly", "units": "nT"}}, "crs_units": "m",
            "metadata": {"height_units": "metre", "height_datum": "local-survey", "z_positive": "up", "frame_id": "survey-A", "corrections": {"igrf": "applied"}, "source": "survey.xyz"}}


def options(grid=True, **changes):
    params = {"channel": "mag", "depth": 112, "damping": None, "radius": 500, "duplicate_policy": "mean", "extrapolation": "mask"}
    if grid:
        params.update(bounds=[-75, -75, 75, 75], shape=[3, 3], target_height=60)
    return {**params, **changes}


def test_independent_harmonic_field_at_actual_elevations_and_common_height():
    payload = survey(); original = copy.deepcopy(payload)
    report = baselode.geophysics.grid_equivalent_sources(payload, options())
    assert report["state"] == "ok", report["issues"]
    expected = [[field(x, y, 60) for x in (-50, 0, 50)] for y in (50, 0, -50)]
    np.testing.assert_allclose(report["artifacts"]["grid"].data[0], expected, rtol=1e-7, atol=1e-8)
    assert report["diagnostics"]["fit_metrics"]["rmse"] < 1e-9
    assert report["diagnostics"]["training"]["source_z"] == -100
    assert report["diagnostics"]["backend"]["kernel"] == "1/r"
    assert report["artifacts"]["grid"].metadata["units"] == ["nT"]
    assert report["artifacts"]["grid"].metadata["corrections"] == {"igrf": "applied"}
    assert payload == original


def test_support_distance_hull_and_radius_have_independent_meaning():
    result = baselode.geophysics.grid_equivalent_sources(survey(), options(bounds=[-200, -25, 200, 25], shape=[1, 4], radius=30))
    assert result["state"] == "ok"
    assert result["artifacts"]["support"].data[0, 0].tolist() == [0, 1, 1, 0]
    assert result["artifacts"]["extrapolation"].data[0, 0].tolist() == [1, 0, 0, 1]
    assert result["artifacts"]["nearest_distance"].data[0, 0].tolist() == [50, 0, 0, 50]
    assert np.isnan(result["artifacts"]["grid"].data[0, 0, 0])
    allow = baselode.geophysics.grid_equivalent_sources(survey(), options(bounds=[-200, -25, 200, 25], shape=[1, 4], radius=60, extrapolation="allow"))
    assert allow["artifacts"]["support"].data.sum() == 4
    assert allow["artifacts"]["extrapolation"].data.sum() == 2


def test_exact_xyz_duplicates_and_distinct_heights_are_not_confused():
    payload = survey(); duplicate = {**copy.deepcopy(payload["records"][0]), "id": "repeat"}
    duplicate["values"]["mag"] += 2
    payload["records"].append(duplicate)
    mean = baselode.geophysics.grid_equivalent_sources(payload, options())
    assert mean["state"] == "ok"
    assert mean["diagnostics"]["training"]["duplicate_xyz"] == 1
    original_residual, repeat_residual = mean["residuals"][0], mean["residuals"][-1]
    assert original_residual["residual"] - repeat_residual["residual"] == pytest.approx(2)
    assert baselode.geophysics.grid_equivalent_sources(payload, options(duplicate_policy="reject"))["state"] == "rejected"
    duplicate["z"] += 1; duplicate["values"]["mag"] = field(duplicate["x"], duplicate["y"], duplicate["z"])
    different = baselode.geophysics.grid_equivalent_sources(payload, options(duplicate_policy="reject"))
    assert different["state"] == "ok"
    assert different["diagnostics"]["training"]["unique_xyz"] == 26
    assert different["diagnostics"]["training"]["source_count"] == 25


@pytest.mark.parametrize("change", [{"channel": "absent"}, {"depth": 0}, {"damping": 0}, {"radius": -1}, {"target_height": 0}, {"shape": [0, 2]}, {"extra": True}])
def test_rejects_invalid_parameters_without_partial_artifacts(change):
    result = baselode.geophysics.grid_equivalent_sources(survey(), options(**change))
    assert result["state"] == "rejected" and result["artifacts"] == {} and result["residuals"] == []


@pytest.mark.parametrize("key,value,state", [("height_units", None, "needs_input"), ("height_datum", "unknown", "needs_input"), ("z_positive", "down", "rejected"), ("height_units", "ft", "rejected"), ("frame_id", None, "needs_input")])
def test_requires_unambiguous_vertical_and_local_context(key, value, state):
    payload = survey(); payload["metadata"][key] = value
    assert baselode.geophysics.grid_equivalent_sources(payload, options())["state"] == state


def test_rejects_nonpotential_fields_angular_units_and_missing_elevation():
    for kind in ("radiometric", "magnetic_total_field", "gravity_observed", "other"):
        payload = survey(); payload["channels"]["mag"]["field_type"] = kind
        assert baselode.geophysics.grid_equivalent_sources(payload, options())["state"] == "rejected"
    payload = survey(); payload["crs"] = "EPSG:4326"; payload["crs_units"] = "degree"
    assert baselode.geophysics.grid_equivalent_sources(payload, options())["state"] == "rejected"
    payload = survey(); payload["records"][0]["z"] = None
    assert baselode.geophysics.grid_equivalent_sources(payload, options())["state"] == "needs_input"


def test_missing_readings_and_gaps_are_preserved_and_counted():
    payload = survey(); payload["records"][0]["values"]["mag"] = None; payload["records"][1]["x"] = None
    result = baselode.geophysics.grid_equivalent_sources(payload, options())
    assert result["state"] == "ok"
    assert result["diagnostics"]["skipped_records"] == 2
    assert len(result["residuals"]) == 23
    assert payload["records"][0]["values"]["mag"] is None


def test_line_holdouts_refit_geometry_remove_xy_leakage_and_rank_complete_coverage():
    payload = survey()
    repeat = copy.deepcopy(payload["records"][0]); repeat.update(id="repeat-line", line_id="line1", z=repeat["z"] + 1)
    payload["records"].append(repeat)
    candidates = [{"depth": 112, "damping": 1e-8}, {"depth": 200, "damping": 1}]
    report = baselode.geophysics.cross_validate_equivalent_sources(payload, options(False, extrapolation="allow"), {"by": "line"}, candidates)
    assert report["state"] == "ok", report["issues"]
    assert report["best_index"] in (0, 1)
    assert all(item["summary"]["coverage"] == 1 for item in report["candidates"])
    first = report["candidates"][0]["folds"][0]
    assert first["excluded_buffer_records"] == 1
    test_xy = {(row["x"], row["y"]) for row in payload["records"] if row["line_id"] == first["group"]}
    assert test_xy.isdisjoint(map(tuple, first["training"]["source_xy"]))
    expected = min(range(2), key=lambda index: report["candidates"][index]["summary"]["rmse"])
    assert report["best_index"] == expected
    buffered = baselode.geophysics.cross_validate_equivalent_sources(payload, options(False, extrapolation="allow"), {"by": "line", "buffer_distance": 51})
    assert buffered["candidates"][0]["folds"][0]["excluded_buffer_records"] > first["excluded_buffer_records"]


def test_block_holdouts_report_support_and_do_not_rank_partial_coverage():
    result = baselode.geophysics.cross_validate_equivalent_sources(survey(), options(False), {"by": "block", "block_size": [110, 110], "origin": [-100, -100]})
    assert result["state"] == "ok", result["issues"]
    assert result["best_index"] is None
    assert 0 <= result["candidates"][0]["summary"]["coverage"] < 1
    assert baselode.geophysics.cross_validate_equivalent_sources(survey(), options(False), {"by": "block", "block_size": [50, 50]})["state"] == "needs_input"


def test_backend_optional_and_failure_states_are_actionable(monkeypatch):
    module = baselode.geophysics.equivalent_sources
    class Broken:
        def __init__(self, **kwargs):
            raise ValueError("test solver failure")
    monkeypatch.setattr(module._harmonica, "EquivalentSources", Broken)
    result = baselode.geophysics.grid_equivalent_sources(survey(), options())
    assert result["state"] == "failed" and result["issues"][0]["code"] == "backend"
    monkeypatch.setattr(module, "_harmonica", None)
    assert baselode.geophysics.describe_equivalent_sources()["execution"]["javascript"] == "contract_only"
    with pytest.raises(ImportError, match="baselode\\[potential-fields\\]"):
        baselode.geophysics.grid_equivalent_sources(survey(), options())


def test_resource_limits_precede_dense_solver_work():
    result = baselode.geophysics.grid_equivalent_sources(survey(), options(shape=[101, 100]))
    assert result["issues"][0]["code"] == "resource"
    result = baselode.geophysics.cross_validate_equivalent_sources(survey(), options(False), {"by": "line"}, [{"depth": 112, "damping": None}] * 9)
    assert result["issues"][0]["code"] == "resource"
    result = baselode.geophysics.cross_validate_equivalent_sources(survey(), options(False), {"by": "block", "block_size": [1, 1], "origin": [0, 0]})
    assert result["issues"][0]["code"] == "resource"


@pytest.mark.parametrize("extension", ["ers", "tif"])
def test_export_retains_effective_parameters_and_flat_lineage(tmp_path, extension):
    payload = survey(); payload["metadata"].update(driver="old", uncertainty=[[1]], width=999)
    result = baselode.geophysics.grid_equivalent_sources(payload, options())
    raster = result["artifacts"]["grid"]
    assert "uncertainty" not in raster.metadata and "driver" not in raster.metadata and "width" not in raster.metadata
    assert raster.metadata["uncertainty_propagated"] is False
    step = raster.metadata["processing"][-1]
    assert raster.metadata["input_lineage"][step["operand_lineage"]]["metadata"]["uncertainty"] == [[1]]
    path = tmp_path / ('equivalent.' + extension)
    baselode.geophysics.save_raster(raster, path, dtype="float64")
    restored = baselode.geophysics.load_raster(path)
    assert restored.metadata["processing"] == raster.metadata["processing"]
    assert restored.metadata["input_lineage"] == raster.metadata["input_lineage"]
    assert restored.metadata["height_datum"] == "local-survey"


def test_shared_descriptor_is_packaged_and_copied():
    name = "geophysics_equivalent_sources.json"
    descriptor = baselode.geophysics.describe_equivalent_sources()
    assert descriptor == json.loads((ROOT / 'javascript/packages/baselode/src/data' / name).read_text())
    descriptor["resources"]["max_records"] = 0
    assert baselode.geophysics.describe_equivalent_sources()["resources"]["max_records"] == 512


def test_portable_request_runner_returns_full_resolution_raster_payloads():
    request = {"schema": "baselode.geophysics.equivalent_source_request", "version": 1, "operation": "grid", "observations": survey(), "options": options()}
    result = baselode.geophysics.run_equivalent_sources(request)
    assert result["state"] == "ok", result["issues"]
    assert np.shape(result["artifacts"]["grid"]["data"]) == (1, 3, 3)
    assert json.loads(json.dumps(result, allow_nan=False)) == result
    assert baselode.geophysics.run_equivalent_sources({**request, "operation": "eval"})["state"] == "rejected"
    assert baselode.geophysics.run_equivalent_sources({**request, "version": True})["state"] == "rejected"
    assert baselode.geophysics.run_equivalent_sources({**request, "validation": {"by": "line"}})["state"] == "rejected"
    assert baselode.geophysics.run_equivalent_sources({**request, "operation": "cross_validate"})["state"] == "needs_input"


def test_independent_off_layer_field_with_noise_and_missing_samples():
    payload = survey()
    for index, row in enumerate(payload["records"]):
        x, y, z = row["x"], row["y"], row["z"]
        row["values"]["mag"] = 1000 / math.sqrt((x - 10) ** 2 + (y + 15) ** 2 + (z + 130) ** 2) + 0.002 * ((index % 3) - 1)
    payload["records"] = [row for index, row in enumerate(payload["records"]) if index not in (0, 6, 18)]
    report = baselode.geophysics.grid_equivalent_sources(payload, options(damping=1e-6))
    assert report["state"] == "ok"
    expected = [[1000 / math.sqrt((x - 10) ** 2 + (y + 15) ** 2 + 190 ** 2) for x in (-50, 0, 50)] for y in (50, 0, -50)]
    np.testing.assert_allclose(report["artifacts"]["grid"].data[0], expected, atol=0.05, rtol=0)
    assert len(report["residuals"]) == 22


def test_request_schema_matches_runner_and_rejects_wrong_operation_parameters():
    schema = baselode.geophysics.describe_equivalent_sources()["request_schema"]
    jsonschema.Draft202012Validator.check_schema(schema)
    request = {"schema": "baselode.geophysics.equivalent_source_request", "version": 1, "operation": "grid", "observations": survey(), "options": options()}
    jsonschema.validate(request, schema)
    validation = {**request, "operation": "cross_validate", "options": options(False), "validation": {"by": "line"}, "candidates": [{"depth": 100, "damping": None}]}
    jsonschema.validate(validation, schema)
    result = baselode.geophysics.run_equivalent_sources(validation)
    assert result["state"] == "ok" and "candidates" in result
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({**request, "validation": {"by": "line"}}, schema)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({**request, "options": options(target_height=None)}, schema)


def test_dense_budget_is_checked_before_backend_fit(monkeypatch):
    module = baselode.geophysics.equivalent_sources
    monkeypatch.setitem(module._LIMITS, "max_fit_work", 1)
    def unexpected_fit(*args, **kwargs):
        pytest.fail("resource guard did not precede fitting")
    monkeypatch.setattr(module, "_fit", unexpected_fit)
    result = baselode.geophysics.grid_equivalent_sources(survey(), options())
    assert result["issues"][0]["code"] == "resource"
    result = baselode.geophysics.cross_validate_equivalent_sources(survey(), options(False), {"by": "line"})
    assert result["issues"][0]["code"] == "resource"
