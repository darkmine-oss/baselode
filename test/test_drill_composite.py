# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd

"""Tests for compositing primitives.

Covers:
- Soft-boundary mass-balance: `value * overlap` conserved across composites.
- Hard-boundary mode: composites never straddle a coded contact.
- Hard-boundary residual rules: discard / add_to_previous / distribute.
- True-thickness compositing against an analytic planar lode case.
"""

import math

import numpy as np
import pandas as pd
import pytest

from baselode.datamodel import AZIMUTH, DIP, EASTING, ELEVATION, HOLE_ID, NORTHING
from baselode.drill.composite import (
    composite_intervals,
    composite_true_thickness,
    _plane_normal,
    _tangents_from_azimuth_dip,
)


def _make_intervals(hole_id, edges, value_seq, boundary_seq=None):
    rows = []
    for i in range(len(edges) - 1):
        row = {
            "hole_id": hole_id,
            "from": edges[i],
            "to": edges[i + 1],
            "value": value_seq[i],
        }
        if boundary_seq is not None:
            row["domain"] = boundary_seq[i]
        rows.append(row)
    return pd.DataFrame(rows)


class TestSoftMode:
    def test_default_is_soft_backward_compat(self):
        df = _make_intervals("A", [0, 1, 2, 3, 4], [10.0, 20.0, 30.0, 40.0])
        a = composite_intervals(df, "value", length=2.0)
        b = composite_intervals(df, "value", length=2.0, mode="soft")
        pd.testing.assert_frame_equal(a, b)

    def test_mass_balance_average(self):
        # 5x1m intervals; composite to 2m. Length-weighted average is
        # well-defined per bin and the per-bin sum(value*overlap)
        # equals the source contribution.
        df = _make_intervals("A", np.arange(0, 6), [1.0, 2.0, 3.0, 4.0, 5.0])
        out = composite_intervals(df, "value", length=2.0, method="average")
        # Per 2m composite: average of two consecutive source values.
        assert pytest.approx(out.loc[0, "value"]) == 1.5
        assert pytest.approx(out.loc[1, "value"]) == 3.5
        # Third bin spans md=[4,6] but only md=[4,5] has data → value 5.0.
        assert pytest.approx(out.loc[2, "value"]) == 5.0

    def test_mass_balance_sum_full_hole(self):
        df = _make_intervals("A", np.arange(0, 6), [1.0, 2.0, 3.0, 4.0, 5.0])
        out = composite_intervals(df, "value", length=2.0, method="sum")
        # Source total value*length = 1+2+3+4+5 = 15
        assert pytest.approx(out["value"].sum()) == 15.0

    def test_empty_passthrough(self):
        df = pd.DataFrame(columns=["hole_id", "from", "to", "value"])
        out = composite_intervals(df, "value")
        assert out.empty

    def test_rejects_non_positive_length(self):
        df = _make_intervals("A", [0, 1, 2], [1.0, 2.0])
        with pytest.raises(ValueError, match="length"):
            composite_intervals(df, "value", length=0)
        with pytest.raises(ValueError, match="length"):
            composite_intervals(df, "value", length=-1.5)

    def test_rejects_unknown_method(self):
        df = _make_intervals("A", [0, 1, 2], [1.0, 2.0])
        with pytest.raises(ValueError, match="method"):
            composite_intervals(df, "value", method="median")


