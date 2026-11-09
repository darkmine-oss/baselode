# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent current-loop/axial/total-field references and native parity."""
import copy
import json
import math
import pathlib
import subprocess

import jsonschema
import mpmath
import numpy as np
import pytest

import baselode.geophysics
import baselode.geophysics.magnetic_forward

ROOT = pathlib.Path(__file__).resolve().parents[1]
MU0 = 1.25663706127e-6
FACTOR = MU0 / (4*math.pi) * 1e9
COORDS = ('x_m','y_m','z_m')
MOMENTS = ('moment_x_A_m2','moment_y_A_m2','moment_z_up_A_m2')
VECTORS = ('bx','by','bz_up','b_down')
FIELDS = (*VECTORS,'tmi_linear','tmi_exact','linearization_difference')


def request():
    return json.loads((ROOT/'test/data/magnetic_forward_example.json').read_text())


def calculate(p):
    r=baselode.geophysics.calculate_magnetic_forward(p)
    assert r['state']=='ok',r['issues']
    return r


def loop_response(point, direction, radius):
    # Direct Biot-Savart ring-current integral, not a dipole kernel.
    unit=np.asarray(direction,dtype=float);unit/=np.linalg.norm(unit)
    seed=np.array([1,0,0]) if abs(unit[0])<.9 else np.array([0,1,0])
    a=np.cross(unit,seed);a/=np.linalg.norm(a);b=np.cross(unit,a)
    theta=np.arange(2048)*2*math.pi/2048
    ring=radius*(np.cos(theta)[:,None]*a+np.sin(theta)[:,None]*b)
    dl=radius*(-np.sin(theta)[:,None]*a+np.cos(theta)[:,None]*b)*2*math.pi/2048
    delta=np.asarray(point)-ring;distance=np.linalg.norm(delta,axis=1)
    current=2000/(math.pi*radius**2)
    return MU0/(4*math.pi)*current*np.sum(np.cross(dl,delta)/distance[:,None]**3,axis=0)*1e9


def test_portable_example_contract_units_snapshots_and_replay():
    p=request();before=copy.deepcopy(p);r=calculate(p);f=r['fields'][0]
    assert f['bz_up']==pytest.approx(2*FACTOR*1000/100**3,rel=1e-15)
    assert f['bx']==0 and f['by']==0 and f['b_down']==-f['bz_up']
    assert f['tmi_exact']==pytest.approx(f['tmi_linear'],abs=1e-15)
    assert len(r['sensitivities'])==3 and r['sensitivities'][0]['field_units']['bx']=='nT/(A*m^2)'
    assert all('tmi_exact' not in derivative['fields'][0] for derivative in r['sensitivities'])
    descriptor=baselode.geophysics.describe_magnetic_forward()
    jsonschema.validate(p,descriptor['request_schema']);jsonschema.validate(r,descriptor['result_schema'])
    assert p==before and calculate(r['request'])['fields']==r['fields']
    r['request']['sources'][0]['moment_z_up_A_m2']=0;r['model']['vacuum_magnetic_permeability']=0;descriptor['resources'].clear()
    assert calculate(p)['fields'][0]==f and baselode.geophysics.describe_magnetic_forward()['resources']['max_sources']==128
    assert (ROOT/'python/src/baselode/geophysics/geophysics_magnetic_forward.json').read_bytes()==(ROOT/'javascript/packages/baselode/src/data/geophysics_magnetic_forward.json').read_bytes()


@pytest.mark.parametrize('axis',[0,1,2])
@pytest.mark.parametrize('sign',[-1,1])
def test_independent_axial_equatorial_antipodal_inverse_cube_cases(axis,sign):
    p=request();source=p['sources'][0]
    for k in COORDS:source[k]=0
    for k in MOMENTS:source[k]=0
    source[MOMENTS[axis]]=sign*2000
    points=[]
    for direction in (axis,(axis+1)%3):
        for distance in (100,-100,200):
            point=dict(id=str(len(points)),x_m=0,y_m=0,z_m=0);point[COORDS[direction]]=distance;points.append(point)
    p['points']=points;p['background_nT']=None;r=calculate(p)
    for i,(direction,distance) in enumerate((a,d) for a in (axis,(axis+1)%3) for d in (100,-100,200)):
        expected=sign*2000*FACTOR/(abs(distance)**3)*(2 if direction==axis else -1)
        for j,key in enumerate(('bx','by','bz_up')):assert r['fields'][i][key]==pytest.approx(expected if j==axis else 0,abs=1e-15)
        assert r['fields'][i]['tmi_exact'] is None and r['fields'][i]['tmi_linear'] is None
    assert r['diagnostics']['max_response_to_background_ratio'] is None


