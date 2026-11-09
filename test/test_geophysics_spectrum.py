# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent Fourier/Parseval references, directions and typed workflow reports."""
import cmath
import copy
import json
import math
import pathlib
import subprocess

import jsonschema
import numpy as np
import pytest

import baselode.geophysics
import baselode.geophysics.spectrum

ROOT = pathlib.Path(__file__).resolve().parents[1]


def options():
    return {'band': 1, 'detrend': 'mean', 'window': 'boxcar', 'radial_bins': 16, 'direction_bins': 12, 'missing_policy': 'reject'}


def grid(rows=32, columns=32):
    row, col = np.indices((rows, columns))
    return baselode.geophysics.GeophysicsRaster(10 + 2 * np.cos(2 * np.pi * col / 8) + 3 * np.cos(2 * np.pi * row / 16),
        transform=[1, 0, 500000, 0, -1, 6500000], crs='EPSG:32750', metadata={'field_type': 'magnetic_anomaly', 'units': ['nT'], 'crs_units': 'm', 'uncertainty': {'sigma': 1}, 'source': 'analytic.ers'})


def test_known_wavelengths_amplitudes_directions_and_dc_are_accounted_once():
    g = grid(); before = copy.deepcopy(g.metadata); values = g.data.copy()
    r = baselode.geophysics.analyze_grid_spectrum(g, options()); assert r['state'] == 'ok', r['issues']
    assert r['diagnostics']['spectral_total_power'] == pytest.approx(6.5, abs=1e-12)
    assert r['diagnostics']['parseval_absolute_error'] < 1e-12
    assert r['radial'][2]['power_sum'] == pytest.approx(4.5, abs=1e-12)
    assert r['radial'][4]['power_sum'] == pytest.approx(2, abs=1e-12)
    assert r['directional'][0]['power_sum'] == pytest.approx(4.5, abs=1e-12)
    assert r['directional'][6]['power_sum'] == pytest.approx(2, abs=1e-12)
    assert r['units'] == {'source': 'nT', 'power': '(nT)^2', 'density': '(nT)^2*m^2', 'frequency': '1/m', 'wavelength': 'm'}
    assert r['metadata']['input_lineage'][-1]['metadata']['uncertainty'] == {'sigma': 1}
    assert r['metadata']['uncertainty_propagated'] is False
    d = baselode.geophysics.analyze_grid_spectrum(g, {**options(), 'detrend': 'none'})['diagnostics']
    assert d['dc_power'] == pytest.approx(100, abs=1e-12) and d['spectral_total_power'] == pytest.approx(106.5, abs=1e-12)
    assert g.metadata == before; np.testing.assert_array_equal(g.data, values)
    assert json.loads(json.dumps(r)) == r


@pytest.mark.parametrize('window', ['boxcar', 'hann_periodic'])
@pytest.mark.parametrize('shape', [(8, 8), (8, 10)])
def test_independent_direct_dft_parseval_and_density_normalisation(window, shape):
    g = grid(*shape); p = {**options(), 'window': window}; actual = baselode.geophysics.analyze_grid_spectrum(g, p)
    assert actual['state'] == 'ok', actual['issues']
    values = g.data[0]; mean = sum(float(v) for v in values.flat) / values.size
    weighted = []
    weights = []
    for i in range(shape[0]):
        for j in range(shape[1]):
            w = 1 if window == 'boxcar' else (.5 - .5 * math.cos(2 * math.pi * i / shape[0])) * (.5 - .5 * math.cos(2 * math.pi * j / shape[1]))
            weighted.append((i, j, (float(values[i, j]) - mean) * w)); weights.append(w)
    rows, cols = actual['diagnostics']['fft_shape']; energy = sum(w * w for w in weights)
    direct = [abs(sum(v * cmath.exp(-2j * math.pi * (ki * i / rows + kj * j / cols)) for i, j, v in weighted)) ** 2 / (rows * cols * energy) for ki in range(rows) for kj in range(cols)]
    assert actual['diagnostics']['spectral_total_power'] == pytest.approx(sum(direct), rel=1e-12)
    assert actual['diagnostics']['windowed_mean_square'] == pytest.approx(sum(v * v for _, _, v in weighted) / energy, rel=1e-12)
    assert actual['diagnostics']['frequency_cell_area'] == 1 / (rows * cols)
    for bins in (actual['radial'], actual['directional']):
        assert sum(b['power_sum'] for b in bins) == pytest.approx(actual['diagnostics']['included_power'])
        for b in bins:
            assert b['mean_power_density'] == (pytest.approx(b['power_sum'] / b['count'] * rows * cols) if b['count'] else None)


