# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Supplied-calibration airborne radiometric counts, covariance and replay."""
import copy
import datetime
import json
import math
import pathlib
import re
import baselode.geophysics._ensemble_common
import baselode.geophysics.corrections
import baselode.geophysics.forward_common

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent/'geophysics_raw_radiometrics.json').read_text())
_ORDER = ['K', 'eU', 'eTh']
_UNITS = ['%', 'ppm', 'ppm']
_STEPS = ['live_time_normalization', 'calibrated_window_selection', 'reference_air_height', 'background_subtraction', 'height_adjusted_stripping', 'nominal_height_normalization', 'sensitivity_conversion', 'conditional_covariance_propagation']
_EPS = 2.220446049250313e-16


def _vec(value, lower, upper):
    if type(value) is not list or len(value) != 3:raise ValueError('three values required in K/eU/eTh order')
    for number in value:baselode.geophysics.forward_common._number(number, lower, upper)
    return [float(number) for number in value]


def _matrix(value, lower, upper):
    if type(value) is not list or len(value) != 3:raise ValueError('3x3 matrix required in K/eU/eTh order')
    return [_vec(row, lower, upper) for row in value]


def _sum(values):
    total = correction = 0.
    for value in values:
        next_value = total+value
        correction += (total-next_value)+value if abs(total) >= abs(value) else (value-next_value)+total
        total = next_value
    return total+correction


def _dot(a, b):
    return _sum([x*y for x, y in zip(a, b)])


def _product(a, b):
    return [[_dot(row, list(column)) for column in zip(*b)] for row in a]


def _covariance(factor):
    return [[_dot(a, b) for b in factor] for a in factor]


def _psd(value):
    """Scale-normalised, diagonal-pivoted semidefinite Cholesky with audit."""
    original = _matrix(value, -1e12, 1e12)
    if any(0 < abs(v) < 1e-200 for row in original for v in row):raise ValueError('nonzero covariance entries must be >=1e-200 in magnitude')
    if any(original[i][j] != original[j][i] for i in range(3) for j in range(3)):raise ValueError('background covariance must be exactly symmetric')
    scale = max(abs(v) for row in original for v in row)
    if scale == 0:return {'factor': [[0.]*3 for _ in range(3)], 'rank': 0, 'maximum_adjustment_cps2': 0., 'relative_adjustment': 0.}
    a = [[v/scale for v in row] for row in original];factor = [[0.]*3 for _ in range(3)];permutation = list(range(3));rank = 0;tol = 64*_EPS
    for k in range(3):
        pivot = max(range(k, 3), key=lambda i: a[i][i])
        a[k], a[pivot] = a[pivot], a[k]
        for row in a:row[k], row[pivot] = row[pivot], row[k]
        factor[k], factor[pivot] = factor[pivot], factor[k];permutation[k], permutation[pivot] = permutation[pivot], permutation[k]
        diagonal = a[k][k]
        if diagonal < -tol:raise ValueError('background covariance must be positive semidefinite')
        if diagonal <= 0:
            if any(abs(a[i][j]) > tol for i in range(k, 3) for j in range(k, 3)):raise ValueError('background covariance must be positive semidefinite')
            break
        factor[k][k] = math.sqrt(diagonal);rank += 1
        for i in range(k+1, 3):factor[i][k] = a[i][k]/factor[k][k]
        for i in range(k+1, 3):
            for j in range(i, 3):
                a[i][j] -= factor[i][k]*factor[j][k];a[j][i] = a[i][j]
    out = [[0.]*3 for _ in range(3)]
    for i in range(3):out[permutation[i]] = [v*math.sqrt(scale) for v in factor[i]]
    reconstructed = _covariance(out);adjustment = max(abs(original[i][j]-reconstructed[i][j]) for i in range(3) for j in range(3))
    if adjustment/scale > 512*_EPS:raise ValueError('covariance factorisation exceeds declared rounding tolerance')
    return {'factor': out, 'rank': rank, 'maximum_adjustment_cps2': adjustment, 'relative_adjustment': adjustment/scale}