@pytest.mark.parametrize('direction',[[0,0,1],[1,2,-3],[1,0,0]])
def test_independent_biot_savart_current_loop_quadrature_converges_to_dipole(direction):
    p=request();unit=np.asarray(direction,dtype=float);unit/=np.linalg.norm(unit)
    p['sources'][0].update(dict(zip(COORDS,[0,0,0])));p['sources'][0].update(dict(zip(MOMENTS,(2000*unit).tolist())))
    p['points'][0].update(x_m=15,y_m=-21,z_m=37);p['background_nT']=None
    truth=np.array([calculate(p)['fields'][0][k] for k in ('bx','by','bz_up')])
    errors=[np.linalg.norm(loop_response([15,-21,37],direction,r)-truth) for r in (.1,.05,.025)]
    assert errors[0]/errors[1]==pytest.approx(4,rel=.001)
    assert errors[1]/errors[2]==pytest.approx(4,rel=.001)
    assert errors[2]/np.linalg.norm(truth)<1e-6


@pytest.mark.parametrize('background',[None,{'x':20000,'y':-10000,'z_up':40000}])
def test_fixed_geometry_moment_columns_match_finite_differences_including_zero(background):
    p=request();p['background_nT']=background;p['points'][0].update(x_m=31,y_m=-24,z_m=6)
    p['sources'][0].update(moment_x_A_m2=123,moment_y_A_m2=-456,moment_z_up_A_m2=789)
    for zero in (False,True):
        if zero:
            for key in MOMENTS:p['sources'][0][key]=0
        r=calculate(p)
        for j,key in enumerate(MOMENTS):
            plus=copy.deepcopy(p);minus=copy.deepcopy(p);plus['sources'][0][key]+=1;minus['sources'][0][key]-=1
            a=calculate(plus)['fields'][0];b=calculate(minus)['fields'][0];derivative=r['sensitivities'][j]
            assert derivative['parameter']==key
            for field in (*VECTORS,'tmi_linear'):
                if field=='tmi_linear' and background is None:assert derivative['fields'][0][field] is None
                else:assert (a[field]-b[field])/2==pytest.approx(derivative['fields'][0][field],rel=2e-12,abs=1e-17)


@pytest.mark.parametrize('moment',[1e-8,1000,5e8,-5e8,-1e9])
@pytest.mark.parametrize('direction',['parallel','transverse','oblique'])
def test_exact_total_field_against_80_digit_arithmetic(moment,direction):
    p=request();p['sources'][0]['moment_z_up_A_m2']=moment
    if direction=='transverse':p['background_nT']={'x':50000,'y':0,'z_up':0}
    elif direction=='oblique':p['background_nT']={'x':20000,'y':10000,'z_up':40000}
    f=calculate(p)['fields'][0];background=[p['background_nT'][k] for k in ('x','y','z_up')];vector=[f[k] for k in ('bx','by','bz_up')]
    with mpmath.workdps(80):
        b=[mpmath.mpf(v) for v in background];v=[mpmath.mpf(x) for x in vector]
        exact=mpmath.sqrt(sum((a+x)**2 for a,x in zip(b,v)))-mpmath.sqrt(sum(x*x for x in b))
    assert f['tmi_exact']==pytest.approx(float(exact),rel=3e-13,abs=2e-11 if abs(float(exact))>1 else 1e-15)
    assert f['linearization_difference']==f['tmi_exact']-f['tmi_linear']
    if direction=='transverse' and moment==1e-8:
        assert f['tmi_linear']==0 and f['tmi_exact']>0
        assert math.hypot(*[a+x for a,x in zip(background,vector)])-math.hypot(*background)==0


def test_exact_total_field_applies_after_signed_vector_superposition():
    p=request();p['background_nT']={'x':50000,'y':0,'z_up':0};one=calculate(p)
    p['sources'].append(dict(p['sources'][0],id='second'));two=calculate(p)
    assert two['fields'][0]['tmi_exact']==pytest.approx(4*one['fields'][0]['tmi_exact'],rel=1e-10)
    assert two['fields'][0]['tmi_exact']!=pytest.approx(2*one['fields'][0]['tmi_exact'],rel=1e-6,abs=0)
    p['sources'][1]['moment_z_up_A_m2']*=-1;r=calculate(p)
    assert all(r['fields'][0][k]==0 for k in FIELDS)


