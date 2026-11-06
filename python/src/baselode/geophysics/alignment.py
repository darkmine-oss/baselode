# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Explicit bounded scalar raster alignment using the existing point sampler."""
import copy
import json
import math
import pathlib
import re

import numpy as np
import pyproj

import baselode
import baselode.geophysics.colour_scales
import baselode.geophysics.observations
import baselode.geophysics.provenance
import baselode.geophysics.raster
import baselode.geophysics.sampling

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent / "geophysics_alignment.json").read_text())
_LIMITS = _DESCRIPTOR["resources"]
_UNITS = {"m": "m", "metre": "m", "meter": "m", "ft": "ft", "foot": "ft", "feet": "ft", "us-ft": "us-ft", "us_survey_foot": "us-ft", "us survey foot": "us-ft", "foot_us": "us-ft", "foot_intl": "ft", "km": "km", "kilometre": "km", "kilometer": "km", "degree": "degree", "degrees": "degree"}


class _NeedsInput(ValueError):
    pass


class _ResourceError(ValueError):
    pass


def describe_alignment():
    """Return independent target/options schemas, supported CRSs and limits.

    Returns
    -------
    dict
        V1 alignment contract and backend/scientific assumptions.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _json(value):
    try:
        baselode.geophysics.provenance._json_value(value)
        result = json.loads(json.dumps(value, ensure_ascii=True, allow_nan=False), parse_float=baselode.geophysics.observations._json_float)
        if len(json.dumps(result, ensure_ascii=False).encode("utf-8")) > 16 * 1024 * 1024:
            raise ValueError("oversized JSON")
        return result
    except (ValueError, TypeError, RecursionError) as error:
        raise ValueError("alignment requires finite acyclic Unicode JSON within 16 MiB") from error


def _number(value):
    return baselode.geophysics.observations._number(value)


def _crs(value):
    if value is None:
        return None
    if not baselode.geophysics.observations._text(value):
        raise ValueError("CRS must be a nonempty string or explicit null")
    text = baselode.geophysics.observations._trim(value)
    match = re.fullmatch(r"(?:EPSG\s*:\s*)?(\d+)", text, re.IGNORECASE)
    return "EPSG:" + str(int(match[1])) if match else text


def _epsg(crs):
    return int(crs[5:]) if crs is not None and re.fullmatch(r"EPSG:\d+", crs) else None


def _unit(crs, declared):
    unit = None
    if declared is not None:
        if not isinstance(declared, str):
            raise ValueError("coordinate units must be a recognized string or null")
        unit = _UNITS.get(baselode.geophysics.observations._trim(declared).lower())
        if unit is None:
            raise ValueError("coordinate units must be m, ft, us-ft, km or degree")
    code = _epsg(crs)
    inferred = ("degree" if code in (4326, 4283, 7844, 4202, 4203) else "m") if code in _DESCRIPTOR["cross_crs_epsg"] else None
    if unit is not None and inferred is not None and unit != inferred:
        raise ValueError("declared coordinate units conflict with the CRS")
    unit = unit or inferred
    if unit is None:
        raise _NeedsInput("declare coordinate crs_units for local/custom CRS grids")
    return unit


def _geometry(shape, transform):
    if type(shape) not in (list, tuple) or len(shape) != 2 or not all(_number(size) and size == int(size) and size > 0 for size in shape):
        raise ValueError("shape must be positive integer [rows,columns]")
    if type(transform) not in (list, tuple) or len(transform) != 6 or not all(_number(value) for value in transform):
        raise ValueError("transform must contain six finite numeric affine values")
    a, b, c, d, e, f = transform
    determinant = a * e - b * d
    if not math.isfinite(determinant) or determinant == 0:
        raise ValueError("affine transform must be finite and invertible")
    rows, columns = [int(size) for size in shape]
    corners = [(a * x + b * y + c, d * x + e * y + f) for x in (0, columns) for y in (0, rows)]
    if not all(math.isfinite(x) and math.isfinite(y) for x, y in corners):
        raise ValueError("affine grid coordinates exceed the numeric range")
    # Distinct neighbour centres must remain representable at both extremes.
    for x, y in ((0.5, 0.5), (columns - 0.5, rows - 0.5)):
        px, py = a * x + b * y + c, d * x + e * y + f
        if columns > 1 and px == a * (x - 1) + b * y + c and py == d * (x - 1) + e * y + f:
            raise ValueError("column spacing is not representable at this coordinate scale")
        if rows > 1 and px == a * x + b * (y - 1) + c and py == d * x + e * (y - 1) + f:
            raise ValueError("row spacing is not representable at this coordinate scale")
    return [rows, columns], list(transform)


def _source(raster):
    if not isinstance(raster, baselode.geophysics.raster.GeophysicsRaster):
        raise ValueError("source/reference must be a GeophysicsRaster")
    if raster.data.size > _LIMITS["max_source_values"]:
        raise _ResourceError("source/reference exceeds 1000000 cell values")
    shape, transform = _geometry([raster.height, raster.width], raster.transform)
    metadata = _json(raster.metadata)
    if raster.data.dtype.kind not in ("i", "u", "f"):
        raise ValueError("source/reference must contain real numeric scalar cells")
    valid = baselode.geophysics.colour_scales.valid_mask(raster.data, raster.nodata)
    if np.any(valid & (np.abs(raster.data) > 1e100)):
        raise ValueError("source/reference values must lie within +/-1e100 or be missing")
    return shape, transform, metadata


def _options(options):
    if type(options) is not dict or options.keys() - _DESCRIPTOR["parameters"]["properties"].keys():
        raise ValueError("alignment options must contain only method, value_kind and optional datum_policy")
    params = _json(options)
    if "method" not in params or "value_kind" not in params:
        raise _NeedsInput("supply explicit method and value_kind")
    if params["method"] not in ("nearest", "bilinear") or params["value_kind"] not in ("continuous", "categorical"):
        raise ValueError("method must be nearest/bilinear and value_kind continuous/categorical")
    if params["value_kind"] == "categorical" and params["method"] != "nearest":
        raise ValueError("categorical scalar values require nearest sampling")
    if "datum_policy" in params and params["datum_policy"] != "backend":
        raise ValueError("datum_policy must be backend when supplied")
    return params


def _target(target):
    if type(target) is not dict or target.keys() - _DESCRIPTOR["target"]["properties"].keys():
        raise ValueError("target must use only shape, transform, crs, crs_units and frame_id")
    # Raster transforms are tuples in Python; normalize the documented
    # geometry sequences to portable JSON arrays without mutating the caller.
    result = _json({key: list(value) if key in ("shape", "transform") and type(value) is tuple else value for key, value in target.items()})
    if any(key not in result for key in ("shape", "transform", "crs")):
        raise _NeedsInput("target needs explicit shape, transform and crs (null for a local grid)")
    result["shape"], result["transform"] = _geometry(result["shape"], result["transform"])
    result["crs"] = _crs(result["crs"])
    result["crs_units"] = _unit(result["crs"], result.get("crs_units"))
    frame = result.get("frame_id")
    if frame is not None and not baselode.geophysics.observations._label(frame):
        raise ValueError("frame_id must be a nonempty label or null")
    result["frame_id"] = frame
    return result


def _report():
    return {"schema": "baselode.geophysics.raster_alignment", "version": 1, "state": "ok", "issues": [], "artifacts": {},
            "parameters": {}, "diagnostics": {}, "producer": {"library": "baselode", "version": baselode.__version__, "algorithm_version": 1},
            "assumptions": copy.deepcopy(_DESCRIPTOR["assumptions"])}


def _error(report, error):
    report["state"] = "needs_input" if isinstance(error, _NeedsInput) else "rejected"
    report["issues"].append({"code": "context" if isinstance(error, _NeedsInput) else ("resource" if isinstance(error, _ResourceError) else "contract"), "message": str(error)})
    report["artifacts"] = {}
    return report


def align_raster(source, target, options):
    """Align scalar raster values to explicit target geometry.

    Parameters
    ----------
    source : GeophysicsRaster
        Source data, never mutated. Source metadata must be portable JSON.
    target : dict
        Explicit shape=[rows,columns], transform=[a,b,c,d,e,f], crs (or None),
        optional crs_units and frame_id. See describe_alignment().
    options : dict
        Explicit method and value_kind; datum_policy='backend' is required
        when changing between supported horizontal CRS codes.

    Returns
    -------
    dict
        Structured state/issues, diagnostics and raster/support/footprint/
        coordinate_valid artifacts. Missing or outside samples remain NaN.
        No field-unit conversion, vector rotation or uncertainty propagation.
    """
    report = _report()
    try:
        shape, transform, metadata = _source(source)
        params, grid = _options(options), _target(target)
        if params["value_kind"] == "categorical":
            categories = source.data[baselode.geophysics.colour_scales.valid_mask(source.data, source.nodata)]
            if np.any(categories < -(2 ** 53 - 1)) or np.any(categories > 2 ** 53 - 1) or np.any(categories != np.floor(categories)):
                raise ValueError("categorical cells must be integer codes within the JSON safe-integer range")
        height, width = grid["shape"]
        if height * width > _LIMITS["max_target_cells"] or height * width * source.band_count > _LIMITS["max_target_band_values"]:
            raise _ResourceError("target shape/bands exceed alignment resource limits")
        source_crs = _crs(source.crs)
        source_unit = _unit(source_crs, metadata.get("crs_units"))
        changed = source_crs != grid["crs"]
        if source_crs is None or grid["crs"] is None:
            if changed:
                raise _NeedsInput("a local grid cannot be reprojected without an explicit CRS")
            frame = metadata.get("frame_id")
            if not baselode.geophysics.observations._label(frame) or grid["frame_id"] is None:
                raise _NeedsInput("local alignment requires declared matching source/target frame_id")
            if frame != grid["frame_id"]:
                raise ValueError("source and target local frame_id must match")
        if not changed and source_unit != grid["crs_units"]:
            raise ValueError("same-CRS source/target coordinate units must match")
        row, column = np.indices((height, width), dtype=float)
        a, b, c, d, e, f = grid["transform"]
        x, y = a * (column + 0.5) + b * (row + 0.5) + c, d * (column + 0.5) + e * (row + 0.5) + f
        backend = {"name": "identity", "version": "1"}
        if changed:
            if params.get("datum_policy") != "backend":
                raise _NeedsInput("cross-CRS alignment requires explicit datum_policy=backend acknowledgement")
            if _epsg(source_crs) not in _DESCRIPTOR["cross_crs_epsg"] or _epsg(grid["crs"]) not in _DESCRIPTOR["cross_crs_epsg"]:
                raise ValueError("cross-CRS alignment requires a documented supported 2D EPSG pair")
            transformer = pyproj.Transformer.from_crs(grid["crs"], source_crs, always_xy=True, allow_ballpark=False)
            x, y = transformer.transform(x, y, errcheck=False)
            backend = {"name": "pyproj", "version": pyproj.__version__, "proj_version": pyproj.proj_version_str, "allow_ballpark": False}
        with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
            px, py = baselode.geophysics.sampling._pixel_coordinates(source, x, y)
            valid = np.isfinite(x) & np.isfinite(y) & np.isfinite(px) & np.isfinite(py)
            tolerance = _DESCRIPTOR["pixel_tolerance"]
            footprint = valid & (px >= -tolerance) & (px <= source.width + tolerance) & (py >= -tolerance) & (py <= source.height + tolerance)
            values = np.stack([baselode.geophysics.sampling.sample_points(source, x, y, band=band + 1, method=params["method"]) for band in range(source.band_count)])
        values = np.where(np.isfinite(values), values, np.nan)
        support = np.isfinite(values)
        nodes, operand = baselode.geophysics.provenance.append_input(metadata, metadata)
        omitted = [key for key in metadata if key in _DESCRIPTOR["historical_fields"]]
        output_metadata = {key: copy.deepcopy(value) for key, value in metadata.items() if key not in _DESCRIPTOR["historical_fields"]}
        output_metadata.update(crs_units=grid["crs_units"], input_lineage=nodes, uncertainty_propagated=False)
        if grid["frame_id"] is not None:
            output_metadata["frame_id"] = grid["frame_id"]
        step = {"operation": "align_raster", "version": 1, "target": copy.deepcopy(grid), "parameters": copy.deepcopy(params),
                "operand_lineage": operand, "source_shape": shape, "source_transform": transform, "source_crs": source_crs, "backend": backend}
        output_metadata["processing"] = list(output_metadata.get("processing", [])) + [step]
        baselode.geophysics.provenance.encode(output_metadata, "GeoTIFF", "float64")
        arrays = {"raster": values, "support": support.astype(float), "footprint": footprint.astype(float)[None], "coordinate_valid": valid.astype(float)[None]}
        for key, data in arrays.items():
            attributes = copy.deepcopy(output_metadata)
            names = list(source.band_names)
            if key != "raster":
                attributes.update(field_type="other", units=["1"] * data.shape[0], diagnostic=key)
                if key != "support":
                    names = [key]
            report["artifacts"][key] = baselode.geophysics.raster.GeophysicsRaster(data, transform=grid["transform"], crs=grid["crs"], band_names=names, metadata=attributes)
        report["parameters"] = {"target": grid, "options": params}
        report["diagnostics"] = {"source_shape": shape, "target_shape": grid["shape"], "source_crs": source_crs, "target_crs": grid["crs"], "source_units": source_unit,
                                  "target_units": grid["crs_units"], "coordinate_valid_cells": int(valid.sum()), "footprint_cells": int(footprint.sum()),
                                  "supported_per_band": [int(band.sum()) for band in support], "historical_metadata_fields": omitted, "uncertainty_propagated": False, "backend": backend}
        return report
    except (ValueError, TypeError, RecursionError, pyproj.exceptions.ProjError) as error:
        return _error(report, error)


def match_raster(source, reference, options):
    """Align source bands to reference geometry without borrowing its values.

    Parameters
    ----------
    source, reference : GeophysicsRaster
        Source values/metadata and reference geometry, neither mutated.
    options : dict
        Same explicit scalar sampling contract as align_raster().

    Returns
    -------
    dict
        Alignment report. Reference band count, values and scientific
        metadata do not become properties of the aligned source raster.
    """
    try:
        if not isinstance(reference, baselode.geophysics.raster.GeophysicsRaster):
            raise ValueError("source/reference must be a GeophysicsRaster")
        shape, transform = _geometry([reference.height, reference.width], reference.transform)
        return align_raster(source, {"shape": shape, "transform": transform, "crs": reference.crs, "crs_units": reference.metadata.get("crs_units"), "frame_id": reference.metadata.get("frame_id")}, options)
    except (ValueError, TypeError, RecursionError) as error:
        return _error(_report(), error)
