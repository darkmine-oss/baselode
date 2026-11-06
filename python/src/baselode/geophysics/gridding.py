# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded XY nearest/IDW baselines with explicit support and spatial holdouts."""
import copy
import json
import math
import pathlib
import types

import numpy as np

import baselode
import baselode.geophysics.observations
import baselode.geophysics.processing
import baselode.geophysics.provenance
import baselode.geophysics.raster

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent / "geophysics_gridding.json").read_text())
_LIMITS = _DESCRIPTOR["resources"]


class _NeedsInput(ValueError):
    pass


class _ResourceError(ValueError):
    pass


def describe_gridding():
    """Return independent JSON contracts for interpolation/grid/validation options.

    Returns
    -------
    dict
        Versioned parameter schemas, assumptions and resource limits.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _report(kind):
    return {"schema": "baselode.geophysics." + kind, "version": 1, "state": "ok", "issues": [],
            "producer": {"library": "baselode", "version": baselode.__version__, "algorithm_version": 1},
            "parameters": {}, "diagnostics": {}, "assumptions": copy.deepcopy(_DESCRIPTOR["assumptions"])}


def _error(report, error):
    report["state"] = "needs_input" if isinstance(error, _NeedsInput) else "rejected"
    report["issues"].append({"code": "context" if isinstance(error, _NeedsInput) else ("resource" if isinstance(error, _ResourceError) else "contract"), "message": str(error)})
    return report


def _json_options(options, schema):
    if type(options) is not dict or options.keys() - schema["properties"].keys():
        raise ValueError("gridding options must be a JSON object with known parameter names")
    try:
        baselode.geophysics.provenance._json_value(options)
        result = json.loads(json.dumps(options, allow_nan=False), parse_float=baselode.geophysics.observations._json_float)
    except (ValueError, TypeError, RecursionError) as error:
        raise ValueError("gridding options require finite acyclic JSON") from error
    missing = [name for name in schema["required"] if name not in result]
    if missing:
        raise _NeedsInput("supply required options: " + ", ".join(missing))
    for name, rule in schema["properties"].items():
        if name not in result and "default" in rule:
            result[name] = copy.deepcopy(rule["default"])
    return result


def _number(value):
    return baselode.geophysics.observations._number(value)


def _integer(value):
    return _number(value) and value == int(value)


def _parameters(data, options, grid):
    params = _json_options(options, _DESCRIPTOR["grid_parameters" if grid else "interpolation_parameters"])
    channels = params["channels"]
    if type(channels) is not list or not channels or not all(isinstance(name, str) and name in data["channels"] for name in channels) or len(set(channels)) != len(channels):
        raise ValueError("channels must be a unique nonempty list of declared channel names")
    if len({data["channels"][name]["field_type"] for name in channels}) != 1:
        raise ValueError("selected channels must share field_type; grid different field families separately")
    for name in ("neighbors", "min_neighbors"):
        if not _integer(params[name]) or not 1 <= params[name] <= 64:
            raise ValueError("neighbors/min_neighbors must be integers from 1 to 64")
        params[name] = int(params[name])
    if params["min_neighbors"] > params["neighbors"]:
        raise ValueError("min_neighbors cannot exceed neighbors")
    if not _number(params["radius"]) or params["radius"] <= 0 or not _number(params["power"]) or not 0 < params["power"] <= 16:
        raise ValueError("radius must be positive in range and power must be in (0,16]")
    if params["method"] not in ("nearest", "idw") or params["duplicate_policy"] not in ("mean", "reject") or params["extrapolation"] not in ("mask", "allow"):
        raise ValueError("unsupported interpolation method, duplicate policy or extrapolation policy")
    if params["elevation_policy"] != "ignore":
        raise ValueError("baseline interpolation requires explicit elevation_policy=ignore; no height reduction is performed")
    if grid:
        bounds, shape = params["bounds"], params["shape"]
        if type(bounds) is not list or len(bounds) != 4 or not all(_number(value) for value in bounds) or not (bounds[0] < bounds[2] and bounds[1] < bounds[3]):
            raise ValueError("bounds must be finite outer edges [min_x,min_y,max_x,max_y] with positive extent")
        if type(shape) is not list or len(shape) != 2 or not all(_integer(value) and 1 <= value <= 100000 for value in shape):
            raise ValueError("shape must be positive integer [rows,columns]")
        params["shape"] = [int(value) for value in shape]
        cells = math.prod(params["shape"])
        if cells > _LIMITS["max_grid_cells"] or cells * len(channels) > _LIMITS["max_band_values"]:
            raise _ResourceError("grid shape/channels exceed cell or band-value limits")
    trim = baselode.geophysics.observations._trim
    try:
        unit = baselode.geophysics.processing._coordinate_unit(types.SimpleNamespace(crs=trim(data["crs"]), metadata={"crs_units": trim(data["crs_units"])}))
    except ValueError as error:
        raise _NeedsInput("gridding requires a projected CRS or explicit local linear crs_units") from error
    if unit == "coordinate_unit":
        raise _NeedsInput("gridding requires a projected CRS or explicit local linear crs_units")
    return params, unit


def _eligible(data, channels):
    return [row for row in data["records"] if row["x"] is not None and row["y"] is not None and any(row["values"][name] is not None for name in channels)]


def _cross(a, b, c):
    ux, uy, vx, vy = b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]
    first, second = max(abs(ux), abs(uy)), max(abs(vx), abs(vy))
    if first == 0 or second == 0:
        return 0
    cross = (ux / first) * (vy / second) - (uy / first) * (vx / second)
    return 0 if abs(cross) <= 1e-12 else cross


def _hull(points):
    positions = sorted((point[0], point[1]) for point in points)
    if len(positions) <= 1:
        return positions
    lower, upper = [], []
    for point in positions:
        while len(lower) >= 2 and _cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    for point in reversed(positions):
        while len(upper) >= 2 and _cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    return lower[:-1] + upper[:-1]


def _inside(hull, x, y):
    point = (x, y)
    if not hull:
        return False
    if len(hull) == 1:
        return point == hull[0]
    if len(hull) == 2:
        a, b = hull
        return _cross(a, b, point) == 0 and min(a[0], b[0]) <= x <= max(a[0], b[0]) and min(a[1], b[1]) <= y <= max(a[1], b[1])
    return all(_cross(hull[index], hull[(index + 1) % len(hull)], point) >= 0 for index in range(len(hull)))


def _training(rows, params):
    result, diagnostics = {}, {}
    for channel in params["channels"]:
        groups = {}
        for row in rows:
            value = row["values"][channel]
            if value is not None:
                groups.setdefault((row["x"], row["y"]), []).append(value)
        duplicates = sum(len(values) > 1 for values in groups.values())
        if duplicates and params["duplicate_policy"] == "reject":
            raise ValueError("coincident channel observations require duplicate_policy=mean or explicit input QC")
        points = [(xy[0], xy[1], math.fsum(values) / len(values)) for xy, values in groups.items()]
        result[channel] = {"points": points, "hull": _hull(points)}
        diagnostics[channel] = {"locations": len(points), "readings": sum(len(values) for values in groups.values()), "duplicate_locations": duplicates}
    return result, diagnostics


def _predict(training, x, y, params):
    distances = sorted((math.hypot(point[0] - x, point[1] - y), index, point[2]) for index, point in enumerate(training["points"]))
    nearest = distances[0][0] if distances else None
    selected = [item for item in distances if item[0] <= params["radius"]][:params["neighbors"]]
    extrapolated = not _inside(training["hull"], x, y)
    supported = len(selected) >= params["min_neighbors"] and (not extrapolated or params["extrapolation"] == "allow")
    value = None
    if supported:
        if selected[0][0] == 0 or params["method"] == "nearest":
            value = selected[0][2]
        else:
            weights = [(selected[0][0] / item[0]) ** params["power"] for item in selected]
            value = math.fsum(weight * item[2] for weight, item in zip(weights, selected)) / math.fsum(weights)
    return {"predicted": value, "nearest_distance": nearest, "neighbors": len(selected), "extrapolated": extrapolated, "supported": supported}


def _budget(pairs):
    if pairs > _LIMITS["max_pair_evaluations"]:
        raise _ResourceError("prediction/holdout pair work exceeds 10000000 evaluations; use smaller survey/grid partitions")


def _diagnostics(data, rows, params, unit):
    z = [row["z"] for row in rows if row["z"] is not None]
    return {"input_records": len(data["records"]), "eligible_records": len(rows), "skipped_records": len(data["records"]) - len(rows),
            "crs": data["crs"], "distance_units": unit, "channels": {name: copy.deepcopy(data["channels"][name]) for name in params["channels"]},
            "elevation": {"policy": "ignore", "known": len(z), "missing": len(rows) - len(z), "min": min(z) if z else None, "max": max(z) if z else None},
            "height_units": data["metadata"].get("height_units"), "height_datum": data["metadata"].get("height_datum"),
            "corrections": copy.deepcopy(data["metadata"].get("corrections", {}))}


def grid_observations(payload, options):
    """Grid v1 observations using bounded cell-centred XY interpolation.

    Parameters
    ----------
    payload : dict
        Accepted by create_observations. Inputs are preserved.
    options : dict
        See describe_gridding()['grid_parameters']. Bounds are outer edges,
        shape is rows/columns. Radius, channels, duplicate_policy and explicit
        elevation_policy='ignore' are required. No vertical correction occurs.

    Returns
    -------
    dict
        Structured state/issues, diagnostics and full-resolution raster
        artifacts: grid, support, neighbor_count, nearest_distance and
        extrapolation. Unsupported cells in the grid are NaN; diagnostic
        rasters retain support information even outside the support radius.
    """
    report = _report("observation_grid")
    report["artifacts"] = {}
    try:
        data = baselode.geophysics.observations.create_observations(payload)
        params, unit = _parameters(data, options, True)
        report["parameters"] = params
        rows = _eligible(data, params["channels"])
        height, width = params["shape"]
        pairs = 2 * height * width * len(rows) * len(params["channels"])
        _budget(pairs)
        training, counts = _training(rows, params)
        if any(not item["points"] for item in training.values()):
            raise _NeedsInput("each selected channel needs at least one observation with valid XY and reading")
        min_x, min_y, max_x, max_y = params["bounds"]
        dx, dy = (max_x - min_x) / width, (max_y - min_y) / height
        if not all(math.isfinite(value) and value > 0 for value in (dx, dy)) or (width > 1 and min_x + 0.5 * dx == min_x + 1.5 * dx) or (height > 1 and max_y - 0.5 * dy == max_y - 1.5 * dy):
            raise ValueError("grid spacing is not representable at the supplied coordinate scale")
        diagnostics = _diagnostics(data, rows, params, unit)
        diagnostics.update(training=counts, pair_evaluations_upper_bound=pairs, supported={}, extrapolated={})
        snapshot = baselode.geophysics.provenance.input_record(data["metadata"])
        metadata = {"field_type": data["channels"][params["channels"][0]]["field_type"], "units": [data["channels"][name]["units"] for name in params["channels"]],
                    "crs_units": unit, "corrections": copy.deepcopy(diagnostics["corrections"]), "observation_metadata": snapshot["metadata"],
                    "sources": snapshot["sources"], "channel_definitions": diagnostics["channels"], "elevation": diagnostics["elevation"],
                    "processing": [{"operation": "grid_observations", "version": 1, "parameters": copy.deepcopy(params), "input_records": len(data["records"])}]}
        if "source" in snapshot["metadata"]:
            metadata["source"] = snapshot["metadata"]["source"]
        if "baselode_provenance" in data["metadata"]:
            metadata["baselode_provenance"] = copy.deepcopy(data["metadata"]["baselode_provenance"])
        baselode.geophysics.provenance.encode(metadata, "GeoTIFF", "float64")
        arrays = {key: np.full((len(params["channels"]), height, width), np.nan) for key in ("grid", "support", "neighbor_count", "nearest_distance", "extrapolation")}
        for band, channel in enumerate(params["channels"]):
            supported, extrapolated = 0, 0
            for row in range(height):
                for column in range(width):
                    prediction = _predict(training[channel], min_x + (column + 0.5) * dx, max_y - (row + 0.5) * dy, params)
                    if prediction["supported"]:
                        arrays["grid"][band, row, column] = prediction["predicted"]
                        supported += 1
                    extrapolated += prediction["extrapolated"]
                    arrays["support"][band, row, column] = int(prediction["supported"])
                    arrays["neighbor_count"][band, row, column] = prediction["neighbors"]
                    arrays["nearest_distance"][band, row, column] = prediction["nearest_distance"]
                    arrays["extrapolation"][band, row, column] = int(prediction["extrapolated"])
            diagnostics["supported"][channel] = supported
            diagnostics["extrapolated"][channel] = extrapolated
        for key, values in arrays.items():
            attributes = copy.deepcopy(metadata)
            if key != "grid":
                attributes.update(field_type="other", units=[unit if key == "nearest_distance" else ("count" if key == "neighbor_count" else "1")] * len(params["channels"]), diagnostic=key)
            report["artifacts"][key] = baselode.geophysics.raster.GeophysicsRaster(values, transform=(dx, 0, min_x, 0, -dy, max_y), crs=baselode.geophysics.observations._trim(data["crs"]), band_names=params["channels"], metadata=attributes)
        report["diagnostics"] = diagnostics
        return report
    except (ValueError, TypeError, RecursionError) as error:
        report["artifacts"] = {}
        return _error(report, error)


def _validation_options(options):
    params = _json_options(options, _DESCRIPTOR["validation_parameters"])
    if params["by"] not in ("line", "block") or not _number(params["buffer_distance"]) or params["buffer_distance"] < 0:
        raise ValueError("validation requires by=line/block and nonnegative buffer_distance")
    if params["by"] == "line" and any(key in params for key in ("block_size", "origin")):
        raise ValueError("block_size/origin apply only to by=block")
    if params["by"] == "block":
        if any(key not in params for key in ("block_size", "origin")):
            raise _NeedsInput("block validation requires explicit block_size and origin in CRS units")
        for key in ("block_size", "origin"):
            if type(params[key]) is not list or len(params[key]) != 2 or not all(_number(value) and (key == "origin" or value > 0) for value in params[key]):
                raise ValueError("block_size/origin must be XY numeric pairs; block sizes positive")
    return params


def _metrics(predictions):
    errors = [item["predicted"] - item["observed"] for item in predictions if item["supported"]]
    count, total = len(errors), len(predictions)
    return {"tested": total, "supported": count, "unsupported": total - count, "coverage": count / total if total else None,
            "rmse": math.sqrt(math.fsum(value * value for value in errors) / count) if count else None,
            "mae": math.fsum(abs(value) for value in errors) / count if count else None,
            "bias": math.fsum(errors) / count if count else None}


def cross_validate_gridding(payload, options, validation):
    """Leave out entire lines/blocks with colocation and buffer leakage guards.

    Parameters
    ----------
    payload : dict
        V1 observations, preserved in acquisition order.
    options : dict
        Interpolation parameters from describe_gridding (without bounds/shape).
    validation : dict
        by='line', or by='block' with block_size=[dx,dy], origin=[x,y].
        Optional buffer_distance is in CRS units. Training rows at held-out XY
        locations are always removed, even when the buffer is zero.

    Returns
    -------
    dict
        Structured states, per-fold predictions, coverage and per-channel
        paired-only RMSE/MAE/bias. Unsupported predictions remain None and do
        not enter error metrics. This does not estimate calibrated uncertainty.
    """
    report = _report("gridding_validation")
    report.update(folds=[], summary={})
    try:
        data = baselode.geophysics.observations.create_observations(payload)
        params, unit = _parameters(data, options, False)
        split = _validation_options(validation)
        report["parameters"] = {"interpolation": params, "validation": split}
        rows = _eligible(data, params["channels"])
        _budget(len(rows) ** 2 * (1 + 2 * len(params["channels"])))
        groups = {}
        for row in rows:
            if split["by"] == "line":
                if row["line_id"] is None:
                    raise _NeedsInput("line validation requires line_id on every eligible observation")
                key = row["line_id"]
            else:
                ratios = [(row[axis] - split["origin"][index]) / split["block_size"][index] for index, axis in enumerate(("x", "y"))]
                if not all(math.isfinite(value) and abs(value) <= 2 ** 53 - 1 for value in ratios):
                    raise ValueError("block indices exceed the portable numeric range")
                key = ":".join(str(math.floor(value)) for value in ratios)
            groups.setdefault(key, []).append(row)
        if len(groups) < 2:
            raise _NeedsInput("spatial validation requires at least two nonempty line/block groups")
        if len(groups) > _LIMITS["max_folds"]:
            raise _ResourceError("validation exceeds 64 held-out groups; use meaningful smaller survey partitions")
        combined = {name: [] for name in params["channels"]}
        for key, test in groups.items():
            test_ids = {row["id"] for row in test}
            candidates = [row for row in rows if row["id"] not in test_ids]
            train = [row for row in candidates if all(math.hypot(row["x"] - target["x"], row["y"] - target["y"]) > split["buffer_distance"] for target in test)]
            training, counts = _training(train, params)
            fold = {"group": key, "train_records": len(train), "test_records": len(test), "excluded_buffer_records": len(candidates) - len(train),
                    "training": counts, "predictions": [], "metrics": {}}
            for channel in params["channels"]:
                predictions = []
                for row in test:
                    if row["values"][channel] is None:
                        continue
                    prediction = {"id": row["id"], "channel": channel, "observed": row["values"][channel], **_predict(training[channel], row["x"], row["y"], params)}
                    predictions.append(prediction)
                fold["predictions"].extend(predictions)
                combined[channel].extend(predictions)
                fold["metrics"][channel] = _metrics(predictions)
            report["folds"].append(fold)
        report["summary"] = {name: _metrics(predictions) for name, predictions in combined.items()}
        report["diagnostics"] = _diagnostics(data, rows, params, unit)
        return report
    except (ValueError, TypeError, RecursionError) as error:
        report.update(folds=[], summary={})
        return _error(report, error)
