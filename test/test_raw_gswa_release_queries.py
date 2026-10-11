# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd

"""Execute flat-query projections against both publisher column shapes.

SQLite provides isolated relation/column and result checks for these ordinary
SELECTs. PostgreSQL-specific tuple parameters are asserted separately; these
fixtures do not stand in for warehouse performance or geodetic acceptance.
"""

import re
import sqlite3

import pandas as pd
import pytest

import baselode.adaptors.raw_gswa.queries
import baselode.extent


@pytest.fixture
def database():
    with sqlite3.connect(':memory:') as conn:
        conn.execute("ATTACH DATABASE ':memory:' AS postgres_gswa")
        yield conn


def execute(conn, sql, params):
    # Extent predicates use scalar pyformat parameters in PostgreSQL.
    sql = re.sub(r'%\((\w+)\)s', r':\1', sql)
    cursor = conn.execute(sql, params)
    return [dict(zip([c[0] for c in cursor.description], row)) for row in cursor.fetchall()]


@pytest.mark.parametrize('release', ['2025-10', '2026-05'])
@pytest.mark.parametrize('project_columns', [False, True])
def test_drill_projection_retains_values_and_parent_identity(database, release, project_columns):
    newer = release == '2026-05'
    lat, lon, dip = ('CollarLatitude', 'CollarLongitude', 'DIP') if newer else ('Latitude', 'Longitude', 'Dip')
    oxide = 'SiO2_PCT' if newer else 'SiO2_PPM'
    value = 50.0 if newer else 500000.0
    collar = pd.DataFrame({'Id':[1], 'HoleId':['stable-H1']})
    collar.to_sql('dbo_collar', database, index=False)
    database.execute('CREATE TABLE postgres_gswa.dbo_collar AS SELECT * FROM main.dbo_collar')
    row = {'Id':9, 'Collarid':1, 'CompanyHoleId':'H1', 'Anumber':123,
           lat:-30., lon:120., 'FromDepth':0., 'ToDepth':1., dip:-90.,
           'Azimuth':0., 'HoleType':'DD', 'Elevation':100., 'Fe_PPM':13.5, oxide:value}
    # Two records for one interval are retained, as is an orphan flat record.
    pd.DataFrame([row, {**row, 'Id':10}, {**row, 'Id':11, 'Collarid':999}]).to_sql('flat', database, index=False)
    database.execute('CREATE TABLE postgres_gswa.gsd_dhassayflat AS SELECT * FROM main.flat')
    sql, params = baselode.adaptors.raw_gswa.queries.build_assay_flat_query(
        extent=baselode.extent.Extent(xmin=119, xmax=121, ymin=-31, ymax=-29),
        analyte_columns=['Fe_PPM', oxide] if project_columns else None,
        source_release=release)
    rows = execute(database, sql, params)
    assert len(rows) == 3
    assert [r['HoleId'] for r in rows].count('stable-H1') == 2
    assert [r['HoleId'] for r in rows].count(None) == 1
    assert all(r[oxide] == value and r['Fe_PPM'] == 13.5 for r in rows)
    assert all(r[lat] == -30. and r[lon] == 120. and r[dip] == -90. for r in rows)
    assert f'f."{lon}" BETWEEN' in sql
    if project_columns:
        assert f'f."{dip}"' in sql


@pytest.mark.parametrize('release', ['2025-10', '2026-05'])
@pytest.mark.parametrize('project_columns', [False, True])
def test_surface_projection_uses_only_release_columns(database, release, project_columns):
    newer = release == '2026-05'
    oxide = 'SiO2_PCT' if newer else 'SiO2_PPM'
    value = 50.0 if newer else 500000.0
    row = {'Id':10 if newer else 999, 'CompanySampleId':'S1', 'Dataset':'D',
           'Anumber':123, 'Latitude':-30., 'Longitude':120., 'Elevation':100.,
           'Fe_PPM':13.5, oxide:value}
    if not newer:
        row.update(SurfaceSampleId=10, SurfaceSampleType='rock')
    pd.DataFrame([row,row]).to_sql('flat', database, index=False)
    database.execute('CREATE TABLE postgres_gswa.gsd_ssassayflat AS SELECT * FROM main.flat')
    sql, params = baselode.adaptors.raw_gswa.queries.build_surface_sample_assay_flat_query(
        analyte_columns=['Fe_PPM', oxide] if project_columns else None,
        extent=baselode.extent.Extent(xmin=119, xmax=121, ymin=-31, ymax=-29),
        source_release=release)
    rows = execute(database, sql, params)
    assert len(rows) == 2
    assert all(r['Id'] == row['Id'] and r[oxide] == value and r['Fe_PPM'] == 13.5 for r in rows)
    assert all(('SurfaceSampleId' in r) is (not newer) for r in rows)
    if not newer:
        assert all(r['SurfaceSampleId'] == 10 for r in rows)


@pytest.mark.parametrize('builder', [
    baselode.adaptors.raw_gswa.queries.build_assay_flat_query,
    baselode.adaptors.raw_gswa.queries.build_surface_sample_assay_flat_query,
])
def test_release_is_explicit_validated_and_defaults_to_older_shape(builder):
    assert builder() == builder(source_release='2025-10')
    with pytest.raises(ValueError, match='source_release'):
        builder(source_release='future; DROP TABLE x')


def test_flat_hole_filter_uses_parent_and_keeps_values_parameterised():
    value = "H1'); DROP TABLE x; --"
    sql, params = baselode.adaptors.raw_gswa.queries.build_assay_flat_query(hole_ids=[value], source_release='2026-05')
    assert 'c."HoleId" IN %(hole_ids)s' in sql
    assert value not in sql
    assert params['hole_ids'] == (value,)
