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

import baselode


TAG = "BASELODE_PROVENANCE"
SCHEMA = "baselode.geophysics.provenance"
MAX_BYTES = 16 * 1024 * 1024


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
    if type(manifest.get("version")) is not int or manifest["version"] != 1:
        raise ValueError("unsupported Baselode provenance version")
    metadata = manifest.get("metadata")
    producer = manifest.get("producer")
    export = manifest.get("export")
    if not isinstance(metadata, dict) or "provenance" in metadata:
        raise ValueError("invalid provenance metadata snapshot")
    if not isinstance(producer, dict) or producer.get("library") != "baselode" or not isinstance(producer.get("version"), str):
        raise ValueError("invalid provenance producer")
    if not isinstance(export, dict) or export.get("format") not in ("ERS", "GeoTIFF") or not isinstance(export.get("dtype"), str):
        raise ValueError("invalid provenance export descriptor")
    sources = manifest.get("sources")
    if not isinstance(sources, list) or not all(isinstance(source, str) for source in sources):
        raise ValueError("invalid provenance source references")
    steps = metadata.get("processing", [])
    if not isinstance(steps, list) or not all(isinstance(step, dict) and isinstance(step.get("operation"), str) for step in steps):
        raise ValueError("provenance processing must be a list of named operations")
    return manifest


def input_record(metadata):
    """Return an independent metadata/source snapshot for one input."""
    snapshot = {key: value for key, value in metadata.items() if key != "provenance"}
    if isinstance(snapshot.get("tags"), dict):
        snapshot["tags"] = {key: value for key, value in snapshot["tags"].items() if key != TAG}
    previous = metadata.get("provenance")
    sources = list(_validate(previous)["sources"]) if previous is not None else []
    source = metadata.get("source")
    if source and source not in sources:
        sources.append(source)
    record = {"metadata": snapshot, "sources": sources}
    _json_value(record)
    return json.loads(json.dumps(record, allow_nan=False))


def selection(metadata, bands):
    """Record an explicit band view of an imported provenance-bearing file."""
    if "provenance" not in metadata:
        return metadata
    return {**metadata, "processing": list(metadata.get("processing", [])) + [
        {"operation": "select_bands", "bands": list(bands)},
    ]}


def encode(metadata, file_format, dtype):
    """Return the base64 manifest for JSON-compatible raster metadata."""
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


def restore(metadata, encoded):
    """Restore a manifest while keeping reader metadata authoritative."""
    if encoded is None:
        return metadata
    try:
        if not isinstance(encoded, str) or len(encoded) > 4 * ((MAX_BYTES + 2) // 3):
            raise ValueError("invalid or oversized provenance field")
        data = base64.b64decode(encoded, validate=True)
        if len(data) > MAX_BYTES:
            raise ValueError("oversized provenance field")
        manifest = _validate(json.loads(data.decode("utf-8")))
    except (ValueError, UnicodeError, binascii.Error, RecursionError) as error:
        raise ValueError(f"invalid Baselode provenance: {error}") from error
    restored = {**manifest["metadata"], **metadata, "provenance": manifest}
    if isinstance(restored.get("tags"), dict):
        restored["tags"] = {key: value for key, value in restored["tags"].items() if key != TAG}
    return restored
