# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent interpolation, support, leakage and spatial-scoring cases."""
import copy
import json
import math
import pathlib

import numpy as np
import pytest

import baselode.geophysics

ROOT = pathlib.Path(__file__).resolve().parents[1]


def observations(points=None):
    if points is None:
        points = [(0, 0, 0), (2, 0, 4), (0, 2, 2), (2, 2, 6)]
    return {"channels": {"mag": {"field_type": "magnetic_anomaly", "units": "nT"}}, "crs_units": "m",
            "records": [{"id": f"r{i}", "x": x, "y": y, "values": {"mag": value}} for i, (x, y, value) in enumerate(points)],
            "metadata": {"corrections": {"igrf": "applied"}}}


def interpolation(**changes):
    return {"channels": ["mag"], "radius": 10, "duplicate_policy": "mean", "elevation_policy": "ignore", **changes}


def options(**changes):
    return {**interpolation(), "bounds": [0, 0, 2, 2], "shape": [1, 1], **changes}


def lines():
    payload = observations([])
    payload["records"] = [{"id": f"L{x}:{y}", "line_id": f"L{x}", "x": x, "y": y, "values": {"mag": 110 if x == 0 else 100}} for x in (-1, 0, 1) for y in (0, 1, 2)]
    return payload


def test_hand_calculated_idw_and_nearest_tie():
    result = baselode.geophysics.grid_observations(observations(), options())
    assert result["state"] == "ok", result["issues"]
    assert result["artifacts"]["grid"].data.item() == 3  # mean of four equidistant corner values, f=2x+y
    assert result["artifacts"]["support"].data.item() == 1
    assert result["artifacts"]["neighbor_count"].data.item() == 4
    assert result["artifacts"]["nearest_distance"].data.item() == pytest.approx(math.sqrt(2))
    assert result["artifacts"]["extrapolation"].data.item() == 0
    assert result["artifacts"]["grid"].transform == (2, 0, 0, 0, -2, 2)
    result = baselode.geophysics.grid_observations(observations(), options(method="nearest"))
    assert result["artifacts"]["grid"].data.item() == 0  # stable first-location tie
    result = baselode.geophysics.grid_observations(observations([(0, 0, 0), (2, 0, 10)]), options(bounds=[0, -0.5, 1, 0.5]))
    assert result["artifacts"]["grid"].data.item() == pytest.approx(1)  # weights 1 and 1/9


def test_support_radius_holes_extrapolation_and_minimum_neighbors():
    report = baselode.geophysics.grid_observations(observations(), options(radius=1))
    assert np.isnan(report["artifacts"]["grid"].data).all()
    assert report["artifacts"]["support"].data.item() == 0
    assert report["artifacts"]["neighbor_count"].data.item() == 0
    assert report["artifacts"]["nearest_distance"].data.item() == pytest.approx(math.sqrt(2))
    assert report["artifacts"]["extrapolation"].data.item() == 0
    report = baselode.geophysics.grid_observations(observations(), options(bounds=[2, 2, 4, 4]))
    assert report["artifacts"]["extrapolation"].data.item() == 1
    assert report["artifacts"]["support"].data.item() == 0
    report = baselode.geophysics.grid_observations(observations(), options(bounds=[2, 2, 4, 4], extrapolation="allow"))
    assert np.isfinite(report["artifacts"]["grid"].data).all()
    assert report["artifacts"]["extrapolation"].data.item() == 1
    report = baselode.geophysics.grid_observations(observations([(0, 0, 7)]), options(bounds=[-0.5, -0.5, 0.5, 0.5], min_neighbors=2))
    assert report["artifacts"]["support"].data.item() == 0  # exact sample does not bypass explicit density rule


def test_radius_is_inclusive_and_exact_sample_duplicate_policy_is_explicit():
    payload = observations([(0, 0, 2), (0, 0, 4)])
    result = baselode.geophysics.grid_observations(payload, options(bounds=[-0.5, -0.5, 0.5, 0.5]))
    assert result["artifacts"]["grid"].data.item() == 3
    assert result["artifacts"]["neighbor_count"].data.item() == 1
    assert result["diagnostics"]["training"]["mag"]["duplicate_locations"] == 1
    assert baselode.geophysics.grid_observations(payload, options(duplicate_policy="reject"))["state"] == "rejected"
    result = baselode.geophysics.grid_observations(observations([(0, 0, 7)]), options(bounds=[2.5, 3.5, 3.5, 4.5], radius=5, extrapolation="allow"))
    assert result["artifacts"]["grid"].data.item() == 7


