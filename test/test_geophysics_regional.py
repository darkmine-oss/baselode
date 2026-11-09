# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent polynomial/Huber truth, exclusion/support gates and native replay."""
import copy
import json
import math
import pathlib
import subprocess

import jsonschema
import numpy as np
import pytest

import baselode.geophysics
import baselode.geophysics.regional

ROOT = pathlib.Path(__file__).resolve().parents[1]


def options(degree=2, estimator='least_squares'):
    p = {'band': 1, 'degree': degree, 'estimator': estimator, 'exclude_bounds': [], 'min_training_fraction': .5, 'max_condition': 1e6, 'domain_policy': 'source_footprint'}
    if estimator == 'huber': p.update(huber_threshold=1, max_iterations=100, convergence_tolerance=1e-9)
    return p


def basis(degree=2):
    row, col = np.indices((32, 32)); u, v = (col - 15.5) / 15.5, (row - 15.5) / 15.5
    columns = [np.ones(u.shape)]
    if degree >= 1: columns += [u, v]
    if degree == 2: columns += [u*u, u*v, v*v]
    return np.stack(columns, axis=-1)


def grid(degree=2):
    truth = np.array([10, 2, -3, .5, .25, -.75])[:[1, 3, 6][degree]]
    return baselode.geophysics.GeophysicsRaster(basis(degree) @ truth, transform=[1, 0, 0, 0, -1, 32], crs='EPSG:32750', metadata={'field_type': 'magnetic_anomaly', 'units': ['nT'], 'crs_units': 'm', 'uncertainty': {'sigma': .5}, 'source': 'analytic.ers'})


@pytest.mark.parametrize('degree', [0, 1, 2])
@pytest.mark.parametrize('estimator', ['least_squares', 'huber'])
def test_exact_polynomial_recovery_and_independent_svd_reference(degree, estimator):
    g = grid(degree); before = copy.deepcopy(g.metadata); values = g.data.copy()
    r = baselode.geophysics.fit_regional_trend(g, options(degree, estimator)); assert r['state'] == 'ok', r['issues']
    expected, _, _, _ = np.linalg.lstsq(basis(degree).reshape(-1, [1,3,6][degree]), g.data.ravel(), rcond=None)
    np.testing.assert_allclose(r['model']['coefficients'], expected, atol=1e-11, rtol=0)
    np.testing.assert_allclose(r['artifacts']['regional'].data, g.data, atol=1e-11, rtol=0)
    assert np.max(np.abs(r['artifacts']['residual'].data)) < 1e-11
    assert np.all(r['artifacts']['training_mask'].data == 1) and r['diagnostics']['converged']
    assert g.metadata == before; np.testing.assert_array_equal(g.data, values)
    assert 'uncertainty' not in r['artifacts']['regional'].metadata
    assert r['artifacts']['regional'].metadata['input_lineage'][-1]['metadata']['uncertainty'] == {'sigma': .5}


def test_analytic_huber_location_and_held_out_geological_background_improvement():
    g = grid(0); g.data[0, -4:, :] += 100
    r = baselode.geophysics.fit_regional_trend(g, options(0, 'huber')); assert r['state'] == 'ok', r['issues']
    # Closed-form Huber stationarity: n_inliers*(fit-10)=n_outliers*delta.
    assert r['model']['coefficients'][0] == pytest.approx(10 + 1/7, abs=1e-9)
    assert r['diagnostics']['downweighted_training_cells'] == 128
    g = grid(); truth = g.data.copy(); g.data[0, 12:20, 12:20] += 100
    validation_bounds = [[2,26,6,30]]
    robust = baselode.geophysics.fit_regional_trend(g, {**options(2, 'huber'), 'exclude_bounds': validation_bounds}); least = baselode.geophysics.fit_regional_trend(g, {**options(), 'exclude_bounds': validation_bounds})
    assert robust['state'] == 'ok' and least['state'] == 'ok'
    heldout = np.zeros((32,32), bool); heldout[2:6,2:6] = True
    robust_error = np.sqrt(np.mean((robust['artifacts']['regional'].data[0][heldout] - truth[0][heldout])**2))
    least_error = np.sqrt(np.mean((least['artifacts']['regional'].data[0][heldout] - truth[0][heldout])**2))
    assert robust_error < .2 and least_error > 2 and robust_error < least_error/20


