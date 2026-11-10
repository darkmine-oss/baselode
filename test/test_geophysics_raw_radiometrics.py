# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent mixtures, counting covariance, native replay and domain checks."""
import copy
import json
import math
import pathlib
import subprocess
import jsonschema
import numpy as np
import pytest
import baselode.geophysics
import baselode.geophysics.raw_radiometrics

ROOT = pathlib.Path(__file__).resolve().parents[1]


def request():
    return json.loads((ROOT/'test/data/raw_radiometrics_example.json').read_text())


def run(p, state='ok'):
    result = baselode.geophysics.process_raw_radiometrics(p)
    assert result['state'] == state, result['issues']
    return result


def covariance_reference(p, record):
    c=p['calibration'];air=c['air_reference'];h=record['height_agl_m']*(record['pressure_Pa']/air['pressure_Pa'])*(air['temperature_K']/record['temperature_K']);delta=h-c['nominal_effective_height_m'];s=np.array(c['response_matrix'])+delta*np.array(c['response_height_slopes_per_m']);q=np.diag(np.exp(delta*np.array(c['attenuation_per_m']))/np.array(c['sensitivity_cps_per_unit']))@np.linalg.inv(s)
    counts=np.array([sum(record['spectrum_counts'][w['first_channel']:w['last_channel_exclusive']]) for w in c['windows']]);b=np.array(c['cosmic_leakage']);monitor=record['cosmic_monitor'];cov=np.diag(counts/record['live_time_s']**2)+np.array(c['aircraft_background']['covariance_cps2'])+np.array(record['radon_background']['covariance_cps2'])+np.outer(b,b)*monitor['counts']/monitor['live_time_s']**2
    rates=counts/record['live_time_s']-np.array(c['aircraft_background']['window_rates_cps'])-np.array(record['radon_background']['window_rates_cps'])-b*monitor['counts']/monitor['live_time_s'];return q@rates,q@cov@q.T,q,cov


def test_hand_mixture_live_background_stripping_height_and_independent_covariance():
    p=request();before=copy.deepcopy(p);r=run(p);assert p==before
    # Hand inverse: U=(u-.3t)/.97, Th=(t-.1u)/.97, K=k-.2U-.1Th.
    manual=np.array([[1,-.19/.97,-.04/.97],[0,1/.97,-.3/.97],[0,-.1/.97,1/.97]])
    assert r['records'][0]['background_corrected_rates_cps']==[114,62,45]
    assert r['records'][0]['stripped_rates_cps']==pytest.approx([100,50,40])
    for i,record in enumerate(r['records']):
        values=[v['value'] for v in record['channels']];assert values==pytest.approx([10,10,20],rel=1e-14);assert record['height_factors']==pytest.approx([1 if i==0 else 2]*3)
        expected,cov,q,input_cov=covariance_reference(p,p['records'][i]);np.testing.assert_allclose(values,expected,rtol=1e-14);np.testing.assert_allclose(record['concentration_covariance']['values'],cov,rtol=3e-14,atol=1e-14);np.testing.assert_allclose(record['inverse_response'],manual,rtol=1e-14,atol=1e-15);np.testing.assert_allclose(record['count_rate_covariance_cps2'],input_cov,rtol=1e-14,atol=1e-14)
        assert [v['standard_uncertainty'] for v in record['channels']]==pytest.approx(np.sqrt(np.diag(cov)));assert record['dead_time_fraction']==pytest.approx(.2)
    assert r['processing_state']['kind']=='corrected_concentrations' and len(r['correction_recipe'])==8
    assert r['diagnostics']['window_energy_edges_keV']==[[1250,1750],[1750,2250],[2250,2750]]
    assert not r['diagnostics']['cross_record_covariance_modelled'] and not r['diagnostics']['confidence_intervals']
    assert run(r['request'])==r