def test_translation_rotation_signed_cancellation_and_no_sensitivity_mode():
    p=request();p['sources'][0].update(moment_x_A_m2=100,moment_y_A_m2=-200);p['points'][0].update(x_m=30,y_m=40)
    original=calculate(p)
    shifted=copy.deepcopy(p)
    for row in shifted['points']+shifted['sources']:
        for key,shift in zip(COORDS,[1e9,-2e9,3e9]):row[key]+=shift
    assert calculate(shifted)['fields']==original['fields']
    rotated=copy.deepcopy(p)
    for row in rotated['points']+rotated['sources']:row['x_m'],row['y_m']=-row['y_m'],row['x_m']
    for row in rotated['sources']:row['moment_x_A_m2'],row['moment_y_A_m2']=-row['moment_y_A_m2'],row['moment_x_A_m2']
    rotated['background_nT']['x'],rotated['background_nT']['y']=-rotated['background_nT']['y'],rotated['background_nT']['x']
    f=calculate(rotated)['fields'][0];expected=original['fields'][0]
    assert f['bx']==pytest.approx(-expected['by'],abs=1e-15) and f['by']==pytest.approx(expected['bx'],abs=1e-15)
    for key in ('bz_up','tmi_linear','tmi_exact'):assert f[key]==pytest.approx(expected[key],rel=1e-13)
    p=request();p['sources']=[dict(p['sources'][0],id=str(i),moment_z_up_A_m2=m) for i,m in enumerate([1e15,1e-10,-1e15])]
    small=calculate({**p,'sources':[p['sources'][1]]});r=calculate(p)
    assert r['fields']==small['fields']
    p['include_sensitivities']=False;assert calculate(p)['sensitivities']==[]


def negatives():
    cases=[]
    def add(path,value,state='rejected',code='contract'):
        p=request();v=p
        for key in path[:-1]:v=v[key]
        v[path[-1]]=value;cases.append((p,state,code))
    for key in ('schema','version','coordinate_frame','sources','points','include_sensitivities','background_nT','min_distance_m'):
        p=request();del p[key];cases.append((p,'needs_input','context'))
    add(['version'],True);add(['version'],2);add(['extra'],0);add(['coordinate_frame','units'],'ft');add(['coordinate_frame','axes'],'east_north_down')
    add(['coordinate_frame','height_datum'],None,'needs_input','context');add(['coordinate_frame','height_datum'],'unknown')
    for key in MOMENTS:
        p=request();del p['sources'][0][key];cases.append((p,'needs_input','context'))
        add(['sources',0,key],True);add(['sources',0,key],1e16)
    for value in (None,5,[],True,'dipole'):add(['sources',0],value)
    add(['sources',0,'kind'],'sphere');add(['points',0,'x_m'],True);add(['points',0,'z_m'],float('nan'));add(['points',0,'x_m'],'1');add(['points',0,'x_m'],10**400)
    add(['points',0,'id'],'\ud800');add(['points',0,'id'],'x'*129);add(['min_distance_m'],0);add(['min_distance_m'],None,'needs_input','context')
    add(['points',0,'z_m'],-100,'needs_input','context');add(['points',0,'x_m'],200001,'rejected','resource')
    add(['background_nT'],{} ,'needs_input','context');add(['background_nT'],{'x':0,'y':0,'z_up':0});add(['background_nT'],{'x':1e6,'y':1e6,'z_up':0});add(['background_nT','x'],True);add(['background_nT','z_up'],None,'needs_input','context')
    add(['metadata'],{'text':'x'*131073},'rejected','resource')
    for key in ('sources','points'):
        p=request();p[key]*=2;cases.append((p,'rejected','contract'))
    p=request();p['sources'][0].update(dict.fromkeys(MOMENTS,0));p['points'][0]['z_m']=-100;cases.append((p,'needs_input','context'))
    for key,count in (('points',4097),('sources',129)):
        p=request();p[key]=[dict(p[key][0],id=str(i)) for i in range(count)];cases.append((p,'rejected','resource'))
    p=request();p['points']=[dict(p['points'][0],id=str(i)) for i in range(4096)];p['sources']=[dict(p['sources'][0],id=str(i)) for i in range(2)];cases.append((p,'rejected','resource'))
    p=request();p['include_sensitivities']=False;p['points']=[dict(p['points'][0],id=str(i)) for i in range(4096)];p['sources']=[dict(p['sources'][0],id=str(i)) for i in range(65)];cases.append((p,'rejected','resource'))
    return cases


