# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Scientific outcomes, strict preflight, replay and portable contracts."""
import copy
import json
import pathlib

import numpy as np
import pytest

import baselode.geophysics
import baselode.geophysics.processing

ROOT = pathlib.Path(__file__).resolve().parents[1]


def grid():
    row, col = np.indices((8, 8))
    return baselode.geophysics.GeophysicsRaster(
        20 + 2 * col + 3 * row + 5 * np.cos(col * np.pi / 2),
        transform=(10, 0, 0, 0, -10, 80),
        metadata={"field_type": "magnetic_anomaly", "units": ["nT"], "crs_units": "m", "source": "synthetic.ers"},
    )


def single(operation="horizontal_derivative", parameters=None):
    return {"schema": "baselode.geophysics.workflow", "version": 1, "steps": [
        {"id": "product", "operation": operation, "version": 1, "inputs": ["magnetic"], "parameters": parameters or {}},
    ], "outputs": ["product"]}


def test_discovery_contract_and_packaged_json_are_shared():
    contracts = baselode.geophysics.list_operations()
    assert {item["id"] for item in contracts} == {"low_pass", "high_pass", "band_pass", "vertical_derivative", "horizontal_derivative", "total_horizontal_derivative", "tilt_derivative", "analytic_signal", "upward_continuation", "reduce_to_pole", "combine", "radiometric_ratios", "radiometric_ternary"}
    contracts[0]["parameters"]["properties"].clear()
    assert baselode.geophysics.describe_operation("low_pass")["parameters"]["properties"]
    with pytest.raises(ValueError):
        baselode.geophysics.describe_operation("__import__")
    for name in ("geophysics_operations.json", "geophysics_workflow.schema.json", "magnetic_grid_recipe.json"):
        assert json.loads((ROOT / "python/src/baselode/geophysics" / name).read_text()) == json.loads((ROOT / "javascript/packages/baselode/src/data" / name).read_text())


def test_recipe_replays_and_survives_export_without_changing_inputs(tmp_path):
    source = grid()
    data, metadata = source.data.copy(), copy.deepcopy(source.metadata)
    recipe = baselode.geophysics.magnetic_grid_recipe()
    result = baselode.geophysics.run_workflow(recipe, {"magnetic": source})
    assert result["state"] == "ok", result["issues"]
    assert result["completed_steps"] == ["regional", "residual", "edges"]
    assert result["resource_estimate"]["retained_cell_values"] == 256
    regional, residual, edges = (result["artifacts"][key] for key in recipe["outputs"])
    np.testing.assert_allclose(regional.data + residual.data, source.data, atol=1e-12)
    assert edges.metadata["units"] == ["nT/m"]
    assert np.isfinite(edges.data).all()
    repeated = baselode.geophysics.run_workflow(json.loads(json.dumps(recipe)), {"magnetic": source})
    np.testing.assert_array_equal(edges.data, repeated["artifacts"]["edges"].data)
    for extension in ("ers", "tif"):
        path = tmp_path / f"edges.{extension}"
        baselode.geophysics.save_raster(edges, path, dtype="float64")
        back = baselode.geophysics.load_raster(path)
        assert back.metadata["processing"] == edges.metadata["processing"]
        assert back.metadata["input_lineage"] == edges.metadata["input_lineage"]
    edges.metadata["input_lineage"][0]["metadata"]["source"] = "changed"
    np.testing.assert_array_equal(source.data, data)
    assert source.metadata == metadata


def test_independent_plane_outcomes_and_default_recording():
    row, col = np.indices((12, 12))
    source = grid().copy_with(20 + 20 * col - 30 * row)
    horizontal = baselode.geophysics.run_workflow(single(), {"magnetic": source})
    assert horizontal["state"] == "ok"
    np.testing.assert_allclose(horizontal["artifacts"]["product"].data, 2, atol=1e-12)
    assert horizontal["plan"][0]["parameters"] == {"direction": "east"}
    result = baselode.geophysics.run_workflow(baselode.geophysics.magnetic_grid_recipe(), {"magnetic": source})
    np.testing.assert_allclose(result["artifacts"]["regional"].data, source.data, atol=1e-10)
    np.testing.assert_allclose(result["artifacts"]["residual"].data, 0, atol=1e-10)


