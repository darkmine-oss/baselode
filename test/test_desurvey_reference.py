# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

"""Cross-validate baselode desurvey against the committed golden fixtures.

The fixture file at ``test/data/desurvey_reference.json`` is generated
offline from wellpathpy (see ``scripts/dev/regenerate_desurvey_fixtures.py``).
This test loads it and runs every baselode desurvey method that has an
``expected`` block against its reference output, asserting agreement
within the tolerance values that travel with the fixture.

No wellpathpy install is required in CI — the fixture file is the contract.
"""

import json
from math import gcd
from pathlib import Path

import pandas as pd
import pytest

import baselode.drill.desurvey as desurvey

REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = REPO_ROOT / "test" / "data" / "desurvey_reference.json"

BASELODE_METHOD_FNS = {
    "minimum_curvature": desurvey.minimum_curvature_desurvey,
    "tangential": desurvey.tangential_desurvey,
    "balanced_tangential": desurvey.balanced_tangential_desurvey,
}

# Tolerance used when matching trace rows by md — float-equality on a
# value accumulated by repeated addition inside the desurvey loop is
# flaky, so we match by nearest within this many metres.
MD_MATCH_TOLERANCE_M = 1e-6


def _load_fixture():
    with FIXTURE_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def _fixture_cases():
    """Collect parametrize cases and the matching ids list.

    Guarded against a missing fixture file so collection still succeeds
    and ``test_fixture_is_present_and_versioned`` can report the real
    failure mode.
    """
    if not FIXTURE_PATH.exists():
        return [], []
    fixture = _load_fixture()
    cases = []
    ids = []
    for trajectory in fixture.get("trajectories", []):
        for method_name in trajectory.get("expected", {}):
            cases.append((trajectory, method_name, fixture))
            ids.append(f"{trajectory['name']}::{method_name}")
    return cases, ids


_CASES, _IDS = _fixture_cases()


def _baselode_trace(trajectory, method_name, step):
    collar_row = trajectory["collar"]
    collar = pd.DataFrame([collar_row])
    survey = pd.DataFrame(trajectory["surveys"])
    method_fn = BASELODE_METHOD_FNS[method_name]
    return method_fn(collar, survey, step=step)


def test_fixture_is_present_and_versioned():
    assert FIXTURE_PATH.exists(), f"Fixture missing at {FIXTURE_PATH}"
    fixture = _load_fixture()
    assert fixture["version"] == "1.0"
    assert fixture["reference"].startswith("wellpathpy")
    assert fixture["trajectories"], "Fixture has no trajectories"


@pytest.mark.parametrize("trajectory,method_name,fixture", _CASES, ids=_IDS)
def test_baselode_matches_wellpathpy_within_tolerance(trajectory, method_name, fixture):
    if method_name not in BASELODE_METHOD_FNS:
        pytest.skip(f"No baselode implementation of '{method_name}' to cross-check")

    xfail_match = next(
        (entry for entry in fixture.get("known_xfails", [])
         if entry["trajectory"] == trajectory["name"] and entry["method"] == method_name),
        None,
    )

    expected_stations = trajectory["expected"][method_name]
    survey_mds = sorted({float(row["md"]) for row in expected_stations})

    # Pick a step that ensures the baselode trace lands a sample at every
    # survey-station MD (the fixture only carries reference values at
    # station MDs).  GCD on integer MDs works; otherwise step=1m suffices
    # for our trajectories.
    step = 1.0
    if all(int(md) == md for md in survey_mds):
        integers = sorted(set(int(md) for md in survey_mds if md > 0))
        if integers:
            step = float(integers[0])
            for value in integers[1:]:
                step = float(gcd(int(step), value))

    trace = _baselode_trace(trajectory, method_name, step=step)
    collar_easting = float(trajectory["collar"]["easting"])
    collar_northing = float(trajectory["collar"]["northing"])
    collar_elevation = float(trajectory["collar"]["elevation"])

    tolerance_position = float(fixture["tolerance_position_m"])

    if xfail_match is not None:
        pytest.xfail(xfail_match["reason"])

    for expected in expected_stations:
        expected_md = float(expected["md"])
        # Float-tolerance match — md is accumulated by repeated addition
        # in the desurvey loop, so exact equality drops the row.
        matching_rows = trace[(trace["md"] - expected_md).abs() <= MD_MATCH_TOLERANCE_M]
        assert not matching_rows.empty, (
            f"trajectory '{trajectory['name']}' / method '{method_name}': "
            f"no baselode sample at md={expected_md}"
        )
        row = matching_rows.iloc[0]
        actual_tvd = float(row["elevation"]) - collar_elevation
        actual_northing_offset = float(row["northing"]) - collar_northing
        actual_easting_offset = float(row["easting"]) - collar_easting

        assert abs(actual_tvd - expected["tvd"]) <= tolerance_position, (
            f"trajectory '{trajectory['name']}' / method '{method_name}' / "
            f"md={expected_md}: TVD baselode={actual_tvd:.6f} "
            f"vs wellpathpy={expected['tvd']:.6f}"
        )
        assert abs(actual_northing_offset - expected["northing_offset"]) <= tolerance_position, (
            f"trajectory '{trajectory['name']}' / method '{method_name}' / "
            f"md={expected_md}: northing baselode={actual_northing_offset:.6f} "
            f"vs wellpathpy={expected['northing_offset']:.6f}"
        )
        assert abs(actual_easting_offset - expected["easting_offset"]) <= tolerance_position, (
            f"trajectory '{trajectory['name']}' / method '{method_name}' / "
            f"md={expected_md}: easting baselode={actual_easting_offset:.6f} "
            f"vs wellpathpy={expected['easting_offset']:.6f}"
        )


def test_all_methods_agree_on_vertical_hole():
    """All 3 methods must produce identical traces for a vertical hole."""
    fixture = _load_fixture()
    vertical = next(t for t in fixture["trajectories"] if t["name"] == "vertical_100m")
    traces = {
        method_name: _baselode_trace(vertical, method_name, step=50.0)
        for method_name in BASELODE_METHOD_FNS
    }
    reference = traces["minimum_curvature"]
    for method_name, trace in traces.items():
        if method_name == "minimum_curvature":
            continue
        # merge_asof tolerates the float-accumulation in md without
        # silently dropping rows the way an exact-equality merge would.
        joined = pd.merge_asof(
            reference.sort_values("md"),
            trace.sort_values("md"),
            on="md",
            direction="nearest",
            tolerance=MD_MATCH_TOLERANCE_M,
            suffixes=("_mc", f"_{method_name}"),
        )
        assert joined.notna().all().all(), (
            f"merge_asof dropped rows when comparing minimum_curvature with "
            f"{method_name} — md alignment is off beyond {MD_MATCH_TOLERANCE_M} m"
        )
        for axis in ("easting", "northing", "elevation"):
            assert (joined[f"{axis}_mc"] - joined[f"{axis}_{method_name}"]).abs().max() < 1e-9, (
                f"On vertical hole, {method_name} disagrees with minimum_curvature on {axis}"
            )