def test_exclusions_prevent_geological_feature_leakage_but_subtract_background():
    clean = grid(); feature = grid(); feature.data[0,12:20,12:20] += 200
    p = {**options(), 'exclude_bounds': [[12,12,20,20]]}
    a = baselode.geophysics.fit_regional_trend(clean,p); b = baselode.geophysics.fit_regional_trend(feature,p)
    assert a['state'] == 'ok' and b['state'] == 'ok'
    np.testing.assert_array_equal(a['artifacts']['regional'].data, b['artifacts']['regional'].data)
    np.testing.assert_allclose(b['artifacts']['residual'].data[0,12:20,12:20],200,atol=1e-11,rtol=0)
    assert np.all(b['artifacts']['training_mask'].data[0,12:20,12:20] == 0)
    p['exclude_bounds'] = [[0,0,8,32]]
    r = baselode.geophysics.fit_regional_trend(grid(), p)
    assert r['state'] == 'ok' and r['diagnostics']['valid_cells_outside_training_bounds'] == 256


@pytest.mark.parametrize('kind', ['gaps','sentinel','selected','rotated','km','large_origin','raw_field'])
def test_masks_geometry_scaling_and_field_semantics(kind):
    g = grid()
    if kind == 'gaps': g.data[0,4:8,4:8] = np.nan
    if kind == 'sentinel': g.nodata = -999; g.data[0,4:8,4:8] = -999
    if kind == 'selected': g = g.copy_with(np.concatenate([np.full(g.data.shape,np.nan),g.data]), metadata={**g.metadata,'units':['ppm','nT']},band_names=['missing','selected'])
    if kind == 'rotated': t=.3; g.transform=(math.cos(t),math.sin(t),0,math.sin(t),-math.cos(t),0)
    if kind == 'km': g.crs=None;g.metadata.update(frame_id='local',crs_units='km');g.transform=(.001,0,0,0,-.001,0)
    if kind == 'large_origin': g.transform=(1,0,1e12,0,-1,1e12)
    if kind == 'raw_field': g.metadata['field_type']='magnetic_total_field'
    r=baselode.geophysics.fit_regional_trend(g,{**options(),'band':2 if kind=='selected' else 1});assert r['state']=='ok',r['issues']
    np.testing.assert_allclose(r['artifacts']['regional'].data[0,16,16],grid().data[0,16,16],atol=1e-11)
    if kind in ('gaps','sentinel'):
        for a in r['artifacts'].values(): assert np.isnan(a.data[0,4:8,4:8]).all()
    if kind=='raw_field': assert r['artifacts']['residual'].metadata['field_type']=='magnetic_total_field'


@pytest.mark.parametrize('change',['none','complex','missing_all','transform','geographic','shear','frame','field','units','history','unicode','band_unicode','metadata_cap','source_cap','small','work_cap'])
def test_invalid_inputs_and_work_budgets_before_solver(change,monkeypatch):
    g=grid();p=options()
    if change=='none':g=None
    if change=='complex':g.data=g.data.astype(complex)
    if change=='missing_all':g.data[:]=np.nan
    if change=='transform':g.transform=None
    if change=='geographic':g.crs='EPSG:4326'
    if change=='shear':g.transform=(1,.2,0,0,-1,0)
    if change=='frame':g.crs=None
    if change=='field':g.metadata['field_type']='unknown'
    if change=='units':del g.metadata['units']
    if change=='history':g.metadata['processing']=None
    if change=='unicode':g.metadata['extension']='\ud800'
    if change=='band_unicode':g.band_names=('\ud800',)
    if change=='metadata_cap':g.metadata['extension']='x'*524288
    if change=='source_cap':g=g.copy_with(np.ones((513,512)))
    if change=='small':g=g.copy_with(np.ones((7,8)))
    if change=='work_cap':g=g.copy_with(np.ones((512,512)));p=options(2,'huber')
    def forbidden(*args,**kwargs):pytest.fail('guard must precede matrix solve')
    monkeypatch.setattr(np.linalg,'inv',forbidden)
    r=baselode.geophysics.fit_regional_trend(g,p);assert r['state'] in ('rejected','needs_input') and r['artifacts']=={}


