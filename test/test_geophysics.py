# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

# This file is part of baselode.

# baselode is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

# baselode is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.

# You should have received a copy of the GNU General Public License
# along with baselode.  If not, see <https://www.gnu.org/licenses/>.

"""Tests for geophysics CSV and LAS loaders."""

import io
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from baselode.drill.data import load_geophysics
from baselode.datamodel import HOLE_ID, FROM, TO, MID, DEPTH

ROOT = Path(__file__).resolve().parents[1]
GSWA_DIR = ROOT / "test" / "data" / "gswa"
GEOPHYSICS_CSV = GSWA_DIR / "gswa_sample_geophysics.csv"
GEOPHYSICS_LAS = GSWA_DIR / "gswa_sample_geophysics.las"


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

MINIMAL_CSV = """\
HoleId,FromDepth,ToDepth,GAMMA,DENSITY
HOLE01,0.0,0.1,-999.25,-999.25
HOLE01,0.1,0.2,55.0,-999.25
HOLE01,0.2,0.3,62.0,2.3
HOLE02,0.0,0.1,44.0,1.9
HOLE02,0.1,0.2,-999.25,2.1
"""


# ---------------------------------------------------------------------------
# load_geophysics — CSV
# ---------------------------------------------------------------------------

class TestLoadGeophysicsCSV:
    def test_basic_columns_present(self):
        df = load_geophysics(io.StringIO(MINIMAL_CSV))
        for col in [HOLE_ID, FROM, TO, MID]:
            assert col in df.columns, f"missing column: {col}"

    def test_mid_computed_correctly(self):
        df = load_geophysics(io.StringIO(MINIMAL_CSV))
        assert np.allclose(df[MID], 0.5 * (df[FROM] + df[TO]))

    def test_null_sentinel_replaced_with_nan(self):
        df = load_geophysics(io.StringIO(MINIMAL_CSV))
        # -999.25 should never appear in any numeric column
        for col in df.select_dtypes(include="number").columns:
            assert (df[col] == -999.25).sum() == 0, f"sentinel found in {col}"

    def test_nan_not_dropped_keeps_row(self):
        df = load_geophysics(io.StringIO(MINIMAL_CSV))
        # All rows should be present (invalid rows dropped, but none are invalid here)
        assert len(df) == 5

    def test_sorted_by_hole_then_from(self):
        df = load_geophysics(io.StringIO(MINIMAL_CSV))
        for hole_id, grp in df.groupby(HOLE_ID, sort=False):
            assert grp[FROM].is_monotonic_increasing, f"not sorted for {hole_id}"

    def test_multiple_holes(self):
        df = load_geophysics(io.StringIO(MINIMAL_CSV))
        assert set(df[HOLE_ID].unique()) == {"HOLE01", "HOLE02"}

    def test_custom_null_sentinel(self):
        csv = "HoleId,FromDepth,ToDepth,GAMMA\nH1,0.0,0.1,9999.0\nH1,0.1,0.2,50.0\n"
        df = load_geophysics(io.StringIO(csv), null_sentinel=9999.0)
        assert np.isnan(df.loc[df[FROM] == 0.0, "gamma"].iloc[0])

    def test_invalid_rows_dropped_not_raised(self):
        csv = (
            "HoleId,FromDepth,ToDepth,GAMMA\n"
            "H1,0.0,0.1,55.0\n"
            ",0.1,0.2,60.0\n"        # missing hole_id
            "H1,0.3,0.2,65.0\n"      # to < from
        )
        df = load_geophysics(io.StringIO(csv))
        assert len(df) == 1
        assert df.iloc[0][HOLE_ID] == "H1"

    def test_missing_hole_id_raises(self):
        csv = "FromDepth,ToDepth,GAMMA\n0.0,0.1,55.0\n"
        with pytest.raises(ValueError, match="hole_id"):
            load_geophysics(io.StringIO(csv))

    def test_missing_from_raises(self):
        csv = "HoleId,ToDepth,GAMMA\nH1,0.1,55.0\n"
        with pytest.raises(ValueError, match="from"):
            load_geophysics(io.StringIO(csv))

    def test_keep_all_false_drops_value_columns(self):
        df = load_geophysics(io.StringIO(MINIMAL_CSV), keep_all=False)
        assert set(df.columns) == {HOLE_ID, FROM, TO, MID}

    def test_gswa_file_loads(self):
        pytest.importorskip("pandas")  # always available; guards file existence
        if not GEOPHYSICS_CSV.exists():
            pytest.skip("GSWA geophysics CSV not present")
        df = load_geophysics(GEOPHYSICS_CSV)
        assert not df.empty
        assert HOLE_ID in df.columns
        assert (df[FROM] <= df[TO]).all()


