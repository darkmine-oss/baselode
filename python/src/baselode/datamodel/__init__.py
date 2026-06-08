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

# Canonical fields for the baselode data model.

# Drilling and sampling primitives
DATASOURCE = "datasource"

HOLE_ID = "hole_id"
COLLAR_ID = "_collar_id"
DATASOURCE_HOLE_ID = "datasource_hole_id"
HOLE_TYPE = "hole_type"
MAX_DEPTH = "max_depth"

SURFACE_SAMPLE_ID = "surface_sample_id"
SURFACE_SAMPLE_TYPE = "surface_sample_type"
DATASOURCE_SURFACE_SAMPLE_ID = "datasource_surface_sample_id"

PROJECT_ID = "project_id"
REPORT_NUMBER = "report_number"

# Collar and surface-sample locations
LATITUDE = "latitude"
LONGITUDE = "longitude"
ELEVATION = "elevation"
EASTING = "easting"
NORTHING = "northing"
CRS = "crs"
DATE_START = "date_start"
DATE_END = "date_end"

# Drilling survey primitives
AZIMUTH = "azimuth"
DIP = "dip"
SURVEY_TYPE = "survey_type"

# Sampling primitives
SAMPLE_ID = "sample_id"
DATASOURCE_SAMPLE_ID = "datasource_sample_id"
FROM = "from"
TO = "to"
MID = "mid"
DEPTH = "depth"

# Structural geology primitives
STRIKE = "strike"
ALPHA = "alpha"
BETA = "beta"
GEOLOGY_CODE = "geology_code"
GEOLOGY_DESCRIPTION = "geology_description"


# Generics 
COMMENTS = "comments"
# Catch-all column on every baselode-model DataFrame. Holds a per-row dict of
# source-specific fields that don't map to the canonical schema. Keeps the
# top-level columns predictable while preserving everything the source provided.
EXTRA = "extra"



# Constants and defaults
GEOPHYSICS_NULL = -999.25



"""
Baselode Open Data Model - Drilling and Surface Sampling
"""

# Minimum expected columns for drillhole collars
# The collar forms the basis for hole_id and spatial location, so it is expected to exist in all datasets and be standardized as much as possible.
BASELODE_DATA_MODEL_DRILL_COLLAR = {
    # A unique hole identifier across the entire dataset and all future data sets
    HOLE_ID: str,
    # The hole ID from the original collar source
    DATASOURCE_HOLE_ID: str,
    # The project ID or project code from the original collar source, if available
    PROJECT_ID: str,
    # The latitude of the collar, in decimal degrees (WGS84)
    LATITUDE: float,
    # The longitude of the collar, in decimal degrees (WGS84)
    LONGITUDE: float,
    # The elevation of the collar, in meters above sea level (WGS84)
    ELEVATION: float,
    # The easting coordinate of the collar, in meters (projected CRS)
    EASTING: float,
    # The northing coordinate of the collar, in meters (projected CRS)
    NORTHING: float,
    # The coordinate reference system of the collar coordinates for easting/northing, as an EPSG code or proj string
    CRS: str,
    # Collar ID which is often used as the joining ID within schema, as opposed to hole_id 
    COLLAR_ID: str,
    # hole type eg RAB, RC, Diamond, trench. The type of drilling.
    HOLE_TYPE: str,
    # Per-row dict of source-specific fields outside the canonical schema
    # (populated by `bundle_extras`; empty dict when the source had nothing extra).
    EXTRA: dict,
}

BASELODE_DATA_MODEL_DRILL_SURVEY = {
    # The unique hole id that maps to the collar and any other data tables
    HOLE_ID: str,
    # The depth along the hole where the survey measurement was taken / started
    DEPTH: float,
    # The depth along the hole where the survey measurement ended, if applicable (some surveys are point measurements and may not have a 'to' depth)
    TO: float,
    # The azimuth of the hole at the survey depth, in degrees from north
    AZIMUTH: float,
    # The dip of the hole at the survey depth, in degrees from horizontal (negative values indicate downward inclination)
    DIP: float,
    # Per-row dict of source-specific fields outside the canonical schema.
    EXTRA: dict,
}

# The GSWA Structure table has the following potential attributes for structure measurements:
# Alpha,Beta,Confidence,Defect,Defect_Width,Description,Dip,DipDir_Calc,
# DipDirect_calc,DipDrn,Dip_Calc,,Fill1,Fill2,FillPC,,Hole_Dip,Hole_Dip_2,Hole_Dir,Hole_dir_2,
# JWS,,Reliability,Rough,,StructComment,Structure,Type,a,alpha_2,beta_2,d

# Ignored as meta-data not structure data:
# Id,CollarId,FromDepth,ToDepth,HoleId,Geologist,Drill_code,PRIORITY,ProjectCode,Projectcode_2,Shape
BASELODE_DATA_MODEL_STRUCTURAL_POINT = {
    HOLE_ID: str,
    DEPTH: float,
    DIP: float,
    AZIMUTH: float,
    ALPHA: float,
    BETA: float,
    COMMENTS: str,
    # Per-row dict of source-specific fields outside the canonical schema.
    EXTRA: dict,
}

BASELODE_DATA_MODEL_DRILL_ASSAY = {
    # The unique hole id that maps to the collar and any other data tables
    HOLE_ID: str,
    # The depth along the hole where the assay interval starts
    FROM: float,
    # The depth along the hole where the assay interval ends
    TO: float,
    # The midpoint depth of the assay interval
    MID: float,
    # assay value columns are variable and not standardized here.
    # Assays may be flattened (one column per assay type) or long (one row per assay type with an additional 'assay_type' column)
    # Per-row dict of source-specific fields outside the canonical schema
    # (sample identifiers, lab metadata, detection-limit flags, etc.).
    EXTRA: dict,
}

BASELODE_DATA_MODEL_DRILL_GEOLOGY = {
    # The unique hole id that maps to the collar and any other data tables
    HOLE_ID: str,
    # The depth along the hole where the geology interval starts
    FROM: float,
    # The depth along the hole where the geology interval ends
    TO: float,
    # The midpoint depth of the geology interval
    MID: float,
    # Standardized lithology/geology code for categorical strip-log plotting
    GEOLOGY_CODE: str,
    # Per-row dict of source-specific fields outside the canonical schema.
    EXTRA: dict,
}

BASELODE_DATA_MODEL_GEOPHYSICS = {
    # The unique hole id that maps to the collar and any other data tables
    HOLE_ID: str,
    # The depth along the hole where the geophysics measurement interval starts
    FROM: float,
    # The depth along the hole where the geophysics measurement interval ends
    TO: float,
    # The midpoint depth of the measurement interval (computed)
    MID: float,
    # Value columns are variable and not standardized here (e.g. gamma, density, resistivity).
    # Null sentinels (e.g. -999.25 from LAS-derived sources) are replaced with NaN on load.
    # Per-row dict of source-specific fields outside the canonical schema.
    EXTRA: dict,
}



BASELODE_DATA_MODEL_SURFACE_SAMPLE = {
    SAMPLE_ID: str,
    DATASOURCE_SURFACE_SAMPLE_ID: str,
    REPORT_NUMBER: str,
    LATITUDE: float,
    LONGITUDE: float,
    ELEVATION: float,
    EASTING: float,
    NORTHING: float,
    CRS: str,
    SURFACE_SAMPLE_TYPE: str,
    # Per-row dict of source-specific fields outside the canonical schema
    # (analyte values, lab metadata, detection-limit flags, anumber, ...).
    EXTRA: dict,
}