# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd

"""Tests for the raw_gswa -> baselode adaptor.

The drill-shape sample CSVs in ``test/data/gswa/`` already match the GSWA
table column names (PascalCase, ``HoleId``/``FromDepth``/``Anumber``/...),
so we can feed them straight through the converters without spinning up a
Postgres mock.
"""

from pathlib import Path

import pandas as pd
import pytest

import baselode.drill.data
import baselode.adaptors.raw_gswa.queries
import baselode.adaptors.raw_gswa.convert
import baselode.adaptors.raw_gswa.api
from baselode.datamodel import (
    HOLE_ID, FROM, TO, MID, DEPTH, AZIMUTH, DIP,
    LATITUDE, LONGITUDE, ELEVATION, EXTRA,
    SAMPLE_ID,
    DATASOURCE_SAMPLE_ID,
    DATASOURCE_SURFACE_SAMPLE_ID,
    SURFACE_SAMPLE_TYPE,
    BASELODE_DATA_MODEL_SURFACE_SAMPLE,
)


GSWA = Path(__file__).resolve().parent / "data" / "gswa"


# --------------------------------------------------------------- query builders

def test_build_collar_query_with_holes_and_extent():
    import baselode.extent
    sql, params = baselode.adaptors.raw_gswa.queries.build_collar_query(
        hole_ids=["DD123", "DD456"],
        extent=baselode.extent.Extent(
            xmin=118.0, xmax=122.0, ymin=-32.0, ymax=-28.0,
        ),
        limit=10,
    )
    # Default schema is postgres_gswa.
    assert "postgres_gswa.dbo_collar" in sql
    assert "LEFT JOIN postgres_gswa.dbo_collarcoordinate" in sql
    assert "LEFT JOIN postgres_gswa.dbo_collarelevation" in sql
    assert "%(hole_ids)s" in sql
    assert "%(bbox_min_lon)s" in sql
    assert "%(limit)s" in sql
    assert params["hole_ids"] == ("DD123", "DD456")
    assert params["bbox_min_lon"] == 118.0


def test_build_assay_query_includes_eav_and_filters():
    sql, params = baselode.adaptors.raw_gswa.queries.build_assay_query(
        hole_ids=["X"], analytes=["Au", "Cu"], only_with_value=True,
    )
    assert "postgres_gswa.dbo_dhgeochemistry" in sql
    assert "postgres_gswa.dbo_dhgeochemistryattr" in sql
    assert '"PPMValue" IS NOT NULL' in sql
    assert "%(analytes)s" in sql
    assert params["analytes"] == ("Au", "Cu")


def test_build_surface_sample_query_joins_three_tables():
    sql, _ = baselode.adaptors.raw_gswa.queries.build_surface_sample_query()
    assert "postgres_gswa.dbo_surfacesample " in sql
    assert "postgres_gswa.dbo_surfacesamplecoordinate" in sql
    assert "postgres_gswa.dbo_surfacesampleattr" in sql


# --------------------------------------------------------------- convert_collars

def test_convert_collars_from_sample_csv_default_bundles_extras():
    raw = pd.read_csv(GSWA / "gswa_sample_collars.csv")
    collars = baselode.adaptors.raw_gswa.convert.convert_collars(raw)
    # Canonical columns always at top level (per BASELODE_DATA_MODEL_DRILL_COLLAR).
    # `hole_type` is part of the canonical model now, so it stays top-level.
    for col in (HOLE_ID, LATITUDE, LONGITUDE, ELEVATION,
                "datasource_hole_id", "hole_type", EXTRA, "geometry"):
        assert col in collars.columns
    # GSWA-only columns NOT in the canonical model live inside the `extra` dict.
    for col in ("max_depth", "report_number", "elevation_uom"):
        assert col not in collars.columns
    sample_extra = collars.iloc[0][EXTRA]
    assert isinstance(sample_extra, dict)
    assert "max_depth" in sample_extra
    assert "report_number" in sample_extra
    assert collars[HOLE_ID].notna().all()


def test_convert_collars_extras_spread_keeps_legacy_shape():
    raw = pd.read_csv(GSWA / "gswa_sample_collars.csv")
    collars = baselode.adaptors.raw_gswa.convert.convert_collars(raw, extras="spread")
    # In spread mode the GSWA-only columns sit alongside the canonical set.
    assert "max_depth" in collars.columns
    assert "hole_type" in collars.columns
    # No extra dict column when spreading.
    assert EXTRA not in collars.columns


def test_convert_collars_extras_drop_strips_non_canonical():
    raw = pd.read_csv(GSWA / "gswa_sample_collars.csv")
    collars = baselode.adaptors.raw_gswa.convert.convert_collars(raw, extras="drop")
    canonical = set(baselode.drill.data.BASELODE_DATA_MODEL_DRILL_COLLAR.keys())
    leftover = set(collars.columns) - canonical - {"geometry"}
    assert leftover == set()
    assert EXTRA not in collars.columns


def test_convert_collars_handles_empty():
    out = baselode.adaptors.raw_gswa.convert.convert_collars(pd.DataFrame())
    assert HOLE_ID in out.columns
    assert EXTRA in out.columns
    assert len(out) == 0


# --------------------------------------------------------------- convert_surveys

def test_convert_surveys_from_sample_csv():
    raw = pd.read_csv(GSWA / "gswa_sample_survey.csv")
    surveys = baselode.adaptors.raw_gswa.convert.convert_surveys(raw)
    for col in (HOLE_ID, DEPTH, AZIMUTH, DIP, EXTRA):
        assert col in surveys.columns
    # CollarId should not leak through (mapped to internal _collar_id then dropped).
    assert "_collar_id" not in surveys.columns
    assert "CollarId" not in surveys.columns
    # GSWA metadata columns end up in the extra dict, not at the top level.
    assert "Units" not in surveys.columns and "ModifiedBy" not in surveys.columns
    sample_extra = surveys.iloc[0][EXTRA]
    assert isinstance(sample_extra, dict)
    # Sorted by hole, depth.
    assert surveys.equals(surveys.sort_values([HOLE_ID, DEPTH]))


# --------------------------------------------------------------- convert_assays_flat

