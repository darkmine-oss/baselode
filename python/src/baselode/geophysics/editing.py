# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

"""Crop, clip, combine and gap-fill geophysics rasters.

Every function returns a new :class:`~baselode.geophysics.GeophysicsRaster`
and appends a step to ``metadata["processing"]``.  Missing cells in results
are ``NaN`` with ``nodata`` cleared, as in the other processing functions.
JavaScript's ``cropGeophysicsRaster``, ``clipGeophysicsRaster``,
``combineGeophysicsRasters`` and ``fillGeophysicsGaps`` follow the same rules
and are checked against the ``editing`` cases in the shared reference
fixture.
"""

import math

import numpy as np
import pyproj

import baselode.geophysics.colour_scales
import baselode.geophysics.raster
import baselode.geophysics.provenance


COMBINE_OPERATIONS = ("add", "subtract", "multiply", "divide")

# Pixel positions within this fraction of a cell of a cell edge snap to it,
# so a bound placed on a cell edge does not pull in the neighbouring cell
# through affine rounding (the same tolerance as sampling).
_PIXEL_TOLERANCE = 1e-7

# Successive over-relaxation factor for the gap-fill smoothing passes.
_RELAXATION = 1.6


def _float_bands(raster):
    """Return the bands as floats with missing cells as ``NaN``."""
    valid = baselode.geophysics.colour_scales.valid_mask(raster.data, raster.nodata)
    return np.where(valid, raster.data.astype(float), np.nan)


def _require_transform(raster, action):
    if raster.transform is None:
        raise ValueError(f"the raster has no transform, so it cannot be {action} by map coordinates")
    a, b, _, d, e, _ = raster.transform
    if a * e - b * d == 0:
        raise ValueError("the raster transform is not invertible")
    return raster.transform


def _pixel_coordinates(transform, x, y):
    a, b, c, d, e, f = transform
    determinant = a * e - b * d
    dx = np.asarray(x, dtype=float) - c
    dy = np.asarray(y, dtype=float) - f
    return (e * dx - b * dy) / determinant, (-d * dx + a * dy) / determinant


def _window(raster, min_x, min_y, max_x, max_y):
    """Return ``(column_offset, row_offset, columns, rows)`` covering a box, or None."""
    transform = _require_transform(raster, "cropped")
    columns, rows = _pixel_coordinates(
        transform, [min_x, max_x, min_x, max_x], [min_y, min_y, max_y, max_y],
    )
    first_column = max(math.floor(columns.min() + _PIXEL_TOLERANCE), 0)
    last_column = min(math.ceil(columns.max() - _PIXEL_TOLERANCE), raster.width)
    first_row = max(math.floor(rows.min() + _PIXEL_TOLERANCE), 0)
    last_row = min(math.ceil(rows.max() - _PIXEL_TOLERANCE), raster.height)
    if last_column <= first_column or last_row <= first_row:
        return None
    return first_column, first_row, last_column - first_column, last_row - first_row


def _subset(raster, data, window, processing, **changes):
    column_offset, row_offset, columns, rows = window
    a, b, c, d, e, f = raster.transform
    transform = (
        a, b, a * column_offset + b * row_offset + c,
        d, e, d * column_offset + e * row_offset + f,
    )
    # A copy, so the result does not keep the full-size array alive.
    return raster.copy_with(
        np.array(data[:, row_offset:row_offset + rows, column_offset:column_offset + columns], copy=True),
        transform=transform,
        processing=processing,
        **changes,
    )


def crop(raster, bounds):
    """Cut a raster down to the cells that overlap a box.

    Parameters
    ----------
    raster : GeophysicsRaster
    bounds : sequence of float
        ``(min_x, min_y, max_x, max_y)`` in the raster's coordinates.

    Returns
    -------
    GeophysicsRaster
        Whole cells only, so the result can extend up to one cell beyond
        ``bounds``.  Values and ``nodata`` are unchanged, and the processing
        step records the window as ``[column_offset, row_offset, columns,
        rows]``.  For a rotated grid the window covers the box's corners.

    Raises
    ------
    ValueError
        If the box does not overlap the grid or is not a valid box.
    """
    min_x, min_y, max_x, max_y = (float(value) for value in bounds)
    if not all(math.isfinite(value) for value in (min_x, min_y, max_x, max_y)):
        raise ValueError("bounds must be finite")
    if min_x > max_x or min_y > max_y:
        raise ValueError("bounds must be (min_x, min_y, max_x, max_y)")
    window = _window(raster, min_x, min_y, max_x, max_y)
    if window is None:
        raise ValueError("bounds do not overlap the raster")
    return _subset(raster, raster.data, window, {
        "operation": "crop", "bounds": [min_x, min_y, max_x, max_y], "window": list(window),
    })


