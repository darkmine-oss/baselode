# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd
"""Portable embedded lineage: scientific processing survives file interchange."""
import base64
import json
import pathlib
import subprocess

import numpy as np
import pytest
import rasterio

import baselode.geophysics
import baselode.geophysics.provenance


ROOT = pathlib.Path(__file__).resolve().parents[1]


def source_grid():
    return baselode.geophysics.GeophysicsRaster(
        np.arange(48.).reshape(2, 4, 6), transform=(10, 0, 400000, 0, -10, 6500000),
        crs="EPSG:28350", band_names=["magnetic", "auxiliary"],
        metadata={"units": ["nT", None], "source": "survey-α.ers", "calibration": {"note": "café 🧲"}},
    )


@pytest.mark.parametrize("extension", ["ers", "tif"])
def test_processing_and_sources_survive_repeated_exports(tmp_path, extension):
    source = source_grid()
    processed = baselode.geophysics.horizontal_derivative(source)
    expected = processed.metadata["processing"]
    for number in range(3):
        path = tmp_path / f"product-{number}.{extension}"
        baselode.geophysics.save_raster(processed, path, dtype="float64")
        processed = baselode.geophysics.load_raster(path)
        assert processed.metadata["processing"] == expected
        assert processed.metadata["calibration"] == source.metadata["calibration"]
        assert processed.metadata["units"] == ["nT/m", None]
        assert processed.metadata["source"] == str(path)
        manifest = processed.metadata["provenance"]
        assert manifest["version"] == 1
        assert manifest["producer"]["library"] == "baselode"
        assert manifest["export"]["dtype"] == "float64"
        assert manifest["sources"][0] == "survey-α.ers"
        assert len(manifest["sources"]) == number + 1
        assert "provenance" not in manifest["metadata"]
        assert "BASELODE_PROVENANCE" not in manifest["metadata"].get("tags", {})
        np.testing.assert_array_equal(processed.data, 0.1)
    assert "processing" not in source.metadata


@pytest.mark.parametrize("extension", ["ers", "tif"])
def test_selected_band_view_records_history_without_overwriting_units(tmp_path, extension):
    path = tmp_path / f"bands.{extension}"
    baselode.geophysics.save_raster(source_grid(), path)
    selected = baselode.geophysics.load_raster(path, bands=[2, 1])
    assert selected.metadata["processing"][-1] == {"operation": "select_bands", "bands": [2, 1]}
    assert selected.metadata["units"] == [None, "nT"]
    assert selected.band_names == ("auxiliary", "magnetic")
    assert selected.metadata["provenance"]["metadata"]["units"] == ["nT", None]


def test_multi_input_history_survives_export_without_sharing_mutable_steps(tmp_path):
    left = source_grid()
    right = baselode.geophysics.upward_continuation(source_grid(), 20)
    result = baselode.geophysics.combine(left, right, "subtract")
    right.metadata["processing"][0]["height"] = 999
    path = tmp_path / "residual.tif"
    baselode.geophysics.save_raster(result, path)
    restored = baselode.geophysics.load_raster(path)
    assert restored.metadata["input_lineage"][0]["metadata"]["processing"][0]["height"] == 20
    assert restored.metadata["processing"][-1]["operation"] == "subtract"


@pytest.mark.parametrize("value", [float("nan"), float("inf"), 2 ** 53 + 1, 2 ** 1024, {1: "nonstring key"}, {"x": object()}, {"processing": None}])
def test_invalid_metadata_fails_before_creating_files(tmp_path, value):
    grid = source_grid().copy_with(metadata={"bad": value} if not isinstance(value, dict) else value)
    for extension in ["ers", "tif"]:
        with pytest.raises((ValueError, TypeError), match="JSON|processing"):
            baselode.geophysics.save_raster(grid, tmp_path / f"bad.{extension}")
    assert list(tmp_path.iterdir()) == []


def test_malformed_and_future_manifests_are_not_silently_dropped(tmp_path):
    path = tmp_path / "future.ers"
    baselode.geophysics.save_raster(source_grid(), path)
    text = path.read_text(encoding="latin-1")
    token = baselode.geophysics.ers.parse_ers_header(text)["BASELODE_PROVENANCE"]
    manifest = json.loads(base64.b64decode(token))
    manifest["version"] = 2
    encoded = base64.b64encode(json.dumps(manifest).encode()).decode()
    path.write_text(text.replace(token, encoded), encoding="latin-1")
    with pytest.raises(ValueError, match="unsupported.*version"):
        baselode.geophysics.load_raster(path)
    path.write_text(text.replace(token, "not-base64!"), encoding="latin-1")
    with pytest.raises(ValueError, match="provenance"):
        baselode.geophysics.load_raster(path)
    tiff = tmp_path / "malformed.tif"
    baselode.geophysics.save_raster(source_grid(), tiff)
    with rasterio.open(tiff, "r+") as dataset:
        dataset.update_tags(BASELODE_PROVENANCE="!")
    with pytest.raises(ValueError, match="provenance"):
        baselode.geophysics.load_raster(tiff)


@pytest.mark.parametrize("extension", ["ers", "tif"])
def test_explicit_opt_out_still_produces_a_legacy_readable_file(tmp_path, extension):
    grid = baselode.geophysics.horizontal_derivative(source_grid())
    path = tmp_path / f"legacy.{extension}"
    baselode.geophysics.save_raster(grid, path, include_provenance=False)
    back = baselode.geophysics.load_raster(path)
    assert "provenance" not in back.metadata
    assert "processing" not in back.metadata


