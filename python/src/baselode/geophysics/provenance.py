# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Darkmine Pty Ltd
"""Version 1 embedded raster lineage (UTF-8 JSON in an ASCII base64 field).

This is a processing record, not a content hash or a runnable workflow.
File readers keep their own geometry, units and current source authoritative.
"""

import base64
import binascii
import json
import math
import re

import baselode


TAG = "BASELODE_PROVENANCE"
SCHEMA = "baselode.geophysics.provenance"
MAX_BYTES = 16 * 1024 * 1024
_DTYPES = {"float32", "float64", "uint8", "int8", "uint16", "int16", "uint32", "int32"}
_READER_FIELDS = {"driver", "source", "tags", "width", "height", "datum", "projection",
                  "coordinate_type", "cell_type", "crs_units", "units"}


def _source_reference(value):
    if not isinstance(value, str):
        return value
    match = re.search(r"[A-Za-z][A-Za-z0-9+.-]*://", value)
    if match is None:
        return value
    # Text-only redaction also supports VSI prefixes and opaque vendor names.
    # Do not parse/rebuild URLs: that changes case, escaping and empty paths.
    end = match.end()
    tail = re.split(r"[?#]", value[end:], maxsplit=1)[0]
    authority, separator, path = tail.partition("/")
    return value[:end] + authority.rsplit("@", 1)[-1] + separator + path