def test_conditional_counting_and_background_covariance_independent_monte_carlo():
    p=request();record=p['records'][0];c=p['calibration'];_,expected,q,_=covariance_reference(p,record);rng=np.random.default_rng(588);n=160000
    counts=np.array([236,134,102]);main=rng.poisson(counts,size=(n,3))/2;cosmic=rng.poisson(20,size=n)/2
    aircraft=np.array(c['aircraft_background']['window_rates_cps'])+np.einsum('nj,ij->ni',rng.standard_normal((n,3)),np.linalg.cholesky(c['aircraft_background']['covariance_cps2']));radon=np.array(record['radon_background']['window_rates_cps'])+np.einsum('nj,ij->ni',rng.standard_normal((n,3)),np.linalg.cholesky(record['radon_background']['covariance_cps2']))
    simulated=np.einsum('nj,ij->ni',main-aircraft-radon-cosmic[:,None]*np.array(c['cosmic_leakage']),q);centered=simulated-simulated.mean(axis=0);actual=np.einsum('ni,nj->ij',centered,centered)/(n-1);se=np.sqrt((expected**2+np.outer(np.diag(expected),np.diag(expected)))/(n-1));assert np.all(np.abs(actual-expected)<=6*se)


def test_exposure_is_explicit_live_time_not_an_inferred_dead_time_constant():
    p=request();baseline=run(p)
    for record in p['records']:record['real_time_s']=4;record['cosmic_monitor']['real_time_s']=4
    r=run(p)
    for a,b in zip(r['records'],baseline['records']):assert a['channels']==b['channels'] and a['concentration_covariance']==b['concentration_covariance'];assert a['dead_time_fraction']==.5 and 'high_dead_time' in a['flags'] and 'high_cosmic_dead_time' in a['flags']
    p['records'][0]['live_time_s']=1;r=run(p);expected,*_=covariance_reference(p,p['records'][0]);assert [v['value'] for v in r['records'][0]['channels']]==pytest.approx(expected)


def test_reference_air_height_and_supplied_height_dependent_response():
    p=request();p['calibration']['response_height_slopes_per_m'][0][1]=.001;p['records'][1].update(pressure_Pa=100000,temperature_K=280);r=run(p)
    for row,record in zip(r['records'],p['records']):
        expected,cov,*_=covariance_reference(p,record);assert [v['value'] for v in row['channels']]==pytest.approx(expected);np.testing.assert_allclose(row['concentration_covariance']['values'],cov,rtol=1e-13,atol=1e-14)
    assert r['records'][1]['effective_height_m']==pytest.approx(120*(100000/101325)*(273.15/280))
    p=request();p['calibration']['air_reference'].update(pressure_Pa=100000,temperature_K=300)
    for record in p['records']:record.update(pressure_Pa=100000,temperature_K=300)
    assert [c['value'] for c in run(p)['records'][1]['channels']]==pytest.approx([10,10,20])


def test_complete_bin_windows_use_supplied_energy_model_without_fractional_rebinning():
    p=request();p['calibration']['windows'][0]['first_channel']=2;p['calibration']['energy'].update(offset_keV=10,gain_keV_per_channel=450);r=run(p);assert r['records'][0]['window_counts']==[242,134,102];assert r['diagnostics']['window_energy_edges_keV'][0]==[685,1585]
    expected,*_=covariance_reference(p,p['records'][0]);assert [v['value'] for v in r['records'][0]['channels']]==pytest.approx(expected)


@pytest.mark.parametrize('covariance,rank',[(np.zeros((3,3)).tolist(),0),(np.outer([1,2,3],[1,2,3]).tolist(),1),(np.diag([1e-120,2e-120,3e-120]).tolist(),3),(np.diag([1e12,1e-120,1e-200]).tolist(),3)])
def test_psd_zero_rank_one_tiny_and_widely_scaled_variances(covariance,rank):
    p=request();p['calibration']['aircraft_background']['covariance_cps2']=covariance;r=run(p);audit=r['records'][0]['covariance_factorisation']['aircraft'];assert audit['rank']==rank;assert audit['relative_adjustment']<=512*np.finfo(float).eps
    expected,cov,*_=covariance_reference(p,p['records'][0]);np.testing.assert_allclose(r['records'][0]['concentration_covariance']['values'],cov,rtol=1e-13,atol=1e-14)


def test_psd_rounding_is_audited_and_tiny_indefinite_is_not_absolutised_away():
    p=request();p['calibration']['aircraft_background']['covariance_cps2']=[[-1e-14,0,0],[0,1,0],[0,0,1]];r=run(p);audit=r['records'][0]['covariance_factorisation']['aircraft'];assert audit['maximum_adjustment_cps2']==1e-14 and 'covariance_rounding_adjustment' in r['records'][0]['flags']
    for scale in [1,1e-20,1e-120]:
        p['calibration']['aircraft_background']['covariance_cps2']=[[0,scale,0],[scale,0,0],[0,0,0]];run(p,'rejected')


