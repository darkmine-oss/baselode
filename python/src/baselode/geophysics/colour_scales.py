# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

"""Colour scales and stretches for geophysics rasters.

A colour scale is an ordered list of RGB stops from low to high values.  A
stretch maps data values to the ``0..1`` position along the scale:

``{"mode": "relative", "low": 2, "high": 98}``
    Percentile clip.  The limits follow the data, so the same stretch suits
    grids with different value ranges.
``{"mode": "absolute", "min": -200, "max": 400}``
    Fixed limits in data units, for comparing grids on one scale.
``{"mode": "equalize"}``
    Histogram equalisation: each colour covers an equal share of cells, the
    usual default for magnetic and gravity imagery.

Values outside the stretch limits take the end colours.  The JavaScript
package ships the same stops in ``src/data/geophysics_color_scales.json``
and implements the same arithmetic, so Python and browser renders agree.
"""

import numpy as np


COLOUR_SCALES = {
    "viridis": [[68, 1, 84], [72, 36, 117], [65, 68, 135], [53, 95, 141], [42, 120, 142], [33, 145, 140], [34, 168, 132], [68, 191, 112], [122, 209, 81], [189, 223, 38], [253, 231, 37]],
    "magma": [[0, 0, 4], [20, 14, 54], [59, 15, 112], [100, 26, 128], [140, 41, 129], [183, 55, 121], [222, 73, 104], [247, 112, 92], [254, 159, 109], [254, 207, 146], [252, 253, 191]],
    "inferno": [[0, 0, 4], [22, 11, 57], [66, 10, 104], [106, 23, 110], [147, 38, 103], [188, 55, 84], [221, 81, 58], [243, 120, 25], [252, 165, 10], [246, 215, 70], [252, 255, 164]],
    "plasma": [[13, 8, 135], [65, 4, 157], [106, 0, 168], [143, 13, 164], [177, 42, 144], [204, 71, 120], [225, 100, 98], [242, 132, 75], [252, 166, 54], [252, 206, 37], [240, 249, 33]],
    "cividis": [[0, 34, 78], [8, 51, 112], [53, 69, 108], [79, 87, 108], [102, 105, 112], [125, 124, 120], [148, 142, 119], [174, 163, 113], [200, 184, 102], [229, 207, 82], [254, 232, 56]],
    "turbo": [[48, 18, 59], [69, 89, 203], [62, 155, 254], [25, 213, 205], [70, 248, 132], [164, 252, 60], [225, 221, 55], [254, 164, 49], [240, 91, 18], [195, 37, 3], [122, 4, 3]],
    "diverging": [[5, 48, 97], [32, 101, 171], [67, 147, 195], [144, 196, 221], [209, 229, 240], [247, 246, 246], [253, 219, 199], [243, 164, 129], [214, 96, 77], [177, 24, 43], [103, 0, 31]],
    "rainbow": [[0, 0, 255], [0, 170, 255], [0, 255, 200], [0, 230, 0], [200, 255, 0], [255, 230, 0], [255, 140, 0], [255, 0, 0], [255, 0, 160], [255, 170, 230]],
    "magnetic": [[21, 32, 90], [37, 105, 172], [242, 235, 199], [205, 81, 56], [91, 24, 48]],
    "terrain": [[30, 60, 35], [88, 125, 55], [191, 171, 105], [238, 233, 196], [255, 255, 255]],
    "grayscale": [[0, 0, 0], [255, 255, 255]],
}

STRETCH_MODES = ("relative", "absolute", "equalize")


def validate_stretch(stretch):
    """Check a stretch dictionary and return it with defaults filled in.

    Parameters
    ----------
    stretch : dict or None
        Stretch specification (see module docstring).  ``None`` means
        ``{"mode": "relative", "low": 2, "high": 98}``.

    Returns
    -------
    dict
        A new dictionary with every key for its mode.

    Raises
    ------
    ValueError
        For an unknown mode or limits that are missing, non-finite, outside
        ``0..100`` (relative) or not increasing.
    """
    stretch = dict(stretch or {"mode": "relative"})
    mode = stretch.get("mode")
    if mode not in STRETCH_MODES:
        raise ValueError(f"stretch mode must be one of {STRETCH_MODES}, not {mode!r}")
    if mode == "relative":
        low = float(stretch.get("low", 2))
        high = float(stretch.get("high", 98))
        if not (0 <= low < high <= 100):
            raise ValueError("relative stretch needs 0 <= low < high <= 100 (percentiles)")
        return {"mode": mode, "low": low, "high": high}
    if mode == "absolute":
        if stretch.get("min") is None or stretch.get("max") is None:
            raise ValueError("absolute stretch needs min and max in data units")
        low = float(stretch["min"])
        high = float(stretch["max"])
        if not (np.isfinite(low) and np.isfinite(high) and low < high):
            raise ValueError("absolute stretch needs finite min < max")
        return {"mode": mode, "min": low, "max": high}
    return {"mode": mode}