def _rings(polygon):
    """Return a list of ``(n, 2)`` float arrays from a polygon description."""
    geometry = getattr(polygon, "__geo_interface__", polygon)
    if isinstance(geometry, dict):
        kind = geometry.get("type")
        if kind == "Feature":
            return _rings(geometry.get("geometry"))
        if kind == "Polygon":
            parts = [geometry["coordinates"]]
        elif kind == "MultiPolygon":
            parts = list(geometry["coordinates"])
        else:
            raise ValueError(f"polygon must be a Polygon or MultiPolygon, got {kind!r}")
        rings = [ring for part in parts for ring in part]
    else:
        sequence = list(polygon)
        if sequence and np.ndim(sequence[0]) == 1:
            rings = [sequence]
        else:
            rings = sequence
    result = []
    for ring in rings:
        points = np.asarray(ring, dtype=float)
        if points.ndim != 2 or points.shape[1] < 2 or len(points) < 3:
            raise ValueError("each polygon ring needs at least three (x, y) points")
        if not np.isfinite(points[:, :2]).all():
            raise ValueError("polygon coordinates must be finite")
        result.append(points[:, :2])
    if not result:
        raise ValueError("polygon has no rings")
    return result


def _inside(rings, x, y):
    """Even-odd point-in-polygon test over every ring (holes included)."""
    inside = np.zeros(x.shape, dtype=bool)
    for ring in rings:
        x0, y0 = ring[:, 0], ring[:, 1]
        x1, y1 = np.roll(x0, -1), np.roll(y0, -1)
        for xi, yi, xj, yj in zip(x0, y0, x1, y1):
            if yi == yj:
                continue
            crosses = (yi > y) != (yj > y)
            at = (xj - xi) * (y - yi) / (yj - yi) + xi
            inside ^= crosses & (x < at)
    return inside


def clip(raster, polygon, crop=True):
    """Keep the cells whose centres fall inside a polygon.

    Parameters
    ----------
    raster : GeophysicsRaster
    polygon : sequence or geometry
        One ring of ``(x, y)`` points, a list of rings (inner rings cut
        holes by the even-odd rule), a GeoJSON ``Polygon`` /
        ``MultiPolygon`` mapping or ``Feature``, or any object with
        ``__geo_interface__`` such as a Shapely polygon.  Coordinates are in
        the raster's CRS.
    crop : bool, optional
        Also cut the grid down to the polygon's bounding box.  Default True.

    Returns
    -------
    GeophysicsRaster
        Cells outside the polygon are ``NaN`` and ``nodata`` is cleared.

    Raises
    ------
    ValueError
        If no cell centre lies inside the polygon.
    """
    rings = _rings(polygon)
    points = np.concatenate(rings)
    _require_transform(raster, "clipped")
    window = (0, 0, raster.width, raster.height)
    if crop:
        window = _window(raster, *points.min(axis=0), *points.max(axis=0))
        if window is None:
            raise ValueError("the polygon does not overlap the raster")
    column_offset, row_offset, columns, rows = window
    column_index, row_index = np.meshgrid(
        np.arange(column_offset, column_offset + columns) + 0.5,
        np.arange(row_offset, row_offset + rows) + 0.5,
    )
    a, b, c, d, e, f = raster.transform
    inside = _inside(rings, a * column_index + b * row_index + c, d * column_index + e * row_index + f)
    if not inside.any():
        raise ValueError("no cell centre lies inside the polygon")
    data = _float_bands(raster)
    data[:, row_offset:row_offset + rows, column_offset:column_offset + columns][:, ~inside] = np.nan
    step = {"operation": "clip", "crop": bool(crop), "inside_cells": int(inside.sum())}
    if crop:
        return _subset(raster, data, window, {**step, "window": list(window)}, nodata=None)
    return raster.copy_with(data, nodata=None, processing=step)


def _same_crs(left, right):
    if left is None or right is None:
        return True
    return pyproj.CRS.from_user_input(left) == pyproj.CRS.from_user_input(right)