def simple(p):
    c=p['calibration'];c.update(response_matrix=np.eye(3).tolist(),response_height_slopes_per_m=np.zeros((3,3)).tolist(),attenuation_per_m=[0,0,0],sensitivity_cps_per_unit=[1,1,1],cosmic_leakage=[0,0,0]);c['aircraft_background']={'window_rates_cps':[0,0,0],'covariance_cps2':np.zeros((3,3)).tolist()}
    for record in p['records']:record['spectrum_counts']=[0]*8;record['cosmic_monitor']['counts']=0;record['radon_background'].update(window_rates_cps=[0,0,0],covariance_cps2=np.zeros((3,3)).tolist())
    return p


@pytest.mark.parametrize('small',[1e-150,1e-320])
def test_negative_zero_low_counts_and_undefined_relative_uncertainty_are_kept(small):
    p=simple(request());p['calibration']['aircraft_background']['window_rates_cps'][0]=1;r=run(p);channels=r['records'][0]['channels'];assert [v['value'] for v in channels]==[-1,0,0];assert 'negative_concentration' in channels[0]['flags'];assert channels[1]['standard_uncertainty']==0 and channels[1]['relative_standard_uncertainty'] is None and 'zero_count_poisson_plugin_variance' in channels[1]['flags']
    p['calibration']['aircraft_background'].update(window_rates_cps=[small,0,0],covariance_cps2=np.eye(3).tolist());r=run(p);assert r['records'][0]['channels'][0]['value']<0 and r['records'][0]['channels'][0]['relative_standard_uncertainty'] is None and 'relative_uncertainty_outside_portable_range' in r['records'][0]['channels'][0]['flags']


def bad_cases():
    return [(['calibration','response_matrix'],[[1,1,0],[1,1,1e-160],[0,1e-160,1]],'needs_input'),(['version'],True,'rejected'),(['calibration'],None,'needs_input'),(['calibration','source_id'],'','rejected'),(['records',1,'calibration_id'],'different','needs_input'),(['records',1,'detector_id'],'different','needs_input'),(['records',1,'acquired_at_utc'],'2027-01-01T00:00:00Z','needs_input'),(['records',1,'acquired_at_utc'],'2026-02-30T00:00:00Z','rejected'),(['records',1,'acquired_at_utc'],'2026-06-01T00:00:00.000Z','rejected'),(['records',1,'live_time_s'],0,'rejected'),(['records',1,'live_time_s'],3,'rejected'),(['records',1,'spectrum_counts',3],1.5,'rejected'),(['records',1,'spectrum_counts',3],True,'rejected'),(['calibration','windows',1,'first_channel'],3,'rejected'),(['calibration','response_matrix',0,0],2,'rejected'),(['calibration','response_matrix'],[[1,1,1]]*3,'needs_input'),(['calibration','effective_height_range_m'],[150,50],'rejected'),(['records',1,'height_agl_m'],160,'needs_input'),(['options','maximum_height_factor'],1,'needs_input'),(['options','maximum_response_condition'],3,'needs_input'),(['records',1,'radon_background','independent_of_main_and_cosmic'],False,'needs_input'),(['records',1,'cosmic_monitor','independent_of_spectrum'],False,'needs_input'),(['records',1,'cosmic_monitor','real_time_s'],3,'rejected'),(['processing_state','kind'],'corrected_concentrations','needs_input'),(['processing_state','applied_corrections'],['live_time_normalization'],'needs_input'),(['calibration','aircraft_background','covariance_cps2'],[[1,.2,0],[0,1,0],[0,0,1]],'rejected'),(['metadata'],{'oversize':[1.0]*4100},'rejected'),(['records',1,'id'],'sample_0','rejected'),(['calibration','energy','gain_keV_per_channel'],2000,'rejected'),(['calibration','response_height_slopes_per_m',0,1],.1,'needs_input')]


def change(p,path,value):
    target=p
    for key in path[:-1]:target=target[key]
    target[path[-1]]=copy.deepcopy(value);return p


