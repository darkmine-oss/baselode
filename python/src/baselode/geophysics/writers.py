# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

"""Write geophysics rasters to ER Mapper ``.ers`` and GeoTIFF files.

ERS needs only NumPy.  GeoTIFF uses Rasterio, from the optional ``raster``
extra (``pip install 'baselode[raster]'``).  Both round-trip through
:func:`baselode.geophysics.load_raster`, and JavaScript's ``encodeErs`` and
``encodeGeoTiff`` write the same layouts.
"""

import pathlib

import numpy as np
import pyproj

import baselode.geophysics.colour_scales

try:
    import rasterio as _rasterio  # provided by the `raster` extra
except ImportError:
    _rasterio = None


# Null value for float grids that have none; the usual Australian
# government grid convention.
DEFAULT_ERS_NULL = -99999.0

_ERS_CELL_TYPES = {
    "uint8": "Unsigned8BitInteger",
    "int8": "Signed8BitInteger",
    "uint16": "Unsigned16BitInteger",
    "int16": "Signed16BitInteger",
    "uint32": "Unsigned32BitInteger",
    "int32": "Signed32BitInteger",
    "float32": "IEEE4ByteReal",
    "float64": "IEEE8ByteReal",
}

_GEODETIC = {4283: "GDA94", 7844: "GDA2020", 4202: "AGD66", 4203: "AGD84", 4326: "WGS84"}
# (first code, datum, projection prefix): zone = code - first code.
_ZONED = (
    (28300, "GDA94", "MGA"),
    (7800, "GDA2020", "MGA"),
    (20200, "AGD66", "AMG"),
    (20300, "AGD84", "AMG"),
    (32600, "WGS84", "NUTM"),
    (32700, "WGS84", "SUTM"),
)


def ers_coordinate_space(crs):
    """Map a CRS to an ERS ``(datum, projection, coordinate_type)``.

    Parameters
    ----------
    crs : str, int or None
        ``EPSG:`` identifier (or anything pyproj reads that has an EPSG
        code).

    Returns
    -------
    tuple of str
        For example ``("GDA94", "MGA50", "EN")`` or ``("GDA94", "GEODETIC",
        "LATLONG")``; ``("RAW", "RAW", "EN")`` when there is no CRS or it has
        no ERS name (the inverse of :func:`baselode.geophysics.ers.ers_crs`).
        Unnamed grids keep eastings and northings, as GDAL writes them, so
        GDAL still reads their position.
    """
    if crs is None:
        return "RAW", "RAW", "EN"
    code = pyproj.CRS.from_user_input(crs).to_epsg()
    if code in _GEODETIC:
        return _GEODETIC[code], "GEODETIC", "LATLONG"
    for first, datum, prefix in _ZONED:
        zone = (code or 0) - first
        if 1 <= zone <= 60 and (prefix in ("NUTM", "SUTM") or 49 <= zone <= 58):
            return datum, f"{prefix}{zone}", "EN"
    return "RAW", "RAW", "EN"


def _north_up(raster):
    if raster.transform is None:
        raise ValueError("the raster has no transform; ERS grids need a cell size and origin")
    a, b, c, d, e, f = raster.transform
    if b != 0 or d != 0 or a <= 0 or e >= 0:
        raise ValueError("ERS grids must be north-up (no rotation, positive cell sizes)")
    return a, -e, c, f


def _dms(value):
    """Format decimal degrees as an ERS ``d:m:s`` angle."""
    sign = "-" if value < 0 else ""
    value = abs(value)
    degrees = int(value)
    minutes = int((value - degrees) * 60)
    seconds = (value - degrees - minutes / 60) * 3600
    return f"{sign}{degrees}:{minutes}:{seconds!r}"


def _output_dtype(raster, dtype):
    if dtype is not None:
        name = np.dtype(dtype).name
    elif np.issubdtype(raster.data.dtype, np.floating):
        name = "float32"
    else:
        name = np.dtype(raster.data.dtype).name
    if name not in _ERS_CELL_TYPES:
        raise ValueError(f"cannot write {name} cells; use one of {sorted(_ERS_CELL_TYPES)}")
    return np.dtype(name)


