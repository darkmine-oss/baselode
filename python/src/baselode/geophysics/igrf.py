# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Explicit, bounded IGRF14 evaluation through the optional ppigrf backend."""
import copy
import datetime
import hashlib
import importlib.metadata
import json
import math
import pathlib
import warnings

import numpy as np

import baselode
import baselode.geophysics.corrections
import baselode.geophysics.observations
import baselode.geophysics.provenance

try:
    import ppigrf as _ppigrf
except ImportError:
    _ppigrf = None

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent / "geophysics_igrf.json").read_text())


class _BackendError(RuntimeError):
    pass


def describe_igrf():
    """Return independent IGRF14 execution contracts and scientific conventions.

    Returns
    -------
    dict
        Request/result schemas, removal parameters, fixed model identity,
        resource limits, optional-install instructions and assumptions.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _require_backend():
    if _ppigrf is None:
        raise ImportError("IGRF requires pip install 'baselode[magnetics]'")


def _points(request):
    corrections = baselode.geophysics.corrections
    if type(request) is not dict or request.keys() - {"model", "points"}:
        raise ValueError("IGRF request accepts only model and points")
    if "model" not in request or "points" not in request:
        raise corrections._NeedsInput("supply explicit model=IGRF14 and points")
    if request["model"] != "IGRF14":
        raise ValueError("only model=IGRF14 is supported")
    rows = request["points"]
    if type(rows) is not list or not rows:
        raise ValueError("points must be a nonempty list")
    if len(rows) > _DESCRIPTOR["resources"]["max_points"]:
        raise corrections._ResourceError("IGRF accepts at most 512 points; partition explicitly")
    rows = corrections._json(rows)
    ids, times = set(), set()
    for row in rows:
        required = {"id", "longitude", "latitude", "height_m", "time"}
        if type(row) is not dict or row.keys() - required:
            raise ValueError("each point accepts id, longitude, latitude, height_m and time")
        if required - row.keys() or any(row[n] is None for n in required):
            raise corrections._NeedsInput("every point requires ID, longitude/latitude, ellipsoidal height and UTC time")
        if not corrections._label(row["id"]) or row["id"] in ids:
            raise ValueError("point IDs must be unique bounded labels")
        ids.add(row["id"])
        if not all(corrections._number(row[n]) for n in required - {"id"}):
            raise ValueError("point coordinates/heights/times must be finite binary64 numbers")
        if not -180 <= row["longitude"] <= 180 or not -90 < row["latitude"] < 90:
            raise ValueError("longitude must be [-180,180] and latitude strictly (-90,90); exact poles unsupported")
        if not -1000 <= row["height_m"] <= 100000:
            raise ValueError("adapter height range is -1000 to 100000 ellipsoidal metres")
        if not -2208988800 <= row["time"] <= 1893456000:
            raise ValueError("IGRF14 dates must be 1900-01-01 through 2030-01-01 UTC inclusive; no extrapolation")
        times.add(row["time"])
    if len(times) > _DESCRIPTOR["resources"]["max_unique_times"]:
        raise corrections._ResourceError("IGRF accepts at most 512 distinct UTC times per request; partition explicitly")
    return rows


def _coefficient_date(timestamp):
    # Official IGRF interpolates in decimal years. ppigrf interpolates elapsed
    # time between five-year epochs, whose leap-day counts differ. Map the
    # actual UTC year fraction onto that interval instead of shifting the model.
    utc = datetime.datetime(1970, 1, 1) + datetime.timedelta(seconds=timestamp)
    year_start = datetime.datetime(utc.year, 1, 1)
    year_end = datetime.datetime(utc.year + 1, 1, 1)
    decimal = utc.year + (utc - year_start).total_seconds() / (year_end - year_start).total_seconds()
    epoch = (utc.year // 5) * 5
    start = datetime.datetime(epoch, 1, 1)
    end = datetime.datetime(epoch + 5, 1, 1)
    return start + (end - start) * ((decimal - epoch) / 5)


def _evaluate(rows):
    groups = {}
    for index, row in enumerate(rows):
        groups.setdefault(row["time"], []).append((index, row))
    fields = [None] * len(rows)
    try:
        model = _DESCRIPTOR["model"]
        coeff = pathlib.Path(_ppigrf.__file__).parent / model["coefficients"]
        if importlib.metadata.version("ppigrf") != model["backend_version"] or hashlib.sha256(coeff.read_bytes()).hexdigest() != model["coefficients_sha256"]:
            raise _BackendError("unsupported ppigrf version or changed IGRF14 coefficients; install the declared magnetics extra")
        with warnings.catch_warnings():
            warnings.simplefilter("error", RuntimeWarning)
            for timestamp, group in groups.items():
                # ppigrf broadcasts dates against positions. One date per batch
                # is essential: passing N dates/positions creates an N*N result.
                date = _coefficient_date(timestamp)
                east, north, up = _ppigrf.igrf(
                    np.array([r["longitude"] for _, r in group]),
                    np.array([r["latitude"] for _, r in group]),
                    np.array([r["height_m"] / 1000 for _, r in group]), date, coeff_fn=str(coeff))
                arrays = [np.asarray(a, dtype=float) for a in (north, east, -up)]
                if any(a.shape != (1, len(group)) or not np.isfinite(a).all() for a in arrays):
                    raise _BackendError("IGRF backend returned invalid shape or nonfinite components")
                for position, (index, row) in enumerate(group):
                    n, e, d = (float(a[0, position]) for a in arrays)
                    h = math.hypot(n, e)
                    if not math.isfinite(math.hypot(h, d)):
                        raise _BackendError("IGRF backend returned overflowing derived intensity")
                    fields[index] = {"id": row["id"], "north": n, "east": e, "down": d, "horizontal": h,
                                     "total": math.hypot(h, d), "declination": math.degrees(math.atan2(e, n)) if h else None,
                                     "inclination": math.degrees(math.atan2(d, h))}
    except Exception as error:
        raise _BackendError("IGRF backend failed: " + str(error)) from error
    return fields


def calculate_igrf(request):
    """Calculate the IGRF14 reference field at explicitly dated geodetic points.

    Parameters
    ----------
    request : dict
        ``model='IGRF14'``, ``points=[{id, longitude, latitude, height_m,
        time}, ...]``. Longitude/latitude are WGS84 degrees, height is metres
        above the ellipsoid, time is UTC Unix seconds. At most 512 points and
        512 distinct times. See ``describe_igrf`` for schemas and domain limits.

    Returns
    -------
    dict
        V1 JSON report with state, issues, fields in original point order,
        model identity, diagnostics, producer and assumptions. Components
        north/east/down and H/F are nT; D/I are east/down-positive degrees.
        Unsuccessful runs return no fields or model. Missing context yields
        needs_input, invalid requests rejected, backend failures failed.

    Raises
    ------
    ImportError
        Install ``baselode[magnetics]`` to execute the optional backend.
    """
    _require_backend()
    result = {"schema": "baselode.geophysics.igrf", "version": 1, "state": "ok", "issues": [], "fields": [], "model": None,
              "diagnostics": {}, "producer": baselode.geophysics.corrections._producer(), "assumptions": copy.deepcopy(_DESCRIPTOR["assumptions"])}
    try:
        rows = _points(request)
        result["fields"] = _evaluate(rows)
        result["model"] = copy.deepcopy(_DESCRIPTOR["model"])
        result["diagnostics"] = {"points": len(rows), "unique_times": len({r["time"] for r in rows}), "uncertainty_propagated": False}
    except (ValueError, RuntimeError, OSError) as error:
        corrections = baselode.geophysics.corrections
        missing = isinstance(error, corrections._NeedsInput)
        backend = isinstance(error, (_BackendError, OSError))
        result.update(state="needs_input" if missing else ("failed" if backend else "rejected"), fields=[], model=None)
        result["issues"].append({"code": "context" if missing else ("backend" if backend else ("resource" if isinstance(error, corrections._ResourceError) else "contract")), "message": str(error)})
    return result


def remove_igrf(payload, options):
    """Remove scalar IGRF14 total intensity with a bound correction-ledger event.

    Parameters
    ----------
    payload : dict
        Baselode observations, EPSG:4326/degrees; metadata height_units=m,
        height_datum=WGS84_ellipsoid, z_positive=up. Nonnull selected readings
        require x/y/z/time and unapplied magnetic_igrf history.
    options : dict
        Explicit channel, model=IGRF14, unique event_id and evidence. Selected
        channel must be magnetic_total_field/nT. See describe_igrf.

    Returns
    -------
    dict
        Correction report. Success subtracts F at each reading's location and
        time, relabels only that channel magnetic_anomaly, preserves nulls,
        other fields and acquisition order, and stores model/source lineage.
        Failure commits no observations or ledger. This is scalar subtraction;
        no external-field removal or uncertainty propagation is inferred.

    Raises
    ------
    ImportError
        Install ``baselode[magnetics]`` to execute the optional backend.
    """
    _require_backend()
    corrections = baselode.geophysics.corrections
    result = corrections._report("remove_igrf")
    result["assumptions"] = copy.deepcopy(_DESCRIPTOR["assumptions"])
    try:
        params = corrections._igrf_options(options)
        result["parameters"] = params
        data = baselode.geophysics.observations.create_observations(payload)
        if len(data["records"]) > _DESCRIPTOR["resources"]["max_points"]:
            raise corrections._ResourceError("IGRF removal accepts at most 512 records; partition explicitly")
        channel = params["channel"]
        if channel not in data["channels"] or data["channels"][channel]["field_type"] != "magnetic_total_field" or data["channels"][channel]["units"] != "nT":
            raise ValueError("IGRF removal requires a magnetic_total_field channel in nT")
        metadata = data["metadata"]
        if data["crs"] != "EPSG:4326" or data["crs_units"] != "degrees" or any(metadata.get(k) != v for k, v in {"height_units": "m", "height_datum": "WGS84_ellipsoid", "z_positive": "up"}.items()):
            raise corrections._NeedsInput("supply EPSG:4326/degrees and metadata height_units=m, height_datum=WGS84_ellipsoid, z_positive=up; convert explicitly")
        ledger = corrections._load(data)
        state = corrections._states(data, ledger)["magnetic_igrf"][channel]
        if state == "unknown":
            raise corrections._NeedsInput("declare evidence-backed unapplied magnetic_igrf history before removal")
        if state != "unapplied":
            raise ValueError("magnetic_igrf is already applied; repeated removal rejected")
        if any(e["id"] == params["event_id"] for e in ledger["entries"]):
            raise ValueError("event_id already exists in the correction ledger")
        readings = [r for r in data["records"] if r["values"][channel] is not None]
        if not readings:
            raise corrections._NeedsInput("selected channel has no nonnull readings")
        points = _points({"model": params["model"], "points": [{"id": r["id"], "longitude": r["x"], "latitude": r["y"], "height_m": r["z"], "time": r["time"]} for r in readings]})
        fields = _evaluate(points)
        before = ledger["current_binding"]
        source_nodes, source_operand = baselode.geophysics.provenance.append_input(metadata, metadata)
        for row, field in zip(readings, fields):
            value = row["values"][channel] - field["total"]
            if not corrections._number(value):
                raise ValueError("corrected reading is outside the finite binary64 range")
            row["values"][channel] = value
        data["channels"][channel]["field_type"] = "magnetic_anomaly"
        after = corrections._binding(data)
        model = copy.deepcopy(_DESCRIPTOR["model"])
        ledger["entries"].append({"id": params["event_id"], "kind": "application", "correction": "magnetic_igrf", "channels": [channel], "state": "applied", "evidence": params["evidence"], "producer": corrections._producer(), "input_binding": before, "output_binding": after, "parameters": params, "model": model, "affected_records": len(readings)})
        ledger["current_binding"] = after
        metadata["input_lineage"] = source_nodes
        for name in ("uncertainty", "variance", "stddev"):
            metadata.pop(name, None)
        metadata["uncertainty_propagated"] = False
        metadata["processing"] = [*metadata.get("processing", []), {"operation": "remove_igrf", "version": 1, "parameters": params, "model": model, "input_binding": before, "output_binding": after, "operand_lineage": source_operand}]
        output = corrections._save(data, ledger)
        result.update(observations=output, ledger=copy.deepcopy(ledger), states=corrections._states(output, ledger),
                      proposals=[{"id": f["id"], "reference_total": f["total"], "corrected_value": r["values"][channel]} for r, f in zip(readings, fields)],
                      diagnostics={"affected_records": len(readings), "missing_readings": len(data["records"]) - len(readings), "unique_times": len({p["time"] for p in points}), "uncertainty_propagated": False})
    except (ValueError, RuntimeError, OSError) as error:
        corrections._error(result, error)
        if isinstance(error, (_BackendError, OSError)):
            result["state"] = "failed"
            result["issues"][-1]["code"] = "backend"
    return result
