# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

"""Potential-field enhancements: derivatives, tilt, analytic signal,
upward continuation and reduction to the pole."""

import math
import json
import pathlib

import numpy as np
import pytest

import baselode.geophysics
import baselode.geophysics.processing


CELL = 10.0
NORTH_UP = (CELL, 0.0, 500000.0, 0.0, -CELL, 7000000.0)
SOUTH_UP = (CELL, 0.0, 500000.0, 0.0, CELL, 6990000.0)


def raster_of(values, transform=NORTH_UP):
    return baselode.geophysics.GeophysicsRaster(values, transform=transform)


def cosine_grid(wavelength_cells, shape=(64, 64)):
    """A wave travelling east: values vary along columns only."""
    _, columns = np.indices(shape, dtype=float)
    return np.cos(2 * math.pi * columns / wavelength_cells)


def gaussian_bump(shape=(96, 96), width=6.0):
    rows, columns = np.indices(shape, dtype=float)
    centre_row, centre_column = (shape[0] - 1) / 2, (shape[1] - 1) / 2
    return 100.0 * np.exp(-((rows - centre_row) ** 2 + (columns - centre_column) ** 2) / (2 * width ** 2))


def dipole_tmi(inclination, declination, shape=(128, 128), source=(64, 64), depth=60.0):
    """Total-field anomaly of an induced point dipole below a north-up grid."""
    rows, columns = np.indices(shape, dtype=float)
    east = (columns - source[1]) * CELL
    north = -(rows - source[0]) * CELL
    down = np.full(shape, -depth)  # observation is above the source
    i, d = math.radians(inclination), math.radians(declination)
    field = np.array([math.cos(i) * math.sin(d), math.cos(i) * math.cos(d), math.sin(i)])
    distance = np.sqrt(east ** 2 + north ** 2 + down ** 2)
    along = (field[0] * east + field[1] * north + field[2] * down) / distance
    # B = 3 (m.r) r - m over r**3 with m along the field; TMI = B . field.
    return 1e7 * (3 * along ** 2 - 1) / distance ** 3


def interior(values, margin=16):
    return values[margin:-margin, margin:-margin]


def test_vertical_derivatives_scale_a_wave_by_its_wavenumber():
    wavelength = 16
    values = cosine_grid(wavelength)
    wavenumber = 2 * math.pi / (wavelength * CELL)
    first = baselode.geophysics.vertical_derivative(raster_of(values)).band(1)
    second = baselode.geophysics.vertical_derivative(raster_of(values), order=2).band(1)
    np.testing.assert_allclose(interior(first), interior(wavenumber * values), atol=0.02 * wavenumber)
    np.testing.assert_allclose(interior(second), interior(wavenumber ** 2 * values), atol=0.02 * wavenumber ** 2)


def test_upward_continuation_attenuates_by_exp_minus_k_height():
    wavelength = 16
    values = cosine_grid(wavelength) + 500.0
    height = 25.0
    continued = baselode.geophysics.upward_continuation(raster_of(values), height)
    factor = math.exp(-2 * math.pi * height / (wavelength * CELL))
    np.testing.assert_allclose(interior(continued.band(1)), interior(500.0 + factor * (values - 500.0)), atol=0.01)
    assert continued.metadata["processing"][-1] == {"operation": "upward_continuation", "height": 25.0}


@pytest.mark.parametrize("transform", [NORTH_UP, SOUTH_UP])
def test_horizontal_derivatives_follow_map_axes(transform):
    rows, columns = np.indices((20, 30), dtype=float)
    x = transform[2] + transform[0] * (columns + 0.5)
    y = transform[5] + transform[4] * (rows + 0.5)
    values = 0.3 * x - 0.2 * y
    raster = raster_of(values, transform)
    np.testing.assert_allclose(baselode.geophysics.horizontal_derivative(raster, "east").band(1), 0.3)
    np.testing.assert_allclose(baselode.geophysics.horizontal_derivative(raster, "north").band(1), -0.2)
    np.testing.assert_allclose(baselode.geophysics.total_horizontal_derivative(raster).band(1), math.hypot(0.3, 0.2))
    with pytest.raises(ValueError, match="direction"):
        baselode.geophysics.horizontal_derivative(raster, "up")


def test_tilt_is_positive_over_a_source_and_negative_away_from_it():
    tilt = baselode.geophysics.tilt_derivative(raster_of(gaussian_bump())).band(1)
    assert np.nanmax(np.abs(tilt)) <= 90
    assert tilt[47:49, 47:49].min() > 80
    assert tilt[47, 47 + 15] < 0
    assert tilt[47 + 15, 47] < 0