@pytest.mark.parametrize("operation,params", [("low_pass", {"wavelength": 40}), ("high_pass", {"wavelength": 40}), ("band_pass", {"long_wavelength": 80, "short_wavelength": 20}), ("vertical_derivative", {"order": 2}), ("horizontal_derivative", {"direction": "north"}), ("total_horizontal_derivative", {}), ("tilt_derivative", {}), ("analytic_signal", {}), ("upward_continuation", {"height": 20}), ("reduce_to_pole", {"inclination": -55, "declination": 1})])
def test_every_unary_operation_runs_without_generated_code(operation, params):
    result = baselode.geophysics.run_workflow(single(operation, params), {"magnetic": grid()})
    assert result["state"] == "ok", result["issues"]
    assert result["artifacts"]["product"].data.shape == (1, 8, 8)


@pytest.mark.parametrize("changes,expected", [
    ({"metadata": {"field_type": "radiometric", "units": ["ppm"], "crs_units": "m"}}, "rejected"),
    ({"metadata": {"units": ["nT"], "crs_units": "m"}}, "needs_input"),
    ({"metadata": {"field_type": "magnetic_anomaly", "crs_units": "m"}}, "needs_input"),
    ({"metadata": {"field_type": "magnetic_anomaly", "units": ["nT"]}}, "needs_input"),
    ({"crs": "EPSG:4326", "metadata": {"field_type": "magnetic_anomaly", "units": ["nT"]}}, "rejected"),
    ({"transform": (0, 0, 0, 0, 0, 0)}, "rejected"),
])
def test_missing_or_inapplicable_scientific_context(changes, expected):
    report = baselode.geophysics.run_workflow(baselode.geophysics.magnetic_grid_recipe(), {"magnetic": grid().copy_with(**changes)})
    assert report["state"] == expected
    assert report["issues"] and not report["artifacts"] and not report["completed_steps"]


def test_missing_upstream_input_propagates_needs_input():
    result = baselode.geophysics.run_workflow(baselode.geophysics.magnetic_grid_recipe(), {})
    assert result["state"] == "needs_input"
    assert result["completed_steps"] == []


@pytest.mark.parametrize("operation,params", [("low_pass", {"wavelength": "40"}), ("low_pass", {"wavelength": -1}), ("low_pass", {"wavelength": 40, "order": True}), ("low_pass", {"wavelength": 40, "method": "typo"}), ("band_pass", {"long_wavelength": 10, "short_wavelength": 20}), ("reduce_to_pole", {"inclination": 1, "declination": 0}), ("reduce_to_pole", {"inclination": -55, "declination": 500}), ("horizontal_derivative", {"direction": "up"}), ("analytic_signal", {"typo": 2})])
def test_parameter_errors_are_preflighted(operation, params):
    report = baselode.geophysics.run_workflow(single(operation, params), {"magnetic": grid()})
    assert report["state"] == "rejected" and not report["completed_steps"]


def test_missing_parameters_are_needs_input():
    assert baselode.geophysics.validate_workflow(single("upward_continuation"), {"magnetic": grid()})["state"] == "needs_input"


def test_all_steps_are_validated_before_any_kernel(monkeypatch):
    def fail(*args, **kwargs):
        pytest.fail("kernel started before full preflight")
    monkeypatch.setattr(baselode.geophysics.processing, "upward_continuation", fail)
    recipe = baselode.geophysics.magnetic_grid_recipe()
    recipe["steps"][-1]["operation"] = "eval"
    assert baselode.geophysics.run_workflow(recipe, {"magnetic": grid()})["state"] == "rejected"


def test_backend_exception_is_structured(monkeypatch):
    def fail(*args, **kwargs):
        raise ValueError("injected backend failure")
    monkeypatch.setattr(baselode.geophysics.processing, "horizontal_derivative", fail)
    result = baselode.geophysics.run_workflow(single(), {"magnetic": grid()})
    assert result["state"] == "failed" and result["artifacts"] == {}
    assert result["issues"][-1]["message"] == "injected backend failure"


