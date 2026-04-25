# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd
"""SQL builders for the GSWA Postgres schema.

Each builder returns ``(sql, params)`` where ``sql`` is a parameterised
Postgres query and ``params`` is a dict keyed by named placeholder
(``%(hole_ids)s`` etc.). The caller runs the query against their own
GSWA database using their own client (typically psycopg +
``pandas.read_sql_query``).

The builders are deliberately conservative:

- They accept a few common filters (``hole_ids``, ``sample_ids``,
  ``analytes``, ``extent``) and let the caller add more by extending the
  WHERE clause if needed.
- They join the EAV ``*attr`` tables when relevant so that the convert
  layer receives long-format rows ready to pivot.
- They never mutate global state.

``extent`` accepts a :class:`baselode.extent.Extent` (any CRS — corners
get reprojected to WGS 84 via ``pyproj``). Bare 4-tuples are not
accepted; the explicit Extent makes the CRS unambiguous. Reprojection
failures raise rather than silently passing through.

Schema name
-----------

The same GSWA tables are deployed under different schema names in different
hosts (commonly ``raw_gswa`` and ``postgres_gswa``). Every builder accepts
an optional ``schema`` argument; when omitted, it falls back to
``DEFAULT_SCHEMA``. Override the global default once via
:func:`set_default_schema` if your project always uses a particular name.
"""

import re

import baselode.extent

DEFAULT_SCHEMA = "postgres_gswa"

# Postgres unquoted-identifier rule: leading letter or underscore, then
# letters / digits / underscores. We refuse anything outside this so the
# value is safe to interpolate into SQL via f-string.
_SAFE_IDENTIFIER = re.compile(r"\A[A-Za-z_][A-Za-z0-9_]*\Z")


def _validate_identifier(value, kind):
    """Reject anything that wouldn't survive ``f'{schema}.dbo_collar'`` cleanly.

    Raises ``ValueError`` for SQL-injection-prone inputs; returns ``value``
    unchanged on the happy path. ``kind`` is used in the error message
    (e.g. ``"schema"``, ``"analyte column"``).
    """
    if not isinstance(value, str) or not _SAFE_IDENTIFIER.match(value):
        raise ValueError(
            f"Invalid {kind} identifier {value!r}: must match "
            f"[A-Za-z_][A-Za-z0-9_]* (letters, digits, underscores; "
            "no quotes, dots, or whitespace)."
        )
    return value


def set_default_schema(name):
    """Set the schema name used by builders that don't pass ``schema=`` explicitly.

    Useful as a one-line setup at app startup when the deployment uses a
    schema other than the default ``postgres_gswa`` (e.g.
    ``set_default_schema("raw_gswa")`` for legacy deployments). The name
    is validated as a plain Postgres identifier — anything outside
    ``[A-Za-z_][A-Za-z0-9_]*`` is rejected to prevent SQL injection.
    """
    global DEFAULT_SCHEMA
    DEFAULT_SCHEMA = _validate_identifier(name, "schema")


def _schema(schema):
    return _validate_identifier(schema if schema else DEFAULT_SCHEMA, "schema")


# ----------------------------------------------------------------------- utils

def _extent_clause(extent, lon_col, lat_col, params):
    if extent is None:
        return ""
    if not isinstance(extent, baselode.extent.Extent):
        raise TypeError(
            f"extent must be a baselode.extent.Extent, got {type(extent).__name__}."
        )
    wgs84 = extent.to_crs("EPSG:4326")
    params.update({
        "bbox_min_lon": wgs84.xmin, "bbox_max_lon": wgs84.xmax,
        "bbox_min_lat": wgs84.ymin, "bbox_max_lat": wgs84.ymax,
    })
    return (
        f' AND {lon_col} BETWEEN %(bbox_min_lon)s AND %(bbox_max_lon)s'
        f' AND {lat_col} BETWEEN %(bbox_min_lat)s AND %(bbox_max_lat)s'
    )