def _check_aligned(left, right):
    if (left.height, left.width) != (right.height, right.width):
        raise ValueError(
            f"rasters must have the same shape to combine: {left.height} x {left.width} "
            f"and {right.height} x {right.width}"
        )
    if (left.transform is None) != (right.transform is None):
        raise ValueError("one raster is georeferenced and the other is not")
    if left.transform is not None:
        scale = max(abs(value) for value in (left.transform[0], left.transform[1],
                                             left.transform[3], left.transform[4]))
        if any(abs(p - q) > 1e-6 * scale for p, q in zip(left.transform, right.transform)):
            raise ValueError(
                "rasters must share a grid (the same cell size and origin) to combine; "
                "resample one onto the other first"
            )
    if not _same_crs(left.crs, right.crs):
        raise ValueError(f"rasters are in different coordinate systems: {left.crs} and {right.crs}")
    if right.band_count not in (1, left.band_count):
        raise ValueError("the second raster needs one band or as many bands as the first")


def combine(left, right, operation, include_provenance=True):
    """Add, subtract, multiply or divide two aligned rasters, or a raster and a number.

    A residual is ``combine(grid, regional, "subtract")``.

    Parameters
    ----------
    left : GeophysicsRaster
    right : GeophysicsRaster or float
        A raster on the same grid (same shape, transform and CRS) with one
        band, applied to every band of ``left``, or one band per band of
        ``left``.  Or a number.
    operation : {"add", "subtract", "multiply", "divide"}
    include_provenance : bool, optional
        Capture right-hand metadata in the lineage graph (default True).
        False preserves legacy arithmetic with opaque metadata, marking
        the step as ``lineage_omitted`` rather than implying complete lineage.

    Returns
    -------
    GeophysicsRaster
        ``left``'s grid, names and CRS.  A cell is ``NaN`` when it is missing
        in either input or is divided by zero.  Band units are kept for
        ``add`` and ``subtract`` and cleared otherwise.

    Raises
    ------
    ValueError
        For an unknown operation or rasters that are not aligned.
    """
    if operation not in COMBINE_OPERATIONS:
        raise ValueError(f"operation must be one of {COMBINE_OPERATIONS}, got {operation!r}")
    values = _float_bands(left)
    if isinstance(right, baselode.geophysics.raster.GeophysicsRaster):
        _check_aligned(left, right)
        operand = _float_bands(right)
        source = right.metadata.get("source")
        step = {"operation": operation, "operand": "raster", "operand_bands": list(right.band_names)}
        if source:
            step["operand_source"] = str(source)
    else:
        operand = float(right)
        if not math.isfinite(operand):
            raise ValueError("a numeric operand must be finite")
        step = {"operation": operation, "operand": operand}
    with np.errstate(divide="ignore", invalid="ignore"):
        if operation == "add":
            result = values + operand
        elif operation == "subtract":
            result = values - operand
        elif operation == "multiply":
            result = values * operand
        else:
            result = values / operand
    result = np.where(np.isfinite(result), result, np.nan)
    metadata = dict(left.metadata)
    if isinstance(right, baselode.geophysics.raster.GeophysicsRaster) and include_provenance:
        nodes, operand = baselode.geophysics.provenance.append_input(left.metadata, right.metadata)
        metadata["input_lineage"] = nodes
        step["operand_lineage"] = operand
    elif isinstance(right, baselode.geophysics.raster.GeophysicsRaster):
        step["lineage_omitted"] = True
    if operation in ("multiply", "divide") and "units" in metadata:
        metadata["units"] = [None] * left.band_count
    return left.copy_with(result, nodata=None, metadata=metadata, processing=step)


def _shift(array, row_step, column_step, fill):
    """Shift a 2-D array so ``result[i, j] = array[i - row_step, j - column_step]``."""
    result = np.full(array.shape, fill, dtype=array.dtype)
    rows, columns = array.shape
    target_rows = slice(max(row_step, 0), rows + min(row_step, 0))
    source_rows = slice(max(-row_step, 0), rows + min(-row_step, 0))
    target_columns = slice(max(column_step, 0), columns + min(column_step, 0))
    source_columns = slice(max(-column_step, 0), columns + min(-column_step, 0))
    result[target_rows, target_columns] = array[source_rows, source_columns]
    return result


def _reachable(valid, max_distance):
    """Cells within ``max_distance`` steps (diagonals count as one) of a valid cell."""
    reach = valid.copy()
    for _ in range(max_distance):
        grown = reach.copy()
        for row_step in (-1, 0, 1):
            for column_step in (-1, 0, 1):
                if row_step or column_step:
                    grown |= _shift(reach, row_step, column_step, False)
        if (grown == reach).all():
            break
        reach = grown
    return reach


