# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent alignment geometry, values, reprojection and lineage checks."""
import copy
import json
import math
import pathlib

import numpy as np
import pytest

import baselode.geophysics
import baselode.geophysics.sampling

ROOT = pathlib.Path(__file__).resolve().parents[1]


def raster():
    row, col = np.indices((4, 4), dtype=float)
    return baselode.geophysics.GeophysicsRaster(2 * (col + 0.5) + 3 * (4 - row - 0.5), transform=(1, 0, 0, 0, -1, 4),
        metadata={"units": ["nT"], "crs_units": "m", "frame_id": "survey-A", "field_type": "magnetic_anomaly", "corrections": {"igrf": "applied"}}, band_names=["mag"])


def target(**changes):
    return {"shape": [4, 4], "transform": [1, 0, 0, 0, -1, 4], "crs": None, "crs_units": "m", "frame_id": "survey-A", **changes}


def options(**changes):
    return {"method": "bilinear", "value_kind": "continuous", **changes}


def test_identity_shifted_plane_and_categorical_values():
    source = raster(); original = source.data.copy(); metadata = copy.deepcopy(source.metadata)
    result = baselode.geophysics.align_raster(source, target(), options())
    assert result["state"] == "ok", result["issues"]
    np.testing.assert_array_equal(result["artifacts"]["raster"].data, source.data)
    assert result["diagnostics"]["supported_per_band"] == [16]
    assert np.all(result["artifacts"]["support"].data == 1)
    shifted = baselode.geophysics.align_raster(source, target(shape=[2, 2], transform=[1, 0, 0.25, 0, -1, 3.75]), options())
    expected = [[2 * x + 3 * y for x in (0.75, 1.75)] for y in (3.25, 2.25)]
    np.testing.assert_allclose(shifted["artifacts"]["raster"].data[0], expected, atol=1e-12)
    np.testing.assert_array_equal(source.data, original); assert source.metadata == metadata
    categories = source.copy_with(np.arange(16).reshape(4, 4))
    result = baselode.geophysics.align_raster(categories, target(), options(method="nearest", value_kind="categorical"))
    np.testing.assert_array_equal(result["artifacts"]["raster"].data, categories.data)
    assert baselode.geophysics.align_raster(categories, target(), options(value_kind="categorical"))["state"] == "rejected"


@pytest.mark.parametrize("transform", [[0, 1, 0, 1, 0, 0], [1, 0.25, 0, 0, -1, 4]])
def test_rotated_and_sheared_geometry_identity_is_supported(transform):
    source = raster().copy_with(transform=transform)
    result = baselode.geophysics.align_raster(source, target(transform=transform), options())
    assert result["state"] == "ok"
    np.testing.assert_allclose(result["artifacts"]["raster"].data, source.data, atol=1e-12)


def test_reference_geometry_never_replaces_source_bands_or_scientific_metadata():
    source = raster()
    reference = baselode.geophysics.GeophysicsRaster(np.ones((2, 2, 2)), transform=(2, 0, 0, 0, -2, 4),
        band_names=["reference-1", "reference-2"], metadata={"frame_id": "survey-A", "crs_units": "m", "units": ["ppm", "ppm"], "field_type": "radiometric"})
    source_before, reference_before = source.to_payload(), reference.to_payload()
    result = baselode.geophysics.match_raster(source, reference, options())
    assert result["state"] == "ok"
    aligned = result["artifacts"]["raster"]
    assert aligned.data.shape == (1, 2, 2) and aligned.band_names == ("mag",)
    assert aligned.metadata["units"] == ["nT"] and aligned.metadata["field_type"] == "magnetic_anomaly"
    assert aligned.metadata["corrections"] == {"igrf": "applied"}
    assert aligned.transform == reference.transform
    assert source.to_payload() == source_before and reference.to_payload() == reference_before


def test_nodata_footprint_and_valid_coordinate_masks_are_distinct():
    source = raster(); source.data[0, 1, 1] = np.nan
    result = baselode.geophysics.align_raster(source, target(shape=[1, 3], transform=[1, 0, -1.5, 0, -1, 2.5]), options())
    assert result["state"] == "ok"
    assert result["artifacts"]["footprint"].data[0, 0].tolist() == [0, 1, 1]
    assert result["artifacts"]["coordinate_valid"].data[0, 0].tolist() == [1, 1, 1]
    assert result["artifacts"]["support"].data[0, 0].tolist() == [0, 1, 0]
    assert np.isnan(result["artifacts"]["raster"].data[0, 0, 0])
    source = raster(); source.data[0, 1, 1] = -9999; source.nodata = -9999
    result = baselode.geophysics.align_raster(source, target(shape=[1, 1], transform=[1, 0, 0.5, 0, -1, 3]), options())
    assert result["artifacts"]["support"].data.item() == 0  # contributing missing cell is never renormalized away


