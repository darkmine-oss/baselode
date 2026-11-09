# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Allowlisted, versioned raster recipes; no generated code or implicit I/O."""

import copy
import json
import math
import pathlib
import re

import numpy as np

import baselode
import baselode.geophysics.editing
import baselode.geophysics.processing
import baselode.geophysics.provenance
import baselode.geophysics.microlevelling
import baselode.geophysics.radiometrics
import baselode.geophysics.raster

_DIRECTORY = pathlib.Path(__file__).parent
_CATALOGUE = json.loads((_DIRECTORY / "geophysics_operations.json").read_text())
_OPERATIONS = {item["id"]: item for item in _CATALOGUE}
_MICROLEVELLING = ("estimate_magnetic_microlevelling", "microlevel_magnetic_grid")
_POINTWISE = ("radiometric_ratios", "radiometric_ternary")
_ID = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,63}\Z")


def list_operations():
    """Return independent JSON descriptions of all registered operations.

    Returns
    -------
    list of dict
        Versioned parameter schemas, scientific preconditions and limits.
    """
    return copy.deepcopy(_CATALOGUE)


def describe_operation(operation):
    """Return one independent operation contract.

    Parameters
    ----------
    operation : str
        Registered operation ID.

    Returns
    -------
    dict
        Operation contract. Unknown IDs raise ValueError.
    """
    if not isinstance(operation, str) or operation not in _OPERATIONS:
        raise ValueError("unknown registered geophysics operation")
    return copy.deepcopy(_OPERATIONS[operation])


def workflow_schema():
    """Return the workflow v1 JSON Schema; semantic preflight is also required."""
    return json.loads((_DIRECTORY / "geophysics_workflow.schema.json").read_text())


def magnetic_grid_recipe():
    """Return a regional/residual/edge recipe for an already-corrected grid.

    Returns
    -------
    dict
        Independent workflow requiring input ``magnetic`` with field_type
        ``magnetic_anomaly``. Height 100 is in the input's CRS units; callers
        should choose it for their survey rather than treat it as calibration.
    """
    return json.loads((_DIRECTORY / "magnetic_grid_recipe.json").read_text())


def _integer(value):
    return type(value) in (int, float) and math.isfinite(value) and value == int(value)


def _identifier(value):
    return isinstance(value, str) and bool(_ID.fullmatch(value))


def _parameters(operation, supplied, issue, path):
    schema = operation["parameters"]
    if type(supplied) is not dict:
        issue("rejected", "parameters", path, "parameters must be a JSON object")
        return {}
    result = {}
    for key in supplied.keys() - schema["properties"].keys():
        issue("rejected", "parameter", path + "." + key, "unknown parameter")
    for key, spec in schema["properties"].items():
        if key not in supplied and "default" not in spec:
            if key in schema["required"]:
                issue("needs_input", "parameter", path + "." + key, "supply required parameter")
            continue
        value = supplied.get(key, spec.get("default"))
        kind = spec["type"]
        valid = {"number": type(value) in (int, float), "integer": _integer(value),
                 "string": type(value) is str, "boolean": type(value) is bool, "array": type(value) is list}[kind]
        if valid and kind in ("number", "integer"):
            valid = math.isfinite(value)
            valid = valid and ("minimum" not in spec or value >= spec["minimum"])
            valid = valid and ("maximum" not in spec or value <= spec["maximum"])
            valid = valid and ("exclusiveMinimum" not in spec or value > spec["exclusiveMinimum"])
        if valid and kind == 'string':
            valid = ('minLength' not in spec or len(value) >= spec['minLength']) and ('maxLength' not in spec or len(value) <= spec['maxLength'])
        if valid and kind == 'array':
            valid = ('minItems' not in spec or len(value) >= spec['minItems']) and ('maxItems' not in spec or len(value) <= spec['maxItems'])
        if "enum" in spec:
            valid = valid and value in spec["enum"]
        if not valid:
            issue("rejected", "parameter", path + "." + key, "value violates the operation parameter schema")
        else:
            result[key] = int(value) if kind == "integer" else value
    if operation["id"] == "band_pass" and all(key in result for key in ("short_wavelength", "long_wavelength")):
        if result["short_wavelength"] >= result["long_wavelength"]:
            issue("rejected", "parameter", path, "short_wavelength must be less than long_wavelength")
    if operation["id"] == "reduce_to_pole" and abs(result.get("inclination", 90)) < 15:
        issue("rejected", "parameter", path + ".inclination", "RTP requires |inclination| >= 15 degrees")
    return result


