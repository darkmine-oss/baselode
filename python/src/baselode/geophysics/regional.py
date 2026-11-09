# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Explicit polynomial regional/residual separation with controlled Huber IRLS."""
import copy
import json
import math
import pathlib

import numpy as np

import baselode
import baselode.geophysics.alignment
import baselode.geophysics.colour_scales
import baselode.geophysics.observations
import baselode.geophysics.processing
import baselode.geophysics.provenance
import baselode.geophysics.raster

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent / 'geophysics_regional.json').read_text())
_TERMS = [['1'], ['1', 'u', 'v'], ['1', 'u', 'v', 'u^2', 'u*v', 'v^2']]
_HUBER = ('huber_threshold', 'max_iterations', 'convergence_tolerance')


class _NeedsInput(ValueError):
    def __init__(self, message, diagnostics=None):
        super().__init__(message)
        self.diagnostics = diagnostics or {}


def describe_regional_trend():
    """Return independent parameter/model/resource contracts.

    Returns
    -------
    dict
        Polynomial basis, estimator, training/domain and provenance assumptions.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _number(value):
    return type(value) in (int, float) and abs(value) <= 1e100 and math.isfinite(value)


def _label(value):
    return baselode.geophysics.observations._label(value) and baselode.geophysics.observations._trim(value).lower() not in ('unknown', 'unspecified')


def _parameters(options):
    schema = _DESCRIPTOR['parameters']
    if type(options) is not dict or options.keys() - schema['properties'].keys():
        raise ValueError('regional options must use registered keys')
    if set(schema['required']) - options.keys():
        raise _NeedsInput('supply every explicit band/degree/estimator/training/condition/domain option')
    robust = options['estimator'] == 'huber'
    if robust and any(k not in options for k in _HUBER):
        raise _NeedsInput('Huber requires threshold, iteration limit and convergence tolerance')
    if not robust and any(k in options for k in _HUBER):
        raise ValueError('least_squares forbids unused Huber controls')
    params = {}
    for key, value in options.items():
        spec = schema['properties'][key]
        if spec['type'] in ('number', 'integer'):
            if not _number(value) or ('minimum' in spec and value < spec['minimum']) or ('maximum' in spec and value > spec['maximum']) or ('exclusiveMinimum' in spec and value <= spec['exclusiveMinimum']):
                raise ValueError(key + ' violates its finite numeric range')
            if spec['type'] == 'integer':
                if value != int(value):
                    raise ValueError(key + ' must be an integer')
                params[key] = int(value)
        elif spec['type'] == 'string':
            if not isinstance(value, str) or value not in spec['enum']:
                raise ValueError(key + ' requires an explicit supported policy')
        else:
            if type(value) is not list or len(value) > 16 or any(type(box) is not list or len(box) != 4 or not all(_number(v) for v in box) or not (box[0] < box[2] and box[1] < box[3]) for box in value):
                raise ValueError('exclude_bounds requires <=16 finite positive-area [xmin,ymin,xmax,ymax] boxes')
        if key not in params:
            params[key] = copy.deepcopy(value)
    if robust and params['convergence_tolerance'] > .01 * params['huber_threshold']:
        raise ValueError('convergence_tolerance must be <=0.01*huber_threshold, in field units')
    return params


def _prepare(raster, options):
    params = _parameters(options)
    if not isinstance(raster, baselode.geophysics.raster.GeophysicsRaster):
        raise ValueError('expected GeophysicsRaster')
    if min(raster.height, raster.width) < 8 or raster.data.size > 1000000 or raster.height * raster.width > 262144:
        raise ValueError('require >=8x8, <=262144 selected cells and <=1000000 source values')
    if params['band'] > raster.band_count:
        raise ValueError('band exceeds source band count')
    if raster.transform is None:
        raise _NeedsInput('declare affine geometry')
    baselode.geophysics.alignment._source(raster)
    baselode.geophysics.provenance.encode(raster.metadata, 'GeoTIFF', 'float64')
    if len(json.dumps(raster.metadata, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')) > 524288:
        raise ValueError('regional source metadata exceeds 512 KiB')
    frame = raster.metadata.get('frame_id')
    if frame is not None and not _label(frame):
        raise ValueError('frame_id must be a known bounded string or null')
    if raster.crs is None and frame is None:
        raise _NeedsInput('declare projected CRS or known local frame_id')
    if raster.crs is not None:
        if not baselode.geophysics.observations._text(raster.crs) or len(raster.crs) > 4096 or baselode.geophysics.observations._trim(raster.crs).lower() in ('unknown', 'unspecified'):
            raise ValueError('CRS must be a bounded known label')
        raster.crs.encode('utf-8')
    if not _label(raster.metadata.get('crs_units')):
        raise _NeedsInput('declare linear coordinate units')
    baselode.geophysics.processing._coordinate_unit(raster)
    baselode.geophysics.processing._cell_size(raster)
    units = raster.metadata.get('units')
    if type(units) is not list or len(units) != raster.band_count or not _label(units[params['band'] - 1]) or not _label(raster.metadata.get('field_type')):
        raise _NeedsInput('declare scalar field_type and selected per-band units')
    if not _label(raster.band_names[params['band'] - 1]):
        raise ValueError('selected band name must be known and bounded')
    raster.band_names[params['band'] - 1].encode('utf-8')
    valid = baselode.geophysics.colour_scales.valid_mask(raster.data[params['band'] - 1], raster.nodata)
    values = raster.data[params['band'] - 1].astype(float)
    row, col = np.indices(values.shape, dtype=float)
    a, b, c, d, e, f = raster.transform
    x, y = a * (col + .5) + b * (row + .5) + c, d * (col + .5) + e * (row + .5) + f
    excluded = np.zeros(values.shape, dtype=bool)
    for xmin, ymin, xmax, ymax in params['exclude_bounds']:
        inside = valid & (x >= xmin) & (x <= xmax) & (y >= ymin) & (y <= ymax)
        if not inside.any():
            raise ValueError('each exclusion box must contain a valid source cell centre')
        excluded |= inside
    training = valid & ~excluded
    count = int(training.sum()); fraction = count / values.size
    if count < 64 or fraction < params['min_training_fraction']:
        raise _NeedsInput('insufficient non-excluded training coverage')
    terms = len(_TERMS[params['degree']])
    solves = 1 + params['max_iterations'] if params['estimator'] == 'huber' else 1
    work = (count * terms ** 2 + int(valid.sum()) * terms) * solves
    if work > 100000000:
        raise ValueError('regional fit work exceeds 100000000; reduce region/degree/iteration limit explicitly')
    u, v = (col - (raster.width - 1) / 2) / ((raster.width - 1) / 2), (row - (raster.height - 1) / 2) / ((raster.height - 1) / 2)
    columns = [np.ones(values.shape)]
    if params['degree'] >= 1:
        columns += [u, v]
    if params['degree'] == 2:
        columns += [u ** 2, u * v, v ** 2]
    design = np.stack(columns, axis=-1)
    bounds = [int(col[training].min()), int(row[training].min()), int(col[training].max()), int(row[training].max())]
    outside = valid & ((col < bounds[0]) | (row < bounds[1]) | (col > bounds[2]) | (row > bounds[3]))
    diagnostics = {'valid_cells': int(valid.sum()), 'training_cells': count, 'training_fraction': fraction, 'excluded_valid_cells': int(excluded.sum()),
                   'training_index_bounds': bounds, 'valid_cells_outside_training_bounds': int(outside.sum()), 'fit_work_estimate': work}
    return params, values, valid, training, design, diagnostics


def _solve(design, values, weights, maximum):
    gram = design.T @ (design * weights[:, None])
    rhs = design.T @ (weights * values)
    try:
        inverse = np.linalg.inv(gram)
        condition = float(np.linalg.norm(gram, np.inf) * np.linalg.norm(inverse, np.inf))
        if not math.isfinite(condition) or condition > maximum:
            raise _NeedsInput('weighted normal matrix exceeds max_condition', {'normal_condition': condition if math.isfinite(condition) else None})
        coefficients = np.linalg.solve(gram, rhs)
    except np.linalg.LinAlgError as error:
        raise _NeedsInput('training is rank deficient; change coverage or polynomial degree') from error
    if not np.isfinite(coefficients).all():
        raise _NeedsInput('fit coefficients exceed numerical range')
    return coefficients, condition


def _fit(params, values, valid, training, design, diagnostics):
    x, y = design[training], values[training]
    coefficients, condition = _solve(x, y, np.ones(y.shape), params['max_condition'])
    iteration, change = 0, 0.
    if params['estimator'] == 'huber':
        for iteration in range(1, params['max_iterations'] + 1):
            residual = y - x @ coefficients
            weights = np.ones(y.shape)
            large = np.abs(residual) > params['huber_threshold']
            weights[large] = params['huber_threshold'] / np.abs(residual[large])
            proposed, condition = _solve(x, y, weights, params['max_condition'])
            change = float(np.max(np.abs(design[valid] @ (proposed - coefficients))))
            coefficients = proposed
            if change <= params['convergence_tolerance']:
                break
        else:
            raise _NeedsInput('Huber IRLS did not converge; no artifacts returned', {**diagnostics, 'iterations': iteration, 'converged': False, 'last_max_change': change, 'normal_condition': condition})
    surface = design @ coefficients
    if not np.isfinite(surface[valid]).all():
        raise _NeedsInput('regional prediction exceeds numerical range')
    residual = y - x @ coefficients
    down = np.abs(residual) > params.get('huber_threshold', math.inf)
    diagnostics.update(normal_condition=condition, iterations=iteration if params['estimator'] == 'huber' else 1, converged=True, last_max_change=change,
                       downweighted_training_cells=int(down.sum()), training_residual_rms=float(np.sqrt(np.mean(residual ** 2))), max_abs_training_residual=float(np.max(np.abs(residual))))
    return coefficients, surface


def fit_regional_trend(raster, options):
    """Fit an explicit polynomial regional surface and return its residual.

    Parameters
    ----------
    raster : GeophysicsRaster
        Rectangular projected/local raster with explicit geometry, linear units,
        scalar field_type and selected units. Missing source cells stay missing.
    options : dict
        Required band, degree (0..2), estimator ('least_squares' or 'huber'),
        exclude_bounds (map-coordinate training exclusions), min_training_fraction,
        max_condition (infinity-norm weighted normal condition <=1e8) and
        domain_policy='source_footprint'. Huber requires huber_threshold,
        max_iterations and convergence_tolerance in field units; LS forbids them.

    Returns
    -------
    dict
        State/issues, explicit normalized-index model, fit/support diagnostics,
        and regional/residual/training_mask rasters on success. Invalid,
        nonconverged or ill-conditioned fits withhold all artifacts. Exclusions
        prevent fitting influence; they do not prevent regional subtraction.
        The chosen model is not a uniquely determined geological regional field.
    """
    result = {'schema': 'baselode.geophysics.regional_result', 'version': 1, 'state': 'ok', 'issues': [], 'artifacts': {}, 'diagnostics': {},
              'producer': {'library': 'baselode', 'version': baselode.__version__, 'algorithm_version': 1, 'backend': 'numpy', 'backend_version': np.__version__},
              'assumptions': copy.deepcopy(_DESCRIPTOR['assumptions'])}
    try:
        params, values, valid, training, design, diagnostics = _prepare(raster, options)
        result.update(parameters=copy.deepcopy(params), diagnostics=copy.deepcopy(diagnostics))
        coefficients, surface = _fit(params, values, valid, training, design, diagnostics)
        model = {'algorithm': 'polynomial_regional_v1', 'degree': params['degree'], 'terms': copy.deepcopy(_TERMS[params['degree']]), 'coefficients': coefficients.tolist(),
                 'index_origin': [(raster.width - 1) / 2, (raster.height - 1) / 2], 'index_scale': [(raster.width - 1) / 2, (raster.height - 1) / 2],
                 'source_geometry': {'shape': [raster.height, raster.width], 'transform': list(raster.transform), 'crs': raster.crs},
                 'source_band': params['band'], 'source_band_name': raster.band_names[params['band'] - 1], 'estimator': params['estimator']}
        products = {'regional': surface, 'residual': values - surface, 'training_mask': training.astype(float)}
        artifacts = {}
        for kind, data in products.items():
            mask_product = kind == 'training_mask'
            nodes, operand = baselode.geophysics.provenance.append_input({}, raster.metadata)
            metadata = {key: copy.deepcopy(raster.metadata[key]) for key in ('crs_units', 'frame_id') if key in raster.metadata}
            metadata.update(field_type='other' if mask_product else raster.metadata['field_type'], units=['1' if mask_product else raster.metadata['units'][params['band'] - 1]],
                            uncertainty_propagated=False, input_lineage=nodes, processing=[{'operation': 'fit_regional_trend', 'version': 1, 'parameters': copy.deepcopy(params), 'operand_lineage': operand}],
                            regional_trend={'kind': kind, 'model': copy.deepcopy(model), 'parameters': copy.deepcopy(params), 'diagnostics': copy.deepcopy(diagnostics)})
            baselode.geophysics.provenance.encode(metadata, 'GeoTIFF', 'float64')
            artifacts[kind] = raster.copy_with(np.where(valid, data, np.nan), nodata=None, band_names=[kind], metadata=metadata)
        result.update(parameters=params, model=model, diagnostics=diagnostics, artifacts=artifacts)
    except _NeedsInput as error:
        result.update(state='needs_input', issues=[{'code': 'fit', 'message': str(error)}], diagnostics={**result['diagnostics'], **copy.deepcopy(error.diagnostics)})
    except (RuntimeError, FloatingPointError) as error:
        result.update(state='failed', issues=[{'code': 'backend', 'message': str(error)}])
    except (ValueError, TypeError, RecursionError, OverflowError) as error:
        result.update(state='rejected', issues=[{'code': 'regional', 'message': str(error)}])
    return result
