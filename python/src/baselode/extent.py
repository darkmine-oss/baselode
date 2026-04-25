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

import shapely.geometry

# Canonical default — GeoJSON / OGC convention.
DEFAULT_CRS = "EPSG:4326"


def _normalise_crs(crs):
    """Validate ``crs`` and return it in canonical form.

    Mirrors how geopandas accepts CRS values: anything
    ``pyproj.CRS.from_user_input`` understands (EPSG strings like
    ``"EPSG:4326"``, bare ints like ``4326``, WKT/proj strings, or a
    ``pyproj.CRS`` instance) is allowed. Anything else raises
    ``ValueError`` with a helpful message.

    The returned value is the canonical form:

    - ``"EPSG:N"`` (string) when the CRS has an EPSG code (the common case).
    - the parsed ``pyproj.CRS`` instance when it doesn't (e.g. custom WKT
      with no registered EPSG code) — preserves full fidelity.
    """
    if crs is None:
        raise ValueError(
            "Extent requires a CRS. Pass crs='EPSG:4326' (default) or any "
            "value pyproj.CRS.from_user_input accepts."
        )
    try:
        import pyproj
    except ImportError as exc:
        raise ValueError(
            f"Cannot validate CRS {crs!r} because pyproj is not installed. "
            "Install pyproj (it's a baselode hard dependency)."
        ) from exc
    try:
        parsed = pyproj.CRS.from_user_input(crs)
    except Exception as exc:
        raise ValueError(
            f"Invalid CRS {crs!r}: {exc}. Pass anything "
            "pyproj.CRS.from_user_input accepts (e.g. 'EPSG:4326', 28351, "
            "a WKT string, or a pyproj.CRS instance)."
        ) from exc
    epsg = parsed.to_epsg()
    if epsg is not None:
        return f"EPSG:{epsg}"
    return parsed


class Extent():

    def __init__(self, xmin=None, xmax=None, ymin=None, ymax=None, bbox=None, name=None, crs=DEFAULT_CRS):
        """
        Create an extent object, which is an axis-aligned bounding box with name and
        coordinate reference system (CRS).

        Pass either:
        @param bbox - the axis aligned bounding box as a shapely.geometry.box object
        OR
        @param xmin, xmax, ymin, ymax - the coordinates of the bounding box edges

        @param name - optional name for the extent
        @param crs - coordinate reference system. Anything ``pyproj.CRS.from_user_input``
            accepts works (e.g. ``"EPSG:4326"``, the bare int ``4326``, a WKT string,
            or a ``pyproj.CRS`` instance). Defaults to ``"EPSG:4326"``. Validated
            and normalised at construction; an invalid value raises ``ValueError``.
            See :meth:`set_crs` for the normalisation rules.
        """
        if bbox is None:
            self.bbox = shapely.geometry.box(xmin, ymin, xmax, ymax)
            self.set_minmax()
        else:
            self.bbox = bbox
            self.set_minmax()
        self.name = name
        self.set_crs(crs)

    def set_minmax(self):
        self.xmin, self.ymin, self.xmax, self.ymax = self.bbox.bounds

    def set_crs(self, crs):
        """Validate, normalise and store ``crs`` on this Extent.

        Accepts anything ``pyproj.CRS.from_user_input`` accepts. The stored
        value is the canonical form:

        - ``"EPSG:N"`` (string) when the CRS has an EPSG code.
        - the parsed ``pyproj.CRS`` instance when it doesn't.

        After ``set_crs``, ``self.crs`` always reads back in normalised form
        regardless of what was passed in (e.g. ``e.set_crs(4326)`` →
        ``e.crs == "EPSG:4326"``; ``e.set_crs("epsg:28351")`` →
        ``e.crs == "EPSG:28351"``).

        Returns ``self`` so calls are chainable.
        """
        self.crs = _normalise_crs(crs)
        return self

    def to_crs(self, target_crs):
        """Return a new Extent with corners reprojected to ``target_crs``.

        Modelled on ``geopandas.GeoDataFrame.to_crs``. ``target_crs``
        accepts anything ``pyproj.CRS.from_user_input`` accepts and is
        validated / normalised the same way :meth:`set_crs` is.

        For lat/lon use cases::

            wgs84 = extent.to_crs("EPSG:4326")
            min_lon, min_lat, max_lon, max_lat = (
                wgs84.xmin, wgs84.ymin, wgs84.xmax, wgs84.ymax,
            )

        If ``target_crs`` already matches this Extent's CRS, returns a
        fresh copy with the same bounds (no pyproj transform). Otherwise
        reprojects via ``pyproj.Transformer``; reprojection failures
        raise ``ValueError`` rather than silently passing through.
        """
        target = _normalise_crs(target_crs)
        if target == self.crs:
            return Extent(
                xmin=self.xmin, xmax=self.xmax,
                ymin=self.ymin, ymax=self.ymax,
                name=self.name, crs=target,
            )
        try:
            import pyproj
            transformer = pyproj.Transformer.from_crs(
                pyproj.CRS.from_user_input(self.crs),
                pyproj.CRS.from_user_input(target),
                always_xy=True,
            )
            xs, ys = transformer.transform(
                [self.xmin, self.xmax], [self.ymin, self.ymax],
            )
        except Exception as exc:
            raise ValueError(
                f"Failed to reproject extent from CRS {self.crs!r} to "
                f"{target!r}: {exc}"
            ) from exc
        return Extent(
            xmin=min(xs), xmax=max(xs),
            ymin=min(ys), ymax=max(ys),
            name=self.name, crs=target,
        )

    def get_folium_rectangle(self):
        """Return bounds formatted for folium.Rectangle: [[south, west], [north, east]]."""
        xmin, ymin, xmax, ymax = self.bbox.bounds
        return [[ymin, xmin], [ymax, xmax]]

    def center(self, lonlat=False):
        """Return the bbox center as (x, y) in the extent's CRS, or (lon, lat) if requested.

        When lonlat=True and the extent has a CRS attribute, the centroid is reprojected to EPSG:4326.
        """
        xmin, ymin, xmax, ymax = self.bbox.bounds
        cx, cy = (xmin + xmax) / 2.0, (ymin + ymax) / 2.0
        if not lonlat:
            return cx, cy
        try:
            import pyproj

            source_crs = pyproj.CRS.from_user_input(self.crs) if hasattr(self, "crs") else pyproj.CRS.from_epsg(4326)
            target_crs = pyproj.CRS.from_epsg(4326)
            transformer = pyproj.Transformer.from_crs(source_crs, target_crs, always_xy=True)
            lon, lat = transformer.transform(cx, cy)
            return lon, lat
        except Exception:
            # Fallback to raw center if reprojection fails
            return cx, cy
