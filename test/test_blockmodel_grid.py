# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

"""Block models as a primitive (TRK-417): grid definition, sub-blocking,
validation, regularize / aggregate, lookup, tonnage, diff and I/O."""

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import baselode.blockmodel as blockmodel
import baselode.blockmodel.data as data
import baselode.blockmodel.validate as validate

DATA_DIR = Path(__file__).parent / "data" / "blockmodel"
FIXTURE_CSV = DATA_DIR / "demo_subblocked.csv"
FIXTURE_META = DATA_DIR / "demo_subblocked_meta.json"
REFERENCE = DATA_DIR / "blockmodel_reference.json"
LEGACY_CSV = DATA_DIR / "demo_blockmodel.csv"
LEGACY_META = DATA_DIR / "demo_blockmodel_meta.json"


def _definition(**overrides):
    spec = {
        "origin": (1000.0, 2000.0, 100.0),
        "block_size": (5.0, 5.0, 2.5),
        "n_blocks": (4, 4, 4),
        "parent_size": (2, 2, 2),
    }
    spec.update(overrides)
    return blockmodel.BlockModelDefinition(**spec)


@pytest.fixture(scope="module")
def fixture_model():
    return blockmodel.load_blocks(FIXTURE_CSV, metadata=FIXTURE_META)


@pytest.fixture(scope="module")
def reference():
    return json.loads(REFERENCE.read_text())


# ------------------------------------------------------------ definition

class TestDefinition:
    def test_accepts_sequences_and_dicts(self):
        a = _definition()
        b = blockmodel.BlockModelDefinition(
            origin={"x": 1000.0, "y": 2000.0, "z": 100.0},
            block_size={"dx": 5.0, "dy": 5.0, "dz": 2.5},
            n_blocks={"nx": 4, "ny": 4, "nz": 4},
            parent_size={"nx": 2, "ny": 2, "nz": 2},
        )
        assert a == b
        assert a.parent_block_size == (10.0, 10.0, 5.0)
        assert a.n_parent_blocks == (2, 2, 2)
        assert a.extent == (20.0, 20.0, 10.0)
        assert a.base_cell_count == 64
        assert a.is_subblocked and not a.is_rotated

    def test_rejects_bad_sizes(self):
        with pytest.raises(ValueError):
            _definition(block_size=(5.0, 0.0, 2.5))
        with pytest.raises(ValueError):
            _definition(n_blocks=(4, 4, 0))
        with pytest.raises(ValueError):
            _definition(parent_size=(2, 0, 2))

    def test_unrotated_transforms_are_offsets(self):
        d = _definition()
        assert d.index_to_world(0, 0, 0) == pytest.approx((1002.5, 2002.5, 101.25))
        assert d.index_to_world(1, 2, 3, 2, 1, 1) == pytest.approx((1010.0, 2012.5, 108.75))
        assert tuple(int(v) for v in d.world_to_index(1002.5, 2012.5, 108.75)) == (0, 2, 3)
        assert tuple(int(v) for v in d.world_to_index(1019.99, 2019.99, 109.99)) == (3, 3, 3)

    def test_azimuth_turns_grid_y_axis_to_bearing(self):
        d = _definition(rotation={"azimuth": 90.0})
        x, y, z = d.local_to_world(0.0, 10.0, 0.0)
        assert (x, y, z) == pytest.approx((1010.0, 2000.0, 100.0))
        x, y, z = d.local_to_world(10.0, 0.0, 0.0)
        assert (x, y, z) == pytest.approx((1000.0, 1990.0, 100.0))

    def test_dip_tilts_grid_y_axis_down_and_plunge_tilts_x(self):
        d = _definition(rotation={"dip": 30.0})
        _, y, z = d.local_to_world(0.0, 10.0, 0.0)
        assert (y, z) == pytest.approx((2000.0 + 10 * math.cos(math.radians(30)), 100.0 - 5.0))
        d = _definition(rotation={"plunge": 30.0})
        x, _, z = d.local_to_world(10.0, 0.0, 0.0)
        assert (x, z) == pytest.approx((1000.0 + 10 * math.cos(math.radians(30)), 100.0 - 5.0))

    def test_rotated_round_trip_is_exact(self):
        d = _definition(rotation={"azimuth": 37.0, "dip": 12.0, "plunge": -8.0})
        matrix = d.rotation_matrix()
        assert np.allclose(matrix @ matrix.T, np.eye(3), atol=1e-12)
        for index in [(0, 0, 0), (3, 2, 1), (1, 3, 3)]:
            x, y, z = d.index_to_world(*index)
            assert tuple(int(v) for v in d.world_to_index(x, y, z)) == index
        u, v, w = d.world_to_local(*d.local_to_world(7.25, 3.5, 1.75))
        assert (u, v, w) == pytest.approx((7.25, 3.5, 1.75), abs=1e-9)

    def test_bounds_and_outline_follow_the_rotation(self):
        d = _definition(rotation={"azimuth": 90.0})
        bounds = d.bounds()
        assert bounds == pytest.approx({
            "min_x": 1000.0, "max_x": 1020.0, "min_y": 1980.0, "max_y": 2000.0, "min_z": 100.0, "max_z": 110.0,
        })
        assert d.corners().shape == (8, 3)
        ring = d.outline_2d()["coordinates"][0]
        assert ring[0] == ring[-1] == [1000.0, 2000.0]

    def test_to_dict_round_trip_and_legacy_metadata(self):
        d = _definition(rotation={"azimuth": 15.0}, crs="EPSG:28350", name="m", extra={"k": 1})
        again = blockmodel.BlockModelDefinition.from_dict(d.to_dict())
        assert again == d and again.crs == "EPSG:28350" and again.extra == {"k": 1}
        legacy = json.loads(LEGACY_META.read_text())
        from_legacy = blockmodel.BlockModelDefinition.from_dict(legacy)
        assert from_legacy.origin == (500000.0, 6900000.0, 290.0)
        assert from_legacy.block_size == (10.0, 10.0, 10.0)
        assert from_legacy.n_blocks == (5, 4, 3)
        assert from_legacy.parent_size == (1, 1, 1)
        with pytest.raises(ValueError, match="origin"):
            blockmodel.BlockModelDefinition.from_dict({"block_size": (1, 1, 1)})

    def test_same_grid_ignores_extent_and_parents(self):
        a = _definition()
        b = _definition(n_blocks=(8, 8, 8), parent_size=None)
        assert a.same_grid(b) and a != b
        assert not a.same_grid(_definition(rotation={"azimuth": 1.0}))


