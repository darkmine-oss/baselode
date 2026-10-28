# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

"""Cross-language reference for geophysics hillshade, stretch and colour.

``test/data/geophysics_reference.json`` holds Python outputs for a small grid.
This test keeps the file current; ``javascript/packages/baselode/tests/
geophysicsReference.test.js`` checks the browser renderer against it.

Regenerate after an intentional change with::

    PYTHONPATH=python/src python test/test_geophysics_reference.py
"""

import base64
import json
import pathlib
import tempfile

import numpy as np
import pytest

import baselode.geophysics
import baselode.geophysics.ers


FIXTURE_PATH = pathlib.Path(__file__).resolve().parent / "data" / "geophysics_reference.json"


def _grid():
    rows, columns = np.indices((6, 7), dtype=float)
    values = 40 * np.sin(columns / 2.0) + 15 * np.cos(rows / 1.5) + 3 * rows * columns
    values[2, 3] = np.nan
    values[5, 0] = -99999
    return baselode.geophysics.GeophysicsRaster(
        values, transform=(25, 0, 400000, 0, -40, 6500000), nodata=-99999,
    )


def _rounded(values):
    array = np.asarray(values, dtype=float)
    result = np.round(array, 10).astype(object)
    result[~np.isfinite(array)] = None
    return result.tolist()


ERS_HEADER = """DatasetHeader Begin
\tVersion\t= "7.0"
\tDataType\t= Raster
\tByteOrder\t= {byte_order}
\tCoordinateSpace Begin
\t\tDatum\t= "{datum}"
\t\tProjection\t= "{projection}"
\t\tCoordinateType\t= {coordinate_type}
\t\tRotation\t= 0:0:0.0
\tCoordinateSpace End
\tRasterInfo Begin
\t\tCellType\t= {cell_type}
\t\tNullCellValue\t= {null}
\t\tCellInfo Begin
\t\t\tXdimension\t= {cell_x}
\t\t\tYdimension\t= {cell_y}
\t\tCellInfo End
\t\tNrOfLines\t= {rows}
\t\tNrOfCellsPerLine\t= {columns}
\t\tRegistrationCellX\t= 1
\t\tRegistrationCellY\t= 2
\t\tRegistrationCoord Begin
{registration}
\t\tRegistrationCoord End
\t\tNrOfBands\t= {bands}
{band_ids}
\tRasterInfo End
DatasetHeader End
"""


def _ers_cases():
    """Small ERS datasets covering byte order, cell types and registration."""
    rows, columns = np.indices((5, 6), dtype=float)
    magnetics = 30 * np.sin(columns / 2.0) + 4 * rows - 12.5
    magnetics[1, 2] = -99999
    gravity = (rows * 6 + columns) * 0.25
    gravity[4, 5] = -99999
    elevation = (rows * 6 + columns) * 3 - 20
    elevation[0, 0] = -32768
    bands = [("TMI", "nT"), ("Bouguer", "mGal")]
    return [
        {
            "name": "float32_msb_two_band_mga",
            "data": np.stack([magnetics, gravity]), "dtype": ">f4",
            "header": {"byte_order": "MSBFirst", "datum": "GDA94", "projection": "MGA51",
                       "coordinate_type": "EN", "cell_type": "IEEE4ByteReal", "null": -99999,
                       "cell_x": 50, "cell_y": 40,
                       "registration": "\t\t\tEastings\t= 500050\n\t\t\tNorthings\t= 6999920",
                       "band_ids": bands},
        },
        {
            "name": "int16_lsb_geodetic",
            "data": elevation[np.newaxis], "dtype": "<i2",
            "header": {"byte_order": "LSBFirst", "datum": "GDA2020", "projection": "GEODETIC",
                       "coordinate_type": "LL", "cell_type": "Signed16BitInteger", "null": -32768,
                       "cell_x": 0.0025, "cell_y": 0.0025,
                       "registration": "\t\t\tLongitude\t= 121:30:0.0\n\t\t\tLatitude\t= -30:15:0.0",
                       "band_ids": [("Elevation", "m")]},
        },
    ]


def _ers_text(case):
    header = dict(case["header"])
    data = case["data"]
    header["band_ids"] = "\n".join(
        f"\t\tBandId Begin\n\t\t\tValue\t= \"{value}\"\n\t\t\tUnits\t= \"{units}\"\n\t\tBandId End"
        for value, units in header["band_ids"]
    )
    return ERS_HEADER.format(bands=data.shape[0], rows=data.shape[1], columns=data.shape[2], **header)