def test_tilt_of_a_flat_field_is_zero_not_rounding_noise():
    flat = baselode.geophysics.GeophysicsRaster(np.full((8, 8), 50000.0), transform=(10, 0, 0, 0, -10, 0))
    np.testing.assert_array_equal(baselode.geophysics.tilt_derivative(flat).band(1), 0.0)


def test_analytic_signal_is_the_total_gradient():
    raster = raster_of(gaussian_bump())
    signal = baselode.geophysics.analytic_signal(raster).band(1)
    horizontal = baselode.geophysics.total_horizontal_derivative(raster).band(1)
    vertical = baselode.geophysics.vertical_derivative(raster).band(1)
    np.testing.assert_allclose(signal, np.sqrt(horizontal ** 2 + vertical ** 2))
    assert (signal >= horizontal).all()


@pytest.mark.parametrize(("inclination", "declination"), [(-55.0, 2.0), (-30.0, 20.0), (60.0, -10.0)])
def test_reduction_to_pole_centres_a_dipole_anomaly_over_its_source(inclination, declination):
    tmi = dipole_tmi(inclination, declination)
    reduced = baselode.geophysics.reduce_to_pole(raster_of(tmi), inclination, declination).band(1)
    expected_pole = dipole_tmi(90.0, 0.0)
    peak = np.unravel_index(np.argmax(reduced), reduced.shape)
    assert abs(peak[0] - 64) <= 1 and abs(peak[1] - 64) <= 1
    assert reduced.max() > 3 * abs(reduced.min())
    # Matches the anomaly the same source gives at the pole.
    np.testing.assert_allclose(interior(reduced, 32), interior(expected_pole, 32), atol=0.03 * expected_pole.max())
    # The unreduced anomaly is visibly offset at these inclinations.
    original_peak = np.unravel_index(np.argmax(tmi), tmi.shape)
    assert original_peak != peak


def test_reduction_to_pole_is_identity_at_the_pole_and_rejects_low_latitudes():
    values = gaussian_bump() + 50000.0
    for inclination in (90.0, -90.0):
        reduced = baselode.geophysics.reduce_to_pole(raster_of(values), inclination, 0.0)
        np.testing.assert_allclose(reduced.band(1), values, rtol=1e-12)
    with pytest.raises(ValueError, match="unstable"):
        baselode.geophysics.reduce_to_pole(raster_of(values), -10.0, 0.0)
    with pytest.raises(ValueError, match="between -90 and 90"):
        baselode.geophysics.reduce_to_pole(raster_of(values), 120.0, 0.0)


def test_enhancements_keep_gaps_record_steps_and_validate_inputs():
    values = gaussian_bump()
    values[10, 12] = np.nan
    values[40, 50] = -99999.0
    raster = baselode.geophysics.GeophysicsRaster(values, transform=NORTH_UP, nodata=-99999.0)
    operations = [
        (baselode.geophysics.vertical_derivative, {"order": 2}),
        (baselode.geophysics.horizontal_derivative, {"direction": "north"}),
        (baselode.geophysics.total_horizontal_derivative, {}),
        (baselode.geophysics.tilt_derivative, {}),
        (baselode.geophysics.analytic_signal, {}),
        (baselode.geophysics.upward_continuation, {"height": 30.0}),
        (baselode.geophysics.reduce_to_pole, {"inclination": -55.0, "declination": 1.0}),
    ]
    for function, options in operations:
        result = function(raster, **options)
        band = result.band(1)
        assert np.isnan(band[10, 12]) and np.isnan(band[40, 50]), function.__name__
        assert np.isfinite(band).sum() == values.size - 2, function.__name__
        assert result.nodata is None
        assert result.metadata["processing"][-1] == {"operation": function.__name__, **options}

    with pytest.raises(ValueError, match="order"):
        baselode.geophysics.vertical_derivative(raster, order=0)
    with pytest.raises(ValueError, match="height"):
        baselode.geophysics.upward_continuation(raster, -5)
    with pytest.raises(ValueError, match="transform"):
        baselode.geophysics.vertical_derivative(baselode.geophysics.GeophysicsRaster(gaussian_bump()))


