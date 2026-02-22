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

"""Tests for the structural/geotechnical module."""

import math
import pathlib

import pandas as pd
import pytest

from baselode.drill import structural, validate
from baselode.drill.data import load_structures
from baselode.drill.view import plot_tadpole_log, plot_strip_log
from baselode.drill.view_3d import structures_as_discs

DATA_DIR = pathlib.Path(__file__).parent / "data"
POINTS_CSV = DATA_DIR / "structural_points_sample.csv"
INTERVALS_CSV = DATA_DIR / "structural_intervals_sample.csv"


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def test_load_structural_points():
    df = load_structures(POINTS_CSV)
    assert not df.empty
    assert "hole_id" in df.columns
    assert "depth" in df.columns
    assert "dip" in df.columns
    assert "azimuth" in df.columns
    assert "structure_type" in df.columns
    assert len(df) == 6


def test_load_structural_intervals():
    df = load_structures(INTERVALS_CSV)
    assert not df.empty
    assert "hole_id" in df.columns
    assert "from" in df.columns
    assert "to" in df.columns
    assert "mid" in df.columns
    assert len(df) == 4
    # mid should be halfway between from and to
    assert df["mid"].iloc[0] == pytest.approx(22.5)


def test_load_structures_raises_without_depth_or_from_to():
    bad = pd.DataFrame({"hole_id": ["A"], "dip": [45], "azimuth": [90]})
    with pytest.raises(ValueError, match="requires either"):
        load_structures(bad)


def test_load_structures_raises_without_hole_id():
    bad = pd.DataFrame({"depth": [10.0], "dip": [45], "azimuth": [90]})
    with pytest.raises(ValueError, match="missing column"):
        load_structures(bad)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def test_validate_dip_bounds():
    df = pd.DataFrame({
        "hole_id": ["A", "A", "A"],
        "depth": [10.0, 20.0, 30.0],
        "dip": [45.0, 91.0, 0.0],
        "azimuth": [90.0, 90.0, 90.0],
    })
    issues = validate.validate_structural_points(df)
    types = [i["type"] for i in issues]
    assert "dip_out_of_range" in types
    assert sum(1 for t in types if t == "dip_out_of_range") == 1


def test_validate_azimuth_bounds():
    df = pd.DataFrame({
        "hole_id": ["A", "A", "A"],
        "depth": [10.0, 20.0, 30.0],
        "dip": [45.0, 45.0, 45.0],
        "azimuth": [0.0, 361.0, 359.9],
    })
    issues = validate.validate_structural_points(df)
    types = [i["type"] for i in issues]
    assert "azimuth_out_of_range" in types
    # 0° and 359.9° are valid, 361° is not
    assert sum(1 for t in types if t == "azimuth_out_of_range") == 1


def test_validate_structural_intervals():
    df = load_structures(INTERVALS_CSV)
    issues = validate.validate_structural_intervals(df)
    assert issues == []


def test_validate_missing_depth():
    df = pd.DataFrame({
        "hole_id": ["A"],
        "depth": [float("nan")],
        "dip": [45.0],
        "azimuth": [90.0],
    })
    issues = validate.validate_structural_points(df)
    assert any(i["type"] == "missing_depth" for i in issues)


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

def test_compute_plane_normal_horizontal():
    """Horizontal plane (dip=0) → normal points straight up."""
    nx, ny, nz = structural.compute_plane_normal(0, 0)
    assert nx == pytest.approx(0.0, abs=1e-9)
    assert ny == pytest.approx(0.0, abs=1e-9)
    assert nz == pytest.approx(1.0, abs=1e-9)


def test_compute_plane_normal_vertical():
    """Vertical plane (dip=90) → normal has no vertical component."""
    nx, ny, nz = structural.compute_plane_normal(90, 0)
    assert nz == pytest.approx(0.0, abs=1e-9)
    # Normal must be a unit vector (magnitude = 1)
    mag = math.sqrt(nx**2 + ny**2 + nz**2)
    assert mag == pytest.approx(1.0, abs=1e-9)


def test_compute_plane_normal_smoke():
    """compute_plane_normal(45, 270) ≈ (-0.707, 0, 0.707)."""
    nx, ny, nz = structural.compute_plane_normal(45, 270)
    assert nx == pytest.approx(-math.sqrt(2) / 2, abs=1e-6)
    assert ny == pytest.approx(0.0, abs=1e-6)
    assert nz == pytest.approx(math.sqrt(2) / 2, abs=1e-6)


def test_compute_strike():
    az = pd.Series([90, 180, 270, 0])
    strike = structural.compute_strike(az)
    assert list(strike) == [0, 90, 180, 270]


def test_poles_from_dip_dipdir():
    pt, pp = structural.poles_from_dip_dipdir(45, 180)
    assert pt == 90   # strike = (180 - 90) % 360 = 90
    assert pp == 45   # 90 - 45