@pytest.mark.parametrize('case', ['constant', 'plane', 'nyquist', 'corners', 'rotated', 'km', 'anisotropic', 'selected_band'])
def test_detrend_sampling_support_rotation_units_and_band_selection(case):
    g = grid(); p = options(); row, col = np.indices((32, 32))
    if case == 'constant': g.data[:] = 7
    if case == 'plane': g.data[:] = 7 + .1 * row + .2 * col; p['detrend'] = 'plane'
    if case == 'nyquist': g.data[:] = (-1.) ** col
    if case == 'corners': g.data[:] = (-1.) ** (row + col)
    if case == 'rotated':
        g.data[:] = 2 * np.cos(2 * np.pi * col / 8); angle = math.pi / 6
        g.transform = (math.cos(angle), math.sin(angle), 0, math.sin(angle), -math.cos(angle), 0)
    if case == 'km': g.crs = None; g.metadata.update(crs_units='km', frame_id='local'); g.transform = (.001, 0, 0, 0, -.001, 0)
    if case == 'anisotropic': g.transform = (2, 0, 0, 0, -1, 0)
    if case == 'selected_band': g = g.copy_with(np.concatenate([np.full(g.data.shape, np.nan), g.data]), band_names=['missing', 'selected'], metadata={**g.metadata, 'units': ['ppm', 'nT']}); p['band'] = 2
    r = baselode.geophysics.analyze_grid_spectrum(g, p); assert r['state'] == 'ok', r['issues']; d = r['diagnostics']
    if case in ('constant', 'plane'): assert d['below_numerical_floor'] and d['spectral_total_power'] < 1e-24
    if case == 'nyquist': assert d['included_power'] == pytest.approx(1) and r['directional'][6]['power_sum'] == pytest.approx(1)
    if case == 'corners': assert d['outside_circle_power'] == pytest.approx(1) and d['included_power'] < 1e-24
    if case == 'rotated': assert r['directional'][4]['power_sum'] == pytest.approx(2)
    if case == 'km': assert d['spectral_total_power'] == pytest.approx(6.5); assert d['radial_frequency_limit'] == 500 and r['units']['frequency'] == '1/km'
    if case == 'anisotropic': assert d['radial_frequency_limit'] == .25 and d['frequency_cell_area'] == 1 / 2048
    if case == 'selected_band': assert d['spectral_total_power'] == pytest.approx(6.5) and r['source']['band'] == 2