def test_fourier_operations_keep_a_symmetric_anomaly_symmetric():
    rows, columns = np.indices((96, 96), dtype=float)
    values = np.exp(-((rows - 47.5) ** 2 + (columns - 47.5) ** 2) / (2 * 12.0 ** 2))
    raster = baselode.geophysics.GeophysicsRaster(values, transform=(1, 0, 0, 0, -1, 96))
    for result in (
        baselode.geophysics.upward_continuation(raster, 24),
        baselode.geophysics.vertical_derivative(raster),
        baselode.geophysics.low_pass(raster, 20),
    ):
        band = result.band(1)
        np.testing.assert_allclose(band, band[::-1, ::-1], atol=1e-12)
        np.testing.assert_allclose(band, band.T, atol=1e-12)


def test_fourier_padding_mirrors_to_a_power_of_two():
    indices = baselode.geophysics.processing._symmetric_indices(3, 4, 16)
    assert indices.tolist() == [2, 2, 1, 0, 0, 1, 2, 2, 1, 0, 0, 1, 2, 2, 1, 0]
    values = np.arange(3.0)
    np.testing.assert_array_equal(values[indices[:11]], np.pad(values, (4, 4), mode="symmetric"))
    assert [baselode.geophysics.processing._fft_size(size) for size in (1, 2, 3, 64, 65)] == [1, 2, 4, 64, 128]


@pytest.mark.parametrize("crs, declared, denominator", [
    ("EPSG:28350", None, "m"),
    (None, "metre", "m"),
    (None, None, "coordinate_unit"),
    ("+proj=utm +zone=50 +south +datum=WGS84 +units=us-ft", "us_survey_foot", "us-ft"),
])
def test_derived_units_follow_coordinates_and_reach_display(crs, declared, denominator):
    metadata = {"units": ["nT", None]}
    if declared:
        metadata["crs_units"] = declared
    raster = baselode.geophysics.GeophysicsRaster(
        np.stack([gaussian_bump((16, 16)), np.ones((16, 16))]),
        transform=NORTH_UP, crs=crs, metadata=metadata,
    )
    for operation in ("horizontal_derivative", "vertical_derivative",
                      "total_horizontal_derivative", "analytic_signal"):
        result = getattr(baselode.geophysics, operation)(raster)
        assert result.metadata["units"] == [f"nT/{denominator}", None]
        assert result.to_tool_ui_payload()["units"] == f"nT/{denominator}"
    second = baselode.geophysics.vertical_derivative(raster, order=2)
    assert second.metadata["units"] == [f"nT/{denominator}^2", None]
    tilt = baselode.geophysics.tilt_derivative(raster)
    assert tilt.metadata["units"] == ["degree", "degree"]
    assert tilt.to_tool_ui_payload()["units"] == "degree"
    assert baselode.geophysics.upward_continuation(raster, 20).metadata["units"] == ["nT", None]
    assert raster.metadata == metadata


@pytest.mark.parametrize("crs, units", [
    ("EPSG:4326", None), ("EPSG:4283", "metre"),
    ("EPSG:4978", None), (None, "degree"), ("EPSG:28350", "foot"),
])
def test_scientific_processing_rejects_non_cartesian_or_conflicting_units(crs, units):
    raster = baselode.geophysics.GeophysicsRaster(
        np.ones((8, 8)), transform=NORTH_UP, crs=crs, metadata={"crs_units": units},
    )
    operations = [
        lambda: baselode.geophysics.low_pass(raster, 100),
        lambda: baselode.geophysics.high_pass(raster, 100),
        lambda: baselode.geophysics.band_pass(raster, 100, 20),
        lambda: baselode.geophysics.horizontal_derivative(raster),
        lambda: baselode.geophysics.vertical_derivative(raster),
        lambda: baselode.geophysics.total_horizontal_derivative(raster),
        lambda: baselode.geophysics.tilt_derivative(raster),
        lambda: baselode.geophysics.analytic_signal(raster),
        lambda: baselode.geophysics.upward_continuation(raster, 100),
        lambda: baselode.geophysics.reduce_to_pole(raster, -55, 0),
    ]
    for operation in operations:
        with pytest.raises(ValueError, match="projected|linear|conflicts"):
            operation()
    # Rendering existing geographic grids remains supported.
    assert np.isfinite(baselode.geophysics.hillshade(raster)).all()