@pytest.mark.parametrize('key,value',[('band',True),('band',2),('degree',3),('degree',float('nan')),('max_condition',0),('max_condition',10**400),('exclude_bounds',None),('exclude_bounds',[[0,0,0,1]]),('exclude_bounds',[[100,100,101,101]]),('exclude_bounds',[[0,0,32,32]]),('exclude_bounds',[[0,0,1,1]]*17),('min_training_fraction',.01),('domain_policy','automatic'),('extra',True)])
def test_option_contract_guards(key,value):
    p={**options(),key:value};r=baselode.geophysics.fit_regional_trend(grid(),p);assert r['state'] in ('rejected','needs_input') and r['artifacts']=={}


def test_condition_rank_convergence_and_backend_gates_are_atomic(monkeypatch):
    r=baselode.geophysics.fit_regional_trend(grid(),{**options(),'max_condition':1});assert r['state']=='needs_input' and r['artifacts']=={} and r['diagnostics']['training_cells']==1024
    g=grid();g.data[:]=np.nan;g.data[0,16,:]=grid().data[0,16,:]
    # 32x32 one row lacks minimum training count; a wider one-row region tests rank.
    g=g.copy_with(np.full((8,128),np.nan));g.data[0,4,:]=1
    r=baselode.geophysics.fit_regional_trend(g,{**options(1),'min_training_fraction':.1})
    assert r['state']=='needs_input' and r['artifacts']=={} and r['diagnostics']['training_cells']==128
    g=grid();g.data[0,12:20,12:20]+=200
    r=baselode.geophysics.fit_regional_trend(g,{**options(2,'huber'),'max_iterations':1});assert r['state']=='needs_input' and r['diagnostics']['converged'] is False and r['artifacts']=={}
    def broken(*args,**kwargs):raise RuntimeError('injected solver failure')
    monkeypatch.setattr(np.linalg,'inv',broken);r=baselode.geophysics.fit_regional_trend(grid(),options());assert r['state']=='failed' and r['artifacts']=={}


def test_huber_specific_controls_integer_normalization_and_independence():
    for p in [{**options(),'huber_threshold':1},{**options(2,'huber'),'huber_threshold':0},{**options(2,'huber'),'convergence_tolerance':.1},{k:v for k,v in options(2,'huber').items() if k!='huber_threshold'}]:
        r=baselode.geophysics.fit_regional_trend(grid(),p);assert r['state'] in ('rejected','needs_input') and r['artifacts']=={}
    p={**options(),'band':1.0,'degree':2.0};before=copy.deepcopy(p);r=baselode.geophysics.fit_regional_trend(grid(),p);assert r['state']=='ok' and p==before and type(r['parameters']['band']) is int
    r['model']['coefficients'][0]=99;r['artifacts']['regional'].metadata['regional_trend']['model']['coefficients'][0]=98
    assert r['artifacts']['residual'].metadata['regional_trend']['model']['coefficients'][0]==pytest.approx(10)
    d=baselode.geophysics.describe_regional_trend();jsonschema.validate(options(),d['parameters']);jsonschema.validate(options(2,'huber'),d['parameters']);d['parameters']['required'].clear();assert baselode.geophysics.describe_regional_trend()['parameters']['required']


