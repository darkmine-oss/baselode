# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Bound observation correction history and scalar magnetic corrections."""
import bisect
import copy
import hashlib
import json
import pathlib
import re
import struct
import math

import pyproj
import types

import baselode
import baselode.geophysics.observations
import baselode.geophysics.crossovers
import baselode.geophysics.processing
import baselode.geophysics.provenance

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent / "geophysics_corrections.json").read_text())
_LIMITS = _DESCRIPTOR["resources"]
_SCHEMA = "baselode.geophysics.correction_ledger"
_ALGORITHM = "sha256-float64-v1"
_ALIASES = {re.sub(r"[ _-]", "", alias.lower()): name for name, item in _DESCRIPTOR["catalogue"].items() for alias in item["aliases"]}


class _NeedsInput(ValueError):
    pass


class _ResourceError(ValueError):
    pass


def describe_corrections():
    """Return independent ledger, declaration and magnetic-correction contracts.

    Returns
    -------
    dict
        V1 schemas, alias catalogue, binding protocol and assumptions.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _producer():
    return {"library": "baselode", "version": baselode.__version__, "algorithm_version": 1}


def _report(operation):
    return {"schema": "baselode.geophysics.corrections", "version": 1, "operation": operation, "state": "ok", "issues": [],
            "observations": None, "ledger": None, "states": {}, "proposals": [], "diagnostics": {}, "parameters": {},
            "producer": _producer(), "assumptions": copy.deepcopy(_DESCRIPTOR["assumptions"])}


def _error(report, error):
    report["state"] = "needs_input" if isinstance(error, _NeedsInput) else "rejected"
    report["issues"].append({"code": "context" if isinstance(error, _NeedsInput) else ("resource" if isinstance(error, (_ResourceError, baselode.geophysics.crossovers._ResourceError)) else "contract"), "message": str(error)})
    report.update(observations=None, ledger=None, states={})
    return report


def _json(value):
    baselode.geophysics.provenance._json_value(value)
    result = json.loads(json.dumps(value, ensure_ascii=True, allow_nan=False), parse_float=baselode.geophysics.observations._json_float)
    if len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > _LIMITS["max_options_bytes"]:
        raise _ResourceError("correction options/declarations exceed 256 KiB")
    return result


def _label(value):
    return baselode.geophysics.observations._label(value)


def _evidence(value):
    return baselode.geophysics.observations._text(value) and len(value) <= 4096


def _number(value):
    return baselode.geophysics.observations._number(value) and (type(value) is not int or float(value) == value)


def _digest(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def _canonical(value):
    if not isinstance(value, str):
        return None
    return _ALIASES.get(re.sub(r"[ _-]", "", value.lower()))


def _channels(data, correction):
    family = _DESCRIPTOR["catalogue"][correction]["family"]
    return sorted(name for name, item in data["channels"].items() if item["field_type"].startswith(family))


def _binding(data):
    names = sorted(data["channels"])
    def hex_number(value):
        if value is None:
            return None
        if not _number(value):
            raise ValueError("correction binding requires finite binary64 values within +/-1e100; integers must be exactly representable")
        return struct.pack(">d", 0.0 if value == 0 else float(value)).hex()
    rows = [[row["id"], *[hex_number(row[name]) for name in ("x", "y", "z", "time", "clearance")], row["line_id"], row["station_id"], [hex_number(row["values"][name]) for name in names]] for row in data["records"]]
    snapshot = ["baselode.correction_binding.v1", data["crs"], data["crs_units"], [[name, data["channels"][name]["field_type"], data["channels"][name]["units"]] for name in names], rows]
    encoded = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > _LIMITS["max_binding_bytes"]:
        raise _ResourceError("correction binding snapshot exceeds 32 MiB")
    return hashlib.sha256(encoded).hexdigest()


def _states(data, ledger):
    result = {name: {channel: "unknown" for channel in _channels(data, name)} for name in _DESCRIPTOR["catalogue"]}
    for entry in ledger["entries"]:
        if entry["kind"] == "reprojection":
            continue
        for channel in entry["channels"]:
            result[entry["correction"]][channel] = entry["state"]
    return result


def _base_options(options):
    schema = _DESCRIPTOR["base_parameters"]
    if type(options) is not dict or options.keys() - schema["properties"].keys():
        raise ValueError("base correction requires known option names")
    params = _json(options)
    if any(name not in params for name in schema["required"]):
        raise _NeedsInput("supply channel, base_channel, reference, max_gap, event_id, evidence and clock_policy")
    if not all(isinstance(params[name], str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", params[name]) for name in ("channel", "base_channel")):
        raise ValueError("channel/base_channel must be declared channel names")
    if not _number(params["reference"]) or not _number(params["max_gap"]) or params["max_gap"] <= 0:
        raise ValueError("reference must be finite nT and max_gap a positive time distance in range")
    if not _label(params["event_id"]) or not _evidence(params["evidence"]):
        raise ValueError("event_id/evidence require nonempty bounded strings")
    if params["clock_policy"] != "synchronized":
        raise _NeedsInput("clock_policy must explicitly acknowledge synchronized UTC Unix seconds")
    return params


def _igrf_options(options):
    schema = _DESCRIPTOR["igrf_parameters"]
    if type(options) is not dict or options.keys() - schema["properties"].keys():
        raise ValueError("IGRF removal requires known option names")
    params = _json(options)
    if any(name not in params for name in schema["required"]):
        raise _NeedsInput("supply channel, event_id, evidence and explicit model=IGRF14")
    if not isinstance(params["channel"], str) or re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", params["channel"]) is None:
        raise ValueError("channel must be a declared channel name")
    if not _label(params["event_id"]) or not _evidence(params["evidence"]) or params["model"] != "IGRF14":
        raise ValueError("IGRF removal requires bounded event_id/evidence and model=IGRF14")
    return params


def _lag_options(options):
    schema = _DESCRIPTOR["lag_parameters"]
    if type(options) is not dict or options.keys() - schema["properties"].keys():
        raise ValueError("lag correction requires known option names")
    params = _json(options)
    if any(name not in params for name in schema["required"]):
        raise _NeedsInput("supply channel, lag_seconds, max_gap, unsupported_policy, event_id, evidence and clock_policy")
    if not isinstance(params["channel"], str) or re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", params["channel"]) is None:
        raise ValueError("channel must be a declared channel name")
    if not _number(params["lag_seconds"]) or abs(params["lag_seconds"]) > 3600 or not _number(params["max_gap"]) or params["max_gap"] <= 0:
        raise ValueError("lag_seconds must be within +/-3600 and max_gap finite positive seconds")
    if params["unsupported_policy"] not in ("reject", "mask") or not _label(params["event_id"]) or not _evidence(params["evidence"]):
        raise ValueError("lag requires explicit reject/mask policy and bounded event_id/evidence")
    if params["clock_policy"] != "synchronized":
        raise _NeedsInput("clock_policy must explicitly acknowledge synchronized UTC Unix seconds")
    return params


def _heading_options(options):
    schema = _DESCRIPTOR["heading_parameters"]
    if type(options) is not dict or options.keys() - schema["properties"].keys():
        raise ValueError("heading correction requires known option names")
    params = _json(options)
    if any(name not in params for name in schema["required"]):
        raise _NeedsInput("supply all heading/calibration, gap, sign, event and evidence options")
    if not all(isinstance(params[name], str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", params[name]) for name in ("channel", "heading_key")):
        raise ValueError("channel and heading_key must be named fields")
    if params["heading_reference"] not in ("true_north", "magnetic_north", "grid_north") or params["bias_convention"] != "observed_minus_reference":
        raise ValueError("declare a supported heading reference and observed_minus_reference bias convention")
    if not _label(params["calibration_id"]) or not _label(params["event_id"]) or not _evidence(params["evidence"]):
        raise ValueError("calibration_id/event_id/evidence require nonempty bounded strings")
    if not _number(params["max_heading_gap"]) or not 0 < params["max_heading_gap"] <= 180:
        raise ValueError("max_heading_gap must be finite degrees in (0,180]")
    nodes = params["calibration"]
    if type(nodes) is not list or len(nodes) < 2:
        raise ValueError("calibration requires at least two heading/bias nodes")
    if len(nodes) > _LIMITS["max_heading_nodes"]:
        raise _ResourceError("heading calibration accepts at most 72 nodes")
    for node in nodes:
        if type(node) is not dict or set(node) != {"heading_degrees", "bias_nT"} or not _number(node["heading_degrees"]) or not 0 <= node["heading_degrees"] < 360 or not _number(node["bias_nT"]):
            raise ValueError("calibration nodes require finite unique headings in [0,360) and bias_nT")
    nodes.sort(key=lambda node: node["heading_degrees"])
    if any(left["heading_degrees"] == right["heading_degrees"] for left, right in zip(nodes, nodes[1:])):
        raise ValueError("calibration headings must be unique")
    return params


def _heading_binding(data, params):
    if len(data["records"]) > _LIMITS["max_heading_records"]:
        raise _ResourceError("heading correction accepts at most 4096 records")
    context = data["metadata"].get("heading")
    if type(context) is not dict or set(context) != {"key", "units", "reference", "positive"} or context != {"key": params["heading_key"], "units": "degrees", "reference": params["heading_reference"], "positive": "clockwise"}:
        raise _NeedsInput("declare metadata.heading key/units=degrees/reference/positive=clockwise matching heading options")
    def hex_number(value):
        return struct.pack(">d", 0.0 if value == 0 else float(value)).hex()
    rows = []
    for row in data["records"]:
        heading = row["extra"].get(params["heading_key"])
        if heading is not None and (not _number(heading) or not 0 <= heading <= 360):
            raise ValueError("every supplied heading must be a finite clockwise angle in [0,360] degrees")
        rows.append([row["id"], None if heading is None else hex_number(heading)])
    snapshot = ["baselode.heading_binding.v1", params["channel"], params["heading_key"], params["heading_reference"], params["calibration_id"], params["bias_convention"], hex_number(params["max_heading_gap"]),
                [[hex_number(n["heading_degrees"]), hex_number(n["bias_nT"])] for n in params["calibration"]], [context[n] for n in ("key", "units", "reference", "positive")], rows]
    encoded = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > _LIMITS["max_binding_bytes"]:
        raise _ResourceError("heading input binding exceeds 32 MiB")
    return hashlib.sha256(encoded).hexdigest()


def describe_crossovers():
    """Return independent crossover/levelling schemas, bounds and assumptions.

    Returns
    -------
    dict
        Discoverable native analysis and fixed-reference DC levelling contracts.
    """
    return baselode.geophysics.crossovers.describe_crossovers()


def _crossover_values(params):
    if not isinstance(params["channel"], str) or re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", params["channel"]) is None:
        raise ValueError("channel must be a declared scalar observation channel")
    if not _number(params["max_segment_length"]) or not 0 < params["max_segment_length"] <= 1e9 or not _number(params["min_crossing_angle"]) or not 0 < params["min_crossing_angle"] <= 90:
        raise ValueError("supply positive max_segment_length<=1e9 and min_crossing_angle<=90")
    tolerance = params["intersection_tolerance"]
    if not _number(tolerance) or not 1e-9 <= tolerance <= 1e6 or tolerance > params["max_segment_length"] / 100:
        raise ValueError("intersection_tolerance must be [1e-9,1e6] and <=max_segment_length/100")
    if params["elevation_policy"] not in ("ignore", "limit"):
        raise ValueError("elevation_policy must be explicitly ignore or limit")
    height = params["max_height_difference"]
    if params["elevation_policy"] == "ignore" and height is not None:
        raise ValueError("ignore elevation requires max_height_difference=null")
    if params["elevation_policy"] == "limit" and (not _number(height) or height < 0):
        raise ValueError("limit elevation requires a nonnegative native-height-unit difference")
    return params


def _crossover_options(options, level=False):
    schema = _DESCRIPTOR["levelling_parameters" if level else "crossover_parameters"]
    if type(options) is not dict or options.keys() - schema["properties"].keys():
        raise ValueError("crossover/levelling options require known names")
    params = _json(options)
    if any(name not in params for name in schema["required"]):
        raise _NeedsInput("supply all explicit geometry, elevation and (for levelling) role/quality/event options")
    _crossover_values(params)
    if not level:
        return params
    for name in ("reference_lines", "target_lines"):
        values = params[name]
        if type(values) is not list or not values or not all(_label(v) for v in values) or len(values) != len(set(values)):
            raise ValueError("reference_lines/target_lines must be nonempty unique label lists")
    if len(params["reference_lines"]) + len(params["target_lines"]) > _LIMITS["max_crossover_lines"]:
        raise _ResourceError("levelling accepts at most 128 lines")
    if set(params["reference_lines"]) & set(params["target_lines"]):
        raise ValueError("reference and target line roles must be disjoint")
    for name, upper in (("min_crossovers", 8192), ("min_reference_lines", len(params["reference_lines"]))):
        value = params[name]
        if not _number(value) or value != int(value) or not 1 <= value <= upper:
            raise ValueError("min_crossovers/min_reference_lines must be positive integers within available bounds")
        params[name] = int(value)
    if not all(_number(params[name]) and params[name] >= 0 for name in ("max_abs_correction", "max_rms_residual")):
        raise ValueError("levelling quality bounds must be finite nonnegative nT")
    if not _label(params["event_id"]) or not _evidence(params["evidence"]):
        raise ValueError("event_id/evidence require nonempty bounded strings")
    return params


def _levelling_options(options):
    return _crossover_options(options, level=True)


def _crossover_context(data, params):
    if len(data["records"]) > _LIMITS["max_crossover_records"]:
        raise _ResourceError("crossovers/levelling accept at most 4096 records")
    if params["channel"] not in data["channels"]:
        raise ValueError("select a declared scalar observation channel")
    trim = baselode.geophysics.observations._trim
    try:
        unit = baselode.geophysics.processing._coordinate_unit(types.SimpleNamespace(crs=trim(data["crs"]), metadata={"crs_units": trim(data["crs_units"])}))
    except ValueError as error:
        raise _NeedsInput("crossovers require projected/local Cartesian coordinates with matching linear units") from error
    if unit not in ("m", "ft", "us-ft", "km"):
        raise _NeedsInput("declare projected/local linear coordinate units")
    height = None
    if params["elevation_policy"] == "limit":
        metadata = data["metadata"]
        if not _label(metadata.get("height_datum")) or trim(metadata["height_datum"]).lower() in ("unknown", "unspecified") or metadata.get("z_positive") not in ("up", "down"):
            raise _NeedsInput("height-limited crossovers need a known height_datum and explicit up/down z_positive")
        try:
            hunit = baselode.geophysics.processing._coordinate_unit(types.SimpleNamespace(crs=None, metadata={"crs_units": trim(metadata.get("height_units"))}))
        except ValueError as error:
            raise _NeedsInput("height-limited crossovers require declared linear height_units") from error
        if hunit not in ("m", "ft", "us-ft", "km"):
            raise _NeedsInput("height-limited crossovers require declared linear height_units")
        height = [hunit, metadata["height_datum"], metadata["z_positive"]]
    return [unit, height]


def _crossover_prepare(data, params):
    context = _crossover_context(data, params)
    for row in data["records"]:
        if row["x"] is None or row["y"] is None or row["line_id"] is None:
            raise _NeedsInput("every crossover record requires XY and a line_id, including missing-reading markers")
        if abs(row["x"]) > 1e12 or abs(row["y"]) > 1e12:
            raise ValueError("crossover XY coordinates must be within +/-1e12")
    return context


def _levelling_binding(data, params, offsets):
    context = _crossover_context(data, params)
    roles = params["reference_lines"] + params["target_lines"]
    actual = {row["line_id"] for row in data["records"]}
    if actual != set(roles):
        raise ValueError("reference/target roles must cover exactly every observation line_id")
    if type(offsets) is not list or len(offsets) != len(roles):
        raise ValueError("line_offsets must contain every reference then target in declared order")
    for index, item in enumerate(offsets):
        if type(item) is not dict or set(item) != {"line_id", "bias_nT"} or item["line_id"] != roles[index] or not _number(item["bias_nT"]):
            raise ValueError("invalid canonical line-offset model")
        if (index < len(params["reference_lines"]) and item["bias_nT"] != 0) or abs(item["bias_nT"]) > params["max_abs_correction"]:
            raise ValueError("reference offsets must be zero and target offsets within the declared limit")
    def hex_number(value):
        return struct.pack(">d", 0.0 if value == 0 else float(value)).hex()
    snapshot = ["baselode.levelling_binding.v1", params["channel"], *[hex_number(params[k]) for k in ("max_segment_length", "min_crossing_angle", "intersection_tolerance")], params["elevation_policy"],
                None if params["max_height_difference"] is None else hex_number(params["max_height_difference"]), params["reference_lines"], params["target_lines"], params["min_crossovers"], params["min_reference_lines"],
                hex_number(params["max_abs_correction"]), hex_number(params["max_rms_residual"]), context, [[item["line_id"], hex_number(item["bias_nT"])] for item in offsets]]
    encoded = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > _LIMITS["max_binding_bytes"]:
        raise _ResourceError("levelling model binding exceeds 32 MiB")
    return hashlib.sha256(encoded).hexdigest()


def _application_counts(data, entries):
    # Reconstruct counts at each application, rather than compare historical
    # events to today's nonnull count after a later explicit lag mask.
    counts = {name: sum(row["values"][name] is not None for row in data["records"]) for name in data["channels"]}
    rows = {row["id"]: row for row in data["records"]}
    expected, seen_masks = {}, set()
    for index in range(len(entries) - 1, -1, -1):
        entry = entries[index]
        if type(entry) is not dict or entry.get("kind") != "application":
            continue
        channels = entry.get("channels")
        if type(channels) is not list or len(channels) != 1 or not isinstance(channels[0], str) or channels[0] not in counts:
            continue  # Full event validation below reports the malformed shape.
        channel = channels[0]
        if entry.get("correction") == "magnetic_lag":
            masked = entry.get("masked_records")
            if type(masked) is not list or len(masked) > _LIMITS["max_lag_records"]:
                raise ValueError("lag masked_records must be a bounded list")
            for item in masked:
                if type(item) is not dict or set(item) != {"id", "value"} or not _label(item["id"]) or item["id"] not in rows or not _number(item["value"]):
                    raise ValueError("lag masked_records need existing IDs and finite original values")
                key = (channel, item["id"])
                if key in seen_masks or rows[item["id"]]["values"][channel] is not None:
                    raise ValueError("lag masks must be unique per channel and remain null in current observations")
                seen_masks.add(key)
            counts[channel] += len(masked)
        expected[index] = counts[channel]
    return expected


def _validate(data, ledger, current, check_summary=True):
    fields = {"schema", "version", "algorithm", "initial_binding", "current_binding", "entries"}
    if type(ledger) is not dict or set(ledger) != fields or ledger["schema"] != _SCHEMA or type(ledger["version"]) not in (int, float) or ledger["version"] != 1 or ledger["algorithm"] != _ALGORITHM:
        raise ValueError("unsupported or malformed correction ledger")
    if not _digest(ledger["initial_binding"]) or not _digest(ledger["current_binding"]):
        raise ValueError("ledger bindings must be lowercase SHA-256 digests")
    if type(ledger["entries"]) is not list:
        raise ValueError("correction ledger entries must be a list")
    if len(ledger["entries"]) > _LIMITS["max_events"]:
        raise _ResourceError("correction ledger exceeds 64 events")
    common = {"id", "kind", "correction", "channels", "state", "evidence", "producer", "input_binding", "output_binding"}
    base_extra = {"parameters", "base_binding", "base_station_id", "affected_records"}
    igrf_extra = {"parameters", "model", "affected_records"}
    frames = _reprojection_frames(data, ledger["entries"])
    counts = _application_counts(data, ledger["entries"])
    states = _states(data, {"entries": []})
    previous, ids = ledger["initial_binding"], set()
    for index, entry in enumerate(ledger["entries"]):
        if type(entry) is dict and entry.get("kind") == "reprojection":
            if entry["id"] in ids or entry["input_binding"] != previous:
                raise ValueError("duplicate event ID or broken reprojection binding chain")
            ids.add(entry["id"])
            previous = entry["output_binding"]
            continue
        extras = {"magnetic_igrf": igrf_extra, "magnetic_lag": {"parameters", "masked_records", "affected_records"}, "magnetic_heading": {"parameters", "heading_binding", "affected_records"}, "magnetic_levelling": {"parameters", "line_offsets", "levelling_binding", "affected_records"}}
        name = entry.get("correction") if type(entry) is dict else None
        extra = extras.get(name, base_extra) if isinstance(name, str) else base_extra
        if type(entry) is not dict or entry.get("kind") not in ("declaration", "application") or set(entry) != common | (extra if entry["kind"] == "application" else set()):
            raise ValueError("malformed correction ledger event")
        correction = entry["correction"]
        if not isinstance(correction, str) or correction not in states or not _label(entry["id"]) or entry["id"] in ids or not _evidence(entry["evidence"]):
            raise ValueError("ledger events need unique IDs, registered correction and bounded evidence")
        ids.add(entry["id"])
        channels = entry["channels"]
        if type(channels) is not list or not channels or not all(isinstance(name, str) and name in states[correction] for name in channels) or len(channels) != len(set(channels)):
            raise ValueError("ledger event channels must be unique and applicable to the correction family")
        if entry["state"] not in ("unknown", "unapplied", "applied") or entry["input_binding"] != previous or not _digest(entry["output_binding"]):
            raise ValueError("invalid ledger state or broken binding chain")
        producer = entry["producer"]
        if type(producer) is not dict or set(producer) != {"library", "version", "algorithm_version"} or producer["library"] != "baselode" or not _label(producer["version"]) or type(producer["algorithm_version"]) not in (int, float) or producer["algorithm_version"] != 1:
            raise ValueError("invalid ledger producer/version")
        if entry["kind"] == "declaration":
            if entry["output_binding"] != previous or any(states[correction][name] != "unknown" and states[correction][name] != entry["state"] for name in channels):
                raise ValueError("declarations cannot change data or reset known correction history")
        else:
            try:
                params = {"magnetic_igrf": _igrf_options, "magnetic_lag": _lag_options, "magnetic_heading": _heading_options, "magnetic_levelling": _levelling_options}.get(correction, _base_options)(entry["parameters"])
            except _NeedsInput as error:
                raise ValueError("invalid stored application parameters: " + str(error)) from error
            count = counts.get(index)
            if correction not in ("magnetic_diurnal", "magnetic_igrf", "magnetic_lag", "magnetic_heading", "magnetic_levelling") or len(channels) != 1 or entry["state"] != "applied" or any(states[correction][name] != "unapplied" for name in channels):
                raise ValueError("application requires unapplied supported correction history for one channel")
            if params["channel"] != channels[0] or params["event_id"] != entry["id"] or params["evidence"] != entry["evidence"]:
                raise ValueError("application parameters do not match the ledger event")
            if correction == "magnetic_diurnal" and (not _digest(entry["base_binding"]) or not _label(entry["base_station_id"])):
                raise ValueError("invalid base application binding/station")
            if correction == "magnetic_igrf" and entry["model"] != _DESCRIPTOR["igrf_model"]["const"]:
                raise ValueError("invalid IGRF model/coefficient/convention identity")
            if correction == "magnetic_lag" and ((params["unsupported_policy"] == "reject" and entry["masked_records"]) or count <= len(entry["masked_records"])):
                raise ValueError("lag masks require explicit mask policy and at least one supported reading")
            if correction == "magnetic_heading":
                try:
                    heading_binding = _heading_binding(data, params)
                except _NeedsInput as error:
                    raise ValueError("invalid stored heading context: " + str(error)) from error
                if not _digest(entry["heading_binding"]) or entry["heading_binding"] != heading_binding:
                    raise ValueError("stale heading binding: heading inputs, context or calibration changed")
            if correction == "magnetic_levelling":
                try:
                    model_binding = _levelling_binding({**data, **frames[index]}, params, entry["line_offsets"])
                except _NeedsInput as error:
                    raise ValueError("invalid stored levelling context: " + str(error)) from error
                if not _digest(entry["levelling_binding"]) or entry["levelling_binding"] != model_binding:
                    raise ValueError("stale levelling binding: line roles/model, semantic options or context changed")
            if type(entry["affected_records"]) not in (int, float) or entry["affected_records"] != count or count < 1:
                raise ValueError("application must account for every nonnull channel reading immediately before that event")
        for name in channels:
            states[correction][name] = entry["state"]
        previous = entry["output_binding"]
    if previous != ledger["current_binding"] or current != previous:
        raise ValueError("stale ledger binding: observation data changed; use a traceable source dataset")
    if not check_summary:
        return ledger
    legacy = data["metadata"].get("corrections", {})
    represented = {entry["correction"] for entry in ledger["entries"] if entry["kind"] != "reprojection"}
    for correction in represented:
        if correction not in legacy:
            raise ValueError("legacy correction summary is missing a ledger correction")
    for key, state in legacy.items():
        correction = _canonical(key)
        if correction is not None and states[correction]:
            values = set(states[correction].values())
            aggregate = next(iter(values)) if len(values) == 1 else "unknown"
            if state != aggregate:
                raise ValueError("legacy correction summary conflicts with ledger channel states")
    return ledger


def _load(data):
    current = _binding(data)
    baselode.geophysics.provenance.encode(data["metadata"], "GeoTIFF", "float64")
    if "correction_ledger" in data["metadata"]:
        return _validate(data, copy.deepcopy(data["metadata"]["correction_ledger"]), current)
    if any(step["operation"] in ("correct_magnetic_base", "remove_igrf", "correct_magnetic_lag", "correct_magnetic_heading", "level_magnetic_lines", "reproject_observations") for step in data["metadata"].get("processing", [])):
        raise ValueError("processing records a correction but its ledger is missing; restore the bound document instead of declaring unapplied")
    ledger = {"schema": _SCHEMA, "version": 1, "algorithm": _ALGORITHM, "initial_binding": current, "current_binding": current, "entries": []}
    groups = {}
    for alias, state in data["metadata"].get("corrections", {}).items():
        correction = _canonical(alias)
        if correction is not None and _channels(data, correction):
            groups.setdefault(correction, []).append((alias, state))
    for correction in sorted(groups):
        pairs = groups[correction]
        if len({state for alias, state in pairs}) != 1:
            raise ValueError("conflicting legacy correction aliases require explicit source-history repair")
        ledger["entries"].append({"id": "legacy:" + correction, "kind": "declaration", "correction": correction, "channels": _channels(data, correction), "state": pairs[0][1],
                                  "evidence": "Imported metadata.corrections for " + correction + " (" + str(len(pairs)) + " aliases)", "producer": _producer(), "input_binding": current, "output_binding": current})
    return _validate(data, ledger, current, check_summary=False)


def _save(data, ledger):
    if len(ledger["entries"]) > _LIMITS["max_events"]:
        raise _ResourceError("correction ledger exceeds 64 events")
    _validate(data, ledger, _binding(data), check_summary=False)
    states = _states(data, ledger)
    legacy = data["metadata"].setdefault("corrections", {})
    represented = {entry["correction"] for entry in ledger["entries"] if entry["kind"] != "reprojection"}
    for key in list(legacy) + sorted(represented):
        correction = _canonical(key)
        if correction is not None and states[correction]:
            values = set(states[correction].values())
            legacy[key] = next(iter(values)) if len(values) == 1 else "unknown"
    data["metadata"]["correction_ledger"] = ledger
    if len(json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")) > _LIMITS["max_output_json_bytes"]:
        raise _ResourceError("output observations including lineage exceed the 16 MiB JSON limit")
    baselode.geophysics.provenance.encode(data["metadata"], "GeoTIFF", "float64")
    return baselode.geophysics.observations.create_observations(data)


def inspect_corrections(payload):
    """Inspect validated per-channel correction history without modifying input.

    Parameters
    ----------
    payload : dict
        V1 observations, with optional bound ledger or legacy correction map.

    Returns
    -------
    dict
        Structured state/issues, independent ledger and per-channel states.
        Absent history is unknown. Legacy aliases are conservatively imported.
    """
    report = _report("inspect")
    try:
        data = baselode.geophysics.observations.create_observations(payload)
        ledger = _load(data)
        report.update(ledger=ledger, states=_states(data, ledger))
        return report
    except (ValueError, TypeError, RecursionError) as error:
        return _error(report, error)


def declare_corrections(payload, declarations):
    """Append evidence-backed correction state declarations on a copied payload.

    Parameters
    ----------
    payload : dict
        V1 observations. Existing bindings/history must validate.
    declarations : list of dict
        Each has id, registered correction, applicable channels, state and
        evidence. Known states cannot transition to a different state.

    Returns
    -------
    dict
        Structured report with observations on success, otherwise None.
        Values are unchanged; declarations do not perform corrections.
    """
    report = _report("declare")
    try:
        data = baselode.geophysics.observations.create_observations(payload)
        ledger = _load(data)
        declarations = _json(declarations)
        if type(declarations) is not list or not declarations:
            raise ValueError("declarations must be a nonempty list")
        if len(declarations) + len(ledger["entries"]) > _LIMITS["max_events"]:
            raise _ResourceError("declarations exceed the 64-event ledger limit")
        for item in declarations:
            if type(item) is not dict or set(item) != {"id", "correction", "channels", "state", "evidence"}:
                raise ValueError("declarations need exactly id, correction, channels, state and evidence")
            ledger["entries"].append({**item, "kind": "declaration", "producer": _producer(), "input_binding": ledger["current_binding"], "output_binding": ledger["current_binding"]})
        # Sync the scalar summary only after checking event transitions. The
        # validator receives a consistent candidate summary, never caller data.
        output = _save(data, ledger)
        _validate(output, ledger, _binding(output))
        report.update(observations=output, ledger=copy.deepcopy(ledger), states=_states(output, ledger), parameters={"declarations": declarations})
        return report
    except (ValueError, TypeError, RecursionError) as error:
        return _error(report, error)


def correct_magnetic_base(payload, base, options):
    """Subtract synchronized base variation with all-or-nothing coverage/history.

    Parameters
    ----------
    payload, base : dict
        Survey/base v1 observations, never modified. Survey channel is magnetic
        total field/anomaly; base channel is stationary magnetic total field.
        Both use nT and UTC Unix seconds. Base station_id must be consistent.
    options : dict
        channel, base_channel, reference (nT), max_gap (seconds), event_id,
        evidence and explicit clock_policy='synchronized'. No extrapolation.

    Returns
    -------
    dict
        Structured state/issues, per-reading proposals and corrected observations
        only when every nonnull selected reading is supported and prior history
        is unapplied. Missing readings stay null; field type/units are retained.
    """
    report = _report("magnetic_base")
    try:
        data = baselode.geophysics.observations.create_observations(payload)
        monitor = baselode.geophysics.observations.create_observations(base)
        params = _base_options(options)
        report["parameters"] = params
        ledger = _load(data)
        monitor_ledger = _load(monitor)
        base_binding = monitor_ledger["current_binding"]
        channel, base_channel = params["channel"], params["base_channel"]
        if channel not in data["channels"] or base_channel not in monitor["channels"]:
            raise ValueError("selected channel/base_channel must be declared")
        trim = baselode.geophysics.observations._trim
        if data["channels"][channel]["field_type"] not in ("magnetic_total_field", "magnetic_anomaly") or monitor["channels"][base_channel]["field_type"] != "magnetic_total_field":
            raise ValueError("survey must be magnetic total field/anomaly and base must be magnetic total field")
        if trim(data["channels"][channel]["units"]) != "nT" or trim(monitor["channels"][base_channel]["units"]) != "nT":
            raise ValueError("selected survey/base channels require nT; convert units explicitly first")
        base_state = _states(monitor, monitor_ledger)["magnetic_diurnal"][base_channel]
        if base_state == "unknown":
            raise _NeedsInput("declare evidence-backed unapplied magnetic_diurnal history for the base stream")
        if base_state != "unapplied":
            raise ValueError("base stream magnetic_diurnal is already applied; use the uncorrected monitor")
        if any(entry["id"] == params["event_id"] for entry in ledger["entries"]):
            raise ValueError("event_id already exists in the correction ledger")
        state = _states(data, ledger)["magnetic_diurnal"][channel]
        if state == "unknown":
            raise _NeedsInput("declare evidence-backed unapplied magnetic_diurnal history before correction")
        if state != "unapplied":
            raise ValueError("magnetic_diurnal is already applied; repeated correction is rejected")
        records = monitor["records"]
        if not records or any(row["time"] is None for row in records):
            raise _NeedsInput("every base record needs a UTC Unix time, including missing-reading gap markers")
        times = [float(row["time"]) for row in records]
        if any(right <= left for left, right in zip(times, times[1:])):
            raise ValueError("base times must increase strictly; duplicate/nonmonotonic samples require input QC")
        stations = {row["station_id"] for row in records}
        if len(stations) != 1 or None in stations:
            raise ValueError("base records must identify one nonnull stationary station_id")
        if any(len({row[axis] for row in records if row[axis] is not None}) > 1 for axis in ("x", "y", "z")):
            raise ValueError("base positions must be stationary; moving XYZ samples are not a base station")
        readings = [row for row in data["records"] if row["values"][channel] is not None]
        if not readings:
            raise _NeedsInput("selected survey channel needs at least one nonnull reading")
        for row in readings:
            time = row["time"]
            predicted, reason = None, None
            if time is None:
                reason = "missing_time"
            else:
                t = float(time)
                index = bisect.bisect_left(times, t)
                if index < len(times) and times[index] == t:
                    predicted = records[index]["values"][base_channel]
                    if predicted is None:
                        reason = "missing_base_reading"
                elif index == 0 or index == len(times):
                    reason = "outside_base_span"
                else:
                    before, after = records[index - 1]["values"][base_channel], records[index]["values"][base_channel]
                    gap = times[index] - times[index - 1]
                    if before is None or after is None:
                        reason = "missing_base_reading"
                    elif gap > params["max_gap"]:
                        reason = "excessive_base_gap"
                    else:
                        weight = (t - times[index - 1]) / gap
                        predicted = float(before) + (float(after) - float(before)) * weight
            variation = float(predicted) - float(params["reference"]) if predicted is not None else None
            corrected = float(row["values"][channel]) - variation if variation is not None else None
            if corrected is not None and (not _number(variation) or not _number(corrected)):
                raise ValueError("base variation/corrected values exceed portable numeric range")
            report["proposals"].append({"id": row["id"], "time": time, "base_value": predicted, "variation": variation, "corrected": corrected, "supported": reason is None, "reason": reason})
        supported = sum(item["supported"] for item in report["proposals"])
        report["diagnostics"] = {"selected_readings": len(readings), "supported_readings": supported, "missing_readings": len(data["records"]) - len(readings),
                                  "base_records": len(records), "base_station_id": next(iter(stations)), "base_binding": base_binding, "uncertainty_propagated": False}
        if supported != len(readings):
            raise _NeedsInput("base coverage is incomplete; no corrected observations or application event committed")
        before_binding = ledger["current_binding"]
        for row, proposal in zip(readings, report["proposals"]):
            row["values"][channel] = proposal["corrected"]
        output_binding = _binding(data)
        ledger["entries"].append({"id": params["event_id"], "kind": "application", "correction": "magnetic_diurnal", "channels": [channel], "state": "applied", "evidence": params["evidence"],
                                  "producer": _producer(), "input_binding": before_binding, "output_binding": output_binding, "parameters": params, "base_binding": base_binding,
                                  "base_station_id": next(iter(stations)), "affected_records": len(readings)})
        ledger["current_binding"] = output_binding
        metadata = data["metadata"]
        nodes, source_operand = baselode.geophysics.provenance.append_input(metadata, metadata)
        metadata["input_lineage"] = nodes
        nodes, base_operand = baselode.geophysics.provenance.append_input(metadata, monitor["metadata"])
        metadata["input_lineage"] = nodes
        for key in ("uncertainty", "variance", "standard_deviation"):
            metadata.pop(key, None)
        metadata["uncertainty_propagated"] = False
        metadata["processing"] = list(metadata.get("processing", [])) + [{"operation": "magnetic_base_input", "version": 1, "event_id": params["event_id"], "input_binding": before_binding, "operand_lineage": source_operand}, {"operation": "correct_magnetic_base", "version": 1, "parameters": params, "input_binding": before_binding, "output_binding": output_binding,
                                                                        "base_binding": base_binding, "operand_lineage": base_operand}]
        output = _save(data, ledger)
        _validate(output, ledger, output_binding)
        report.update(observations=output, ledger=copy.deepcopy(ledger), states=_states(output, ledger))
        return report
    except (ValueError, TypeError, RecursionError) as error:
        return _error(report, error)


def correct_magnetic_lag(payload, options):
    """Align one magnetic signal to unchanged navigation with a calibrated lag.

    Parameters
    ----------
    payload : dict
        V1 observations, never modified. Selected channel is total field or
        magnetic anomaly in nT. Every record needs line_id and UTC Unix time;
        times must increase within each acquisition-contiguous line segment.
    options : dict
        channel, lag_seconds (within +/-3600), positive max_gap in seconds,
        unsupported_policy='reject' or 'mask', event_id, calibration evidence,
        clock_policy='synchronized'. corrected(t)=input(t+lag_seconds): positive
        lag advances delayed magnetic readings. No automatic lag estimation.

    Returns
    -------
    dict
        V1 correction report with per-reading original/proposed values, support
        and diagnostics. No extrapolation, cross-segment interpolation or
        bridging null source readings/excessive gaps. Existing target nulls
        stay null. Reject policy commits nothing on incomplete coverage; mask
        explicitly archives unsupported original values in the ledger and
        requires at least one supported reading. Records, order, XYZ/time and
        other channels are retained. No uncertainty propagation is inferred.
    """
    report = _report("magnetic_lag")
    try:
        params = _lag_options(options)
        report["parameters"] = params
        data = baselode.geophysics.observations.create_observations(payload)
        if len(data["records"]) > _LIMITS["max_lag_records"]:
            raise _ResourceError("lag correction accepts at most 4096 records; partition explicitly")
        channel = params["channel"]
        if channel not in data["channels"] or data["channels"][channel]["field_type"] not in ("magnetic_total_field", "magnetic_anomaly") or baselode.geophysics.observations._trim(data["channels"][channel]["units"]) != "nT":
            raise ValueError("lag correction requires a magnetic total-field/anomaly channel in nT")
        ledger = _load(data)
        if any(entry["id"] == params["event_id"] for entry in ledger["entries"]):
            raise ValueError("event_id already exists in the correction ledger")
        state = _states(data, ledger)["magnetic_lag"][channel]
        if state == "unknown":
            raise _NeedsInput("declare evidence-backed unapplied magnetic_lag history before correction")
        if state != "unapplied":
            raise ValueError("magnetic_lag is already applied; repeated correction is rejected")
        segments = []
        for row in data["records"]:
            if row["line_id"] is None or row["time"] is None:
                raise _NeedsInput("every lag record needs line_id and UTC time, including null-reading gap markers")
            if not segments or segments[-1][-1]["line_id"] != row["line_id"]:
                segments.append([])
            segment = segments[-1]
            if segment and row["time"] <= segment[-1]["time"]:
                raise ValueError("times must increase strictly within each contiguous line segment; run acquisition QC")
            segment.append(row)
        selected = sum(row["values"][channel] is not None for row in data["records"])
        if selected == 0:
            raise _NeedsInput("selected channel needs at least one nonnull reading")
        # Build all proposals against the untouched source, before assignment.
        for segment_index, segment in enumerate(segments):
            times = [float(row["time"]) for row in segment]
            for row in segment:
                original = row["values"][channel]
                if original is None:
                    continue
                query = float(row["time"]) + params["lag_seconds"]
                if not _number(query) or (params["lag_seconds"] != 0 and query == float(row["time"])):
                    raise ValueError("lag-shifted UTC time is outside portable range or below timestamp precision")
                index = bisect.bisect_left(times, query)
                value, reason, source_ids, weight = None, None, [], None
                if index < len(times) and times[index] == query:
                    value = segment[index]["values"][channel]
                    source_ids, weight = [segment[index]["id"]], 0.0
                    if value is None:
                        reason = "missing_source_reading"
                elif index == 0 or index == len(times):
                    reason = "outside_segment"
                else:
                    left, right = segment[index - 1], segment[index]
                    source_ids = [left["id"], right["id"]]
                    gap = times[index] - times[index - 1]
                    if left["values"][channel] is None or right["values"][channel] is None:
                        reason = "missing_source_reading"
                    elif gap > params["max_gap"]:
                        reason = "excessive_gap"
                    else:
                        weight = (query - times[index - 1]) / gap
                        value = float(left["values"][channel]) + (float(right["values"][channel]) - float(left["values"][channel])) * weight
                if value is not None and not _number(value):
                    raise ValueError("interpolated magnetic reading exceeds portable numeric range")
                report["proposals"].append({"id": row["id"], "line_id": row["line_id"], "segment": segment_index, "time": row["time"], "source_time": query,
                                            "original": original, "corrected": value, "source_ids": source_ids, "weight": weight, "supported": reason is None, "reason": reason})
        supported = sum(p["supported"] for p in report["proposals"])
        report["diagnostics"] = {"selected_readings": selected, "supported_readings": supported, "unsupported_readings": selected - supported,
                                  "missing_readings": len(data["records"]) - selected, "segments": len(segments), "uncertainty_propagated": False}
        if supported == 0 or (supported != selected and params["unsupported_policy"] == "reject"):
            raise _NeedsInput("lag coverage is incomplete or empty; no corrected observations or application event committed")
        masked = [{"id": p["id"], "value": p["original"]} for p in report["proposals"] if not p["supported"]]
        proposals = {p["id"]: p for p in report["proposals"]}
        before = ledger["current_binding"]
        for row in data["records"]:
            if row["id"] in proposals:
                row["values"][channel] = proposals[row["id"]]["corrected"]
        after = _binding(data)
        ledger["entries"].append({"id": params["event_id"], "kind": "application", "correction": "magnetic_lag", "channels": [channel], "state": "applied", "evidence": params["evidence"],
                                  "producer": _producer(), "input_binding": before, "output_binding": after, "parameters": params, "masked_records": masked, "affected_records": selected})
        ledger["current_binding"] = after
        metadata = data["metadata"]
        nodes, source_operand = baselode.geophysics.provenance.append_input(metadata, metadata)
        metadata["input_lineage"] = nodes
        for key in ("uncertainty", "variance", "standard_deviation"):
            metadata.pop(key, None)
        metadata["uncertainty_propagated"] = False
        metadata["processing"] = list(metadata.get("processing", [])) + [{"operation": "correct_magnetic_lag", "version": 1, "parameters": params, "input_binding": before, "output_binding": after, "operand_lineage": source_operand}]
        output = _save(data, ledger)
        _validate(output, ledger, after)
        report.update(observations=output, ledger=copy.deepcopy(ledger), states=_states(output, ledger))
        return report
    except (ValueError, TypeError, RecursionError) as error:
        return _error(report, error)


def correct_magnetic_heading(payload, options):
    """Subtract a calibrated scalar heading bias with atomic circular support.

    Parameters
    ----------
    payload : dict
        V1 observations, never modified. One nT total-field/anomaly channel;
        headings in record.extra[heading_key], degrees clockwise from the
        declared north reference. metadata.heading declares key, units,
        reference and positive. Missing magnetic readings remain null.
    options : dict
        channel, heading_key, heading_reference, calibration_id, calibration
        [{heading_degrees,bias_nT}], max_heading_gap in (0,180] degrees,
        bias_convention='observed_minus_reference', event_id and evidence.
        Calibration nodes are copied, checked and sorted; 360 is not a node,
        but recorded 360-degree headings evaluate as north (0).

    Returns
    -------
    dict
        Correction report with original/proposed values, bias, circular bracket,
        weights and support. Every nonnull selected reading must be supported
        before observations/ledger are committed. Exact nodes are supported;
        interpolated brackets must meet the gap limit, including through north.
        Model/headings/context are bound alongside standard observation data;
        editing them invalidates history, including after later lag masks.
        Geometry/time, field types, other channels, order and extras remain.
        No fitted calibration, frame conversion or uncertainty propagation.
    """
    report = _report("magnetic_heading")
    try:
        params = _heading_options(options)
        report["parameters"] = params
        data = baselode.geophysics.observations.create_observations(payload)
        if len(data["records"]) > _LIMITS["max_heading_records"]:
            raise _ResourceError("heading correction accepts at most 4096 records")
        channel = params["channel"]
        if channel not in data["channels"] or data["channels"][channel]["field_type"] not in ("magnetic_total_field", "magnetic_anomaly") or baselode.geophysics.observations._trim(data["channels"][channel]["units"]) != "nT":
            raise ValueError("heading correction requires a magnetic total-field/anomaly channel in nT")
        ledger = _load(data)
        if any(entry["id"] == params["event_id"] for entry in ledger["entries"]):
            raise ValueError("event_id already exists in the correction ledger")
        state = _states(data, ledger)["magnetic_heading"][channel]
        if state == "unknown":
            raise _NeedsInput("declare evidence-backed unapplied magnetic_heading history before correction")
        if state != "unapplied":
            raise ValueError("magnetic_heading is already applied; repeated correction is rejected")
        heading_binding = _heading_binding(data, params)
        nodes = params["calibration"]
        angles = [node["heading_degrees"] for node in nodes]
        readings = [row for row in data["records"] if row["values"][channel] is not None]
        if not readings:
            raise _NeedsInput("selected channel needs at least one nonnull reading")
        for row in readings:
            heading = row["extra"].get(params["heading_key"])
            h = 0.0 if heading == 360 else heading
            bias, reason, bracket, gap, weight = None, None, [], None, None
            if h is None:
                reason = "missing_heading"
            else:
                index = bisect.bisect_left(angles, h)
                if index < len(angles) and angles[index] == h:
                    bias, bracket, gap, weight = nodes[index]["bias_nT"], [h], 0.0, 0.0
                else:
                    left, right = nodes[index - 1], nodes[index % len(nodes)]
                    start = left["heading_degrees"]
                    end = right["heading_degrees"] + (360 if index in (0, len(nodes)) else 0)
                    query = h + (360 if index == 0 else 0)
                    gap = end - start
                    bracket = [left["heading_degrees"], right["heading_degrees"]]
                    if gap > params["max_heading_gap"]:
                        reason = "excessive_heading_gap"
                    else:
                        weight = (query - start) / gap
                        bias = float(left["bias_nT"]) + (float(right["bias_nT"]) - float(left["bias_nT"])) * weight
            original = row["values"][channel]
            value = float(original) - float(bias) if bias is not None else None
            if bias is not None and (not _number(bias) or not _number(value)):
                raise ValueError("heading bias/corrected value exceeds portable numeric range")
            report["proposals"].append({"id": row["id"], "heading_degrees": h, "original": original, "bias_nT": bias, "corrected": value,
                                        "calibration_headings": bracket, "angular_gap": gap, "weight": weight, "supported": reason is None, "reason": reason})
        supported = sum(p["supported"] for p in report["proposals"])
        report["diagnostics"] = {"selected_readings": len(readings), "supported_readings": supported, "missing_readings": len(data["records"]) - len(readings),
                                  "calibration_nodes": len(nodes), "heading_binding": heading_binding, "uncertainty_propagated": False}
        if supported != len(readings):
            raise _NeedsInput("heading support is incomplete; no corrected observations or application event committed")
        before = ledger["current_binding"]
        for row, proposal in zip(readings, report["proposals"]):
            row["values"][channel] = proposal["corrected"]
        after = _binding(data)
        ledger["entries"].append({"id": params["event_id"], "kind": "application", "correction": "magnetic_heading", "channels": [channel], "state": "applied", "evidence": params["evidence"],
                                  "producer": _producer(), "input_binding": before, "output_binding": after, "parameters": params, "heading_binding": heading_binding, "affected_records": len(readings)})
        ledger["current_binding"] = after
        metadata = data["metadata"]
        nodes, source_operand = baselode.geophysics.provenance.append_input(metadata, metadata)
        metadata["input_lineage"] = nodes
        for key in ("uncertainty", "variance", "standard_deviation"):
            metadata.pop(key, None)
        metadata["uncertainty_propagated"] = False
        metadata["processing"] = list(metadata.get("processing", [])) + [{"operation": "correct_magnetic_heading", "version": 1, "parameters": params, "heading_binding": heading_binding, "input_binding": before, "output_binding": after, "operand_lineage": source_operand}]
        output = _save(data, ledger)
        _validate(output, ledger, after)
        report.update(observations=output, ledger=copy.deepcopy(ledger), states=_states(output, ledger))
        return report
    except (ValueError, TypeError, RecursionError) as error:
        return _error(report, error)


def analyze_crossovers(payload, options):
    """Report scalar mis-ties at bounded XY intersections of observation lines.

    Parameters
    ----------
    payload : dict
        V1 observations in one projected/local Cartesian frame. All records need
        XY and one contiguous run per line_id. Values/heights may be missing.
    options : dict
        channel, max_segment_length, min_crossing_angle, intersection_tolerance,
        elevation_policy (ignore/limit), max_height_difference (null for ignore).
        Distances use native XY/height units. See describe_crossovers.

    Returns
    -------
    dict
        Independent JSON report with signed A-B differences, geometry, source
        brackets/fractions, support/reasons, summary and source binding. Atomic
        failures return no partial crossing table. No inputs are modified.
    """
    report = {"schema": "baselode.geophysics.crossovers", "version": 1, "operation": "analyze", "state": "ok", "issues": [], "parameters": {}, "crossovers": [], "diagnostics": {}, "summary": {}, "units": {}, "observation_binding": None, "producer": _producer(), "assumptions": describe_crossovers()["assumptions"]}
    try:
        params = _crossover_options(options)
        report["parameters"] = params
        data = baselode.geophysics.observations.create_observations(payload)
        context = _crossover_prepare(data, params)
        ledger = _load(data)
        result = baselode.geophysics.crossovers._compute(data, params)
        report.update(crossovers=result["crossovers"], diagnostics=result["diagnostics"], summary=result["summary"], observation_binding=ledger["current_binding"],
                      units={"xy": context[0], "height": context[1][0] if context[1] else (data["metadata"].get("height_units") if isinstance(data["metadata"].get("height_units"), str) else None), "field": data["channels"][params["channel"]]["units"]})
    except (ValueError, TypeError, RecursionError) as error:
        missing = isinstance(error, _NeedsInput)
        resource = isinstance(error, (_ResourceError, baselode.geophysics.crossovers._ResourceError))
        report.update(state="needs_input" if missing else "rejected", crossovers=[], observation_binding=None)
        report["issues"].append({"code": "context" if missing else ("resource" if resource else "contract"), "message": str(error)})
    return report


def level_magnetic_lines(payload, options):
    """Fit/apply one target-line DC bias relative to explicit fixed reference lines.

    Parameters
    ----------
    payload : dict
        V1 nT magnetic total-field/anomaly observations, never modified. Known
        unapplied magnetic_levelling history is required for selected channel.
    options : dict
        Crossover options plus disjoint reference_lines/target_lines covering all
        lines, min_crossovers, min_reference_lines, max_abs_correction and
        max_rms_residual in nT, event_id and evidence. See describe_crossovers.

    Returns
    -------
    dict
        Correction report with crossing diagnostics and per-line proposals. Each
        target bias is the equally weighted mean target-reference difference;
        corrected=observed-bias for the entire target line, including beyond tie
        positions. References stay fixed. Every target must pass coverage and
        quality bounds before any output/event is committed. Nulls, geometry,
        field types, extras, order and other channels remain. One DC error per
        line is assumed; no drift/microlevelling or uncertainty propagation.
    """
    report = _report("magnetic_levelling")
    report.update(crossovers=[])
    report["assumptions"] = describe_crossovers()["assumptions"]
    try:
        params = _levelling_options(options)
        report["parameters"] = params
        data = baselode.geophysics.observations.create_observations(payload)
        _crossover_prepare(data, params)
        channel = params["channel"]
        if data["channels"][channel]["field_type"] not in ("magnetic_total_field", "magnetic_anomaly") or baselode.geophysics.observations._trim(data["channels"][channel]["units"]) != "nT":
            raise ValueError("line levelling requires a magnetic total-field/anomaly channel in nT")
        ledger = _load(data)
        if any(entry["id"] == params["event_id"] for entry in ledger["entries"]):
            raise ValueError("event_id already exists in the correction ledger")
        state = _states(data, ledger)["magnetic_levelling"][channel]
        if state == "unknown":
            raise _NeedsInput("declare evidence-backed unapplied magnetic_levelling history")
        if state != "unapplied":
            raise ValueError("magnetic_levelling is already applied; repeated levelling rejected")
        roles = params["reference_lines"] + params["target_lines"]
        if {row["line_id"] for row in data["records"]} != set(roles):
            raise ValueError("reference/target roles must cover exactly every line")
        result = baselode.geophysics.crossovers._compute(data, params)
        crossings = result["crossovers"]
        report["crossovers"] = crossings
        refs, targets = set(params["reference_lines"]), set(params["target_lines"])
        errors = {line: [] for line in params["target_lines"]}
        ties = {line: set() for line in params["target_lines"]}
        for row in crossings:
            a, b = row["line_a"], row["line_b"]
            used = row["eligible"] and ((a in targets and b in refs) or (b in targets and a in refs))
            row["used_for_fit"] = used
            if used:
                target, reference, difference = (a, b, row["difference"]) if a in targets else (b, a, -row["difference"])
                errors[target].append(difference)
                ties[target].add(reference)
        biases = {line: 0.0 for line in params["reference_lines"]}
        for line in params["target_lines"]:
            values = errors[line]
            bias = baselode.geophysics.crossovers._sum(values) / len(values) if values else None
            residuals = [v - bias for v in values] if values else []
            rms = baselode.geophysics.crossovers._rms(residuals)
            if bias is not None and (not _number(bias) or not _number(rms)):
                raise ValueError("fitted line bias/residual exceeds portable numeric range")
            reason = None
            if len(values) < params["min_crossovers"] or len(ties[line]) < params["min_reference_lines"]:
                reason = "insufficient_crossovers"
            elif abs(bias) > params["max_abs_correction"]:
                reason = "excessive_correction"
            elif rms > params["max_rms_residual"]:
                reason = "excessive_residual"
            report["proposals"].append({"line_id": line, "bias_nT": bias, "crossovers": len(values), "reference_lines": [ref for ref in params["reference_lines"] if ref in ties[line]], "rms_before": baselode.geophysics.crossovers._rms(values), "rms_after": rms, "supported": reason is None, "reason": reason})
            if bias is not None:
                biases[line] = bias
        report["diagnostics"] = {**result["diagnostics"], "reference_lines": params["reference_lines"], "target_lines": params["target_lines"], "uncertainty_propagated": False}
        if any(not p["supported"] for p in report["proposals"]):
            raise _NeedsInput("every target must pass crossover coverage and correction/residual gates; no application committed")
        offsets = [{"line_id": line, "bias_nT": biases[line]} for line in roles]
        model_binding = _levelling_binding(data, params, offsets)
        before = ledger["current_binding"]
        readings = [row for row in data["records"] if row["values"][channel] is not None]
        for row in readings:
            value = float(row["values"][channel]) - biases[row["line_id"]]
            if not _number(value):
                raise ValueError("levelled values exceed portable numeric range")
            row["values"][channel] = value
        for row in crossings:
            row["difference_after"] = None if row["difference"] is None else row["difference"] - biases[row["line_a"]] + biases[row["line_b"]]
            if row["difference_after"] is not None and not _number(row["difference_after"]):
                raise ValueError("levelled crossover difference exceeds portable numeric range")
        fit_before = [row["difference"] for row in crossings if row["used_for_fit"]]
        fit_after = [row["difference_after"] for row in crossings if row["used_for_fit"]]
        report["diagnostics"].update(rms_before=baselode.geophysics.crossovers._rms(fit_before), rms_after=baselode.geophysics.crossovers._rms(fit_after), levelling_binding=model_binding)
        after = _binding(data)
        ledger["entries"].append({"id": params["event_id"], "kind": "application", "correction": "magnetic_levelling", "channels": [channel], "state": "applied", "evidence": params["evidence"], "producer": _producer(), "input_binding": before, "output_binding": after, "parameters": params, "line_offsets": offsets, "levelling_binding": model_binding, "affected_records": len(readings)})
        ledger["current_binding"] = after
        metadata = data["metadata"]
        nodes, source_operand = baselode.geophysics.provenance.append_input(metadata, metadata)
        metadata["input_lineage"] = nodes
        for key in ("uncertainty", "variance", "standard_deviation"):
            metadata.pop(key, None)
        metadata["uncertainty_propagated"] = False
        metadata["processing"] = list(metadata.get("processing", [])) + [{"operation": "level_magnetic_lines", "version": 1, "parameters": params, "line_offsets": offsets, "levelling_binding": model_binding, "input_binding": before, "output_binding": after, "operand_lineage": source_operand}]
        output = _save(data, ledger)
        _validate(output, ledger, after)
        report.update(observations=output, ledger=copy.deepcopy(ledger), states=_states(output, ledger))
        return report
    except (ValueError, TypeError, RecursionError) as error:
        return _error(report, error)


_REPROJECTION = json.loads((pathlib.Path(__file__).parent / "geophysics_reprojection.json").read_text())


def describe_reprojection():
    """Return independent horizontal observation reprojection contracts.

    Returns
    -------
    dict
        Supported WGS84 CRSs, parameter/event schemas, bounds and assumptions.
    """
    return copy.deepcopy(_REPROJECTION)


def _projection_code(crs):
    if not isinstance(crs, str) or re.fullmatch(r"EPSG:(4326|326[0-9]{2}|327[0-9]{2})", crs) is None:
        raise ValueError("reprojection supports canonical WGS84 EPSG:4326 and EPSG:32601..32660/32701..32760 only")
    code = int(crs[5:])
    if code != 4326 and not 1 <= code % 100 <= 60:
        raise ValueError("UTM zone must be 1..60")
    return code


def _projection_frame(frame):
    if type(frame) is not dict or set(frame) != {"crs", "crs_units"}:
        raise ValueError("horizontal context needs exactly crs and crs_units")
    code = _projection_code(frame["crs"])
    accepted = ("degree", "degrees") if code == 4326 else ("m", "metre", "meter")
    if frame["crs_units"] not in accepted:
        raise ValueError("declare degree/degrees for EPSG:4326 or m/metre/meter for UTM")
    return code


def _reprojection_options(options):
    schema = _REPROJECTION["parameters"]
    if type(options) is not dict or options.keys() - schema["properties"].keys():
        raise ValueError("reprojection requires known option names")
    params = _json(options)
    if any(name not in params for name in schema["required"]):
        raise _NeedsInput("supply target_crs, datum_policy=backend, event_id and evidence")
    _projection_code(params["target_crs"])
    if params["datum_policy"] != "backend":
        raise _NeedsInput("reprojection requires explicit datum_policy=backend acknowledgement")
    if not _label(params["event_id"]) or not _evidence(params["evidence"]):
        raise ValueError("event_id/evidence require bounded nonempty strings")
    return params


def _projection_area(code, lon, lat):
    tolerance = 1e-8
    if not _number(lon) or not _number(lat) or abs(lon) > 180 + tolerance or abs(lat) > 90 + tolerance:
        raise ValueError("coordinates must resolve to finite WGS84 longitude/latitude in range")
    if code != 4326:
        center = 6 * (code % 100) - 183
        south = code // 100 == 327
        if abs(lon - center) > 3 + tolerance or lat < (-80 if south else 0) - tolerance or lat > (0 if south else 84) + tolerance:
            raise ValueError("coordinates lie outside the declared UTM six-degree zone/hemisphere/latitude domain")


def _reprojection_hash(entry):
    snapshot = ["baselode.reprojection_binding.v1", *[entry[k] for k in ("id", "evidence", "input_binding", "output_binding")],
                [entry["parameters"][k] for k in ("target_crs", "datum_policy", "event_id", "evidence")],
                *[[entry[k][field] for field in ("crs", "crs_units")] for k in ("source", "target")],
                [entry["backend"][k] for k in ("name", "version", "proj_version")], entry["transformed_records"]]
    return hashlib.sha256(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()


def _reprojection_frames(data, entries):
    # Reverse only the horizontal context; measurements, heights, acquisition
    # headings and line identities are unchanged by a reprojection event.
    frame = {k: data[k] for k in ("crs", "crs_units")}
    frames = [None] * len(entries)
    for index in range(len(entries) - 1, -1, -1):
        entry = entries[index]
        if type(entry) is dict and entry.get("kind") == "reprojection":
            fields = {"id", "kind", "evidence", "producer", "input_binding", "output_binding", "parameters", "source", "target", "backend", "transformed_records", "transform_binding"}
            if set(entry) != fields or not _label(entry["id"]) or not _evidence(entry["evidence"]) or not all(_digest(entry[k]) for k in ("input_binding", "output_binding", "transform_binding")):
                raise ValueError("malformed reprojection event")
            params = _reprojection_options(entry["parameters"])
            _projection_frame(entry["source"])
            target_code = _projection_frame(entry["target"])
            if params["event_id"] != entry["id"] or params["evidence"] != entry["evidence"] or params["target_crs"] != entry["target"]["crs"] or entry["target"]["crs_units"] != ("degree" if target_code == 4326 else "m") or entry["target"] != frame:
                raise ValueError("broken reprojection parameter/context chain")
            backend = entry["backend"]
            same = entry["source"]["crs"] == entry["target"]["crs"]
            if type(backend) is not dict or set(backend) != {"name", "version", "proj_version"} or backend["name"] not in (("identity",) if same else ("pyproj", "proj4")) or not _label(backend["version"]) or (backend["proj_version"] is not None and not _label(backend["proj_version"])):
                raise ValueError("invalid reprojection backend identity")
            producer = entry["producer"]
            if type(producer) is not dict or set(producer) != {"library", "version", "algorithm_version"} or producer["library"] != "baselode" or not _label(producer["version"]) or type(producer["algorithm_version"]) not in (int, float) or producer["algorithm_version"] != 1:
                raise ValueError("invalid reprojection producer")
            count = entry["transformed_records"]
            if type(count) not in (int, float) or count != sum(row["x"] is not None and row["y"] is not None for row in data["records"]) or count < 1 or entry["transform_binding"] != _reprojection_hash(entry):
                raise ValueError("stale reprojection binding or transformed count")
            frame = entry["source"]
        frames[index] = frame
    return frames


def reproject_observations(payload, options):
    """Derive WGS84 geographic/UTM coordinates while retaining bound history.

    Parameters
    ----------
    payload : dict
        V1 observations. Supported source CRS and declared degree/m units.
        Complete null XY pairs survive; partial pairs reject. Inputs unchanged.
    options : dict
        Canonical target_crs, datum_policy='backend', event_id and evidence.
        Always XY: longitude/latitude or easting/northing. Six-degree UTM
        zone, hemisphere and latitude limits apply to source and target.

    Returns
    -------
    dict
        Correction report with independent observations/ledger on success.
        Earlier events and channel correction states survive verbatim. Heights,
        time, readings and measured heading references are unchanged; headings
        remain relative to the acquisition frame, including grid north.
        No vertical conversion, datum shift or uncertainty propagation.
        Old readers without reprojection support must reject the new event.
    """
    report = _report("reproject_observations")
    try:
        params = _reprojection_options(options)
        report["parameters"] = params
        data = baselode.geophysics.observations.create_observations(payload)
        source = {k: data[k] for k in ("crs", "crs_units")}
        source_code = _projection_frame(source)
        target_code = _projection_code(params["target_crs"])
        target = {"crs": params["target_crs"], "crs_units": "degree" if target_code == 4326 else "m"}
        ledger = _load(data)
        if any(entry["id"] == params["event_id"] for entry in ledger["entries"]):
            raise ValueError("event_id already exists in the correction ledger")
        if len(ledger["entries"]) >= _LIMITS["max_events"]:
            raise _ResourceError("correction ledger exceeds 64 events")
        geographic = pyproj.Transformer.from_crs(source["crs"], "EPSG:4326", always_xy=True, allow_ballpark=False)
        transform = pyproj.Transformer.from_crs(source["crs"], target["crs"], always_xy=True, allow_ballpark=False)
        count = 0
        for row in data["records"]:
            if row["x"] is None and row["y"] is None:
                continue
            if row["x"] is None or row["y"] is None:
                raise ValueError("reprojection requires complete XY pairs or both null")
            if abs(row["x"]) > 1e12 or abs(row["y"]) > 1e12:
                raise ValueError("reprojection XY must be within +/-1e12")
            lon, lat = geographic.transform(row["x"], row["y"], errcheck=True)
            _projection_area(source_code, lon, lat)
            _projection_area(target_code, lon, lat)
            x, y = transform.transform(row["x"], row["y"], errcheck=True)
            if not all(math.isfinite(v) and abs(v) <= 1e12 for v in (x, y)):
                raise ValueError("transformed XY must be finite within +/-1e12")
            row["x"], row["y"] = x, y
            count += 1
        if not count:
            raise _NeedsInput("reprojection needs at least one complete XY pair")
        before = ledger["current_binding"]
        data.update(target)
        after = _binding(data)
        same = source["crs"] == target["crs"]
        backend = {"name": "identity" if same else "pyproj", "version": "1" if same else pyproj.__version__, "proj_version": None if same else pyproj.proj_version_str}
        event = {"id": params["event_id"], "kind": "reprojection", "evidence": params["evidence"], "producer": _producer(), "input_binding": before, "output_binding": after,
                 "parameters": params, "source": source, "target": target, "backend": backend, "transformed_records": count}
        event["transform_binding"] = _reprojection_hash(event)
        ledger["entries"].append(event)
        ledger["current_binding"] = after
        metadata = data["metadata"]
        nodes, operand = baselode.geophysics.provenance.append_input(metadata, metadata)
        metadata["input_lineage"] = nodes
        for key in ("uncertainty", "variance", "standard_deviation"):
            metadata.pop(key, None)
        metadata["uncertainty_propagated"] = False
        metadata["processing"] = list(metadata.get("processing", [])) + [{"operation": "reproject_observations", "version": 1, "parameters": params, "source": source, "target": target, "backend": backend, "input_binding": before, "output_binding": after, "operand_lineage": operand}]
        output = _save(data, ledger)
        _validate(output, ledger, after)
        report.update(observations=output, ledger=copy.deepcopy(ledger), states=_states(output, ledger), diagnostics={"transformed_records": count, "missing_xy_records": len(data["records"]) - count, "backend": backend})
        return report
    except (ValueError, TypeError, RecursionError, pyproj.exceptions.ProjError) as error:
        return _error(report, error)
