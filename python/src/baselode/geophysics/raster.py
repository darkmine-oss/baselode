"""Georeferenced raster data for geophysics workflows.

``GeophysicsRaster`` stores bands in the same order used by GDAL and Rasterio:
``(band, row, column)``.  The affine transform is the six-value GDAL form
``(a, b, c, d, e, f)`` where ``x = a * column + b * row + c`` and
``y = d * column + e * row + f``.  North-up rasters normally have a negative
``e`` value.

File access is deliberately separate from the model.  Install the optional
extra with ``pip install 'baselode[raster]'`` to load ER Mapper ERS, GeoTIFF,
ENVI grids, and every other raster driver available in the installed GDAL.
"""

import numpy as np

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


def _json_values(values):
    """Convert numeric values to JSON-safe scalars, mapping NaN to None."""
    array = np.asarray(values)
    result = array.astype(object)
    result[~np.isfinite(array)] = None
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

    def to_payload(self):
        """Return a JSON-safe payload accepted by Baselode's JavaScript viewer."""
        return {
            "data": _json_values(self.data),
            "transform": self.transform,
            "crs": self.crs,
            "nodata": self.nodata,
            "bandNames": list(self.band_names),
            "metadata": self.metadata,
        }

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


def load_raster(source, bands=None, masked=True, **kwargs):
    """Load a GDAL-supported geophysics raster into memory.

    Parameters
    ----------
    source : path-like or file-like
        Raster source accepted by ``rasterio.open``.  ER Mapper ``.ers``,
        GeoTIFF/COG, ENVI, and other GDAL-supported raster formats are
        available when their GDAL drivers are installed.
    bands : sequence of int, optional
        One-based GDAL band numbers to read.  Defaults to every band.
    masked : bool, optional
        Replace the dataset mask with ``NaN`` values.  Default ``True`` makes
        no-data handling uniform for rendering and numerical algorithms.
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
        If the optional Rasterio dependency is not installed.
    """
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
