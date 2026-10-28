# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

"""Hillshading and wavelength filtering for geophysics rasters.

Filters work in the 2-D Fourier domain with NumPy only.  Cut-offs are
wavelengths in the raster's CRS units (metres for MGA/UTM grids, degrees for
geographic grids).  Each filter's response is 0.5 at its cut-off wavelength:

- ``low_pass`` keeps long wavelengths (regional field).
- ``high_pass`` keeps short wavelengths (residual / near-surface detail).
- ``band_pass`` keeps wavelengths between two cut-offs.

Before the transform each band has a best-fit plane removed, missing cells
set to that plane, and the grid mirror-padded to reduce edge ringing.  Missing
cells stay missing in the output.  Mean-filling gaps is simple and honest but
can leave halos around large holes; grid the data first when gaps are large.
"""

import math

import numpy as np

import baselode.geophysics.colour_scales


FILTER_METHODS = ("gaussian", "butterworth")


def _band_values(values, nodata):
    """Return ``(float values, valid mask)``, masking in the source dtype."""
    valid = baselode.geophysics.colour_scales.valid_mask(values, nodata)
    return values.astype(float), valid


def _cell_size(raster):
    size = raster.cell_size
    if size is None:
        raise ValueError("raster needs an affine transform to define cell size")
    return size


def _neighbours(values, valid):
    """Return left/right/up/down neighbours and whether each exists.

    A neighbour off the grid or missing falls back to the centre value and is
    marked unavailable, so callers can take one-sided differences.
    """
    padded = np.pad(values, 1, mode="edge")
    padded_valid = np.pad(valid, 1, mode="constant", constant_values=False)
    windows = {
        "left": (slice(1, -1), slice(0, -2)),
        "right": (slice(1, -1), slice(2, None)),
        "up": (slice(0, -2), slice(1, -1)),
        "down": (slice(2, None), slice(1, -1)),
    }
    return {
        name: (np.where(padded_valid[window], padded[window], values), padded_valid[window])
        for name, window in windows.items()
    }


def _difference(near, before, after):
    """Central difference per cell, or one-sided where a neighbour is missing."""
    (low, has_low), (high, has_high) = near[before], near[after]
    spacing = has_low.astype(float) + has_high.astype(float)
    return np.divide(high - low, spacing, out=np.zeros_like(high), where=spacing > 0)


def _map_gradients(raster, values, valid):
    """Return ``(east, north)`` gradients in data units per CRS unit.

    Differences along columns and rows are converted to map axes with the
    affine transform, so azimuths stay geographic for south-up, west-up and
    rotated grids.  Unreferenced rasters use unit, north-up cells.
    """
    a, b, _, d, e, _ = raster.transform or (1.0, 0.0, 0.0, 0.0, -1.0, 0.0)
    determinant = a * e - b * d
    if determinant == 0:
        raise ValueError("raster transform is degenerate")
    filled = np.where(valid, values, 0.0)
    near = _neighbours(filled, valid)
    per_column = _difference(near, "left", "right")
    per_row = _difference(near, "up", "down")
    east = (e * per_column - d * per_row) / determinant
    north = (a * per_row - b * per_column) / determinant
    return east, north


def hillshade_z_factor(raster, band=1):
    """Return the automatic vertical exaggeration for :func:`hillshade`.

    Geophysical values (nT, mGal) and map distances (m) have unrelated units,
    so a fixed z-factor gives flat or saturated relief depending on the grid.
    The automatic factor scales the 95th-percentile gradient to a 45 degree
    slope, giving comparable relief on any grid.

    Parameters
    ----------
    raster : GeophysicsRaster
    band : int, optional
        One-based band number.

    Returns
    -------
    float
        Positive vertical exaggeration; 1.0 for a flat grid.
    """
    values, valid = _band_values(raster.band(band), raster.nodata)
    east, north = _map_gradients(raster, values, valid)
    magnitude = np.hypot(east, north)[valid]
    if magnitude.size == 0:
        return 1.0
    reference = float(np.percentile(magnitude, 95))
    return 1.0 / reference if reference > 0 else 1.0