def _redact_sources(value):
    if isinstance(value, list):
        return [_redact_sources(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {}
    for key, item in value.items():
        if key.lower() == "sources" and isinstance(item, list):
            result[key] = [_source_reference(source) if isinstance(source, str) else _redact_sources(source) for source in item]
        elif re.search(r"(^|_)source$", key, flags=re.IGNORECASE):
            result[key] = _source_reference(item) if isinstance(item, str) else _redact_sources(item)
        else:
            result[key] = _redact_sources(item)
    return result


def _check_steps(metadata, limit):
    steps = metadata.get("processing", [])
    if not isinstance(steps, list) or not all(isinstance(step, dict) and isinstance(step.get("operation"), str) for step in steps):
        raise ValueError("provenance processing must be a list of named operations")
    for step in steps:
        if "operand_lineage" in step:
            index = step["operand_lineage"]
            if type(index) not in (int, float) or not 0 <= index < limit or int(index) != index:
                raise ValueError("invalid provenance operand_lineage reference")


def _check_graph(metadata):
    nodes = metadata.get("input_lineage", [])
    if not isinstance(nodes, list):
        raise ValueError("input_lineage must be a list")
    for index, node in enumerate(nodes):
        if not isinstance(node, dict) or not isinstance(node.get("metadata"), dict) or "input_lineage" in node["metadata"]:
            raise ValueError("input_lineage must contain flat metadata/source records")
        if not isinstance(node.get("sources"), list) or not all(isinstance(source, str) for source in node["sources"]):
            raise ValueError("invalid input_lineage sources")
        _check_steps(node["metadata"], index)
    _check_steps(metadata, len(nodes))


def _json_value(value, ancestors=None):
    """Reject values that JSON would silently coerce or discard."""
    ancestors = set() if ancestors is None else ancestors
    if value is None or isinstance(value, (str, bool)):
        return
    if type(value) in (int, float):
        try:
            finite = math.isfinite(value)
        except OverflowError:
            finite = False
        if not finite:
            raise ValueError("provenance metadata requires finite JSON numbers")
        if type(value) is int and int(float(value)) != value:
            raise ValueError("provenance JSON integers must be exactly representable in JavaScript")
        return
    if type(value) not in (dict, list) or id(value) in ancestors:
        raise ValueError("provenance metadata must be acyclic JSON objects, arrays and primitives")
    ancestors.add(id(value))
    for key, item in value.items() if isinstance(value, dict) else enumerate(value):
        if isinstance(value, dict) and not isinstance(key, str):
            raise ValueError("provenance JSON object keys must be strings")
        _json_value(item, ancestors)
    ancestors.remove(id(value))


def _validate(manifest):
    _json_value(manifest)
    if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA:
        raise ValueError("invalid Baselode provenance schema")
    if type(manifest.get("version")) not in (int, float) or manifest["version"] != 1:
        raise ValueError("unsupported Baselode provenance version")
    metadata = manifest.get("metadata")
    producer = manifest.get("producer")
    export = manifest.get("export")
    if not isinstance(metadata, dict) or "baselode_provenance" in metadata:
        raise ValueError("invalid provenance metadata snapshot")
    if not isinstance(producer, dict) or producer.get("library") != "baselode" or not isinstance(producer.get("version"), str):
        raise ValueError("invalid provenance producer")
    if not isinstance(export, dict) or export.get("format") not in ("ERS", "GeoTIFF") or not isinstance(export.get("dtype"), str) or export["dtype"] not in _DTYPES:
        raise ValueError("invalid provenance export descriptor")
    sources = manifest.get("sources")
    if not isinstance(sources, list) or not all(isinstance(source, str) for source in sources):
        raise ValueError("invalid provenance source references")
    _check_graph(metadata)
    return manifest


def input_record(metadata):
    """Return an independent metadata/source snapshot for one input."""
    snapshot = {key: value for key, value in metadata.items() if key != "baselode_provenance"}
    _json_value(snapshot)
    if isinstance(snapshot.get("tags"), dict):
        snapshot["tags"] = {key: value for key, value in snapshot["tags"].items() if key != TAG}
    previous = metadata.get("baselode_provenance")
    sources = list(_validate(previous)["sources"]) if previous is not None else []
    source = metadata.get("source")
    if source and source not in sources:
        sources.append(source)
    record = {"metadata": snapshot, "sources": sources}
    _json_value(record)
    record = _redact_sources(json.loads(json.dumps(record, allow_nan=False)))
    if not all(isinstance(source, str) for source in record["sources"]):
        raise ValueError("invalid provenance source references")
    record["sources"] = list(dict.fromkeys(record["sources"]))
    return record


def _canonical(value):
    """Type-aware equality key: JSON booleans are not numbers."""
    if value is None:
        return ("null",)
    if isinstance(value, bool):
        return ("boolean", value)
    if type(value) in (int, float):
        return ("number", value)
    if isinstance(value, str):
        return ("string", value)
    if isinstance(value, list):
        return ("array", tuple(_canonical(item) for item in value))
    return ("object", tuple((key, _canonical(value[key])) for key in sorted(value)))


def append_input(left, right):
    """Merge a right-hand input graph without recursively duplicating it."""
    _check_graph(left)
    _check_graph(right)
    nodes = input_record(left)["metadata"].get("input_lineage", [])
    mapping = {}
    keys = [_canonical(node) for node in nodes]

    def add(record):
        for step in record["metadata"].get("processing", []):
            if "operand_lineage" in step:
                step["operand_lineage"] = mapping[step["operand_lineage"]]
        key = _canonical(record)
        if key not in keys:
            nodes.append(record)
            keys.append(key)
        return keys.index(key)

    right_record = input_record(right)
    for index, node in enumerate(right_record["metadata"].pop("input_lineage", [])):
        mapping[index] = add(node)
    operand = add(right_record)
    return nodes, operand


def selection(metadata, bands):
    """Record an explicit band view of an imported provenance-bearing file."""
    return {**metadata, "processing": list(metadata.get("processing", [])) + [
        {"operation": "select_bands", "bands": list(bands)},
    ]}


def encode(metadata, file_format, dtype):
    """Return the base64 manifest for JSON-compatible raster metadata."""
    # Intentional v1 contract: never silently omit non-JSON metadata. Writers
    # offer include_provenance=False for legacy metadata-agnostic exports.
    record = input_record(metadata)
    manifest = _validate({
        "schema": SCHEMA, "version": 1,
        "producer": {"library": "baselode", "version": baselode.__version__},
        "sources": record["sources"], "metadata": record["metadata"],
        "export": {"format": file_format, "dtype": str(dtype)},
    })
    data = json.dumps(manifest, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if len(data) > MAX_BYTES:
        raise ValueError("Baselode provenance exceeds the 16 MiB limit")
    return base64.b64encode(data).decode("ascii")


def restore(metadata, encoded, include_provenance=True):
    """Restore a manifest while keeping reader metadata authoritative."""
    if encoded is None:
        return metadata
    if not include_provenance:
        # Explicit escape hatch for unknown/damaged records. Never pretend
        # that an ignored history was complete or silently degrade by default.
        ignored = {**metadata, "provenance_ignored": True, "processing": [
            {"operation": "provenance_omitted_on_import"},
        ]}
        if isinstance(ignored.get("tags"), dict):
            ignored["tags"] = {key: value for key, value in ignored["tags"].items() if key != TAG}
        return ignored
    try:
        if not isinstance(encoded, str) or len(encoded) > 4 * ((MAX_BYTES + 2) // 3):
            raise ValueError("invalid or oversized provenance field")
        data = base64.b64decode(encoded, validate=True)
        if len(data) > MAX_BYTES:
            raise ValueError("oversized provenance field")
        manifest = _validate(json.loads(data.decode("utf-8")))
    except (ValueError, UnicodeError, binascii.Error, RecursionError) as error:
        raise ValueError(f"invalid Baselode provenance: {error}") from error
    manifest = _redact_sources(manifest)
    snapshot = {key: value for key, value in manifest["metadata"].items() if key not in _READER_FIELDS}
    # Current reader.source remains the live I/O locator; only persisted
    # snapshots/references are sanitized, so signed URLs can still reopen.
    restored = {**snapshot, **metadata, "baselode_provenance": manifest}
    if isinstance(restored.get("tags"), dict):
        restored["tags"] = {key: value for key, value in restored["tags"].items() if key != TAG}
    return restored