class TestHardMode:
    def test_requires_boundary_col(self):
        df = _make_intervals("A", [0, 1, 2], [1.0, 2.0])
        with pytest.raises(ValueError, match="boundary_col"):
            composite_intervals(df, "value", mode="hard")

    def test_rejects_unknown_residual(self):
        df = _make_intervals("A", [0, 1, 2], [1.0, 2.0], boundary_seq=["G", "G"])
        with pytest.raises(ValueError, match="residual"):
            composite_intervals(
                df, "value", mode="hard", boundary_col="domain", residual="bogus"
            )

    def test_never_straddles_boundary(self):
        # Two domains end-to-end: G from 0–3, S from 3–6.
        df = _make_intervals(
            "A",
            [0, 1, 2, 3, 4, 5, 6],
            [1.0, 1.0, 1.0, 9.0, 9.0, 9.0],
            boundary_seq=["G", "G", "G", "S", "S", "S"],
        )
        out = composite_intervals(
            df, "value", length=2.0, mode="hard", boundary_col="domain"
        )
        # No composite spans the 3.0 contact.
        for _, row in out.iterrows():
            assert not (row["from"] < 3.0 and row["to"] > 3.0), (
                f"composite {row['from']}-{row['to']} crossed the boundary"
            )
        # Each composite carries the originating domain.
        assert set(out["domain"]) == {"G", "S"}

    def test_residual_discard_drops_short_tail(self):
        # Domain 0–3 with length=2 leaves a 1m tail.
        df = _make_intervals(
            "A",
            [0, 1, 2, 3],
            [1.0, 1.0, 5.0],
            boundary_seq=["G", "G", "G"],
        )
        out = composite_intervals(
            df, "value", length=2.0, mode="hard", boundary_col="domain", residual="discard"
        )
        assert len(out) == 1
        assert pytest.approx(out.loc[0, "to"]) == 2.0

    def test_residual_add_to_previous_extends_last_bin(self):
        df = _make_intervals(
            "A",
            [0, 1, 2, 3],
            [1.0, 1.0, 5.0],
            boundary_seq=["G", "G", "G"],
        )
        out = composite_intervals(
            df,
            "value",
            length=2.0,
            mode="hard",
            boundary_col="domain",
            residual="add_to_previous",
        )
        assert len(out) == 1
        assert pytest.approx(out.loc[0, "to"]) == 3.0
        # Length-weighted: (1*1 + 1*1 + 5*1)/3 = 7/3
        assert pytest.approx(out.loc[0, "value"]) == 7.0 / 3.0

    def test_residual_distribute_stretches_bin_length(self):
        # Domain 0–3 with length=2: distribute → round(3/2)=2 bins of 1.5m each.
        df = _make_intervals(
            "A",
            [0, 1, 2, 3],
            [2.0, 4.0, 6.0],
            boundary_seq=["G", "G", "G"],
        )
        out = composite_intervals(
            df,
            "value",
            length=2.0,
            mode="hard",
            boundary_col="domain",
            residual="distribute",
        )
        assert len(out) == 2
        assert pytest.approx(out.loc[0, "from"]) == 0.0
        assert pytest.approx(out.loc[0, "to"]) == 1.5
        assert pytest.approx(out.loc[1, "from"]) == 1.5
        assert pytest.approx(out.loc[1, "to"]) == 3.0

    def test_residual_add_to_previous_handles_subbin_domain(self):
        # Domain shorter than length: no prior bin to extend → emit one
        # bin covering the whole domain so the data isn't dropped.
        df = _make_intervals("A", [0, 0.5], [3.0], boundary_seq=["G"])
        out = composite_intervals(
            df,
            "value",
            length=2.0,
            mode="hard",
            boundary_col="domain",
            residual="add_to_previous",
        )
        assert len(out) == 1
        assert pytest.approx(out.loc[0, "from"]) == 0.0
        assert pytest.approx(out.loc[0, "to"]) == 0.5

    def test_non_abutting_intervals_break_runs(self):
        # Two same-domain runs separated by an unsampled gap.
        df = pd.DataFrame(
            [
                {"hole_id": "A", "from": 0.0, "to": 1.0, "value": 1.0, "domain": "G"},
                {"hole_id": "A", "from": 1.0, "to": 2.0, "value": 1.0, "domain": "G"},
                # gap from 2 to 5
                {"hole_id": "A", "from": 5.0, "to": 6.0, "value": 9.0, "domain": "G"},
                {"hole_id": "A", "from": 6.0, "to": 7.0, "value": 9.0, "domain": "G"},
            ]
        )
        out = composite_intervals(
            df, "value", length=2.0, mode="hard", boundary_col="domain"
        )
        # Expect one composite per contiguous run.
        froms = sorted(out["from"].tolist())
        assert froms == [0.0, 5.0]


