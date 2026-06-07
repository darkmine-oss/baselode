# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

import importlib.util
import tempfile
from pathlib import Path

import pandas as pd
import pytest

from baselode.drill import DrillholeSet

HAS_OMF = importlib.util.find_spec("omf") is not None
omf_only = pytest.mark.skipif(not HAS_OMF, reason="omf optional extra not installed")


def _collar():
    return pd.DataFrame({
        "hole_id": ["A", "B"],
        "easting": [500000.0, 500100.0],
        "northing": [6900000.0, 6900050.0],
        "elevation": [300.0, 305.0],
        "max_depth": [100.0, 80.0],
    })


def _survey():
    return pd.DataFrame({
        "hole_id": ["A", "A", "B", "B"],
        "depth": [0.0, 100.0, 0.0, 80.0],
        "azimuth": [0.0, 0.0, 90.0, 90.0],
        "dip": [-90.0, -90.0, -60.0, -60.0],
    })


def _assays():
    return pd.DataFrame({
        "hole_id": ["A", "A", "B"],
        "from": [0.0, 10.0, 0.0],
        "to": [10.0, 20.0, 20.0],
        "au_ppm": [0.1, 0.2, 0.05],
    })


def _geology():
    return pd.DataFrame({
        "hole_id": ["A", "B"],
        "from": [0.0, 0.0],
        "to": [50.0, 50.0],
        "lithology": ["granite", "schist"],
    })


def test_constructor_records_inputs():
    db = DrillholeSet(_collar(), _survey(), crs="EPSG:32750", project="goldfields")
    assert db.crs == "EPSG:32750"
    assert db.project == "goldfields"
    assert len(db.collar) == 2
    assert len(db.survey) == 4
    assert db.tables == {}


def test_add_table_is_chainable_and_records_kind():
    db = DrillholeSet(_collar(), _survey())
    returned = db.add_table("assay", _assays(), kind="assay").add_table(
        "geology", _geology(), kind="litho",
    )
    assert returned is db
    assert list(db.tables) == ["assay", "geology"]
    assert db.table_kinds == {"assay": "assay", "geology": "litho"}


def test_add_table_rejects_empty_name():
    db = DrillholeSet(_collar(), _survey())
    with pytest.raises(ValueError):
        db.add_table("", _assays())


def test_add_table_rejects_reserved_names():
    db = DrillholeSet(_collar(), _survey())
    with pytest.raises(ValueError, match="reserved"):
        db.add_table("collars", _assays())
    with pytest.raises(ValueError, match="reserved"):
        db.add_table("traces", _assays())


def test_holes_returns_unique_ids():
    db = DrillholeSet(_collar(), _survey())
    assert sorted(db.holes) == ["A", "B"]


def test_getitem_and_contains():
    db = DrillholeSet(_collar(), _survey()).add_table("assay", _assays())
    assert "assay" in db
    assert "missing" not in db
    assert db["assay"] is db.tables["assay"]


def test_validate_returns_structured_report():
    db = DrillholeSet(_collar(), _survey()).add_table("assay", _assays())
    report = db.validate()
    assert "summary" in report
    assert "issues" in report
    assert report["summary"]["error"] == 0


def test_validate_forwards_kwargs():
    survey = _survey()
    survey.loc[0, "azimuth"] = 360.0
    db = DrillholeSet(_collar(), survey)
    strict = db.validate()
    permissive = db.validate(allow_full_circle=True)
    azimuth_errors_strict = [issue for issue in strict["issues"] if issue["check"] == "azimuth_range"]
    azimuth_errors_permissive = [issue for issue in permissive["issues"] if issue["check"] == "azimuth_range"]
    assert len(azimuth_errors_strict) == 1
    assert len(azimuth_errors_permissive) == 0


def test_desurvey_returns_trace_and_caches_result():
    db = DrillholeSet(_collar(), _survey())
    first = db.desurvey(step=10.0)
    second = db.desurvey(step=10.0)
    assert first is second
    assert {"hole_id", "md", "easting", "northing", "elevation"}.issubset(first.columns)


def test_desurvey_recomputes_when_args_change_or_forced():
    db = DrillholeSet(_collar(), _survey())
    first = db.desurvey(step=10.0)
    second = db.desurvey(step=5.0)
    assert second is not first
    third = db.desurvey(step=5.0, force=True)
    assert third is not second


def test_desurvey_rejects_unknown_method():
    db = DrillholeSet(_collar(), _survey())
    with pytest.raises(ValueError, match="Unknown desurvey method"):
        db.desurvey(method="black_magic")


def test_traces_property_runs_desurvey_on_demand():
    db = DrillholeSet(_collar(), _survey())
    traces = db.traces
    assert "easting" in traces.columns
    assert db._traces is traces


def test_composite_delegates_to_composite_intervals():
    db = DrillholeSet(_collar(), _survey()).add_table("assay", _assays())
    composited = db.composite("assay", "au_ppm", length=5.0)
    assert not composited.empty
    assert {"hole_id", "from", "to", "au_ppm"}.issubset(composited.columns)


def test_composite_raises_for_unknown_table():
    db = DrillholeSet(_collar(), _survey())
    with pytest.raises(KeyError, match="No table 'assay'"):
        db.composite("assay", "au_ppm")


@omf_only
def test_to_omf_writes_all_registered_elements_by_default():
    import omf as omf_pkg
    db = (
        DrillholeSet(_collar(), _survey())
        .add_table("assay", _assays())
        .add_table("geology", _geology())
    )
    with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / "set.omf"
        returned = db.to_omf(path)
        assert returned == path
        assert path.exists()
        project = omf_pkg.OMFReader(str(path)).get_project()
        names = [element.name for element in project.elements]
        assert "collars" in names
        assert "traces" in names
        assert "assay" in names
        assert "geology" in names


@omf_only
def test_to_omf_respects_include_filter():
    db = (
        DrillholeSet(_collar(), _survey())
        .add_table("assay", _assays())
        .add_table("geology", _geology())
    )
    with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / "set.omf"
        db.to_omf(path, include=["collars", "assay"])
        import omf as omf_pkg
        project = omf_pkg.OMFReader(str(path)).get_project()
        names = [element.name for element in project.elements]
        assert "collars" in names
        assert "assay" in names
        assert "traces" not in names
        assert "geology" not in names


@omf_only
def test_to_omf_passes_value_cols_per_table():
    db = DrillholeSet(_collar(), _survey()).add_table("assay", _assays())
    with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / "set.omf"
        db.to_omf(path, include=["assay"], value_cols={"assay": ["au_ppm"]})
        import omf as omf_pkg
        project = omf_pkg.OMFReader(str(path)).get_project()
        assay_element = next(element for element in project.elements if element.name == "assay")
        data_names = [item.name for item in assay_element.data]
        assert "au_ppm" in data_names


def test_to_omf_raises_for_unknown_include():
    db = DrillholeSet(_collar(), _survey())
    with tempfile.TemporaryDirectory() as tmpdir:
        with pytest.raises(KeyError, match="No table 'missing'"):
            db.to_omf(Path(tmpdir) / "x.omf", include=["missing"])


def test_repr_reflects_state():
    db = DrillholeSet(_collar(), _survey()).add_table("assay", _assays())
    text = repr(db)
    assert "holes=2" in text
    assert "survey_rows=4" in text
    assert "tables=['assay']" in text
