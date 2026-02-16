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

class Extent():

    def __init__(self, xmin=None, xmax=None, ymin=None, ymax=None, bbox=None, name=None, crs=4326):
        """ 
        Create an extent object, which is an axis-aligned bounding box with name and 
        coordinate reference system (CRS).

        Pass either:
        @param bbox - the axis aligned bounding box as a shapely.geometry.box object
        OR
        @param xmin, xmax, ymin, ymax - the coordinates of the bounding box edges

        @param name - optional name for the extent
        @param crs - coordinate reference system (default is 4326)
        """
        if bbox is None:
            self.bbox = shapely.geometry.box(xmin, ymin, xmax, ymax)
            self.set_minmax()
        else:
            self.bbox = bbox
            self.set_minmax()
        self.name = name
        self.crs = crs

    def set_minmax(self):
        self.xmin, self.ymin, self.xmax, self.ymax = self.bbox.bounds

    def get_folium_rectangle(self):
        """Return bounds formatted for folium.Rectangle: [[south, west], [north, east]]."""
        xmin, ymin, xmax, ymax = self.bbox.bounds
        return [[ymin, xmin], [ymax, xmax]]

    def center(self, latlon=False):
        """Return the bbox center as (y, x) in the extent's CRS, or lat/lon if requested.

        When latlon=True and the extent has a CRS attribute, the centroid is reprojected to EPSG:4326.
        """
        xmin, ymin, xmax, ymax = self.bbox.bounds
        cy, cx = (ymin + ymax) / 2.0, (xmin + xmax) / 2.0
        if not latlon:
            return cy, cx
        try:
            import pyproj

            source_crs = pyproj.CRS.from_user_input(self.crs) if hasattr(self, "crs") else pyproj.CRS.from_epsg(4326)
            target_crs = pyproj.CRS.from_epsg(4326)
            transformer = pyproj.Transformer.from_crs(source_crs, target_crs, always_xy=True)
            lon, lat = transformer.transform(cx, cy)
            return lat, lon
        except Exception:
            # Fallback to raw center if reprojection fails
            return cy, cx

