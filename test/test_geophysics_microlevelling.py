# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent analytic signal recovery, protection, guards and native replay."""
import copy
import json
import math
import pathlib
import subprocess

import jsonschema
import numpy as np
import pytest

import baselode.geophysics
import baselode.geophysics.microlevelling
import baselode.geophysics.provenance

ROOT = pathlib.Path(__file__).resolve().parents[1]


def options():
    return {'flight_azimuth': 0, 'line_spacing': 4, 'along_line_wavelength': 64,
            'across_line_wavelength': 16, 'max_abs_correction': 5, 'protected_bounds': [],
            'edge_margin_cells': 8, 'min_training_fraction': .5, 'reference_policy': 'caller_verified',
            'evidence': 'Analytic levelled anomaly, verified geometry and four-metre flight spacing',
            'geology_policy': 'directional_overlap_acknowledged'}


def signals():
    row, col = np.indices((128, 128))
    return (np.cos(2 * np.pi * (col + .5) / 8), np.cos(2 * np.pi * (col + .5) / 128),
            np.cos(2 * np.pi * (row + .5) / 16), np.ones(row.shape), row, col)


def grid():
    components = signals()
    values = sum(value * amplitude for value, amplitude in zip(components, [1, 10, 5, 100, .02, .03]))
    return baselode.geophysics.GeophysicsRaster(values, transform=[1, 0, 0, 0, -1, 128], crs='EPSG:32750',
        metadata={'field_type': 'magnetic_anomaly', 'units': ['nT'], 'crs_units': 'm',
                  'grid_corrections': {'magnetic_levelling': 'applied', 'magnetic_microlevelling': 'unapplied'},
                  'source': 'analytic.ers', 'uncertainty': {'sigma': 1, 'model': 'source-only'}})


def workflow(params=None):
    return {'schema': 'baselode.geophysics.workflow', 'version': 1,
            'steps': [{'id': name, 'operation': operation, 'version': 1, 'inputs': ['magnetic'], 'parameters': copy.deepcopy(options() if params is None else params)}
                      for name, operation in [('noise', 'estimate_magnetic_microlevelling'), ('corrected', 'microlevel_magnetic_grid')]],
            'outputs': ['noise', 'corrected']}


def test_independent_analytic_stripes_geology_and_plane_recovery():
    source = grid(); before = copy.deepcopy(source.metadata); values = source.data.copy()
    estimate = baselode.geophysics.estimate_magnetic_microlevelling(source, options())
    product = baselode.geophysics.microlevel_magnetic_grid(source, options())
    interior = np.s_[16:-16, 16:-16]
    basis = np.column_stack([v[interior].ravel() for v in signals()])
    fitted = np.linalg.lstsq(basis, product.data[0][interior].ravel(), rcond=None)[0]
    # Known cosine eigenfunctions of symmetric mirror padding. These are
    # amplitudes of independent geological/noise bases, not fitted RMS claims.
    np.testing.assert_allclose(fitted, [.0625, 9.892280131939755, 5, 100, .02, .03], rtol=0, atol=2e-10)
    expected = sum(v * amplitude for v, amplitude in zip(signals(), [.0625, 9.892280131939755, 5, 100, .02, .03]))
    assert np.sqrt(np.mean((product.data[0][interior] - expected[interior]) ** 2)) < 1e-10
    np.testing.assert_allclose(product.data, source.data - estimate.data, atol=2e-14, rtol=0)
    np.testing.assert_array_equal(product.data[:, :8], source.data[:, :8])
    np.testing.assert_array_equal(product.data[:, :, -8:], source.data[:, :, -8:])
    assert estimate.metadata['field_type'] == 'other' and product.metadata['field_type'] == 'magnetic_anomaly'
    assert product.metadata['grid_corrections']['magnetic_microlevelling'] == 'applied'
    assert 'uncertainty' not in product.metadata and product.metadata['uncertainty_propagated'] is False
    assert product.metadata['input_lineage'][-1]['metadata']['uncertainty'] == source.metadata['uncertainty']
    assert source.metadata == before; np.testing.assert_array_equal(source.data, values)
    with pytest.raises(ValueError): baselode.geophysics.microlevel_magnetic_grid(product, options())