def test_convert_assays_flat_from_sample_csv():
    raw = pd.read_csv(GSWA / "gswa_sample_assays.csv")
    # In bundle mode (default) analyte columns end up inside `extra`.
    # Note: `load_table.standardize_columns` lowercases all column names,
    # so analytes appear in extras as e.g. ``"au_ppm"``, not ``"Au_PPM"``.
    assays = baselode.adaptors.raw_gswa.convert.convert_assays_flat(raw)
    for col in (HOLE_ID, FROM, TO, MID, EXTRA):
        assert col in assays.columns
    assert "Au_PPM" not in assays.columns and "au_ppm" not in assays.columns
    assert "au_ppm" in assays.iloc[0][EXTRA]
    assert (assays[TO] >= assays[FROM]).all()
    assert ((assays[MID] - 0.5 * (assays[FROM] + assays[TO])).abs() < 1e-9).all()


def test_convert_assays_flat_extras_spread_keeps_analytes_top_level():
    raw = pd.read_csv(GSWA / "gswa_sample_assays.csv")
    assays = baselode.adaptors.raw_gswa.convert.convert_assays_flat(raw, extras="spread")
    # Column names are lowercased by `standardize_columns` during load.
    assert "au_ppm" in assays.columns
    assert EXTRA not in assays.columns


# ----------------------------------------------------------- convert_assays (EAV)

def test_convert_assays_eav_pivots_attributes_into_extras():
    raw = pd.DataFrame({
        "HoleId":            ["H1", "H1", "H1", "H1"],
        "DHGeochemistryId":  [10,    10,    11,    11],
        "CollarId":          [1, 1, 1, 1],
        "SampleId":          ["S10", "S10", "S11", "S11"],
        "FromDepth":         [0.0, 0.0, 1.0, 1.0],
        "ToDepth":           [1.0, 1.0, 2.0, 2.0],
        "AttributeColumn":   ["Au", "Cu", "Au", "Cu"],
        "AttributeValue":    ["0.05", "120", "0.30", "85"],
        "PPMValue":          [0.05, 120.0, 0.30, 85.0],
    })
    out = baselode.adaptors.raw_gswa.convert.convert_assays(raw)
    # Default 'bundle' mode: analytes flow into extras.
    # `standardize_columns` lowercases column names, so analytes appear in
    # the extra dict as ``"au"`` / ``"cu"``, not ``"Au"`` / ``"Cu"``.
    assert "Au" not in out.columns and "Cu" not in out.columns
    assert "au" not in out.columns and "cu" not in out.columns
    assert HOLE_ID in out.columns and MID in out.columns and EXTRA in out.columns
    assert len(out) == 2
    by_from = out.set_index(FROM).sort_index()
    assert pytest.approx(0.05) == by_from.loc[0.0, EXTRA]["au"]
    assert pytest.approx(85.0) == by_from.loc[1.0, EXTRA]["cu"]


def test_convert_assays_eav_extras_spread_keeps_analyte_columns():
    raw = pd.DataFrame({
        "HoleId":            ["H1", "H1"],
        "DHGeochemistryId":  [10, 10],
        "CollarId":          [1, 1],
        "SampleId":          ["S10", "S10"],
        "FromDepth":         [0.0, 0.0],
        "ToDepth":           [1.0, 1.0],
        "AttributeColumn":   ["Au", "Cu"],
        "AttributeValue":    ["0.05", "120"],
        "PPMValue":          [0.05, 120.0],
    })
    out = baselode.adaptors.raw_gswa.convert.convert_assays(raw, extras="spread")
    # Column names are lowercased by `standardize_columns`.
    assert "au" in out.columns and "cu" in out.columns


# --------------------------------------------------------------- convert_geology

def test_convert_geology_eav_pivots_lithology_and_comment():
    raw = pd.DataFrame({
        "HoleId":          ["H1", "H1", "H1"],
        "DHGeologyId":     [1, 1, 2],
        "CollarId":        [10, 10, 10],
        "FromDepth":       [0.0, 0.0, 1.0],
        "ToDepth":         [1.0, 1.0, 2.0],
        "AttributeColumn": ["Lith1", "GeologyComment", "Lith1"],
        "AttributeValue":  ["GRA", "fresh granite", "BIF"],
    })
    out = baselode.adaptors.raw_gswa.convert.convert_geology(raw)
    # `geology_code` is in BASELODE_DATA_MODEL_DRILL_GEOLOGY → top-level.
    # `comments` is NOT in the canonical geology model → folded into extras.
    assert HOLE_ID in out.columns
    assert "geology_code" in out.columns
    assert "comments" not in out.columns
    assert EXTRA in out.columns
    assert sorted(out["geology_code"].tolist()) == ["BIF", "GRA"]
    by_from = out.set_index(FROM).sort_index()
    assert by_from.loc[0.0, EXTRA].get("comments") == "fresh granite"


# ------------------------------------------------------------- convert_structures

def test_convert_structures_eav_collapses_interval_to_depth():
    raw = pd.DataFrame({
        "HoleId":          ["H1", "H1"],
        "DHStructureId":   [1, 1],
        "CollarId":        [10, 10],
        "FromDepth":       [50.0, 50.0],
        "ToDepth":         [50.0, 50.0],
        "AttributeColumn": ["Dip", "DipDrn"],
        "AttributeValue":  ["45", "270"],
    })
    out = baselode.adaptors.raw_gswa.convert.convert_structures(raw)
    assert HOLE_ID in out.columns
    assert DEPTH in out.columns
    assert DIP in out.columns
    assert AZIMUTH in out.columns
    # Coerced to numeric by load_structures.
    assert float(out.iloc[0][DIP]) == 45.0
    assert float(out.iloc[0][AZIMUTH]) == 270.0


# ------------------------------------------------------------ surface samples

def _surface_sample_eav_fixture():
    return pd.DataFrame({
        "Id":                 [101, 101, 102, 102],
        "SampleId":           ["GSWA001", "GSWA001", "GSWA002", "GSWA002"],
        "CompanySampleId":    ["A1",      "A1",      "B1",      "B1"],
        "Dataset":            ["DS1",     "DS1",     "DS1",     "DS1"],
        "Anumber":            [10000,     10000,     10000,     10000],
        "SurfaceSampleType":  ["Rock",    "Rock",    "Soil",    "Soil"],
        "Latitude":           [-32.1,     -32.1,     -32.2,     -32.2],
        "Longitude":          [120.5,     120.5,     120.6,     120.6],
        "Easting":            [550000,    550000,    560000,    560000],
        "Northing":           [6450000,   6450000,   6440000,   6440000],
        "Datum":              ["GDA94"]*4,
        "Projection":         ["MGA"]*4,
        "Zone":               ["51", "51", "51", "51"],
        "AttributeColumn":    ["Au", "Cu", "Au", "Cu"],
        "AttributeValue":     ["0.5", "200", "0.1", "55"],
        "PPMValue":           [0.5, 200.0, 0.1, 55.0],
    })