# ----------------------------------------------------------------- model

class TestModelConstruction:
    def test_indices_derived_from_world_geometry(self):
        d = _definition()
        blocks = pd.DataFrame({
            "x": [1005.0, 1002.5], "y": [2005.0, 2017.5], "z": [102.5, 108.75],
            "dx": [10.0, 5.0], "dy": [10.0, 5.0], "dz": [5.0, 2.5], "grade": [1.0, 2.0],
        })
        model = blockmodel.BlockModel(blocks, definition=d)
        assert model.blocks[["i", "j", "k", "ni", "nj", "nk"]].values.tolist() == [[0, 0, 0, 2, 2, 2], [0, 3, 3, 1, 1, 1]]
        assert model.attribute_columns == ["grade"]

    def test_world_geometry_derived_from_indices(self):
        d = _definition()
        model = blockmodel.BlockModel(pd.DataFrame({"i": [1], "j": [2], "k": [3], "grade": [0.5]}), definition=d)
        row = model.blocks.iloc[0]
        assert (row.x, row.y, row.z, row.dx, row.dy, row.dz) == pytest.approx((1007.5, 2012.5, 108.75, 5.0, 5.0, 2.5))
        assert (row.ni, row.nj, row.nk) == (1, 1, 1)

    def test_legacy_metadata_still_yields_legacy_fields_and_a_definition(self):
        model = blockmodel.load_blocks(LEGACY_CSV, metadata=LEGACY_META)
        assert model.definition is not None and model.definition.n_blocks == (5, 4, 3)
        assert model.origin["rotation_deg"] == 0.0
        assert model.max_block_size == {"dx": 10.0, "dy": 10.0, "dz": 10.0}
        assert model.bbox_3d["max_x"] == 500050.0
        assert model.attributes["grade"]["units"] == "%"
        assert model.validate()["summary"] == {"error": 0, "warning": 0, "info": 0}

    def test_no_definition_keeps_legacy_behaviour_and_refuses_grid_ops(self):
        model = blockmodel.BlockModel(pd.DataFrame({
            "x": [5.0], "y": [5.0], "z": [5.0], "dx": [10.0], "dy": [10.0], "dz": [10.0], "grade": [1.0],
        }))
        assert model.definition is None
        assert model.total_volume() == 1000.0
        with pytest.raises(ValueError, match="BlockModelDefinition"):
            model.regularize()
        assert model.validate()["summary"]["error"] == 0

    def test_fixture_loads_and_validates_clean(self, fixture_model, reference):
        assert len(fixture_model.blocks) == reference["block_count"] == 220
        assert fixture_model.definition.to_dict() == reference["definition"]
        assert fixture_model.validate()["summary"] == {"error": 0, "warning": 0, "info": 0}
        assert fixture_model.total_volume() == pytest.approx(reference["total_volume"])


