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

"""Tests for the blockmodel subpackage (data loading, calculations, validation)."""

from pathlib import Path

import pandas as pd
import pytest

from baselode.blockmodel.data import (
    BlockModel,
    load_block_metadata,
    load_blocks,
)
from baselode.blockmodel.validate import (
    validate_block_sizes,
    validate_blocks_in_bbox,
    validate_no_overlap,
)

DATA_DIR = Path(__file__).parent / "data" / "blockmodel"
DEMO_CSV = DATA_DIR / "demo_blockmodel.csv"
DEMO_META = DATA_DIR / "demo_blockmodel_meta.json"


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _simple_blocks(n_x=3, n_y=2, n_z=2, dx=10, dy=10, dz=5):
    """Build a small non-overlapping block model DataFrame."""
    rows = []
    for iz in range(n_z):
        for iy in range(n_y):
            for ix in range(n_x):
                rows.append({
                    "x": dx / 2 + ix * dx,
                    "y": dy / 2 + iy * dy,
                    "z": dz / 2 + iz * dz,
                    "dx": dx, "dy": dy, "dz": dz,
                    "grade": float(ix + iy + iz),
                    "rock_type": "fresh" if iz == 0 else "oxide",
                })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# BlockModel construction
# ---------------------------------------------------------------------------

class TestBlockModelConstruction:
    def test_constructs_from_dataframe(self):
        df = _simple_blocks()
        bm = BlockModel(df)
        assert len(bm.blocks) == 3 * 2 * 2
        assert bm.name == ""

    def test_constructs_with_metadata(self):
        df = _simple_blocks()
        meta = {"name": "test", "crs": "EPSG:32750", "description": "desc"}
        bm = BlockModel(df, metadata=meta)
        assert bm.name == "test"
        assert bm.crs == "EPSG:32750"

    def test_bbox_computed_from_blocks(self):
        df = _simple_blocks(n_x=3, n_y=2, n_z=1, dx=10, dy=10, dz=10)
        bm = BlockModel(df)
        assert bm.bbox_3d["min_x"] == pytest.approx(0.0)
        assert bm.bbox_3d["max_x"] == pytest.approx(30.0)
        assert bm.bbox_3d["min_y"] == pytest.approx(0.0)
        assert bm.bbox_3d["max_y"] == pytest.approx(20.0)

    def test_outline_2d_computed_from_bbox(self):
        bm = BlockModel(_simple_blocks())
        assert bm.outline_2d.get("type") == "Polygon"
        coords = bm.outline_2d["coordinates"][0]
        assert len(coords) == 5  # closed ring

    def test_max_min_block_size_computed(self):
        bm = BlockModel(_simple_blocks(dx=10, dy=10, dz=5))
        assert bm.max_block_size == pytest.approx({"dx": 10.0, "dy": 10.0, "dz": 5.0})
        assert bm.min_block_size == pytest.approx({"dx": 10.0, "dy": 10.0, "dz": 5.0})

    def test_repr(self):
        bm = BlockModel(_simple_blocks(), metadata={"name": "mymodel"})
        assert "mymodel" in repr(bm)
        assert "BlockModel" in repr(bm)


# ---------------------------------------------------------------------------
# Calculations
# ---------------------------------------------------------------------------

class TestBlockModelCalculations:
    def test_total_volume(self):
        df = _simple_blocks(n_x=3, n_y=2, n_z=2, dx=10, dy=10, dz=5)
        bm = BlockModel(df)
        # 12 blocks × (10 * 10 * 5)
        assert bm.total_volume() == pytest.approx(12 * 500.0)

    def test_filtered_volume_dict_equality(self):
        bm = BlockModel(_simple_blocks())
        vol_fresh = bm.filtered_volume({"rock_type": "fresh"})
        vol_oxide = bm.filtered_volume({"rock_type": "oxide"})
        assert vol_fresh > 0
        assert vol_oxide > 0
        assert vol_fresh + vol_oxide == pytest.approx(bm.total_volume())

    def test_filtered_volume_numeric_gt(self):
        bm = BlockModel(_simple_blocks(n_x=3, n_y=1, n_z=1, dx=10, dy=10, dz=10))
        # grade values are 0, 1, 2 (ix + iy + iz)
        vol_above_0 = bm.filtered_volume({"grade": {"gt": 0}})
        # 2 blocks (grade=1, grade=2) × 1000
        assert vol_above_0 == pytest.approx(2000.0)

    def test_filtered_volume_callable(self):
        bm = BlockModel(_simple_blocks())
        vol = bm.filtered_volume(lambda df: df["grade"] >= 2)
        assert vol >= 0

    def test_attribute_stats_numeric(self):
        bm = BlockModel(_simple_blocks())
        stats = bm.attribute_stats("grade")
        assert stats["type"] == "numeric"
        assert "min" in stats and "max" in stats and "mean" in stats

    def test_attribute_stats_categorical(self):
        bm = BlockModel(_simple_blocks())
        stats = bm.attribute_stats("rock_type")
        assert stats["type"] == "categorical"
        assert "value_counts" in stats
        assert "fresh" in stats["value_counts"]

    def test_attribute_stats_with_filter(self):
        bm = BlockModel(_simple_blocks())
        stats_all = bm.attribute_stats("grade")
        stats_fresh = bm.attribute_stats("grade", filter_criteria={"rock_type": "fresh"})
        # Filtered count <= total count
        assert stats_fresh["count"] <= stats_all["count"]

    def test_attribute_stats_missing_column_raises(self):
        bm = BlockModel(_simple_blocks())
        with pytest.raises(KeyError):
            bm.attribute_stats("nonexistent_column")

    def test_block_size_stats(self):
        bm = BlockModel(_simple_blocks(dx=10, dy=10, dz=5))
        stats = bm.block_size_stats()
        assert stats["min"]["dz"] == pytest.approx(5.0)
        assert stats["max"]["dz"] == pytest.approx(5.0)

    def test_query_metadata_contains_expected_keys(self):
        bm = BlockModel(_simple_blocks(), metadata={"name": "q", "crs": "EPSG:4326"})
        meta = bm.query_metadata()
        for key in ["name", "crs", "bbox_3d", "block_count", "max_block_size", "min_block_size"]:
            assert key in meta
        assert meta["block_count"] == len(bm.blocks)

    def test_empty_block_model_volume(self):
        bm = BlockModel(pd.DataFrame(columns=["x", "y", "z", "dx", "dy", "dz"]))
        assert bm.total_volume() == 0.0