def _inverse(matrix, limit):
    a = [list(row)+[float(i == j) for j in range(3)] for i, row in enumerate(matrix)]
    for k in range(3):
        pivot = max(range(k, 3), key=lambda i: abs(a[i][k]))
        if a[pivot][k] == 0:raise baselode.geophysics.corrections._NeedsInput('singular supplied stripping response')
        a[k], a[pivot] = a[pivot], a[k];scale = a[k][k];a[k] = [v/scale for v in a[k]]
        for i in range(3):
            if i != k:
                scale = a[i][k];a[i] = [x-scale*y for x, y in zip(a[i], a[k])]
    inverse = [row[3:] for row in a]
    if any(not math.isfinite(v) for row in inverse for v in row):raise baselode.geophysics.corrections._NeedsInput('supplied stripping response exceeds condition bound limit')
    condition = math.hypot(*(v for row in matrix for v in row))*math.hypot(*(v for row in inverse for v in row))
    if not math.isfinite(condition) or condition > limit:raise baselode.geophysics.corrections._NeedsInput('supplied stripping response exceeds condition bound limit')
    condition = max(3., condition)
    residual = max(abs(v-float(i == j)) for i, row in enumerate(_product(matrix, inverse)) for j, v in enumerate(row))
    if residual > 256*_EPS*condition:raise RuntimeError('stripping inverse residual exceeds numerical tolerance')
    return inverse, condition, residual


def _time(value):
    if type(value) is not str or not re.fullmatch('[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z', value):raise ValueError('canonical UTC acquisition/calibration seconds required')
    datetime.datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ')
    return value


def _response(calibration, height, limit):
    delta = height-calibration['nominal_effective_height_m'];matrix = [[calibration['response_matrix'][i][j]+delta*calibration['response_height_slopes_per_m'][i][j] for j in range(3)] for i in range(3)]
    if any(v < 0 or v > 10 for row in matrix for v in row):raise baselode.geophysics.corrections._NeedsInput('height-adjusted response outside nonnegative calibrated range')
    inverse, condition, residual = _inverse(matrix, limit)
    return matrix, inverse, condition, residual


