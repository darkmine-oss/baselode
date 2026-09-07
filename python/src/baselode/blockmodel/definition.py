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

"""Block model grid definition.

A block model is a regular grid of *base blocks* — the finest cell the
model can resolve — anchored at an origin, optionally rotated, and
optionally grouped into larger *parent blocks*.  Every block in the model
sits on that base grid and spans a whole number of base blocks in each
axis, so a regular model is just the special case where every block spans
exactly one parent block.

Coordinate frames
-----------------
``local``
    Grid-aligned metres from the origin: ``u`` along the grid's x axis,
    ``v`` along y, ``w`` along z.  Base cell ``(i, j, k)`` covers
    ``[i*dx, (i+1)*dx)`` in ``u`` and likewise for ``v`` / ``w``.
``world``
    The projected CRS the model lives in.  ``world = origin + R @ local``
    where ``R`` is the rotation matrix built from the definition's
    ``rotation`` angles.

Rotation convention (degrees, all default to 0)
    ``azimuth`` — bearing of the grid's y axis, clockwise from north when
    viewed from above; ``dip`` — the grid's y axis is tilted down by this
    much (positive = down); ``plunge`` — the grid's x axis is tilted down
    by this much.  Applied in the order plunge, dip, azimuth, i.e.
    ``R = Rz(azimuth) · Rx(dip) · Ry(plunge)``.  This matches the
    bearing / dip / plunge triplet used by Leapfrog-style block model
    exports; a model rotated only in plan needs only ``azimuth``.
"""

import math

import numpy as np


_AXES = ("x", "y", "z")
_SIZE_KEYS = ("dx", "dy", "dz")
_COUNT_KEYS = ("nx", "ny", "nz")
_ROTATION_KEYS = ("azimuth", "dip", "plunge")


def _triplet(value, keys, name, cast=float):
    """Coerce a 3-vector given as a sequence or a keyed dict."""
    if value is None:
        raise ValueError(f"{name} is required")
    if isinstance(value, dict):
        missing = [key for key in keys if key not in value]
        if missing:
            raise ValueError(f"{name} is missing {missing}; expected keys {list(keys)}")
        return tuple(cast(value[key]) for key in keys)
    items = list(value)
    if len(items) != 3:
        raise ValueError(f"{name} must have three components, got {len(items)}")
    return tuple(cast(item) for item in items)


def _positive(values, name):
    if any(not math.isfinite(v) or v <= 0 for v in values):
        raise ValueError(f"{name} components must be finite and > 0, got {values}")
    return values


def _rotation_matrix(azimuth, dip, plunge):
    az = math.radians(azimuth)
    dp = math.radians(dip)
    pl = math.radians(plunge)
    # Clockwise about +Z by the bearing: local +v (north) -> bearing az.
    rz = np.array([
        [math.cos(az), math.sin(az), 0.0],
        [-math.sin(az), math.cos(az), 0.0],
        [0.0, 0.0, 1.0],
    ])
    # Tilt local +v downward by dip (rotation about the u axis).
    rx = np.array([
        [1.0, 0.0, 0.0],
        [0.0, math.cos(dp), math.sin(dp)],
        [0.0, -math.sin(dp), math.cos(dp)],
    ])
    # Tilt local +u downward by plunge (rotation about the v axis).
    ry = np.array([
        [math.cos(pl), 0.0, math.sin(pl)],
        [0.0, 1.0, 0.0],
        [-math.sin(pl), 0.0, math.cos(pl)],
    ])
    return rz @ rx @ ry


