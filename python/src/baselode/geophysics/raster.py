"""Georeferenced raster data for geophysics workflows.

``GeophysicsRaster`` stores bands in the same order used by GDAL and Rasterio:
``(band, row, column)``.  The affine transform is the six-value GDAL form
``(a, b, c, d, e, f)`` where ``x = a * column + b * row + c`` and
``y = d * column + e * row + f``.  North-up rasters normally have a negative
``e`` value.

File access is deliberately separate from the model.  ER Mapper ``.ers``
grids load natively with NumPy.  Install the optional extra with
``pip install 'baselode[raster]'`` to load GeoTIFF, ENVI grids, and every other
raster driver available in the installed GDAL.
"""

import math
import pathlib
import uuid

import numpy as np

import baselode.geophysics.colour_scales
import baselode.geophysics.ers

try:
    import rasterio as _rasterio
except ImportError:
    _rasterio = None


def _normalise_transform(transform):
    """Return a six-value affine tuple in GDAL order."""
    if transform is None:
        return None
    if all(hasattr(transform, name) for name in ("a", "b", "c", "d", "e", "f")):
        values = (transform.a, transform.b, transform.c, transform.d, transform.e, transform.f)
    else:
        values = tuple(transform)
        if len(values) == 9:
            values = values[:6]
    if len(values) != 6:
        raise ValueError("transform must contain six affine values (a, b, c, d, e, f)")
    try:
        return tuple(float(value) for value in values)
    except (TypeError, ValueError) as error:
        raise ValueError("transform values must be numeric") from error


def _json_values(values, significant_digits=None):
    """Convert numeric values to JSON-safe scalars, mapping NaN to None.

    ``significant_digits`` rounds each finite value, which keeps in-chat
    payloads compact without changing the displayed image.
    """
    array = np.asarray(values, dtype=float)
    finite = np.isfinite(array)
    if significant_digits is not None:
        magnitude = np.zeros_like(array)
        nonzero = finite & (array != 0)
        magnitude[nonzero] = np.floor(np.log10(np.abs(array[nonzero])))
        scale = 10.0 ** (significant_digits - 1 - magnitude)
        array = np.where(finite, np.round(array * scale) / scale, array)
    result = array.astype(object)
    result[~finite] = None
    return result.tolist()