def _prepare(request):
    p = baselode.geophysics.forward_common._bounded_json(request, 16777216, max_nodes=1000000)
    baselode.geophysics.forward_common._keys(p, ('schema','version','reference_id','calibration','records','processing_state','uncertainty_model','options'), ('metadata',))
    if p['schema'] != 'baselode.geophysics.raw_radiometrics_request':raise ValueError('unsupported raw radiometrics schema')
    baselode.geophysics._ensemble_common._integer(p['version'], 1, 1);baselode.geophysics.forward_common._label(p['reference_id'])
    state = p['processing_state'];baselode.geophysics.forward_common._keys(state, ('kind','applied_corrections'))
    if state['kind'] != 'raw_counts' or state['applied_corrections'] != []:raise baselode.geophysics.corrections._NeedsInput('require uncorrected raw counts with empty applied corrections')
    if p['uncertainty_model'] != 'conditional_independent_poisson_fixed_live_times_and_calibration':raise ValueError('declare the conditional independent fixed-live-time uncertainty model')
    options = p['options'];baselode.geophysics.forward_common._keys(options, ('minimum_window_counts','maximum_relative_standard_uncertainty','dead_time_warning_fraction','maximum_height_factor','maximum_response_condition'))
    baselode.geophysics._ensemble_common._integer(options['minimum_window_counts'], 1, 4096000000000)
    for key, lower, upper in [('maximum_relative_standard_uncertainty',1e-6,1e6),('dead_time_warning_fraction',0,1),('maximum_height_factor',1,100),('maximum_response_condition',3,1e8)]:baselode.geophysics.forward_common._number(options[key], lower, upper)
    c = p['calibration'];baselode.geophysics.forward_common._keys(c, ('id','version','source_id','detector_id','valid_from_utc','valid_to_utc','energy','windows','air_reference','nominal_effective_height_m','geometric_height_range_m','effective_height_range_m','response_matrix','response_height_slopes_per_m','attenuation_per_m','sensitivity_cps_per_unit','aircraft_background','cosmic_leakage'), ('metadata',))
    for key in ('id','version','source_id','detector_id'):baselode.geophysics.forward_common._label(c[key])
    start, end = _time(c['valid_from_utc']), _time(c['valid_to_utc'])
    if start > end:raise ValueError('calibration validity interval is reversed')
    energy = c['energy'];baselode.geophysics.forward_common._keys(energy, ('channels','offset_keV','gain_keV_per_channel','channel_convention'))
    channels = baselode.geophysics._ensemble_common._integer(energy['channels'], 4, 4096)
    baselode.geophysics.forward_common._number(energy['offset_keV'], 0, 10000);baselode.geophysics.forward_common._number(energy['gain_keV_per_channel'], 1e-6, 10000)
    if energy['channel_convention'] != 'zero_based_centres' or energy['offset_keV']+(channels-1)*energy['gain_keV_per_channel'] > 10000:raise ValueError('declare supported zero-based energy centres <=10000keV')
    windows = c['windows']
    if type(windows) is not list or len(windows) != 3:raise ValueError('declare three disjoint energy-calibrated windows')
    selections = [];used = set()
    for window, element in zip(windows, _ORDER):
        baselode.geophysics.forward_common._keys(window, ('element','first_channel','last_channel_exclusive'))
        if window['element'] != element:raise ValueError('window order must be K/eU/eTh')
        first = baselode.geophysics._ensemble_common._integer(window['first_channel'], 0, channels-1);last = baselode.geophysics._ensemble_common._integer(window['last_channel_exclusive'], first+1, channels)
        if used.intersection(range(first, last)):raise ValueError('counting windows must not overlap')
        used.update(range(first, last));selections.append((first,last))
    air = c['air_reference'];baselode.geophysics.forward_common._keys(air, ('pressure_Pa','temperature_K','model'))
    if air['model'] != 'ideal_dry_air_density_ratio':raise ValueError('declare ideal dry-air density-ratio model')
    baselode.geophysics.forward_common._number(air['pressure_Pa'], 50000, 120000);baselode.geophysics.forward_common._number(air['temperature_K'], 200, 330)
    for key in ('geometric_height_range_m','effective_height_range_m'):
        value = c[key]
        if type(value) is not list or len(value) != 2:raise ValueError('declare two calibrated height bounds')
        for v in value:baselode.geophysics.forward_common._number(v, 50, 250)
        if value[0] > value[1]:raise ValueError('calibrated height bounds reversed')
    baselode.geophysics.forward_common._number(c['nominal_effective_height_m'], *c['effective_height_range_m'])
    response = _matrix(c['response_matrix'], 0, 10);slopes = _matrix(c['response_height_slopes_per_m'], -.1, .1)
    if any(response[i][i] != 1 or slopes[i][i] != 0 for i in range(3)):raise ValueError('normalized response has unit diagonal and zero diagonal slopes')
    _vec(c['attenuation_per_m'], 0, .1);_vec(c['sensitivity_cps_per_unit'], 1e-6, 1e6);_vec(c['cosmic_leakage'], 0, 100)
    aircraft = c['aircraft_background'];baselode.geophysics.forward_common._keys(aircraft, ('window_rates_cps','covariance_cps2'))
    _vec(aircraft['window_rates_cps'], 0, 1e6);aircraft_factor = _psd(aircraft['covariance_cps2'])
    for height in c['effective_height_range_m']+[c['nominal_effective_height_m']]:_response(c, height, options['maximum_response_condition'])
    records = p['records']
    if type(records) is not list or not 1 <= len(records) <= 128:raise ValueError('one to128 raw records required')
    plans = [];seen = set()
    for record in records:
        baselode.geophysics.forward_common._keys(record, ('id','detector_id','calibration_id','acquired_at_utc','spectrum_counts','live_time_s','real_time_s','height_agl_m','pressure_Pa','temperature_K','cosmic_monitor','radon_background'), ('metadata',))
        for key in ('id','detector_id','calibration_id'):baselode.geophysics.forward_common._label(record[key])
        if record['id'] in seen:raise ValueError('duplicate radiometric record ID')
        seen.add(record['id']);acquired = _time(record['acquired_at_utc'])
        if record['detector_id'] != c['detector_id'] or record['calibration_id'] != c['id'] or not start <= acquired <= end:raise baselode.geophysics.corrections._NeedsInput('detector/calibration identity or acquisition validity mismatch')
        counts = record['spectrum_counts']
        if type(counts) is not list or len(counts) != channels:raise ValueError('full raw spectrum must match calibrated channel count')
        for count in counts:baselode.geophysics._ensemble_common._integer(count, 0, 1000000000)
        for key in ('live_time_s','real_time_s'):baselode.geophysics.forward_common._number(record[key], .001, 3600)
        if record['live_time_s'] > record['real_time_s']:raise ValueError('live time cannot exceed accumulation time')
        baselode.geophysics.forward_common._number(record['height_agl_m'], 50, 250);baselode.geophysics.forward_common._number(record['pressure_Pa'], 50000, 120000);baselode.geophysics.forward_common._number(record['temperature_K'], 200, 330)
        height = record['height_agl_m']*(record['pressure_Pa']/air['pressure_Pa'])*(air['temperature_K']/record['temperature_K'])
        if not c['geometric_height_range_m'][0] <= record['height_agl_m'] <= c['geometric_height_range_m'][1] or not c['effective_height_range_m'][0] <= height <= c['effective_height_range_m'][1]:raise baselode.geophysics.corrections._NeedsInput('record outside calibrated geometric/effective height domain')
        matrix, inverse, condition, residual = _response(c, height, options['maximum_response_condition']);factors = [math.exp(mu*(height-c['nominal_effective_height_m'])) for mu in c['attenuation_per_m']]
        if any(max(f, 1/f) > options['maximum_height_factor'] for f in factors):raise baselode.geophysics.corrections._NeedsInput('height normalisation exceeds supplied amplification limit')
        monitor = record['cosmic_monitor'];baselode.geophysics.forward_common._keys(monitor, ('counts','live_time_s','real_time_s','independent_of_spectrum'))
        baselode.geophysics._ensemble_common._integer(monitor['counts'], 0, 1000000000)
        for key in ('live_time_s','real_time_s'):baselode.geophysics.forward_common._number(monitor[key], .001, 3600)
        if monitor['independent_of_spectrum'] is not True:raise baselode.geophysics.corrections._NeedsInput('cosmic monitor must be statistically independent of main spectrum')
        if monitor['live_time_s'] > monitor['real_time_s'] or monitor['real_time_s'] != record['real_time_s']:raise ValueError('declare aligned valid main/cosmic accumulation intervals')
        radon = record['radon_background'];baselode.geophysics.forward_common._keys(radon, ('estimate_id','window_rates_cps','covariance_cps2','independent_of_main_and_cosmic'))
        baselode.geophysics.forward_common._label(radon['estimate_id']);_vec(radon['window_rates_cps'], -1e6, 1e6)
        if radon['independent_of_main_and_cosmic'] is not True:raise baselode.geophysics.corrections._NeedsInput('radon estimate must be independent of main/cosmic counting noise')
        radon_factor = _psd(radon['covariance_cps2'])
        plans.append({'effective_height_m':height,'response_matrix':matrix,'inverse_response':inverse,'response_condition_bound':condition,'inverse_residual':residual,'height_factors':factors,'radon_factor':radon_factor})
    baselode.geophysics._ensemble_common._metadata(p, 131072)
    return p, selections, aircraft_factor, plans