def test_convert_surface_samples_pivots_and_resolves_crs():
    out = baselode.adaptors.raw_gswa.convert.convert_surface_samples(_surface_sample_eav_fixture())
    for col in (SAMPLE_ID, DATASOURCE_SURFACE_SAMPLE_ID, SURFACE_SAMPLE_TYPE, EXTRA):
        assert col in out.columns
    # Default 'bundle' mode → analytes live inside extras.
    assert "Au" not in out.columns and "Cu" not in out.columns
    assert "Au" in out.iloc[0][EXTRA]
    assert "Cu" in out.iloc[0][EXTRA]
    assert len(out) == 2
    assert (out["crs"] == "EPSG:28351").all()


def test_convert_surface_samples_extras_drop_strips_non_canonical():
    out = baselode.adaptors.raw_gswa.convert.convert_surface_samples(_surface_sample_eav_fixture(),
                                           extras="drop")
    canonical = set(BASELODE_DATA_MODEL_SURFACE_SAMPLE.keys())
    leftover = set(out.columns) - canonical
    assert leftover == set()
    assert EXTRA not in out.columns


def test_convert_surface_samples_extras_spread_keeps_analyte_columns():
    out = baselode.adaptors.raw_gswa.convert.convert_surface_samples(_surface_sample_eav_fixture(),
                                           extras="spread")
    assert "Au" in out.columns and "Cu" in out.columns
    assert EXTRA not in out.columns


def test_convert_surface_samples_gswa_id_goes_to_datasource_sample_id():
    """GSWA raw ``Id`` maps to datasource_sample_id; ``SampleId`` maps to sample_id."""
    out = baselode.adaptors.raw_gswa.convert.convert_surface_samples(
        _surface_sample_eav_fixture(), extras="spread"
    )
    assert SAMPLE_ID in out.columns
    assert out[SAMPLE_ID].tolist() == ["GSWA001", "GSWA002"]
    # Internal GSWA row Id should land in datasource_sample_id (top-level in spread mode).
    assert DATASOURCE_SAMPLE_ID in out.columns
    assert out[DATASOURCE_SAMPLE_ID].astype(str).tolist() == ["101", "102"]


def test_surface_sample_postprocess_backfills_sample_id_from_company_id():
    """When input has no SampleId (flat-table shape), sample_id falls back to CompanySampleId."""
    flat = pd.DataFrame({
        "Id":             [1, 2],
        "CompanySampleId": ["C1", "C2"],
        "Latitude":       [-32.1, -32.2],
        "Longitude":      [120.5, 120.6],
        "SurfaceSampleType": ["Rock", "Soil"],
    })
    out = baselode.adaptors.raw_gswa.convert.convert_surface_samples_flat(flat)
    assert out[SAMPLE_ID].tolist() == ["C1", "C2"]
    assert out[DATASOURCE_SURFACE_SAMPLE_ID].tolist() == ["C1", "C2"]


def test_surface_sample_postprocess_backfills_sample_id_from_datasource_id():
    """When input has neither SampleId nor CompanySampleId, sample_id falls back to Id."""
    flat = pd.DataFrame({
        "Id":             [10, 20],
        "Latitude":       [-32.1, -32.2],
        "Longitude":      [120.5, 120.6],
        "SurfaceSampleType": ["Rock", "Soil"],
    })
    out = baselode.adaptors.raw_gswa.convert.convert_surface_samples_flat(flat)
    assert out[SAMPLE_ID].tolist() == ["10", "20"]


# ------------------------------------------------------------ pivot_eav helper

def test_pivot_eav_handles_zero_attribute_parents():
    long_df = pd.DataFrame({
        "ParentId":        [1, 1, 2],
        "Other":           ["a", "a", "b"],
        "AttributeColumn": ["x", "y", None],
        "AttributeValue":  ["1", "2", None],
    })
    pivoted = baselode.adaptors.raw_gswa.convert.pivot_eav(long_df, parent_key="ParentId")
    assert sorted(pivoted["ParentId"].tolist()) == [1, 2]
    row1 = pivoted[pivoted["ParentId"] == 1].iloc[0]
    assert row1["x"] == "1" and row1["y"] == "2"


# ------------------------------------------------------------ schema config

def test_default_schema_is_postgres_gswa():
    assert baselode.adaptors.raw_gswa.queries.DEFAULT_SCHEMA == "postgres_gswa"


def test_default_schema_can_be_overridden_per_call():
    sql, _ = baselode.adaptors.raw_gswa.queries.build_collar_query(
        hole_ids=["X"], schema="raw_gswa",
    )
    assert "raw_gswa.dbo_collar" in sql
    # Default (postgres_gswa) must not leak in when an override is provided.
    assert "postgres_gswa." not in sql


def test_default_schema_can_be_set_globally():
    original = baselode.adaptors.raw_gswa.queries.DEFAULT_SCHEMA
    try:
        baselode.adaptors.raw_gswa.queries.set_default_schema("my_custom_schema")
        sql, _ = baselode.adaptors.raw_gswa.queries.build_survey_query(hole_ids=["X"])
        assert "my_custom_schema.dbo_dhsurvey" in sql
        assert "my_custom_schema.dbo_collar" in sql
        assert "postgres_gswa." not in sql
    finally:
        baselode.adaptors.raw_gswa.queries.set_default_schema(original)


def test_every_builder_threads_schema_through():
    builders = [
        baselode.adaptors.raw_gswa.queries.build_collar_query,
        baselode.adaptors.raw_gswa.queries.build_survey_query,
        baselode.adaptors.raw_gswa.queries.build_geology_query,
        baselode.adaptors.raw_gswa.queries.build_assay_query,
        baselode.adaptors.raw_gswa.queries.build_assay_flat_query,
        baselode.adaptors.raw_gswa.queries.build_structure_query,
        baselode.adaptors.raw_gswa.queries.build_surface_sample_query,
        baselode.adaptors.raw_gswa.queries.build_surface_sample_assay_flat_query,
    ]
    for fn in builders:
        sql, _ = fn(schema="my_custom_schema")
        assert "my_custom_schema." in sql, f"{fn.__name__} ignored schema="
        # Neither the current default nor the historical raw_gswa string
        # should leak through when an explicit schema= override is given.
        assert "postgres_gswa." not in sql, f"{fn.__name__} leaked default schema"
        assert "raw_gswa." not in sql, f"{fn.__name__} leaked legacy schema literal"


