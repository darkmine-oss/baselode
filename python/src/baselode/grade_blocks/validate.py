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

"""Validation helpers for grade block mesh data.

:func:`validate_grade_block` raises :exc:`ValueError` on the first issue
found, keeping the API simple.  The individual checks can also be called
independently when callers need fine-grained control.
"""

from __future__ import annotations

import numpy as np

from baselode.grade_blocks.data import GradeBlock


def validate_grade_block(block: GradeBlock) -> None:
    """Validate a single :class:`GradeBlock` mesh.

    Checks performed:

    1. Vertices are a 2-D array with 3 columns (x, y, z).
    2. Triangles are a 2-D array with 3 columns (i, j, k).
    3. All triangle indices are within bounds ``[0, len(vertices))``.
    4. No degenerate (zero-area) triangles.

    Parameters
    ----------
    block : GradeBlock
        The block to validate.

    Raises
    ------
    ValueError
        On the first validation failure found.
    """
    verts = block.vertices
    tris = block.triangles

    # --- Vertex shape ---
    if verts.ndim != 2 or verts.shape[1] != 3:
        raise ValueError(
            f"Block '{block.id}': vertices must be a (n, 3) array; "
            f"got shape {verts.shape}."
        )

    # --- Triangle shape ---
    if tris.ndim != 2 or tris.shape[1] != 3:
        raise ValueError(
            f"Block '{block.id}': triangles must be a (m, 3) array; "
            f"got shape {tris.shape}."
        )

    # --- Index bounds ---
    n_verts = len(verts)
    if tris.size > 0:
        min_idx = int(tris.min())
        max_idx = int(tris.max())
        if min_idx < 0 or max_idx >= n_verts:
            raise ValueError(
                f"Block '{block.id}': triangle indices out of bounds. "
                f"Valid range is [0, {n_verts - 1}]; "
                f"found indices in [{min_idx}, {max_idx}]."
            )

    # --- Degenerate triangles ---
    v0 = verts[tris[:, 0]]
    v1 = verts[tris[:, 1]]
    v2 = verts[tris[:, 2]]
    cross = np.cross(v1 - v0, v2 - v0)
    areas = np.linalg.norm(cross, axis=1) * 0.5
    degenerate = np.where(areas == 0.0)[0]
    if len(degenerate) > 0:
        raise ValueError(
            f"Block '{block.id}': {len(degenerate)} degenerate (zero-area) "
            f"triangle(s) found at indices: {degenerate.tolist()[:5]}{'...' if len(degenerate) > 5 else ''}."
        )
