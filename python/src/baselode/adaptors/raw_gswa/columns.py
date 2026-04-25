# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd
"""Column-name constants and mappings between the GSWA ``raw_gswa`` schema
and the baselode canonical data model.

The GSWA schema preserves the original PascalCase column names (e.g.
``HoleId``, ``FromDepth``). The baselode model uses snake_case (e.g.
``hole_id``, ``from``). These maps are the source of truth for renaming
raw query results.
"""

from baselode.datamodel import (
    ALPHA,
    AZIMUTH,
    BETA,
    COLLAR_ID,
    COMMENTS,
    CRS,
    DATASOURCE_HOLE_ID,
    DATASOURCE_SURFACE_SAMPLE_ID,
    DATASOURCE_SAMPLE_ID,
    DEPTH,
    DIP,
    EASTING,
    ELEVATION,
    EXTRA,
    FROM,
    HOLE_ID,
    HOLE_TYPE,
    LATITUDE,
    LONGITUDE,
    MAX_DEPTH,
    NORTHING,
    PROJECT_ID,
    REPORT_NUMBER,
    SAMPLE_ID,
    SURFACE_SAMPLE_TYPE,
    TO,
)


# ---------------------------------------------------------------------------
# Collar mapping  (dbo_collar + dbo_collarcoordinate + dbo_collarelevation)
# ---------------------------------------------------------------------------
# The collar baselode row is assembled from three raw tables joined on
# CollarId. We map every raw column we want to keep to its baselode name;
# unmapped columns are dropped by ``convert_collars``.


GSWA_RAW_TO_BASELODE_COLLAR = {
    # dbo_collar
    # `Id` (table-row endpoint) and `CollarId` (post-`_merge_collar_family`
    # alias from the SQL builder shape) both become the internal
    # `_collar_id` join key. This map is collar-scoped, so the otherwise
    # ambiguous `Id` is unambiguously the collar primary key here.
    "Id": COLLAR_ID,
    "CollarId": COLLAR_ID,
    "HoleId": HOLE_ID,
    "CompanyHoleId": DATASOURCE_HOLE_ID,
    "Dataset": PROJECT_ID,
    "Latitude": LATITUDE,
    "Longitude": LONGITUDE,
    "MaxDepth": MAX_DEPTH,
    "HoleType": HOLE_TYPE,
    "Anumber": REPORT_NUMBER,
    # dbo_collarcoordinate
    "Easting": EASTING,
    "Northing": NORTHING,
    "Datum": "datum",
    "Projection": "projection",
    "Zone": "zone",
    # dbo_collarelevation
    "Elevation": ELEVATION,
    "Elevation_UOM": "elevation_uom",
    "Height_Datum": "height_datum",
}


# ---------------------------------------------------------------------------
# Survey mapping (dbo_dhsurvey)
# ---------------------------------------------------------------------------

GSWA_RAW_TO_BASELODE_SURVEY = {
    "HoleId": HOLE_ID,           # only present when joined back to dbo_collar
    "CollarId": COLLAR_ID,     # internal join key, dropped in convert
    "Depth": DEPTH,
    "Dip": DIP,
    "Azimuth": AZIMUTH,
}


# ---------------------------------------------------------------------------
# Downhole interval mapping  (dbo_dhgeology / dbo_dhgeochemistry /
# dbo_dhstructure / gsd_dhassayflat)
# ---------------------------------------------------------------------------

GSWA_RAW_TO_BASELODE_INTERVAL = {
    "HoleId": HOLE_ID,
    "CollarId": COLLAR_ID,
    "Collarid": COLLAR_ID,         # gsd_dhassayflat uses lower-case 'id'
    "FromDepth": FROM,
    "ToDepth": TO,
    # geochem-specific
    "SampleId": SAMPLE_ID,
    "CompanySampleId": DATASOURCE_SAMPLE_ID,
    # geophys / geology metadata occasionally surfaced
    "Units": "units",
}


# ---------------------------------------------------------------------------
# Structure EAV attributes -> baselode structural-point columns
# ---------------------------------------------------------------------------
# The dbo_dhstructureattr EAV table has a fixed vocabulary of attribute
# columns; we map the orientation-bearing ones onto the baselode structural-
# point model and surface free-text fields under ``comments``.
GSWA_STRUCTURE_ATTR_TO_BASELODE = {
    "Dip": DIP,
    "DipDrn": AZIMUTH,
    "DipDir_Calc": AZIMUTH,
    "DipDirect_calc": AZIMUTH,
    "Dip_Calc": DIP,
    "Alpha": ALPHA,
    "alpha_2": ALPHA,
    "a": ALPHA,
    "Beta": BETA,
    "beta_2": BETA,
    "Description": COMMENTS,
    "StructComment": COMMENTS,
}


# ---------------------------------------------------------------------------
# Geology EAV attributes -> baselode columns
# ---------------------------------------------------------------------------
# The dbo_dhgeologyattr EAV table is open-ended (companies submit different
# columns), but the most common ``Lith1`` / ``GeologyComment`` fields map
# directly to the baselode geology model.
GSWA_GEOLOGY_ATTR_TO_BASELODE = {
    "GeologyComment": COMMENTS,
    "Geology_Comment": COMMENTS,
    "Description": COMMENTS,
}


# ---------------------------------------------------------------------------
# Surface sample mapping
# (dbo_surfacesample + dbo_surfacesamplecoordinate + gsd_ssassayflat)
# ---------------------------------------------------------------------------

GSWA_RAW_TO_BASELODE_SURFACE_SAMPLE = {
    # dbo_surfacesample
    "Id": SAMPLE_ID,
    "SampleId": SAMPLE_ID,
    "CompanySampleId": DATASOURCE_SURFACE_SAMPLE_ID,
    "Dataset": PROJECT_ID,
    "Latitude": LATITUDE,
    "Longitude": LONGITUDE,
    "SurfaceSampleType": SURFACE_SAMPLE_TYPE,
    "Anumber": REPORT_NUMBER,
    # dbo_surfacesamplecoordinate
    "Easting": EASTING,
    "Northing": NORTHING,
    "Datum": "datum",
    "Projection": "projection",
    "Zone": "zone",
    # gsd_ssassayflat may include
    "Elevation": ELEVATION,
}
