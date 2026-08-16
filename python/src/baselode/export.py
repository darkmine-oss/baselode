# SPDX-License-Identifier: GPL-3.0-or-later

"""Portable exports for canonical Baselode tables.

The functions in this module keep source-specific transformation policy out of
the library. They normalize serialization-sensitive values, then write generic
CSV/Parquet tables and a small project manifest.
"""

import datetime
import decimal
import json
import numbers
import os
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow
import pyarrow.parquet

import baselode.datamodel


__all__ = [
    "DEFAULT_IDENTIFIER_COLUMNS",
    "SUPPORTED_FORMATS",
    "normalize_table",
    "write_table",
    "write_table_pair",
    "write_project",
]


DEFAULT_IDENTIFIER_COLUMNS = frozenset({
    baselode.datamodel.HOLE_ID,
    baselode.datamodel.COLLAR_ID,
    baselode.datamodel.DATASOURCE_HOLE_ID,
    baselode.datamodel.SURFACE_SAMPLE_ID,
    baselode.datamodel.DATASOURCE_SURFACE_SAMPLE_ID,
    baselode.datamodel.SAMPLE_ID,
    baselode.datamodel.DATASOURCE_SAMPLE_ID,
    baselode.datamodel.PROJECT_ID,
    baselode.datamodel.REPORT_NUMBER,
})

SUPPORTED_FORMATS = frozenset({"csv", "parquet"})


def _is_missing_scalar(value):
    if value is None or value is pd.NA or value is pd.NaT:
        return True
    try:
        result = pd.isna(value)
    except (TypeError, ValueError):
        return False
    return isinstance(result, (bool, np.bool_)) and bool(result)


def _json_compatible(value):
    if isinstance(value, dict):
        return {str(key): _json_compatible(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_compatible(item) for item in value]
    if isinstance(value, np.ndarray):
        return [_json_compatible(item) for item in value.tolist()]
    if isinstance(value, set):
        return [_json_compatible(item) for item in sorted(value, key=repr)]
    if _is_missing_scalar(value):
        return None
    if isinstance(value, numbers.Real) and not np.isfinite(value):
        return None
    if isinstance(value, np.generic):
        return _json_compatible(value.item())
    if isinstance(value, (pd.Timestamp, pd.Timedelta)):
        return value.isoformat()
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, Path):
        return str(value)
    return value