@pytest.mark.parametrize('change', ['none', 'complex', 'missing', 'sentinel', 'geographic', 'shear', 'transform', 'frame', 'units', 'field', 'unicode', 'history', 'metadata_cap', 'source_cap', 'small', 'unit_conflict'])
def test_source_guard_states_precede_fft(change, monkeypatch):
    g = grid()
    if change == 'none': g = None
    if change == 'complex': g.data = g.data.astype(complex)
    if change == 'missing': g.data[0, 0, 0] = np.nan
    if change == 'sentinel': g.nodata = -999; g.data[0, 0, 0] = -999
    if change == 'geographic': g.crs = 'EPSG:4326'
    if change == 'shear': g.transform = (1, .2, 0, 0, -1, 0)
    if change == 'transform': g.transform = None
    if change == 'frame': g.crs = None
    if change == 'units': del g.metadata['units']
    if change == 'field': g.metadata['field_type'] = 'unknown'
    if change == 'unicode': g.metadata['extension'] = '\ud800'
    if change == 'history': g.metadata['processing'] = None
    if change == 'metadata_cap': g.metadata['extension'] = 'x' * 524288
    if change == 'source_cap': g = g.copy_with(np.ones((513, 512)))
    if change == 'small': g = g.copy_with(np.ones((7, 8)))
    if change == 'unit_conflict': g.metadata['crs_units'] = 'km'
    def forbidden(*args, **kwargs): pytest.fail('invalid input must not execute FFT')
    monkeypatch.setattr(np.fft, 'fft2', forbidden)
    r = baselode.geophysics.analyze_grid_spectrum(g, options())
    assert r['state'] in ('needs_input', 'rejected') and r['radial'] == [] and r['directional'] == [] and 'metadata' not in r


@pytest.mark.parametrize('key,value', [('band', True), ('band', 2), ('band', 0), ('band', 10 ** 400), ('detrend', 'auto'), ('window', 'hann'), ('radial_bins', 129), ('direction_bins', 3), ('radial_bins', float('nan')), ('missing_policy', 'fill'), ('extra', True)])
def test_parameter_guards_and_required_contract(key, value):
    p = options(); p[key] = value
    r = baselode.geophysics.analyze_grid_spectrum(grid(), p); assert r['state'] == 'rejected' and r['radial'] == []
    p = options(); del p['window']; assert baselode.geophysics.analyze_grid_spectrum(grid(), p)['state'] == 'needs_input'


def observation_fixture():
    records = [{'id': str(i * 8 + j), 'x': 500000 + .5 + j, 'y': 6500008 - .5 - i, 'values': {'mag': 10 + 2 * math.cos(2 * math.pi * j / 4) + 3 * math.cos(2 * math.pi * i / 8)}} for i in range(8) for j in range(8)]
    survey = {'records': records, 'channels': {'mag': {'field_type': 'magnetic_anomaly', 'units': 'nT'}}, 'crs': 'EPSG:32750', 'crs_units': 'm'}
    workflow = {'schema': 'baselode.geophysics.observation_workflow', 'version': 1, 'steps': [
        {'id': 'grid', 'operation': 'grid_observations', 'version': 1, 'inputs': [{'input': 'survey'}], 'parameters': {'channels': ['mag'], 'radius': .1, 'duplicate_policy': 'mean', 'elevation_policy': 'ignore', 'bounds': [500000, 6500000, 500008, 6500008], 'shape': [8, 8]}},
        {'id': 'spectrum', 'operation': 'analyze_grid_spectrum', 'version': 1, 'inputs': [{'step': 'grid', 'output': 'grid'}], 'parameters': options()}], 'outputs': {'spectrum': {'step': 'spectrum', 'output': 'report'}}}
    return survey, workflow


def test_discoverability_workflow_ports_atomic_failure_and_independent_contracts():
    descriptor = baselode.geophysics.describe_spectrum()
    assert descriptor == json.loads((ROOT / 'javascript/packages/baselode/src/data/geophysics_spectrum.json').read_text())
    jsonschema.validate(options(), descriptor['parameters']); descriptor['parameters']['required'].clear(); assert baselode.geophysics.describe_spectrum()['parameters']['required']
    survey, workflow = observation_fixture(); before = copy.deepcopy(survey)
    jsonschema.validate(workflow, baselode.geophysics.describe_observation_workflow()['workflow_schema'])
    result = baselode.geophysics.run_observation_workflow(workflow, {'survey': survey}); assert result['state'] == 'ok', result['issues']
    assert result['artifacts']['spectrum']['diagnostics']['spectral_total_power'] == pytest.approx(6.5)
    assert survey == before
    survey['records'].pop(); failed = baselode.geophysics.run_observation_workflow(workflow, {'survey': survey})
    assert failed['state'] == 'needs_input' and failed['artifacts'] == {} and failed['completed_steps'] == ['grid']