@pytest.mark.parametrize('p,state,code',negatives())
def test_atomic_validation_before_any_kernel(p,state,code,monkeypatch):
    def forbidden(*args):raise AssertionError('invalid request reached kernel')
    monkeypatch.setattr(baselode.geophysics.magnetic_forward,'_kernel',forbidden)
    r=baselode.geophysics.calculate_magnetic_forward(p)
    assert (r['state'],r['issues'][0]['code'])==(state,code),r
    assert r['fields']==[] and r['sensitivities']==[] and r['request'] is None
    jsonschema.validate(r,baselode.geophysics.describe_magnetic_forward()['result_schema'])


def test_full_sensitivity_budget_depth_boundary_unicode_and_positive_zero():
    p=request();p['points']=[dict(p['points'][0],id=str(i)) for i in range(4096)];p['sources'][0]['id']='磁気 🧲'
    nested=0
    for _ in range(31):nested={'nested':nested}
    p['metadata']=nested;r=calculate(p);assert len(r['fields'])==4096 and len(r['sensitivities'])==3
    for field in r['fields']+r['sensitivities'][0]['fields']:
        for key in VECTORS:
            if field[key]==0:assert math.copysign(1,field[key])==1
    p['metadata']={'nested':nested};r=baselode.geophysics.calculate_magnetic_forward(p)
    assert r['state']=='rejected' and r['fields']==[] and r['issues'][0]['code']=='resource'


def test_cyclic_json_and_injected_numerical_failure_are_atomic(monkeypatch):
    p=request();p['metadata']['cycle']=p
    r=baselode.geophysics.calculate_magnetic_forward(p);assert r['state']=='rejected' and r['fields']==[]
    def broken(*args):raise ArithmeticError('injected backend failure')
    monkeypatch.setattr(baselode.geophysics.magnetic_forward,'_kernel',broken)
    r=baselode.geophysics.calculate_magnetic_forward(request());assert r['state']=='failed' and r['sensitivities']==[] and r['fields']==[]


def test_live_native_python_js_positive_negative_descriptor_and_replay(tmp_path):
    p=request();p['sources'][0].update(moment_x_A_m2=123,moment_y_A_m2=-456);p['points']=[dict(p['points'][0],id=str(i),x_m=x,y_m=y,z_m=z) for i,(x,y,z) in enumerate([(0,0,0),(30,-40,50),(-500,200,-50)])]
    p['background_nT']={'x':20000,'y':-10000,'z_up':40000};cases=[]
    for value,_,_ in negatives():
        try:
            text=json.dumps(value,ensure_ascii=False,allow_nan=False);text.encode('utf-8')
        except (ValueError,UnicodeError):continue
        if value.get('points') and type(value['points'][0]['x_m']) is int and abs(value['points'][0]['x_m'])>1e100:continue
        cases.append(value)
    a=tmp_path/'input.json';b=tmp_path/'output.json';a.write_text(json.dumps({'request':p,'negative':cases}))
    subprocess.run(['node',str(ROOT/'test/data/magnetic_forward_parity.mjs'),str(a),str(b)],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True)
    js=json.loads(b.read_text());py=calculate(p);assert js['descriptor']==baselode.geophysics.describe_magnetic_forward()
    for other in (js['result'],calculate(js['result']['request'])):
        assert other['state']=='ok' and other['model']==py['model'] and other['request']==p and other['field_units']==py['field_units']
        for x,y in zip(other['fields'],py['fields']):
            for key in FIELDS:assert x[key]==pytest.approx(y[key],rel=3e-13,abs=1e-15)
        for x,y in zip(other['sensitivities'],py['sensitivities']):
            assert x['parameter']==y['parameter'] and x['field_units']==y['field_units']
            for f,g in zip(x['fields'],y['fields']):
                for key in (*VECTORS,'tmi_linear'):assert f[key]==pytest.approx(g[key],rel=3e-13,abs=1e-18)
    py_errors=[baselode.geophysics.calculate_magnetic_forward(v) for v in cases]
    assert js['negative']==[{'state':v['state'],'code':v['issues'][0]['code'],'fields':v['fields'],'sensitivities':v['sensitivities']} for v in py_errors]