def _in_clause(values, col, key, params):
    if not values:
        return ""
    params[key] = tuple(values)
    return f" AND {col} IN %({key})s"


# --------------------------------------------------------------------- collars

def build_collar_query(hole_ids=None, extent=None, limit=None, schema=None):
    """Fetch collar rows joined with their projected coordinate and elevation.

    Returns one row per collar with all columns required to assemble a baselode
    collar row via :func:`convert_collars`.
    """
    s = _schema(schema)
    params = {}
    sql = (
        'SELECT '
        '  c."Id" AS "CollarId", '
        '  c."HoleId", c."CompanyHoleId", c."Dataset", c."Anumber", '
        '  c."Latitude", c."Longitude", c."MaxDepth", c."HoleType", '
        '  cc."Easting", cc."Northing", cc."Datum", cc."Projection", cc."Zone", '
        '  ce."Elevation", ce."Elevation_UOM", ce."Height_Datum" '
        f'FROM {s}.dbo_collar c '
        f'LEFT JOIN {s}.dbo_collarcoordinate cc ON cc."CollarId" = c."Id" '
        f'LEFT JOIN {s}.dbo_collarelevation ce ON ce."CollarID" = c."Id" '
        'WHERE 1=1'
    )
    sql += _in_clause(list(hole_ids) if hole_ids else None, 'c."HoleId"', "hole_ids", params)
    sql += _extent_clause(extent, 'c."Longitude"', 'c."Latitude"', params)
    if limit is not None:
        params["limit"] = int(limit)
        sql += " LIMIT %(limit)s"
    return sql, params


# --------------------------------------------------------------------- surveys

def build_survey_query(hole_ids=None, extent=None, schema=None):
    """Fetch downhole surveys joined back to ``dbo_collar`` to expose ``HoleId``."""
    s = _schema(schema)
    params = {}
    sql = (
        'SELECT '
        '  c."HoleId", '
        '  s."CollarId", s."Depth", s."Dip", s."Azimuth" '
        f'FROM {s}.dbo_dhsurvey s '
        f'JOIN {s}.dbo_collar c ON c."Id" = s."CollarId" '
        'WHERE 1=1'
    )
    sql += _in_clause(list(hole_ids) if hole_ids else None, 'c."HoleId"', "hole_ids", params)
    sql += _extent_clause(extent, 'c."Longitude"', 'c."Latitude"', params)
    sql += ' ORDER BY c."HoleId", s."Depth"'
    return sql, params


# -------------------------------------------------------------------- geology

def build_geology_query(hole_ids=None, extent=None, attribute_columns=None, schema=None):
    """Fetch downhole lithology intervals with their EAV attributes (long form).

    The result is one row per (interval, attribute) pair. ``convert_geology``
    pivots this into wide baselode geology rows.

    ``attribute_columns`` lets the caller restrict the EAV pull to specific
    attributes (e.g. ``["Lith1", "GeologyComment", "Weath"]``) — useful given
    the EAV table is huge.
    """
    s = _schema(schema)
    params = {}
    sql = (
        'SELECT '
        '  c."HoleId", '
        '  g."Id" AS "DHGeologyId", g."CollarId", '
        '  g."FromDepth", g."ToDepth", '
        '  a."AttributeColumn", a."AttributeValue" '
        f'FROM {s}.dbo_dhgeology g '
        f'JOIN {s}.dbo_collar c ON c."Id" = g."CollarId" '
        f'LEFT JOIN {s}.dbo_dhgeologyattr a ON a."DHGeologyId" = g."Id" '
        'WHERE 1=1'
    )
    sql += _in_clause(list(hole_ids) if hole_ids else None, 'c."HoleId"', "hole_ids", params)
    sql += _in_clause(
        list(attribute_columns) if attribute_columns else None,
        'a."AttributeColumn"', "attribute_columns", params,
    )
    sql += _extent_clause(extent, 'c."Longitude"', 'c."Latitude"', params)
    sql += ' ORDER BY c."HoleId", g."FromDepth"'
    return sql, params