def _normalize_object_value(value):
    if isinstance(value, (dict, list, tuple, set, np.ndarray)):
        return json.dumps(
            _json_compatible(value),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    if _is_missing_scalar(value):
        return None
    return value


def _normalize_identifier_value(value):
    value = _normalize_object_value(value)
    if value is None:
        return None
    if (
        isinstance(value, numbers.Real)
        and not isinstance(value, (bool, np.bool_))
        and np.isfinite(value)
        and float(value).is_integer()
    ):
        return str(int(value))
    return str(value)


def _identifier_columns(identifier_columns):
    if identifier_columns is None:
        return DEFAULT_IDENTIFIER_COLUMNS
    if isinstance(identifier_columns, str):
        identifier_columns = [identifier_columns]
    return DEFAULT_IDENTIFIER_COLUMNS.union(identifier_columns)


def _is_mixed_object_series(series):
    value_types = {type(value) for value in series if value is not None}
    if not value_types:
        return False
    if value_types == {str}:
        return True
    if len(value_types) == 1:
        return False
    if all(issubclass(value_type, numbers.Number) for value_type in value_types):
        return bool in value_types
    return True


def normalize_table(table, identifier_columns=None):
    """Normalize a DataFrame for consistent CSV and Parquet serialization.

    Known canonical identifier columns, plus any caller-declared identifier
    columns, are stored as nullable strings. Integer-valued numeric identifiers
    omit pandas float-upcast suffixes such as ``.0``. Dicts, lists, tuples, sets, and
    arrays in object columns become deterministic JSON strings. Other object
    columns containing incompatible scalar types become nullable strings.
    Numeric columns retain their numeric dtype and null values remain null.

    Parameters
    ----------
    table : pd.DataFrame
        Canonical or derived table to normalize.
    identifier_columns : iterable of str or str, optional
        Additional columns that carry identifiers and must be strings.

    Returns
    -------
    pd.DataFrame
        A normalized copy. The input is never modified.
    """
    if not isinstance(table, pd.DataFrame):
        raise TypeError("table must be a pandas DataFrame")

    normalized = table.copy()
    identifiers = _identifier_columns(identifier_columns)
    for column in normalized.columns:
        if column in identifiers:
            normalized[column] = (
                normalized[column].map(_normalize_identifier_value).astype("string")
            )
            continue
        if not pd.api.types.is_object_dtype(normalized[column].dtype):
            continue
        normalized[column] = normalized[column].map(_normalize_object_value)
        if _is_mixed_object_series(normalized[column]):
            normalized[column] = (
                normalized[column].map(_normalize_identifier_value).astype("string")
            )
    return normalized


def _validate_table_name(name):
    if (
        not isinstance(name, str)
        or not name
        or Path(name).name != name
        or name in {".", ".."}
    ):
        raise ValueError("table names must be non-empty filenames without directory components")


def _normalize_formats(formats):
    if isinstance(formats, str):
        formats = [formats]
    normalized = tuple(dict.fromkeys(str(value).lower().lstrip(".") for value in formats))
    unsupported = set(normalized).difference(SUPPORTED_FORMATS)
    if not normalized or unsupported:
        supported = ", ".join(sorted(SUPPORTED_FORMATS))
        raise ValueError(f"formats must contain one or more of: {supported}")
    return normalized


def _atomic_write(target, writer):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=target.parent,
        prefix=f".{target.name}.",
        suffix=".tmp",
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    try:
        writer(temporary_path)
        mode = target.stat().st_mode & 0o777 if target.exists() else 0o644
        os.chmod(temporary_path, mode)
        os.replace(temporary_path, target)
    finally:
        temporary_path.unlink(missing_ok=True)
    return target


def _write_csv(table, path):
    table.to_csv(path, index=False, lineterminator="\n")


def _write_parquet(arrow_table, path, compression):
    pyarrow.parquet.write_table(arrow_table, path, compression=compression)


def _prepare_table(table, identifier_columns, needs_parquet):
    normalized = normalize_table(table, identifier_columns=identifier_columns)
    arrow_table = None
    if needs_parquet:
        arrow_table = pyarrow.Table.from_pandas(normalized, preserve_index=False)
    return normalized, arrow_table


def _write_prepared_table(normalized, arrow_table, target, file_format, compression):
    if file_format == "csv":
        return _atomic_write(target, lambda path: _write_csv(normalized, path))
    return _atomic_write(
        target,
        lambda path: _write_parquet(arrow_table, path, compression),
    )


def write_table(table, path, identifier_columns=None, compression="snappy"):
    """Atomically write one normalized CSV or Parquet table.

    Parameters
    ----------
    table : pd.DataFrame
        Table to normalize and write.
    path : str or pathlib.Path
        Target ending in ``.csv`` or ``.parquet``.
    identifier_columns : iterable of str or str, optional
        Additional identifier columns to serialize as strings.
    compression : str, optional
        PyArrow Parquet compression codec. Defaults to ``snappy``.

    Returns
    -------
    pathlib.Path
        The written target path.
    """
    target = Path(path)
    file_format = target.suffix.lower().lstrip(".")
    if file_format not in SUPPORTED_FORMATS:
        raise ValueError("path must end in .csv or .parquet")
    normalized, arrow_table = _prepare_table(
        table,
        identifier_columns,
        needs_parquet=file_format == "parquet",
    )
    return _write_prepared_table(normalized, arrow_table, target, file_format, compression)


def write_table_pair(table, output_dir, name, identifier_columns=None, compression="snappy"):
    """Write atomic CSV and Parquet files from one normalized table.

    Parameters
    ----------
    table : pd.DataFrame
        Table to normalize and write.
    output_dir : str or pathlib.Path
        Destination directory.
    name : str
        Filename stem without directory components.
    identifier_columns : iterable of str or str, optional
        Additional identifier columns to serialize as strings.
    compression : str, optional
        PyArrow Parquet compression codec. Defaults to ``snappy``.

    Returns
    -------
    dict
        Mapping of ``csv`` and ``parquet`` to written paths.
    """
    _validate_table_name(name)
    normalized, arrow_table = _prepare_table(table, identifier_columns, needs_parquet=True)
    output_dir = Path(output_dir)
    paths = {}
    for file_format in ("csv", "parquet"):
        target = output_dir / f"{name}.{file_format}"
        paths[file_format] = _write_prepared_table(
            normalized,
            arrow_table,
            target,
            file_format,
            compression,
        )
    return paths


def write_project(
    tables,
    output_dir,
    formats=("csv", "parquet"),
    identifier_columns=None,
    compression="snappy",
    manifest_name="baselode_manifest.json",
    metadata=None,
):
    """Write canonical tables and a generic project manifest.

    All tables are normalized and, when requested, converted to Arrow before
    any output is written. Individual files use atomic replacement. The
    manifest is serialized during preflight and replaced only after every
    listed file is emitted successfully.

    Parameters
    ----------
    tables : mapping of str to pd.DataFrame
        Table names and values to export.
    output_dir : str or pathlib.Path
        Destination directory.
    formats : iterable of str or str, optional
        Any of ``csv`` and ``parquet``. Both are written by default.
    identifier_columns : iterable of str or str, optional
        Additional identifier columns to serialize as strings in every table.
    compression : str, optional
        PyArrow Parquet compression codec. Defaults to ``snappy``.
    manifest_name : str, optional
        Manifest filename without directory components.
    metadata : dict, optional
        JSON-compatible caller metadata to include unchanged.

    Returns
    -------
    dict
        The manifest that was written.
    """
    if not hasattr(tables, "items"):
        raise TypeError("tables must be a mapping of names to DataFrames")
    _validate_table_name(manifest_name)
    formats = _normalize_formats(formats)
    needs_parquet = "parquet" in formats

    prepared = {}
    manifest = {"format_version": 1, "tables": {}}
    if metadata is not None:
        manifest["metadata"] = metadata
    for name, table in tables.items():
        _validate_table_name(name)
        normalized, arrow_table = _prepare_table(table, identifier_columns, needs_parquet)
        prepared[name] = (normalized, arrow_table)
        manifest["tables"][name] = {
            "rows": len(normalized),
            "columns": [str(column) for column in normalized.columns],
            "files": {file_format: f"{name}.{file_format}" for file_format in formats},
        }

    manifest = _json_compatible(manifest)
    manifest_text = json.dumps(
        manifest,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ) + "\n"
    output_dir = Path(output_dir)
    for name, (normalized, arrow_table) in prepared.items():
        for file_format in formats:
            _write_prepared_table(
                normalized,
                arrow_table,
                output_dir / f"{name}.{file_format}",
                file_format,
                compression,
            )
    _atomic_write(
        output_dir / manifest_name,
        lambda path: path.write_text(manifest_text, encoding="utf-8"),
    )
    return manifest
