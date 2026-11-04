# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

"""Sampling geophysics rasters at points, table rows and along profiles."""

import numpy as np
import pandas as pd
import pyproj
import pytest

import baselode.geophysics


def _ramp(crs="EPSG:28350", nodata=None):
    # value = 10 * row + column, 10 m cells, top-left corner at (500000, 7000030)
    rows, columns = np.indices((3, 4), dtype=float)
    return baselode.geophysics.GeophysicsRaster(
        10 * rows + columns, transform=(10, 0, 500000, 0, -10, 7000030), crs=crs, nodata=nodata,
    )


def _xy(column, row):
    """Map coordinates of a continuous pixel position on ``_ramp``."""
    return 500000 + 10 * column, 7000030 - 10 * row


def test_bilinear_is_exact_on_a_linear_surface():
    raster = _ramp()
    x, y = _xy(np.array([0.5, 1.75, 2.5, 3.2]), np.array([0.5, 1.25, 2.0, 0.9]))
    expected = 10 * (np.array([0.5, 1.25, 2.0, 0.9]) - 0.5) + (np.array([0.5, 1.75, 2.5, 3.2]) - 0.5)
    np.testing.assert_allclose(baselode.geophysics.sample_points(raster, x, y), expected)


def test_nearest_returns_the_containing_cell():
    raster = _ramp()
    x, y = _xy(np.array([0.1, 1.9, 3.99]), np.array([0.2, 2.7, 1.5]))
    values = baselode.geophysics.sample_points(raster, x, y, method="nearest")
    np.testing.assert_array_equal(values, [0, 21, 13])


def test_edges_use_edge_cells_without_extrapolating():
    raster = _ramp()
    # Grid corners and half-cell margins clamp to the outer cell centres.
    x, y = _xy(np.array([0.0, 4.0, 0.2, 4.0]), np.array([0.0, 3.0, 1.5, 1.5]))
    np.testing.assert_allclose(baselode.geophysics.sample_points(raster, x, y), [0, 23, 10, 13])


def test_points_outside_the_grid_are_missing():
    raster = _ramp()
    x, y = _xy(np.array([-0.01, 4.01, 2.0, 2.0, np.nan]), np.array([1.0, 1.0, -0.5, 3.5, 1.0]))
    for method in baselode.geophysics.SAMPLING_METHODS:
        assert np.isnan(baselode.geophysics.sample_points(raster, x, y, method=method)).all()


def test_missing_cells_make_dependent_samples_missing():
    raster = _ramp(nodata=-99999)
    raster.data[0, 1, 1] = -99999
    raster.data[0, 2, 3] = np.nan
    x, y = _xy(np.array([1.5, 1.0, 0.5, 3.5, 2.5]), np.array([1.5, 1.0, 0.5, 2.5, 0.5]))
    values = baselode.geophysics.sample_points(raster, x, y)
    # On the missing centre, between it and a neighbour, a cell centre next to
    # it (unaffected), the NaN cell, and a point not touching either.
    assert np.isnan(values[0]) and np.isnan(values[1]) and np.isnan(values[3])
    assert values[2] == 0
    assert values[4] == 2
    nearest = baselode.geophysics.sample_points(raster, x, y, method="nearest")
    assert np.isnan(nearest[0]) and nearest[2] == 0


def test_scalars_and_shapes_are_preserved():
    raster = _ramp()
    x, y = _xy(1.5, 1.5)
    assert baselode.geophysics.sample_points(raster, x, y).shape == ()
    grid_x, grid_y = np.meshgrid(*_xy(np.array([0.5, 1.5]), np.array([0.5, 1.5, 2.5])))
    assert baselode.geophysics.sample_points(raster, grid_x, grid_y).shape == (3, 2)


def test_rotated_transform():
    # Rotate the ramp 30 degrees about its origin; sampling the rotated
    # position of a pixel must give the same value.
    angle = np.radians(30)
    a, b = 10 * np.cos(angle), 10 * np.sin(angle)
    raster = _ramp()
    rotated = raster.copy_with(transform=(a, b, 500000, b, -a, 7000030))
    column, row = 2.25, 1.6
    x = a * column + b * row + 500000
    y = b * column - a * row + 7000030
    assert baselode.geophysics.sample_points(rotated, x, y) == pytest.approx(10 * 1.1 + 1.75)


def test_points_are_reprojected_to_the_raster_crs():
    raster = _ramp()
    x, y = _xy(np.array([1.3, 2.6]), np.array([0.8, 2.1]))
    lon, lat = pyproj.Transformer.from_crs("EPSG:28350", "EPSG:4283", always_xy=True).transform(x, y)
    np.testing.assert_allclose(
        baselode.geophysics.sample_points(raster, lon, lat, crs="EPSG:4283"),
        baselode.geophysics.sample_points(raster, x, y),
        atol=1e-6,
    )
    # The same CRS spelled differently skips reprojection.
    np.testing.assert_array_equal(
        baselode.geophysics.sample_points(raster, x, y, crs=28350),
        baselode.geophysics.sample_points(raster, x, y),
    )


def test_crs_needs_a_referenced_raster():
    raster = _ramp(crs=None)
    with pytest.raises(ValueError, match="no CRS"):
        baselode.geophysics.sample_points(raster, 500005, 7000025, crs="EPSG:4283")
    unreferenced = baselode.geophysics.GeophysicsRaster(np.zeros((2, 2)))
    with pytest.raises(ValueError, match="no transform"):
        baselode.geophysics.sample_points(unreferenced, 0, 0)
    with pytest.raises(ValueError, match="method"):
        baselode.geophysics.sample_points(_ramp(), 0, 0, method="cubic")