# ---------------------------------------------------------------------------
# Loading from CSV
# ---------------------------------------------------------------------------

class TestLoadBlocks:
    def test_load_from_csv_string(self):
        bm = load_blocks(DEMO_CSV)
        assert len(bm.blocks) == 60
        for col in ["x", "y", "z", "dx", "dy", "dz"]:
            assert col in bm.blocks.columns

    def test_load_with_metadata_file(self):
        bm = load_blocks(DEMO_CSV, metadata=DEMO_META)
        assert bm.name == "demo_block_model"
        assert bm.crs == "EPSG:32750"
        assert bm.bbox_3d["min_x"] == pytest.approx(500000.0)

    def test_load_from_dataframe(self):
        df = _simple_blocks()
        bm = load_blocks(df)
        assert len(bm.blocks) == len(df)

    def test_load_normalizes_center_x_columns(self):
        df = pd.DataFrame({
            "center_x": [5.0], "center_y": [5.0], "center_z": [5.0],
            "size_x": [10.0], "size_y": [10.0], "size_z": [10.0],
        })
        bm = load_blocks(df)
        assert "x" in bm.blocks.columns
        assert "dx" in bm.blocks.columns

    def test_load_missing_geometry_column_raises(self):
        df = pd.DataFrame({"x": [5.0], "y": [5.0], "z": [5.0], "dx": [10.0], "dy": [10.0]})
        with pytest.raises(ValueError, match="dz"):
            load_blocks(df)

    def test_load_block_metadata_from_file(self):
        meta = load_block_metadata(DEMO_META)
        assert meta["name"] == "demo_block_model"

    def test_load_block_metadata_from_dict(self):
        d = {"name": "x", "crs": "EPSG:4326"}
        assert load_block_metadata(d) is d


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

class TestValidation:
    def test_validate_block_sizes_no_issues(self):
        df = _simple_blocks(dx=10, dy=10, dz=5)
        issues = validate_block_sizes(df, {"dx": 10.0, "dy": 10.0, "dz": 10.0})
        assert issues == []

    def test_validate_block_sizes_finds_invalid_divisor(self):
        # dx=6 is not a valid divisor of max_dx=10 (10/6 ≈ 1.67)
        df = pd.DataFrame({
            "x": [5.0], "y": [5.0], "z": [5.0],
            "dx": [6.0], "dy": [10.0], "dz": [10.0],
        })
        issues = validate_block_sizes(df, {"dx": 10.0, "dy": 10.0, "dz": 10.0})
        assert any(i["type"] == "invalid_block_size_divisor" for i in issues)

    def test_validate_blocks_in_bbox_no_issues(self):
        bm = load_blocks(DEMO_CSV, metadata=DEMO_META)
        issues = validate_blocks_in_bbox(bm.blocks, bm.bbox_3d)
        assert issues == []

    def test_validate_blocks_in_bbox_finds_violation(self):
        df = pd.DataFrame({
            "x": [105.0], "y": [5.0], "z": [5.0],
            "dx": [10.0], "dy": [10.0], "dz": [10.0],
        })
        bbox = {"min_x": 0.0, "max_x": 100.0, "min_y": 0.0, "max_y": 20.0, "min_z": 0.0, "max_z": 20.0}
        issues = validate_blocks_in_bbox(df, bbox)
        assert any(i["type"] == "block_outside_bbox" for i in issues)

    def test_validate_no_overlap_clean_model(self):
        df = _simple_blocks()
        issues = validate_no_overlap(df)
        assert issues == []

    def test_validate_no_overlap_detects_overlap(self):
        # Two identical blocks at same position
        df = pd.DataFrame({
            "x": [5.0, 5.0], "y": [5.0, 5.0], "z": [5.0, 5.0],
            "dx": [10.0, 10.0], "dy": [10.0, 10.0], "dz": [10.0, 10.0],
        })
        issues = validate_no_overlap(df)
        assert len(issues) >= 1
        assert issues[0]["type"] == "overlap"

    def test_validate_no_overlap_adjacent_blocks_ok(self):
        # Two blocks sharing a face (touching but not overlapping)
        df = pd.DataFrame({
            "x": [5.0, 15.0], "y": [5.0, 5.0], "z": [5.0, 5.0],
            "dx": [10.0, 10.0], "dy": [10.0, 10.0], "dz": [10.0, 10.0],
        })
        issues = validate_no_overlap(df)
        assert issues == []
