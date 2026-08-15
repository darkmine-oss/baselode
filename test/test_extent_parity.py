# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

import json
from pathlib import Path
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]
PYTHON_SRC_PATH = ROOT / "python" / "src"
JS_PACKAGE_PATH = ROOT / "javascript" / "packages" / "baselode"
JS_RUNNER_PATH = JS_PACKAGE_PATH / "scripts" / "run-extent-parity.mjs"

if str(PYTHON_SRC_PATH) not in sys.path:
    sys.path.insert(0, str(PYTHON_SRC_PATH))


def _javascript_results(cases):
    completed = subprocess.run(
        ["node", str(JS_RUNNER_PATH)],
        cwd=JS_PACKAGE_PATH,
        input=json.dumps(cases),
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(completed.stdout)


def _python_result(case):
    import baselode.extent

    extent = baselode.extent.Extent(
        xmin=case["bounds"]["xmin"],
        ymin=case["bounds"]["ymin"],
        xmax=case["bounds"]["xmax"],
        ymax=case["bounds"]["ymax"],
        crs=case["crs"],
        name=case.get("name"),
    ).to_crs(case["targetCrs"])
    bounds = {
        "xmin": extent.xmin,
        "ymin": extent.ymin,
        "xmax": extent.xmax,
        "ymax": extent.ymax,
    }
    ring = [
        [extent.xmin, extent.ymin],
        [extent.xmax, extent.ymin],
        [extent.xmax, extent.ymax],
        [extent.xmin, extent.ymax],
        [extent.xmin, extent.ymin],
    ]
    polygon = {"type": "Polygon", "coordinates": [ring]}
    feature = {
        "type": "Feature",
        "properties": case.get("properties", {}),
        "geometry": polygon,
    }
    return {
        "bounds": bounds,
        "crs": extent.crs,
        "name": extent.name,
        "center": list(extent.center()),
        "foliumRectangle": extent.get_folium_rectangle(),
        "polygon": polygon,
        "feature": feature,
        "featureCollection": {"type": "FeatureCollection", "features": [feature]},
    }


def test_javascript_extent_matches_python_extent_contract():
    cases = [
        {
            "bounds": {"xmin": 118.0, "ymin": -32.0, "xmax": 120.0, "ymax": -30.0},
            "crs": "EPSG:4326",
            "targetCrs": "EPSG:3857",
            "name": "western-australia",
            "properties": {"id": "wa"},
        },
        {
            "bounds": {"xmin": 120.0, "ymin": -32.0, "xmax": 120.5, "ymax": -31.5},
            "crs": "EPSG:4326",
            "targetCrs": "EPSG:28351",
            "name": None,
        },
        {
            "bounds": {"xmin": 0.0, "ymin": 0.0, "xmax": 1.0, "ymax": 1.0},
            "crs": "EPSG:4326",
            "targetCrs": "EPSG:4326",
            "name": "identity",
        },
    ]

    javascript_results = _javascript_results(cases)
    python_results = [_python_result(case) for case in cases]

    for javascript, python in zip(javascript_results, python_results):
        assert javascript["crs"] == python["crs"]
        assert javascript["name"] == python["name"]
        assert javascript["bounds"] == pytest.approx(python["bounds"], abs=0.05)
        assert javascript["center"] == pytest.approx(python["center"], abs=0.05)
        for javascript_pair, python_pair in zip(
            javascript["foliumRectangle"], python["foliumRectangle"]
        ):
            assert javascript_pair == pytest.approx(python_pair, abs=0.05)
        javascript_ring = javascript["polygon"]["coordinates"][0]
        python_ring = python["polygon"]["coordinates"][0]
        for javascript_pair, python_pair in zip(javascript_ring, python_ring):
            assert javascript_pair == pytest.approx(python_pair, abs=0.05)
        assert javascript["feature"]["type"] == python["feature"]["type"]
        assert javascript["feature"]["properties"] == python["feature"]["properties"]
        assert javascript["featureCollection"]["type"] == "FeatureCollection"
        assert javascript["featureCollection"]["features"] == [javascript["feature"]]