@pytest.mark.parametrize("bad_schema", [
    "raw_gswa; DROP TABLE dbo_collar; --",
    'foo"; SELECT 1; --',
    "foo bar",       # whitespace
    "foo.bar",       # dot
    "1stschema",     # leading digit
])
def test_schema_arg_rejects_sql_injection_attempts(bad_schema):
    """``_schema`` validates against ``[A-Za-z_][A-Za-z0-9_]*`` so the value
    is safe to interpolate via f-string.

    Note: empty string and ``None`` are intentionally treated as "use
    DEFAULT_SCHEMA" by the falsy check in ``_schema()``, so they don't raise.
    """
    with pytest.raises(ValueError, match="Invalid schema identifier"):
        baselode.adaptors.raw_gswa.queries.build_collar_query(
            hole_ids=["X"], schema=bad_schema,
        )


def test_set_default_schema_rejects_invalid_identifier():
    with pytest.raises(ValueError, match="Invalid schema identifier"):
        baselode.adaptors.raw_gswa.queries.set_default_schema(
            "foo; DROP TABLE dbo_collar; --"
        )


@pytest.mark.parametrize("bad_col", [
    'Au_PPM"; DROP TABLE x; --',
    "foo bar",
    "foo.bar",
    "",
])
def test_analyte_columns_arg_rejects_sql_injection_attempts(bad_col):
    """``analyte_columns`` values are interpolated into the SELECT list, so
    they go through the same identifier validator as ``schema``.
    """
    with pytest.raises(ValueError, match="Invalid analyte column identifier"):
        baselode.adaptors.raw_gswa.queries.build_assay_flat_query(
            analyte_columns=["Au_PPM", bad_col],
        )


# --------------------------------------------------------- HTTP API client

class _FakeResponse:
    def __init__(self, json_body, status=200):
        self._body = json_body
        self.status_code = status
    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")
    def json(self):
        return self._body


class _FakeSession:
    """Minimal stand-in for requests.Session that records calls and returns canned bodies."""
    def __init__(self):
        self.headers = {}
        self.calls = []      # list of (url, params)
        self.responses = []  # list of dicts to return in order
    def queue(self, body):
        self.responses.append(body)
        return self
    def get(self, url, params=None, timeout=None):
        self.calls.append((url, dict(params or {})))
        if not self.responses:
            raise AssertionError(f"No queued response for GET {url}?{params}")
        return _FakeResponse(self.responses.pop(0))


def _client(session):
    return baselode.adaptors.raw_gswa.api.RawGswaApiClient("https://api.example.com", session=session)


def test_api_client_list_tables_calls_correct_url():
    s = _FakeSession().queue({"tables": [{"name": "dbo_collar"}]})
    out = _client(s).list_tables()
    assert s.calls[0][0] == "https://api.example.com/v1/raw/gswa/tables"
    assert out == [{"name": "dbo_collar"}]


def test_api_client_get_schema_uses_table_path():
    s = _FakeSession().queue({"name": "dbo_collar", "columns": []})
    out = _client(s).get_schema("dbo_collar")
    assert s.calls[0][0].endswith("/tables/dbo_collar/schema")
    assert out["name"] == "dbo_collar"


def test_api_client_fetch_table_rows_returns_dataframe_with_documented_columns():
    s = _FakeSession().queue({
        "table": "dbo_collar", "total_rows": 1, "limit": 1, "offset": 0,
        "columns": ["Id", "HoleId", "Latitude", "Longitude"],
        "rows": [{"Id": 1, "HoleId": "H1", "Latitude": -32.0, "Longitude": 120.0}],
    })
    df = _client(s).fetch_table_rows("dbo_collar", hole_id="H1", limit=1)
    assert list(df.columns) == ["Id", "HoleId", "Latitude", "Longitude"]
    assert df.iloc[0]["HoleId"] == "H1"
    assert s.calls[0][1]["hole_id"] == "H1"
    assert s.calls[0][1]["limit"] == 1
    assert "offset" not in s.calls[0][1]   # None values dropped


def test_api_client_fetch_table_rows_extent_explodes_to_four_params():
    import baselode.extent
    extent = baselode.extent.Extent(
        xmin=118.0, xmax=122.0, ymin=-32.0, ymax=-28.0,
    )
    s = _FakeSession().queue({"columns": [], "rows": []})
    _client(s).fetch_table_rows("dbo_collar", extent=extent)
    params = s.calls[0][1]
    assert params == {"min_lon": 118.0, "min_lat": -32.0,
                       "max_lon": 122.0, "max_lat": -28.0}


def test_api_client_fetch_table_rows_rejects_bare_tuple_extent():
    s = _FakeSession()
    with pytest.raises(TypeError, match="extent must be a baselode.extent.Extent"):
        _client(s).fetch_table_rows(
            "dbo_collar", extent=(118.0, -32.0, 122.0, -28.0),
        )


def test_api_client_fetch_table_rows_accepts_extent_object():
    import baselode.extent
    # Default CRS is "EPSG:4326" (string form, matches GeoJSON/OGC convention).
    extent = baselode.extent.Extent(
        xmin=118.0, xmax=122.0, ymin=-32.0, ymax=-28.0, name="test",
    )
    assert extent.crs == "EPSG:4326"
    s = _FakeSession().queue({"columns": [], "rows": []})
    _client(s).fetch_table_rows("dbo_collar", extent=extent)
    params = s.calls[0][1]
    assert params == {"min_lon": 118.0, "min_lat": -32.0,
                       "max_lon": 122.0, "max_lat": -28.0}


@pytest.mark.parametrize("wgs84_crs", [4326, "4326", "EPSG:4326", "epsg:4326"])
def test_api_client_fetch_table_rows_accepts_wgs84_in_any_form(wgs84_crs):
    import baselode.extent
    extent = baselode.extent.Extent(
        xmin=118.0, xmax=122.0, ymin=-32.0, ymax=-28.0, crs=wgs84_crs,
    )
    s = _FakeSession().queue({"columns": [], "rows": []})
    _client(s).fetch_table_rows("dbo_collar", extent=extent)
    assert s.calls[0][1]["min_lon"] == 118.0