class GeophysicsRaster:
    """An in-memory, georeferenced geophysics raster.

    Parameters
    ----------
    data : array-like
        A two-dimensional ``(row, column)`` grid or three-dimensional
        ``(band, row, column)`` grid.  Two-dimensional inputs become a single
        band internally.
    transform : sequence of float, optional
        Six affine GDAL values ``(a, b, c, d, e, f)``.  ``None`` is valid for
        unreferenced grids.
    crs : str, optional
        Coordinate reference system identifier or WKT.
    nodata : float, optional
        Value representing absent samples.  Non-finite samples are always
        treated as absent by display code.
    band_names : sequence of str, optional
        Name for each band.  Defaults to ``band_1``, ``band_2``, and so on.
    metadata : dict, optional
        Source-specific, JSON-compatible metadata retained with the raster.

    Attributes
    ----------
    data : numpy.ndarray
        A three-dimensional array in ``(band, row, column)`` order.
    """

    def __init__(self, data, transform=None, crs=None, nodata=None, band_names=None, metadata=None):
        array = np.asarray(data)
        if array.ndim == 2:
            array = array[np.newaxis, :, :]
        if array.ndim != 3:
            raise ValueError("data must have shape (rows, columns) or (bands, rows, columns)")
        if array.shape[0] == 0 or array.shape[1] == 0 or array.shape[2] == 0:
            raise ValueError("data must contain at least one band, row, and column")
        if not np.issubdtype(array.dtype, np.number):
            try:
                array = array.astype(float)
            except (TypeError, ValueError) as error:
                raise ValueError("data must be numeric") from error

        self.data = array
        self.transform = _normalise_transform(transform)
        self.crs = None if crs is None else str(crs)
        self.nodata = None if nodata is None else float(nodata)
        if band_names is None:
            band_names = [f"band_{index + 1}" for index in range(array.shape[0])]
        if len(band_names) != array.shape[0]:
            raise ValueError("band_names must contain one name for every band")
        self.band_names = tuple(str(name) for name in band_names)
        self.metadata = dict(metadata or {})

    @property
    def band_count(self):
        """Number of raster bands."""
        return self.data.shape[0]

    @property
    def height(self):
        """Number of raster rows."""
        return self.data.shape[1]

    @property
    def width(self):
        """Number of raster columns."""
        return self.data.shape[2]

    @property
    def bounds(self):
        """Return ``(min_x, min_y, max_x, max_y)`` or ``None`` when unreferenced."""
        if self.transform is None:
            return None
        a, b, c, d, e, f = self.transform
        corners = (
            (c, f),
            (a * self.width + c, d * self.width + f),
            (b * self.height + c, e * self.height + f),
            (a * self.width + b * self.height + c, d * self.width + e * self.height + f),
        )
        xs, ys = zip(*corners)
        return min(xs), min(ys), max(xs), max(ys)

    @property
    def cell_size(self):
        """Return ``(column_spacing, row_spacing)`` as positive values, or ``None``.

        For a rotated grid these are the distances between adjacent cell
        centres along the column and row directions.

        Raises
        ------
        ValueError
            If the transform is sheared (column and row axes not
            perpendicular), where a cell is not rectangular.
        """
        if self.transform is None:
            return None
        a, b, _, d, e, _ = self.transform
        column_spacing = math.hypot(a, d)
        row_spacing = math.hypot(b, e)
        if abs(a * b + d * e) > 1e-9 * column_spacing * row_spacing:
            raise ValueError("cell size is undefined for a sheared transform")
        return column_spacing, row_spacing

    def band(self, index=1):
        """Return one band using GDAL's one-based band numbering.

        Parameters
        ----------
        index : int, optional
            One-based band number.

        Returns
        -------
        numpy.ndarray
            A two-dimensional ``(row, column)`` view.
        """
        if not isinstance(index, int) or index < 1 or index > self.band_count:
            raise IndexError(f"band index must be between 1 and {self.band_count}")
        return self.data[index - 1]

    def copy_with(self, data=None, processing=None, **changes):
        """Return a new raster sharing this raster's georeferencing.

        Parameters
        ----------
        data : array-like, optional
            Replacement data with the same row/column shape.  Defaults to a
            copy of the current data.
        processing : dict, optional
            One processing step appended to ``metadata["processing"]`` so
            derived grids record how they were made.
        **changes
            Replacement ``transform``, ``crs``, ``nodata``, ``band_names`` or
            ``metadata`` values.

        Returns
        -------
        GeophysicsRaster
        """
        metadata = dict(changes.pop("metadata", self.metadata))
        if processing is not None:
            metadata["processing"] = list(metadata.get("processing", [])) + [dict(processing)]
        return GeophysicsRaster(
            np.array(self.data, copy=True) if data is None else data,
            transform=changes.pop("transform", self.transform),
            crs=changes.pop("crs", self.crs),
            nodata=changes.pop("nodata", self.nodata),
            band_names=changes.pop("band_names", self.band_names),
            metadata=metadata,
            **changes,
        )

    def decimate(self, max_cells=160_000):
        """Block-average the raster so each band has at most ``max_cells`` cells.

        Parameters
        ----------
        max_cells : int, optional
            Upper bound on ``rows * columns`` after decimation.

        Returns
        -------
        GeophysicsRaster
            ``self`` when already small enough, otherwise a new raster whose
            cells are the NaN-aware mean of square ``factor x factor`` blocks.
            The transform is scaled to the larger cells and the factor is
            recorded in ``metadata["processing"]``.  No-data cells (the
            ``nodata`` value or non-finite) are ignored; all-empty blocks are
            NaN.
        """
        if max_cells < 1:
            raise ValueError("max_cells must be at least 1")
        cells = self.height * self.width
        if cells <= max_cells:
            return self
        factor = math.ceil(math.sqrt(cells / max_cells))
        while math.ceil(self.height / factor) * math.ceil(self.width / factor) > max_cells:
            factor += 1
        values = self.data.astype(float)
        if self.nodata is not None:
            values = np.where(values == self.nodata, np.nan, values)
        valid = np.isfinite(values)
        row_starts = np.arange(0, self.height, factor)
        column_starts = np.arange(0, self.width, factor)

        def block_sum(array):
            # reduceat handles the partial last block without padding, so
            # temporary storage stays bounded by the input size.
            return np.add.reduceat(np.add.reduceat(array, row_starts, axis=1), column_starts, axis=2)

        totals = block_sum(np.where(valid, values, 0.0))
        counts = block_sum(valid.astype(np.int64))
        means = np.full(totals.shape, np.nan)
        np.divide(totals, counts, out=means, where=counts > 0)
        transform = None
        if self.transform is not None:
            a, b, c, d, e, f = self.transform
            transform = (a * factor, b * factor, c, d * factor, e * factor, f)
        return self.copy_with(
            means,
            transform=transform,
            nodata=None,
            processing={"operation": "decimate", "factor": factor, "method": "block_mean"},
        )

    def to_payload(self, significant_digits=None):
        """Return a JSON-safe payload accepted by Baselode's JavaScript viewer.

        Parameters
        ----------
        significant_digits : int, optional
            Round values to this many significant digits.  Default keeps full
            precision.

        Returns
        -------
        dict
            ``data`` (nested ``[band][row][column]`` lists with ``None`` for
            missing cells, including cells equal to ``nodata``),
            ``transform``, ``crs``, ``nodata`` (always ``None``, as sentinel
            cells are already ``None``), ``bandNames`` and ``metadata``.
        """
        values = self.data.astype(float)
        if self.nodata is not None and math.isfinite(self.nodata):
            # Mark sentinel cells missing before rounding can change them.
            values = np.where(values == self.nodata, np.nan, values)
        return {
            "data": _json_values(values, significant_digits),
            "transform": self.transform,
            "crs": self.crs,
            # Sentinel cells are already null, and a NaN marker is not JSON.
            "nodata": None,
            "bandNames": list(self.band_names),
            "metadata": self.metadata,
        }

    def to_tool_ui_payload(self, title=None, subtitle=None, band=1, units=None,
                           palette="viridis", reverse_palette=False, stretch=None,
                           hillshade=None, show_controls=False, max_cells=160_000,
                           significant_digits=6, result_id=None):
        """Return a ``baselode_geophysics_raster`` Tool UI result for chat display.

        The raster is reduced to the requested band, block-averaged to at most
        ``max_cells`` cells and rounded so the payload stays small enough for
        an in-chat viewer.  Display options are passed through unchanged; the
        JavaScript viewer applies them.

        Parameters
        ----------
        title, subtitle : str, optional
            Viewer heading text.
        band : int, optional
            One-based band to display.
        units : str, optional
            Value units shown on the colour bar.  Defaults to the band units
            recorded in ``metadata["units"]`` when present.
        palette : str, optional
            A name from ``baselode.geophysics.colour_scales.COLOUR_SCALES``.
        reverse_palette : bool, optional
            Run the palette from high to low.
        stretch : dict, optional
            ``{"mode": "relative", "low": 2, "high": 98}`` (percentile clip,
            the default), ``{"mode": "absolute", "min": ..., "max": ...}``
            (data units) or ``{"mode": "equalize"}`` (histogram equalisation).
        hillshade : dict, optional
            ``enabled``, ``azimuth`` (degrees clockwise from north),
            ``altitude`` (degrees above horizon), ``strength`` (0-1) and
            ``zFactor`` (vertical exaggeration or ``"auto"``).
        show_controls : bool, optional
            Show the viewer's display controls.  Default ``False`` gives a
            static, chat-sized view.
        max_cells : int, optional
            Cell budget for the displayed band.
        significant_digits : int, optional
            Rounding applied to cell values.
        result_id : str, optional
            Stable result identifier.  Defaults to a random UUID.

        Returns
        -------
        dict
            JSON-safe Tool UI result.
        """
        if palette not in baselode.geophysics.colour_scales.COLOUR_SCALES:
            raise ValueError(f"unknown palette {palette!r}")
        values = self.band(band)
        band_units = list(self.metadata.get("units") or [])
        band_unit = band_units[band - 1] if band - 1 < len(band_units) else None
        if units is None:
            units = band_unit
        metadata = dict(self.metadata)
        if band_units:
            metadata["units"] = [band_unit]
        single = self.copy_with(
            values[np.newaxis, :, :],
            band_names=[self.band_names[band - 1]],
            metadata=metadata,
        ).decimate(max_cells)
        result = {
            "id": result_id or str(uuid.uuid4()),
            "raster": single.to_payload(significant_digits),
            "palette": palette,
            "reversePalette": bool(reverse_palette),
            "stretch": dict(stretch or {"mode": "relative", "low": 2, "high": 98}),
            "showControls": bool(show_controls),
        }
        baselode.geophysics.colour_scales.validate_stretch(result["stretch"])
        if hillshade is not None:
            result["hillshade"] = dict(hillshade)
        for key, value in (("title", title), ("subtitle", subtitle), ("units", units)):
            if value is not None:
                result[key] = str(value)
        return result

    @classmethod
    def from_payload(cls, payload):
        """Build a raster from :meth:`to_payload` output."""
        if not isinstance(payload, dict):
            raise ValueError("payload must be a dictionary")
        return cls(
            payload.get("data"),
            transform=payload.get("transform"),
            crs=payload.get("crs"),
            nodata=payload.get("nodata"),
            band_names=payload.get("bandNames"),
            metadata=payload.get("metadata"),
        )