def _report(phase):
    return {'schema':'baselode.geophysics.raw_radiometrics_'+phase,'version':1,'state':'ok','issues':[],'request':None,'records':[],'correction_recipe':[],'processing_state':None,'diagnostics':{},'producer':baselode.geophysics.corrections._producer()}


def _error(report, error):
    context = isinstance(error, baselode.geophysics.corrections._NeedsInput);resource = isinstance(error, baselode.geophysics.corrections._ResourceError)
    numerical = isinstance(error, (ArithmeticError, RuntimeError)) and not resource
    report.update(state='needs_input' if context else 'failed' if numerical else 'rejected',issues=[{'code':'context' if context else 'resource' if resource else 'numerical' if numerical else 'contract','message':str(error)}],request=None,records=[],correction_recipe=[],processing_state=None,diagnostics={})


def describe_raw_radiometrics():
    """Return copied raw-count calibration, uncertainty and resource contracts.

    Returns
    -------
    dict
        Shared request/result schemas, ordered corrections and scientific limits.
    """
    return copy.deepcopy(_DESCRIPTOR)


def validate_raw_radiometrics(request):
    """Preflight all acquisition, calibration, height and covariance inputs.

    Parameters
    ----------
    request : dict
        V1 raw_radiometrics_request, explicit raw state, full spectra, independent
        background estimates and supplied detector/energy/response calibration.

    Returns
    -------
    dict
        Atomic copied request and dimensions, or needs_input/rejected/failed.
        Tiny matrix factorisations check PSD and conditioning before processing.
    """
    report = _report('validation')
    try:
        p, windows, _, _ = _prepare(request);report.update(request=p,diagnostics={'records':len(p['records']),'channels':p['calibration']['energy']['channels'],'window_channels':[b-a for a,b in windows]})
        baselode.geophysics.forward_common._bounded_json(report, 33554432, result=True, max_nodes=2000000)
    except (ValueError,TypeError,RecursionError,ArithmeticError,RuntimeError) as error:_error(report,error)
    return report