# ---------------------------------------------------------------------- assays

def build_assay_query(hole_ids=None, analytes=None, extent=None,
                      only_with_value=True, schema=None):
    """Fetch geochemistry sample intervals joined with EAV assay results.

    Returns long-format rows (one row per analyte). Pivot to wide baselode
    assays via :func:`convert_assays`.

    Set ``only_with_value=True`` (default) to drop rows where ``PPMValue`` is
    NULL — useful since the EAV table is mostly sparse.
    """
    s = _schema(schema)
    params = {}
    sql = (
        'SELECT '
        '  c."HoleId", '
        '  s."Id" AS "DHGeochemistryId", s."CollarId", '
        '  s."SampleId", s."CompanySampleId", '
        '  s."FromDepth", s."ToDepth", '
        '  a."AttributeColumn", a."AttributeValue", a."PPMValue", '
        '  a."Flag_LT", a."Flag_GT", a."Flag_PCT", a."Flag_BadDataValue", '
        '  a."Flag_KnownNoDataValue", a."Flag_ValidLessThanDetectionLevel" '
        f'FROM {s}.dbo_dhgeochemistry s '
        f'JOIN {s}.dbo_collar c ON c."Id" = s."CollarId" '
        f'LEFT JOIN {s}.dbo_dhgeochemistryattr a ON a."DHGeochemistryId" = s."Id" '
        'WHERE 1=1'
    )
    if only_with_value:
        sql += ' AND a."PPMValue" IS NOT NULL'
    sql += _in_clause(list(hole_ids) if hole_ids else None, 'c."HoleId"', "hole_ids", params)
    sql += _in_clause(
        list(analytes) if analytes else None,
        'a."AttributeColumn"', "analytes", params,
    )
    sql += _extent_clause(extent, 'c."Longitude"', 'c."Latitude"', params)
    sql += ' ORDER BY c."HoleId", s."FromDepth", a."AttributeColumn"'
    return sql, params


def build_assay_flat_query(hole_ids=None, extent=None, analyte_columns=None, schema=None):
    """Fetch the GSWA derived flat downhole-assay table ``gsd_dhassayflat``.

    This table is already pivoted (one row per interval, one column per
    analyte ``Au_PPM``, ``Cu_PPM``, etc.) and is the recommended path for
    most assay use cases. Use :func:`convert_assays_flat` to map to baselode.
    """
    s = _schema(schema)
    params = {}
    if analyte_columns:
        # Quote each requested column. Always include the base interval columns.
        cols = ['Id', 'HoleId', 'Collarid', 'CompanyHoleId', 'Anumber',
                'Latitude', 'Longitude', 'FromDepth', 'ToDepth', 'Dip', 'Azimuth',
                'HoleType', 'Elevation']
        cols.extend(_validate_identifier(c, "analyte column") for c in analyte_columns)
        select = ", ".join(f'"{c}"' for c in cols)
    else:
        select = "*"
    sql = (
        f'SELECT {select} FROM {s}.gsd_dhassayflat WHERE 1=1'
    )
    sql += _in_clause(list(hole_ids) if hole_ids else None, '"HoleId"', "hole_ids", params)
    sql += _extent_clause(extent, '"Longitude"', '"Latitude"', params)
    sql += ' ORDER BY "HoleId", "FromDepth"'
    return sql, params


# ------------------------------------------------------------------ structure

