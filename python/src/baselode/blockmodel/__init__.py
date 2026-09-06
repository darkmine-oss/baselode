# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

"""Block models as a baselode primitive.

- :mod:`baselode.blockmodel.definition` — the grid (origin, base block
  size, extent, parent size, rotation, CRS) and its coordinate transforms.
- :mod:`baselode.blockmodel.data` — the :class:`BlockModel` table plus
  loading, sub-block operations, tonnage and diff.
- :mod:`baselode.blockmodel.validate` — alignment / extent / overlap /
  parent-containment checks and the structured report.
"""

from baselode.blockmodel.definition import BlockModelDefinition
from baselode.blockmodel.data import (
    BlockModel,
    attach_block_centroids,
    attach_block_indices,
    load_block_metadata,
    load_blocks,
)
from baselode.blockmodel.validate import validate_block_model

__all__ = [
    "BlockModel",
    "BlockModelDefinition",
    "attach_block_centroids",
    "attach_block_indices",
    "load_block_metadata",
    "load_blocks",
    "validate_block_model",
]