def _output_context(context, operation, parameters):
    result = copy.deepcopy({key: value for key, value in context.items() if key != "grid"})
    result["grid"] = context["grid"]
    name = operation["id"]
    if operation["outputs"]["field_type"] != "preserve":
        result["field_type"] = operation["outputs"]["field_type"]
    if name in _POINTWISE:
        result["units"] = list(operation["outputs"]["band_units"])
    elif name == "tilt_derivative":
        result["units"] = ["degree"] * context["grid"].band_count
    elif name in ("vertical_derivative", "horizontal_derivative", "total_horizontal_derivative", "analytic_signal"):
        distance = context["distance_unit"]
        order = parameters.get("order", 1)
        denominator = distance if order == 1 else f"{distance}^{order}"
        result["units"] = [f"{'(' + unit + ')' if '/' in unit or '^' in unit else unit}/{denominator}" for unit in context["units"]]
    return result


def validate_workflow(workflow, inputs):
    """Preflight the complete recipe without running numerical kernels.

    Parameters
    ----------
    workflow : dict
        Workflow v1 JSON document. References resolve to named inputs or an
        earlier step; IDs are unique across both namespaces.
    inputs : dict of str to GeophysicsRaster
        Explicit in-memory inputs. Each needs scalar metadata.field_type,
        one metadata.units string per band, and linear coordinates.

    Returns
    -------
    dict
        ``state`` (ok, needs_input or rejected), actionable ``issues``, a
        default-expanded ``plan`` and conservative ``resource_estimate``.
        Limits bound retained cell values and FFT shapes, not wall time or
        the exact peak bytes allocated by a numerical backend.
    """
    issues, plan, contexts = [], [], {}

    def issue(state, code, path, message):
        issues.append({"state": state, "code": code, "path": path, "message": message})

    def finish(retained=0, fft=0):
        state = "rejected" if any(item["state"] == "rejected" for item in issues) else ("needs_input" if issues else "ok")
        return {"state": state, "issues": issues, "plan": plan,
                "resource_estimate": {"retained_cell_values": retained, "max_fft_cells_per_band": fft,
                                      "limits": copy.deepcopy(_CATALOGUE[0]["resources"])}}

    try:
        baselode.geophysics.provenance._json_value(workflow)
    except (ValueError, TypeError, RecursionError):
        issue("rejected", "schema", "workflow", "workflow must be finite acyclic JSON")
        return finish()
    if type(workflow) is not dict or set(workflow) != {"schema", "version", "steps", "outputs"}:
        issue("rejected", "schema", "workflow", "require exactly schema, version, steps and outputs")
        return finish()
    if workflow["schema"] != "baselode.geophysics.workflow" or not _integer(workflow["version"]) or workflow["version"] != 1:
        issue("rejected", "version", "workflow", "unsupported workflow schema/version")
        return finish()
    steps, outputs = workflow["steps"], workflow["outputs"]
    if type(steps) is not list or not 1 <= len(steps) <= 64 or type(outputs) is not list or not outputs or not all(_identifier(ref) for ref in outputs) or len(set(outputs)) != len(outputs):
        issue("rejected", "schema", "workflow", "require 1..64 steps and unique nonempty output IDs")
        return finish()
    if type(inputs) is not dict or not all(_identifier(key) for key in inputs):
        issue("rejected", "input", "inputs", "inputs must be an object with identifier keys")
        return finish()
    # Spatial requirements flow backwards through dependent steps. An unrelated
    # magnetic branch must not constrain a pointwise concentration input.
    linear_references = set()
    for step in reversed(steps):
        if type(step) is dict and type(step.get('inputs')) is list and all(isinstance(ref, str) for ref in step['inputs']):
            if step.get('operation') not in _POINTWISE or (isinstance(step.get('id'), str) and step['id'] in linear_references):
                linear_references.update(step['inputs'])
    retained, largest_fft = 0, 0
    for key, raster in inputs.items():
        path = "inputs." + key
        if not isinstance(raster, baselode.geophysics.raster.GeophysicsRaster):
            issue("rejected", "input", path, "expected GeophysicsRaster")
            continue
        cells = raster.data.size
        retained += cells
        if cells > 1_000_000:
            issue("rejected", "resource", path, "input exceeds 1000000 cell values")
        pointwise_input = key not in linear_references and any(type(step) is dict and step.get('operation') in _POINTWISE and type(step.get('inputs')) is list and key in step['inputs'] for step in steps)
        spacing = (1.0, 1.0)
        try:
            baselode.geophysics.provenance.encode(raster.metadata, "GeoTIFF", "float64")
            distance = "pointwise" if pointwise_input else baselode.geophysics.processing._coordinate_unit(raster)
            if distance == "coordinate_unit":
                issue("needs_input", "coordinates", path, "supply explicit local metadata.crs_units or a projected CRS")
            transform = raster.transform
            if transform is None or not all(math.isfinite(value) for value in transform):
                raise ValueError("require a finite invertible rectangular affine transform")
            determinant = transform[0] * transform[4] - transform[1] * transform[3]
            if not math.isfinite(determinant) or determinant == 0:
                raise ValueError("require a finite invertible rectangular affine transform")
            # Use the same rectangular-cell check as the numerical kernels.
            spacing = (1.0, 1.0) if pointwise_input else raster.cell_size
            if not all(math.isfinite(value) and value > 0 for value in spacing):
                raise ValueError("cell spacing must be positive and finite")
        except (ValueError, TypeError, RecursionError) as error:
            issue("rejected", "input", path, str(error))
            distance = "coordinate_unit"
            spacing = (1.0, 1.0)
        field = raster.metadata.get("field_type")
        if field is None:
            issue("needs_input", "field_type", path, "supply scalar metadata.field_type for all bands")
        elif field not in ("magnetic_anomaly", "gravity_anomaly", "gravity_disturbance", "radiometric", "other"):
            issue("rejected", "field_type", path, "unsupported field_type; total fields require correction before this workflow")
        units = raster.metadata.get("units")
        if not isinstance(units, list) or len(units) != raster.band_count or not all(isinstance(unit, str) and unit.strip() for unit in units):
            issue("needs_input", "units", path, "supply one nonempty metadata.units string per band")
            units = ["unknown"] * raster.band_count
        contexts[key] = {"grid": raster, "field_type": field, "units": units, "distance_unit": distance, "spacing": spacing}
    ids = set(inputs)
    for index, step in enumerate(steps):
        path = f"steps[{index}]"
        if type(step) is not dict or set(step) != {"id", "operation", "version", "inputs", "parameters"}:
            issue("rejected", "schema", path, "step requires exactly id, operation, version, inputs and parameters")
            continue
        name = step["id"]
        if not _identifier(name) or name in ids:
            issue("rejected", "reference", path + ".id", "step ID must be valid and unique across inputs/steps")
            continue
        operation = _OPERATIONS.get(step["operation"]) if isinstance(step["operation"], str) else None
        if operation is None or not _integer(step["version"]) or step["version"] != 1:
            issue("rejected", "operation", path, "unknown operation or unsupported version")
            ids.add(name)
            continue
        refs = step["inputs"]
        if not isinstance(refs, list) or len(refs) != operation["inputs"]["count"] or not all(_identifier(ref) for ref in refs):
            issue("rejected", "input", path + ".inputs", "wrong input count or invalid reference IDs")
            ids.add(name)
            continue
        params = _parameters(operation, step["parameters"], issue, path + ".parameters")
        sources = []
        for ref in refs:
            if ref not in contexts:
                if ref not in ids:
                    state = "rejected" if any(isinstance(later, dict) and later.get("id") == ref for later in steps[index:]) else "needs_input"
                    issue(state, "reference", path + ".inputs", f"supply input {ref!r}; step references must point backward")
            else:
                sources.append(contexts[ref])
        if len(sources) == len(refs):
            for source in sources:
                if source["field_type"] is not None and source["field_type"] not in operation["inputs"]["field_types"]:
                    issue("rejected", "applicability", path, "operation is not applicable to this field_type")
            left = sources[0]
            if len(sources) == 2:
                right = sources[1]
                a, b = left["grid"], right["grid"]
                if a.data.shape != b.data.shape or a.transform != b.transform or a.crs != b.crs:
                    issue("rejected", "alignment", path, "combine requires exactly matching shape, transform and CRS")
                if left["units"] != right["units"] or left["field_type"] != right["field_type"]:
                    issue("rejected", "units", path, "combine requires matching units and field_type")
            if operation['id'] in _POINTWISE and refs[0] not in inputs:
                issue('rejected', 'radiometric', path, 'radiometric product steps require a named verified input stack; run upstream transforms separately and verify their output context/support first')
            if operation['id'] in _POINTWISE and refs[0] in inputs and left['grid'].data.size <= 1000000 and retained + left['grid'].data.size <= 16000000:
                try:
                    baselode.geophysics.radiometrics._calculate(left['grid'], operation['id'], params, preflight=True)
                except (ValueError, TypeError, RecursionError) as error:
                    issue('needs_input' if isinstance(error, baselode.geophysics.radiometrics._NeedsInput) else 'rejected', 'radiometric', path, str(error))
            if operation['id'] in _MICROLEVELLING:
                if refs[0] not in inputs:
                    issue('rejected', 'microlevelling', path, 'microlevelling steps require a named verified input grid; verify upstream transforms separately')
                elif left['grid'].data.size <= 1000000 and retained + left['grid'].data.size <= 16000000:
                    try:
                        baselode.geophysics.microlevelling._preflight(left['grid'], params)
                    except (ValueError, TypeError, RecursionError) as error:
                        issue('needs_input' if isinstance(error, baselode.geophysics.microlevelling._NeedsInput) else 'rejected', 'microlevelling', path, str(error))
            contexts[name] = _output_context(left, operation, params)
            retained += left["grid"].data.size
            grid = left["grid"]
            if operation["id"] not in ("combine", "horizontal_derivative", "total_horizontal_derivative", *_POINTWISE):
                length = params.get("along_line_wavelength", params.get("long_wavelength", params.get("wavelength")))
                cell_x, cell_y = left["spacing"]
                if length is not None and not all(math.isfinite(length / spacing) for spacing in (cell_x, cell_y)):
                    issue("rejected", "parameter", path, "wavelength/cell-size ratio exceeds numeric backend range")
                else:
                    rows = baselode.geophysics.processing._fft_size(grid.height + 2 * baselode.geophysics.processing._pad_cells(length, cell_y, grid.height))
                    columns = baselode.geophysics.processing._fft_size(grid.width + 2 * baselode.geophysics.processing._pad_cells(length, cell_x, grid.width))
                    largest_fft = max(largest_fft, rows * columns)
        ids.add(name)
        plan.append({**step, "parameters": params})
    for ref in outputs:
        if ref not in ids:
            issue("rejected", "reference", "outputs", "output must name an available input or step")
    if retained > 16_000_000 or largest_fft > 4_194_304:
        issue("rejected", "resource", "workflow", "retained cell values or padded FFT exceeds registered resource limits")
    return finish(int(retained), largest_fft)


