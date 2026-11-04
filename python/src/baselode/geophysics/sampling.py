# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

"""Read raster values at points, table rows and along profile lines.

Cell values sit at cell centres.  ``bilinear`` interpolates between the four
surrounding cell centres; ``nearest`` returns the value of the cell that
contains the point.  Points outside the grid, and points whose interpolation
would draw on a missing cell, return ``NaN`` rather than an invented value.

When the points are in a different coordinate reference system from the
raster, pass ``crs`` and they are reprojected to the raster's CRS with
``pyproj`` before sampling.  ``baselode.geophysics.sampling`` in Python and
``sampleGeophysicsRaster`` in JavaScript share one reference fixture, so both
return the same values.
"""

import math

import numpy as np
import pandas as pd
import pyproj

import baselode.geophysics.colour_scales


SAMPLING_METHODS = ("bilinear", "nearest")

# Pixel positions within this fraction of a cell of a cell centre or grid
# edge snap to it.  Inverting the affine transform at projected coordinates
# (around 1e7 m) leaves rounding errors of about 1e-10 cells, which would
# otherwise make a point on a cell centre depend on (and become missing
# because of) a neighbouring cell, or fall just outside the grid.
_PIXEL_TOLERANCE = 1e-7


def _check_method(method):
    if method not in SAMPLING_METHODS:
        raise ValueError(f"method must be one of {SAMPLING_METHODS}, got {method!r}")


def _reproject(x, y, crs, raster):
    """Return ``x, y`` in the raster's CRS."""
    if crs is None:
        return x, y
    if raster.crs is None:
        raise ValueError(
            "the raster has no CRS, so points given with crs= cannot be reprojected onto it; "
            "set raster.crs or pass points already in the raster's coordinates"
        )
    source = pyproj.CRS.from_user_input(crs)
    target = pyproj.CRS.from_user_input(raster.crs)
    if source == target:
        return x, y
    transformer = pyproj.Transformer.from_crs(source, target, always_xy=True)
    return transformer.transform(x, y)


def _snap(fraction):
    """Snap interpolation fractions within the tolerance of 0 or 1."""
    fraction = np.where(fraction < _PIXEL_TOLERANCE, 0.0, fraction)
    return np.where(fraction > 1 - _PIXEL_TOLERANCE, 1.0, fraction)


def _pixel_coordinates(raster, x, y):
    """Return continuous ``(column, row)`` positions; cell ``(0, 0)`` spans 0..1."""
    if raster.transform is None:
        raise ValueError("the raster has no transform, so map coordinates cannot be sampled")
    a, b, c, d, e, f = raster.transform
    determinant = a * e - b * d
    if determinant == 0:
        raise ValueError("the raster transform is not invertible")
    dx = x - c
    dy = y - f
    column = (e * dx - b * dy) / determinant
    row = (-d * dx + a * dy) / determinant
    return column, row


def sample_points(raster, x, y, band=1, method="bilinear", crs=None):
    """Sample one raster band at map coordinates.

    Parameters
    ----------
    raster : GeophysicsRaster
        Georeferenced raster to read.
    x, y : array-like of float
        Point coordinates, in ``crs`` when given, otherwise in the raster's
        own coordinates.  Scalars and arrays of any matching shape are
        accepted.
    band : int, optional
        One-based band number.
    method : {"bilinear", "nearest"}, optional
        ``bilinear`` interpolates between the four surrounding cell centres
        and returns ``NaN`` if any of them that contributes is missing.
        Within half a cell of the grid edge the edge cells are used as they
        are, without extrapolation.  ``nearest`` returns the containing
        cell's value.
    crs : str, int or pyproj.CRS, optional
        CRS of ``x`` and ``y``.  When it differs from ``raster.crs`` the
        points are reprojected first.  The raster must then have a CRS.

    Returns
    -------
    numpy.ndarray
        Float values with the broadcast shape of ``x`` and ``y``.  Points
        outside the grid, non-finite input coordinates, and missing cells
        give ``NaN``.

    Raises
    ------
    ValueError
        For an unknown method, an unreferenced raster, or ``crs`` given for a
        raster without a CRS.
    """
    _check_method(method)
    x, y = np.broadcast_arrays(np.asarray(x, dtype=float), np.asarray(y, dtype=float))
    shape = x.shape
    x = x.reshape(-1)
    y = y.reshape(-1)
    x, y = _reproject(x, y, crs, raster)
    column, row = _pixel_coordinates(raster, np.asarray(x, dtype=float), np.asarray(y, dtype=float))

    values = raster.band(band)
    valid = baselode.geophysics.colour_scales.valid_mask(values, raster.nodata)
    values = values.astype(float, copy=False)
    height, width = values.shape
    result = np.full(column.shape, np.nan)
    inside = (
        np.isfinite(column) & np.isfinite(row)
        & (column >= -_PIXEL_TOLERANCE) & (column <= width + _PIXEL_TOLERANCE)
        & (row >= -_PIXEL_TOLERANCE) & (row <= height + _PIXEL_TOLERANCE)
    )
    if not inside.any():
        return result.reshape(shape)

    column = column[inside]
    row = row[inside]
    if method == "nearest":
        j = np.clip(np.floor(column).astype(int), 0, width - 1)
        i = np.clip(np.floor(row).astype(int), 0, height - 1)
        sampled = np.where(valid[i, j], values[i, j], np.nan)
    else:
        u = np.clip(column - 0.5, 0, width - 1)
        v = np.clip(row - 0.5, 0, height - 1)
        j0 = np.floor(u).astype(int)
        i0 = np.floor(v).astype(int)
        j1 = np.minimum(j0 + 1, width - 1)
        i1 = np.minimum(i0 + 1, height - 1)
        tx = _snap(u - j0)
        ty = _snap(v - i0)
        total = np.zeros(column.shape)
        missing = np.zeros(column.shape, dtype=bool)
        for i, j, weight in (
            (i0, j0, (1 - tx) * (1 - ty)),
            (i0, j1, tx * (1 - ty)),
            (i1, j0, (1 - tx) * ty),
            (i1, j1, tx * ty),
        ):
            used = weight > 0
            missing |= used & ~valid[i, j]
            total += np.where(used & valid[i, j], weight * np.where(valid[i, j], values[i, j], 0.0), 0.0)
        sampled = np.where(missing, np.nan, total)
    result[inside] = sampled
    return result.reshape(shape)