@pytest.mark.parametrize('path,value,state',bad_cases())
def test_invalid_domains_identity_time_and_correction_state_are_atomic(path,value,state,monkeypatch):
    p=change(request(),path,value)
    def forbidden(*args):raise AssertionError('all records must pass preflight before any corrected output')
    monkeypatch.setattr(baselode.geophysics.raw_radiometrics,'_record',forbidden);r=run(p,state);assert r['request'] is None and not r['records'] and not r['correction_recipe'] and r['processing_state'] is None


def compare(a,b):
    if type(a) is dict:assert a.keys()==b.keys();[compare(a[k],b[k]) for k in a if k!='producer']
    elif type(a) is list:assert len(a)==len(b);[compare(x,y) for x,y in zip(a,b)]
    elif type(a) in (int,float):assert b==pytest.approx(a,rel=2e-12,abs=1e-300)
    else:assert a==b


def native(requests,tmp_path):
    a=tmp_path/'in.json';b=tmp_path/'out.json';a.write_text(json.dumps(requests));subprocess.run(['node',str(ROOT/'test/data/raw_radiometrics_parity.mjs'),str(a),str(b)],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True);return json.loads(b.read_text())


def test_native_scientific_contract_error_replay_and_descriptor_immutability(tmp_path):
    p=request();weak=[]
    for value in [1e-150,1e-320]:
        tiny=simple(request());tiny['calibration']['aircraft_background'].update(window_rates_cps=[value,0,0],covariance_cps2=np.eye(3).tolist());weak.append(tiny)
    requests=[p]+weak+[change(request(),path,value) for path,value,_ in bad_cases()];js=native(requests,tmp_path);d=baselode.geophysics.describe_raw_radiometrics();assert js['descriptor']==d;jsonschema.validate(p,d['request_schema'])
    for value,result,validation in zip(requests,js['reports'],js['validations']):
        py=baselode.geophysics.process_raw_radiometrics(value);assert py['state']==result['state']==validation['state'];assert [i['code'] for i in py['issues']]==[i['code'] for i in result['issues']]
        if py['state']=='ok':compare(py,result);jsonschema.validate(result,d['result_schema']);compare(baselode.geophysics.process_raw_radiometrics(result['request']),py)
        else:assert result['request'] is None and result['records']==[]
    d['resources']['max_records']=0;assert baselode.geophysics.describe_raw_radiometrics()['resources']['max_records']==128


def maximum_request():
    p=request();c=p['calibration'];c['energy'].update(channels=4096,offset_keV=0,gain_keV_per_channel=2);c['windows']=[{'element':el,'first_channel':a,'last_channel_exclusive':b} for el,a,b in [('K',0,4094),('eU',4094,4095),('eTh',4095,4096)]];base=p['records'][0];p['records']=[{**copy.deepcopy(base),'id':str(i),'spectrum_counts':[1000000000]*4096} for i in range(128)];return p


def test_joint_maximum_records_channels_counts_and_native_execution(tmp_path):
    p=maximum_request();r=run(p);assert len(r['records'])==128 and r['records'][0]['window_counts']==[4094000000000,1000000000,1000000000];assert len(json.dumps(r).encode())<33554432
    js=native([p],tmp_path);assert js['validations'][0]['state']=='ok';compare(r,js['reports'][0]);p['records'].append(copy.deepcopy(p['records'][0]));run(p,'rejected')


def test_replay_uses_acquisition_validity_not_current_clock_and_rejects_cycles():
    p=request();p['calibration'].update(valid_from_utc='2000-01-01T00:00:00Z',valid_to_utc='2000-12-31T23:59:59Z')
    for row in p['records']:row['acquired_at_utc']='2000-06-01T00:00:00Z'
    run(p);p['metadata']={'cycle':p};r=baselode.geophysics.validate_raw_radiometrics(p);assert r['state']=='rejected' and r['request'] is None


def test_public_wildcard_import_contains_the_registered_raw_api():
    namespace = {}
    exec('from baselode.geophysics import *', namespace)
    for name in ['describe_raw_radiometrics','validate_raw_radiometrics','process_raw_radiometrics']:
        assert namespace[name] is getattr(baselode.geophysics,name)
