# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

"""Native ER Mapper ``.ers`` raster reader.

An ERS dataset is a plain-text header (``grid.ers``) beside a raw
band-interleaved-by-line binary file (``grid``).  Australian government
geophysics grids are distributed in this form.  This reader needs only NumPy,
so ``.ers`` grids load on a core Baselode install without GDAL.

Georeferencing follows the GDAL ERS driver: the registration coordinate is the
top-left corner of the registration cell, which defaults to cell ``(0, 0)``.
"""

import pathlib
import re

import numpy as np

import baselode.geophysics.raster


CELL_TYPES = {
    "unsigned8bitinteger": "u1",
    "signed8bitinteger": "i1",
    "unsigned16bitinteger": "u2",
    "signed16bitinteger": "i2",
    "unsigned32bitinteger": "u4",
    "signed32bitinteger": "i4",
    "ieee4bytereal": "f4",
    "ieee8bytereal": "f8",
}

_DATUM_EPSG = {
    "GDA94": {"geodetic": 4283, "mga": 28300},
    "GDA2020": {"geodetic": 7844, "mga": 7800},
    "AGD66": {"geodetic": 4202, "amg": 20200},
    "AGD84": {"geodetic": 4203, "amg": 20300},
    "WGS84": {"geodetic": 4326, "nutm": 32600, "sutm": 32700},
}

_ZONED_PROJECTION = re.compile(r"^(MGA|AMG|NUTM|SUTM)(\d{1,2})$")


def parse_ers_header(text):
    """Parse ERS header text into nested dictionaries.

    Parameters
    ----------
    text : str
        Contents of an ``.ers`` header file.

    Returns
    -------
    dict
        ``Name Begin`` / ``Name End`` blocks become nested dictionaries and
        ``key = value`` lines become string values with quotes removed.  A
        repeated block or key (for example ``BandId``) becomes a list.
    """
    root = {}
    stack = [root]
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, value = line.split("=", 1)
            _store(stack[-1], key.strip(), value.strip().strip('"'))
            continue
        parts = line.split()
        if len(parts) == 2 and parts[1] == "Begin":
            block = {}
            _store(stack[-1], parts[0], block)
            stack.append(block)
        elif len(parts) == 2 and parts[1] == "End":
            if len(stack) == 1:
                raise ValueError(f"ERS header line {line_number}: unmatched '{line}'")
            stack.pop()
        else:
            raise ValueError(f"ERS header line {line_number}: cannot parse '{line}'")
    if len(stack) != 1:
        raise ValueError("ERS header ends inside an unclosed block")
    if "DatasetHeader" not in root:
        raise ValueError("ERS header has no DatasetHeader block")
    return root["DatasetHeader"]


def _store(container, key, value):
    if key not in container:
        container[key] = value
    elif isinstance(container[key], list):
        container[key].append(value)
    else:
        container[key] = [container[key], value]


def _as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _parse_dms(value):
    """Parse an ERS ``d:m:s`` angle (or a plain decimal) to decimal degrees."""
    text = str(value).strip()
    if ":" not in text:
        return float(text)
    negative = text.startswith("-")
    parts = [float(part) for part in text.lstrip("+-").split(":")]
    parts += [0.0] * (3 - len(parts))
    degrees = parts[0] + parts[1] / 60.0 + parts[2] / 3600.0
    return -degrees if negative else degrees


def ers_crs(datum, projection):
    """Map an ERS datum/projection pair to an ``EPSG:`` identifier.

    Parameters
    ----------
    datum : str
        ERS ``Datum`` value, for example ``"GDA94"``.
    projection : str
        ERS ``Projection`` value, for example ``"MGA51"`` or ``"GEODETIC"``.

    Returns
    -------
    str or None
        ``"EPSG:<code>"`` for the Australian and WGS84 systems used by
        government geophysics grids, otherwise ``None``.  The raw ERS values
        are always kept in the raster metadata.
    """
    codes = _DATUM_EPSG.get(str(datum or "").upper())
    if codes is None:
        return None
    projection = str(projection or "").upper()
    if projection in ("GEODETIC", "GEOGRAPHIC"):
        return f"EPSG:{codes['geodetic']}"
    match = _ZONED_PROJECTION.match(projection)
    if match is None:
        return None
    family, zone = match.group(1).lower(), int(match.group(2))
    if family not in codes or not 1 <= zone <= 60:
        return None
    return f"EPSG:{codes[family] + zone}"


def _registration(raster_info, coordinate_type):
    # ER Mapper writes ``RegistrationCoord``; some tools write the long form.
    coordinate = raster_info.get("RegistrationCoord") or raster_info.get("RegistrationCoordinate") or {}
    if coordinate_type == "LL":
        x, y = coordinate.get("Longitude"), coordinate.get("Latitude")
        x = None if x is None else _parse_dms(x)
        y = None if y is None else _parse_dms(y)
    elif coordinate_type == "RAW":
        x, y = coordinate.get("MetresX"), coordinate.get("MetresY")
    else:
        x, y = coordinate.get("Eastings"), coordinate.get("Northings")
    if x is None or y is None:
        return None
    return float(x), float(y)