class TestTrueThickness:
    @staticmethod
    def _vertical_trace(hole_id="A", max_md=50.0, step=1.0):
        """A single vertical hole at the origin, dip=90 azimuth=0."""
        mds = np.arange(0, max_md + step, step)
        return pd.DataFrame({
            HOLE_ID: hole_id,
            "md": mds,
            EASTING: np.zeros_like(mds),
            NORTHING: np.zeros_like(mds),
            ELEVATION: -mds,  # going down → elevation drops
            AZIMUTH: np.zeros_like(mds),
            DIP: np.full_like(mds, 90.0),
        })

    @staticmethod
    def _inclined_trace(hole_id="A", dip_deg=60.0, max_md=50.0, step=1.0):
        """A straight-line inclined hole: azimuth=0 (north), constant dip."""
        mds = np.arange(0, max_md + step, step)
        dip_rad = math.radians(dip_deg)
        north = mds * math.cos(dip_rad)
        elev = -mds * math.sin(dip_rad)
        return pd.DataFrame({
            HOLE_ID: hole_id,
            "md": mds,
            EASTING: np.zeros_like(mds),
            NORTHING: north,
            ELEVATION: elev,
            AZIMUTH: np.zeros_like(mds),
            DIP: np.full_like(mds, dip_deg),
        })

    def test_vertical_hole_horizontal_plane_full_thickness(self):
        # Vertical hole through a horizontal reference plane:
        # true thickness == downhole length.
        traces = self._vertical_trace(max_md=10.0)
        intervals = _make_intervals("A", np.arange(0, 11), [i + 1.0 for i in range(10)])
        out = composite_true_thickness(
            intervals, traces, value_col="value",
            ref_dip=0.0, ref_dip_azimuth=0.0, length=1.0,
        )
        # Each 1m source maps to one 1m composite, with length_true = 1 m.
        assert len(out) == 10
        assert np.allclose(out["length_true"], 1.0)
        # Value of each composite should equal the source value at that depth.
        assert np.allclose(out["value"], np.arange(1, 11), atol=1e-9)

    def test_hole_along_plane_emits_nothing(self):
        # Horizontal hole (dip=0, north) through a horizontal reference
        # plane.  Tangent T = (0, 1, 0); plane normal N = (0, 0, 1).
        # T ⊥ N → true thickness contribution is zero everywhere.
        traces = self._inclined_trace(dip_deg=0.0, max_md=10.0)
        intervals = _make_intervals("A", np.arange(0, 11), [1.0] * 10)
        out = composite_true_thickness(
            intervals, traces, value_col="value",
            ref_dip=0.0, ref_dip_azimuth=0.0,
            length=1.0,
        )
        # No measurable thickness traversed → either empty or all-zero.
        if not out.empty:
            assert (out["length_true"] < 1e-6).all()

    def test_rejects_non_positive_length_and_bad_method(self):
        traces = self._vertical_trace(max_md=5.0)
        intervals = _make_intervals("A", np.arange(0, 6), [1.0] * 5)
        with pytest.raises(ValueError, match="length"):
            composite_true_thickness(
                intervals, traces, value_col="value",
                ref_dip=0.0, ref_dip_azimuth=0.0, length=0,
            )
        with pytest.raises(ValueError, match="method"):
            composite_true_thickness(
                intervals, traces, value_col="value",
                ref_dip=0.0, ref_dip_azimuth=0.0, method="median",
            )

    def test_honours_custom_hole_col(self):
        # Caller uses `well_id` instead of the default `hole_id`.
        traces = self._vertical_trace(max_md=5.0).rename(columns={HOLE_ID: "well_id"})
        intervals = _make_intervals("A", np.arange(0, 6), [1.0] * 5).rename(columns={"hole_id": "well_id"})
        out = composite_true_thickness(
            intervals, traces, value_col="value",
            ref_dip=0.0, ref_dip_azimuth=0.0, length=1.0,
            hole_col="well_id",
        )
        assert "well_id" in out.columns
        assert "hole_id" not in out.columns
        assert set(out["well_id"]) == {"A"}

    def test_inclined_hole_planar_lode_matches_analytic_cos(self):
        # Inclined hole (60° dip due north) cutting through a
        # horizontal plane.  Hole tangent T = (0, cos60, -sin60).
        # Plane normal N = (0, 0, 1).  T · N = -sin60 = -0.866.
        # |T · N| = 0.866 → true thickness = 0.866 × downhole length.
        traces = self._inclined_trace(dip_deg=60.0, max_md=10.0)
        intervals = _make_intervals("A", np.arange(0, 11), [1.0] * 10)
        out = composite_true_thickness(
            intervals, traces, value_col="value",
            ref_dip=0.0, ref_dip_azimuth=0.0,
            length=0.866025403784,  # one full source interval ≈ one bin
        )
        # Expect ~10 composites.  Each composite's length_md should
        # be ≈ 1.0 (one source interval per composite), and the
        # cumulative length_md across all composites should equal 10 m.
        assert pytest.approx(out["length_md"].sum(), rel=1e-3) == 10.0
        # Cumulative length_true ≈ 10 × 0.866 = 8.66 m.
        assert pytest.approx(out["length_true"].sum(), rel=1e-3) == 10 * math.sin(math.radians(60))


class TestGeometryHelpers:
    def test_plane_normal_horizontal_is_up(self):
        n = _plane_normal(0.0, 0.0)
        assert np.allclose(n, [0.0, 0.0, 1.0])

    def test_plane_normal_vertical_is_horizontal(self):
        # Vertical plane (dip=90°) with strike east–west (downdip
        # azimuth = 180° = due south): normal should point due south.
        n = _plane_normal(90.0, 180.0)
        assert np.allclose(n, [0.0, -1.0, 0.0], atol=1e-9)

    def test_tangent_vertical_hole_points_down(self):
        t = _tangents_from_azimuth_dip(np.array([0.0]), np.array([90.0]))
        assert np.allclose(t[0], [0.0, 0.0, -1.0], atol=1e-9)

    def test_tangent_horizontal_north(self):
        t = _tangents_from_azimuth_dip(np.array([0.0]), np.array([0.0]))
        assert np.allclose(t[0], [0.0, 1.0, 0.0], atol=1e-9)

    def test_tangent_nan_becomes_zero(self):
        t = _tangents_from_azimuth_dip(np.array([float("nan")]), np.array([45.0]))
        assert np.allclose(t[0], [0.0, 0.0, 0.0])
