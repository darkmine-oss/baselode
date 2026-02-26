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


def map_collars(
    collars,
    color="#2563eb",
    radius=5,
    fill_opacity=0.7,
    tooltip_cols=None,
):
    """Create a Leaflet map with collar points plotted as circle markers.

    Automatically fits the map view to the spatial extent of the collars, so
    no manual centre/zoom calculation is needed.

    Parameters
    ----------
    collars : pandas.DataFrame or geopandas.GeoDataFrame
        Collar table with ``latitude`` and ``longitude`` columns (as produced
        by :func:`baselode.drill.data.load_collars`).
    color : str, optional
        Hex colour for the circle markers. Defaults to ``"#2563eb"`` (blue).
    radius : int, optional
        Marker radius in pixels. Defaults to ``5``.
    fill_opacity : float, optional
        Fill opacity of each marker, between 0 and 1. Defaults to ``0.7``.
    tooltip_cols : list of str, optional
        Extra column names to include in the hover tooltip alongside
        ``hole_id``. Defaults to ``["elevation"]`` when not provided.

    Returns
    -------
    folium.Map
        Leaflet map with all collar markers added and the view fitted to the
        full spatial extent of the dataset.

    Examples
    --------
    >>> from baselode.drill.data import load_collars
    >>> from baselode.map import map_collars
    >>> collar_gdf = load_collars("collars.csv")
    >>> m = map_collars(collar_gdf)
    >>> m  # renders inline in Jupyter
    """
    if tooltip_cols is None:
        tooltip_cols = ["elevation"]

    lats = collars["latitude"]
    lons = collars["longitude"]

    # [[south, west], [north, east]] — Leaflet convention
    bounds = [
        [float(lats.min()), float(lons.min())],
        [float(lats.max()), float(lons.max())],
    ]
    center = [float(lats.median()), float(lons.median())]

    m = folium.Map(location=center, tiles="OpenStreetMap")
    m.fit_bounds(bounds)

    for _, row in collars.iterrows():
        tip_parts = [str(row["hole_id"])]
        for col in tooltip_cols:
            if col in row.index:
                tip_parts.append(f"{col}: {row[col]}")
        tooltip = "  |  ".join(tip_parts)

        folium.CircleMarker(
            location=[row["latitude"], row["longitude"]],
            radius=radius,
            color=color,
            fill=True,
            fill_color=color,
            fill_opacity=fill_opacity,
            tooltip=tooltip,
        ).add_to(m)

    return m

