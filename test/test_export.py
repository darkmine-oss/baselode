# SPDX-License-Identifier: GPL-3.0-or-later

import json

import pandas as pd
import pandas.testing
import pyarrow
import pytest

import baselode.export


def _mixed_table():
    return pd.DataFrame({
        "hole_id": [101, "A-2", None],
        "source_value": [1, "2", None],
        "grade": [1.5, None, 3.25],
        "extra": [{"b": 2, "a": [1, None]}, ["x", 2], None],
    })


def test_normalize_table_preserves_input_and_serializes_sensitive_values():
    source = _mixed_table()
    original = source.copy(deep=True)

    normalized = baselode.export.normalize_table(source)

    assert normalized["hole_id"].tolist() == ["101", "A-2", pd.NA]
    assert normalized["source_value"].tolist() == ["1", "2", pd.NA]
    assert normalized["extra"].tolist() == [
        '{"a":[1,null],"b":2}',
        '["x",2]',
        pd.NA,
    ]
    assert normalized.loc[0, "grade"] == 1.5
    assert pd.isna(normalized.loc[1, "grade"])
    pandas.testing.assert_frame_equal(source, original)


def test_write_table_round_trips_csv_and_parquet(tmp_path):
    source = _mixed_table()

    csv_path = baselode.export.write_table(source, tmp_path / "collars.csv")
    parquet_path = baselode.export.write_table(source, tmp_path / "collars.parquet")

    csv = pd.read_csv(csv_path, dtype={"hole_id": "string", "source_value": "string"})
    parquet = pd.read_parquet(parquet_path)
    assert len(csv) == len(source)
    assert len(parquet) == len(source)
    assert parquet["hole_id"].tolist()[:2] == ["101", "A-2"]
    assert parquet["source_value"].tolist()[:2] == ["1", "2"]
    assert pd.isna(parquet.loc[2, "hole_id"])
    assert pd.isna(parquet.loc[2, "source_value"])
    assert parquet.loc[0, "extra"] == '{"a":[1,null],"b":2}'


def test_write_table_failure_does_not_replace_existing_target(tmp_path, monkeypatch):
    target = tmp_path / "collars.csv"
    target.write_text("original\n", encoding="utf-8")

    def fail_after_partial_write(table, path):
        path.write_text("partial\n", encoding="utf-8")
        raise RuntimeError("simulated writer failure")

    monkeypatch.setattr(baselode.export, "_write_csv", fail_after_partial_write)

    with pytest.raises(RuntimeError, match="simulated writer failure"):
        baselode.export.write_table(_mixed_table(), target)

    assert target.read_text(encoding="utf-8") == "original\n"
    assert not list(tmp_path.glob(".collars.csv.*.tmp"))


def test_normalize_table_stringifies_caller_declared_identifier():
    source = pd.DataFrame({"external_id": [101, 102, None]})

    normalized = baselode.export.normalize_table(source, identifier_columns="external_id")

    assert normalized["external_id"].tolist() == ["101", "102", pd.NA]


def test_normalize_table_removes_float_upcast_suffix_from_canonical_identifier():
    source = pd.DataFrame({"hole_id": [101, 102, None]})

    normalized = baselode.export.normalize_table(source)

    assert source["hole_id"].dtype == "float64"
    assert normalized["hole_id"].tolist() == ["101", "102", pd.NA]


def test_write_table_pair_normalizes_only_once(tmp_path, monkeypatch):
    original = baselode.export.normalize_table
    calls = []

    def recording_normalize(table, identifier_columns=None):
        calls.append(table)
        return original(table, identifier_columns=identifier_columns)

    monkeypatch.setattr(baselode.export, "normalize_table", recording_normalize)

    paths = baselode.export.write_table_pair(_mixed_table(), tmp_path, "collars")

    assert len(calls) == 1
    assert paths == {
        "csv": tmp_path / "collars.csv",
        "parquet": tmp_path / "collars.parquet",
    }


def test_write_project_preflights_all_tables_before_creating_output(tmp_path):
    output_dir = tmp_path / "project"
    tables = {
        "collars": _mixed_table(),
        "unsupported": pd.DataFrame({"value": [object()]}),
    }

    with pytest.raises((pyarrow.ArrowInvalid, pyarrow.ArrowTypeError)):
        baselode.export.write_project(tables, output_dir)

    assert not output_dir.exists()


def test_write_project_emits_manifest_after_requested_files(tmp_path):
    output_dir = tmp_path / "project"
    tables = {
        "collars": _mixed_table(),
        "survey": pd.DataFrame({
            "hole_id": [101],
            "depth": [0.0],
            "azimuth": [10.0],
            "dip": [-60.0],
        }),
    }

    manifest = baselode.export.write_project(
        tables,
        output_dir,
        manifest_name="conversion_manifest.json",
        metadata={"project": "example"},
    )

    on_disk = json.loads((output_dir / "conversion_manifest.json").read_text())
    assert on_disk == manifest
    assert on_disk["format_version"] == 1
    assert on_disk["metadata"] == {"project": "example"}
    assert on_disk["tables"]["collars"]["rows"] == 3
    assert on_disk["tables"]["survey"]["files"] == {
        "csv": "survey.csv",
        "parquet": "survey.parquet",
    }
    for name in tables:
        assert (output_dir / f"{name}.csv").is_file()
        assert (output_dir / f"{name}.parquet").is_file()