def _record(record, p, windows, aircraft_factor, plan):
    c = p['calibration'];live = record['live_time_s'];monitor = record['cosmic_monitor'];counts = [sum(int(v) for v in record['spectrum_counts'][a:b]) for a,b in windows]
    rates = [v/live for v in counts];cosmic_rate = monitor['counts']/monitor['live_time_s'];cosmic = [b*cosmic_rate for b in c['cosmic_leakage']];aircraft = c['aircraft_background']['window_rates_cps'];radon = record['radon_background']['window_rates_cps']
    net = [_sum([rates[i],-aircraft[i],-cosmic[i],-radon[i]]) for i in range(3)]
    factor = [[(math.sqrt(counts[i])/live if i == j else 0.) for j in range(3)]+[c['cosmic_leakage'][i]*math.sqrt(monitor['counts'])/monitor['live_time_s']]+aircraft_factor['factor'][i]+plan['radon_factor']['factor'][i] for i in range(3)]
    stripped = [_dot(row, net) for row in plan['inverse_response']];stripped_factor = _product(plan['inverse_response'],factor)
    height_rates = [stripped[i]*plan['height_factors'][i] for i in range(3)];transform = [[v*plan['height_factors'][i]/c['sensitivity_cps_per_unit'][i] for v in row] for i,row in enumerate(plan['inverse_response'])]
    values = [height_rates[i]/c['sensitivity_cps_per_unit'][i] for i in range(3)];out_factor = _product(transform,factor);covariance = _covariance(out_factor);standard = [math.sqrt(covariance[i][i]) for i in range(3)]
    dead = 1-live/record['real_time_s'];cosmic_dead = 1-monitor['live_time_s']/monitor['real_time_s'];flags = []
    if dead > p['options']['dead_time_warning_fraction']:flags.append('high_dead_time')
    if cosmic_dead > p['options']['dead_time_warning_fraction']:flags.append('high_cosmic_dead_time')
    if any(v < 0 for v in radon):flags.append('negative_radon_estimate')
    if max(aircraft_factor['relative_adjustment'],plan['radon_factor']['relative_adjustment']) > 8*_EPS:flags.append('covariance_rounding_adjustment')
    channels = []
    for i,element in enumerate(_ORDER):
        quality = [];relative = standard[i]/abs(values[i]) if values[i] != 0 else None
        if relative is not None and (not math.isfinite(relative) or relative > 1e100):relative = None;quality.append('relative_uncertainty_outside_portable_range')
        if counts[i] < p['options']['minimum_window_counts']:quality.append('low_counts')
        if counts[i] == 0:quality.append('zero_count_poisson_plugin_variance')
        for stage,value in [('background_corrected_rate',net[i]),('stripped_rate',stripped[i]),('concentration',values[i])]:
            if value < 0:quality.append('negative_'+stage)
        if values[i] == 0:quality.append('zero_concentration_relative_uncertainty_undefined')
        elif relative is not None and relative > p['options']['maximum_relative_standard_uncertainty']:quality.append('high_relative_standard_uncertainty')
        channels.append({'element':element,'units':_UNITS[i],'value':values[i],'standard_uncertainty':standard[i],'relative_standard_uncertainty':relative,'flags':quality})
    return {'id':record['id'],'calibration_id':c['id'],'detector_id':c['detector_id'],'acquired_at_utc':record['acquired_at_utc'],'channels':channels,'flags':flags,'dead_time_fraction':dead,'cosmic_dead_time_fraction':cosmic_dead,'window_counts':counts,'observed_rates_cps':[v/record['real_time_s'] for v in counts],'live_rates_cps':rates,'aircraft_background_cps':copy.deepcopy(aircraft),'cosmic_monitor_rate_cps':cosmic_rate,'cosmic_background_cps':cosmic,'radon_background_cps':copy.deepcopy(radon),'background_corrected_rates_cps':net,'stripped_rates_cps':stripped,'nominal_height_rates_cps':height_rates,'effective_height_m':plan['effective_height_m'],'height_factors':plan['height_factors'],'response_matrix':plan['response_matrix'],'inverse_response':plan['inverse_response'],'response_condition_bound':plan['response_condition_bound'],'inverse_residual':plan['inverse_residual'],'concentration_transform':transform,'count_rate_covariance_cps2':_covariance(factor),'stripped_covariance_cps2':_covariance(stripped_factor),'concentration_covariance':{'order':list(_ORDER),'units':list(_UNITS),'values':covariance},'covariance_factorisation':{'aircraft':{k:v for k,v in aircraft_factor.items() if k!='factor'},'radon':{k:v for k,v in plan['radon_factor'].items() if k!='factor'}},'metadata':copy.deepcopy(record.get('metadata',{}))}