def build_structure_query(hole_ids=None, extent=None, attribute_columns=None, schema=None):
    """Fetch downhole structural intervals + EAV attributes (long form).

    Pivot to baselode structural-point rows via :func:`convert_structures`.
    """
    s = _schema(schema)
    params = {}
    sql = (
        'SELECT '
        '  c."HoleId", '
        '  st."Id" AS "DHStructureId", st."CollarId", '
        '  st."FromDepth", st."ToDepth", '
        '  a."AttributeColumn", a."AttributeValue" '
        f'FROM {s}.dbo_dhstructure st '
        f'JOIN {s}.dbo_collar c ON c."Id" = st."CollarId" '
        f'LEFT JOIN {s}.dbo_dhstructureattr a ON a."DHStructureId" = st."Id" '
        'WHERE 1=1'
    )
    sql += _in_clause(list(hole_ids) if hole_ids else None, 'c."HoleId"', "hole_ids", params)
    sql += _in_clause(
        list(attribute_columns) if attribute_columns else None,
        'a."AttributeColumn"', "attribute_columns", params,
    )
    sql += _extent_clause(extent, 'c."Longitude"', 'c."Latitude"', params)
    sql += ' ORDER BY c."HoleId", st."FromDepth"'
    return sql, params


# -------------------------------------------------------------- surface samples

def build_surface_sample_query(sample_ids=None, extent=None, analytes=None,
                               only_with_value=True, schema=None):
    """Fetch surface samples + projected coordinates + EAV assay results.

    Long-format rows (one row per analyte per sample). Pivot via
    :func:`convert_surface_samples`.
    """
    s = _schema(schema)
    params = {}
    sql = (
        'SELECT '
        '  ss."Id" AS "Id", ss."SampleId", ss."CompanySampleId", '
        '  ss."Dataset", ss."Anumber", ss."SurfaceSampleType", '
        '  ss."Latitude", ss."Longitude", '
        '  sc."Easting", sc."Northing", sc."Datum", sc."Projection", sc."Zone", '
        '  a."AttributeColumn", a."AttributeValue", a."PPMValue", '
        '  a."Flag_LT", a."Flag_GT", a."Flag_PCT", a."Units", '
        '  a."Laboratory", a."LabMethod" '
        f'FROM {s}.dbo_surfacesample ss '
        f'LEFT JOIN {s}.dbo_surfacesamplecoordinate sc ON sc."SurfaceSampleId" = ss."Id" '
        f'LEFT JOIN {s}.dbo_surfacesampleattr a ON a."SurfaceSampleId" = ss."Id" '
        'WHERE 1=1'
    )
    if only_with_value:
        sql += ' AND a."PPMValue" IS NOT NULL'
    sql += _in_clause(list(sample_ids) if sample_ids else None, 'ss."SampleId"', "sample_ids", params)
    sql += _in_clause(
        list(analytes) if analytes else None,
        'a."AttributeColumn"', "analytes", params,
    )
    sql += _extent_clause(extent, 'ss."Longitude"', 'ss."Latitude"', params)
    sql += ' ORDER BY ss."Id", a."AttributeColumn"'
    return sql, params


def build_surface_sample_assay_flat_query(sample_ids=None, extent=None,
                                          analyte_columns=None, schema=None):
    """Fetch the GSWA derived flat surface-assay table ``gsd_ssassayflat``.

    Already pivoted (one row per surface sample, one column per analyte).
    Use :func:`convert_surface_samples_flat` to map to baselode.
    """
    s = _schema(schema)
    params = {}
    if analyte_columns:
        cols = ['Id', 'SurfaceSampleId', 'CompanySampleId', 'Dataset', 'Anumber',
                'Latitude', 'Longitude', 'SurfaceSampleType', 'Elevation']
        cols.extend(_validate_identifier(c, "analyte column") for c in analyte_columns)
        select = ", ".join(f'"{c}"' for c in cols)
    else:
        select = "*"
    sql = f'SELECT {select} FROM {s}.gsd_ssassayflat WHERE 1=1'
    sql += _in_clause(
        list(sample_ids) if sample_ids else None,
        '"CompanySampleId"', "sample_ids", params,
    )
    sql += _extent_clause(extent, '"Longitude"', '"Latitude"', params)
    sql += ' ORDER BY "Id"'
    return sql, params