def test_protected_geological_feature_never_enters_estimation_and_caps_never_clip():
    background = grid(); feature = grid(); feature.data[0, :, 48:80] += 200
    p = {**options(), 'protected_bounds': [[48, 0, 80, 128]]}
    a = baselode.geophysics.estimate_magnetic_microlevelling(background, p)
    b = baselode.geophysics.estimate_magnetic_microlevelling(feature, p)
    np.testing.assert_array_equal(a.data, b.data)
    product = baselode.geophysics.microlevel_magnetic_grid(feature, p)
    np.testing.assert_array_equal(product.data[0, :, 48:80], feature.data[0, :, 48:80])
    unprotected = baselode.geophysics.estimate_magnetic_microlevelling(feature, options())
    assert unprotected.metadata['microlevelling']['diagnostics']['application_supported'] is False
    assert unprotected.metadata['microlevelling']['diagnostics']['max_abs_correction'] > 5
    with pytest.raises(ValueError, match='exceeds max_abs_correction'):
        baselode.geophysics.microlevel_magnetic_grid(feature, options())
    report = baselode.geophysics.run_workflow(workflow(), {'magnetic': feature})
    assert report['state'] == 'failed' and report['artifacts'] == {}


@pytest.mark.parametrize('kind', ['constant', 'plane', 'gaps', 'sentinel'])
def test_planes_gaps_and_native_nodata_are_preserved(kind):
    source = grid()
    if kind == 'constant': source.data[:] = 10
    if kind == 'plane': source.data[:] = 100 + .02 * signals()[-2] + .03 * signals()[-1]
    if kind == 'gaps': source.data[0, 32:36, 20:23] = np.nan
    if kind == 'sentinel': source.nodata = -999; source.data[0, 32:36, 20:23] = -999
    product = baselode.geophysics.microlevel_magnetic_grid(source, options())
    if kind in ('constant', 'plane'): np.testing.assert_array_equal(product.data, source.data)
    else:
        assert np.isnan(product.data[0, 32:36, 20:23]).all()
        assert np.isfinite(product.data[0, 50, 50])


@pytest.mark.parametrize('geometry', ['rotated', 'km'])
def test_map_direction_rotation_and_linear_unit_scaling(geometry):
    source = grid(); p = options()
    if geometry == 'rotated':
        angle = np.pi / 6; source.transform = (math.cos(angle), math.sin(angle), 0, math.sin(angle), -math.cos(angle), 128); p['flight_azimuth'] = 330
    else:
        source.crs = None; source.metadata.update(frame_id='local', crs_units='km'); source.transform = (.001, 0, 0, 0, -.001, .128)
        for key in ('line_spacing', 'along_line_wavelength', 'across_line_wavelength'): p[key] *= .001
    a = baselode.geophysics.estimate_magnetic_microlevelling(source, p)
    b = baselode.geophysics.estimate_magnetic_microlevelling(grid(), options())
    np.testing.assert_allclose(a.data, b.data, rtol=0, atol=1e-11)


@pytest.mark.parametrize('change', ['field', 'units', 'geographic', 'shear', 'missing_transform', 'frame_object', 'unknown_crs', 'unknown_frame', 'unicode', 'levelling', 'microlevelled', 'unknown_state', 'archived_state', 'history', 'all_missing', 'small', 'source_cap', 'fft_cap', 'big_values'])
def test_input_guards_before_any_fft(change, monkeypatch):
    source = grid(); p = options()
    if change == 'field': source.metadata['field_type'] = 'magnetic_total_field'
    if change == 'units': source.metadata['units'] = ['T']
    if change == 'geographic': source.crs = 'EPSG:4326'
    if change == 'shear': source.transform = (1, .2, 0, 0, -1, 128)
    if change == 'missing_transform': source.transform = None
    if change == 'frame_object': source.metadata['frame_id'] = {'id': 'local'}
    if change == 'unknown_crs': source.crs = 'unknown'
    if change == 'unknown_frame': source.crs = None; source.metadata['frame_id'] = 'unknown'
    if change == 'unicode': source.metadata['extension'] = '\ud800'
    if change == 'levelling': source.metadata['grid_corrections']['magnetic_levelling'] = 'unapplied'
    if change == 'microlevelled': source.metadata['grid_corrections']['magnetic_microlevelling'] = 'applied'
    if change == 'unknown_state': source.metadata['grid_corrections']['magnetic_microlevelling'] = 'unknown'
    if change == 'archived_state': source.metadata['observation_metadata'] = {'grid_corrections': source.metadata.pop('grid_corrections')}
    if change == 'history': source.metadata['processing'] = [{'operation': 'microlevel_magnetic_grid'}]
    if change == 'all_missing': source.data[:] = np.nan
    if change == 'small': source = source.copy_with(np.ones((15, 128)))
    if change == 'source_cap': source = source.copy_with(np.ones((513, 512)))
    if change == 'fft_cap': source = source.copy_with(np.ones((342, 766))); p.update(flight_azimuth=45, along_line_wavelength=780)
    if change == 'big_values': source.data[0, 0, 0] = 1e101
    def forbidden(*args, **kwargs): pytest.fail('guard must run before FFT')
    monkeypatch.setattr(baselode.geophysics.processing, '_fourier_bands', forbidden)
    with pytest.raises(ValueError): baselode.geophysics.estimate_magnetic_microlevelling(source, p)
    report = baselode.geophysics.run_workflow(workflow(p), {'magnetic': source})
    assert report['state'] in ('rejected', 'needs_input') and report['completed_steps'] == [] and report['artifacts'] == {}