def _pyramid_fill(values, valid):
    """Fill every missing cell from successively coarser block means.

    Each coarser level halves the grid (rounding up); a coarse cell is the
    mean of its non-missing children.  Missing cells then take their
    parent's value, working down from the coarsest level.
    """
    means = [np.where(valid, values, np.nan)]
    while np.isnan(means[-1]).any() and means[-1].shape != (1, 1):
        level = means[-1]
        rows, columns = level.shape
        padded = np.full((rows + rows % 2, columns + columns % 2), np.nan)
        padded[:rows, :columns] = level
        children = [padded[0::2, 0::2], padded[1::2, 0::2], padded[0::2, 1::2], padded[1::2, 1::2]]
        totals = sum(np.where(np.isnan(child), 0.0, child) for child in children)
        counts = sum((~np.isnan(child)).astype(float) for child in children)
        means.append(np.where(counts > 0, totals / np.where(counts > 0, counts, 1), np.nan))
    for level in range(len(means) - 2, -1, -1):
        rows, columns = means[level].shape
        parent = np.repeat(np.repeat(means[level + 1], 2, axis=0), 2, axis=1)[:rows, :columns]
        means[level] = np.where(np.isnan(means[level]), parent, means[level])
    return means[0]


def _relax(filled, fixed, active, iterations):
    """Red-black over-relaxation of Laplace's equation on the ``active`` cells.

    Each active cell moves towards the mean of its in-grid, non-missing
    four neighbours; ``fixed`` cells (the data) never change.
    """
    rows, columns = filled.shape
    parity = np.add.outer(np.arange(rows), np.arange(columns)) % 2
    usable = fixed | active
    neighbour_counts = sum(
        _shift(usable, row_step, column_step, False).astype(float)
        for row_step, column_step in ((1, 0), (-1, 0), (0, 1), (0, -1))
    )
    colours = [active & (parity == colour) & (neighbour_counts > 0) for colour in (0, 1)]
    values = np.where(usable, filled, 0.0)
    for _ in range(iterations):
        for colour in colours:
            total = sum(
                _shift(values, row_step, column_step, 0.0)
                for row_step, column_step in ((1, 0), (-1, 0), (0, 1), (0, -1))
            )
            mean = total / np.where(neighbour_counts > 0, neighbour_counts, 1)
            values = np.where(colour, values + _RELAXATION * (mean - values), values)
    return values


def fill_gaps(raster, max_distance=None, iterations=100):
    """Fill missing cells with a smooth surface that honours the data.

    Gaps are first filled from coarser and coarser block means of the data,
    then smoothed with ``iterations`` passes towards a harmonic (minimum
    tension) surface, so filled values join the surrounding data without
    steps.  Data cells never change.

    Use it before Fourier filtering or derivatives on grids with dropouts,
    or to tidy gaps for display.  It does not invent geology: keep
    ``max_distance`` small when gaps are wide.

    Parameters
    ----------
    raster : GeophysicsRaster
    max_distance : int, optional
        Fill only cells within this many cells of data, counting diagonal
        steps as one.  ``None`` (default) fills every gap, including areas
        outside the survey.
    iterations : int, optional
        Smoothing passes.  ``0`` keeps the block-mean fill.

    Returns
    -------
    GeophysicsRaster
        Unfilled cells stay ``NaN`` and ``nodata`` is cleared.  The
        processing step records the settings and ``filled_cells``.

    Raises
    ------
    ValueError
        For a negative ``max_distance`` or ``iterations``, or a band with no
        data.
    """
    if max_distance is not None and (int(max_distance) != max_distance or max_distance < 0):
        raise ValueError("max_distance must be a whole number of cells, 0 or more")
    if int(iterations) != iterations or iterations < 0:
        raise ValueError("iterations must be a whole number, 0 or more")
    data = _float_bands(raster)
    filled_cells = 0
    for index, values in enumerate(data):
        valid = np.isfinite(values)
        if not valid.any():
            raise ValueError(f"band {raster.band_names[index]!r} has no data to fill from")
        gaps = ~valid
        if max_distance is not None:
            gaps &= _reachable(valid, int(max_distance))
        if not gaps.any():
            continue
        filled = _pyramid_fill(values, valid)
        if iterations:
            filled = _relax(filled, valid, gaps, int(iterations))
        data[index] = np.where(gaps, filled, values)
        filled_cells += int(gaps.sum())
    return raster.copy_with(data, nodata=None, processing={
        "operation": "fill_gaps",
        "method": "pyramid_harmonic",
        "max_distance": None if max_distance is None else int(max_distance),
        "iterations": int(iterations),
        "filled_cells": filled_cells,
    })

