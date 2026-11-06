# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded elevation-aware scalar equivalent sources through optional Harmonica."""
import copy
import importlib.metadata
import json
import math
import pathlib
import types
import warnings

import numpy as np

import baselode
import baselode.geophysics.alignment
import baselode.geophysics.gridding
import baselode.geophysics.observations
import baselode.geophysics.processing
import baselode.geophysics.provenance
import baselode.geophysics.raster

try:
    import harmonica as _harmonica
except ImportError:
    _harmonica = None

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent / "geophysics_equivalent_sources.json").read_text())
_LIMITS = _DESCRIPTOR["resources"]


class _NeedsInput(ValueError):
    pass


class _ResourceError(ValueError):
    pass


class _BackendError(RuntimeError):
    pass


def describe_equivalent_sources():
    """Return independent v1 schemas, backend requirements and assumptions.

    Returns
    -------
    dict
        Discoverable Python execution and JavaScript contract-only descriptor.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _require_backend():
    if _harmonica is None:
        raise ImportError("Equivalent sources require pip install 'baselode[potential-fields]'")


def _report(kind):
    return {"schema": "baselode.geophysics." + kind, "version": 1, "state": "ok", "issues": [],
            "parameters": {}, "diagnostics": {}, "producer": {"library": "baselode", "version": baselode.__version__, "algorithm_version": 1},
            "assumptions": copy.deepcopy(_DESCRIPTOR["assumptions"])}


def _error(report, error):
    missing = isinstance(error, (_NeedsInput, baselode.geophysics.gridding._NeedsInput))
    report["state"] = "needs_input" if missing else ("failed" if isinstance(error, _BackendError) else "rejected")
    code = "context" if missing else ("backend" if isinstance(error, _BackendError) else ("resource" if isinstance(error, _ResourceError) else "contract"))
    report["issues"].append({"code": code, "message": str(error)})
    if "artifacts" in report:
        report.update(artifacts={}, residuals=[])
    if "candidates" in report:
        report.update(candidates=[], best_index=None)
    return report


def _json_options(options, name):
    return baselode.geophysics.gridding._json_options(options, _DESCRIPTOR[name])


def _number(value):
    return baselode.geophysics.observations._number(value)


def _tuning(params):
    if not _number(params["depth"]) or params["depth"] <= 0:
        raise ValueError("depth must be a finite positive coordinate distance")
    if params["damping"] is not None and (not _number(params["damping"]) or params["damping"] <= 0):
        raise ValueError("damping must be explicitly null (undamped) or a finite positive number")


def _prepare(payload, options, grid):
    data = baselode.geophysics.observations.create_observations(payload)
    if len(data["records"]) > _LIMITS["max_records"]:
        raise _ResourceError("equivalent sources accept at most 512 records; partition the survey explicitly")
    params = _json_options(options, "grid_parameters" if grid else "interpolation_parameters")
    channel = params["channel"]
    if not isinstance(channel, str) or channel not in data["channels"]:
        raise ValueError("channel must identify one declared observation channel")
    if data["channels"][channel]["field_type"] not in ("magnetic_anomaly", "gravity_anomaly"):
        raise ValueError("equivalent sources require magnetic_anomaly or gravity_anomaly; correct raw fields first")
    _tuning(params)
    if not _number(params["radius"]) or params["radius"] <= 0:
        raise ValueError("radius must be a finite positive XY distance")
    if params["duplicate_policy"] not in ("mean", "reject") or params["extrapolation"] not in ("mask", "allow"):
        raise ValueError("unsupported duplicate or extrapolation policy")
    trim = baselode.geophysics.observations._trim
    unit = baselode.geophysics.processing._coordinate_unit(types.SimpleNamespace(crs=trim(data["crs"]), metadata={"crs_units": trim(data["crs_units"])}))
    if unit == "coordinate_unit":
        raise _NeedsInput("declare projected/local linear coordinate units")
    metadata = data["metadata"]
    if not metadata.get("height_units") or not metadata.get("height_datum") or "z_positive" not in metadata:
        raise _NeedsInput("declare metadata.height_units, height_datum and z_positive=up")
    height_unit = baselode.geophysics.processing._LINEAR_UNITS.get(str(trim(metadata["height_units"])).lower())
    if height_unit != unit:
        raise ValueError("height_units must match linear coordinate units; convert explicitly first")
    if metadata["z_positive"] != "up":
        raise ValueError("z_positive must be up; convert depth-positive coordinates explicitly first")
    if not baselode.geophysics.observations._label(metadata["height_datum"]) or trim(metadata["height_datum"]).lower() in ("unknown", "unspecified", "none"):
        raise _NeedsInput("height_datum must identify the shared observation/target vertical datum")
    if data["crs"] is None and not baselode.geophysics.observations._label(metadata.get("frame_id")):
        raise _NeedsInput("local observations need an explicit metadata.frame_id")
    rows = [row for row in data["records"] if row["x"] is not None and row["y"] is not None and row["values"][channel] is not None]
    if any(row["z"] is None for row in rows):
        raise _NeedsInput("every observation with usable XY/reading needs an actual z elevation")
    if not rows:
        raise _NeedsInput("need observations with XYZ and a channel reading")
    _training(rows, params)
    return data, params, rows, unit


def _training(rows, params):
    groups = {}
    for row in rows:
        groups.setdefault((row["x"], row["y"], row["z"]), []).append(row["values"][params["channel"]])
    duplicates = sum(len(values) > 1 for values in groups.values())
    if duplicates and params["duplicate_policy"] == "reject":
        raise ValueError("coincident XYZ readings require duplicate_policy=mean or input QC")
    points = [(x, y, z, math.fsum(values) / len(values)) for (x, y, z), values in groups.items()]
    return points, duplicates


def _budget(work, pairs):
    if work > _LIMITS["max_fit_work"] or pairs > _LIMITS["max_prediction_pairs"]:
        raise _ResourceError("equivalent-source cumulative dense-fit or prediction-pair budget exceeded; use smaller partitions")


def _fit(rows, params):
    points, duplicates = _training(rows, params)
    xy = sorted({(point[0], point[1]) for point in points})
    hull = baselode.geophysics.gridding._hull(xy)
    if len(hull) < 3:
        raise _NeedsInput("fitting needs at least three noncollinear XY locations")
    origin = (points[0][0], points[0][1], min(point[2] for point in points))
    plane = origin[2] - params["depth"]
    if not math.isfinite(plane) or plane >= origin[2]:
        raise ValueError("source-plane depth is not representable at the elevation scale")
    coordinates = tuple(np.array([point[axis] - origin[axis] for point in points], dtype=float) for axis in range(3))
    sources = (np.array([x - origin[0] for x, y in xy]), np.array([y - origin[1] for x, y in xy]), np.full(len(xy), -params["depth"]))
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            model = _harmonica.EquivalentSources(points=sources, damping=params["damping"], parallel=False, dtype="float64")
            model.fit(coordinates, np.array([point[3] for point in points]))
        if not np.all(np.isfinite(model.coefs_)):
            raise _BackendError("Harmonica returned nonfinite source coefficients")
    except (ValueError, np.linalg.LinAlgError, FloatingPointError, OverflowError) as error:
        raise _BackendError("Harmonica fitting failed: " + str(error)) from error
    details = {"training_records": len(rows), "unique_xyz": len(points), "duplicate_xyz": duplicates, "source_count": len(xy), "source_z": plane,
               "source_xy": [list(point) for point in xy], "origin": list(origin), "min_observation_z": origin[2], "max_observation_z": max(point[2] for point in points),
               "warnings": [str(item.message) for item in caught]}
    return {"model": model, "origin": origin, "xy": xy, "hull": hull, "details": details}


def _predict(model, points, params):
    distances, extrapolated, supported = [], [], []
    for x, y, z in points:
        distance = min(math.hypot(x - sx, y - sy) for sx, sy in model["xy"])
        outside = not baselode.geophysics.gridding._inside(model["hull"], x, y)
        distances.append(distance); extrapolated.append(outside)
        supported.append(distance <= params["radius"] and (not outside or params["extrapolation"] == "allow") and z > model["details"]["source_z"])
    indices = [index for index, valid in enumerate(supported) if valid]
    result = [None] * len(points)
    if indices:
        coordinates = tuple(np.array([points[index][axis] - model["origin"][axis] for index in indices], dtype=float) for axis in range(3))
        try:
            values = model["model"].predict(coordinates)
            if not np.all(np.isfinite(values)):
                raise _BackendError("Harmonica returned nonfinite predictions")
        except (ValueError, np.linalg.LinAlgError, FloatingPointError, OverflowError) as error:
            raise _BackendError("Harmonica prediction failed: " + str(error)) from error
        for index, value in zip(indices, values):
            result[index] = float(value)
    return [{"predicted": value, "nearest_distance": distance, "extrapolated": outside, "supported": valid}
            for value, distance, outside, valid in zip(result, distances, extrapolated, supported)]


def _backend():
    return {"name": "harmonica.EquivalentSources", "versions": {name: importlib.metadata.version(name) for name in ("harmonica", "verde", "numpy", "scipy", "scikit-learn", "numba")},
            "kernel": "1/r", "source_placement": "fixed_plane", "parallel": False, "dtype": "float64"}


def _diagnostics(data, rows, unit):
    return {"input_records": len(data["records"]), "used_records": len(rows), "skipped_records": len(data["records"]) - len(rows), "distance_units": unit,
            "height_datum": data["metadata"]["height_datum"], "height_units": data["metadata"]["height_units"], "z_positive": "up", "backend": _backend(), "uncertainty_propagated": False}


def grid_equivalent_sources(payload, options):
    """Fit actual XYZ observations and predict a bounded common-height grid.

    Parameters
    ----------
    payload : dict
        V1 scalar potential-field anomaly observations. Requires shared height
        datum, matching linear height/XY units and z_positive='up'.
    options : dict
        See describe_equivalent_sources()['grid_parameters']. Explicit depth,
        damping, channel, radius, duplicates, bounds, shape and target height.

    Returns
    -------
    dict
        Structured state/issues, full-resolution raster artifacts and fitted
        observation residuals. Residual is predicted minus observed. Metadata
        retains source context and parameters. Requires optional potential-fields.
    """
    _require_backend()
    report = _report("equivalent_source_grid")
    report.update(artifacts={}, residuals=[])
    try:
        data, params, rows, unit = _prepare(payload, options, True)
        bounds, shape = params["bounds"], params["shape"]
        if type(bounds) is not list or len(bounds) != 4 or not all(_number(value) for value in bounds) or not (bounds[0] < bounds[2] and bounds[1] < bounds[3]):
            raise ValueError("bounds must be finite ordered outer edges [min_x,min_y,max_x,max_y]")
        if type(shape) is not list or len(shape) != 2 or not all(_number(value) and value == int(value) and value > 0 for value in shape):
            raise ValueError("shape must be positive integer [rows,columns]")
        height, width = [int(value) for value in shape]
        cells = height * width
        if cells > _LIMITS["max_grid_cells"]:
            raise _ResourceError("target exceeds 10000 cells")
        if not _number(params["target_height"]) or params["target_height"] < max(row["z"] for row in rows):
            raise ValueError("target_height must be finite and at or above all used observation elevations")
        _budget(len(rows) ** 3, len(rows) * (2 * cells + len(rows)))
        dx, dy = (bounds[2] - bounds[0]) / width, (bounds[3] - bounds[1]) / height
        if not all(math.isfinite(value) and value > 0 for value in (dx, dy)) or (width > 1 and bounds[0] + 0.5 * dx == bounds[0] + 1.5 * dx) or (height > 1 and bounds[3] - 0.5 * dy == bounds[3] - 1.5 * dy):
            raise ValueError("grid spacing is not representable at this coordinate scale")
        fitted = _fit(rows, params)
        points = [(bounds[0] + (column + 0.5) * dx, bounds[3] - (row + 0.5) * dy, params["target_height"]) for row in range(height) for column in range(width)]
        predictions = _predict(fitted, points, params)
        residual_params = {**params, "extrapolation": "allow"}
        residuals = _predict(fitted, [(row["x"], row["y"], row["z"]) for row in rows], residual_params)
        report["residuals"] = [{"id": row["id"], "observed": row["values"][params["channel"]], "predicted": item["predicted"], "residual": item["predicted"] - row["values"][params["channel"]]} for row, item in zip(rows, residuals)]
        diagnostics = _diagnostics(data, rows, unit)
        diagnostics.update(fit_work_upper_bound=len(rows) ** 3, prediction_pairs_upper_bound=len(rows) * (2 * cells + len(rows)), training=fitted["details"], supported_cells=sum(item["supported"] for item in predictions), fit_metrics=baselode.geophysics.gridding._metrics([{**item, "observed": row["values"][params["channel"]]} for row, item in zip(rows, residuals)]))
        metadata = copy.deepcopy(data["metadata"])
        nodes, operand = baselode.geophysics.provenance.append_input(metadata, metadata)
        historical = set(baselode.geophysics.alignment.describe_alignment()["historical_fields"]) | {"target_height", "elevation"}
        attributes = {key: value for key, value in metadata.items() if key not in historical}
        definition = data["channels"][params["channel"]]
        if "frame_id" in metadata:
            attributes["frame_id"] = metadata["frame_id"]
        attributes.update(field_type=definition["field_type"], units=[definition["units"]], crs_units=unit, target_height=params["target_height"], uncertainty_propagated=False, input_lineage=nodes)
        attributes["processing"] = list(attributes.get("processing", [])) + [{"operation": "grid_equivalent_sources", "version": 1, "parameters": copy.deepcopy(params), "backend": diagnostics["backend"], "source_geometry": fitted["details"], "operand_lineage": operand}]
        baselode.geophysics.provenance.encode(attributes, "GeoTIFF", "float64")
        for key, field in (("grid", "predicted"), ("support", "supported"), ("nearest_distance", "nearest_distance"), ("extrapolation", "extrapolated")):
            values = np.array([np.nan if item[field] is None else item[field] for item in predictions], dtype=float).reshape(height, width)
            attrs = copy.deepcopy(attributes)
            if key != "grid":
                attrs.update(field_type="other", units=[unit if key == "nearest_distance" else "1"], diagnostic=key)
            report["artifacts"][key] = baselode.geophysics.raster.GeophysicsRaster(values, transform=(dx, 0, bounds[0], 0, -dy, bounds[3]), crs=baselode.geophysics.observations._trim(data["crs"]), band_names=[params["channel"]], metadata=attrs)
        report.update(parameters=params, diagnostics=diagnostics)
        return report
    except (ValueError, TypeError, RecursionError, _BackendError) as error:
        return _error(report, error)


def cross_validate_equivalent_sources(payload, options, validation, candidates=None):
    """Refit spatial holdouts and compare explicit depth/damping candidates.

    Parameters
    ----------
    payload : dict
        V1 anomaly observations with explicit elevation context, preserved.
    options : dict
        Interpolation parameters (no grid bounds/shape/target height).
    validation : dict
        Existing by=line/block contract, optional XY buffer. All training rows
        at held-out XY are removed, including rows at different elevations.
    candidates : list of dict, optional
        Explicit depth/damping pairs; defaults to the options' pair. At most 8.

    Returns
    -------
    dict
        Candidate folds, held-out predictions and coverage/paired-only errors.
        best_index requires complete coverage; null otherwise. Tuning scores
        are not an independent final estimate of generalization performance.
    """
    _require_backend()
    report = _report("equivalent_source_validation")
    report.update(candidates=[], best_index=None)
    try:
        data, params, rows, unit = _prepare(payload, options, False)
        split = baselode.geophysics.gridding._validation_options(validation)
        if candidates is None:
            candidates = [{name: params[name] for name in ("depth", "damping")}]
        if type(candidates) is not list or not 1 <= len(candidates) <= _LIMITS["max_candidates"]:
            raise _ResourceError("supply 1..8 explicit depth/damping candidates")
        choices = []
        for candidate in candidates:
            if type(candidate) is not dict or set(candidate) != {"depth", "damping"}:
                raise ValueError("each candidate must contain exactly depth and damping")
            choice = _json_options({**params, **candidate}, "interpolation_parameters")
            _tuning(choice); choices.append(choice)
        groups = {}
        for row in rows:
            if split["by"] == "line":
                if row["line_id"] is None:
                    raise _NeedsInput("line validation needs line_id on every used observation")
                key = row["line_id"]
            else:
                ratios = [(row[axis] - split["origin"][index]) / split["block_size"][index] for index, axis in enumerate(("x", "y"))]
                if not all(math.isfinite(value) and abs(value) <= 2 ** 53 - 1 for value in ratios):
                    raise ValueError("block indices exceed portable numeric range")
                key = ":".join(str(math.floor(value)) for value in ratios)
            groups.setdefault(key, []).append(row)
        if len(groups) < 2:
            raise _NeedsInput("spatial validation requires at least two nonempty groups")
        if len(groups) > _LIMITS["max_folds"]:
            raise _ResourceError("validation exceeds 16 spatial folds")
        folds = []
        for key, test in groups.items():
            ids = {row["id"] for row in test}
            available = [row for row in rows if row["id"] not in ids]
            train = [row for row in available if all(math.hypot(row["x"] - target["x"], row["y"] - target["y"]) > split["buffer_distance"] for target in test)]
            folds.append((key, train, test, len(available) - len(train)))
        _budget(len(choices) * sum(len(train) ** 3 for key, train, test, excluded in folds), len(rows) ** 2 + len(choices) * sum(2 * len(train) * len(test) for key, train, test, excluded in folds))
        for choice in choices:
            result = {"parameters": {name: choice[name] for name in ("depth", "damping")}, "folds": [], "summary": {}}
            combined = []
            for key, train, test, excluded in folds:
                try:
                    fitted = _fit(train, choice)
                except _NeedsInput:
                    fitted = None
                if fitted is None:
                    predictions = [{"predicted": None, "nearest_distance": None, "extrapolated": None, "supported": False} for row in test]
                else:
                    predictions = _predict(fitted, [(row["x"], row["y"], row["z"]) for row in test], choice)
                predictions = [{"id": row["id"], "observed": row["values"][params["channel"]], **item} for row, item in zip(test, predictions)]
                combined.extend(predictions)
                result["folds"].append({"group": key, "train_records": len(train), "test_records": len(test), "excluded_buffer_records": excluded, "training": fitted["details"] if fitted else None, "predictions": predictions, "metrics": baselode.geophysics.gridding._metrics(predictions)})
            result["summary"] = baselode.geophysics.gridding._metrics(combined)
            report["candidates"].append(result)
        comparable = [(item["summary"]["rmse"], index) for index, item in enumerate(report["candidates"]) if item["summary"]["coverage"] == 1]
        report["best_index"] = min(comparable)[1] if comparable else None
        report["parameters"] = {"interpolation": params, "validation": split}
        report["diagnostics"] = _diagnostics(data, rows, unit)
        report["diagnostics"].update(fit_work_upper_bound=len(choices) * sum(len(train) ** 3 for key, train, test, excluded in folds),
                                     prediction_pairs_upper_bound=len(rows) ** 2 + len(choices) * sum(2 * len(train) * len(test) for key, train, test, excluded in folds))
        if not comparable:
            report["issues"].append({"code": "coverage", "message": "No candidate has complete held-out support; best_index is null. Inspect support policy and fold geometry before comparing errors."})
        return report
    except (ValueError, TypeError, RecursionError, _BackendError) as error:
        return _error(report, error)


def run_equivalent_sources(request):
    """Execute a versioned JSON request and return portable full-resolution data.

    Parameters
    ----------
    request : dict
        Shared request_schema from describe_equivalent_sources(). Selects grid
        or cross_validate; no external I/O, arbitrary code or network execution.

    Returns
    -------
    dict
        Same numerical report as the direct API, with grid artifacts converted
        to JSON-safe raster payloads. Missing backend raises ImportError with
        installation instructions, as with the direct APIs.
    """
    report = _report("equivalent_source_request")
    try:
        if type(request) is not dict or set(request) - set(_DESCRIPTOR["request_schema"]["properties"]):
            raise ValueError("request must contain only versioned equivalent-source fields")
        baselode.geophysics.provenance._json_value(request)
        request = json.loads(json.dumps(request, allow_nan=False))
        if any(name not in request for name in ("schema", "version", "operation", "observations", "options")):
            raise _NeedsInput("request requires schema, version, operation, observations and options")
        if request["schema"] != "baselode.geophysics.equivalent_source_request" or type(request["version"]) not in (int, float) or request["version"] != 1:
            raise ValueError("unsupported equivalent-source request schema/version")
        if request["operation"] == "grid":
            if any(name in request for name in ("validation", "candidates")):
                raise ValueError("validation/candidates apply only to cross_validate")
            result = grid_equivalent_sources(request["observations"], request["options"])
            result["artifacts"] = {name: raster.to_payload() for name, raster in result["artifacts"].items()}
        elif request["operation"] == "cross_validate":
            if "validation" not in request:
                raise _NeedsInput("cross_validate request requires validation options")
            result = cross_validate_equivalent_sources(request["observations"], request["options"], request["validation"], request.get("candidates"))
        else:
            raise ValueError("operation must be grid or cross_validate")
        return json.loads(json.dumps(result, allow_nan=False))
    except (ValueError, TypeError, RecursionError) as error:
        return _error(report, error)