def test_api_client_fetch_table_rows_reprojects_extent_to_wgs84():
    pyproj = pytest.importorskip("pyproj")
    import baselode.extent
    # GDA94 / MGA zone 51 (EPSG:28351). Build an extent there.
    transformer = pyproj.Transformer.from_crs(
        pyproj.CRS.from_epsg(4326), pyproj.CRS.from_epsg(28351), always_xy=True,
    )
    east_min, north_min = transformer.transform(120.0, -32.0)
    east_max, north_max = transformer.transform(120.5, -31.5)
    extent = baselode.extent.Extent(
        xmin=east_min, xmax=east_max, ymin=north_min, ymax=north_max,
        crs=28351,
    )
    s = _FakeSession().queue({"columns": [], "rows": []})
    _client(s).fetch_table_rows("dbo_collar", extent=extent)
    params = s.calls[0][1]
    # Reprojecting an axis-aligned projected bbox creates a new envelope.
    # It must contain the original lon/lat bounds; it need not equal them.
    assert params["min_lon"] <= 120.0
    assert params["min_lat"] <= -32.0
    assert params["max_lon"] >= 120.5
    assert params["max_lat"] >= -31.5


# (removed: ``test_extent_construction_raises_when_pyproj_missing`` —
# pyproj is now a hard dependency imported at module top of
# ``baselode.extent``, so the missing-pyproj branch no longer exists at
# CRS-validation time. If pyproj is missing, ``import baselode.extent``
# itself fails — caught by the install/CI rather than at runtime.)


# ---------------------------------------------------- Extent CRS validation

def test_extent_default_crs_is_epsg_4326_string():
    import baselode.extent
    e = baselode.extent.Extent(xmin=0, xmax=1, ymin=0, ymax=1)
    assert e.crs == "EPSG:4326"


@pytest.mark.parametrize("input_crs", [
    "EPSG:4326", 4326, "4326", "epsg:4326",
])
def test_extent_normalises_wgs84_inputs_to_canonical_string(input_crs):
    import baselode.extent
    e = baselode.extent.Extent(xmin=0, xmax=1, ymin=0, ymax=1, crs=input_crs)
    assert e.crs == "EPSG:4326"


@pytest.mark.parametrize("input_crs,expected", [
    (28351, "EPSG:28351"),
    ("EPSG:28351", "EPSG:28351"),
    ("epsg:28351", "EPSG:28351"),
    ("+proj=longlat +datum=WGS84 +no_defs", "EPSG:4326"),  # equiv. to WGS84
])
def test_extent_normalises_other_crs_inputs(input_crs, expected):
    import baselode.extent
    e = baselode.extent.Extent(xmin=0, xmax=1, ymin=0, ymax=1, crs=input_crs)
    assert e.crs == expected


def test_extent_rejects_none_crs():
    import baselode.extent
    with pytest.raises(ValueError, match="Extent requires a CRS"):
        baselode.extent.Extent(xmin=0, xmax=1, ymin=0, ymax=1, crs=None)


@pytest.mark.parametrize("bad_crs", [
    "not a real crs",
    "EPSG:notanumber",
    -1,
    object(),
])
def test_extent_rejects_invalid_crs(bad_crs):
    import baselode.extent
    with pytest.raises(ValueError, match="Invalid CRS"):
        baselode.extent.Extent(xmin=0, xmax=1, ymin=0, ymax=1, crs=bad_crs)


def test_extent_normalises_pyproj_crs_instance_to_epsg_string():
    pyproj = pytest.importorskip("pyproj")
    import baselode.extent
    e = baselode.extent.Extent(
        xmin=0, xmax=1, ymin=0, ymax=1, crs=pyproj.CRS.from_epsg(28351),
    )
    # pyproj.CRS with an EPSG code → canonical "EPSG:N" string.
    assert e.crs == "EPSG:28351"


def test_extent_set_crs_rewrites_in_place():
    import baselode.extent
    e = baselode.extent.Extent(xmin=0, xmax=1, ymin=0, ymax=1)
    assert e.crs == "EPSG:4326"
    returned = e.set_crs("epsg:28351")
    assert e.crs == "EPSG:28351"
    assert returned is e   # chainable


def test_extent_set_crs_validates():
    import baselode.extent
    e = baselode.extent.Extent(xmin=0, xmax=1, ymin=0, ymax=1)
    with pytest.raises(ValueError, match="Invalid CRS"):
        e.set_crs("garbage")
    # Original CRS preserved on failure.
    assert e.crs == "EPSG:4326"


# ---------------------------------------------------- Extent.to_crs

def test_to_crs_returns_new_extent_with_target_crs():
    import baselode.extent
    e = baselode.extent.Extent(xmin=118.0, xmax=120.0, ymin=-32.0, ymax=-30.0)
    same = e.to_crs("EPSG:4326")
    # Same-CRS path: cheap copy, same bounds, target CRS string.
    assert same is not e
    assert same.crs == "EPSG:4326"
    assert (same.xmin, same.ymin, same.xmax, same.ymax) == (118.0, -32.0, 120.0, -30.0)


def test_to_crs_reprojects_to_target_crs():
    pyproj = pytest.importorskip("pyproj")
    import baselode.extent
    # Start in EPSG:4326, project to GDA94 / MGA zone 51.
    e = baselode.extent.Extent(xmin=120.0, xmax=120.5, ymin=-32.0, ymax=-31.5)
    projected = e.to_crs(28351)
    assert projected.crs == "EPSG:28351"
    # Reprojecting an axis-aligned envelope back must contain the original.
    roundtrip = projected.to_crs("EPSG:4326")
    assert roundtrip.xmin <= 120.0
    assert roundtrip.ymin <= -32.0
    assert roundtrip.xmax >= 120.5
    assert roundtrip.ymax >= -31.5


def test_to_crs_validates_target_crs():
    import baselode.extent
    e = baselode.extent.Extent(xmin=0, xmax=1, ymin=0, ymax=1)
    with pytest.raises(ValueError, match="Invalid CRS"):
        e.to_crs("nope")


def test_to_crs_normalises_target_crs():
    import baselode.extent
    e = baselode.extent.Extent(xmin=0, xmax=1, ymin=0, ymax=1)
    out = e.to_crs(4326)         # int gets normalised
    assert out.crs == "EPSG:4326"


def test_to_crs_preserves_name():
    import baselode.extent
    e = baselode.extent.Extent(xmin=0, xmax=1, ymin=0, ymax=1, name="my_bbox")
    out = e.to_crs("EPSG:28351")
    assert out.name == "my_bbox"


