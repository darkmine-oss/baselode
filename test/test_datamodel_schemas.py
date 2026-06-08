# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd

"""Tests for baselode.datamodel.schemas + parity of the committed JSON.

Two layers:

1. Unit tests on the generator (`to_json_schema`, `to_json_schema_all`):
   shape, primary keys, foreign keys, required fields, units, nullability.

2. Reproducibility / parity:
   - `python -m baselode.datamodel.regen_schemas` must produce the
     same bytes that are committed at `test/data/baselode_schemas.json`.
   - The JS-bundled copy at
     `javascript/packages/baselode/src/data/baselode_schemas.json`
     must match the Python copy byte-for-byte.

   These together mean a developer who touches a `BASELODE_DATA_MODEL_*`
   dict (or any of the metadata tables) must rerun the regen script
   before merging — otherwise CI fails loudly.
"""

import json
from pathlib import Path

import pytest

from baselode.datamodel.schemas import (
    ALL_MODELS,
    to_json_schema,
    to_json_schema_all,
)
from baselode.datamodel import (
    BASELODE_DATA_MODEL_DRILL_COLLAR,
    BASELODE_DATA_MODEL_DRILL_SURVEY,
    BASELODE_DATA_MODEL_SURFACE_SAMPLE,
)
from baselode.datamodel.regen_schemas import (
    PY_OUT_PATH,
    JS_OUT_PATH,
    render,
)


REPO_ROOT = Path(__file__).resolve().parents[1]


class TestGenerator:
    def test_combined_doc_lists_every_table(self):
        doc = to_json_schema_all()
        assert set(doc["schemas"].keys()) == {name for name, _, _ in ALL_MODELS}
        # Order preserved.
        assert list(doc["schemas"].keys()) == [name for name, _, _ in ALL_MODELS]

    def test_draft_2020_12(self):
        doc = to_json_schema_all()
        assert doc["$schema"] == "https://json-schema.org/draft/2020-12/schema"
        for schema in doc["schemas"].values():
            assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
            assert schema["type"] == "object"

    def test_drill_collar_required_and_primary_key(self):
        schema = to_json_schema("drill_collar", BASELODE_DATA_MODEL_DRILL_COLLAR)
        assert schema["required"] == ["hole_id"]
        assert schema["primaryKey"] == ["hole_id"]
        # hole_id is required → type is a plain string, not [string, null].
        assert schema["properties"]["hole_id"]["type"] == "string"
        # latitude is optional → nullable.
        assert schema["properties"]["latitude"]["type"] == ["number", "null"]

    def test_drill_survey_foreign_key_to_collar(self):
        schema = to_json_schema("drill_survey", BASELODE_DATA_MODEL_DRILL_SURVEY)
        assert schema["properties"]["hole_id"]["foreignKey"] == {
            "table": "drill_collar", "column": "hole_id"
        }
        # Composite PK includes depth.
        assert schema["primaryKey"] == ["hole_id", "depth"]

    def test_units_propagate(self):
        doc = to_json_schema_all()
        collar = doc["schemas"]["drill_collar"]["properties"]
        survey = doc["schemas"]["drill_survey"]["properties"]
        assert collar["latitude"]["unit"] == "deg"
        assert collar["elevation"]["unit"] == "m"
        assert survey["azimuth"]["unit"] == "deg"
        assert survey["dip"]["unit"] == "deg"
        assert survey["depth"]["unit"] == "m"

    def test_surface_sample_has_no_foreign_key(self):
        schema = to_json_schema("surface_sample", BASELODE_DATA_MODEL_SURFACE_SAMPLE)
        for col, prop in schema["properties"].items():
            assert "foreignKey" not in prop, f"{col} should not have a foreign key"

    def test_unknown_field_gets_typed_but_no_description(self):
        # An ad-hoc dict that uses field names not in _FIELD_METADATA
        # should still produce a valid schema; description / unit just
        # don't appear.  This exercises the "no metadata entry" path.
        custom_model = {"my_custom_col": float}
        schema = to_json_schema("custom_table", custom_model)
        prop = schema["properties"]["my_custom_col"]
        # Not required → nullable number.
        assert prop["type"] == ["number", "null"]
        assert "description" not in prop
        assert "unit" not in prop


class TestRegenerationParity:
    def test_committed_python_copy_matches_current_output(self):
        actual = render()
        committed = PY_OUT_PATH.read_text(encoding="utf-8")
        assert committed == actual, (
            "test/data/baselode_schemas.json is out of date.  "
            "Run `python -m baselode.datamodel.regen_schemas` and commit the result."
        )

    def test_js_copy_matches_python_copy(self):
        py = PY_OUT_PATH.read_text(encoding="utf-8")
        js = JS_OUT_PATH.read_text(encoding="utf-8")
        assert py == js, (
            "JavaScript-bundled baselode_schemas.json is out of sync "
            "with the Python copy.  Run "
            "`python -m baselode.datamodel.regen_schemas` to refresh both."
        )

    def test_committed_file_is_valid_json(self):
        # Round-trip parse — catches manual edits that corrupt the JSON.
        doc = json.loads(PY_OUT_PATH.read_text(encoding="utf-8"))
        assert doc["title"] == "baselode data model"
        assert "schemas" in doc
