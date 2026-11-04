# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

"""Cropping, clipping, combining, gap-filling and writing geophysics rasters."""

import json
import pathlib

import numpy as np
import pytest
import rasterio
import shapely.geometry

import baselode.geophysics
import baselode.geophysics.writers


def _ramp(crs="EPSG:28350", nodata=None, transform=(10, 0, 500000, 0, -10, 7000040)):
    # value = 10 * row + column on a 4 x 5 grid of 10 m cells
    rows, columns = np.indices((4, 5), dtype=float)
    return baselode.geophysics.GeophysicsRaster(
        10 * rows + columns, transform=transform, crs=crs, nodata=nodata,
        band_names=["tmi"], metadata={"units": ["nT"], "source": "ramp.ers"},
    )


def _x(column):
    return 500000 + 10 * column


def _y(row):
    return 7000040 - 10 * row


def test_crop_keeps_whole_cells_that_overlap_the_box():
    raster = _ramp()
    cropped = baselode.geophysics.crop(raster, (_x(1.2), _y(2.5), _x(3.0), _y(0.5)))
    np.testing.assert_array_equal(cropped.data[0], [[1, 2], [11, 12], [21, 22]])
    assert cropped.transform == (10, 0, _x(1), 0, -10, _y(0))
    step = cropped.metadata["processing"][-1]
    assert step["operation"] == "crop" and step["window"] == [1, 0, 2, 3]
    assert cropped.metadata["units"] == ["nT"] and cropped.band_names == ("tmi",)
    # A box covering the grid returns all of it; one off the grid is an error.
    assert baselode.geophysics.crop(raster, (0, 0, 1e7, 1e7)).data.shape == (1, 4, 5)
    with pytest.raises(ValueError, match="overlap"):
        baselode.geophysics.crop(raster, (0, 0, 10, 10))
    with pytest.raises(ValueError, match="min_x"):
        baselode.geophysics.crop(raster, (_x(3), _y(3), _x(1), _y(1)))


def test_crop_bounds_on_cell_edges_do_not_add_neighbours():
    # A 30 degree rotation leaves affine rounding at projected coordinates.
    angle = np.radians(30)
    a, b = 10 * np.cos(angle), 10 * np.sin(angle)
    raster = _ramp(transform=(10, 0, 500000.1, 0, -10, 7000040.1))
    edges = (500000.1 + 10, 7000040.1 - 30, 500000.1 + 30, 7000040.1 - 10)
    assert baselode.geophysics.crop(raster, edges).metadata["processing"][-1]["window"] == [1, 1, 2, 2]
    rotated = _ramp(transform=(a, b, 500000, b, -a, 7000040))
    assert baselode.geophysics.crop(rotated, rotated.bounds).data.shape == (1, 4, 5)


def test_clip_masks_cells_outside_a_polygon_with_holes():
    raster = _ramp(nodata=-99999)
    raster.data[0, 0, 0] = -99999
    outer = [(_x(0), _y(0)), (_x(5), _y(0)), (_x(5), _y(4)), (_x(0), _y(4))]
    hole = [(_x(1), _y(1)), (_x(3), _y(1)), (_x(3), _y(3)), (_x(1), _y(3))]
    clipped = baselode.geophysics.clip(raster, [outer, hole])
    expected = 10 * np.indices((4, 5))[0] + np.indices((4, 5))[1]
    expected = expected.astype(float)
    expected[1:3, 1:3] = np.nan
    expected[0, 0] = np.nan
    np.testing.assert_array_equal(clipped.data[0], expected)
    assert clipped.nodata is None

    # Shapely and GeoJSON polygons work too, and crop to the polygon.
    triangle = shapely.geometry.Polygon([(_x(2), _y(0)), (_x(5), _y(0)), (_x(5), _y(3))])
    for polygon in (triangle, triangle.__geo_interface__):
        result = baselode.geophysics.clip(raster, polygon)
        assert result.data.shape == (1, 3, 3)
        assert result.transform == (10, 0, _x(2), 0, -10, _y(0))
        np.testing.assert_array_equal(np.isnan(result.data[0]), [
            [False, False, False],
            [True, False, False],
            [True, True, False],
        ])
    uncropped = baselode.geophysics.clip(raster, triangle, crop=False)
    assert uncropped.data.shape == (1, 4, 5)
    with pytest.raises(ValueError, match="cell centre"):
        baselode.geophysics.clip(raster, [(_x(0.1), _y(0.1)), (_x(0.3), _y(0.1)), (_x(0.2), _y(0.3))])
    with pytest.raises(ValueError, match="three"):
        baselode.geophysics.clip(raster, [(0, 0), (1, 1)])