def load_raster(source, bands=None, masked=True, engine=None, **kwargs):
    """Load a geophysics raster into memory.

    Parameters
    ----------
    source : path-like or file-like
        ER Mapper ``.ers`` header, or any raster source accepted by
        ``rasterio.open`` (GeoTIFF/COG, ENVI, and other GDAL formats).
    bands : sequence of int, optional
        One-based GDAL band numbers to read.  Defaults to every band.
    masked : bool, optional
        Replace the dataset mask with ``NaN`` values.  Default ``True`` makes
        no-data handling uniform for rendering and numerical algorithms.
    engine : {"ers", "rasterio"}, optional
        Reader to use.  Defaults to the native ``"ers"`` reader for ``.ers``
        paths and ``"rasterio"`` for everything else.
    **kwargs
        Additional keyword arguments forwarded to ``rasterio.open``.

    Returns
    -------
    GeophysicsRaster
        Fully loaded raster with affine transform, CRS, no-data value, names,
        and source metadata.

    Raises
    ------
    ImportError
        If Rasterio is needed but the optional dependency is not installed.
    """
    if engine is None:
        is_ers = isinstance(source, (str, pathlib.PurePath)) and str(source).lower().endswith(".ers")
        engine = "ers" if is_ers else "rasterio"
    if engine == "ers":
        if kwargs:
            raise TypeError(f"the ERS reader does not accept {sorted(kwargs)}")
        raster = baselode.geophysics.ers.read_ers(source, masked=masked)
        if bands is None:
            return raster
        indexes = list(bands)
        return raster.copy_with(
            np.stack([raster.band(index) for index in indexes]),
            band_names=[raster.band_names[index - 1] for index in indexes],
            metadata={
                **raster.metadata,
                "units": [raster.metadata["units"][index - 1] for index in indexes],
            },
        )
    if engine != "rasterio":
        raise ValueError(f"unknown raster engine {engine!r}")
    if _rasterio is None:
        raise ImportError(
            "Raster file support requires rasterio/GDAL. "
            "Install it with: pip install 'baselode[raster]'"
        )
    with _rasterio.open(source, **kwargs) as dataset:
        indexes = list(bands) if bands is not None else list(dataset.indexes)
        if not indexes:
            raise ValueError("raster contains no bands")
        data = dataset.read(indexes=indexes, masked=masked)
        if np.ma.isMaskedArray(data):
            data = data.astype(float).filled(np.nan)
        descriptions = dataset.descriptions or ()
        band_names = [
            descriptions[index - 1] or f"band_{index}"
            for index in indexes
        ]
        tags = dataset.tags()
        metadata = {
            "driver": dataset.driver,
            "source": str(dataset.name),
            "tags": tags,
        }
        return GeophysicsRaster(
            data,
            transform=dataset.transform,
            crs=dataset.crs,
            nodata=dataset.nodata,
            band_names=band_names,
            metadata=metadata,
        )