class BlockModelDefinition:
    """Geometry and metadata of a (sub-blocked) block model grid.

    Parameters
    ----------
    origin : sequence or dict
        World coordinates ``(x, y, z)`` of the grid's minimum corner — the
        corner of base cell ``(0, 0, 0)``.
    block_size : sequence or dict
        Base block size ``(dx, dy, dz)`` in world units.  The finest cell
        the model resolves; every block spans whole base blocks.
    n_blocks : sequence or dict
        Grid extent ``(nx, ny, nz)`` in base blocks.
    parent_size : sequence or dict, optional
        Parent (regular) block size as base-block multiples
        ``(nx, ny, nz)``.  ``None`` means no parent structure is declared.
    rotation : dict or sequence, optional
        ``(azimuth, dip, plunge)`` in degrees; see the module docstring
        for the convention.  Defaults to no rotation.
    crs : str, optional
        EPSG code or proj string of the world frame.
    name, description : str, optional
    extra : dict, optional
        Free-form metadata carried through :meth:`to_dict`.
    """

    def __init__(
        self,
        origin,
        block_size,
        n_blocks,
        parent_size=None,
        rotation=None,
        crs="",
        name="",
        description="",
        extra=None,
    ):
        self.origin = _triplet(origin, _AXES, "origin")
        self.block_size = _positive(_triplet(block_size, _SIZE_KEYS, "block_size"), "block_size")
        self.n_blocks = _triplet(n_blocks, _COUNT_KEYS, "n_blocks", cast=int)
        if any(n <= 0 for n in self.n_blocks):
            raise ValueError(f"n_blocks components must be >= 1, got {self.n_blocks}")
        if parent_size is None:
            self.parent_size = None
        else:
            self.parent_size = _triplet(parent_size, _COUNT_KEYS, "parent_size", cast=int)
            if any(p <= 0 for p in self.parent_size):
                raise ValueError(f"parent_size components must be >= 1, got {self.parent_size}")
        if rotation is None:
            self.rotation = (0.0, 0.0, 0.0)
        elif isinstance(rotation, dict):
            self.rotation = tuple(float(rotation.get(key, 0.0)) for key in _ROTATION_KEYS)
        else:
            self.rotation = _triplet(rotation, _ROTATION_KEYS, "rotation")
        self.crs = crs or ""
        self.name = name or ""
        self.description = description or ""
        self.extra = dict(extra or {})
        self._matrix = _rotation_matrix(*self.rotation)
        self._inverse = self._matrix.T

    # ------------------------------------------------------------------ props

    @property
    def azimuth(self):
        return self.rotation[0]

    @property
    def dip(self):
        return self.rotation[1]

    @property
    def plunge(self):
        return self.rotation[2]

    @property
    def is_rotated(self):
        return any(abs(angle) > 0.0 for angle in self.rotation)

    @property
    def is_subblocked(self):
        """True when a parent size is declared and is larger than the base block."""
        return self.parent_size is not None and any(p > 1 for p in self.parent_size)

    @property
    def n_parent_blocks(self):
        """Grid extent in parent blocks (rounded up); equals ``n_blocks`` without parents."""
        if self.parent_size is None:
            return self.n_blocks
        return tuple(-(-n // p) for n, p in zip(self.n_blocks, self.parent_size))

    @property
    def parent_block_size(self):
        """Parent block size in world units (``None`` without parents)."""
        if self.parent_size is None:
            return None
        return tuple(s * p for s, p in zip(self.block_size, self.parent_size))

    @property
    def extent(self):
        """Grid extent along its local axes in world units."""
        return tuple(s * n for s, n in zip(self.block_size, self.n_blocks))

    @property
    def base_cell_count(self):
        return int(np.prod(self.n_blocks))

    @property
    def base_cell_volume(self):
        return float(np.prod(self.block_size))

    # ------------------------------------------------------------- transforms

    def rotation_matrix(self):
        """3x3 matrix ``R`` with ``world = origin + R @ local``."""
        return self._matrix.copy()

    def local_to_world(self, u, v, w):
        """Map local grid coordinates to world coordinates (scalars or arrays)."""
        local = np.stack([np.asarray(u, dtype=float), np.asarray(v, dtype=float), np.asarray(w, dtype=float)])
        world = self._matrix @ local.reshape(3, -1)
        world = world + np.asarray(self.origin, dtype=float)[:, None]
        world = world.reshape(local.shape)
        return world[0], world[1], world[2]

    def world_to_local(self, x, y, z):
        """Map world coordinates to local grid coordinates (scalars or arrays)."""
        world = np.stack([np.asarray(x, dtype=float), np.asarray(y, dtype=float), np.asarray(z, dtype=float)])
        shifted = world.reshape(3, -1) - np.asarray(self.origin, dtype=float)[:, None]
        local = (self._inverse @ shifted).reshape(world.shape)
        return local[0], local[1], local[2]

    def index_to_world(self, i, j, k, ni=1, nj=1, nk=1):
        """World centroid of the block whose minimum corner is base cell ``(i, j, k)``
        and which spans ``(ni, nj, nk)`` base blocks."""
        dx, dy, dz = self.block_size
        u = (np.asarray(i, dtype=float) + np.asarray(ni, dtype=float) / 2.0) * dx
        v = (np.asarray(j, dtype=float) + np.asarray(nj, dtype=float) / 2.0) * dy
        w = (np.asarray(k, dtype=float) + np.asarray(nk, dtype=float) / 2.0) * dz
        return self.local_to_world(u, v, w)

    def world_to_index(self, x, y, z):
        """Base cell ``(i, j, k)`` containing each world point (may fall outside the grid)."""
        u, v, w = self.world_to_local(x, y, z)
        dx, dy, dz = self.block_size
        i = np.floor(np.asarray(u) / dx + 1e-9).astype(int)
        j = np.floor(np.asarray(v) / dy + 1e-9).astype(int)
        k = np.floor(np.asarray(w) / dz + 1e-9).astype(int)
        return i, j, k

    def contains_index(self, i, j, k, ni=1, nj=1, nk=1):
        """True where the block ``[i, i+ni) x [j, j+nj) x [k, k+nk)`` lies inside the grid."""
        nx, ny, nz = self.n_blocks
        i = np.asarray(i)
        j = np.asarray(j)
        k = np.asarray(k)
        return (
            (i >= 0) & (j >= 0) & (k >= 0)
            & (i + np.asarray(ni) <= nx) & (j + np.asarray(nj) <= ny) & (k + np.asarray(nk) <= nz)
        )

    def parent_index(self, i, j, k):
        """Parent block index of base cell ``(i, j, k)``; identity without parents."""
        if self.parent_size is None:
            return np.asarray(i), np.asarray(j), np.asarray(k)
        px, py, pz = self.parent_size
        return (
            np.floor_divide(np.asarray(i), px),
            np.floor_divide(np.asarray(j), py),
            np.floor_divide(np.asarray(k), pz),
        )

    # --------------------------------------------------------------- geometry

    def corners(self):
        """The eight world-space corners of the grid, as an ``(8, 3)`` array."""
        ex, ey, ez = self.extent
        local = np.array([
            [0, 0, 0], [ex, 0, 0], [0, ey, 0], [ex, ey, 0],
            [0, 0, ez], [ex, 0, ez], [0, ey, ez], [ex, ey, ez],
        ], dtype=float)
        x, y, z = self.local_to_world(local[:, 0], local[:, 1], local[:, 2])
        return np.stack([x, y, z], axis=1)

    def bounds(self):
        """Axis-aligned world bounding box of the (possibly rotated) grid."""
        corners = self.corners()
        return {
            "min_x": float(corners[:, 0].min()), "max_x": float(corners[:, 0].max()),
            "min_y": float(corners[:, 1].min()), "max_y": float(corners[:, 1].max()),
            "min_z": float(corners[:, 2].min()), "max_z": float(corners[:, 2].max()),
        }

    def outline_2d(self):
        """GeoJSON polygon of the grid footprint in plan (world x/y)."""
        ex, ey, _ = self.extent
        ring_local = [(0, 0), (ex, 0), (ex, ey), (0, ey), (0, 0)]
        ring = []
        for u, v in ring_local:
            x, y, _ = self.local_to_world(u, v, 0.0)
            ring.append([float(x), float(y)])
        return {"type": "Polygon", "coordinates": [ring]}

    # -------------------------------------------------------------- (de)serialise

    def to_dict(self):
        """JSON-ready dict; :meth:`from_dict` reverses it exactly."""
        out = {
            "name": self.name,
            "description": self.description,
            "crs": self.crs,
            "origin": dict(zip(_AXES, self.origin)),
            "block_size": dict(zip(_SIZE_KEYS, self.block_size)),
            "n_blocks": dict(zip(_COUNT_KEYS, self.n_blocks)),
            "parent_size": None if self.parent_size is None else dict(zip(_COUNT_KEYS, self.parent_size)),
            "rotation": dict(zip(_ROTATION_KEYS, self.rotation)),
            "extra": dict(self.extra),
        }
        return out

    @classmethod
    def from_dict(cls, meta):
        """Build a definition from :meth:`to_dict` output or legacy block metadata.

        Legacy metadata (the pre-existing ``*_meta.json`` shape) carries
        ``origin`` (with an optional ``rotation_deg`` treated as azimuth),
        ``min_block_size`` (taken as the base block), ``max_block_size``
        (taken as the parent block) and ``bbox_3d`` (used to derive
        ``n_blocks``).  Raises ``ValueError`` when neither form carries
        enough to define a grid.
        """
        if isinstance(meta, BlockModelDefinition):
            return meta
        meta = dict(meta or {})
        origin = meta.get("origin")
        if origin is None:
            raise ValueError("block model metadata has no origin")
        rotation = meta.get("rotation")
        if rotation is None and isinstance(origin, dict) and origin.get("rotation_deg") is not None:
            rotation = {"azimuth": float(origin["rotation_deg"])}

        block_size = meta.get("block_size") or meta.get("min_block_size")
        if block_size is None:
            raise ValueError("block model metadata has no block_size (or legacy min_block_size)")
        base = _positive(_triplet(block_size, _SIZE_KEYS, "block_size"), "block_size")

        parent_size = meta.get("parent_size")
        if parent_size is None and meta.get("max_block_size"):
            parent_world = _triplet(meta["max_block_size"], _SIZE_KEYS, "max_block_size")
            ratios = [p / b for p, b in zip(parent_world, base)]
            if any(abs(r - round(r)) > 1e-6 for r in ratios):
                raise ValueError(
                    f"legacy max_block_size {parent_world} is not a whole multiple of "
                    f"min_block_size {base}"
                )
            parent_size = tuple(int(round(r)) for r in ratios)

        n_blocks = meta.get("n_blocks")
        if n_blocks is None:
            bbox = meta.get("bbox_3d")
            if not bbox:
                raise ValueError("block model metadata needs n_blocks or a legacy bbox_3d")
            if rotation and any(abs(float(a)) > 0 for a in (rotation.values() if isinstance(rotation, dict) else rotation)):
                raise ValueError("cannot derive n_blocks from bbox_3d for a rotated grid; give n_blocks")
            extents = (
                float(bbox["max_x"]) - float(bbox["min_x"]),
                float(bbox["max_y"]) - float(bbox["min_y"]),
                float(bbox["max_z"]) - float(bbox["min_z"]),
            )
            n_blocks = tuple(int(round(e / b)) for e, b in zip(extents, base))

        return cls(
            origin=origin,
            block_size=base,
            n_blocks=n_blocks,
            parent_size=parent_size,
            rotation=rotation,
            crs=meta.get("crs", ""),
            name=meta.get("name", ""),
            description=meta.get("description", ""),
            extra=meta.get("extra"),
        )

    def __eq__(self, other):
        if not isinstance(other, BlockModelDefinition):
            return NotImplemented
        return (
            np.allclose(self.origin, other.origin, rtol=0.0, atol=1e-9)
            and np.allclose(self.block_size, other.block_size, rtol=0.0, atol=1e-9)
            and self.n_blocks == other.n_blocks
            and self.parent_size == other.parent_size
            and np.allclose(self.rotation, other.rotation, rtol=0.0, atol=1e-9)
        )

    def same_grid(self, other, tol=1e-6):
        """True when both grids share origin, base block size and rotation.

        Extent and parent structure may differ — this is the precondition
        for cell-by-cell comparison of two models.  *tol* is absolute (in
        world units for the origin and block size, degrees for the
        rotation): projected coordinates are large enough that a relative
        tolerance would let grids metres apart compare equal.
        """
        return (
            np.allclose(self.origin, other.origin, rtol=0.0, atol=tol)
            and np.allclose(self.block_size, other.block_size, rtol=0.0, atol=tol)
            and np.allclose(self.rotation, other.rotation, rtol=0.0, atol=tol)
        )

    def __repr__(self):
        return (
            f"BlockModelDefinition(origin={self.origin}, block_size={self.block_size}, "
            f"n_blocks={self.n_blocks}, parent_size={self.parent_size}, rotation={self.rotation})"
        )
