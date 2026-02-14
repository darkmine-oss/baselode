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

"""
Baselode Open Data Model

Provides a consistent schema for data handling throughout the library.

Individual data loaders apply common column mapping, but also accept user-provided column maps to handle variations in source data.
"""

HOLE_ID = "hole_id"
LATITUDE = "latitude"
LONGITUDE = "longitude"
ELEVATION = "elevation"
AZIMUTH = "azimuth"
DIP = "dip"
FROM = "from"
TO = "to"
PROJECT_ID = "project_id"
EASTING = "easting"
NORTHING = "northing"
CRS = "crs"