def test_backend_acknowledgement_and_independent_web_mercator_coordinates():
    # Web Mercator x=R*longitude, y=R*log(tan(pi/4+latitude/2)).
    source = raster().copy_with(crs="EPSG:4326", metadata={"units": ["nT"], "crs_units": "degree", "field_type": "magnetic_anomaly"})
    radius = 6378137
    x = radius * math.radians(1.5); y = radius * math.log(math.tan(math.pi / 4 + math.radians(2.5) / 2))
    grid = target(shape=[1, 1], transform=[100, 0, x - 50, 0, -100, y + 50], crs="EPSG:3857", crs_units="m", frame_id=None)
    assert baselode.geophysics.align_raster(source, grid, options())["state"] == "needs_input"
    result = baselode.geophysics.align_raster(source, grid, options(datum_policy="backend"))
    assert result["state"] == "ok", result["issues"]
    assert result["artifacts"]["raster"].data.item() == pytest.approx(2 * 1.5 + 3 * 2.5, abs=1e-8)
    assert result["artifacts"]["raster"].metadata["crs_units"] == "m"
    assert result["artifacts"]["raster"].metadata["units"] == ["nT"]
    assert result["diagnostics"]["backend"]["name"] == "pyproj"


def test_same_datum_utm_central_meridian_known_easting_northing():
    source = raster().copy_with(transform=(1, 0, 115, 0, -1, 2), crs="EPSG:4326", metadata={"units": ["nT"], "crs_units": "degree"})
    # UTM zone 50 north: equator / central meridian 117E is (500000, 0).
    grid = target(shape=[1, 1], transform=[10, 0, 499995, 0, -10, 5], crs="EPSG:32650", frame_id=None)
    result = baselode.geophysics.align_raster(source, grid, options(datum_policy="backend"))
    assert result["state"] == "ok"
    assert result["artifacts"]["raster"].data.item() == pytest.approx((source.data[0, 1, 1] + source.data[0, 1, 2] + source.data[0, 2, 1] + source.data[0, 2, 2]) / 4, abs=1e-8)


@pytest.mark.parametrize("extension", ["ers", "tif"])
def test_stale_geometry_uncertainty_and_history_survive_only_as_lineage(tmp_path, extension):
    source = raster().copy_with(crs="EPSG:28350", metadata={**raster().metadata, "driver": "old", "width": 4, "tags": {"old": "yes"}, "uncertainty": [[1, 2]], "source": "survey.ers"})
    result = baselode.geophysics.align_raster(source, target(shape=[2, 2], transform=[2, 0, 0, 0, -2, 4], crs="EPSG:28350", frame_id=None), options())
    aligned = result["artifacts"]["raster"]
    assert "uncertainty" not in aligned.metadata and "driver" not in aligned.metadata and "width" not in aligned.metadata
    assert aligned.metadata["uncertainty_propagated"] is False
    step = aligned.metadata["processing"][-1]
    old = aligned.metadata["input_lineage"][step["operand_lineage"]]["metadata"]
    assert old["uncertainty"] == [[1, 2]] and old["driver"] == "old"
    path = tmp_path / f"aligned.{extension}"; baselode.geophysics.save_raster(aligned, path, dtype="float64")
    restored = baselode.geophysics.load_raster(path)
    assert restored.metadata["processing"] == aligned.metadata["processing"]
    assert restored.metadata["input_lineage"] == aligned.metadata["input_lineage"]
    assert restored.metadata["corrections"] == {"igrf": "applied"}


@pytest.mark.parametrize("change", [{"method": "average"}, {"value_kind": "vector"}, {"datum_policy": "exact"}, {"method": None}, {"extra": 1}])
def test_bad_options_are_rejected_without_artifacts(change):
    result = baselode.geophysics.align_raster(raster(), target(), options(**change))
    assert result["state"] == "rejected" and result["artifacts"] == {}


