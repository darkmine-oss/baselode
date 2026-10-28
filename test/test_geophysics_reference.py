# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

"""Cross-language reference for geophysics hillshade, stretch and colour.

``test/data/geophysics_reference.json`` holds Python outputs for a small grid.
This test keeps the file current; ``javascript/packages/baselode/tests/
geophysicsReference.test.js`` checks the browser renderer against it.

Regenerate after an intentional change with::

    PYTHONPATH=python/src python test/test_geophysics_reference.py
"""

import json
import pathlib

import numpy as np

import baselode.geophysics


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
    }


def test_reference_fixture_is_current():
    expected = json.loads(json.dumps(build_reference()))
    assert json.loads(FIXTURE_PATH.read_text()) == expected, (
        "geophysics_reference.json is out of date; regenerate it (see module docstring)"
    )


if __name__ == "__main__":
    FIXTURE_PATH.write_text(json.dumps(build_reference(), indent=1) + "\n")