def test_python_and_javascript_files_keep_the_same_lineage(tmp_path):
    source = baselode.geophysics.horizontal_derivative(source_grid())
    baselode.geophysics.save_raster(source, tmp_path / "python.ers")
    baselode.geophysics.save_raster(source, tmp_path / "python.tif")
    writers = (ROOT / "javascript/packages/baselode/src/data/geophysicsWriters.js").as_uri()
    raster = (ROOT / "javascript/packages/baselode/src/data/geophysicsRaster.js").as_uri()
    ers = (ROOT / "javascript/packages/baselode/src/data/ersLoader.js").as_uri()
    code = f'''
import fs from 'node:fs';
import {{ encodeErs, encodeGeoTiff }} from {json.dumps(writers)};
import {{ loadGeoTiff }} from {json.dumps(raster)};
import {{ readErs }} from {json.dumps(ers)};
const directory = process.argv[1];
for (const extension of ['ers', 'tif']) {{
  const input = extension === 'ers'
    ? readErs(fs.readFileSync(directory + '/python.ers', 'latin1'), fs.readFileSync(directory + '/python'))
    : await loadGeoTiff(fs.readFileSync(directory + '/python.tif'));
  if (input.metadata.processing[0].operation !== 'horizontal_derivative') throw Error('lost processing');
  if (input.metadata.calibration.note !== 'café 🧲') throw Error('lost Unicode');
  if (extension === 'ers') {{
    const result = encodeErs(input, {{ dtype: 'float64' }});
    fs.writeFileSync(directory + '/javascript.ers', result.header, 'latin1');
    fs.writeFileSync(directory + '/javascript', Buffer.from(result.data));
  }} else fs.writeFileSync(directory + '/javascript.tif', Buffer.from(encodeGeoTiff(input, {{ dtype: 'float64' }})));
}}
'''
    subprocess.run(["node", "--input-type=module", "-e", code, str(tmp_path)], check=True, capture_output=True, text=True)
    for extension in ["ers", "tif"]:
        result = baselode.geophysics.load_raster(tmp_path / f"javascript.{extension}")
        assert result.metadata["processing"] == source.metadata["processing"]
        assert result.metadata["calibration"] == source.metadata["calibration"]
        assert result.metadata["provenance"]["producer"]["version"] == "unversioned"
        assert result.metadata["units"] == ["nT/m", None]
        assert result.band_names == source.band_names


def test_cross_format_metadata_is_historical_not_current(tmp_path):
    ers = tmp_path / "source.ers"
    tif = tmp_path / "result.tif"
    back = tmp_path / "back.ers"
    baselode.geophysics.save_raster(source_grid(), ers)
    original = baselode.geophysics.load_raster(ers)
    assert original.metadata["cell_type"] == "IEEE4ByteReal"
    baselode.geophysics.save_raster(original, tif, dtype="float64")
    converted = baselode.geophysics.load_raster(tif)
    assert "cell_type" not in converted.metadata
    assert "datum" not in converted.metadata
    assert converted.metadata["provenance"]["metadata"]["cell_type"] == "IEEE4ByteReal"
    baselode.geophysics.save_raster(converted, back)
    reread = baselode.geophysics.load_raster(back)
    assert "tags" not in reread.metadata
    assert "tags" in reread.metadata["provenance"]["metadata"]


def test_signed_source_references_are_redacted_without_mutating_the_input():
    url = "https://user:secret@example.com/survey.tif?X-Amz-Signature=token#fragment"
    metadata = {"source": url, "processing": [{"operation": "subtract", "operand_source": url}]}
    encoded = baselode.geophysics.provenance.encode(metadata, "GeoTIFF", "float32")
    manifest = json.loads(base64.b64decode(encoded))
    assert "secret" not in json.dumps(manifest) and "token" not in json.dumps(manifest)
    assert manifest["sources"] == ["https://example.com/survey.tif"]
    assert manifest["metadata"]["processing"][0]["operand_source"] == "https://example.com/survey.tif"
    assert metadata["source"] == url


def test_repeated_and_branching_combinations_use_flat_valid_references(tmp_path):
    grid = source_grid()
    for _ in range(16):
        grid = baselode.geophysics.combine(grid, grid, "add")
    assert len(grid.metadata["input_lineage"]) == 16
    assert len(json.dumps(grid.metadata)) < 50000
    assert grid.metadata["processing"][-1]["operand_lineage"] == 15
    right = baselode.geophysics.combine(source_grid(), source_grid(), "multiply")
    combined = baselode.geophysics.combine(grid, right, "subtract")
    index = combined.metadata["processing"][-1]["operand_lineage"]
    right_snapshot = combined.metadata["input_lineage"][index]["metadata"]
    assert right_snapshot["processing"][-1]["operation"] == "multiply"
    assert right_snapshot["processing"][-1]["operand_lineage"] == 0
    path = tmp_path / "graph.tif"
    baselode.geophysics.save_raster(combined, path, dtype="float64")
    assert baselode.geophysics.load_raster(path).metadata["input_lineage"] == combined.metadata["input_lineage"]


def test_invalid_graph_references_are_rejected_before_export(tmp_path):
    grid = source_grid().copy_with(metadata={"processing": [{"operation": "add", "operand_lineage": 123}]})
    with pytest.raises(ValueError, match="operand_lineage"):
        baselode.geophysics.save_raster(grid, tmp_path / "bad.tif")
    assert not (tmp_path / "bad.tif").exists()