def test_api_client_fetch_table_rows_geojson_returns_raw_dict():
    feature_collection = {"type": "FeatureCollection", "features": []}
    s = _FakeSession().queue(feature_collection)
    out = _client(s).fetch_table_rows("dbo_collar", output="geojson")
    assert out is feature_collection
    assert s.calls[0][1]["output"] == "geojson"


def test_api_client_iter_table_rows_walks_pages():
    page1 = {"columns": ["Id"], "rows": [{"Id": i} for i in range(1000)]}
    page2 = {"columns": ["Id"], "rows": [{"Id": 1000}]}
    s = _FakeSession()
    s.queue(page1).queue(page2)
    pages = list(_client(s).iter_table_rows("dbo_collar", hole_id="H1", page_size=1000))
    assert len(pages) == 2
    assert s.calls[0][1]["offset"] == 0
    assert s.calls[1][1]["offset"] == 1000
    assert sum(len(p) for p in pages) == 1001


def test_api_client_fetch_collar_family_wraps_response():
    body = {
        "query": {"hole_id": "H1"},
        "include_mrt": False,
        "matched_collars": [{"Id": 1, "HoleId": "H1"}],
        "matched_collar_count": 1,
        "tables": {
            "dbo_collar": {"columns": ["Id", "HoleId"],
                           "rows": [{"Id": 1, "HoleId": "H1"}]},
            "dbo_dhsurvey": {"columns": ["Id", "CollarId", "Depth", "Dip", "Azimuth"],
                             "rows": [{"Id": 100, "CollarId": 1, "Depth": 0.0,
                                       "Dip": -60.0, "Azimuth": 0.0}]},
        },
    }
    s = _FakeSession().queue(body)
    out = _client(s).fetch_collar_family(hole_id="H1")
    assert s.calls[0][0].endswith("/collar-family")
    assert s.calls[0][1]["include_mrt"] == "false"
    assert out["matched_collar_count"] == 1
    assert isinstance(out["tables"]["dbo_collar"], pd.DataFrame)
    assert out["tables"]["dbo_dhsurvey"].iloc[0]["Dip"] == -60.0


def test_api_client_requires_requests_or_session(monkeypatch):
    import baselode.adaptors.raw_gswa.api as api
    monkeypatch.setattr(api, "_requests", None)
    with pytest.raises(ImportError):
        baselode.adaptors.raw_gswa.api.RawGswaApiClient("https://api.example.com")
    # But supplying a session bypasses the requirement.
    baselode.adaptors.raw_gswa.api.RawGswaApiClient("https://api.example.com", session=_FakeSession())


# ------------------------------------------------------ high-level fetchers

def _collar_family_body(*, hole_id="H1", collar_id=1, with_coord=True,
                        with_elev=True, with_survey=True, with_geology=False,
                        with_assays=False, with_structures=False):
    tables = {
        "dbo_collar": {
            "columns": ["Id", "HoleId", "CompanyHoleId", "Dataset", "Anumber",
                        "Latitude", "Longitude", "MaxDepth", "HoleType"],
            "rows": [{
                "Id": collar_id, "HoleId": hole_id, "CompanyHoleId": "X",
                "Dataset": "DS", "Anumber": 1234,
                "Latitude": -32.0, "Longitude": 120.0,
                "MaxDepth": 100.0, "HoleType": "DD",
            }],
        },
    }
    if with_coord:
        tables["dbo_collarcoordinate"] = {
            "columns": ["Id", "CollarId", "Easting", "Northing", "Datum",
                        "Projection", "Zone"],
            "rows": [{"Id": 1, "CollarId": collar_id,
                       "Easting": 500000.0, "Northing": 6450000.0,
                       "Datum": "GDA94", "Projection": "MGA", "Zone": "51"}],
        }
    if with_elev:
        tables["dbo_collarelevation"] = {
            "columns": ["CollarID", "Elevation", "Elevation_UOM", "Height_Datum"],
            "rows": [{"CollarID": collar_id, "Elevation": 320.0,
                       "Elevation_UOM": "Metres", "Height_Datum": "AHD"}],
        }
    if with_survey:
        tables["dbo_dhsurvey"] = {
            "columns": ["Id", "CollarId", "Depth", "Dip", "Azimuth"],
            "rows": [
                {"Id": 1, "CollarId": collar_id, "Depth": 0.0,  "Dip": -60.0, "Azimuth": 0.0},
                {"Id": 2, "CollarId": collar_id, "Depth": 50.0, "Dip": -65.0, "Azimuth": 5.0},
            ],
        }
    if with_geology:
        tables["dbo_dhgeology"] = {
            "columns": ["Id", "CollarId", "FromDepth", "ToDepth"],
            "rows": [{"Id": 10, "CollarId": collar_id, "FromDepth": 0.0, "ToDepth": 5.0}],
        }
        tables["dbo_dhgeologyattr"] = {
            "columns": ["Id", "DHGeologyId", "AttributeColumn", "AttributeValue"],
            "rows": [
                {"Id": 1, "DHGeologyId": 10, "AttributeColumn": "Lith1",          "AttributeValue": "GRA"},
                {"Id": 2, "DHGeologyId": 10, "AttributeColumn": "GeologyComment", "AttributeValue": "fresh"},
            ],
        }
    if with_assays:
        tables["dbo_dhgeochemistry"] = {
            "columns": ["Id", "CollarId", "SampleId", "CompanySampleId", "FromDepth", "ToDepth"],
            "rows": [{"Id": 100, "CollarId": collar_id, "SampleId": "S100",
                      "CompanySampleId": "X100", "FromDepth": 1.0, "ToDepth": 2.0}],
        }
        tables["dbo_dhgeochemistryattr"] = {
            "columns": ["Id", "DHGeochemistryId", "AttributeColumn",
                        "AttributeValue", "PPMValue"],
            "rows": [
                {"Id": 1, "DHGeochemistryId": 100, "AttributeColumn": "Au",
                 "AttributeValue": "0.5", "PPMValue": 0.5},
                {"Id": 2, "DHGeochemistryId": 100, "AttributeColumn": "Cu",
                 "AttributeValue": "120", "PPMValue": 120.0},
            ],
        }
    if with_structures:
        tables["dbo_dhstructure"] = {
            "columns": ["Id", "CollarId", "FromDepth", "ToDepth"],
            "rows": [{"Id": 200, "CollarId": collar_id, "FromDepth": 50.0, "ToDepth": 50.0}],
        }
        tables["dbo_dhstructureattr"] = {
            "columns": ["Id", "DHStructureId", "AttributeColumn", "AttributeValue"],
            "rows": [
                {"Id": 1, "DHStructureId": 200, "AttributeColumn": "Dip",    "AttributeValue": "45"},
                {"Id": 2, "DHStructureId": 200, "AttributeColumn": "DipDrn", "AttributeValue": "270"},
            ],
        }
    return {
        "query": {"hole_id": hole_id},
        "include_mrt": False,
        "matched_collars": [{"Id": collar_id, "HoleId": hole_id}],
        "matched_collar_count": 1,
        "tables": {name: t for name, t in tables.items()},
    }


