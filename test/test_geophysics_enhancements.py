# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

"""Potential-field enhancements: derivatives, tilt, analytic signal,
upward continuation and reduction to the pole."""

import math

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


def test_fourier_padding_mirrors_to_a_power_of_two():
    indices = baselode.geophysics.processing._symmetric_indices(3, 4, 16)
    assert indices.tolist() == [2, 2, 1, 0, 0, 1, 2, 2, 1, 0, 0, 1, 2, 2, 1, 0]
    values = np.arange(3.0)
    np.testing.assert_array_equal(values[indices[:11]], np.pad(values, (4, 4), mode="symmetric"))
    assert [baselode.geophysics.processing._fft_size(size) for size in (1, 2, 3, 64, 65)] == [1, 2, 4, 64, 128]