def test_alignment_units_versions_and_forward_references():
    recipe = baselode.geophysics.magnetic_grid_recipe()
    for target in ("version", "operation"):
        broken = copy.deepcopy(recipe)
        broken["steps"][0][target] = 99
        assert baselode.geophysics.validate_workflow(broken, {"magnetic": grid()})["state"] == "rejected"
    recipe["steps"][0]["inputs"] = ["edges"]
    assert baselode.geophysics.validate_workflow(recipe, {"magnetic": grid()})["state"] == "rejected"
    recipe = single("combine")
    recipe["steps"][0]["inputs"] = ["magnetic", "other"]
    for other in (grid().copy_with(transform=(10, 0, 1, 0, -10, 80)), grid().copy_with(metadata={"field_type": "magnetic_anomaly", "units": ["mGal"], "crs_units": "m"})):
        assert baselode.geophysics.validate_workflow(recipe, {"magnetic": grid(), "other": other})["state"] == "rejected"


def test_strict_json_and_retained_resource_limits():
    recipe = single()
    recipe["bad"] = float("nan")
    assert baselode.geophysics.validate_workflow(recipe, {})["state"] == "rejected"
    source = grid().copy_with(np.ones((512, 512)))
    recipe = single()
    recipe["steps"] = [{**recipe["steps"][0], "id": f"step{i}"} for i in range(64)]
    recipe["outputs"] = ["step63"]
    result = baselode.geophysics.validate_workflow(recipe, {"magnetic": source})
    assert result["state"] == "rejected"
    assert any(issue["code"] == "resource" for issue in result["issues"])


def test_shared_recipe_reference():
    fixture = json.loads((ROOT / "test/data/geophysics_workflow_reference.json").read_text())
    result = baselode.geophysics.run_workflow(fixture["workflow"], {"magnetic": baselode.geophysics.GeophysicsRaster.from_payload(fixture["input"])})
    assert result["state"] == "ok"
    for key, expected in fixture["outputs"].items():
        np.testing.assert_allclose(result["artifacts"][key].data, expected, rtol=1e-10, atol=1e-10)


@pytest.mark.parametrize("transform", [(10, 3, 0, 0, -10, 80), (1e200, 0, 0, 0, -1e200, 80)])
def test_sheared_or_overflowing_geometry_is_preflighted(transform):
    result = baselode.geophysics.run_workflow(single(), {"magnetic": grid().copy_with(transform=transform)})
    assert result["state"] == "rejected" and result["completed_steps"] == []


def test_rectangular_rotation_and_json_integer_numbers_are_supported():
    recipe = single("vertical_derivative", {"order": 1.0})
    recipe["version"] = 1.0
    recipe["steps"][0]["version"] = 1.0
    result = baselode.geophysics.run_workflow(recipe, {"magnetic": grid().copy_with(transform=(0, 10, 0, 10, 0, 80))})
    assert result["state"] == "ok"
    assert type(result["plan"][0]["parameters"]["order"]) is int


def test_fft_limits_follow_operation_padding_and_wavelength():
    source = grid().copy_with(np.ones((700, 700)))
    result = baselode.geophysics.validate_workflow(baselode.geophysics.magnetic_grid_recipe(), {"magnetic": source})
    assert result["state"] == "ok"
    assert result["resource_estimate"]["max_fft_cells_per_band"] == 2048 ** 2
    result = baselode.geophysics.validate_workflow(single("low_pass", {"wavelength": 10}), {"magnetic": source})
    assert result["state"] == "ok"
    assert result["resource_estimate"]["max_fft_cells_per_band"] == 1024 ** 2
    result = baselode.geophysics.validate_workflow(single("low_pass", {"wavelength": 10000}), {"magnetic": source})
    assert result["state"] == "rejected"
    assert result["resource_estimate"]["max_fft_cells_per_band"] == 4096 ** 2


def test_invalid_filter_geometry_remains_a_structured_preflight_failure():
    source = grid().copy_with(transform=(0, 0, 0, 0, 0, 0))
    assert baselode.geophysics.validate_workflow(single("low_pass", {"wavelength": 10}), {"magnetic": source})["state"] == "rejected"