def test_context_ambiguity_units_and_resource_guards():
    assert baselode.geophysics.align_raster(raster(), target(frame_id="different"), options())["state"] == "rejected"
    assert baselode.geophysics.align_raster(raster(), target(frame_id=None), options())["state"] == "needs_input"
    assert baselode.geophysics.align_raster(raster(), target(crs_units="ft"), options())["state"] == "rejected"
    assert baselode.geophysics.align_raster(raster(), target(shape=[1000, 1000]), options())["issues"][0]["code"] == "resource"
    assert baselode.geophysics.align_raster(raster(), target(transform=[0, 0, 0, 0, 0, 0]), options())["state"] == "rejected"
    assert baselode.geophysics.align_raster(raster(), target(crs="EPSG:3857", frame_id=None), options(datum_policy="backend"))["state"] == "needs_input"
    unknown = raster().copy_with(crs="EPSG:3577")
    assert baselode.geophysics.align_raster(unknown, target(crs="EPSG:3857", frame_id=None), options(datum_policy="backend"))["state"] == "rejected"
    assert baselode.geophysics.align_raster(unknown, target(crs="EPSG:3577", frame_id=None), options())["state"] == "ok"


def test_categorical_codes_and_large_nodata_sentinel():
    assert baselode.geophysics.align_raster(raster(), target(), options(method="nearest", value_kind="categorical"))["state"] == "rejected"
    source = raster().copy_with(np.full((4, 4), -1e300), nodata=-1e300)
    result = baselode.geophysics.align_raster(source, target(), options(method="nearest", value_kind="categorical"))
    assert result["state"] == "ok" and result["artifacts"]["support"].data.sum() == 0
    source = raster().copy_with(np.full((4, 4), 2 ** 53, dtype=np.uint64))
    assert baselode.geophysics.align_raster(source, target(), options(method="nearest", value_kind="categorical"))["state"] == "rejected"


def test_shared_descriptor_and_reference():
    name = "geophysics_alignment.json"
    assert json.loads((ROOT / "python/src/baselode/geophysics" / name).read_text()) == json.loads((ROOT / "javascript/packages/baselode/src/data" / name).read_text())
    assert baselode.geophysics.describe_alignment()["pixel_tolerance"] == baselode.geophysics.sampling._PIXEL_TOLERANCE
    reference = json.loads((ROOT / "test/data/geophysics_alignment_reference.json").read_text())
    source = baselode.geophysics.GeophysicsRaster.from_payload(reference["source"])
    result = baselode.geophysics.align_raster(source, reference["target"], reference["options"])
    for key, expected in reference["artifacts"].items():
        np.testing.assert_allclose(result["artifacts"][key].data, np.array(expected, dtype=float), rtol=1e-10, atol=1e-10)


def test_reference_only_supplies_geometry_even_with_opaque_scientific_metadata():
    source = raster()
    reference = source.copy_with(np.full((4, 4), 1e200), metadata={"frame_id": "survey-A", "crs_units": "m", "opaque": object()})
    result = baselode.geophysics.match_raster(source, reference, options())
    assert result["state"] == "ok"
    np.testing.assert_array_equal(result["artifacts"]["raster"].data, source.data)
    assert "opaque" not in result["artifacts"]["raster"].metadata


def test_python_geometry_tuples_and_constructor_numeric_crs_are_accepted():
    source = raster().copy_with(crs=28350)
    grid = {"shape": (4, 4), "transform": source.transform, "crs": "EPSG:28350"}
    result = baselode.geophysics.align_raster(source, grid, options())
    assert result["state"] == "ok"
    np.testing.assert_array_equal(result["artifacts"]["raster"].data, source.data)
    assert isinstance(grid["shape"], tuple) and isinstance(grid["transform"], tuple)
    assert baselode.geophysics.match_raster(source, source, options())["state"] == "ok"
    assert baselode.geophysics.align_raster(source, {**grid, "crs": 28350}, options())["state"] == "rejected"


def test_invalid_projection_domain_has_no_coordinate_or_sampling_support():
    source = raster().copy_with(crs="EPSG:3857")
    result = baselode.geophysics.align_raster(source, {
        "shape": [1, 1], "transform": [1, 0, 0, 0, -1, 101], "crs": "EPSG:4326",
    }, options(datum_policy="backend"))
    assert result["state"] == "ok"
    for key in ("support", "footprint", "coordinate_valid"):
        assert result["artifacts"][key].data.item() == 0
    assert np.isnan(result["artifacts"]["raster"].data.item())