# ---------------------------------------------------------------------------
# load_geophysics_las
# ---------------------------------------------------------------------------

class TestLoadGeophysicsLAS:
    @pytest.fixture(autouse=True)
    def require_lasio(self):
        pytest.importorskip("lasio")

    def test_basic_columns_present(self):
        from baselode.drill.las import load_geophysics_las
        if not GEOPHYSICS_LAS.exists():
            pytest.skip("GSWA geophysics LAS not present")
        df = load_geophysics_las(GEOPHYSICS_LAS)
        for col in [HOLE_ID, DEPTH]:
            assert col in df.columns

    def test_hole_id_from_well_mnemonic(self):
        from baselode.drill.las import load_geophysics_las
        if not GEOPHYSICS_LAS.exists():
            pytest.skip("GSWA geophysics LAS not present")
        df = load_geophysics_las(GEOPHYSICS_LAS)
        assert df[HOLE_ID].iloc[0] == "MKC435"

    def test_null_sentinel_replaced(self):
        from baselode.drill.las import load_geophysics_las
        if not GEOPHYSICS_LAS.exists():
            pytest.skip("GSWA geophysics LAS not present")
        df = load_geophysics_las(GEOPHYSICS_LAS)
        for col in df.select_dtypes(include="number").columns:
            assert (df[col] == -999.25).sum() == 0, f"sentinel found in {col}"

    def test_sorted_by_depth(self):
        from baselode.drill.las import load_geophysics_las
        if not GEOPHYSICS_LAS.exists():
            pytest.skip("GSWA geophysics LAS not present")
        df = load_geophysics_las(GEOPHYSICS_LAS)
        assert df[DEPTH].is_monotonic_increasing

    def test_ten_rows(self):
        from baselode.drill.las import load_geophysics_las
        if not GEOPHYSICS_LAS.exists():
            pytest.skip("GSWA geophysics LAS not present")
        df = load_geophysics_las(GEOPHYSICS_LAS)
        assert len(df) == 10

    def test_hole_id_override(self):
        from baselode.drill.las import load_geophysics_las
        if not GEOPHYSICS_LAS.exists():
            pytest.skip("GSWA geophysics LAS not present")
        df = load_geophysics_las(GEOPHYSICS_LAS, hole_id="CUSTOM")
        assert (df[HOLE_ID] == "CUSTOM").all()

    def test_gamma_value_at_last_row(self):
        from baselode.drill.las import load_geophysics_las
        if not GEOPHYSICS_LAS.exists():
            pytest.skip("GSWA geophysics LAS not present")
        df = load_geophysics_las(GEOPHYSICS_LAS)
        # Only the last row (depth 0.95) has a real GAMMA value (81.1)
        last = df.sort_values(DEPTH).iloc[-1]
        assert abs(last["gamma"] - 81.1) < 0.01

    def test_missing_lasio_raises_import_error(self, monkeypatch):
        import sys
        monkeypatch.setitem(sys.modules, "lasio", None)
        from baselode.drill import las as las_module
        import importlib
        importlib.reload(las_module)
        with pytest.raises(ImportError, match="lasio"):
            las_module.load_geophysics_las("dummy.las")