def test_combine_aligned_rasters_and_numbers():
    raster = _ramp()
    regional = raster.copy_with(np.full((1, 4, 5), 3.0))
    regional.data[0, 1, 1] = np.nan
    residual = baselode.geophysics.combine(raster, regional, "subtract")
    np.testing.assert_array_equal(residual.data[0, 0], [-3, -2, -1, 0, 1])
    assert np.isnan(residual.data[0, 1, 1])
    assert residual.metadata["units"] == ["nT"]
    step = residual.metadata["processing"][-1]
    assert step == {"operation": "subtract", "operand": "raster", "operand_bands": ["tmi"], "operand_source": "ramp.ers"}

    scaled = baselode.geophysics.combine(raster, 2, "multiply")
    np.testing.assert_array_equal(scaled.data[0, 1], [20, 22, 24, 26, 28])
    assert scaled.metadata["units"] == [None]
    divided = baselode.geophysics.combine(raster, raster, "divide")
    assert np.isnan(divided.data[0, 0, 0]) and divided.data[0, 1, 1] == 1
    assert baselode.geophysics.combine(raster, 5, "add").metadata["processing"][-1] == {"operation": "add", "operand": 5.0}


def test_combine_rejects_misaligned_rasters():
    raster = _ramp()
    with pytest.raises(ValueError, match="same shape"):
        baselode.geophysics.combine(raster, baselode.geophysics.crop(raster, (_x(0), _y(2), _x(2), _y(0))), "add")
    with pytest.raises(ValueError, match="share a grid"):
        baselode.geophysics.combine(raster, raster.copy_with(transform=(10, 0, 500005, 0, -10, 7000040)), "add")
    with pytest.raises(ValueError, match="coordinate systems"):
        baselode.geophysics.combine(raster, raster.copy_with(crs="EPSG:28351"), "add")
    # The same CRS spelled differently is fine.
    baselode.geophysics.combine(raster, raster.copy_with(crs=28350), "add")
    with pytest.raises(ValueError, match="operation"):
        baselode.geophysics.combine(raster, 1, "power")
    with pytest.raises(ValueError, match="one band"):
        baselode.geophysics.combine(raster, raster.copy_with(np.zeros((2, 4, 5)), band_names=["a", "b"]), "add")


def test_fill_gaps_is_exact_on_planes_and_leaves_data_alone():
    raster = _ramp()
    raster.data[0, 1:3, 1:4] = np.nan
    filled = baselode.geophysics.fill_gaps(raster, iterations=300)
    rows, columns = np.indices((4, 5))
    np.testing.assert_allclose(filled.data[0], 10 * rows + columns, atol=1e-6)
    step = filled.metadata["processing"][-1]
    assert step["filled_cells"] == 6 and step["max_distance"] is None
    untouched = ~np.isnan(raster.data[0])
    np.testing.assert_array_equal(filled.data[0][untouched], raster.data[0][untouched])
    # The grid edge is a natural boundary: a gap in a corner settles at the
    # mean of its neighbours rather than extrapolating the slope.
    raster.data[0, 3, 0] = np.nan
    corner = baselode.geophysics.fill_gaps(raster, iterations=300).data[0, 3, 0]
    assert corner == pytest.approx((20 + 31) / 2, abs=1e-6)