def test_derivative_of_a_metric_plane_has_physical_value_and_units():
    rows, columns = np.indices((8, 8), dtype=float)
    raster = baselode.geophysics.GeophysicsRaster(
        3 * CELL * columns - 2 * CELL * rows, transform=NORTH_UP,
        crs="EPSG:28350", metadata={"units": ["nT"]},
    )
    east = baselode.geophysics.horizontal_derivative(raster)
    north = baselode.geophysics.horizontal_derivative(raster, "north")
    np.testing.assert_allclose(east.band(1), 3)
    np.testing.assert_allclose(north.band(1), 2)
    assert east.metadata["units"] == north.metadata["units"] == ["nT/m"]
    repeated = baselode.geophysics.horizontal_derivative(east)
    assert repeated.metadata["units"] == ["(nT/m)/m"]


@pytest.mark.parametrize("extension", ["ers", "tif"])
def test_written_derivative_preserves_corrected_band_units(tmp_path, extension):
    raster = baselode.geophysics.GeophysicsRaster(
        gaussian_bump((16, 16)), transform=NORTH_UP, crs="EPSG:28350",
        metadata={"units": ["nT"]},
    )
    derivative = baselode.geophysics.vertical_derivative(raster)
    path = tmp_path / f"derivative.{extension}"
    baselode.geophysics.save_raster(derivative, path)
    loaded = baselode.geophysics.load_raster(path)
    assert loaded.metadata["units"] == ["nT/m"]
    np.testing.assert_allclose(loaded.data, derivative.data, rtol=1e-6)


def test_geotiff_band_selection_reorders_units_with_data(tmp_path):
    raster = baselode.geophysics.GeophysicsRaster(
        np.stack([np.ones((2, 2)), np.full((2, 2), 2)]),
        transform=NORTH_UP, crs="EPSG:28350", metadata={"units": ["nT/m", "degree"]},
    )
    path = tmp_path / "bands.tif"
    baselode.geophysics.save_raster(raster, path)
    selected = baselode.geophysics.load_raster(path, bands=[2, 1])
    assert selected.metadata["units"] == ["degree", "nT/m"]
    np.testing.assert_array_equal(selected.data, raster.data[[1, 0]])


def test_esri_foot_alias_and_missing_geotiff_band_units(tmp_path):
    raster = baselode.geophysics.GeophysicsRaster(
        gaussian_bump((8, 8)), transform=NORTH_UP,
        metadata={"crs_units": "Foot_US", "units": ["nT"]},
    )
    assert baselode.geophysics.horizontal_derivative(raster).metadata["units"] == ["nT/us-ft"]
    path = tmp_path / "unitless.tif"
    baselode.geophysics.save_raster(raster.copy_with(metadata={}), path)
    assert baselode.geophysics.load_raster(path).metadata["units"] == [None]


def test_esri_wkt_foot_unit_is_recognised():
    fixture = json.loads((pathlib.Path(__file__).parent / "data" / "geophysics_foot_crs.json").read_text())
    raster = baselode.geophysics.GeophysicsRaster(
        gaussian_bump((8, 8)), transform=NORTH_UP, crs=fixture["crs"], metadata={"units": ["nT"]},
    )
    assert baselode.geophysics.horizontal_derivative(raster).metadata["units"] == ["nT/us-ft"]


def test_local_engineering_crs_uses_its_linear_axes():
    fixture = json.loads((pathlib.Path(__file__).parent / "data" / "geophysics_local_crs.json").read_text())
    raster = baselode.geophysics.GeophysicsRaster(
        np.tile(np.arange(8) * 30., (8, 1)), transform=NORTH_UP,
        crs=fixture["crs"], metadata={"units": ["nT"], "crs_units": "metre"},
    )
    gradient = baselode.geophysics.horizontal_derivative(raster)
    assert gradient.metadata["units"] == ["nT/m"]
    np.testing.assert_array_equal(gradient.data, 3.)
    assert baselode.geophysics.low_pass(raster, 100).crs == raster.crs


def test_unresolved_external_crs_requires_explicit_linear_units():
    raster = baselode.geophysics.GeophysicsRaster(
        np.tile(np.arange(8) * 30., (8, 1)), transform=NORTH_UP,
        crs="vendor:local-grid", metadata={"units": ["nT"], "crs_units": "metre"},
    )
    gradient = baselode.geophysics.horizontal_derivative(raster)
    assert gradient.metadata["units"] == ["nT/m"]
    np.testing.assert_array_equal(gradient.data, 3.)
    with pytest.raises(ValueError, match="explicit linear"):
        baselode.geophysics.horizontal_derivative(raster.copy_with(metadata={}))