def hillshade(raster, azimuth=315.0, altitude=45.0, z_factor="auto", band=1):
    """Compute an illumination grid for one raster band.

    Parameters
    ----------
    raster : GeophysicsRaster
    azimuth : float, optional
        Sun direction in degrees clockwise from north (default 315, NW).
    altitude : float, optional
        Sun elevation in degrees above the horizon, ``0 < altitude <= 90``.
        Lower sun angles exaggerate subtle features.
    z_factor : float or "auto", optional
        Vertical exaggeration applied to the data before computing slope.
        ``"auto"`` uses :func:`hillshade_z_factor`.
    band : int, optional
        One-based band number.

    Returns
    -------
    numpy.ndarray
        ``(row, column)`` illumination in ``0..1``; ``NaN`` for missing cells.
    """
    altitude = float(altitude)
    if not 0 < altitude <= 90:
        raise ValueError("altitude must be greater than 0 and at most 90 degrees")
    if z_factor == "auto":
        z_factor = hillshade_z_factor(raster, band)
    z_factor = float(z_factor)
    if not z_factor > 0:
        raise ValueError("z_factor must be positive or 'auto'")
    values, valid = _band_values(raster.band(band), raster.nodata)
    east, north = _map_gradients(raster, values, valid)
    # Horn/ESRI convention: dz/dy is measured southwards.
    dzdx = east * z_factor
    dzdy = -north * z_factor
    zenith = math.radians(90.0 - altitude)
    azimuth_math = math.radians(360.0 - float(azimuth) + 90.0)
    slope = np.arctan(np.hypot(dzdx, dzdy))
    aspect = np.arctan2(dzdy, -dzdx)
    intensity = (
        math.cos(zenith) * np.cos(slope)
        + math.sin(zenith) * np.sin(slope) * np.cos(azimuth_math - aspect)
    )
    return np.where(valid, np.clip(intensity, 0.0, 1.0), np.nan)


def _low_response(wavenumber, cutoff_wavelength, method, order):
    cutoff = 1.0 / cutoff_wavelength
    ratio = wavenumber / cutoff
    if method == "gaussian":
        return np.exp(-math.log(2.0) * ratio ** 2)
    return 1.0 / (1.0 + ratio ** (2 * order))


def _check_filter(method, order, *wavelengths):
    if method not in FILTER_METHODS:
        raise ValueError(f"method must be one of {FILTER_METHODS}, not {method!r}")
    if not (isinstance(order, int) and order >= 1):
        raise ValueError("order must be a positive integer")
    for wavelength in wavelengths:
        if not (np.isfinite(wavelength) and wavelength > 0):
            raise ValueError("cut-off wavelengths must be positive")


def _apply_filter(raster, response, keep_trend, longest_wavelength, step, detrend):
    cell_x, cell_y = _cell_size(raster)
    output = np.full(raster.data.shape, np.nan)
    for index in range(raster.band_count):
        values, valid = _band_values(raster.data[index], raster.nodata)
        if not valid.any():
            continue
        rows, columns = np.indices(values.shape)
        if detrend and valid.sum() >= 3:
            design = np.column_stack([
                columns[valid] * cell_x,
                rows[valid] * cell_y,
                np.ones(valid.sum()),
            ])
            coefficients = np.linalg.lstsq(design, values[valid], rcond=None)[0]
            trend = coefficients[0] * columns * cell_x + coefficients[1] * rows * cell_y + coefficients[2]
        else:
            trend = np.full(values.shape, values[valid].mean())
        residual = np.where(valid, values - trend, 0.0)

        # Pad by one cut-off wavelength, capped at the grid size.
        pad_rows = min(max(8, math.ceil(longest_wavelength / cell_y)), values.shape[0])
        pad_columns = min(max(8, math.ceil(longest_wavelength / cell_x)), values.shape[1])
        padded = np.pad(residual, ((pad_rows, pad_rows), (pad_columns, pad_columns)), mode="symmetric")
        wavenumber_y = np.fft.fftfreq(padded.shape[0], d=cell_y)
        wavenumber_x = np.fft.fftfreq(padded.shape[1], d=cell_x)
        wavenumber = np.hypot(*np.meshgrid(wavenumber_x, wavenumber_y))
        filtered = np.real(np.fft.ifft2(np.fft.fft2(padded) * response(wavenumber)))
        filtered = filtered[pad_rows:pad_rows + values.shape[0], pad_columns:pad_columns + values.shape[1]]
        if keep_trend:
            filtered = filtered + trend
        output[index] = np.where(valid, filtered, np.nan)
    return raster.copy_with(output, nodata=None, processing={**step, "detrend": bool(detrend)})