def test_per_channel_support_missing_data_and_input_preservation():
    payload = observations(); original = copy.deepcopy(payload)
    payload["channels"]["aux"] = {"field_type": "magnetic_anomaly", "units": "nT"}
    payload["records"][0]["values"]["aux"] = 8
    payload["records"].append({"id": "missingXY", "x": None, "y": 1, "values": {"mag": 999}})
    snapshot = copy.deepcopy(payload)
    result = baselode.geophysics.grid_observations(payload, options(channels=["mag", "aux"]))
    assert result["state"] == "ok" and payload == snapshot
    assert result["artifacts"]["support"].data[:, 0, 0].tolist() == [1, 0]
    assert result["artifacts"]["neighbor_count"].data[:, 0, 0].tolist() == [4, 1]
    assert result["diagnostics"]["skipped_records"] == 1
    assert original["metadata"] == result["artifacts"]["grid"].metadata["observation_metadata"]
    result["artifacts"]["grid"].metadata["corrections"]["igrf"] = "unknown"
    assert payload["metadata"]["corrections"]["igrf"] == "applied"


@pytest.mark.parametrize("extension", ["ers", "tif"])
def test_grid_lineage_units_and_declared_corrections_survive_export(tmp_path, extension):
    payload = observations(); payload["crs"] = "EPSG:28350"
    payload["metadata"]["source"] = "https://user:secret@example.com/survey?token=private"
    result = baselode.geophysics.grid_observations(payload, options())
    path = tmp_path / f"grid.{extension}"
    baselode.geophysics.save_raster(result["artifacts"]["grid"], path, dtype="float64")
    restored = baselode.geophysics.load_raster(path)
    assert restored.metadata["units"] == ["nT"]
    assert restored.metadata["field_type"] == "magnetic_anomaly"
    assert restored.metadata["corrections"] == {"igrf": "applied"}
    assert restored.metadata["processing"][-1]["operation"] == "grid_observations"
    assert "secret" not in json.dumps(restored.metadata["baselode_provenance"]) and "token=" not in json.dumps(restored.metadata["baselode_provenance"])
    assert restored.metadata["baselode_provenance"]["sources"] == ["https://example.com/survey"]


def test_explicit_variable_elevation_acknowledgement_and_small_scale_geometry():
    payload = observations()
    for i, row in enumerate(payload["records"]): row["z"] = i * 10
    params = options(); params.pop("elevation_policy")
    assert baselode.geophysics.grid_observations(payload, params)["state"] == "needs_input"
    result = baselode.geophysics.grid_observations(payload, options())
    assert result["diagnostics"]["elevation"] == {"policy": "ignore", "known": 4, "missing": 0, "min": 0, "max": 30}
    tiny = observations([(x * 1e-200, y * 1e-200, value) for x, y, value in [(0, 0, 0), (2, 0, 4), (0, 2, 2), (2, 2, 6)]])
    result = baselode.geophysics.grid_observations(tiny, options(bounds=[0, 0, 2e-200, 2e-200]))
    assert result["state"] == "ok" and result["artifacts"]["grid"].data.item() == 3


def test_line_holdouts_reveal_injected_offset_and_report_unsupported_folds():
    payload = lines(); before = copy.deepcopy(payload)
    result = baselode.geophysics.cross_validate_gridding(payload, interpolation(), {"by": "line"})
    assert result["state"] == "ok" and payload == before
    centre = next(fold for fold in result["folds"] if fold["group"] == "L0")
    assert centre["train_records"] == 6 and centre["test_records"] == 3
    assert centre["metrics"]["mag"] == {"tested": 3, "supported": 3, "unsupported": 0, "coverage": 1, "rmse": 10, "mae": 10, "bias": -10}
    assert result["summary"]["mag"]["coverage"] == pytest.approx(1 / 3)
    assert result["summary"]["mag"]["unsupported"] == 6
    assert result["summary"]["mag"]["rmse"] == 10
    result = baselode.geophysics.cross_validate_gridding(payload, interpolation(), {"by": "line", "buffer_distance": 1})
    centre = next(fold for fold in result["folds"] if fold["group"] == "L0")
    assert centre["train_records"] == 0 and centre["excluded_buffer_records"] == 6
    assert centre["metrics"]["mag"]["rmse"] is None


