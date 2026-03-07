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

"""Tests for the grade_blocks subpackage (data loading and validation)."""

import io
import json

import numpy as np
import pytest

from baselode.grade_blocks.data import (
    GradeBlock,
    GradeBlockSet,
    load_grade_blocks_json,
)
from baselode.grade_blocks.validate import validate_grade_block


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

EXAMPLE_DATA = {
    "schema_version": "1.0",
    "units": "m",
    "blocks": [
        {
            "id": "LG",
            "name": "Low grade",
            "attributes": {"grade_class": "LG"},
            "material": {"color": "#1FA44A", "opacity": 1.0},
            "vertices": [
                [0, 10, 2], [10, 10, 2], [10, 7, 2], [0, 6, 2],
                [0, 10, 0], [10, 10, 0], [10, 7, 0], [0, 6, 0],
            ],
            "triangles": [
                [0,1,2], [0,2,3],
                [5,4,7], [5,7,6],
                [4,5,1], [4,1,0],
                [5,6,2], [5,2,1],
                [6,7,3], [6,3,2],
                [7,4,0], [7,0,3],
            ],
        },
        {
            "id": "HG",
            "name": "High grade",
            "attributes": {"grade_class": "HG"},
            "material": {"color": "#B02020", "opacity": 1.0},
            "vertices": [
                [0, 6, 2], [10, 7, 2], [10, 0, 2], [0, 0, 2],
                [0, 6, 0], [10, 7, 0], [10, 0, 0], [0, 0, 0],
            ],
            "triangles": [
                [0,1,2], [0,2,3],
                [5,4,7], [5,7,6],
                [4,5,1], [4,1,0],
                [5,6,2], [5,2,1],
                [6,7,3], [6,3,2],
                [7,4,0], [7,0,3],
            ],
        },
    ],
}


def _example_json_str():
    return json.dumps(EXAMPLE_DATA)


def _simple_block(id_="T"):
    """Return a minimal GradeBlock with a non-degenerate triangle fan."""
    vertices = np.array([
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    ], dtype=float)
    triangles = np.array([
        [0, 1, 2],
        [0, 1, 3],
    ], dtype=int)
    return GradeBlock(
        id=id_,
        name="Test",
        vertices=vertices,
        triangles=triangles,
    )


# ---------------------------------------------------------------------------
# GradeBlock / GradeBlockSet dataclasses
# ---------------------------------------------------------------------------

class TestGradeBlockDataclasses:
    def test_grade_block_repr(self):
        b = _simple_block()
        r = repr(b)
        assert "GradeBlock" in r
        assert "T" in r

    def test_grade_block_set_repr(self):
        bs = GradeBlockSet(blocks=[], units="m", schema_version="1.0")
        r = repr(bs)
        assert "GradeBlockSet" in r
        assert "1.0" in r

    def test_default_attributes_and_material(self):
        b = GradeBlock(
            id="X", name="X",
            vertices=np.zeros((3, 3)),
            triangles=np.zeros((1, 3), dtype=int),
        )
        assert b.attributes == {}
        assert b.material == {}


# ---------------------------------------------------------------------------
# load_grade_blocks_json
# ---------------------------------------------------------------------------

