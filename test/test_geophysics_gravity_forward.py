# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent Newtonian quadrature, derivatives, cancellation and native parity."""
import copy
import json
import math
import pathlib
import subprocess

import jsonschema
import numpy as np
import pytest

import baselode.geophysics
import baselode.geophysics.gravity_forward

ROOT = pathlib.Path(__file__).resolve().parents[1]
G = 6.67430e-11
COMPONENTS = ('gx', 'gy', 'gz_up', 'g_down', 'potential')


def request(sphere=False):
    p = json.loads((ROOT / 'test/data/gravity_forward_example.json').read_text())
    if sphere:
        p['sources'] = [{'id': 'sphere', 'kind': 'sphere', 'x_m': 0, 'y_m': 0, 'z_m': 0, 'radius_m': 100, 'density_contrast_kg_m3': 2000}]
        p['points'] = [{'id': 'p', 'x_m': 0, 'y_m': 0, 'z_m': 200}]
        p.pop('point_mass_min_distance_m')
    return p


def calculate(p):
    r = baselode.geophysics.calculate_gravity_forward(p)
    assert r['state'] == 'ok', r['issues']
    return r


def sphere_quadrature(distance, radius=100, density=2000):
    # Direct volume integral in spherical source coordinates, not shell formula.
    nodes, weights = np.polynomial.legendre.leggauss(64)
    s = (nodes + 1) * radius / 2
    w = weights * radius / 2
    separation = np.sqrt(distance**2 + s[:, None]**2 - 2 * distance * s[:, None] * nodes)
    potential = -2 * math.pi * G * density * np.sum(w[:, None] * weights * s[:, None]**2 / separation)
    acceleration = -2 * math.pi * G * density * np.sum(w[:, None] * weights * s[:, None]**2 * (distance - s[:, None] * nodes) / separation**3)
    return potential, acceleration


def interior_potential(distance, radius=100, density=2000):
    # Analytically integrated polar angle; split radial quadrature at |r-s| kink.
    nodes, weights = np.polynomial.legendre.leggauss(32)
    if distance == 0:
        s = (nodes + 1) * radius / 2
        return -4 * math.pi * G * density * np.sum(weights * radius / 2 * s)
    total = 0
    for a, b in ((0, distance), (distance, radius)):
        s = a + (nodes + 1) * (b-a) / 2
        total += np.sum(weights * (b-a) / 2 * s * (distance+s-np.abs(distance-s)))
    return -2 * math.pi * G * density / distance * total


def test_contract_example_sign_units_replay_and_snapshot_isolation():
    p = request(); before = copy.deepcopy(p); r = calculate(p)
    assert r['fields'][0] == pytest.approx({'id': 'surface', 'gx': 0, 'gy': 0, 'gz_up': -6.6743, 'g_down': 6.6743, 'potential': -.066743})
    assert r['sensitivities'][0]['fields'][0]['g_down'] == pytest.approx(6.6743e-12)
    assert r['sensitivities'][0]['field_units']['g_down'] == '(mGal)/(kg)'
    descriptor = baselode.geophysics.describe_gravity_forward()
    jsonschema.validate(p, descriptor['request_schema']); jsonschema.validate(r, descriptor['result_schema'])
    assert calculate(r['request'])['fields'] == r['fields'] and p == before
    r['request']['sources'][0]['mass_contrast_kg'] = 0
    r['model']['gravitational_constant'] = 0; descriptor['resources'].clear()
    assert calculate(p)['fields'][0]['g_down'] == pytest.approx(6.6743)
    assert baselode.geophysics.describe_gravity_forward()['resources']['max_sources'] == 128
    assert (ROOT/'python/src/baselode/geophysics/geophysics_gravity_forward.json').read_bytes() == (ROOT/'javascript/packages/baselode/src/data/geophysics_gravity_forward.json').read_bytes()