def test_fetch_collars_merges_coord_and_elevation():
    s = _FakeSession().queue(_collar_family_body())
    df = baselode.adaptors.raw_gswa.api.fetch_collars(_client(s), hole_ids=["H1"])
    # Columns should match the SQL builder shape.
    for col in ["CollarId", "HoleId", "Latitude", "Longitude",
                "Easting", "Northing", "Datum", "Zone",
                "Elevation", "Elevation_UOM"]:
        assert col in df.columns, f"missing {col}"
    assert df.iloc[0]["Easting"] == 500000.0
    assert df.iloc[0]["Elevation"] == 320.0


def test_fetch_collars_then_convert_produces_baselode_geodataframe():
    s = _FakeSession().queue(_collar_family_body())
    raw = baselode.adaptors.raw_gswa.api.fetch_collars(_client(s), hole_ids=["H1"])
    collars = baselode.adaptors.raw_gswa.convert.convert_collars(raw)
    assert HOLE_ID in collars.columns
    assert "geometry" in collars.columns
    assert collars.iloc[0][HOLE_ID] == "H1"


def test_fetch_collars_extent_uses_table_endpoint():
    import baselode.extent
    extent = baselode.extent.Extent(
        xmin=118.0, xmax=122.0, ymin=-32.5, ymax=-28.0,
    )
    page = {"columns": ["Id", "HoleId", "Latitude", "Longitude"],
            "rows":    [{"Id": 1, "HoleId": "H1", "Latitude": -32.0, "Longitude": 120.0}]}
    s = _FakeSession().queue(page)
    df = baselode.adaptors.raw_gswa.api.fetch_collars(_client(s), extent=extent)
    assert s.calls[0][0].endswith("/tables/dbo_collar/rows")
    assert s.calls[0][1]["min_lon"] == 118.0
    assert df.iloc[0]["HoleId"] == "H1"


def test_fetch_collars_requires_filter():
    s = _FakeSession()
    with pytest.raises(ValueError):
        baselode.adaptors.raw_gswa.api.fetch_collars(_client(s))


def test_fetch_collars_extent_with_limit_uses_single_page_endpoint():
    """Regression: forwarding ``limit`` through ``fetch_all_table_rows`` used
    to collide with that method's own pagination ``limit=page_size`` and raise
    ``TypeError: multiple values for limit``. ``fetch_collars`` must take the
    bounded single-page path when ``limit`` is supplied.
    """
    import baselode.extent
    extent = baselode.extent.Extent(
        xmin=118.0, xmax=122.0, ymin=-32.5, ymax=-28.0,
    )
    page = {"columns": ["Id", "HoleId"],
            "rows":    [{"Id": 1, "HoleId": "H1"}]}
    s = _FakeSession().queue(page)
    df = baselode.adaptors.raw_gswa.api.fetch_collars(
        _client(s), extent=extent, limit=5,
    )
    # Exactly one HTTP call (no pagination loop).
    assert len(s.calls) == 1
    assert s.calls[0][0].endswith("/tables/dbo_collar/rows")
    assert s.calls[0][1]["limit"] == 5
    # offset must NOT be set — fetch_table_rows leaves it None when omitted.
    assert "offset" not in s.calls[0][1]
    assert df.iloc[0]["HoleId"] == "H1"


def test_iter_table_rows_rejects_reserved_pagination_selectors():
    """``iter_table_rows`` owns ``limit`` and ``offset``; passing them via
    selectors used to silently collide with the per-page call. We now
    raise a clear ``TypeError`` instead.
    """
    s = _FakeSession()
    client = _client(s)
    with pytest.raises(TypeError, match="iter_table_rows manages 'limit'"):
        list(client.iter_table_rows("dbo_collar", limit=5))
    with pytest.raises(TypeError, match="iter_table_rows manages 'offset'"):
        list(client.iter_table_rows("dbo_collar", offset=10))


def test_fetch_surveys_attaches_hole_id():
    s = _FakeSession().queue(_collar_family_body())
    df = baselode.adaptors.raw_gswa.api.fetch_surveys(_client(s), hole_ids=["H1"])
    assert "HoleId" in df.columns
    assert (df["HoleId"] == "H1").all()
    assert "Depth" in df.columns and "Dip" in df.columns


def test_fetch_surveys_then_convert_produces_baselode_shape():
    s = _FakeSession().queue(_collar_family_body())
    raw = baselode.adaptors.raw_gswa.api.fetch_surveys(_client(s), hole_ids=["H1"])
    out = baselode.adaptors.raw_gswa.convert.convert_surveys(raw)
    assert {HOLE_ID, DEPTH, AZIMUTH, DIP}.issubset(out.columns)


def test_fetch_geology_returns_long_form_with_dhgeologyid():
    s = _FakeSession().queue(_collar_family_body(with_geology=True))
    df = baselode.adaptors.raw_gswa.api.fetch_geology(_client(s), hole_ids=["H1"])
    assert "DHGeologyId" in df.columns
    assert "AttributeColumn" in df.columns
    assert "AttributeValue" in df.columns
    assert "HoleId" in df.columns
    # End-to-end: pivot via the converter.
    out = baselode.adaptors.raw_gswa.convert.convert_geology(df)
    assert "geology_code" in out.columns
    assert out.iloc[0]["geology_code"] == "GRA"


def test_fetch_geology_attribute_filter_drops_unwanted_attrs():
    s = _FakeSession().queue(_collar_family_body(with_geology=True))
    df = baselode.adaptors.raw_gswa.api.fetch_geology(_client(s), hole_ids=["H1"],
                                attribute_columns=["Lith1"])
    # Only Lith1 rows remain after the EAV merge.
    assert set(df["AttributeColumn"].dropna().unique()) == {"Lith1"}