def test_live_python_javascript_native_and_saved_workflow_report_parity(tmp_path):
    survey, workflow = observation_fixture(); g = grid(8, 10); p = {**options(), 'window': 'hann_periodic'}
    source = tmp_path / 'in.json'; target = tmp_path / 'out.json'
    source.write_text(json.dumps({'raster': g.to_payload(), 'options': p, 'survey': survey, 'workflow': workflow}))
    subprocess.run(['node', str(ROOT / 'test/data/spectrum_parity.mjs'), str(source), str(target)], cwd=ROOT / 'javascript/packages/baselode', check=True, capture_output=True, text=True)
    js = json.loads(target.read_text()); py = baselode.geophysics.analyze_grid_spectrum(g, p)
    assert js['spectrum']['state'] == 'ok' and js['workflow']['state'] == 'ok', js
    for key in ('radial', 'directional'):
        for a, b in zip(js['spectrum'][key], py[key]):
            assert a['count'] == b['count']; assert a['power_sum'] == pytest.approx(b['power_sum'], abs=1e-10)
            assert a['mean_power_density'] == (pytest.approx(b['mean_power_density'], abs=1e-9) if b['count'] else None)
    assert js['spectrum']['units'] == py['units'] and js['spectrum']['parameters'] == py['parameters']
    assert js['workflow']['artifacts']['spectrum']['diagnostics']['spectral_total_power'] == pytest.approx(6.5)


def test_fft_backend_failure_is_atomic_and_not_a_parameter_rejection(monkeypatch):
    def broken(*args, **kwargs): raise RuntimeError('injected FFT failure')
    monkeypatch.setattr(np.fft, 'fft2', broken)
    result = baselode.geophysics.analyze_grid_spectrum(grid(), options())
    assert result['state'] == 'failed' and result['radial'] == [] and result['directional'] == [] and 'metadata' not in result


def test_parameters_models_lineage_and_source_are_independent():
    p = options(); g = grid(); a = baselode.geophysics.analyze_grid_spectrum(g, p); b = baselode.geophysics.analyze_grid_spectrum(g, p)
    a['parameters']['band'] = 2; a['metadata']['input_lineage'][-1]['metadata']['uncertainty']['sigma'] = 99
    assert p == options() and b['parameters'] == p and g.metadata['uncertainty'] == {'sigma': 1}


def test_energy_below_numerical_floor_is_retained_and_all_frequency_power_accounted():
    g = grid(); _, col = np.indices((32, 32)); g.data[:] = 1e-15 * np.cos(2 * np.pi * col / 8)
    r = baselode.geophysics.analyze_grid_spectrum(g, options()); d = r['diagnostics']
    assert r['state'] == 'ok' and d['below_numerical_floor']
    assert d['spectral_total_power'] == pytest.approx(5e-31, rel=1e-12, abs=0)
    assert d['dc_power'] + d['included_power'] + d['outside_circle_power'] == pytest.approx(d['spectral_total_power'], rel=1e-12, abs=0)
    assert 1 + d['included_count'] + d['outside_circle_count'] == 32 * 32


def test_json_integral_numbers_normalise_to_integer_indices_without_mutation():
    p = {**options(), 'band': 1.0, 'radial_bins': 16.0, 'direction_bins': 12.0}; before = copy.deepcopy(p)
    result = baselode.geophysics.analyze_grid_spectrum(grid(), p)
    assert result['state'] == 'ok', result['issues']
    assert all(type(result['parameters'][key]) is int for key in ('band', 'radial_bins', 'direction_bins'))
    assert p == before and type(p['band']) is float