def test_normalize_dip_azimuth():
    df = pd.DataFrame({
        "dip": [-5.0, 45.0, 95.0],
        "azimuth": [370.0, 180.0, -10.0],
    })
    out = structural.normalize_dip_azimuth(df)
    # Dip clipped to [0, 90]
    assert out["dip"].tolist() == [0.0, 45.0, 90.0]
    # Azimuth modulo 360
    assert out["azimuth"].tolist() == [10.0, 180.0, 350.0]


# ---------------------------------------------------------------------------
# Position attachment
# ---------------------------------------------------------------------------

def _make_traces():
    """Minimal trace DataFrame for position attachment."""
    return pd.DataFrame({
        "hole_id": ["DH001", "DH001", "DH001", "DH002", "DH002"],
        "md": [0.0, 25.0, 50.0, 0.0, 35.0],
        "easting": [500000.0, 500000.5, 500001.0, 501000.0, 501001.0],
        "northing": [6900000.0, 6900010.0, 6900020.0, 6901000.0, 6901010.0],
        "elevation": [300.0, 285.0, 270.0, 310.0, 295.0],
    })


def test_attach_structure_positions():
    structs = load_structures(POINTS_CSV)
    traces = _make_traces()
    result = structural.attach_structure_positions(structs, traces)
    assert "easting" in result.columns
    assert "northing" in result.columns
    assert "elevation" in result.columns
    row = result[(result["hole_id"] == "DH001") & (result["depth"] == 25.0)]
    assert not row.empty
    assert row["easting"].iloc[0] == pytest.approx(500000.5, abs=0.1)


def test_attach_structure_positions_empty_traces():
    structs = load_structures(POINTS_CSV)
    result = structural.attach_structure_positions(structs, pd.DataFrame())
    assert len(result) == len(structs)


# ---------------------------------------------------------------------------
# Visualization
# ---------------------------------------------------------------------------

def test_plot_tadpole_log():
    df = load_structures(POINTS_CSV)
    fig = plot_tadpole_log(df, md_col="depth", dip_col="dip", az_col="azimuth")
    assert fig is not None
    assert len(fig.data) > 0


def test_plot_tadpole_log_color_by():
    df = load_structures(POINTS_CSV)
    fig = plot_tadpole_log(df, md_col="depth", dip_col="dip", az_col="azimuth",
                           color_by="structure_type")
    assert fig is not None
    assert len(fig.data) >= 1


def test_plot_tadpole_log_empty():
    fig = plot_tadpole_log(pd.DataFrame())
    assert fig is not None


def test_plot_structural_strip():
    df = load_structures(INTERVALS_CSV)
    fig = plot_strip_log(df, from_col="from", to_col="to", label_col="structure_type")
    assert fig is not None
    assert len(fig.data) > 0


# ---------------------------------------------------------------------------
# 3D disc payload
# ---------------------------------------------------------------------------

def test_structures_as_discs_payload():
    structs = load_structures(POINTS_CSV)
    traces = _make_traces()
    structs_with_pos = structural.attach_structure_positions(structs, traces)
    discs = structures_as_discs(structs_with_pos, radius=3.0)
    assert len(discs) > 0
    disc = discs[0]
    assert "center" in disc
    assert "normal" in disc
    assert "radius" in disc
    assert disc["radius"] == 3.0
    assert len(disc["normal"]) == 3
    assert "azimuth" in disc


def test_structures_as_discs_empty():
    discs = structures_as_discs(pd.DataFrame())
    assert discs == []


# ---------------------------------------------------------------------------
# Column normalization
# ---------------------------------------------------------------------------

def test_column_normalization_alpha_to_dip():
    """'Alpha' column → 'dip' in standardized output."""
    df_raw = pd.DataFrame({
        "HoleId": ["A"],
        "Depth": [10.0],
        "Alpha": [45.0],
        "DipDir": [270.0],
    })
    df = load_structures(df_raw)
    assert "dip" in df.columns, f"columns: {list(df.columns)}"
    assert df["dip"].iloc[0] == pytest.approx(45.0)


def test_column_normalization_dipdir_to_azimuth():
    """'DipDir' column → 'azimuth' in standardized output."""
    df_raw = pd.DataFrame({
        "HoleId": ["A"],
        "Depth": [10.0],
        "Alpha": [45.0],
        "DipDir": [270.0],
    })
    df = load_structures(df_raw)
    assert "azimuth" in df.columns, f"columns: {list(df.columns)}"
    assert df["azimuth"].iloc[0] == pytest.approx(270.0)


def test_column_normalization_structure_type_variants():
    """'defect' column → 'structure_type' in standardized output."""
    df_raw = pd.DataFrame({
        "hole_id": ["A"],
        "depth": [10.0],
        "dip": [45.0],
        "azimuth": [90.0],
        "defect": ["joint"],
    })
    df = load_structures(df_raw)
    assert "structure_type" in df.columns, f"columns: {list(df.columns)}"
    assert df["structure_type"].iloc[0] == "joint"