@pytest.mark.parametrize('distance', [201, 350, 1000])
def test_sphere_exterior_matches_independent_direct_volume_quadrature(distance):
    p = request(True); p['points'][0]['z_m'] = distance
    r = calculate(p)['fields'][0]; potential, acceleration = sphere_quadrature(distance)
    assert r['potential'] == pytest.approx(potential, rel=2e-13)
    assert r['gz_up'] * 1e-5 == pytest.approx(acceleration, rel=2e-13)
    mass = 4 * math.pi * 100**3 / 3 * 2000
    p['sources'] = [{k:v for k,v in p['sources'][0].items() if k not in ('radius_m','density_contrast_kg_m3')}]
    p['sources'][0].update(kind='point_mass', mass_contrast_kg=mass); p['point_mass_min_distance_m'] = 1
    for key in COMPONENTS: assert calculate(p)['fields'][0][key] == pytest.approx(r[key], abs=1e-14)


@pytest.mark.parametrize('distance', [0, 1, 50, 99, 100])
def test_sphere_interior_centre_surface_and_independent_potential_derivative(distance):
    p = request(True); p['points'][0]['z_m'] = distance
    r = calculate(p)['fields'][0]
    assert r['potential'] == pytest.approx(interior_potential(distance), rel=5e-14)
    if 0 < distance < 100:
        h = min(.25, distance/4, (100-distance)/4)
        derivative = (interior_potential(distance-2*h)-8*interior_potential(distance-h)+8*interior_potential(distance+h)-interior_potential(distance+2*h))/(12*h)
        assert r['gz_up'] == pytest.approx(-derivative*1e5, rel=2e-9)
    elif distance == 0:
        assert [r[k] for k in ('gx','gy','gz_up','g_down')] == [0]*4
    else:
        p['points'][0]['z_m'] = 100 + 1e-7
        for key in COMPONENTS: assert calculate(p)['fields'][0][key] == pytest.approx(r[key], rel=4e-9, abs=1e-15)


@pytest.mark.parametrize('sphere', [False, True])
@pytest.mark.parametrize('amplitude', [-2000, 0, 2000])
def test_full_vector_negative_potential_gradient_and_fixed_geometry_derivatives(sphere, amplitude):
    p = request(sphere); p['points'][0].update(x_m=131, y_m=-57, z_m=166)
    key = 'density_contrast_kg_m3' if sphere else 'mass_contrast_kg'
    p['sources'][0][key] = amplitude
    r = calculate(p); f = r['fields'][0]; basis = r['sensitivities'][0]['fields'][0]
    for name in COMPONENTS: assert f[name] == pytest.approx(basis[name]*amplitude, abs=1e-15)
    p1 = copy.deepcopy(p); p1['sources'][0][key] += 1
    for name in COMPONENTS: assert calculate(p1)['fields'][0][name]-f[name] == pytest.approx(basis[name], rel=2e-9, abs=1e-16)
    for axis, name in zip(('x_m','y_m','z_m'),('gx','gy','gz_up')):
        a, b = copy.deepcopy(p), copy.deepcopy(p); a['points'][0][axis] -= .01; b['points'][0][axis] += .01
        difference = (calculate(b)['fields'][0]['potential']-calculate(a)['fields'][0]['potential'])/.02
        assert f[name] == pytest.approx(-difference*1e5, rel=3e-8, abs=1e-14)


def test_translation_axis_rotation_signed_superposition_and_cancellation():
    p = request(); p['points'][0].update(x_m=300,y_m=400)
    r = calculate(p)['fields'][0]
    translated = copy.deepcopy(p)
    for row in translated['points']+translated['sources']:
        for axis,shift in zip(('x_m','y_m','z_m'),(1e9,-2e9,1e9)): row[axis] += shift
    assert calculate(translated)['fields'][0] == pytest.approx(r)
    rotated = copy.deepcopy(p)
    for row in rotated['points']+rotated['sources']: row['x_m'],row['y_m'] = -row['y_m'],row['x_m']
    f = calculate(rotated)['fields'][0]; assert f['gx'] == pytest.approx(-r['gy']) and f['gy'] == pytest.approx(r['gx'])
    for mass in (1e20,1,-1e20):
        s = copy.deepcopy(p['sources'][0]); s['mass_contrast_kg'] = mass;s['id'] = str(mass)
        if mass == 1e20: p['sources'] = []
        p['sources'].append(s)
    # Exact fsum of individually representable kernels, not a naive summation.
    r = calculate(p)
    individual = [calculate({**p,'sources':[source]})['fields'][0] for source in p['sources']]
    for key in COMPONENTS: assert r['fields'][0][key] == math.fsum(f[key] for f in individual)
    assert r['fields'][0]['g_down'] > 0
    p['include_sensitivities'] = False; assert calculate(p)['sensitivities'] == []