@pytest.mark.parametrize('key,value', [('flight_azimuth', True), ('flight_azimuth', -1), ('line_spacing', 0), ('line_spacing', 1), ('along_line_wavelength', 20), ('along_line_wavelength', 1000), ('across_line_wavelength', 7), ('max_abs_correction', 0), ('max_abs_correction', float('nan')), ('protected_bounds', None), ('protected_bounds', [[0, 0, 1]]), ('protected_bounds', [[1, 0, 0, 1]]), ('protected_bounds', [[1000, 0, 2000, 128]]), ('protected_bounds', [[0, 0, 128, 128]]), ('protected_bounds', [[0, 0, 1, 1]] * 17), ('edge_margin_cells', 0), ('edge_margin_cells', 64), ('edge_margin_cells', 1.5), ('min_training_fraction', .2), ('min_training_fraction', 2), ('reference_policy', 'automatic'), ('geology_policy', 'ignored'), ('evidence', ''), ('evidence', '\x85\ufeff'), ('evidence', '\ud800'), ('evidence', '😀' * 4097)])
def test_parameter_guards_and_workflow_classification(key, value):
    p = options(); p[key] = value
    with pytest.raises(ValueError): baselode.geophysics.estimate_magnetic_microlevelling(grid(), p)
    report = baselode.geophysics.run_workflow(workflow(p), {'magnetic': grid()})
    assert report['state'] in ('rejected', 'needs_input') and report['artifacts'] == {} and report['completed_steps'] == []


def test_shared_contracts_schemas_named_input_boundary_and_preflight(monkeypatch):
    descriptor = baselode.geophysics.describe_microlevelling()
    assert descriptor == json.loads((ROOT / 'javascript/packages/baselode/src/data/geophysics_microlevelling.json').read_text())
    jsonschema.validate(options(), descriptor['parameters'])
    jsonschema.validate(workflow(), baselode.geophysics.workflow_schema())
    descriptor['parameters']['required'].clear(); assert baselode.geophysics.describe_microlevelling()['parameters']['required']
    def forbidden(*args, **kwargs): pytest.fail('preflight must not run FFT')
    monkeypatch.setattr(baselode.geophysics.processing, '_fourier_bands', forbidden)
    report = baselode.geophysics.validate_workflow(workflow(), {'magnetic': grid()})
    assert report['state'] == 'ok' and report['resource_estimate']['max_fft_cells_per_band'] == 256 ** 2
    w = workflow(); w['steps'].insert(0, {'id': 'upstream', 'operation': 'low_pass', 'version': 1, 'inputs': ['magnetic'], 'parameters': {'wavelength': 16}}); w['steps'][1]['inputs'] = ['upstream']
    assert baselode.geophysics.run_workflow(w, {'magnetic': grid()})['state'] == 'rejected'
    p = options(); del p['evidence']; assert baselode.geophysics.validate_workflow(workflow(p), {'magnetic': grid()})['state'] == 'needs_input'


