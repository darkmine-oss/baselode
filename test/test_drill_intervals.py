# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

import numpy as np
import pandas as pd

import baselode.drill.intervals as intervals


def _table(rows):
    return pd.DataFrame(rows, columns=["hole_id", "from", "to", "grade"])


def test_interval_length_returns_per_row_lengths():
    df = _table([
        ("A", 0.0, 1.5, 0.1),
        ("A", 1.5, 3.0, 0.2),
    ])
    lengths = intervals.interval_length(df)
    assert list(lengths) == [1.5, 1.5]


def test_from_to_midpoints_returns_midpoints():
    df = _table([("A", 0.0, 10.0, 0.1)])
    mids = intervals.from_to_midpoints(df)
    assert list(mids) == [5.0]


def test_detect_gaps_no_gaps_returns_empty():
    df = _table([
        ("A", 0.0, 1.0, 0.1),
        ("A", 1.0, 2.0, 0.2),
    ])
    gaps = intervals.detect_gaps(df)
    assert gaps.empty
    assert list(gaps.columns) == ["hole_id", "from", "to", "length"]


def test_detect_gaps_single_gap_reported():
    df = _table([
        ("A", 0.0, 1.0, 0.1),
        ("A", 2.5, 3.0, 0.2),
    ])
    gaps = intervals.detect_gaps(df)
    assert len(gaps) == 1
    assert gaps.iloc[0]["from"] == 1.0
    assert gaps.iloc[0]["to"] == 2.5
    assert gaps.iloc[0]["length"] == 1.5


def test_detect_gaps_respects_min_gap():
    df = _table([
        ("A", 0.0, 1.0, 0.1),
        ("A", 1.001, 2.0, 0.2),  # tiny gap
        ("A", 5.0, 6.0, 0.3),    # big gap
    ])
    gaps = intervals.detect_gaps(df, min_gap=0.5)
    assert len(gaps) == 1
    assert gaps.iloc[0]["from"] == 2.0
    assert gaps.iloc[0]["to"] == 5.0


def test_detect_gaps_per_hole_isolation():
    df = _table([
        ("A", 0.0, 1.0, 0.1),
        ("A", 2.0, 3.0, 0.2),
        ("B", 5.0, 6.0, 0.3),
    ])
    gaps = intervals.detect_gaps(df)
    assert len(gaps) == 1
    assert gaps.iloc[0]["hole_id"] == "A"


def test_detect_overlaps_no_overlaps_returns_empty():
    df = _table([
        ("A", 0.0, 1.0, 0.1),
        ("A", 1.0, 2.0, 0.2),  # touching, not overlapping
    ])
    overlaps = intervals.detect_overlaps(df)
    assert overlaps.empty


def test_detect_overlaps_single_overlap_reported():
    df = _table([
        ("A", 0.0, 1.5, 0.1),
        ("A", 1.0, 2.0, 0.2),
    ])
    overlaps = intervals.detect_overlaps(df)
    assert len(overlaps) == 1
    row = overlaps.iloc[0]
    assert row["from"] == 1.0
    assert row["to"] == 1.5
    assert row["length"] == 0.5


def test_detect_overlaps_per_hole_isolation():
    df = _table([
        ("A", 0.0, 1.5, 0.1),
        ("A", 1.0, 2.0, 0.2),
        ("B", 0.0, 1.0, 0.3),
        ("B", 2.0, 3.0, 0.4),
    ])
    overlaps = intervals.detect_overlaps(df)
    assert len(overlaps) == 1
    assert overlaps.iloc[0]["hole_id"] == "A"


def test_detect_overlaps_returns_positional_indices_for_non_default_index():
    df = _table([
        ("A", 0.0, 1.5, 0.1),
        ("A", 1.0, 2.0, 0.2),
    ])
    df.index = ["row-x", "row-y"]
    overlaps = intervals.detect_overlaps(df)
    assert len(overlaps) == 1
    assert overlaps.iloc[0]["first_index"] == 0
    assert overlaps.iloc[0]["second_index"] == 1


def test_split_at_splits_through_inner_depth():
    df = _table([("A", 0.0, 10.0, 0.5)])
    out = intervals.split_at(df, {"A": [3.0, 7.0]})
    assert len(out) == 3
    assert list(out["from"]) == [0.0, 3.0, 7.0]
    assert list(out["to"]) == [3.0, 7.0, 10.0]
    assert (out["grade"] == 0.5).all()


def test_split_at_ignores_boundary_at_endpoints():
    df = _table([("A", 0.0, 10.0, 0.5)])
    out = intervals.split_at(df, {"A": [0.0, 10.0]})
    assert len(out) == 1
    assert out.iloc[0]["from"] == 0.0
    assert out.iloc[0]["to"] == 10.0


def test_split_at_broadcast_list_applies_to_all_holes():
    df = _table([
        ("A", 0.0, 10.0, 0.1),
        ("B", 0.0, 10.0, 0.2),
    ])
    out = intervals.split_at(df, [5.0])
    assert len(out) == 4
    assert sorted(out["from"].unique()) == [0.0, 5.0]


def test_clip_drops_intervals_entirely_outside_window():
    df = _table([
        ("A", 0.0, 1.0, 0.1),
        ("A", 5.0, 6.0, 0.2),
    ])
    out = intervals.clip(df, from_depth=2.0, to_depth=4.0)
    assert out.empty


def test_clip_trims_straddling_intervals():
    df = _table([
        ("A", 0.0, 3.0, 0.1),
        ("A", 4.0, 8.0, 0.2),
    ])
    out = intervals.clip(df, from_depth=1.0, to_depth=6.0)
    assert len(out) == 2
    assert out.iloc[0]["from"] == 1.0
    assert out.iloc[0]["to"] == 3.0
    assert out.iloc[1]["from"] == 4.0
    assert out.iloc[1]["to"] == 6.0


def test_merge_tables_aligns_columns_on_common_support():
    assay = pd.DataFrame({
        "hole_id": ["A", "A"],
        "from": [0.0, 5.0],
        "to": [5.0, 10.0],
        "cu": [0.10, 0.20],
    })
    litho = pd.DataFrame({
        "hole_id": ["A", "A"],
        "from": [0.0, 3.0],
        "to": [3.0, 10.0],
        "rock": ["x", "y"],
    })
    merged = intervals.merge_tables({"assay": assay, "litho": litho})
    assert list(merged["from"]) == [0.0, 3.0, 5.0]
    assert list(merged["to"]) == [3.0, 5.0, 10.0]
    assert list(merged["assay_cu"]) == [0.10, 0.10, 0.20]
    assert list(merged["litho_rock"]) == ["x", "y", "y"]


def test_merge_tables_emits_nan_when_other_table_misses_hole():
    assay = pd.DataFrame({
        "hole_id": ["A"],
        "from": [0.0],
        "to": [5.0],
        "cu": [0.10],
    })
    litho = pd.DataFrame({
        "hole_id": ["B"],
        "from": [0.0],
        "to": [5.0],
        "rock": ["x"],
    })
    merged = intervals.merge_tables({"assay": assay, "litho": litho})
    assert len(merged) == 1
    assert merged.iloc[0]["assay_cu"] == 0.10
    assert pd.isna(merged.iloc[0]["litho_rock"])


def test_empty_input_returns_empty():
    df = pd.DataFrame(columns=["hole_id", "from", "to"])
    assert intervals.detect_gaps(df).empty
    assert intervals.detect_overlaps(df).empty
    assert intervals.split_at(df, [1.0]).empty
    assert intervals.clip(df, 0, 1).empty
    assert intervals.merge_tables({"a": df}).empty
