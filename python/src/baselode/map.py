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

import folium

def create_leaflet_map(center=None, zoom_start=2):
    """Create a Leaflet map with OpenStreetMap tiles."""

    if center is None:
        center = [0, 0]  # Default to (lat, lon) at the equator
    m = folium.Map(location=center, zoom_start=zoom_start, tiles="OpenStreetMap")
    return m


def map_collar_points(collars, color_by=None):
    """Prepare collar points for 2D map plotting.

    Parameters
    ----------
    collars : pandas.DataFrame
        Collar table expected to contain x/y (or equivalent preprocessed fields).
    color_by : str, optional
        Column name to expose as `color_value` for plotting.

    Returns
    -------
    pandas.DataFrame
        Copy of collars with optional color field.
    """
    if collars is None or collars.empty:
        return collars.copy() if collars is not None else collars

    out = collars.copy()
    if color_by is not None and color_by in out.columns:
        out["color_value"] = out[color_by]
    return out

