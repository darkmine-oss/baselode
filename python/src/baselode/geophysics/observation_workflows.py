# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Typed, bounded observation recipes composed solely of registered kernels."""
import copy
import json
import math
import pathlib
import re

import baselode
import baselode.geophysics.corrections
import baselode.geophysics.gridding
import baselode.geophysics.igrf
import baselode.geophysics.normal_gravity
import baselode.geophysics.observations
import baselode.geophysics.provenance
import baselode.geophysics.workflows

_DIRECTORY = pathlib.Path(__file__).parent
_DESCRIPTOR = json.loads((_DIRECTORY / 'geophysics_observation_workflow.json').read_text())
_OPERATIONS = {item['id']: item for item in _DESCRIPTOR['operations']}
_LIMITS = _DESCRIPTOR['resources']


class _WorkflowError(ValueError):
    def __init__(self, state, code, path, message):
        super().__init__(message)
        self.state, self.code, self.path = state, code, path


def describe_observation_workflow():
    """Return the workflow schema, operation/port contracts and resource limits.

    Returns
    -------
    dict
        Independent version-1 descriptor. Preflight is structural; native
        kernels validate scientific values/context at their execution stage.
    """
    return copy.deepcopy(_DESCRIPTOR)


def magnetic_observation_recipe():
    """Return a synthetic QC/levelling/gridding/edge example, not calibration.

    Returns
    -------
    dict
        Independent saved workflow for input survey with reference lines R1/R2
        and targets A😀/B, a magnetic_anomaly mag channel in nT and known
        unapplied magnetic_levelling. Replace survey-specific parameters explicitly.
    """
    return json.loads((_DIRECTORY / 'magnetic_observation_recipe.json').read_text())


def _identifier(value):
    return isinstance(value, str) and re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}', value) is not None


def _integer(value):
    return type(value) in (int, float) and math.isfinite(value) and value == int(value)


def _require(condition, message, code='contract', path='workflow', state='rejected'):
    if not condition:
        raise _WorkflowError(state, code, path, message)


