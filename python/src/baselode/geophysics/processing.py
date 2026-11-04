# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

"""Hillshading, wavelength filters and potential-field enhancements.

Fourier-domain operations use NumPy only.  Distances (cut-off wavelengths,
continuation heights) are in the raster's CRS units: metres for MGA/UTM
grids, degrees for geographic grids.  Derivatives are per CRS unit.

Wavelength filters have a response of 0.5 at their cut-off:

- ``low_pass`` keeps long wavelengths (regional field).
- ``high_pass`` keeps short wavelengths (residual / near-surface detail).
- ``band_pass`` keeps wavelengths between two cut-offs.

Potential-field enhancements:

- ``vertical_derivative`` (1VD, 2VD) sharpens shallow sources.
- ``horizontal_derivative`` and ``total_horizontal_derivative`` peak over
  contacts and edges.
- ``tilt_derivative`` balances strong and weak anomalies; zero over edges.
- ``analytic_signal`` peaks over magnetic sources whatever the
  magnetisation direction.
- ``upward_continuation`` smooths the field as if measured higher up,
  separating regional from local sources.
- ``reduce_to_pole`` moves magnetic anomalies over their sources.

Before a Fourier transform each band has a best-fit plane removed, missing
cells set to that plane, and the grid mirror-padded to a power-of-two size to
reduce edge ringing.  Missing cells stay missing in the output.  Plane-filling
gaps is simple and honest but can leave halos around large holes; grid the
data first when gaps are large.
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


def _fft_size(size):
    """Return the smallest power of two that is at least ``size``."""
    return 1 << max(0, (size - 1).bit_length())


def _symmetric_indices(size, before, total):
    """Source indices that mirror-pad an axis of ``size`` cells.

    The axis is extended ``before`` cells at the start and to ``total`` cells
    overall, repeating edge cells (NumPy's ``symmetric`` mode) as far as
    needed.
    """
    period = 2 * size
    offsets = np.mod(np.arange(total) - before, period)
    return np.where(offsets < size, offsets, period - 1 - offsets)


def _pad_cells(length, spacing, size):
    """Minimum cells of padding each side of an axis: one ``length`` (default half the axis)."""
    cells = size // 2 if length is None else math.ceil(length / spacing)
    return min(max(8, cells), size)


def _map_wavenumbers(raster, shape):
    """Return ``(east, north)`` wavenumbers, in cycles per CRS unit.

    Index-domain frequencies are converted with the inverse transpose of the
    affine transform, so directional operators stay geographic for south-up
    and rotated grids.
    """
    a, b, _, d, e, _ = raster.transform
    determinant = a * e - b * d
    if determinant == 0:
        raise ValueError("raster transform is degenerate")
    per_column, per_row = np.meshgrid(np.fft.fftfreq(shape[1]), np.fft.fftfreq(shape[0]))
    east = (e * per_column - d * per_row) / determinant
    north = (a * per_row - b * per_column) / determinant
    return east, north


def _plane(values, valid):
    """Best-fit plane over valid cells, fitted in centred cell indices.

    A plane in cell indices is the same surface as a plane in map
    coordinates, and centring keeps the fit well conditioned.  Returns
    ``None`` when the valid cells lie on one line and define no plane.
    """
    rows, columns = np.indices(values.shape, dtype=float)
    rows -= (values.shape[0] - 1) / 2.0
    columns -= (values.shape[1] - 1) / 2.0
    design = np.column_stack([columns[valid], rows[valid], np.ones(int(valid.sum()))])
    coefficients, _, rank, _ = np.linalg.lstsq(design, values[valid], rcond=None)
    if rank < 3:
        return None
    return coefficients[0] * columns + coefficients[1] * rows + coefficients[2]


def _fourier_bands(raster, response, keep_trend=False, pad_length=None, detrend=True):
    """Apply a Fourier-domain ``response`` to every band.

    Parameters
    ----------
    raster : GeophysicsRaster
    response : callable
        ``response(east, north)`` returning the (real or complex) multiplier
        for wavenumber grids in cycles per CRS unit.
    keep_trend : bool, optional
        Add the removed plane (or mean) back after filtering.
    pad_length : float, optional
        Mirror padding in CRS units on each side; default half the grid.
    detrend : bool, optional
        Remove a best-fit plane rather than the mean before the transform.

    Returns
    -------
    numpy.ndarray
        Float ``(band, row, column)`` array with ``NaN`` for missing cells.
    """
    cell_x, cell_y = _cell_size(raster)
    rows, columns = raster.data.shape[1:]
    # Round each padded axis up to a power of two and split the padding
    # evenly, so isotropic operations stay symmetric.
    padded_rows = _fft_size(rows + 2 * _pad_cells(pad_length, cell_y, rows))
    padded_columns = _fft_size(columns + 2 * _pad_cells(pad_length, cell_x, columns))
    pad_rows = (padded_rows - rows) // 2
    pad_columns = (padded_columns - columns) // 2
    row_index = _symmetric_indices(rows, pad_rows, padded_rows)
    column_index = _symmetric_indices(columns, pad_columns, padded_columns)
    multiplier = response(*_map_wavenumbers(raster, (row_index.size, column_index.size)))
    output = np.full(raster.data.shape, np.nan)
    for index in range(raster.band_count):
        values, valid = _band_values(raster.data[index], raster.nodata)
        if not valid.any():
            continue
        trend = _plane(values, valid) if detrend else None
        if trend is None:
            trend = np.full(values.shape, values[valid].mean())
        residual = np.where(valid, values - trend, 0.0)
        padded = residual[np.ix_(row_index, column_index)]
        filtered = np.real(np.fft.ifft2(np.fft.fft2(padded) * multiplier))
        filtered = filtered[pad_rows:pad_rows + rows, pad_columns:pad_columns + columns]
        if keep_trend:
            filtered = filtered + trend
        output[index] = np.where(valid, filtered, np.nan)
    return output


def _apply_filter(raster, response, keep_trend, longest_wavelength, step, detrend):
    output = _fourier_bands(
        raster, lambda east, north: response(np.hypot(east, north)),
        keep_trend=keep_trend, pad_length=longest_wavelength, detrend=detrend,
    )
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


# --- potential-field enhancements ---------------------------------------------


def _vertical_derivative_bands(raster, order):
    return _fourier_bands(
        raster,
        lambda east, north: (2.0 * math.pi * np.hypot(east, north)) ** order,
    )


def _gradient_bands(raster):
    """Return ``(east, north)`` arrays of map gradients for every band."""
    east = np.full(raster.data.shape, np.nan)
    north = np.full(raster.data.shape, np.nan)
    for index in range(raster.band_count):
        values, valid = _band_values(raster.data[index], raster.nodata)
        band_east, band_north = _map_gradients(raster, values, valid)
        east[index] = np.where(valid, band_east, np.nan)
        north[index] = np.where(valid, band_north, np.nan)
    return east, north


GRADIENT_RELATIVE_TOLERANCE = 1e-10


def _gradient_tolerance(raster):
    """Per-band gradient below which values are rounding error.

    Scaled by the largest absolute cell value over the smallest cell
    spacing, so it follows both the data units and the CRS units.
    """
    smallest_cell = min(_cell_size(raster))
    tolerances = []
    for index in range(raster.band_count):
        values, valid = _band_values(raster.data[index], raster.nodata)
        largest = float(np.abs(values[valid]).max()) if valid.any() else 0.0
        tolerances.append(GRADIENT_RELATIVE_TOLERANCE * largest / smallest_cell)
    return np.array(tolerances)


def vertical_derivative(raster, order=1):
    """Vertical derivative of every band (1VD, 2VD, ...).

    Computed in the Fourier domain by multiplying by ``(2 pi |k|) ** order``.
    Each derivative sharpens shallow sources and suppresses regional trends;
    the second derivative also amplifies noise.

    Parameters
    ----------
    raster : GeophysicsRaster
        A georeferenced raster.
    order : int, optional
        Derivative order, 1 (default) or higher.

    Returns
    -------
    GeophysicsRaster
        Data units per CRS unit to the power ``order``, positive over the
        peaks of positive anomalies.
    """
    if not (isinstance(order, int) and order >= 1):
        raise ValueError("order must be a positive integer")
    output = _vertical_derivative_bands(raster, order)
    return raster.copy_with(output, nodata=None, processing={"operation": "vertical_derivative", "order": order})


def horizontal_derivative(raster, direction="east"):
    """Horizontal derivative of every band along a map direction.

    Uses central differences (one-sided at edges and gaps) converted to map
    axes, so ``"east"`` and ``"north"`` stay geographic on any grid
    orientation.

    Parameters
    ----------
    raster : GeophysicsRaster
    direction : {"east", "north"}, optional

    Returns
    -------
    GeophysicsRaster
        Data units per CRS unit.
    """
    if direction not in ("east", "north"):
        raise ValueError(f"direction must be 'east' or 'north', not {direction!r}")
    east, north = _gradient_bands(raster)
    return raster.copy_with(
        east if direction == "east" else north,
        nodata=None,
        processing={"operation": "horizontal_derivative", "direction": direction},
    )


def total_horizontal_derivative(raster):
    """Magnitude of the horizontal gradient of every band.

    Peaks over steep gradients, which for gravity and reduced-to-pole
    magnetics lie over the edges of sources.

    Parameters
    ----------
    raster : GeophysicsRaster

    Returns
    -------
    GeophysicsRaster
        Non-negative data units per CRS unit.
    """
    east, north = _gradient_bands(raster)
    return raster.copy_with(
        np.hypot(east, north), nodata=None, processing={"operation": "total_horizontal_derivative"},
    )


def tilt_derivative(raster):
    """Tilt derivative: the angle between vertical and horizontal gradients.

    ``atan2(1VD, THD)`` ranges from -90 to 90 degrees whatever the anomaly
    amplitude, so weak and strong sources show equally.  It is positive over
    sources, zero near their edges and negative outside.  Gradients too small
    to distinguish from rounding error count as zero, so a flat field has zero
    tilt rather than noise at +/-90 degrees.

    Parameters
    ----------
    raster : GeophysicsRaster
        A georeferenced raster.

    Returns
    -------
    GeophysicsRaster
        Degrees.
    """
    vertical = _vertical_derivative_bands(raster, 1)
    east, north = _gradient_bands(raster)
    horizontal = np.hypot(east, north)
    tolerance = _gradient_tolerance(raster)[:, None, None]
    vertical = np.where(np.abs(vertical) < tolerance, 0.0, vertical)
    horizontal = np.where(horizontal < tolerance, 0.0, horizontal)
    return raster.copy_with(
        np.degrees(np.arctan2(vertical, horizontal)),
        nodata=None,
        processing={"operation": "tilt_derivative"},
    )


def analytic_signal(raster):
    """Analytic signal amplitude (total gradient) of every band.

    ``sqrt(dx**2 + dy**2 + dz**2)`` peaks over magnetic sources largely
    independently of the magnetisation direction, so it is useful where
    remanence or low latitudes make reduction to the pole unreliable.

    Parameters
    ----------
    raster : GeophysicsRaster
        A georeferenced raster.

    Returns
    -------
    GeophysicsRaster
        Non-negative data units per CRS unit.
    """
    vertical = _vertical_derivative_bands(raster, 1)
    east, north = _gradient_bands(raster)
    return raster.copy_with(
        np.sqrt(east ** 2 + north ** 2 + vertical ** 2),
        nodata=None,
        processing={"operation": "analytic_signal"},
    )


def upward_continuation(raster, height):
    """Continue every band upward, as if measured ``height`` higher.

    Multiplies by ``exp(-2 pi |k| height)`` in the Fourier domain.  Short
    wavelengths from shallow sources fade faster than long ones, so the
    result emphasises deeper, regional sources.  The removed plane is
    restored.

    Parameters
    ----------
    raster : GeophysicsRaster
        A georeferenced raster.
    height : float
        Positive continuation distance in CRS units.

    Returns
    -------
    GeophysicsRaster
        Same units as the input.
    """
    height = float(height)
    if not (np.isfinite(height) and height > 0):
        raise ValueError("height must be positive")
    output = _fourier_bands(
        raster,
        lambda east, north: np.exp(-2.0 * math.pi * np.hypot(east, north) * height),
        keep_trend=True,
    )
    return raster.copy_with(output, nodata=None, processing={"operation": "upward_continuation", "height": height})


MIN_RTP_INCLINATION = 15.0


def reduce_to_pole(raster, inclination, declination):
    """Reduce total magnetic intensity to the pole.

    Recomputes the anomaly as if the field and the (induced) magnetisation
    were vertical, which moves anomalies over their sources and makes them
    symmetric.  The operator is ``|k|**2 / (sin(I) |k| + i cos(I) (sin(D)
    k_east + cos(D) k_north))**2``.  Remanent magnetisation is not modelled.

    Parameters
    ----------
    raster : GeophysicsRaster
        A georeferenced total magnetic intensity grid.
    inclination : float
        Geomagnetic field inclination in degrees, positive downwards
        (negative in the southern hemisphere).  Take it, with the
        declination, from the survey report or an IGRF model for the survey
        date and location.
    declination : float
        Geomagnetic field declination in degrees east of true north.

    Returns
    -------
    GeophysicsRaster
        Same units as the input.  The removed plane is restored.

    Raises
    ------
    ValueError
        If ``abs(inclination)`` is below 15 degrees, where the operator
        amplifies noise along the declination direction without bound.
    """
    inclination = float(inclination)
    declination = float(declination)
    if not (np.isfinite(inclination) and abs(inclination) <= 90):
        raise ValueError("inclination must be between -90 and 90 degrees")
    if not np.isfinite(declination):
        raise ValueError("declination must be finite")
    if abs(inclination) < MIN_RTP_INCLINATION:
        raise ValueError(
            f"reduction to the pole is unstable for inclinations within {MIN_RTP_INCLINATION:g} degrees of "
            "the magnetic equator; use the analytic signal instead"
        )
    sin_i = math.sin(math.radians(inclination))
    cos_i = math.cos(math.radians(inclination))
    east_cosine = cos_i * math.sin(math.radians(declination))
    north_cosine = cos_i * math.cos(math.radians(declination))

    def response(east, north):
        magnitude = np.hypot(east, north)
        theta = sin_i * magnitude + 1j * (east_cosine * east + north_cosine * north)
        result = np.ones(magnitude.shape, dtype=complex)
        nonzero = magnitude > 0
        result[nonzero] = magnitude[nonzero] ** 2 / theta[nonzero] ** 2
        return result

    output = _fourier_bands(raster, response, keep_trend=True)
    return raster.copy_with(
        output,
        nodata=None,
        processing={"operation": "reduce_to_pole", "inclination": inclination, "declination": declination},
    )