def _cells(raster, dtype, null):
    """Band data in ``dtype`` with missing cells set to ``null``.

    Raises ``ValueError`` when a missing cell has no null value, a value or
    the null value does not fit the type, or a real value would be read
    back as null.
    """
    valid = baselode.geophysics.colour_scales.valid_mask(raster.data, raster.nodata)
    if not valid.all() and null is None:
        raise ValueError("the raster has missing cells but the output type has no null value; pass nodata")
    if dtype.kind in "iu":
        info = np.iinfo(dtype)
        if null is not None and (not info.min <= null <= info.max or null != round(null)):
            raise ValueError(f"nodata {null!r} does not fit {dtype.name} cells")
        data = raster.data[valid]
        if data.size and (data.min() < info.min or data.max() > info.max or not np.array_equal(data, np.round(data))):
            raise ValueError(f"values do not fit {dtype.name} cells")
    if dtype.kind == "f":
        largest = float(np.finfo(dtype).max)
        if null is not None and np.isfinite(null) and abs(null) > largest:
            raise ValueError(f"nodata {null!r} is too large for {dtype.name} cells")
        data = raster.data[valid]
        if data.size and np.abs(data).max() > largest:
            raise ValueError(f"values are too large for {dtype.name} cells; pass dtype='float64'")
    cells = np.where(valid, raster.data, null if null is not None else 0).astype(dtype)
    if null is not None and np.isfinite(null) and (cells[valid] == np.asarray(null).astype(dtype)).any():
        raise ValueError(
            f"the null value {null!r} also occurs as data, so those cells would read back as missing; "
            "pass a different nodata"
        )
    return cells


def _null_value(raster, dtype, nodata):
    if nodata is not None:
        return float(nodata)
    if raster.nodata is not None and np.isfinite(raster.nodata):
        return raster.nodata
    return DEFAULT_ERS_NULL if dtype.kind == "f" else None


def ers_header(raster, name, dtype=None, nodata=None):
    """Return the text of an ERS header describing ``raster``.

    See :func:`write_ers` for the parameters.
    """
    dtype = _output_dtype(raster, dtype)
    cell_x, cell_y, origin_x, origin_y = _north_up(raster)
    null = _null_value(raster, dtype, nodata)
    datum, projection, coordinate_type = ers_coordinate_space(raster.crs)
    if coordinate_type == "LATLONG":
        registration = [f"Longitude\t= {_dms(origin_x)}", f"Latitude\t= {_dms(origin_y)}"]
    else:
        registration = [f"Eastings\t= {origin_x!r}", f"Northings\t= {origin_y!r}"]
    units = list(raster.metadata.get("units") or [])
    lines = [
        "DatasetHeader Begin",
        '\tVersion\t= "6.0"',
        f'\tName\t= "{name}"',
        "\tDataSetType\t= ERStorage",
        "\tDataType\t= Raster",
        "\tByteOrder\t= LSBFirst",
        "\tCoordinateSpace Begin",
        f'\t\tDatum\t= "{datum}"',
        f'\t\tProjection\t= "{projection}"',
        f"\t\tCoordinateType\t= {coordinate_type}",
        "\t\tRotation\t= 0:0:0.0",
        "\tCoordinateSpace End",
        "\tRasterInfo Begin",
        f"\t\tCellType\t= {_ERS_CELL_TYPES[dtype.name]}",
    ]
    if null is not None:
        lines.append(f"\t\tNullCellValue\t= {null!r}")
    lines += [
        "\t\tCellInfo Begin",
        f"\t\t\tXdimension\t= {cell_x!r}",
        f"\t\t\tYdimension\t= {cell_y!r}",
        "\t\tCellInfo End",
        f"\t\tNrOfLines\t= {raster.height}",
        f"\t\tNrOfCellsPerLine\t= {raster.width}",
        "\t\tRegistrationCoord Begin",
        *(f"\t\t\t{line}" for line in registration),
        "\t\tRegistrationCoord End",
        "\t\tRegistrationCellX\t= 0",
        "\t\tRegistrationCellY\t= 0",
        f"\t\tNrOfBands\t= {raster.band_count}",
    ]
    for index, band_name in enumerate(raster.band_names):
        lines += ["\t\tBandId Begin", f'\t\t\tValue\t= "{band_name}"']
        if index < len(units) and units[index]:
            lines.append(f'\t\t\tUnits\t= "{units[index]}"')
        lines.append("\t\tBandId End")
    lines += ["\tRasterInfo End", "DatasetHeader End", ""]
    return "\n".join(lines)