class TestValidation:
    def test_misaligned_overlapping_and_straddling_blocks_are_named(self):
        d = _definition()
        blocks = pd.DataFrame({
            "i": [0, 0, 2, 1], "j": [0, 0, 0, 0], "k": [0, 0, 0, 0],
            "ni": [2, 1, 1, 2], "nj": [2, 1, 1, 1], "nk": [2, 1, 1, 1],
        })
        model = blockmodel.BlockModel(blocks, definition=d)
        # Row 3 straddles the parent boundary between i=1 and i=2 and also
        # overlaps rows 0 and 2; row 1 sits inside row 0.
        report = model.validate()
        checks = {(issue["check"], issue["row_index"]) for issue in report["issues"]}
        assert ("overlap", 1) in checks
        assert ("overlap", 3) in checks
        assert ("parent_containment", 3) in checks
        assert report["summary"]["error"] >= 2 and report["summary"]["warning"] == 1

        shifted = model.blocks.copy()
        shifted.loc[2, "x"] += 1.0  # slide one block 1 m off the grid
        misaligned = blockmodel.BlockModel(shifted.drop(columns=["i", "j", "k", "ni", "nj", "nk"]), definition=d)
        issues = validate.validate_alignment(misaligned.blocks, d)
        assert [(i["row_index"], i["type"], i["axis"]) for i in issues] == [(2, "misaligned_corner", "x")]
        assert issues[0]["offset"] == pytest.approx(1.0)

    def test_outside_grid_and_size_not_multiple(self):
        d = _definition()
        model = blockmodel.BlockModel(pd.DataFrame({"i": [3], "j": [0], "k": [0], "ni": [2], "nj": [1], "nk": [1]}), definition=d)
        outside = validate.validate_within_grid(model.blocks, d)
        assert outside[0]["type"] == "block_outside_grid" and outside[0]["axis"] == "x"
        odd = pd.DataFrame({"x": [1004.5], "y": [2002.5], "z": [101.25], "dx": [7.0], "dy": [5.0], "dz": [2.5]})
        issues = validate.validate_alignment(odd, d)
        assert {i["type"] for i in issues} == {"size_not_multiple", "misaligned_corner"}

    def test_pairwise_overlap_still_works_without_a_definition(self):
        blocks = pd.DataFrame({
            "x": [5.0, 7.0], "y": [5.0, 5.0], "z": [5.0, 5.0], "dx": [10.0, 10.0], "dy": [10.0, 10.0], "dz": [10.0, 10.0],
        })
        with pytest.warns(UserWarning):
            issues = validate.validate_no_overlap(blocks)
        assert issues == [{"type": "overlap", "block_i": 0, "block_j": 1}]