def valid_mask(values, nodata=None):
    """Return a boolean mask of cells holding measurements.

    Cells are missing when non-finite or equal to ``nodata``.  The comparison
    is made in the array's own dtype: a float32 sentinel such as ``-1e32``
    no longer equals the float64 ``nodata`` once promoted.

    Parameters
    ----------
    values : array-like
    nodata : float, optional

    Returns
    -------
    numpy.ndarray
        ``bool`` array of the same shape.
    """
    array = np.asarray(values)
    if array.dtype.kind not in "fiu":
        array = array.astype(float)
    valid = np.isfinite(array)
    if nodata is not None:
        marker = np.asarray(nodata).astype(array.dtype) if array.dtype.kind == "f" else nodata
        valid &= array != marker
    return valid


def _finite_values(values, nodata):
    valid = valid_mask(values, nodata)
    return np.asarray(values, dtype=float), valid


def stretch_values(values, stretch=None, nodata=None):
    """Map data values to ``0..1`` colour-scale positions.

    Parameters
    ----------
    values : array-like
        Numeric grid of any shape.
    stretch : dict, optional
        Stretch specification; see :func:`validate_stretch`.
    nodata : float, optional
        Value treated as missing in addition to non-finite values.

    Returns
    -------
    ratios : numpy.ndarray
        Same shape as ``values``; ``NaN`` where the input is missing.
    limits : tuple of float
        The ``(low, high)`` data values at the ends of the colour scale.  For
        ``equalize`` these are the data minimum and maximum.
    """
    stretch = validate_stretch(stretch)
    array, valid = _finite_values(values, nodata)
    ratios = np.full(array.shape, np.nan)
    finite = np.sort(array[valid])
    if finite.size == 0:
        raise ValueError("raster contains no finite values")
    if stretch["mode"] == "equalize":
        if finite.size == 1:
            ratios[valid] = 0.5
        else:
            # Mid-rank of each value in the sorted sample: tied values share a
            # colour and the result does not depend on bin choice.
            left = np.searchsorted(finite, array[valid], side="left")
            right = np.searchsorted(finite, array[valid], side="right")
            ratios[valid] = (left + right - 1) / 2.0 / (finite.size - 1)
        return ratios, (float(finite[0]), float(finite[-1]))
    if stretch["mode"] == "relative":
        low, high = np.percentile(finite, [stretch["low"], stretch["high"]])
    else:
        low, high = stretch["min"], stretch["max"]
    span = high - low
    if span > 0:
        ratios[valid] = np.clip((array[valid] - low) / span, 0.0, 1.0)
    else:
        ratios[valid] = 0.5
    return ratios, (float(low), float(high))


def scale_colours(ratios, palette="viridis", reverse=False):
    """Interpolate RGB colours for ``0..1`` positions.

    Parameters
    ----------
    ratios : array-like
        Colour-scale positions; ``NaN`` gives black.
    palette : str, optional
        Name in :data:`COLOUR_SCALES`.
    reverse : bool, optional
        Run the palette from high to low.

    Returns
    -------
    numpy.ndarray
        ``float`` array of shape ``ratios.shape + (3,)`` with 0-255 channels.
    """
    if palette not in COLOUR_SCALES:
        raise ValueError(f"unknown palette {palette!r}; choose from {sorted(COLOUR_SCALES)}")
    stops = np.asarray(COLOUR_SCALES[palette], dtype=float)
    if reverse:
        stops = stops[::-1]
    ratios = np.nan_to_num(np.asarray(ratios, dtype=float), nan=0.0)
    position = np.clip(ratios, 0.0, 1.0) * (len(stops) - 1)
    lower = np.floor(position).astype(int)
    upper = np.minimum(lower + 1, len(stops) - 1)
    portion = (position - lower)[..., np.newaxis]
    return np.round(stops[lower] + (stops[upper] - stops[lower]) * portion)


def colourize(values, palette="viridis", stretch=None, reverse=False, nodata=None,
              shade=None, shade_strength=0.65):
    """Render a grid to RGBA bytes, optionally modulated by a hillshade.

    Parameters
    ----------
    values : array-like
        Two-dimensional ``(row, column)`` grid.
    palette : str, optional
        Name in :data:`COLOUR_SCALES`.
    stretch : dict, optional
        Stretch specification; see :func:`validate_stretch`.
    reverse : bool, optional
        Run the palette from high to low.
    nodata : float, optional
        Value treated as missing.
    shade : array-like, optional
        ``0..1`` illumination grid, for example from
        ``baselode.geophysics.processing.hillshade``.
    shade_strength : float, optional
        Blend between flat colour (0) and full illumination (1).

    Returns
    -------
    numpy.ndarray
        ``uint8`` array of shape ``(rows, columns, 4)``; missing cells are
        fully transparent.
    """
    ratios, _ = stretch_values(values, stretch, nodata)
    rgb = scale_colours(ratios, palette, reverse)
    if shade is not None:
        strength = float(np.clip(shade_strength, 0.0, 1.0))
        illumination = (1 - strength) + strength * np.nan_to_num(np.asarray(shade, dtype=float), nan=1.0)
        rgb = rgb * illumination[..., np.newaxis]
    valid = np.isfinite(ratios)
    rgba = np.zeros(ratios.shape + (4,), dtype=np.uint8)
    # Round half to even, matching a browser Uint8ClampedArray.
    rgba[..., :3] = np.where(valid[..., np.newaxis], np.clip(np.round(rgb), 0, 255), 0)
    rgba[..., 3] = np.where(valid, 255, 0)
    return rgba
