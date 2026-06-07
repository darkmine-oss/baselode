# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

"""Generate golden-fixture desurvey outputs using wellpathpy as the reference.

Run locally when you want to refresh the committed
``test/data/desurvey_reference.json``:

.. code-block:: bash

    source .venv/bin/activate
    pip install wellpathpy
    python scripts/dev/regenerate_desurvey_fixtures.py

This script is NOT exercised by CI — the resulting JSON file is committed
and consumed by ``test/test_desurvey_reference.py``.  Regenerate only when
the reference implementation changes, a trajectory is added, or the
tolerance numbers shift.

Reference: wellpathpy (https://github.com/Zabamund/wellpathpy), MIT-licensed,
used by ``welly``.  We use it as an external check on the math; we do not
depend on it at runtime.

Convention notes
----------------
- baselode uses ``dip`` where negative values point downward.  wellpathpy
  uses ``inc`` (inclination from vertical) where 0 = straight down,
  90 = horizontal.  Conversion: ``inc = 90 + dip``.
- wellpathpy returns ``depth`` (true vertical depth, positive going down).
  baselode'\''s ``elevation`` column currently *increases* with downhole
  travel, so we compare via the explicit ``tvd = elevation - collar.elevation``
  quantity.  When the baselode sign convention is fixed (separate ticket),
  the conversion in ``test/test_desurvey_reference.py`` flips sign.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import wellpathpy as wp

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = REPO_ROOT / "test" / "data" / "desurvey_reference.json"

# Per-method numerical tolerance.  ``minimum_curvature`` and ``tangential``
# match wellpathpy exactly to machine precision once the inc/dip convention
# is reconciled.  ``balanced_tangential`` differs by O(cm) on gentle
# doglegs and O(m) on extreme doglegs because wellpathpy implements the
# canonical Walstrom form (average direction cosines) while baselode
# currently uses a variant (cosines of average angles).  Strict tolerance
# is kept; the ``known_xfails`` list below documents trajectories where
# the BT variant diverges by more than tolerance.
TOLERANCE_POSITION_M = 0.01
TOLERANCE_ANGLE_DEG = 0.01

# Known expected-fail (trajectory, method) pairs — BT variant divergence.
# Documented in :pull-request:`TRK-117` and tracked separately for fixing.
KNOWN_XFAILS = [
    ("constant_build_30deg", "balanced_tangential"),
    ("strong_dogleg", "balanced_tangential"),
]


def trajectory_vertical():
    return {
        "name": "vertical_100m",
        "description": "Vertical hole, 100 m down, 3 survey stations at 0/50/100 m.",
        "collar": {"hole_id": "V1", "easting": 0.0, "northing": 0.0, "elevation": 0.0},
        "surveys": [
            {"hole_id": "V1", "depth": 0.0, "azimuth": 0.0, "dip": -90.0},
            {"hole_id": "V1", "depth": 50.0, "azimuth": 0.0, "dip": -90.0},
            {"hole_id": "V1", "depth": 100.0, "azimuth": 0.0, "dip": -90.0},
        ],
    }


def trajectory_constant_build():
    return {
        "name": "constant_build_30deg",
        "description": (
            "Straight-vertical start, then a constant build at azimuth 045° "
            "ending at -60° dip (30° inclination from vertical) at 200 m MD."
        ),
        "collar": {"hole_id": "B1", "easting": 0.0, "northing": 0.0, "elevation": 0.0},
        "surveys": [
            {"hole_id": "B1", "depth": 0.0, "azimuth": 45.0, "dip": -90.0},
            {"hole_id": "B1", "depth": 100.0, "azimuth": 45.0, "dip": -75.0},
            {"hole_id": "B1", "depth": 200.0, "azimuth": 45.0, "dip": -60.0},
        ],
    }


def trajectory_strong_dogleg():
    return {
        "name": "strong_dogleg",
        "description": (
            "Hole that turns hard: starts NE-trending at -65° dip, then "
            "turns to NW-trending at -55° dip over a single 50 m segment "
            "(a 90° azimuth change and 10° dip change ⇒ big dogleg)."
        ),
        "collar": {"hole_id": "D1", "easting": 100.0, "northing": 200.0, "elevation": 300.0},
        "surveys": [
            {"hole_id": "D1", "depth": 0.0, "azimuth": 45.0, "dip": -65.0},
            {"hole_id": "D1", "depth": 50.0, "azimuth": 45.0, "dip": -65.0},
            {"hole_id": "D1", "depth": 100.0, "azimuth": 135.0, "dip": -55.0},
            {"hole_id": "D1", "depth": 150.0, "azimuth": 135.0, "dip": -55.0},
        ],
    }


def trajectory_long_low_dip():
    return {
        "name": "long_low_dip",
        "description": (
            "300 m hole at shallow -25° dip, single azimuth — the small-"
            "angle regime where naive tan/MC differ less but TVD accumulates."
        ),
        "collar": {"hole_id": "L1", "easting": 1000.0, "northing": 2000.0, "elevation": 100.0},
        "surveys": [
            {"hole_id": "L1", "depth": 0.0, "azimuth": 270.0, "dip": -25.0},
            {"hole_id": "L1", "depth": 150.0, "azimuth": 270.0, "dip": -25.0},
            {"hole_id": "L1", "depth": 300.0, "azimuth": 270.0, "dip": -25.0},
        ],
    }


TRAJECTORIES = [
    trajectory_vertical,
    trajectory_constant_build,
    trajectory_strong_dogleg,
    trajectory_long_low_dip,
]

# Map between baselode method names and the right wellpathpy call.
# wellpathpy's ``tan_method`` has a ``choice`` parameter:
#   - ``"low"``  → use the upper-station angles (matches our `tangential`)
#   - ``"bal"``  → balanced tangential (matches our `balanced_tangential`)
#   - ``"avg"``  → average angles (NOT what either of our methods does)
METHOD_MAP = {
    "minimum_curvature": ("minimum_curvature", {}),
    "tangential": ("tan_method", {"choice": "low"}),
    "balanced_tangential": ("tan_method", {"choice": "bal"}),
}


def _wellpathpy_expected(trajectory):
    """Run wellpathpy for the given trajectory; return per-method station outputs."""
    md = np.array([row["depth"] for row in trajectory["surveys"]])
    azi = np.array([row["azimuth"] for row in trajectory["surveys"]])
    dip = np.array([row["dip"] for row in trajectory["surveys"]])
    inc = 90.0 + dip  # baselode → wellpathpy

    dev = wp.deviation(md=md, inc=inc, azi=azi)
    out = {}
    for our_name, (wp_attr, kwargs) in METHOD_MAP.items():
        position = getattr(dev, wp_attr)(**kwargs)
        # wellpathpy's ``position.depth`` is TVD-below-collar (positive
        # going down).  We pair it with the original survey-station MD
        # so the test can match rows by md.
        out[our_name] = [
            {
                "md": float(station_md),
                "tvd": float(tvd_value),
                "northing_offset": float(n_value),
                "easting_offset": float(e_value),
            }
            for station_md, tvd_value, n_value, e_value in zip(
                md, position.depth, position.northing, position.easting,
            )
        ]
    return out


def main():
    trajectories = []
    for factory in TRAJECTORIES:
        trajectory = factory()
        trajectory["expected"] = _wellpathpy_expected(trajectory)
        trajectories.append(trajectory)

    document = {
        "version": "1.0",
        "reference": f"wellpathpy {wp.__version__}",
        "generated_iso": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "tolerance_position_m": TOLERANCE_POSITION_M,
        "tolerance_angle_deg": TOLERANCE_ANGLE_DEG,
        "known_xfails": [
            {"trajectory": traj, "method": method, "reason": (
                "baselode balanced_tangential uses 'cosines of average angles' "
                "instead of the canonical Walstrom 'average of direction cosines'. "
                "Tracked separately."
            )}
            for traj, method in KNOWN_XFAILS
        ],
        "convention_notes": (
            "wellpathpy uses inc=90+dip (0=down, 90=horizontal). "
            "baselode dip is negative downward. "
            "tvd is depth below collar, positive going down. "
            "northing_offset / easting_offset are relative to the collar. "
            "BT tolerance is intentionally looser: wellpathpy implements "
            "the canonical Walstrom form (average of direction cosines) "
            "while baselode currently uses 'cosines of average angles', "
            "a documented variant. MC and tangential are exact."
        ),
        "trajectories": trajectories,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(document, f, indent=2)
        f.write("\n")

    print(f"Wrote {OUTPUT_PATH} — {len(trajectories)} trajectories")


if __name__ == "__main__":
    main()