def sample_table(raster, table, x_col="easting", y_col="northing", column=None,
                 band=1, method="bilinear", crs=None):
    """Add a column of raster values to a table of points.

    Works with any table that has coordinate columns: collars, surface
    samples, or desurveyed traces from
    :func:`baselode.drill.desurvey.minimum_curvature_desurvey`, where each trace
    station gets the grid value directly above or below it.

    Parameters
    ----------
    raster : GeophysicsRaster
    table : pandas.DataFrame
        Rows to sample.  Not modified.
    x_col, y_col : str, optional
        Coordinate columns.  Default to the canonical ``easting`` and
        ``northing``.
    column : str, optional
        Name of the new column.  Defaults to the band name.
    band : int, optional
        One-based band number.
    method : {"bilinear", "nearest"}, optional
        See :func:`sample_points`.
    crs : str, int or pyproj.CRS, optional
        CRS of the coordinate columns, when it differs from the raster's.

    Returns
    -------
    pandas.DataFrame
        A copy of ``table`` with the sampled values; ``NaN`` where there is
        no grid value.
    """
    for name in (x_col, y_col):
        if name not in table.columns:
            raise KeyError(f"table has no {name!r} column")
    values = sample_points(
        raster,
        pd.to_numeric(table[x_col], errors="coerce").to_numpy(dtype=float),
        pd.to_numeric(table[y_col], errors="coerce").to_numpy(dtype=float),
        band=band, method=method, crs=crs,
    )
    output = table.copy()
    output[column or raster.band_names[band - 1]] = values
    return output


def profile_stations(vertices, spacing):
    """Return regularly spaced stations along a polyline.

    Parameters
    ----------
    vertices : sequence of (x, y)
        At least two points.  Consecutive duplicates are ignored.
    spacing : float
        Distance between stations, in the units of the vertex coordinates.

    Returns
    -------
    pandas.DataFrame
        Columns ``distance``, ``x`` and ``y``.  Stations start at the first
        vertex, step by ``spacing`` along the line (through its bends) and
        always include the final vertex.
    """
    spacing = float(spacing)
    if not math.isfinite(spacing) or spacing <= 0:
        raise ValueError("spacing must be a positive number")
    points = np.asarray(vertices, dtype=float)
    if points.ndim != 2 or points.shape[1] != 2 or len(points) < 2:
        raise ValueError("vertices must be a sequence of at least two (x, y) points")
    if not np.isfinite(points).all():
        raise ValueError("vertices must be finite")
    lengths = np.hypot(*np.diff(points, axis=0).T)
    keep = np.concatenate([[True], lengths > 0])
    points = points[keep]
    lengths = lengths[lengths > 0]
    if len(points) < 2:
        raise ValueError("the profile line has zero length")
    cumulative = np.concatenate([[0.0], np.cumsum(lengths)])
    total = cumulative[-1]
    count = int(math.floor(total / spacing + 1e-9))
    distances = np.arange(count + 1) * spacing
    if total - distances[-1] > 1e-9 * max(total, 1.0):
        distances = np.append(distances, total)
    else:
        distances[-1] = min(distances[-1], total)
    segment = np.clip(np.searchsorted(cumulative, distances, side="right") - 1, 0, len(lengths) - 1)
    fraction = (distances - cumulative[segment]) / lengths[segment]
    start = points[segment]
    step = points[segment + 1] - start
    return pd.DataFrame({
        "distance": distances,
        "x": start[:, 0] + fraction * step[:, 0],
        "y": start[:, 1] + fraction * step[:, 1],
    })


def sample_profile(raster, vertices, spacing, band=1, method="bilinear", crs=None, column="value"):
    """Sample a raster along a polyline, such as a section line.

    Parameters
    ----------
    raster : GeophysicsRaster
    vertices : sequence of (x, y)
        Line vertices, in ``crs`` when given, otherwise in the raster's
        coordinates.
    spacing : float
        Distance between stations, in the vertex units.  Use a projected
        CRS for the line (metres); distances along a lat/long line are in
        degrees.
    band : int, optional
    method : {"bilinear", "nearest"}, optional
    crs : str, int or pyproj.CRS, optional
        CRS of ``vertices``.  Stations are spaced in this CRS and then
        reprojected to the raster's CRS for sampling.
    column : str, optional
        Name of the value column.

    Returns
    -------
    pandas.DataFrame
        ``distance``, ``x``, ``y`` (in the line's CRS) and the sampled
        values.
    """
    stations = profile_stations(vertices, spacing)
    stations[column] = sample_points(
        raster, stations["x"].to_numpy(), stations["y"].to_numpy(), band=band, method=method, crs=crs,
    )
    return stations