def test_fill_gaps_max_distance_and_no_smoothing():
    data = np.full((7, 7), np.nan)
    data[0, :] = 1.0
    raster = baselode.geophysics.GeophysicsRaster(data, transform=(1, 0, 0, 0, -1, 7))
    near = baselode.geophysics.fill_gaps(raster, max_distance=2)
    assert np.isfinite(near.data[0, :3]).all() and np.isnan(near.data[0, 3:]).all()
    assert near.metadata["processing"][-1]["filled_cells"] == 14
    # Without smoothing the gaps take block means (here all 1).
    np.testing.assert_array_equal(baselode.geophysics.fill_gaps(raster, iterations=0).data[0], np.ones((7, 7)))
    with pytest.raises(ValueError, match="max_distance"):
        baselode.geophysics.fill_gaps(raster, max_distance=-1)
    with pytest.raises(ValueError, match="no data"):
        baselode.geophysics.fill_gaps(baselode.geophysics.GeophysicsRaster(np.full((2, 2), np.nan)))


def test_ers_round_trip(tmp_path):
    raster = _ramp(nodata=-99999)
    raster.data[0, 2, 2] = -99999
    header, data = baselode.geophysics.write_ers(raster, tmp_path / "grid.ers")
    assert data == tmp_path / "grid" and data.stat().st_size == 4 * 20
    back = baselode.geophysics.load_raster(header)
    assert back.crs == "EPSG:28350" and back.transform == raster.transform
    assert back.band_names == ("tmi",) and back.metadata["units"] == ["nT"]
    assert back.nodata == -99999 and np.isnan(back.data[0, 2, 2])
    np.testing.assert_array_equal(np.nan_to_num(back.data, nan=-99999), raster.data)
    # GDAL reads the same grid.
    with rasterio.open(header) as dataset:
        assert dataset.crs.to_epsg() == 28350
        assert tuple(dataset.transform)[:6] == raster.transform
        np.testing.assert_array_equal(dataset.read(1), raster.data[0])


@pytest.mark.parametrize("crs, coordinate_type", [
    ("EPSG:4283", "LATLONG"), ("EPSG:7850", "EN"), ("EPSG:32750", "EN"), (None, "RAW"), ("EPSG:3857", "RAW"),
])
def test_ers_coordinate_spaces_round_trip(tmp_path, crs, coordinate_type):
    transform = (0.0025, 0, 118.123456789, 0, -0.0025, -27.5) if coordinate_type == "LATLONG" else (25, 0, 400000, 0, -25, 7000000)
    raster = baselode.geophysics.GeophysicsRaster(np.arange(6.0).reshape(2, 3), transform=transform, crs=crs)
    baselode.geophysics.write_ers(raster, tmp_path / "grid.ers", dtype="float64")
    back = baselode.geophysics.load_raster(tmp_path / "grid.ers")
    assert back.metadata["coordinate_type"] == coordinate_type
    assert back.crs == (crs if coordinate_type != "RAW" else None)
    np.testing.assert_allclose(back.transform, transform, rtol=0, atol=1e-9)
    np.testing.assert_array_equal(back.data, raster.data)


def test_ers_rejects_what_it_cannot_store(tmp_path):
    angle = np.radians(10)
    rotated = _ramp(transform=(np.cos(angle), np.sin(angle), 0, np.sin(angle), -np.cos(angle), 0))
    with pytest.raises(ValueError, match="north-up"):
        baselode.geophysics.write_ers(rotated, tmp_path / "grid.ers")
    with pytest.raises(ValueError, match=".ers"):
        baselode.geophysics.write_ers(_ramp(), tmp_path / "grid.grd")
    with pytest.raises(ValueError, match="fit"):
        baselode.geophysics.write_ers(_ramp().copy_with(np.full((1, 4, 5), 300.0)), tmp_path / "grid.ers", dtype="uint8")
    gappy = _ramp()
    gappy.data[0, 0, 0] = np.nan
    with pytest.raises(ValueError, match="nodata"):
        baselode.geophysics.write_ers(gappy, tmp_path / "grid.ers", dtype="int16")
    baselode.geophysics.write_ers(gappy, tmp_path / "grid.ers", dtype="int16", nodata=-32768)
    assert np.isnan(baselode.geophysics.load_raster(tmp_path / "grid.ers").data[0, 0, 0])