class TestLoadGradeBlocksJson:
    def test_loads_from_file_like(self):
        fh = io.StringIO(_example_json_str())
        result = load_grade_blocks_json(fh)
        assert isinstance(result, GradeBlockSet)
        assert result.schema_version == "1.0"
        assert result.units == "m"
        assert len(result.blocks) == 2

    def test_loads_from_path(self, tmp_path):
        p = tmp_path / "blocks.json"
        p.write_text(_example_json_str(), encoding="utf-8")
        result = load_grade_blocks_json(p)
        assert len(result.blocks) == 2

    def test_loads_from_string_path(self, tmp_path):
        p = tmp_path / "blocks.json"
        p.write_text(_example_json_str(), encoding="utf-8")
        result = load_grade_blocks_json(str(p))
        assert len(result.blocks) == 2

    def test_block_fields(self):
        fh = io.StringIO(_example_json_str())
        result = load_grade_blocks_json(fh)
        lg = result.blocks[0]
        assert lg.id == "LG"
        assert lg.name == "Low grade"
        assert lg.attributes == {"grade_class": "LG"}
        assert lg.material == {"color": "#1FA44A", "opacity": 1.0}
        assert isinstance(lg.vertices, np.ndarray)
        assert lg.vertices.shape == (8, 3)
        assert isinstance(lg.triangles, np.ndarray)
        assert lg.triangles.shape == (12, 3)

    def test_raises_on_wrong_schema_version(self):
        data = dict(EXAMPLE_DATA, schema_version="2.0")
        fh = io.StringIO(json.dumps(data))
        with pytest.raises(ValueError, match="schema_version"):
            load_grade_blocks_json(fh)

    def test_raises_when_blocks_missing(self):
        data = {"schema_version": "1.0", "units": "m"}
        fh = io.StringIO(json.dumps(data))
        with pytest.raises(ValueError, match="blocks"):
            load_grade_blocks_json(fh)

    def test_raises_when_block_missing_id(self):
        data = {
            "schema_version": "1.0", "units": "m",
            "blocks": [{"name": "X", "vertices": [], "triangles": []}],
        }
        fh = io.StringIO(json.dumps(data))
        with pytest.raises(ValueError, match="id"):
            load_grade_blocks_json(fh)

    def test_raises_when_block_missing_vertices(self):
        data = {
            "schema_version": "1.0", "units": "m",
            "blocks": [{"id": "X", "name": "X", "triangles": []}],
        }
        fh = io.StringIO(json.dumps(data))
        with pytest.raises(ValueError, match="vertices"):
            load_grade_blocks_json(fh)

    def test_raises_when_block_missing_triangles(self):
        data = {
            "schema_version": "1.0", "units": "m",
            "blocks": [{"id": "X", "name": "X", "vertices": []}],
        }
        fh = io.StringIO(json.dumps(data))
        with pytest.raises(ValueError, match="triangles"):
            load_grade_blocks_json(fh)

    def test_defaults_attributes_and_material_when_absent(self):
        data = {
            "schema_version": "1.0", "units": "m",
            "blocks": [{
                "id": "X", "name": "X",
                "vertices": [[0,0,0],[1,0,0],[0,1,0]],
                "triangles": [[0,1,2]],
            }],
        }
        fh = io.StringIO(json.dumps(data))
        result = load_grade_blocks_json(fh)
        assert result.blocks[0].attributes == {}
        assert result.blocks[0].material == {}


# ---------------------------------------------------------------------------
# validate_grade_block
# ---------------------------------------------------------------------------

class TestValidateGradeBlock:
    def test_valid_block_does_not_raise(self):
        fh = io.StringIO(_example_json_str())
        result = load_grade_blocks_json(fh)
        for block in result.blocks:
            validate_grade_block(block)  # should not raise

    def test_bad_vertex_shape_raises(self):
        b = _simple_block()
        b.vertices = np.array([[0, 0], [1, 0], [0, 1]])  # 2 columns
        with pytest.raises(ValueError, match="vertices"):
            validate_grade_block(b)

    def test_bad_triangle_shape_raises(self):
        b = _simple_block()
        b.triangles = np.array([[0, 1]])  # 2 columns
        with pytest.raises(ValueError, match="triangles"):
            validate_grade_block(b)

    def test_out_of_bounds_index_raises(self):
        b = _simple_block()
        b.triangles = np.array([[0, 1, 99]])  # index 99 out of range
        with pytest.raises(ValueError, match="out of bounds"):
            validate_grade_block(b)

    def test_degenerate_triangle_raises(self):
        b = _simple_block()
        # Duplicate vertex index -> zero area
        b.triangles = np.array([[0, 0, 1]])
        with pytest.raises(ValueError, match="degenerate"):
            validate_grade_block(b)

    def test_example_mesh_passes_validation(self):
        fh = io.StringIO(_example_json_str())
        result = load_grade_blocks_json(fh)
        # Both LG and HG blocks should pass
        for block in result.blocks:
            validate_grade_block(block)