def build_ers_reference():
    cases = []
    with tempfile.TemporaryDirectory() as directory:
        for case in _ers_cases():
            header_path = pathlib.Path(directory) / f"{case['name']}.ers"
            header_path.write_text(_ers_text(case))
            # Band-interleaved by line.
            binary = case["data"].transpose(1, 0, 2).astype(case["dtype"]).tobytes()
            header_path.with_suffix("").write_bytes(binary)
            raster = baselode.geophysics.ers.read_ers(header_path)
            payload = raster.to_payload()
            payload["metadata"].pop("source")
            decimated = raster.decimate(max_cells=6).to_payload()
            cases.append({
                "name": case["name"],
                "header": _ers_text(case),
                "data": base64.b64encode(binary).decode("ascii"),
                "nodata": raster.nodata,
                "raster": payload,
                "decimated6": {key: decimated[key] for key in ("data", "transform")},
            })
    return cases


def build_reference():
    raster = _grid()
    cases = []
    for name, options in (
        ("auto_nw", {"azimuth": 315, "altitude": 45, "z_factor": "auto"}),
        ("fixed_low_sun", {"azimuth": 100, "altitude": 30, "z_factor": 2.5}),
    ):
        cases.append({
            "name": name,
            "options": {"azimuth": options["azimuth"], "altitude": options["altitude"],
                        "zFactor": options["z_factor"]},
            "shade": _rounded(baselode.geophysics.hillshade(raster, **options)),
        })
    stretches = []
    for stretch in (
        {"mode": "relative", "low": 5, "high": 95},
        {"mode": "absolute", "min": -10, "max": 30},
        {"mode": "equalize"},
    ):
        ratios, limits = baselode.geophysics.stretch_values(raster.band(1), stretch, raster.nodata)
        stretches.append({"stretch": stretch, "ratios": _rounded(ratios), "limits": list(limits)})
    shade = baselode.geophysics.hillshade(raster)
    renders = []
    for palette, stretch, reverse, with_shade in (
        ("turbo", {"mode": "relative", "low": 2, "high": 98}, False, True),
        ("magnetic", {"mode": "equalize"}, True, False),
    ):
        rgba = baselode.geophysics.colourize(
            raster.band(1), palette=palette, stretch=stretch, reverse=reverse, nodata=raster.nodata,
            shade=shade if with_shade else None, shade_strength=0.65,
        )
        renders.append({
            "palette": palette,
            "stretch": stretch,
            "reversePalette": reverse,
            "hillshade": {"enabled": with_shade, "azimuth": 315, "altitude": 45, "strength": 0.65,
                          "zFactor": "auto"},
            "rgba": rgba.reshape(-1).tolist(),
        })
    return {
        "raster": raster.to_payload(),
        "zFactorAuto": baselode.geophysics.hillshade_z_factor(raster),
        "hillshade": cases,
        "stretches": stretches,
        "renders": renders,
        "ers": build_ers_reference(),
    }


def _assert_matches(actual, expected, path="reference"):
    """Compare nested JSON, allowing platform-level floating-point differences.

    A failure names the first differing path; regenerate the fixture if the
    change is intended (see module docstring).
    """
    if isinstance(expected, dict):
        assert isinstance(actual, dict) and actual.keys() == expected.keys(), path
        for key in expected:
            _assert_matches(actual[key], expected[key], f"{path}.{key}")
    elif isinstance(expected, list):
        assert isinstance(actual, list) and len(actual) == len(expected), path
        for index, (left, right) in enumerate(zip(actual, expected)):
            _assert_matches(left, right, f"{path}[{index}]")
    elif isinstance(expected, float) or isinstance(actual, float):
        assert actual is not None and expected is not None, path
        assert actual == pytest.approx(expected, rel=1e-9, abs=1e-9), path
    elif ".rgba[" in path and isinstance(expected, int):
        # A channel can round either side of .5 on another platform.
        assert abs(actual - expected) <= 1, path
    else:
        assert actual == expected, path


def test_reference_fixture_is_current():
    expected = json.loads(json.dumps(build_reference()))
    _assert_matches(json.loads(FIXTURE_PATH.read_text()), expected)


if __name__ == "__main__":
    FIXTURE_PATH.write_text(json.dumps(build_reference(), indent=1) + "\n")
