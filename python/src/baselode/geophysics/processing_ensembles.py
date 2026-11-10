# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Empirical registered-XY stability across declared raster processing choices."""
import copy
import json
import pathlib
import numpy as np
import baselode
import baselode.geophysics._ensemble_common
import baselode.geophysics.corrections
import baselode.geophysics.forward_common
import baselode.geophysics.gravity_prisms
import baselode.geophysics.processing
import baselode.geophysics.provenance
import baselode.geophysics.raster
import baselode.geophysics.workflows

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent/'geophysics_processing_ensemble.json').read_text())
_ALLOWED = ('low_pass', 'high_pass', 'band_pass', 'upward_continuation', 'reduce_to_pole', 'microlevel_magnetic_grid')


def _payload(raster):
    # Raster DTO transforms are tuples in Python; transport is plain scalar JSON.
    return json.loads(json.dumps(raster.to_payload(), ensure_ascii=False, allow_nan=False))


def _source(payload):
    baselode.geophysics._ensemble_common._keys(payload, ('data', 'transform', 'crs', 'nodata', 'bandNames', 'metadata'), ('hasExplicitTransform',), ('crs', 'nodata'))
    if payload['nodata'] is not None:raise ValueError('portable ensemble rasters use explicit null data cells, not nodata sentinels')
    if 'hasExplicitTransform' in payload and payload['hasExplicitTransform'] is not True:raise baselode.geophysics.corrections._NeedsInput('declare the raster transform explicitly')
    data = payload['data']
    if type(data) is not list or len(data) != 1 or type(data[0]) is not list or not 4 <= len(data[0]) <= 1024:raise ValueError('one band and 4..1024 rows required')
    band = data[0]
    if type(band[0]) is not list or not 4 <= len(band[0]) <= 1024:raise ValueError('4..1024 columns required')
    width = len(band[0]);cells = width*len(band)
    if cells > 8192:raise baselode.geophysics.corrections._ResourceError('at most8192 source cells')
    for row in band:
        if type(row) is not list or len(row) != width:raise ValueError('rectangular raster required')
        for value in row:
            if value is not None:baselode.geophysics.forward_common._number(value, -1e8, 1e8)
    if not any(value is not None for row in band for value in row):raise baselode.geophysics.corrections._NeedsInput('source raster has no finite samples')
    transform = payload['transform']
    if type(transform) is not list or len(transform) != 6:raise ValueError('explicit six-value affine required')
    for value in transform:baselode.geophysics.forward_common._number(value, -1e9, 1e9)
    if transform[1] != 0 or transform[3] != 0 or transform[0] <= 0 or transform[4] >= 0:raise ValueError('north-up unrotated metre raster required')
    if type(payload['bandNames']) is not list or len(payload['bandNames']) != 1:raise ValueError('one band name required')
    baselode.geophysics.forward_common._label(payload['bandNames'][0])
    if type(payload['metadata']) is not dict:raise ValueError('raster metadata must be object')
    raster = baselode.geophysics.raster.GeophysicsRaster.from_payload(copy.deepcopy(payload))
    if baselode.geophysics.processing._coordinate_unit(raster) != 'm':raise baselode.geophysics.corrections._NeedsInput('known projected/local metre coordinates required')
    return raster


