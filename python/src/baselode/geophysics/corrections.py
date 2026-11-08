# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Bound observation correction history and guarded magnetic base correction."""
import bisect
import copy
import hashlib
import json
import pathlib
import re
import struct

import baselode
import baselode.geophysics.observations
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
    """Return independent ledger, declaration and base-correction contracts.

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
    report["issues"].append({"code": "context" if isinstance(error, _NeedsInput) else ("resource" if isinstance(error, _ResourceError) else "contract"), "message": str(error)})
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
    states = _states(data, {"entries": []})
    previous, ids = ledger["initial_binding"], set()
    for entry in ledger["entries"]:
        extra = igrf_extra if type(entry) is dict and entry.get("correction") == "magnetic_igrf" else base_extra
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
                params = (_igrf_options if correction == "magnetic_igrf" else _base_options)(entry["parameters"])
            except _NeedsInput as error:
                raise ValueError("invalid stored application parameters: " + str(error)) from error
            count = sum(row["values"][channels[0]] is not None for row in data["records"])
            if correction not in ("magnetic_diurnal", "magnetic_igrf") or len(channels) != 1 or entry["state"] != "applied" or any(states[correction][name] != "unapplied" for name in channels):
                raise ValueError("application requires unapplied supported correction history for one channel")
            if params["channel"] != channels[0] or params["event_id"] != entry["id"] or params["evidence"] != entry["evidence"] :
                raise ValueError("application parameters do not match the ledger event")
            if correction == "magnetic_diurnal" and (not _digest(entry["base_binding"]) or not _label(entry["base_station_id"])):
                raise ValueError("invalid base application binding/station")
            if correction == "magnetic_igrf" and entry["model"] != _DESCRIPTOR["igrf_model"]["const"]:
                raise ValueError("invalid IGRF model/coefficient/convention identity")
            if type(entry["affected_records"]) not in (int, float) or entry["affected_records"] != count or count < 1:
                raise ValueError("application must account for every nonnull channel reading")
        for name in channels:
            states[correction][name] = entry["state"]
        previous = entry["output_binding"]
    if previous != ledger["current_binding"] or current != previous:
        raise ValueError("stale ledger binding: observation data changed; use a traceable source dataset")
    if not check_summary:
        return ledger
    legacy = data["metadata"].get("corrections", {})
    represented = {entry["correction"] for entry in ledger["entries"]}
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
    if any(step["operation"] in ("correct_magnetic_base", "remove_igrf") for step in data["metadata"].get("processing", [])):
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
    represented = {entry["correction"] for entry in ledger["entries"]}
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