def read_ers(path, masked=True):
    """Load an ER Mapper ``.ers`` raster into a ``GeophysicsRaster``.

    Parameters
    ----------
    path : str or path-like
        Path to the ``.ers`` header.  The binary data file is the header path
        without its ``.ers`` suffix unless the header names a ``DataFile``.
    masked : bool, optional
        Replace ``NullCellValue`` cells with ``NaN`` (data become floating
        point).  Default ``True``.

    Returns
    -------
    GeophysicsRaster
        Bands in ``(band, row, column)`` order with a GDAL affine transform,
        an ``EPSG:`` CRS where the datum/projection is recognised, the null
        value as ``nodata``, ``BandId`` values as band names, and band units
        and raw ERS georeferencing in ``metadata``.

    Raises
    ------
    ValueError
        If the header is malformed, describes a non-raster or rotated dataset,
        uses an unsupported cell type, or the data file is the wrong size.
    """
    header_path = pathlib.Path(path)
    header = parse_ers_header(header_path.read_text(encoding="latin-1"))
    if str(header.get("DataType", "Raster")).lower() != "raster":
        raise ValueError(f"{header_path.name}: only ERS raster datasets are supported")

    raster_info = header.get("RasterInfo")
    if not isinstance(raster_info, dict):
        raise ValueError(f"{header_path.name}: missing RasterInfo block")
    cell_type = str(raster_info.get("CellType", "")).lower()
    if cell_type not in CELL_TYPES:
        raise ValueError(f"{header_path.name}: unsupported CellType {raster_info.get('CellType')!r}")
    byte_order = ">" if str(header.get("ByteOrder", "LSBFirst")).lower() == "msbfirst" else "<"
    dtype = np.dtype(byte_order + CELL_TYPES[cell_type])
    try:
        rows = int(raster_info["NrOfLines"])
        columns = int(raster_info["NrOfCellsPerLine"])
        band_count = int(raster_info.get("NrOfBands", 1))
    except (KeyError, ValueError) as error:
        raise ValueError(f"{header_path.name}: RasterInfo needs integer NrOfLines and NrOfCellsPerLine") from error

    data_path = header_path.with_suffix("")
    if header.get("DataFile"):
        data_path = header_path.parent / header["DataFile"]
    offset = int(header.get("HeaderOffset", 0))
    expected = rows * columns * band_count
    values = np.fromfile(data_path, dtype=dtype, count=expected, offset=offset)
    if values.size != expected:
        raise ValueError(
            f"{data_path.name}: expected {expected} cells for {band_count} band(s) of "
            f"{rows} x {columns}, found {values.size}"
        )
    # Band-interleaved by line: each line holds every band in turn.
    data = values.reshape(rows, band_count, columns).transpose(1, 0, 2).astype(dtype.newbyteorder("="))

    nodata = raster_info.get("NullCellValue")
    nodata = None if nodata in (None, "") else float(nodata)
    if masked and nodata is not None:
        data = data.astype(np.float64 if data.dtype.itemsize > 4 or data.dtype.kind in "iu" else np.float32)
        data[data == nodata] = np.nan

    space = header.get("CoordinateSpace") or {}
    rotation = _parse_dms(space.get("Rotation", "0"))
    if abs(rotation) > 1e-9:
        raise ValueError(f"{header_path.name}: rotated ERS grids ({rotation} degrees) are not supported")
    coordinate_type = str(space.get("CoordinateType", "EN")).upper()
    cell_info = raster_info.get("CellInfo") or {}
    transform = None
    registration = _registration(raster_info, coordinate_type)
    if registration is not None and cell_info:
        cell_x = float(cell_info.get("Xdimension", 1))
        cell_y = float(cell_info.get("Ydimension", 1))
        origin_x = registration[0] - float(raster_info.get("RegistrationCellX", 0)) * cell_x
        origin_y = registration[1] + float(raster_info.get("RegistrationCellY", 0)) * cell_y
        transform = (cell_x, 0.0, origin_x, 0.0, -cell_y, origin_y)

    band_ids = _as_list(raster_info.get("BandId"))
    band_names = []
    units = []
    for index in range(band_count):
        band_id = band_ids[index] if index < len(band_ids) and isinstance(band_ids[index], dict) else {}
        band_names.append(band_id.get("Value") or f"band_{index + 1}")
        units.append(band_id.get("Units") or None)

    metadata = {
        "driver": "ERS",
        "source": str(header_path),
        "datum": space.get("Datum"),
        "projection": space.get("Projection"),
        "coordinate_type": coordinate_type,
        "cell_type": raster_info.get("CellType"),
        "units": units,
    }
    return baselode.geophysics.raster.GeophysicsRaster(
        data,
        transform=transform,
        crs=ers_crs(space.get("Datum"), space.get("Projection")),
        nodata=nodata,
        band_names=band_names,
        metadata=metadata,
    )