def test_sample_table_adds_a_column_without_modifying_the_input():
    raster = _ramp()
    x, y = _xy(np.array([0.5, 1.5, 9.0]), np.array([0.5, 1.5, 1.0]))
    collars = pd.DataFrame({"hole_id": ["A", "B", "C"], "easting": x, "northing": y})
    sampled = baselode.geophysics.sample_table(raster, collars)
    assert list(collars.columns) == ["hole_id", "easting", "northing"]
    np.testing.assert_allclose(sampled["band_1"], [0, 11, np.nan])

    named = baselode.geophysics.sample_table(
        raster, collars.rename(columns={"easting": "x", "northing": "y"}),
        x_col="x", y_col="y", column="bouguer", method="nearest",
    )
    np.testing.assert_allclose(named["bouguer"], [0, 11, np.nan])
    with pytest.raises(KeyError, match="easting"):
        baselode.geophysics.sample_table(raster, pd.DataFrame({"x": [1]}))


def test_sample_table_samples_desurveyed_trace_stations():
    raster = _ramp()
    x, y = _xy(np.array([0.5, 1.0, 1.5]), np.array([0.5, 1.0, 1.5]))
    traces = pd.DataFrame({
        "hole_id": ["A"] * 3, "md": [0, 50, 100], "easting": x, "northing": y,
        "elevation": [300, 260, 220],
    })
    sampled = baselode.geophysics.sample_table(raster, traces, column="tmi")
    np.testing.assert_allclose(sampled["tmi"], [0, 5.5, 11])


def test_profile_stations_follow_bends_and_end_on_the_last_vertex():
    stations = baselode.geophysics.profile_stations([(0, 0), (30, 0), (30, 25)], 20)
    np.testing.assert_allclose(stations["distance"], [0, 20, 40, 55])
    np.testing.assert_allclose(stations["x"], [0, 20, 30, 30])
    np.testing.assert_allclose(stations["y"], [0, 0, 10, 25])
    exact = baselode.geophysics.profile_stations([(0, 0), (0, 0), (40, 0)], 10)
    np.testing.assert_allclose(exact["distance"], [0, 10, 20, 30, 40])


@pytest.mark.parametrize("vertices, spacing", [
    ([(0, 0)], 10),
    ([(0, 0), (0, 0)], 10),
    ([(0, 0), (10, 0)], 0),
    ([(0, 0), (np.nan, 0)], 5),
])
def test_profile_stations_reject_bad_input(vertices, spacing):
    with pytest.raises(ValueError):
        baselode.geophysics.profile_stations(vertices, spacing)


def test_sample_profile_across_the_grid():
    raster = _ramp()
    start, end = _xy(0.5, 1.5), _xy(3.5, 1.5)
    profile = baselode.geophysics.sample_profile(raster, [start, end], 10, column="tmi")
    assert list(profile.columns) == ["distance", "x", "y", "tmi"]
    np.testing.assert_allclose(profile["tmi"], [10, 11, 12, 13])


def test_cell_centres_survive_affine_rounding_on_rotated_grids():
    # A 30 degree rotation at projected coordinates maps the first cell centre
    # back to about (0.50000000002, 0.49999999996); it must still use only
    # that cell rather than its missing neighbours.
    angle = np.radians(30)
    a, b = 10 * np.cos(angle), 10 * np.sin(angle)
    raster = baselode.geophysics.GeophysicsRaster(
        np.array([[7.0, np.nan], [np.nan, np.nan]]), transform=(a, b, 500000, b, -a, 7000030),
    )
    x = a * 0.5 + b * 0.5 + 500000
    y = b * 0.5 - a * 0.5 + 7000030
    assert baselode.geophysics.sample_points(raster, x, y) == 7
    corner_x = a * 2 + b * 2 + 500000
    corner_y = b * 2 - a * 2 + 7000030
    assert np.isnan(baselode.geophysics.sample_points(raster, corner_x, corner_y))
    ramp = _ramp().copy_with(transform=(a, b, 500000, b, -a, 7000030))
    far_corner = (a * 4 + b * 3 + 500000, b * 4 - a * 3 + 7000030)
    assert baselode.geophysics.sample_points(ramp, *far_corner) == pytest.approx(23)


def test_float32_nodata_is_compared_in_the_band_dtype():
    data = np.array([[1.0, -1e32], [3.0, 4.0]], dtype=np.float32)
    raster = baselode.geophysics.GeophysicsRaster(data, transform=(1, 0, 0, 0, -1, 2), nodata=-1e32)
    assert np.isnan(baselode.geophysics.sample_points(raster, 1.5, 1.5, method="nearest"))
    assert np.isnan(baselode.geophysics.sample_points(raster, 1.0, 1.0))
    assert baselode.geophysics.sample_points(raster, 0.5, 0.5) == 3


@pytest.mark.parametrize("dtype", ["Float64", "Int64"])
def test_sample_table_keeps_missing_nullable_coordinates_missing(dtype):
    raster = baselode.geophysics.GeophysicsRaster(
        np.array([[1.0, 2.0], [3.0, 4.0]]), transform=(10, 0, 0, 0, -10, 20),
    )
    table = pd.DataFrame({
        "easting": pd.array([5, None, 15], dtype=dtype),
        "northing": pd.array([15, 15, None], dtype=dtype),
    })
    sampled = baselode.geophysics.sample_table(raster, table, method="nearest")
    np.testing.assert_array_equal(sampled["band_1"], [1.0, np.nan, np.nan])