def test_duplicate_positions_never_leak_test_values_into_training():
    payload = observations([])
    payload["records"] = [{"id": f"{line}{i}", "line_id": line, "x": i, "y": 0, "values": {"mag": value}} for line, value in (("A", 1), ("B", 1000)) for i in (0, 1)]
    result = baselode.geophysics.cross_validate_gridding(payload, interpolation(duplicate_policy="reject", extrapolation="allow"), {"by": "line"})
    assert result["state"] == "ok"
    assert all(fold["train_records"] == 0 and fold["excluded_buffer_records"] == 2 for fold in result["folds"])
    assert result["summary"]["mag"]["supported"] == 0
    assert result["summary"]["mag"]["rmse"] is None


def test_explicit_block_origin_negative_floor_and_constant_field_scores():
    payload = observations([(-1, -1, 7), (1, 1, 7), (3, 1, 7)])
    result = baselode.geophysics.cross_validate_gridding(payload, interpolation(extrapolation="allow"), {"by": "block", "block_size": [2, 2], "origin": [0, 0]})
    assert result["state"] == "ok"
    assert [fold["group"] for fold in result["folds"]] == ["-1:-1", "0:0", "1:0"]
    assert result["summary"]["mag"]["rmse"] == pytest.approx(0, abs=1e-12)
    assert result["summary"]["mag"]["coverage"] == 1
    assert baselode.geophysics.cross_validate_gridding(payload, interpolation(), {"by": "block", "block_size": [2, 2]})["state"] == "needs_input"


@pytest.mark.parametrize("changes", [{"radius": 0}, {"radius": "10"}, {"power": True}, {"shape": [0, 1]}, {"shape": [1.5, 1]}, {"neighbors": 0}, {"min_neighbors": 9, "neighbors": 8}, {"bounds": [1, 0, 0, 2]}, {"method": "kriging"}, {"channels": ["unknown"]}, {"channels": ["mag", "mag"]}, {"target_height": 100}, {"radius": float("nan")}])
def test_invalid_options_never_produce_artifacts(changes):
    result = baselode.geophysics.grid_observations(observations(), options(**changes))
    assert result["state"] == "rejected" and result["artifacts"] == {}


def test_context_empty_and_resource_guards():
    payload = observations(); payload["crs"] = "EPSG:4326"; payload.pop("crs_units")
    assert baselode.geophysics.grid_observations(payload, options())["state"] == "needs_input"
    assert baselode.geophysics.grid_observations(observations([]), options())["state"] == "needs_input"
    assert baselode.geophysics.grid_observations(observations(), options(shape=[400, 400]))["issues"][0]["code"] == "resource"
    payload = observations([(i, 0, 1) for i in range(100)])
    assert baselode.geophysics.grid_observations(payload, options(shape=[100, 1000]))["issues"][0]["code"] == "resource"
    payload = observations([(i, 0, 1) for i in range(2000)])
    for row in payload["records"]: row["line_id"] = "A" if row["x"] % 2 else "B"
    assert baselode.geophysics.cross_validate_gridding(payload, interpolation(), {"by": "line"})["issues"][0]["code"] == "resource"
    assert baselode.geophysics.cross_validate_gridding(observations(), interpolation(), {"by": "line"})["state"] == "needs_input"


def test_shared_descriptor_and_numerical_reference():
    name = "geophysics_gridding.json"
    assert json.loads((ROOT / "python/src/baselode/geophysics" / name).read_text()) == json.loads((ROOT / "javascript/packages/baselode/src/data" / name).read_text())
    reference = json.loads((ROOT / "test/data/geophysics_gridding_reference.json").read_text())
    result = baselode.geophysics.grid_observations(reference["input"], reference["options"])
    for key, expected in reference["artifacts"].items():
        np.testing.assert_allclose(result["artifacts"][key].data, np.array(expected, dtype=float), rtol=1e-10, atol=1e-10)
    actual = baselode.geophysics.cross_validate_gridding(reference["validation_input"], interpolation(), {"by": "line"})
    actual.pop("producer")
    assert actual == reference["validation"]


def test_validation_group_limits_invalid_split_and_mixed_field_guards():
    payload = observations([(i, 0, 1) for i in range(65)])
    for row in payload["records"]: row["line_id"] = row["id"]
    assert baselode.geophysics.cross_validate_gridding(payload, interpolation(), {"by": "line"})["issues"][0]["code"] == "resource"
    for split in ({"by": "random"}, {"by": "line", "buffer_distance": -1}, {"by": "line", "origin": [0, 0]}):
        assert baselode.geophysics.cross_validate_gridding(lines(), interpolation(), split)["state"] == "rejected"
    payload = observations(); payload["channels"]["radio"] = {"field_type": "radiometric", "units": "ppm"}
    assert baselode.geophysics.grid_observations(payload, options(channels=["mag", "radio"]))["state"] == "rejected"