def ers_data(raster, dtype=None, nodata=None):
    """Return the ERS binary data (little-endian, band-interleaved by line)."""
    dtype = _output_dtype(raster, dtype)
    _north_up(raster)
    cells = _cells(raster, dtype, _null_value(raster, dtype, nodata))
    return np.ascontiguousarray(cells.transpose(1, 0, 2)).astype(dtype.newbyteorder("<")).tobytes()


def write_ers(raster, path, dtype=None, nodata=None):
    """Write an ER Mapper ``.ers`` header and its data file.

    Parameters
    ----------
    raster : GeophysicsRaster
        A north-up raster.
    path : str or path-like
        The header path, ending ``.ers``.  The data file is written beside
        it without the suffix, as ER Mapper expects.
    dtype : str or numpy.dtype, optional
        Cell type.  Defaults to ``float32`` for float data, the usual
        precision of distributed grids (pass ``"float64"`` to keep full
        precision), and the data's own integer type otherwise.
    nodata : float, optional
        ``NullCellValue`` for missing cells.  Defaults to the raster's
        ``nodata``, or ``-99999`` for float grids without one.

    Returns
    -------
    tuple of pathlib.Path
        ``(header_path, data_path)``.

    Raises
    ------
    ValueError
        For a rotated or unreferenced raster, a path not ending ``.ers``, or
        values that do not fit the cell type.

    Notes
    -----
    The CRS is written as an ERS datum and projection when it is one of the
    Australian or WGS84 systems :func:`baselode.geophysics.ers.ers_crs`
    reads; otherwise the header says ``RAW``.
    """
    header_path = pathlib.Path(path)
    if header_path.suffix.lower() != ".ers":
        raise ValueError("the ERS header path must end in .ers")
    data_path = header_path.with_suffix("")
    data = ers_data(raster, dtype=dtype, nodata=nodata)
    header = ers_header(raster, header_path.name, dtype=dtype, nodata=nodata)
    data_path.write_bytes(data)
    header_path.write_text(header, encoding="latin-1")
    return header_path, data_path


def write_geotiff(raster, path, dtype=None, nodata=None, compress="deflate"):
    """Write a GeoTIFF with Rasterio.

    Parameters
    ----------
    raster : GeophysicsRaster
    path : str or path-like
    dtype : str or numpy.dtype, optional
        Defaults as for :func:`write_ers`.
    nodata : float, optional
        Value written for missing cells.  Defaults to the raster's
        ``nodata``, or ``NaN`` for float grids.
    compress : str or None, optional
        GDAL compression; ``None`` for none.

    Returns
    -------
    pathlib.Path

    Raises
    ------
    ImportError
        Without the ``raster`` extra.
    """
    if _rasterio is None:
        raise ImportError(
            "Writing GeoTIFF needs rasterio/GDAL. Install it with: pip install 'baselode[raster]'"
        )
    dtype = _output_dtype(raster, dtype)
    if nodata is not None:
        null = float(nodata)
    elif raster.nodata is not None:
        null = raster.nodata
    else:
        null = float("nan") if dtype.kind == "f" else None
    profile = {
        "driver": "GTiff",
        "width": raster.width,
        "height": raster.height,
        "count": raster.band_count,
        "dtype": dtype.name,
        "nodata": null,
        "crs": raster.crs,
        "transform": None if raster.transform is None else _rasterio.Affine(*raster.transform),
    }
    if compress:
        profile["compress"] = compress
    path = pathlib.Path(path)
    cells = _cells(raster, dtype, null)
    units = list(raster.metadata.get("units") or [])
    with _rasterio.open(path, "w", **profile) as dataset:
        dataset.write(cells)
        for index, band_name in enumerate(raster.band_names, start=1):
            dataset.set_band_description(index, band_name)
            if index <= len(units) and units[index - 1]:
                dataset.set_band_unit(index, units[index - 1])
    return path


def save_raster(raster, path, **kwargs):
    """Write a raster, choosing the format from the file extension.

    ``.ers`` writes ER Mapper with :func:`write_ers`; ``.tif`` and
    ``.tiff`` write GeoTIFF with :func:`write_geotiff`.  Keyword arguments
    pass through.
    """
    suffix = pathlib.Path(path).suffix.lower()
    if suffix == ".ers":
        return write_ers(raster, path, **kwargs)[0]
    if suffix in (".tif", ".tiff"):
        return write_geotiff(raster, path, **kwargs)
    raise ValueError(f"cannot tell the raster format from {suffix or 'no extension'}; use .ers or .tif")