@pytest.mark.parametrize('extension',['ers','tif'])
def test_regional_residual_units_model_and_lineage_roundtrip(tmp_path,extension):
    result=baselode.geophysics.fit_regional_trend(grid(),options())
    for key,g in result['artifacts'].items():
        path=tmp_path/(key+'.'+extension);baselode.geophysics.save_raster(g,path,dtype='float64');back=baselode.geophysics.load_raster(path)
        np.testing.assert_array_equal(back.data,g.data);assert back.metadata['regional_trend']==g.metadata['regional_trend'] and back.metadata['input_lineage']==g.metadata['input_lineage'] and back.metadata['units']==g.metadata['units']


def test_live_native_js_models_values_and_recipe(tmp_path):
    g=grid();g.data[0,12:20,12:20]+=100;p=options(2,'huber')
    request=tmp_path/'in.json';response=tmp_path/'out.json';example=json.loads((ROOT/'test/data/regional_example.json').read_text())
    request.write_text(json.dumps({'raster':g.to_payload(),'options':p,'example':example}));subprocess.run(['node',str(ROOT/'test/data/regional_parity.mjs'),str(request),str(response)],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True)
    js=json.loads(response.read_text());py=baselode.geophysics.fit_regional_trend(g,p);assert js['fit']['state']=='ok' and js['workflow']['state']=='ok',js
    np.testing.assert_allclose(js['fit']['model']['coefficients'],py['model']['coefficients'],atol=1e-7,rtol=0)
    for key in py['artifacts']:
        other=baselode.geophysics.GeophysicsRaster.from_payload(js['fit']['artifacts'][key]);np.testing.assert_allclose(other.data,py['artifacts'][key].data,atol=1e-7,rtol=0);assert other.metadata['units']==py['artifacts'][key].metadata['units']
    assert js['workflow']['artifacts']['spectrum']['diagnostics']['spectral_total_power']==pytest.approx(1093.75,abs=1e-7)


def test_native_typed_recipe_schema_and_atomic_nonconvergence():
    f=json.loads((ROOT/'test/data/regional_example.json').read_text());before=copy.deepcopy(f)
    jsonschema.validate(f['workflow'],baselode.geophysics.describe_observation_workflow()['workflow_schema'])
    r=baselode.geophysics.run_observation_workflow(f['workflow'],{'survey':f['survey']});assert r['state']=='ok',r['issues']
    assert r['artifacts']['regional'].data[0,0,0]==pytest.approx(10+1/7,abs=1e-8)
    assert r['artifacts']['spectrum']['diagnostics']['spectral_total_power']==pytest.approx(1093.75,abs=1e-7)
    assert f==before
    f['workflow']['steps'][1]['parameters']['max_iterations']=1
    failed=baselode.geophysics.run_observation_workflow(f['workflow'],{'survey':f['survey']})
    assert failed['state']=='needs_input' and failed['artifacts']=={} and failed['completed_steps']==['grid']


@pytest.mark.parametrize('threshold',[.25,2.5])
def test_huber_threshold_matches_independent_stationarity_in_field_units(threshold):
    g=grid(0);g.data[0,-4:,:]+=100
    r=baselode.geophysics.fit_regional_trend(g,{**options(0,'huber'),'huber_threshold':threshold})
    assert r['state']=='ok',r['issues'];assert r['model']['coefficients'][0]==pytest.approx(10+threshold/7,abs=1e-9)


def test_field_unit_scaling_changes_threshold_and_absolute_convergence_consistently():
    g=grid();g.data[0,12:20,12:20]+=100;p=options(2,'huber')
    original=baselode.geophysics.fit_regional_trend(g,p)
    scaled=g.copy_with(g.data*1e-9,metadata={**g.metadata,'units':['T']})
    other=baselode.geophysics.fit_regional_trend(scaled,{**p,'huber_threshold':1e-9,'convergence_tolerance':1e-18})
    assert other['state']=='ok',other['issues']
    np.testing.assert_allclose(other['artifacts']['regional'].data*1e9,original['artifacts']['regional'].data,atol=1e-8,rtol=0)
    assert other['artifacts']['residual'].metadata['units']==['T']