def _prepare(request):
    p = baselode.geophysics._ensemble_common._json(request)
    baselode.geophysics._ensemble_common._keys(p, ('schema', 'version', 'raster', 'context', 'members', 'noise_standard_deviation', 'options', 'execution'), ('metadata',), ('noise_standard_deviation',))
    if p['schema'] != 'baselode.geophysics.processing_ensemble_request' or type(p['version']) not in (int, float) or p['version'] != 1:raise ValueError('unsupported processing ensemble schema/version')
    raster = _source(p['raster']);context = p['context']
    baselode.geophysics._ensemble_common._keys(context, ('quantity', 'units', 'field_type', 'reference_id', 'height_datum', 'comparison_scope'))
    for key in ('quantity', 'units', 'reference_id', 'height_datum'):baselode.geophysics.forward_common._label(context[key])
    if context['comparison_scope'] != 'registered_xy_processing_choices':raise ValueError('declare registered_xy_processing_choices comparison')
    if context['field_type'] not in ('magnetic_anomaly', 'gravity_anomaly', 'gravity_disturbance', 'radiometric', 'other'):raise ValueError('unsupported compared field type')
    if raster.metadata.get('field_type') != context['field_type'] or raster.metadata.get('units') != [context['units']]:raise baselode.geophysics.corrections._NeedsInput('raster field_type/units must match explicit comparison context')
    members = p['members']
    if type(members) is not list or not 1 <= len(members) <= 16:raise ValueError('declare one to sixteen members')
    options = p['options'];baselode.geophysics._ensemble_common._keys(options, ('failure_policy', 'minimum_successful_members', 'minimum_cell_members', 'quantiles', 'threshold', 'edge_margin_cells'))
    baselode.geophysics._ensemble_common._failure_options(options, len(members))
    baselode.geophysics._ensemble_common._integer(options['minimum_cell_members'], 1, len(members))
    baselode.geophysics._ensemble_common._integer(options['edge_margin_cells'], 0, min(raster.height, raster.width)//2)
    baselode.geophysics._ensemble_common._threshold(options['threshold'], context['quantity'], context['units'])
    if p['noise_standard_deviation'] is not None:baselode.geophysics.forward_common._number(p['noise_standard_deviation'], 1e-12, 1e8)
    execution = p['execution'];baselode.geophysics._ensemble_common._keys(execution, ('max_retained_cell_values', 'max_fft_cell_work'))
    baselode.geophysics._ensemble_common._integer(execution['max_retained_cell_values'], 1, 2097152)
    baselode.geophysics._ensemble_common._integer(execution['max_fft_cell_work'], 0, 67108864)
    seen, plans = set(), [];retained = fft_work = steps = 0
    for member in members:
        baselode.geophysics._ensemble_common._keys(member, ('id', 'workflow', 'output', 'noise'), nullable=('workflow',))
        baselode.geophysics.forward_common._label(member['id'])
        if member['id'] in seen:raise ValueError('duplicate member ID')
        seen.add(member['id']);baselode.geophysics._ensemble_common._noise(member['noise'])
        if member['noise']['kind'] != 'none' and p['noise_standard_deviation'] is None:raise baselode.geophysics.corrections._NeedsInput('supply independent input-cell noise standard deviation')
        if member['workflow'] is None:
            if member['output'] != 'survey':raise ValueError('identity member output must be survey')
            count, work, size = 0, 0, int(raster.data.size)
        else:
            result = baselode.geophysics.workflows.validate_workflow(member['workflow'], {'survey': raster});baselode.geophysics._ensemble_common._raise(result)
            if any(step['operation'] not in _ALLOWED for step in result['plan']):raise ValueError('only registered scalar field/units-preserving ensemble operations supported')
            if member['output'] not in member['workflow']['outputs']:raise ValueError('selected output must be declared by the workflow')
            count = len(result['plan']);size = result['resource_estimate']['retained_cell_values'];work = count*result['resource_estimate']['max_fft_cells_per_band']
        retained += size;fft_work += work;steps += count
        plans.append({'id': member['id'], 'steps': count, 'retained_cell_values': size, 'fft_cell_work': work})
    if steps > 128 or retained > execution['max_retained_cell_values'] or fft_work > execution['max_fft_cell_work']:raise baselode.geophysics.corrections._ResourceError('aggregate processing steps/retained-cells/FFT-work budget exceeded')
    baselode.geophysics._ensemble_common._metadata(p, 131072)
    return p, raster, plans, {'member_count': len(members), 'source_cells': int(raster.data.size), 'steps': steps, 'retained_cell_values': retained, 'fft_cell_work': fft_work}


def _report(phase):
    return {'schema': 'baselode.geophysics.processing_ensemble_'+phase, 'version': 1, 'state': 'ok', 'issues': [], 'request': None, 'members': [], 'coverage': None, 'maps': None, 'mean_raster': None, 'resource_estimate': None, 'producer': baselode.geophysics.corrections._producer()}


def _error(report, error):
    baselode.geophysics.gravity_prisms._error(report, error)
    report.pop('diagnostics', None);report.update(members=[], coverage=None, maps=None, mean_raster=None, resource_estimate=None)


def describe_processing_ensemble():
    """Return copied registered raster-choice stability contracts and resources.

    Returns
    -------
    dict
        XY comparison, masks, explicit thresholds/edges/noise and finite budgets.
    """
    return copy.deepcopy(_DESCRIPTOR)


def validate_processing_ensemble(request):
    """Preflight every raster recipe/selector and aggregate resource estimate.

    Parameters
    ----------
    request : dict
        V1 processing_ensemble_request with shared single-band portable raster,
        known metre geometry/context, explicit identity/registered workflows and
        caller threshold/noise/coverage/edge/work controls. No kernels execute.

    Returns
    -------
    dict
        Atomic copied request and bounded static resource estimates.
    """
    report = _report('validation')
    try:
        p, _, plans, estimate = _prepare(request)
        report.update(request=p, resource_estimate={**estimate, 'members': plans})
        baselode.geophysics._ensemble_common._json(report, True, max_nodes=5000000, max_depth=40)
    except (ValueError, TypeError, RecursionError, ArithmeticError, RuntimeError) as error:_error(report, error)
    return report


def _noise(raster, spec, sigma):
    if spec['kind'] == 'none':return baselode.geophysics.raster.GeophysicsRaster.from_payload(_payload(raster)), {'kind': 'none', 'seed': None, 'algorithm': None, 'numpy_version': np.__version__, 'standard_draws': None, 'rounding_lost_perturbations': 0}
    rng = np.random.Generator(np.random.PCG64(int(spec['seed'])));standard = rng.standard_normal(raster.data.shape)
    valid = np.isfinite(raster.data);values = np.where(valid, raster.data+sigma*standard, np.nan)
    lost = int(np.count_nonzero(valid & (standard != 0) & (values == raster.data)))
    if np.any(np.abs(values[valid]) > 1e8):raise baselode.geophysics.corrections._NeedsInput('noisy raster exceeds verified numeric input range; no clipping')
    product = raster.copy_with(values, metadata=copy.deepcopy(raster.metadata), processing={'operation': 'ensemble_noise', 'model': 'independent_gaussian_supplied_sigma', 'seed': spec['seed'], 'standard_deviation': sigma, 'numpy_version': np.__version__})
    draws = [[float(value) if keep else None for value, keep in zip(row, mask)] for row, mask in zip(standard[0], valid[0])]
    return product, {'kind': spec['kind'], 'seed': spec['seed'], 'algorithm': 'numpy.PCG64.standard_normal_row_major', 'numpy_version': np.__version__, 'standard_draws': draws, 'rounding_lost_perturbations': lost}


def _maps(good, p, source):
    height, width = source.height, source.width;quantiles = p['options']['quantiles']
    maps = {key: [] for key in ('valid_member_count', 'coverage_fraction_requested', 'mean', 'sample_standard_deviation', 'minimum', 'maximum', 'detection_count', 'detection_fraction_valid', 'edge_warning')}
    maps['quantiles'] = [{'fraction': q, 'values': []} for q in quantiles]
    for i in range(height):
        rows = {key: [] for key in maps if key != 'quantiles'};qrows = [[] for q in quantiles]
        for j in range(width):
            values = [row['selected_raster']['data'][0][i][j] for row in good if row['selected_raster']['data'][0][i][j] is not None]
            statistics = baselode.geophysics._ensemble_common._stats(values, quantiles);enough = len(values) >= p['options']['minimum_cell_members']
            rows['valid_member_count'].append(len(values));rows['coverage_fraction_requested'].append(len(values)/len(p['members']))
            for key in ('mean', 'sample_standard_deviation', 'minimum', 'maximum'):rows[key].append(statistics[key] if enough else None)
            hits = sum(baselode.geophysics._ensemble_common._hit(value, p['options']['threshold']) for value in values)
            rows['detection_count'].append(hits);rows['detection_fraction_valid'].append(hits/len(values) if enough else None)
            rows['edge_warning'].append(min(i, j, height-1-i, width-1-j) < p['options']['edge_margin_cells'])
            for k, q in enumerate(statistics['quantiles']):qrows[k].append(q['value'] if enough else None)
        for key, row in rows.items():maps[key].append(row)
        for k, row in enumerate(qrows):maps['quantiles'][k]['values'].append(row)
    maps.update(shape=[height, width], transform=list(source.transform), crs=source.crs, context=copy.deepcopy(p['context']), interpretation='empirical processed responses at registered XY, including declared continuation choices; not posterior or mineralisation probability')
    return maps


def _mean_raster(maps, good, source, p):
    nodes, operands = [], []
    for member in good:
        nodes, operand = baselode.geophysics.provenance.append_input({'input_lineage': nodes}, member['selected_raster']['metadata'])
        operands.append({'id': member['id'], 'lineage_index': operand})
    # Current-grid correction/model states of members are historical, not facts
    # about an empirical mixture of different filters/continuation heights.
    metadata = {key: copy.deepcopy(source.metadata[key]) for key in ('crs_units', 'frame_id') if key in source.metadata}
    metadata.update(field_type='other', units=[p['context']['units']], uncertainty_propagated=False, input_lineage=nodes,
        ensemble_context=copy.deepcopy(p['context']), ensemble_member_lineage=operands,
        processing=[{'operation': 'processing_ensemble_mean', 'version': 1, 'member_ids': [row['id'] for row in good], 'minimum_cell_members': p['options']['minimum_cell_members'], 'library_version': baselode.__version__, 'backend': {'name': 'numpy', 'version': np.__version__}}])
    result = source.copy_with(np.array([maps['mean']], dtype=float), metadata=metadata, nodata=None, band_names=['empirical_processing_mean'])
    baselode.geophysics.provenance.encode(metadata, 'GeoTIFF', 'float64')
    return _payload(result)


def run_processing_ensemble(request):
    """Compare registered raster choices with masked empirical stability maps.

    Parameters
    ----------
    request : dict
        Same contract as validate_processing_ensemble. Identity is workflow=null,
        output=survey. Other members execute only registered recipes against the
        shared or explicitly perturbed survey. All preflight finishes first.

    Returns
    -------
    dict
        All outcomes/actual input+workflow replay/selected products, coverage,
        mean/sample-SD/quantile/detection maps and caller edge warnings. Missing
        pixels are never zeros. Statistics need minimum_cell_members; one value
        has null sample SD. Mean raster carries member lineage as a derived
        field_type=other product, without inheriting current correction states.
        Continuation variants are compared at XY, not one physical height.
    """
    report = _report('result')
    try:
        p, source, plans, estimate = _prepare(request);members = [];aborted = False
        for member, plan in zip(p['members'], plans):
            row = {'id': member['id'], 'state': 'not_run', 'issues': [], 'executed_input': None, 'workflow': copy.deepcopy(member['workflow']), 'output': member['output'], 'noise': None, 'selected_raster': None, 'completed_steps': [], 'resource_estimate': copy.deepcopy(plan)}
            members.append(row)
            if aborted:row['issues'] = [{'code': 'aborted', 'message': 'not run after prior member failure'}];continue
            try:
                raster, noise = _noise(source, member['noise'], p['noise_standard_deviation']);row.update(executed_input=_payload(raster), noise=noise)
                if member['workflow'] is None:product = raster
                else:
                    result = baselode.geophysics.workflows.run_workflow(member['workflow'], {'survey': raster})
                    if type(result) is not dict or not all(key in result for key in ('state','completed_steps','issues','artifacts')) or result['state'] not in ('ok','needs_input','rejected','failed') or any(type(result[key]) is not list for key in ('completed_steps','issues')) or type(result['artifacts']) is not dict:raise RuntimeError('malformed registered workflow result')
                    row['completed_steps'] = copy.deepcopy(result['completed_steps'])
                    if result['state'] != 'ok':
                        row.update(state=result['state'], issues=copy.deepcopy(result['issues']))
                        if p['options']['failure_policy'] == 'abort':aborted = True
                        continue
                    if member['output'] not in result['artifacts']:raise RuntimeError('registered workflow omitted selected output')
                    product = result['artifacts'][member['output']]
                if not isinstance(product, baselode.geophysics.raster.GeophysicsRaster) or np.iscomplexobj(product.data) or np.any(np.isinf(product.data)):raise RuntimeError('malformed/nonfinite selected raster product')
                if product.data.shape != source.data.shape or product.transform != source.transform or product.crs != source.crs or product.metadata.get('units') != [p['context']['units']] or product.metadata.get('field_type') != p['context']['field_type']:raise RuntimeError('selected product changed comparison geometry/units/field type')
                payload = _payload(product)
                for row_values in payload['data'][0]:
                    for value in row_values:
                        if value is not None:baselode.geophysics.forward_common._number(value, -1e100, 1e100)
                row.update(state='ok', selected_raster=payload)
            except (ValueError, TypeError, ArithmeticError, RuntimeError, Warning) as error:
                row.update(state='needs_input' if isinstance(error, baselode.geophysics.corrections._NeedsInput) else 'failed', issues=[{'code': 'member_execution', 'message': str(error)}])
            if row['state'] != 'ok' and p['options']['failure_policy'] == 'abort':aborted = True
        state, coverage = baselode.geophysics._ensemble_common._completion(members, p['options']);good = [row for row in members if row['state'] == 'ok']
        maps = _maps(good, p, source) if state != 'failed' else None
        mean = _mean_raster(maps, good, source, p) if maps is not None else None
        report.update(state=state, request=p, members=members, coverage=coverage, maps=maps, mean_raster=mean, resource_estimate={**estimate, 'members': plans, 'reused_seeds': baselode.geophysics._ensemble_common._reused_seeds(p['members']), 'estimate_semantics': 'retained cell values and FFT-cell step proxy; not wall time or exact RSS'})
        if state != 'ok':report['issues'] = [{'code': 'member_coverage', 'message': 'inspect outcomes and per-cell valid/requested denominators'}]
        baselode.geophysics._ensemble_common._json(report, True, max_nodes=5000000, max_depth=40)
    except (ValueError, TypeError, RecursionError, ArithmeticError, RuntimeError, Warning) as error:_error(report, RuntimeError(str(error)) if isinstance(error, Warning) else error)
    return report