def process_raw_radiometrics(request):
    """Process supplied-calibration airborne counts with conditional covariance.

    Parameters
    ----------
    request : dict
        Same complete v1 contract as validate_raw_radiometrics. Supplied windows
        use inclusive-first/exclusive-last integer channels and zero-based energy
        centres. All records are preflighted before any corrected output is kept.

    Returns
    -------
    dict
        Atomic K(%), eU/eTh(ppm) values, full per-record covariance and stage
        diagnostics/flags, raw request and ordered versioned correction recipe.
        Counts/live and independent Poisson plug-in/background covariance assume
        fixed calibration, exposure and heights; cross-record covariance and
        calibration uncertainty are excluded. Negative values remain visible.
        Equivalent U/Th do not establish elemental equilibrium or deep geology.
    """
    report = _report('result')
    try:
        p, windows, aircraft_factor, plans = _prepare(request)
        records = [_record(record,p,windows,aircraft_factor,plan) for record,plan in zip(p['records'],plans)]
        energy = p['calibration']['energy'];edges = [[energy['offset_keV']+(a-.5)*energy['gain_keV_per_channel'],energy['offset_keV']+(b-.5)*energy['gain_keV_per_channel']] for a,b in windows]
        report.update(request=p,records=records,correction_recipe=[{'operation':step,'version':1} for step in _STEPS],processing_state={'kind':'corrected_concentrations','applied_corrections':list(_STEPS),'calibration_id':p['calibration']['id'],'calibration_version':p['calibration']['version']},diagnostics={'records':len(records),'channels':energy['channels'],'window_channel_ranges':[list(v) for v in windows],'window_energy_edges_keV':edges,'uncertainty_model':p['uncertainty_model'],'calibration_uncertainty_propagated':False,'height_and_exposure_uncertainty_propagated':False,'cross_record_covariance_modelled':False,'equivalent_radioelements':True,'confidence_intervals':False,'source_geometry':'calibrated_flat_infinite_source_exponential_height_model'})
        baselode.geophysics.forward_common._bounded_json(report, 33554432, result=True, max_nodes=2000000)
    except (ValueError,TypeError,RecursionError,ArithmeticError,RuntimeError) as error:_error(report,error)
    return report
