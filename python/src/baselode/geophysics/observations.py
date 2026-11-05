# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Portable acquisition-order observations and non-destructive baseline QC."""
import copy
import json
import math
import pathlib
import re
import statistics
import types

import baselode

import baselode.geophysics.processing
import baselode.geophysics.provenance

_DIRECTORY = pathlib.Path(__file__).parent
_DESCRIPTOR = json.loads((_DIRECTORY / "geophysics_observation_qc.json").read_text())
_FIELDS = ("magnetic_total_field", "magnetic_anomaly", "gravity_observed", "gravity_anomaly", "radiometric", "radiometric_counts", "other")
_LIMITS = _DESCRIPTOR["resources"]


def observation_schema():
    """Return an independent JSON Schema for normalized observations.

    Returns
    -------
    dict
        V1 document schema. Semantic validation also checks declared channels,
        unique IDs, finite JSON, correction states and resource limits.
    """
    return json.loads((_DIRECTORY / "geophysics_observations.schema.json").read_text())


def describe_observation_qc():
    """Return the independent QC operation contract.

    Returns
    -------
    dict
        Parameters, assumptions, structured states and resource limits.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _number(value):
    return type(value) in (int, float) and math.isfinite(value) and abs(value) <= 1e100


def _label(value):
    return isinstance(value, str) and 1 <= len(value) <= 128 and bool(value.strip())


def create_observations(payload):
    """Validate and copy a versioned line/station observation payload.

    Parameters
    ----------
    payload : dict
        ``records`` in acquisition order and ``channels`` are required.
        Schema/version, CRS/units and metadata have explicit v1 defaults.
        Record IDs must be unique; station IDs may repeat. Missing readings,
        coordinates, time, elevations and clearance remain null. Time is UTC
        Unix epoch seconds; z/clearance units belong in metadata.height_units.

    Returns
    -------
    dict
        Independent normalized JSON document. Values/order are preserved;
        absent nullable record fields/channel readings become None. Invalid
        contracts raise ValueError. No coordinate conversion is performed.
    """
    if type(payload) is not dict or set(payload) - {"schema", "version", "records", "channels", "crs", "crs_units", "metadata"}:
        raise ValueError("observations require an object with known v1 fields")
    records, channels = payload.get("records"), payload.get("channels")
    if type(records) is not list or len(records) > _LIMITS["max_records"]:
        raise ValueError("records must be a list of at most 100000 observations")
    if type(channels) is not dict or not 1 <= len(channels) <= 32 or len(records) * len(channels) > _LIMITS["max_readings"]:
        raise ValueError("require 1..32 channels and at most 250000 channel readings")
    try:
        baselode.geophysics.provenance._json_value(payload)
        # JSON parsing combines valid UTF-16 surrogate pairs into scalars;
        # UTF-8 encoding then rejects any unpaired surrogate, like the JS API.
        document = json.loads(json.dumps(payload, ensure_ascii=True, allow_nan=False, separators=(",", ":")))
        encoded = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    except (ValueError, TypeError, RecursionError) as error:
        raise ValueError("observations require finite acyclic JSON and valid Unicode scalar strings") from error
    if len(encoded) > _LIMITS["max_json_bytes"]:
        raise ValueError("observations exceed the 16 MiB JSON limit")
    version = document.get("version", 1)
    if document.get("schema", "baselode.geophysics.observations") != "baselode.geophysics.observations" or type(version) not in (int, float) or version != 1:
        raise ValueError("unsupported observation schema/version")
    document.update(schema="baselode.geophysics.observations", version=1)
    for name in ("crs", "crs_units"):
        value = document.setdefault(name, None)
        if value is not None and (not isinstance(value, str) or not value.strip()):
            raise ValueError(f"{name} must be a nonempty string or null")
    metadata = document.setdefault("metadata", {})
    if type(metadata) is not dict:
        raise ValueError("metadata must be a JSON object")
    corrections = metadata.get("corrections", {})
    if type(corrections) is not dict or any(state not in ("applied", "unapplied", "unknown") for state in corrections.values()):
        raise ValueError("corrections must map names to applied, unapplied or unknown")
    for name, channel in document["channels"].items():
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", name) or type(channel) is not dict or set(channel) - {"field_type", "units", "description"}:
            raise ValueError("channel names/descriptors violate the v1 schema")
        if channel.get("field_type") not in _FIELDS or not isinstance(channel.get("units"), str) or not channel["units"].strip() or ("description" in channel and not isinstance(channel["description"], str)):
            raise ValueError("each channel needs a recognized field_type and nonempty units")
    ids = set()
    for index, row in enumerate(document["records"]):
        if type(row) is not dict or set(row) - {"id", "x", "y", "z", "time", "clearance", "line_id", "station_id", "values", "extra"}:
            raise ValueError(f"record {index} must use known v1 fields")
        if not _label(row.get("id")) or row["id"] in ids:
            raise ValueError("each observation needs a unique nonempty id")
        ids.add(row["id"])
        for key in ("line_id", "station_id"):
            if row.setdefault(key, None) is not None and not _label(row[key]):
                raise ValueError(f"record {index} {key} must be a label or null")
        for key in ("x", "y", "z", "time", "clearance"):
            if row.setdefault(key, None) is not None and not _number(row[key]):
                raise ValueError(f"record {index} {key} must be null or finite numeric within +/-1e100")
        values = row.setdefault("values", {})
        if type(values) is not dict or values.keys() - channels.keys():
            raise ValueError(f"record {index} has undeclared channel values")
        for name in channels:
            if values.setdefault(name, None) is not None and not _number(values[name]):
                raise ValueError(f"record {index} channel {name} must be null or finite numeric within +/-1e100")
        if type(row.setdefault("extra", {})) is not dict:
            raise ValueError(f"record {index} extra must be a JSON object")
    if len(json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > _LIMITS["max_json_bytes"]:
        raise ValueError("normalized observations exceed the 16 MiB JSON limit")
    return document


def _options(options, channels):
    if options is None:
        options = {}
    if type(options) is not dict or options.keys() - _DESCRIPTOR["parameters"]["properties"].keys():
        raise ValueError("QC options must be an object with known parameter names")
    baselode.geophysics.provenance._json_value(options)
    result = {"spike_window": 5, "spike_thresholds": {}, **copy.deepcopy(options)}
    window = result["spike_window"]
    if type(window) not in (int, float) or not _number(window) or window != int(window) or not 3 <= window <= 101 or window % 2 == 0:
        raise ValueError("spike_window must be an odd integer from 3 to 101")
    result["spike_window"] = int(window)
    for name in ("max_speed", "max_distance_gap", "max_time_gap", "min_clearance"):
        if name in result and (not _number(result[name]) or (name != "min_clearance" and result[name] <= 0)):
            raise ValueError(f"{name} must be finite in range, positive except min_clearance")
    thresholds = result["spike_thresholds"]
    if type(thresholds) is not dict or thresholds.keys() - channels.keys() or any(not _number(value) or value <= 0 for value in thresholds.values()):
        raise ValueError("spike_thresholds need positive finite values for declared channels")
    return result


def qc_observations(payload, options=None):
    """Flag survey issues without sorting, dropping, filling or correcting data.

    Parameters
    ----------
    payload : dict
        Accepted by :func:`create_observations`.
    options : dict, optional
        ``max_speed`` in CRS units/second, ``max_distance_gap`` in CRS units,
        ``max_time_gap`` in seconds, ``min_clearance`` in declared height_units,
        ``spike_thresholds`` per channel and odd ``spike_window`` (default 5).
        Threshold checks are enabled only when explicitly supplied.

    Returns
    -------
    dict
        Versioned QC report: state, issues, flags, segments, edges, coincident
        groups, repeats, summary, check coverage, effective parameters and
        assumptions. ok means execution complete, not survey acceptance.
        needs_input retains available diagnostics; rejected reports may be
        partial when a resource limit was reached. No corrections are applied.
    """
    report = {"schema": "baselode.geophysics.observation_qc", "version": 1, "state": "ok", "issues": [],
              "producer": {"library": "baselode", "version": baselode.__version__, "algorithm_version": 1},
              "flags": [], "segments": [], "edges": [], "coincident_locations": [], "repeats": [],
              "summary": {}, "coverage": {"within_line_edges": 0, "speed_edges": 0, "skipped_speed_edges": 0, "spike_windows": 0, "skipped_spike_windows": 0, "spike_edge_rows": 0},
              "parameters": {}, "assumptions": copy.deepcopy(_DESCRIPTOR["assumptions"]), "flags_truncated": False}

    def issue(state, code, message):
        report["issues"].append({"state": state, "code": code, "message": message})

    try:
        data = create_observations(payload)
        params = _options(options, data["channels"])
        report["parameters"] = params
    except (ValueError, TypeError, RecursionError) as error:
        issue("rejected", "contract", str(error))
        report["state"] = "rejected"
        return report
    rows, channels = data["records"], data["channels"]
    if len(rows) * params["spike_window"] * len(params["spike_thresholds"]) > _LIMITS["max_spike_window_values"]:
        issue("rejected", "resource", "spike windows exceed 10000000 channel values; use smaller survey partitions/window")
        report["state"] = "rejected"
        return report
    counts = {}

    def flag(index, code, channel=None, **details):
        counts[code] = counts.get(code, 0) + 1
        if len(report["flags"]) < _LIMITS["max_flags"]:
            item = {"row": index, "id": rows[index]["id"], "code": code, **details}
            if channel is not None:
                item["channel"] = channel
            report["flags"].append(item)
        elif not report["flags_truncated"]:
            report["flags_truncated"] = True
            issue("rejected", "resource", "QC flag limit exceeded; report is partial")

    linear = True
    try:
        distance_unit = baselode.geophysics.processing._coordinate_unit(types.SimpleNamespace(
            crs=data["crs"], metadata={"crs_units": data["crs_units"]}))
        if distance_unit == "coordinate_unit":
            linear = False
    except ValueError:
        distance_unit, linear = None, False
    needs_distance = any(name in params for name in ("max_speed", "max_distance_gap"))
    if not linear and needs_distance:
        issue("needs_input", "coordinates", "speed/distance thresholds require a projected CRS or explicit local linear crs_units")
    height_units = data["metadata"].get("height_units")
    clearance_enabled = False
    if "min_clearance" in params and isinstance(height_units, str) and height_units.strip():
        try:
            clearance_enabled = baselode.geophysics.processing._coordinate_unit(types.SimpleNamespace(
                crs=None, metadata={"crs_units": height_units})) != "coordinate_unit"
        except ValueError:
            pass
    if "min_clearance" in params and not clearance_enabled:
        issue("needs_input", "height_units", "supply metadata.height_units for measured clearance thresholds")
    locations, stations = {}, {}
    segment = None
    missing_time = missing_coordinates = missing_clearance = False
    for index, row in enumerate(rows):
        xy = row["x"] is not None and row["y"] is not None
        if xy:
            locations.setdefault((row["x"], row["y"]), []).append(index)
        else:
            flag(index, "missing_coordinates")
            missing_coordinates = True
        if row["time"] is None and any(name in params for name in ("max_speed", "max_time_gap")):
            missing_time = True
            flag(index, "missing_time")
        if row["station_id"] is not None:
            stations.setdefault(row["station_id"], []).append(index)
        if row["line_id"] is None:
            flag(index, "unassigned_line")
        for channel in channels:
            if row["values"][channel] is None:
                flag(index, "missing_value", channel)
        if clearance_enabled:
            if row["clearance"] is None:
                missing_clearance = True
                flag(index, "missing_clearance")
            elif row["clearance"] < params["min_clearance"]:
                flag(index, "low_clearance", value=row["clearance"])
        reason = "start" if index == 0 else "line_change"
        connect = index > 0 and row["line_id"] is not None and row["line_id"] == rows[index - 1]["line_id"]
        if connect:
            report["coverage"]["within_line_edges"] += 1
            previous = rows[index - 1]
            geometry = xy and previous["x"] is not None and previous["y"] is not None
            distance = math.hypot(row["x"] - previous["x"], row["y"] - previous["y"]) if geometry and linear else None
            dt = row["time"] - previous["time"] if row["time"] is not None and previous["time"] is not None else None
            reason = None
            if not geometry:
                reason = "missing_coordinates"
            if dt is None and "max_time_gap" in params:
                reason = "missing_time"
            if dt is not None and dt <= 0:
                reason = "non_increasing_time"
                flag(index, reason, previous_id=previous["id"])
            if distance is not None and "max_distance_gap" in params and distance > params["max_distance_gap"]:
                reason = reason or "distance_gap"
                flag(index, "distance_gap", previous_id=previous["id"], distance=distance)
            if dt is not None and "max_time_gap" in params and dt > params["max_time_gap"]:
                reason = reason or "time_gap"
                flag(index, "time_gap", previous_id=previous["id"], seconds=dt)
            if reason is None and distance is not None and dt is not None and dt > 0:
                speed = distance / dt
                if math.isfinite(speed):
                    report["edges"].append({"from": index - 1, "to": index, "distance": distance, "seconds": dt, "speed": speed})
                    report["coverage"]["speed_edges"] += 1
                    if "max_speed" in params and speed > params["max_speed"]:
                        flag(index, "high_speed", previous_id=previous["id"], speed=speed)
                else:
                    issue("rejected", "numeric_range", "speed exceeds numeric range")
            else:
                report["coverage"]["skipped_speed_edges"] += 1
            connect = reason is None
        if not connect:
            segment = {"line_id": row["line_id"], "start": index, "end": index, "count": 1, "reason": reason or "unassigned_line"}
            report["segments"].append(segment)
        else:
            segment["end"] = index
            segment["count"] += 1
    if any(name in params for name in ("max_speed", "max_distance_gap", "max_time_gap")) and rows and report["coverage"]["within_line_edges"] == 0:
        issue("needs_input", "line_context", "line checks require at least two consecutive records with the same non-null line_id")
    if missing_time:
        issue("needs_input", "time_context", "supply UTC epoch seconds for rows flagged missing_time")
    if missing_coordinates and needs_distance:
        issue("needs_input", "distance_context", "supply XY coordinates for rows flagged missing_coordinates")
    if missing_clearance:
        issue("needs_input", "clearance", "supply measured clearance for rows flagged missing_clearance")
    for indexes in locations.values():
        if len(indexes) > 1:
            report["coincident_locations"].append(indexes)
            for index in indexes:
                flag(index, "coincident_location")
    half = params["spike_window"] // 2
    for segment in report["segments"]:
        for channel, threshold in params["spike_thresholds"].items():
            report["coverage"]["spike_edge_rows"] += min(segment["count"], 2 * half)
            for index in range(segment["start"] + half, segment["end"] - half + 1):
                values = [rows[other]["values"][channel] for other in range(index - half, index + half + 1)]
                if any(value is None for value in values):
                    report["coverage"]["skipped_spike_windows"] += 1
                    continue
                median = statistics.median(values)
                report["coverage"]["spike_windows"] += 1
                residual = rows[index]["values"][channel] - median
                if abs(residual) > threshold:
                    flag(index, "spike_candidate", channel, residual=residual, median=median)
    if rows and params["spike_thresholds"] and report["coverage"]["spike_windows"] == 0:
        issue("needs_input", "spike_context", "no complete spike windows; supply readings/longer contiguous lines or choose a smaller odd window")
    for station_id, indexes in stations.items():
        if len(indexes) < 2:
            continue
        positions = {(rows[index]["x"], rows[index]["y"]) for index in indexes if rows[index]["x"] is not None and rows[index]["y"] is not None}
        complete = all(rows[index]["x"] is not None and rows[index]["y"] is not None for index in indexes)
        same_location = len(positions) == 1 if complete else None
        if len(positions) > 1:
            for index in indexes:
                flag(index, "station_location_mismatch")
        summary = {"station_id": station_id, "rows": indexes, "same_location": same_location, "channels": {}}
        for channel in channels:
            values = [rows[index]["values"][channel] for index in indexes if rows[index]["values"][channel] is not None]
            if not values:
                continue
            mean = math.fsum(values) / len(values)
            deviation = math.sqrt(math.fsum((value - mean) ** 2 for value in values) / (len(values) - 1)) if len(values) > 1 else None
            summary["channels"][channel] = {"count": len(values), "mean": mean, "min": min(values), "max": max(values), "range": max(values) - min(values), "sample_std": deviation}
        report["repeats"].append(summary)
    report["summary"] = {"records": len(rows), "channels": len(channels), "flags_by_code": counts,
                         "channel_definitions": copy.deepcopy(channels), "crs": data["crs"],
                         "height_datum": copy.deepcopy(data["metadata"].get("height_datum")),
                         "distance_units": distance_unit if linear else None, "height_units": height_units if isinstance(height_units, str) else None,
                         "corrections": copy.deepcopy(data["metadata"].get("corrections", {}))}
    report["state"] = "rejected" if any(item["state"] == "rejected" for item in report["issues"]) else ("needs_input" if report["issues"] else "ok")
    return report