def low_pass(raster, wavelength, method="gaussian", order=4, detrend=True):
    """Keep features longer than ``wavelength`` (regional field).

    Parameters
    ----------
    raster : GeophysicsRaster
    wavelength : float
        Cut-off wavelength in CRS units; the response is 0.5 here.
    method : {"gaussian", "butterworth"}, optional
        Gaussian has no ringing; Butterworth gives a sharper cut-off whose
        steepness is set by ``order``.
    order : int, optional
        Butterworth order (ignored for Gaussian).
    detrend : bool, optional
        Remove a best-fit plane before filtering and restore it afterwards.

    Returns
    -------
    GeophysicsRaster
        Filtered copy of every band, with the step recorded in
        ``metadata["processing"]``.
    """
    _check_filter(method, order, wavelength)
    return _apply_filter(
        raster,
        lambda k: _low_response(k, wavelength, method, order),
        keep_trend=True,
        longest_wavelength=wavelength,
        step={"operation": "low_pass", "wavelength": float(wavelength), "method": method, "order": order},
        detrend=detrend,
    )


def high_pass(raster, wavelength, method="gaussian", order=4, detrend=True):
    """Keep features shorter than ``wavelength`` (residual field).

    Parameters
    ----------
    raster : GeophysicsRaster
    wavelength : float
        Cut-off wavelength in CRS units; the response is 0.5 here.
    method : {"gaussian", "butterworth"}, optional
        Filter shape; see :func:`low_pass`.
    order : int, optional
        Butterworth order (ignored for Gaussian).
    detrend : bool, optional
        Remove a best-fit plane before filtering.  The plane is a regional
        component, so it is not restored.

    Returns
    -------
    GeophysicsRaster
        Filtered copy of every band, centred near zero.
    """
    _check_filter(method, order, wavelength)
    return _apply_filter(
        raster,
        lambda k: 1.0 - _low_response(k, wavelength, method, order),
        keep_trend=False,
        longest_wavelength=wavelength,
        step={"operation": "high_pass", "wavelength": float(wavelength), "method": method, "order": order},
        detrend=detrend,
    )


def band_pass(raster, long_wavelength, short_wavelength, method="gaussian", order=4, detrend=True):
    """Keep features with wavelengths between two cut-offs.

    Parameters
    ----------
    raster : GeophysicsRaster
    long_wavelength : float
        Longest wavelength kept (high-pass cut-off), in CRS units.
    short_wavelength : float
        Shortest wavelength kept (low-pass cut-off); must be less than
        ``long_wavelength``.
    method : {"gaussian", "butterworth"}, optional
        Filter shape; see :func:`low_pass`.
    order : int, optional
        Butterworth order (ignored for Gaussian).
    detrend : bool, optional
        Remove a best-fit plane before filtering; it is not restored.

    Returns
    -------
    GeophysicsRaster
        Filtered copy of every band, centred near zero.
    """
    _check_filter(method, order, long_wavelength, short_wavelength)
    if not short_wavelength < long_wavelength:
        raise ValueError("short_wavelength must be less than long_wavelength")
    return _apply_filter(
        raster,
        lambda k: (1.0 - _low_response(k, long_wavelength, method, order))
        * _low_response(k, short_wavelength, method, order),
        keep_trend=False,
        longest_wavelength=long_wavelength,
        step={
            "operation": "band_pass",
            "long_wavelength": float(long_wavelength),
            "short_wavelength": float(short_wavelength),
            "method": method,
            "order": order,
        },
        detrend=detrend,
    )