class TestOperations:
    def test_regularize_preserves_volume_and_attributes(self, fixture_model, reference):
        regular = fixture_model.regularize()
        assert len(regular.blocks) == reference["regularized_count"] == 480
        assert (regular.blocks[["ni", "nj", "nk"]] == 1).all().all()
        assert regular.total_volume() == pytest.approx(fixture_model.total_volume())
        assert regular.validate()["summary"] == {"error": 0, "warning": 0, "info": 0}
        # Every base cell of the fixture's first (2x2x2) parent carries its grade.
        parent = fixture_model.blocks[(fixture_model.blocks.ni == 2)].iloc[0]
        cells = regular.blocks[(regular.blocks.i // 2 == parent.i // 2) & (regular.blocks.j // 2 == parent.j // 2) & (regular.blocks.k // 2 == parent.k // 2)]
        assert len(cells) == 8 and (cells.grade == parent.grade).all()

    def test_aggregate_to_parents_matches_reference(self, fixture_model, reference):
        parents = fixture_model.to_parent_blocks(density_col="density")
        assert len(parents.blocks) == reference["parent_count"] == 60
        assert list(parents.blocks.columns[:12]) == ["i", "j", "k", "ni", "nj", "nk", "x", "y", "z", "dx", "dy", "dz"]
        expected = pd.DataFrame(reference["parents"])
        got = parents.blocks[["i", "j", "k", "x", "y", "z", "grade", "density", "rock_type", "n_subblocks", "fill_fraction"]]
        pd.testing.assert_frame_equal(got.reset_index(drop=True), expected, check_dtype=False, atol=1e-9)
        assert (parents.blocks.fill_fraction == 1.0).all()
        assert parents.tonnage(density_col="density") == pytest.approx(fixture_model.tonnage(density_col="density"))
        assert parents.validate()["summary"] == {"error": 0, "warning": 0, "info": 0}

    def test_aggregation_rules_and_partial_parents(self):
        d = _definition()
        blocks = pd.DataFrame({
            "i": [0, 1, 0], "j": [0, 0, 0], "k": [0, 0, 1], "ni": [1, 1, 1], "nj": [1, 1, 1], "nk": [1, 1, 1],
            "grade": [1.0, 3.0, 5.0], "density": [2.0, 4.0, 2.0], "rock": ["a", "b", "b"], "tonnes_flag": [1, 1, 1],
        })
        model = blockmodel.BlockModel(blocks, definition=d)
        parents = model.to_parent_blocks(density_col="density", aggregations={"tonnes_flag": "sum", "rock": "first"})
        row = parents.blocks.iloc[0]
        assert row.n_subblocks == 3 and row.fill_fraction == pytest.approx(3 / 8)
        assert row.grade == pytest.approx((1 * 2 + 3 * 4 + 5 * 2) / 8)   # mass-weighted
        assert row.density == pytest.approx((2 + 4 + 2) / 3)               # volume-weighted, so tonnage is conserved
        assert parents.tonnage(density_col="density") == pytest.approx(model.tonnage(density_col="density"))
        assert row.tonnes_flag == 3 and row.rock == "a"
        majority = model.to_parent_blocks().blocks.iloc[0]
        assert majority.rock == "b" and majority.grade == pytest.approx(3.0)
        with pytest.raises(ValueError, match="unknown aggregation"):
            model.to_parent_blocks(aggregations={"grade": "median"})
        with pytest.raises(ValueError, match="parent_size"):
            blockmodel.BlockModel(blocks, definition=_definition(parent_size=None)).to_parent_blocks()

    def test_block_at_and_sample_at_match_reference(self, fixture_model, reference):
        for entry in reference["samples"]:
            x, y, z = entry["point"]
            row = fixture_model.block_at(x, y, z)
            assert (row if row is not None else -1) == entry["block_row"]
        samples = fixture_model.sample_at([e["point"] for e in reference["samples"]], attributes=["grade", "rock_type"])
        assert samples["block_row"].tolist() == [e["block_row"] for e in reference["samples"]]
        assert samples["rock_type"].tolist()[0] == reference["samples"][0]["rock_type"]
        assert np.isnan(samples["grade"].iloc[1])
        frame = fixture_model.sample_at(pd.DataFrame({"x": [500010.0], "y": [6900010.0], "z": [292.5]}))
        assert frame["grade"].iloc[0] == reference["samples"][0]["grade"]

    def test_tonnage_and_grade_tonnage(self, fixture_model, reference):
        assert fixture_model.tonnage(density_col="density") == pytest.approx(reference["tonnes"])
        assert fixture_model.tonnage(density=2.0) == pytest.approx(2.0 * fixture_model.total_volume())
        assert fixture_model.tonnage(density=1.0, criteria={"rock_type": "oxide"}) == pytest.approx(
            fixture_model.filtered_volume({"rock_type": "oxide"}),
        )
        curve = fixture_model.grade_tonnage("grade", [0.0, 1.0, 2.0], density_col="density")
        pd.testing.assert_frame_equal(curve, pd.DataFrame(reference["grade_tonnage"]), atol=1e-9)
        assert curve["tonnes"].is_monotonic_decreasing and curve["grade"].is_monotonic_increasing
        with pytest.raises(ValueError):
            fixture_model.tonnage()

    def test_select_and_clip(self, fixture_model):
        ore = fixture_model.select({"classification": "ore"})
        assert (ore.blocks.classification == "ore").all() and ore.definition is fixture_model.definition
        bottom = fixture_model.clip({"max_z": 300.0})
        assert (bottom.blocks.z <= 300.0).all() and 0 < len(bottom.blocks) < len(fixture_model.blocks)

    def test_diff_reports_added_removed_changed(self):
        d = _definition()
        base = blockmodel.BlockModel(pd.DataFrame({
            "i": [0, 2], "j": [0, 0], "k": [0, 0], "ni": [2, 1], "nj": [1, 1], "nk": [1, 1], "grade": [1.0, 2.0], "rock": ["a", "b"],
        }), definition=d)
        other = blockmodel.BlockModel(pd.DataFrame({
            "i": [0, 1, 3], "j": [0, 0, 0], "k": [0, 0, 0], "ni": [1, 1, 1], "nj": [1, 1, 1], "nk": [1, 1, 1],
            "grade": [1.0, 1.5, 9.0], "rock": ["a", "a", "c"],
        }), definition=_definition(n_blocks=(8, 4, 4)))
        result = base.diff(other)
        assert result["summary"] == {"added": 1, "removed": 1, "changed": 1, "unchanged": 1, "cells_a": 3, "cells_b": 3}
        cells = result["cells"].set_index("i")
        assert cells.loc[1, "status"] == "changed" and cells.loc[1, "grade_delta"] == pytest.approx(0.5)
        assert cells.loc[2, "status"] == "removed" and cells.loc[3, "status"] == "added"
        assert cells.loc[0, "x"] == pytest.approx(1002.5)
        with pytest.raises(ValueError, match="same base grid"):
            base.diff(blockmodel.BlockModel(other.blocks, definition=_definition(rotation={"azimuth": 5.0})))

    def test_save_and_reload_round_trip(self, fixture_model, tmp_path):
        written = fixture_model.save(tmp_path / "out" / "model")
        assert set(written) == {"parquet", "csv", "meta"}
        meta = json.loads(written["meta"].read_text())
        assert meta["definition"] == fixture_model.definition.to_dict()
        for fmt in ("parquet", "csv"):
            again = blockmodel.load_blocks(written[fmt], kind=fmt, metadata=written["meta"])
            assert again.definition == fixture_model.definition
            assert len(again.blocks) == len(fixture_model.blocks)
            assert again.tonnage(density_col="density") == pytest.approx(fixture_model.tonnage(density_col="density"))
        # Index-only tables load through the definition in the metadata.
        index_only = fixture_model.blocks[["i", "j", "k", "ni", "nj", "nk", "grade"]]
        from_indices = blockmodel.load_blocks(index_only, metadata=written["meta"])
        assert from_indices.total_volume() == pytest.approx(fixture_model.total_volume())

    def test_column_variants_for_indices_are_normalised(self):
        d = _definition()
        model = blockmodel.load_blocks(pd.DataFrame({"IX": [1], "IY": [0], "IZ": [0], "xinc": [5.0], "yinc": [5.0], "zinc": [2.5], "XC": [1007.5], "YC": [2002.5], "ZC": [101.25]}), definition=d)
        assert model.blocks[["i", "j", "k"]].values.tolist() == [[1, 0, 0]]