def run_workflow(workflow, inputs):
    """Execute a preflighted in-memory recipe using only registered kernels.

    Parameters
    ----------
    workflow : dict
        Workflow v1 JSON document; see :func:`validate_workflow`.
    inputs : dict of str to GeophysicsRaster
        Original rasters are preserved, including their nested metadata.

    Returns
    -------
    dict
        Validation result plus ``artifacts`` (full-resolution rasters),
        ``diagnostics`` and ``completed_steps``. Invalid preflight never
        starts processing. Backend exceptions return state ``failed`` and no
        partial artifacts. This is not a process sandbox or timeout facility.
    """
    report = validate_workflow(workflow, inputs)
    report.update(artifacts={}, diagnostics=[], completed_steps=[])
    if report["state"] != "ok":
        return report
    values = {}
    try:
        for key, raster in inputs.items():
            values[key] = raster.copy_with(raster.data.copy(), metadata=copy.deepcopy(raster.metadata))
        for step in report["plan"]:
            sources = [values[ref] for ref in step["inputs"]]
            name, params = step["operation"], step["parameters"]
            if name == "combine":
                product = baselode.geophysics.editing.combine(*sources, **params)
            elif name in _MICROLEVELLING:
                product = getattr(baselode.geophysics.microlevelling, name)(sources[0], params)
            elif name in _POINTWISE:
                product = getattr(baselode.geophysics.radiometrics, name)(sources[0], **params)
            else:
                product = getattr(baselode.geophysics.processing, name)(sources[0], **params)
            product.metadata["field_type"] = _OPERATIONS[name]["outputs"]["field_type"] if _OPERATIONS[name]["outputs"]["field_type"] != "preserve" else sources[0].metadata["field_type"]
            product = product.copy_with(processing={"operation": "workflow_step", "id": step["id"],
                "registered_operation": name, "operation_version": 1, "parameters": copy.deepcopy(params),
                "workflow_version": 1, "library_version": baselode.__version__,
                "backend": {"name": "numpy", "version": np.__version__}})
            values[step["id"]] = product
            report["completed_steps"].append(step["id"])
            report["diagnostics"].append({"step": step["id"], "cell_values": int(product.data.size),
                                          "assumptions": copy.deepcopy(_OPERATIONS[name]["assumptions"])})
        report["artifacts"] = {key: values[key] for key in workflow["outputs"]}
    except Exception as error:
        report["state"] = "failed"
        report["issues"].append({"state": "failed", "code": "execution", "path": "execution",
                                 "message": str(error)})
    return report