def _bytes(value):
    baselode.geophysics.provenance._json_value(value)
    return len(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8'))


def _result():
    return {'schema': 'baselode.geophysics.observation_workflow_result', 'version': 1, 'state': 'ok', 'issues': [],
            'workflow': None, 'plan': [], 'completed_steps': [], 'artifacts': {}, 'step_reports': {}, 'input_bindings': {},
            'producer': {'library': 'baselode', 'version': baselode.__version__, 'algorithm_version': 1},
            'resource_estimate': {'retained_records': 0, 'retained_readings': 0, 'retained_cell_values': 0, 'limits': copy.deepcopy(_LIMITS)}}


def _abort(report, error):
    report['state'] = error.state if isinstance(error, _WorkflowError) else 'rejected'
    report['issues'].append({'code': error.code if isinstance(error, _WorkflowError) else 'contract',
                             'path': error.path if isinstance(error, _WorkflowError) else 'workflow', 'message': str(error)})
    report['artifacts'] = {}
    return report


def _reference(ref, contexts):
    _require(type(ref) is dict, 'references must be exact input or step/output objects', 'reference')
    if set(ref) == {'input'} and _identifier(ref['input']):
        key = ('input', ref['input'])
    elif set(ref) == {'step', 'output'} and _identifier(ref['step']) and _identifier(ref['output']):
        key = ('step', ref['step'], ref['output'])
    else:
        raise _WorkflowError('rejected', 'reference', 'workflow', 'references must be exact input or step/output objects')
    _require(key in contexts, 'reference must name an available input or earlier typed output port', 'reference')
    return key


def _size(value, kind):
    if kind == 'observations':
        records = len(value['records'])
        return {'kind': kind, 'records': records, 'readings': records * len(value['channels']), 'cells': 0}
    return {'kind': kind, 'records': 0, 'readings': 0, 'cells': int(value.data.size) if kind == 'raster' else 0}


def _reserve(estimate, context):
    for key, field, limit in [('retained_records', 'records', 'max_retained_records'), ('retained_readings', 'readings', 'max_retained_readings'), ('retained_cell_values', 'cells', 'max_retained_cell_values')]:
        total = estimate[key] + context[field]
        _require(total <= _LIMITS[limit], 'retained workflow artifacts exceed ' + limit, 'resource')
        estimate[key] = total


def _prepare(workflow, inputs):
    report, values, contexts = _result(), {}, {}
    try:
        _require(_bytes(workflow) <= _LIMITS['max_workflow_json_bytes'], 'workflow JSON exceeds 1 MiB', 'resource')
        _require(type(workflow) is dict and set(workflow) == {'schema', 'version', 'steps', 'outputs'}, 'require exactly schema/version/steps/outputs')
        _require(workflow['schema'] == 'baselode.geophysics.observation_workflow' and _integer(workflow['version']) and workflow['version'] == 1, 'unsupported observation workflow version', 'version')
        steps, outputs = workflow['steps'], workflow['outputs']
        _require(type(steps) is list and 1 <= len(steps) <= _LIMITS['max_steps'], 'require 1..16 ordered steps', 'resource')
        _require(type(outputs) is dict and outputs and all(_identifier(k) for k in outputs), 'require named output references')
        _require(len(outputs) <= _LIMITS['max_outputs'], 'workflow exceeds 32 outputs', 'resource')
        _require(type(inputs) is dict and inputs and all(_identifier(k) for k in inputs), 'require named observation inputs')
        _require(len(inputs) <= _LIMITS['max_inputs'], 'workflow exceeds 8 inputs', 'resource')
        report['workflow'] = copy.deepcopy(workflow)
        input_bytes = 0
        for name, payload in inputs.items():
            data = baselode.geophysics.observations.create_observations(payload)
            input_bytes += _bytes(data)
            _require(input_bytes <= _LIMITS['max_input_json_bytes'], 'aggregate observation input JSON exceeds 32 MiB', 'resource')
            inspected = baselode.geophysics.corrections.inspect_corrections(data)
            _require(inspected['state'] == 'ok', 'invalid input correction history: ' + str(inspected['issues']), 'history', 'inputs.' + name)
            report['input_bindings'][name] = inspected['ledger']['current_binding']
            key = ('input', name)
            values[key], contexts[key] = data, _size(data, 'observations')
            _reserve(report['resource_estimate'], contexts[key])
        ids = set(inputs)
        for index, step in enumerate(steps):
            path = 'steps.' + str(index)
            _require(type(step) is dict and set(step) == {'id', 'operation', 'version', 'inputs', 'parameters'}, 'steps require exactly id/operation/version/inputs/parameters', path=path)
            name, operation = step['id'], step['operation']
            _require(_identifier(name) and name not in ids, 'step IDs must be unique and distinct from input names', path=path)
            _require(isinstance(operation, str) and operation in _OPERATIONS, 'unknown registered observation workflow operation', 'operation', path)
            _require(_integer(step['version']) and step['version'] == 1, 'unsupported operation version', 'version', path)
            contract = _OPERATIONS[operation]
            params = step['parameters']
            _require(type(params) is dict and not params.keys() - contract['parameters']['properties'].keys(), 'parameters must use registered keys', 'parameter', path)
            _require(not set(contract['parameters'].get('required', [])) - params.keys(), 'supply required operation parameters', 'parameter', path, 'needs_input')
            _require(type(step['inputs']) is list and len(step['inputs']) == len(contract['inputs']), 'wrong operation input count', 'input', path)
            sources = [contexts[_reference(ref, contexts)] for ref in step['inputs']]
            _require([item['kind'] for item in sources] == contract['inputs'], 'input reference types do not match operation ports', 'input', path)
            if operation == 'remove_igrf':
                _require(baselode.geophysics.igrf._ppigrf is not None, 'remove_igrf requires Python baselode[magnetics]; install that extra before execution', 'backend', path, 'needs_input')
            if operation == 'remove_normal_gravity':
                _require(baselode.geophysics.normal_gravity._boule is not None, 'remove_normal_gravity requires Python baselode[gravity]', 'backend', path, 'needs_input')
            for port, kind in contract['outputs'].items():
                context = {'kind': kind, 'records': 0, 'readings': 0, 'cells': 0}
                if kind == 'observations':
                    context.update(sources[0])
                elif kind == 'raster':
                    if operation.startswith('raster_'):
                        context['cells'] = sources[0]['cells']
                    else:
                        shape, channels = params.get('shape'), params.get('channels')
                        if type(shape) is list and len(shape) == 2 and all(_integer(v) and v > 0 for v in shape) and type(channels) is list:
                            context['cells'] = int(shape[0]) * int(shape[1]) * len(channels)
                contexts[('step', name, port)] = context
                _reserve(report['resource_estimate'], context)
            ids.add(name)
            report['plan'].append(copy.deepcopy(step))
        for ref in outputs.values():
            _reference(ref, contexts)
    except (ValueError, TypeError, RecursionError, OverflowError) as error:
        _abort(report, error)
    return report, values


def validate_observation_workflow(workflow, inputs):
    """Structurally preflight a saved observation workflow without numerics.

    Parameters
    ----------
    workflow : dict
        Version-1 ordered steps and named typed-port output references.
    inputs : dict
        Named in-memory observation documents. Originals are never modified.

    Returns
    -------
    dict
        State/issues, copied plan, input bindings and conservative retained
        resource estimate. ok does not validate future scientific contexts;
        the native kernel checks each step's values/support during execution.
        Known unavailable IGRF backends block every step before execution.
    """
    return _prepare(workflow, inputs)[0]


def _execute(step, sources):
    operation, params = step['operation'], step['parameters']
    if operation.startswith('raster_'):
        workflow = {'schema': 'baselode.geophysics.workflow', 'version': 1, 'steps': [{'id': 'product', 'operation': operation[7:], 'version': 1, 'inputs': ['left', 'right'][:len(sources)], 'parameters': params}], 'outputs': ['product']}
        report = baselode.geophysics.workflows.run_workflow(workflow, dict(zip(['left', 'right'], sources)))
        ports = {'raster': report['artifacts']['product']} if report['state'] == 'ok' else {}
    elif operation == 'qc_observations':
        _require(type(params['qc']) is dict, 'qc must be an explicit options object', 'parameter')
        _require(_integer(params['max_flags']) and 0 <= params['max_flags'] <= 10000, 'max_flags must be integer 0..10000', 'parameter')
        report = baselode.geophysics.observations.qc_observations(sources[0], params['qc'])
        if report['state'] == 'ok' and len(report['flags']) > params['max_flags']:
            report['state'] = 'needs_input'
            report['issues'].append({'code': 'qc_gate', 'message': 'QC flag count exceeds explicit max_flags; review observations'})
        if report.get('flags_truncated'):
            report['state'] = 'rejected'
        ports = {}
    elif operation == 'declare_corrections':
        report = baselode.geophysics.corrections.declare_corrections(sources[0], params['declarations'])
        ports = {'observations': report['observations']}
    elif operation == 'inspect_corrections':
        report = baselode.geophysics.corrections.inspect_corrections(sources[0])
        ports = {}
    elif operation == 'grid_observations':
        report = baselode.geophysics.gridding.grid_observations(sources[0], params)
        ports = report['artifacts']
    else:
        kernels = {'remove_normal_gravity': baselode.geophysics.normal_gravity.remove_normal_gravity, 'correct_magnetic_base': baselode.geophysics.corrections.correct_magnetic_base, 'remove_igrf': baselode.geophysics.igrf.remove_igrf,
                   'correct_magnetic_lag': baselode.geophysics.corrections.correct_magnetic_lag, 'correct_magnetic_heading': baselode.geophysics.corrections.correct_magnetic_heading,
                   'reproject_observations': baselode.geophysics.corrections.reproject_observations, 'analyze_crossovers': baselode.geophysics.corrections.analyze_crossovers,
                   'level_magnetic_lines': baselode.geophysics.corrections.level_magnetic_lines}
        report = kernels[operation](*sources, params)
        ports = {'observations': report['observations']} if 'observations' in _OPERATIONS[operation]['outputs'] else {}
    summary = {key: value for key, value in report.items() if key not in ('observations', 'artifacts', 'plan', 'workflow')}
    ports = {**ports, 'report': summary}
    return report, ports


def run_observation_workflow(workflow, inputs):
    """Execute registered observation/grid/raster stages with atomic outputs.

    Parameters
    ----------
    workflow : dict
        Saved JSON workflow; see describe_observation_workflow(). Explicit
        parameters/calibrations and operation ordering remain caller choices.
    inputs : dict
        Named observation documents. No implicit file I/O or generated code.

    Returns
    -------
    dict
        Full-resolution named artifacts only after every stage succeeds.
        First non-ok step withholds all artifacts; completed IDs and bounded
        native step reports remain for audit. Never resumes partial products.
        Native correction ledgers/source lineage remain intact. This executor
        adds step metadata, not scientific validation or uncertainty claims.
    """
    result, values = _prepare(workflow, inputs)
    if result['state'] != 'ok':
        return result
    actual = {key: 0 for key in ('retained_records', 'retained_readings', 'retained_cell_values')}
    actual['limits'] = copy.deepcopy(_LIMITS)
    result['resource_usage'] = actual
    try:
        for value in values.values():
            _reserve(actual, _size(value, 'observations'))
        for step in result['plan']:
            sources = [values[_reference(ref, values)] for ref in step['inputs']]
            report, ports = _execute(step, sources)
            candidate = {**result['step_reports'], step['id']: ports['report']}
            _require(_bytes(candidate) <= _LIMITS['max_reports_json_bytes'], 'native workflow reports exceed 8 MiB', 'resource', step['id'])
            result['step_reports'] = candidate
            if report['state'] != 'ok':
                raise _WorkflowError(report['state'], 'step', step['id'], 'native operation did not pass; inspect step_reports')
            marker = {'operation': 'observation_workflow_step', 'version': 1, 'id': step['id'], 'registered_operation': step['operation'], 'operation_version': 1,
                      'inputs': copy.deepcopy(step['inputs']), 'workflow_version': 1, 'parameters': copy.deepcopy(step['parameters']), 'library_version': baselode.__version__}
            for port, kind in _OPERATIONS[step['operation']]['outputs'].items():
                product = ports[port]
                if kind == 'observations':
                    product['metadata']['processing'] = list(product['metadata'].get('processing', [])) + [marker]
                    product = baselode.geophysics.observations.create_observations(product)
                    baselode.geophysics.provenance.encode(product['metadata'], 'GeoTIFF', 'float64')
                elif kind == 'raster':
                    product = product.copy_with(product.data, metadata=copy.deepcopy(product.metadata), processing=marker)
                    baselode.geophysics.provenance.encode(product.metadata, 'GeoTIFF', 'float64')
                _reserve(actual, _size(product, kind))
                values[('step', step['id'], port)] = product
            result['completed_steps'].append(step['id'])
        result['artifacts'] = {name: values[_reference(ref, values)] for name, ref in result['workflow']['outputs'].items()}
    except _WorkflowError as error:
        _abort(result, error)
    except ImportError as error:
        _abort(result, _WorkflowError('needs_input', 'backend', 'execution', str(error)))
    except Exception as error:
        _abort(result, _WorkflowError('failed', 'execution', 'execution', str(error)))
    return result