def negative_cases():
    cases = []
    def add(path, value, state='rejected', code='contract'):
        p=request(); target=p
        for part in path[:-1]: target=target[part]
        target[path[-1]]=value;cases.append((p,state,code))
    for field in ('schema','version','coordinate_frame','sources','points','include_sensitivities'):
        p=request();del p[field];cases.append((p,'needs_input','context'))
    add(['version'],True); add(['version'],2);add(['extra'],0);add(['coordinate_frame','units'],'ft')
    add(['coordinate_frame','axes'],'east_north_down');add(['coordinate_frame','height_datum'],None,'needs_input','context')
    add(['coordinate_frame','id'],'unknown'); add(['coordinate_frame','height_datum'],' ')
    add(['points',0,'x_m'],True);add(['points',0,'z_m'],float('inf'));add(['points',0,'x_m'],'1');add(['points',0,'x_m'],10**400)
    add(['points',0,'id'],'\ud800');add(['points',0,'id'],'x'*129);add(['include_sensitivities'],0)

    for value in (None, 5, [], True, 'sphere'): add(['sources',0],value)
    add(['sources',0,'kind'],None,'needs_input','context')
    add(['sources',0,'kind'],'prism');add(['sources',0,'mass_contrast_kg'],1e22);add(['sources',0,'radius_m'],1)
    add(['point_mass_min_distance_m'],None,'needs_input','context');add(['point_mass_min_distance_m'],0)
    add(['points',0,'z_m'],-1000,'needs_input','context')
    p=request();p['sources'][0]['mass_contrast_kg']=0;p['points'][0]['z_m']=-1000;cases.append((p,'needs_input','context'))
    p=request();p['sources']*=2;cases.append((p,'rejected','contract'))
    p=request();p['points']*=2;cases.append((p,'rejected','contract'))
    p=request(True);p['point_mass_min_distance_m']=1;cases.append((p,'rejected','contract'))
    for key,value in [('radius_m',0),('radius_m',100001),('density_contrast_kg_m3',100001)]:
        p=request(True);p['sources'][0][key]=value;cases.append((p,'rejected','contract'))
    add(['points',0,'x_m'],200001,'rejected','resource')
    p=request();p['metadata']={'text':'x'*131073};cases.append((p,'rejected','resource'))
    p=request();p['metadata']={};p['metadata']['cycle']=p;cases.append((p,'rejected','contract'))
    for field in ('points','sources'):
        p=request();p[field]=[dict(p[field][0],id=str(i)) for i in range(4097 if field=='points' else 129)];cases.append((p,'rejected','resource'))
    p=request();p['points']=[dict(p['points'][0],id=str(i)) for i in range(4096)];p['sources']=[dict(p['sources'][0],id=str(i)) for i in range(3)];cases.append((p,'rejected','resource'))
    return cases


@pytest.mark.parametrize('p,state,code', negative_cases())
def test_strict_atomic_contract_context_and_resource_gates(p,state,code,monkeypatch):
    def forbidden(*args): raise AssertionError('kernel must not execute for invalid requests')
    monkeypatch.setattr(baselode.geophysics.gravity_forward,'_kernel',forbidden)
    r=baselode.geophysics.calculate_gravity_forward(p)
    assert (r['state'],r['issues'][0]['code']) == (state,code),r
    assert r['fields']==[] and r['sensitivities']==[] and r['request'] is None
    jsonschema.validate(r,baselode.geophysics.describe_gravity_forward()['result_schema'])


