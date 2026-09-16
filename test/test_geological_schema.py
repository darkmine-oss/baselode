# Copyright (C) 2026 Darkmine Pty Ltd.

# SPDX-License-Identifier: GPL-3.0-or-later

"""Scientific boundaries and language parity of the packaged storage schema."""

import json
import pathlib

import baselode.datamodel.geological
import pytest


def test_geological_schema_preserves_scientific_boundaries():
    tables = baselode.datamodel.geological.get_geological_schema()["tables"]
    assert len(tables) == 21
    assert "drill.veins" in tables
    assert "drill.veining" not in tables
    assert "drill.survey_run" not in tables
    for name in ("drill.geophysics", "drill.petrophysics"):
        assert "volume_magnetic_susceptibility_si" in tables[name]["columns"]
    surface = tables["surface.petrophysics"]["columns"]
    assert "_surface_sample_id" in surface
    assert "_collar_id" not in surface
    assert tables["drill.collar"]["primaryKey"] == ["_collar_id"]
    assert "selection_rank" in tables["drill.survey"]["columns"]
    for name in ("drill.sample_context", "surface.sample_context"):
        assert "assay" not in tables[name]["columns"]


def test_spatial_and_numeric_storage_contract():
    table = baselode.datamodel.geological.get_geological_table("drill.collar")
    columns = table["columns"]
    assert columns["geography"]["storageType"] == "geography(Point,7844)"
    assert columns["geometry"]["storageType"] == "geometry(Point)"
    assert columns["projected_srid"]["storageType"] == "integer"
    assert columns["_collar_id"]["encoding"] == "decimal-string"
    chemistry = baselode.datamodel.geological.get_geological_table("drill.geochemistry_flat")
    assert chemistry["columns"]["assay"]["storageType"] == "jsonb"
    assert not any("half_limit" in name for name in chemistry["columns"])


def test_public_schema_references_and_independent_copies():
    schema = baselode.datamodel.geological.get_geological_schema()
    for table in schema["tables"].values():
        for key in table["primaryKey"]:
            assert table["columns"][key]["nullable"] is False
        for column in table["columns"].values():
            reference = column.get("reference")
            if reference:
                assert reference["column"] in schema["tables"][reference["table"]]["columns"]
    schema["tables"].clear()
    assert baselode.datamodel.geological.get_geological_schema()["tables"]
    table = baselode.datamodel.geological.get_geological_table("drill.collar")
    table["columns"].clear()
    assert baselode.datamodel.geological.get_geological_table("drill.collar")["columns"]
    with pytest.raises(KeyError):
        baselode.datamodel.geological.get_geological_table("missing")


def test_javascript_resource_matches_python():
    root = pathlib.Path(__file__).resolve().parents[1]
    javascript = root / "javascript/packages/baselode/src/data/geological_schema.json"
    assert json.loads(javascript.read_text()) == baselode.datamodel.geological.get_geological_schema()
