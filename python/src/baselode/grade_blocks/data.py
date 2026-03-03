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

"""3D polygonal grade block data model and loader.

A grade block is a closed polyhedral mesh defined by a set of 3-D vertices
and a set of triangle indices referencing those vertices, plus optional
attributes (grade class, color, metadata).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO, List, Union

import numpy as np


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class GradeBlock:
    """A single grade block represented as a polyhedral triangle mesh.

    Attributes
    ----------
    id : str
        Unique identifier.
    name : str
        Human-readable name.
    vertices : np.ndarray
        Float array of shape ``(n, 3)`` – one ``[x, y, z]`` per row.
    triangles : np.ndarray
        Integer array of shape ``(m, 3)`` – zero-based vertex indices.
    attributes : dict
        Arbitrary metadata (e.g. ``{"grade_class": "LG"}``).
    material : dict
        Rendering hints, e.g. ``{"color": "#1FA44A", "opacity": 1.0}``.
    """

    id: str
    name: str
    vertices: np.ndarray
    triangles: np.ndarray
    attributes: dict = field(default_factory=dict)
    material: dict = field(default_factory=dict)

    def __repr__(self) -> str:
        return (
            f"GradeBlock(id={self.id!r}, name={self.name!r}, "
            f"vertices={len(self.vertices)}, triangles={len(self.triangles)})"
        )


@dataclass
class GradeBlockSet:
    """A collection of grade blocks parsed from a single JSON source.

    Attributes
    ----------
    blocks : list[GradeBlock]
    units : str
        Informational only (e.g. ``"m"``).
    schema_version : str
        Must equal ``"1.0"``.
    """

    blocks: List[GradeBlock]
    units: str
    schema_version: str

    def __repr__(self) -> str:
        return (
            f"GradeBlockSet(schema_version={self.schema_version!r}, "
            f"units={self.units!r}, blocks={len(self.blocks)})"
        )


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------

def load_grade_blocks_json(path_or_file: Union[str, Path, IO]) -> GradeBlockSet:
    """Load grade blocks from a JSON file path or file-like object.

    Parameters
    ----------
    path_or_file : str | Path | file-like
        Path to a JSON file, or an already-opened file object (or any object
        with a ``read()`` method).

    Returns
    -------
    GradeBlockSet

    Raises
    ------
    ValueError
        If ``schema_version`` is not ``"1.0"`` or required fields are missing.
    """
    if hasattr(path_or_file, "read"):
        data = json.load(path_or_file)
    else:
        with open(path_or_file, encoding="utf-8") as fh:
            data = json.load(fh)

    schema_version = data.get("schema_version")
    if schema_version != "1.0":
        raise ValueError(
            f"Unsupported schema_version: {schema_version!r}. Expected '1.0'."
        )

    units = data.get("units", "")
    raw_blocks = data.get("blocks")
    if not isinstance(raw_blocks, list):
        raise ValueError("'blocks' must be a JSON array.")

    blocks: List[GradeBlock] = []
    for i, raw in enumerate(raw_blocks):
        block_id = raw.get("id")
        if block_id is None:
            raise ValueError(f"Block at index {i} is missing required field 'id'.")
        name = raw.get("name")
        if name is None:
            raise ValueError(f"Block '{block_id}' is missing required field 'name'.")

        raw_vertices = raw.get("vertices")
        if raw_vertices is None:
            raise ValueError(f"Block '{block_id}' is missing required field 'vertices'.")
        raw_triangles = raw.get("triangles")
        if raw_triangles is None:
            raise ValueError(f"Block '{block_id}' is missing required field 'triangles'.")

        vertices = np.asarray(raw_vertices, dtype=float)
        triangles = np.asarray(raw_triangles, dtype=int)

        attributes = raw.get("attributes", {})
        material = raw.get("material", {})

        blocks.append(GradeBlock(
            id=block_id,
            name=name,
            vertices=vertices,
            triangles=triangles,
            attributes=attributes,
            material=material,
        ))

    return GradeBlockSet(blocks=blocks, units=units, schema_version=schema_version)