def test_max_sensitivity_pair_budget_is_executable_and_failure_is_atomic(monkeypatch):
    p=request();p['points']=[dict(p['points'][0],id=str(i)) for i in range(4096)];p['sources']=[dict(p['sources'][0],id=str(i)) for i in range(2)]
    r=calculate(p);assert len(r['sensitivities'])==2 and len(r['fields'])==4096
    def broken(*args): raise ArithmeticError('injected numerical failure')
    monkeypatch.setattr(baselode.geophysics.gravity_forward,'_kernel',broken)
    r=baselode.geophysics.calculate_gravity_forward(request());assert r['state']=='failed' and r['fields']==[] and r['sensitivities']==[]


def test_live_python_js_positive_negative_units_and_request_replay(tmp_path):
    p=request(True);p['sources'].append({**request()['sources'][0],'mass_contrast_kg':-1e12});p['point_mass_min_distance_m']=1
    p['points']=[{'id':str(z),'x_m':13,'y_m':-19,'z_m':z} for z in (-50,0,100,500)]
    cases=[]
    for payload,_,_ in negative_cases():
        try:
            text=json.dumps(payload,ensure_ascii=False,allow_nan=False);text.encode('utf-8')
        except (ValueError,UnicodeError):continue
        # Exclude huge integers not representable in JSON.parse's finite range.
        if payload.get('points') and 'x_m' in payload['points'][0] and type(payload['points'][0]['x_m']) is int and abs(payload['points'][0]['x_m'])>1e100:continue
        cases.append(payload)
    # Explicit minimum boundary, zero/negative amplitudes and portable Unicode IDs.
    p['coordinate_frame']['id']='local 🧲';p['points'][0]['id']='測点'
    input_path=tmp_path/'in.json';output_path=tmp_path/'out.json'
    input_path.write_text(json.dumps({'request':p,'negative':cases}))
    subprocess.run(['node',str(ROOT/'test/data/gravity_forward_parity.mjs'),str(input_path),str(output_path)],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True)
    js=json.loads(output_path.read_text());py=calculate(p);assert js['result']['state']=='ok',js
    for other,result in [(js['result'],py),(calculate(js['result']['request']),py)]:
        assert other['model']==result['model'] and other['field_units']==result['field_units'] and other['request']==p
        for x,y in zip(other['fields'],result['fields']):
            assert x['id']==y['id']
            for key in COMPONENTS:assert x[key]==pytest.approx(y[key],rel=2e-13,abs=1e-15)
        for a,b in zip(other['sensitivities'],result['sensitivities']):
            assert a['field_units']==b['field_units'] and a['parameter']==b['parameter']
            for x,y in zip(a['fields'],b['fields']):
                for key in COMPONENTS:assert x[key]==pytest.approx(y[key],rel=2e-13,abs=1e-18)
    expected=[baselode.geophysics.calculate_gravity_forward(case) for case in cases]
    assert js['negative']==[{'state':r['state'],'code':r['issues'][0]['code'],'fields':r['fields'],'sensitivities':r['sensitivities']} for r in expected]


def test_canonical_positive_zero_components_in_fields_and_sensitivities():
    p=request(True);p['points'][0]['z_m']=0
    r=calculate(p)
    for field in r['fields']+r['sensitivities'][0]['fields']:
        for key in COMPONENTS:
            if field[key]==0:assert math.copysign(1,field[key])==1
    assert all(json.dumps(field[key]) == '0' for field in r['fields'] for key in COMPONENTS if field[key] == 0)


def test_deepest_valid_request_echo_succeeds_and_deeper_input_is_rejected():
    p=request(); nested=0
    for _ in range(31):nested={'nested':nested}
    p['metadata']=nested
    r=calculate(p);assert r['request']==p
    p['metadata']={'nested':nested}
    r=baselode.geophysics.calculate_gravity_forward(p)
    assert r['state']=='rejected' and r['issues'][0]['code']=='resource' and r['fields']==[]