@pytest.mark.parametrize('extension', ['ers', 'tif'])
def test_grid_state_values_geometry_and_source_lineage_persist(tmp_path, extension):
    product = baselode.geophysics.microlevel_magnetic_grid(grid(), options()); path = tmp_path / ('product.' + extension)
    baselode.geophysics.save_raster(product, path, dtype='float64'); back = baselode.geophysics.load_raster(path)
    np.testing.assert_array_equal(back.data, product.data)
    assert back.transform == product.transform and back.metadata['microlevelling'] == product.metadata['microlevelling']
    assert back.metadata['input_lineage'] == product.metadata['input_lineage']
    with pytest.raises(ValueError): baselode.geophysics.microlevel_magnetic_grid(back, options())


def test_live_native_js_python_and_saved_workflow_replay(tmp_path):
    source = grid(); source.data[0, 32:36, 20:23] = np.nan
    p = {**options(), 'protected_bounds': [[48, 0, 80, 128]], 'flight_azimuth': 37}
    request = tmp_path / 'in.json'; response = tmp_path / 'out.json'
    request.write_text(json.dumps({'raster': source.to_payload(), 'options': p, 'workflow': workflow(p)}, allow_nan=False))
    subprocess.run(['node', str(ROOT / 'test/data/microlevelling_parity.mjs'), str(request), str(response)], cwd=ROOT / 'javascript/packages/baselode', check=True, capture_output=True, text=True)
    js = json.loads(response.read_text()); assert js['workflow']['state'] == 'ok', js['workflow']['issues']
    for key, function in [('noise', baselode.geophysics.estimate_magnetic_microlevelling), ('corrected', baselode.geophysics.microlevel_magnetic_grid)]:
        python = function(source, p); javascript = baselode.geophysics.GeophysicsRaster.from_payload(js[key])
        np.testing.assert_allclose(javascript.data, python.data, rtol=0, atol=1e-10)
        np.testing.assert_allclose(np.asarray(js['workflow']['artifacts'][key]['data'], dtype=float), python.data, rtol=0, atol=1e-10)
        assert javascript.metadata['units'] == python.metadata['units']
        baselode.geophysics.provenance.encode(javascript.metadata, 'GeoTIFF', 'float64')
    assert js['corrected']['metadata']['microlevelling']['diagnostics']['protected_valid_cells'] == 4096


@pytest.mark.parametrize('cutoff,remaining', [(8, .5), (24, .001953125)])
def test_cutoff_sensitivity_against_independent_cosine_amplitude(cutoff, remaining):
    source = grid(); source.data[:] = 7 + signals()[0]
    p = {**options(), 'across_line_wavelength': cutoff}
    actual = baselode.geophysics.microlevel_magnetic_grid(source, p)
    np.testing.assert_allclose(actual.data[0, 8:-8, 8:-8], (7 + remaining * signals()[0])[8:-8, 8:-8], rtol=0, atol=1e-12)


def test_oversized_integer_and_unknown_options_reject_without_conversion_failure():
    for p in [{**options(), 'max_abs_correction': 10 ** 400}, {**options(), 'extra': True}]:
        with pytest.raises(ValueError): baselode.geophysics.estimate_magnetic_microlevelling(grid(), p)
        assert baselode.geophysics.run_workflow(workflow(p), {'magnetic': grid()})['state'] == 'rejected'


def test_option_contract_and_product_models_do_not_alias():
    p = {**options(), 'protected_bounds': [[48, 0, 80, 128]], 'evidence': '😀' * 4096}
    before = copy.deepcopy(p); a = baselode.geophysics.microlevel_magnetic_grid(grid(), p); b = baselode.geophysics.microlevel_magnetic_grid(grid(), p)
    a.metadata['microlevelling']['parameters']['protected_bounds'][0][0] = -1
    a.metadata['microlevelling']['model']['algorithm'] = 'changed'
    assert p == before and b.metadata['microlevelling']['parameters'] == p
    assert baselode.geophysics.describe_microlevelling()['model']['algorithm'] == 'directional_gaussian_residual_v1'


def test_declared_geometric_support_boundary_is_rotation_stable():
    source = grid(); angle = .3; source.transform = (math.cos(angle), math.sin(angle), 0, math.sin(angle), -math.cos(angle), 128)
    p = {**options(), 'flight_azimuth': 360 - math.degrees(angle), 'line_spacing': 2, 'along_line_wavelength': 128}
    assert baselode.geophysics.validate_workflow(workflow(p), {'magnetic': source})['state'] == 'ok'