def test_fetch_assays_only_with_value_drops_null_ppm():
    body = _collar_family_body(with_assays=True)
    body["tables"]["dbo_dhgeochemistryattr"]["rows"].append({
        "Id": 3, "DHGeochemistryId": 100, "AttributeColumn": "Empty",
        "AttributeValue": None, "PPMValue": None,
    })
    s = _FakeSession().queue(body)
    df = baselode.adaptors.raw_gswa.api.fetch_assays(_client(s), hole_ids=["H1"])
    assert (df["PPMValue"].notna()).all()
    out = baselode.adaptors.raw_gswa.convert.convert_assays(df, extras="spread")
    # Lowercased by `standardize_columns`.
    assert "au" in out.columns and "cu" in out.columns


def test_fetch_structures_pivots_through_convert():
    s = _FakeSession().queue(_collar_family_body(with_structures=True))
    raw = baselode.adaptors.raw_gswa.api.fetch_structures(_client(s), hole_ids=["H1"])
    out = baselode.adaptors.raw_gswa.convert.convert_structures(raw)
    assert {HOLE_ID, DEPTH, DIP, AZIMUTH}.issubset(out.columns)
    assert float(out.iloc[0][DIP]) == 45.0
    assert float(out.iloc[0][AZIMUTH]) == 270.0


def test_fetch_assays_flat_uses_gsd_table_endpoint():
    page = {"columns": ["Id", "HoleId", "FromDepth", "ToDepth", "Au_PPM"],
            "rows": [{"Id": 1, "HoleId": "H1", "FromDepth": 0.0, "ToDepth": 1.0, "Au_PPM": 0.5}]}
    s = _FakeSession().queue(page)
    df = baselode.adaptors.raw_gswa.api.fetch_assays_flat(_client(s), hole_ids=["H1"])
    assert s.calls[0][0].endswith("/tables/gsd_dhassayflat/rows")
    assert "Au_PPM" in df.columns


def test_fetch_surface_samples_flat_filters_by_company_sample_id():
    page = {"columns": ["Id", "CompanySampleId", "Latitude", "Longitude", "Au_PPM"],
            "rows": [{"Id": 1, "CompanySampleId": "ABC", "Latitude": -32.0,
                      "Longitude": 120.0, "Au_PPM": 0.1}]}
    s = _FakeSession().queue(page)
    df = baselode.adaptors.raw_gswa.api.fetch_surface_samples_flat(_client(s), sample_ids=["ABC"])
    assert s.calls[0][0].endswith("/tables/gsd_ssassayflat/rows")
    assert s.calls[0][1]["company_sample_id"] == "ABC"
    assert df.iloc[0]["Au_PPM"] == 0.1


# ----------------------------------------------------------- bundle_extras

def test_bundle_extras_moves_non_canonical_into_dict():
    # `max_depth` is NOT in BASELODE_DATA_MODEL_DRILL_COLLAR — it's bundled.
    # `random_field` is unambiguously non-canonical too.
    df = pd.DataFrame({
        HOLE_ID:        ["H1", "H2"],
        LATITUDE:       [-32.0, -32.5],
        LONGITUDE:      [120.0, 121.0],
        "max_depth":    [100.0, 75.0],
        "random_field": ["a", "b"],
    })
    out = baselode.drill.data.bundle_extras(
        df, baselode.drill.data.BASELODE_DATA_MODEL_DRILL_COLLAR.keys(),
    )
    assert set(out.columns) == {HOLE_ID, LATITUDE, LONGITUDE, EXTRA}
    row0 = out.iloc[0]
    assert row0[EXTRA] == {"max_depth": 100.0, "random_field": "a"}


def test_bundle_extras_skips_nan_values():
    import numpy as np
    # Using non-canonical names so both fields are bundled (the model now
    # owns ``hole_type``).
    df = pd.DataFrame({
        HOLE_ID: ["H1"],
        "missing_metric": [np.nan],   # should NOT appear in the dict
        "lab_method": ["ICP"],         # should appear
    })
    out = baselode.drill.data.bundle_extras(
        df, baselode.drill.data.BASELODE_DATA_MODEL_DRILL_COLLAR.keys(),
    )
    extra = out.iloc[0][EXTRA]
    assert "missing_metric" not in extra
    assert extra == {"lab_method": "ICP"}


def test_bundle_extras_is_idempotent_with_existing_extra_column():
    df = pd.DataFrame({
        HOLE_ID:   ["H1"],
        EXTRA:     [{"existing": 1}],
        "new_one": [42],
    })
    out = baselode.drill.data.bundle_extras(
        df, baselode.drill.data.BASELODE_DATA_MODEL_DRILL_COLLAR.keys(),
    )
    extra = out.iloc[0][EXTRA]
    assert extra == {"existing": 1, "new_one": 42}

    # Calling again is a no-op (no non-canonical cols left).
    out2 = baselode.drill.data.bundle_extras(
        out, baselode.drill.data.BASELODE_DATA_MODEL_DRILL_COLLAR.keys(),
    )
    assert out2.iloc[0][EXTRA] == extra


def test_bundle_extras_preserves_reserved_columns():
    df = pd.DataFrame({
        HOLE_ID:    ["H1"],
        "geometry": ["POINT(120 -32)"],
        "scratch":  ["x"],
    })
    out = baselode.drill.data.bundle_extras(
        df, baselode.drill.data.BASELODE_DATA_MODEL_DRILL_COLLAR.keys(),
        reserved={"geometry"},
    )
    assert "geometry" in out.columns
    assert "scratch" not in out.columns
    assert out.iloc[0][EXTRA] == {"scratch": "x"}


def test_bundle_extras_existing_dict_wins_on_conflict():
    df = pd.DataFrame({
        HOLE_ID: ["H1"],
        EXTRA:   [{"foo": "kept"}],
        "foo":   ["overwritten"],
    })
    out = baselode.drill.data.bundle_extras(
        df, baselode.drill.data.BASELODE_DATA_MODEL_DRILL_COLLAR.keys(),
    )
    assert out.iloc[0][EXTRA] == {"foo": "kept"}


def test_bundle_extras_empty_extras_still_adds_column():
    df = pd.DataFrame({HOLE_ID: ["H1", "H2"]})
    out = baselode.drill.data.bundle_extras(
        df, baselode.drill.data.BASELODE_DATA_MODEL_DRILL_COLLAR.keys(),
    )
    assert EXTRA in out.columns
    assert all(isinstance(v, dict) and v == {} for v in out[EXTRA])