def test_geotiff_round_trip(tmp_path):
    raster = _ramp()
    raster.data[0, 1, 1] = np.nan
    path = baselode.geophysics.save_raster(raster, tmp_path / "grid.tif")
    back = baselode.geophysics.load_raster(path)
    assert back.crs == "EPSG:28350" and back.transform == raster.transform
    assert back.band_names == ("tmi",)
    np.testing.assert_array_equal(back.data, raster.data)
    with rasterio.open(path) as dataset:
        assert dataset.units == ("nT",) and dataset.dtypes == ("float32",)
    with pytest.raises(ValueError, match="format"):
        baselode.geophysics.save_raster(raster, tmp_path / "grid.grd")


def test_ers_names_for_crs():
    space = baselode.geophysics.writers.ers_coordinate_space
    assert space("EPSG:28350") == ("GDA94", "MGA50", "EN")
    assert space(7844) == ("GDA2020", "GEODETIC", "LATLONG")
    assert space("EPSG:20251") == ("AGD66", "AMG51", "EN")
    assert space("EPSG:20351") == ("AGD84", "AMG51", "EN")
    assert space("EPSG:32601") == ("WGS84", "NUTM1", "EN")
    assert space("EPSG:3577") == ("RAW", "RAW", "RAW")


DATA_DIR = pathlib.Path(__file__).resolve().parent / "data"


def _js_written_source():
    reference = json.loads((DATA_DIR / "geophysics_reference.json").read_text())
    return baselode.geophysics.GeophysicsRaster.from_payload(reference["editing"]["ersWriter"]["raster"])


@pytest.mark.parametrize("name", ["geophysics_js_written.tif", "geophysics_js_written.ers"])
def test_gdal_reads_files_written_by_javascript(name):
    # Written by encodeGeoTiff / encodeErs in
    # javascript/packages/baselode/tests/geophysicsEditing.test.js.
    source = _js_written_source()
    raster = baselode.geophysics.load_raster(DATA_DIR / name)
    assert raster.crs == "EPSG:28350"
    assert raster.transform == pytest.approx(source.transform)
    assert raster.band_names == source.band_names
    np.testing.assert_allclose(raster.data, source.data.astype(np.float32), equal_nan=True)
    with rasterio.open(DATA_DIR / name) as dataset:
        assert dataset.crs.to_epsg() == 28350 and dataset.dtypes == ("float32",)
        assert dataset.units == ("nT",)
        assert np.isnan(dataset.read(1, masked=True).filled(np.nan)[1, 1])


def test_writers_refuse_to_turn_data_into_nulls(tmp_path):
    # The default ERS null must not mask a real -99999 sample.
    raster = baselode.geophysics.GeophysicsRaster(np.array([[-99999.0, 1.0]]), transform=(1, 0, 0, 0, -1, 1))
    with pytest.raises(ValueError, match="also occurs as data"):
        baselode.geophysics.write_ers(raster, tmp_path / "grid.ers")
    baselode.geophysics.write_ers(raster, tmp_path / "grid.ers", nodata=-1e30)
    np.testing.assert_array_equal(baselode.geophysics.load_raster(tmp_path / "grid.ers").data, raster.data)
    # GeoTIFF's default NaN cannot collide.
    baselode.geophysics.write_geotiff(raster, tmp_path / "grid.tif")
    # An integer null that does not fit the type is refused, not wrapped.
    gappy = baselode.geophysics.GeophysicsRaster(np.array([[np.nan, 1.0]]), transform=(1, 0, 0, 0, -1, 1))
    with pytest.raises(ValueError, match="does not fit uint8"):
        baselode.geophysics.write_ers(gappy, tmp_path / "grid.ers", dtype="uint8", nodata=-99999)


def test_writers_refuse_values_too_large_for_float32(tmp_path):
    raster = baselode.geophysics.GeophysicsRaster(np.array([[1e40, 1.0]]), transform=(1, 0, 0, 0, -1, 1))
    with pytest.raises(ValueError, match="float64"):
        baselode.geophysics.write_ers(raster, tmp_path / "grid.ers")
    baselode.geophysics.write_ers(raster, tmp_path / "grid.ers", dtype="float64")
    assert baselode.geophysics.load_raster(tmp_path / "grid.ers").data[0, 0, 0] == 1e40
    with pytest.raises(ValueError, match="too large"):
        baselode.geophysics.write_ers(raster.copy_with(np.array([[np.nan, 1.0]])), tmp_path / "grid.ers", nodata=-1e40)
