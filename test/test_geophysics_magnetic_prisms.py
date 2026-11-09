# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent dipole-volume physics, analytical cube field and backend guards."""
import copy
import json
import math
import pathlib
import subprocess
import warnings

import jsonschema
import mpmath
import numpy as np
import pytest

import baselode.geophysics
import baselode.geophysics.magnetic_prisms

ROOT=pathlib.Path(__file__).resolve().parents[1]
MU0=1.25663706127e-6
COORDS=('x_m','y_m','z_m')
PARAMETERS=('magnetization_x_A_m','magnetization_y_A_m','magnetization_z_up_A_m')
VECTOR=('bx','by','bz_up','b_down')
FIELDS=(*VECTOR,'tmi_linear','tmi_exact','linearization_difference')


def request():return json.loads((ROOT/'test/data/magnetic_prisms_example.json').read_text())


def calculate(p):
    r=baselode.geophysics.calculate_magnetic_prisms(p)
    assert r['state']=='ok',r['issues']
    return r


def volume_reference(source,point,order=32):
    # Independent distributed point-dipole integral in uniformly magnetised volume.
    nodes,weights=np.polynomial.legendre.leggauss(order);axes=[];ws=[]
    for i in range(3):
        a,b=source['bounds_m'][2*i:2*i+2];axes.append(a+(nodes+1)*(b-a)/2);ws.append(weights*(b-a)/2)
    xyz=np.stack(np.meshgrid(*axes,indexing='ij'),axis=-1);w=np.einsum('i,j,k->ijk',*ws)
    delta=np.array([point[k] for k in COORDS])-xyz;r=np.linalg.norm(delta,axis=-1);j=np.array([source[k] for k in PARAMETERS]);dot=np.sum(delta*j,axis=-1)
    kernel=3*delta*dot[...,None]/r[...,None]**5-j/r[...,None]**3
    return MU0/(4*math.pi)*1e9*np.sum(w[...,None]*kernel,axis=(0,1,2))


def axis_coefficient(height=0):
    # Magnetic surface charge on top/bottom square faces; rectangle solid angles.
    a=50;top=height+50;bottom=height+150
    def solid_angle(d):return 4*math.atan(a*a/(d*math.sqrt(d*d+2*a*a)))
    return MU0/(4*math.pi)*1e9*(solid_angle(top)-solid_angle(bottom))


def test_portable_example_analytical_cube_sign_constants_and_snapshots():
    p=request();before=copy.deepcopy(p);v=baselode.geophysics.validate_magnetic_prisms(p);r=calculate(p);d=baselode.geophysics.describe_magnetic_prisms()
    assert v['state']=='ok' and v['request']==p and p==before
    assert r['fields'][0]['bz_up']==pytest.approx(axis_coefficient(),rel=1e-14)
    assert r['fields'][0]['bx']==0 and r['fields'][0]['by']==0 and r['fields'][0]['b_down']==-r['fields'][0]['bz_up']
    assert r['model']['backend_vacuum_magnetic_permeability']==1.25663706212e-6 and r['model']['vacuum_magnetic_permeability']==MU0
    assert r['model']['backend_to_target_scale']==MU0/1.25663706212e-6
    assert len(r['sensitivities'])==3 and r['sensitivities'][0]['field_units']['bx']=='nT/(A/m)'
    assert all('tmi_exact' not in s['fields'][0] for s in r['sensitivities'])
    for value,schema in ((p,d['request_schema']),(v,d['validation_schema']),(r,d['result_schema'])):jsonschema.validate(value,schema)
    assert calculate(r['request'])['fields']==r['fields']
    r['request']['sources'][0]['magnetization_z_up_A_m']=0;d['resources'].clear();assert calculate(p)['fields'][0]['bz_up']>0
    assert baselode.geophysics.describe_magnetic_prisms()['resources']['max_sources']==64
    assert (ROOT/'python/src/baselode/geophysics/geophysics_magnetic_prisms.json').read_bytes()==(ROOT/'javascript/packages/baselode/src/data/geophysics_magnetic_prisms.json').read_bytes()


@pytest.mark.parametrize('j',[[0,0,1],[1,2,-3],[-.7,.4,1.2]])
@pytest.mark.parametrize('xyz',[[0,0,0],[80,-70,-20],[-120,30,100]])
def test_independent_distributed_dipole_volume_integral(j,xyz):
    p=request();p['sources'][0].update(dict(zip(PARAMETERS,j)));p['points']=[dict(zip(('id',*COORDS),['external',*xyz]))]
    r=calculate(p)['fields'][0];expected=volume_reference(p['sources'][0],p['points'][0])
    np.testing.assert_allclose([r[k] for k in VECTOR[:3]],expected,rtol=2e-11,atol=2e-12)


@pytest.mark.parametrize('axis',[0,1,2])
@pytest.mark.parametrize('sign',[-1,1])
def test_independent_cube_axis_tensor_symmetry_and_signed_magnetisation(axis,sign):
    p=request();p['sources'][0].update(dict.fromkeys(PARAMETERS,0));p['sources'][0][PARAMETERS[axis]]=sign
    r=calculate(p)['fields'][0];expected=sign*axis_coefficient()*(1 if axis==2 else -.5)
    for i,k in enumerate(VECTOR[:3]):assert r[k]==pytest.approx(expected if i==axis else 0,abs=2e-13)


def test_rectangular_prism_converges_to_dipole_response_at_fixed_magnetisation():
    errors=[]
    for length in (10,5,2.5):
        p=request();p['sources'][0]['bounds_m']=[-length/2,length/2,-length,length,-length/2,length/2];p['sources'][0].update(dict(zip(PARAMETERS,[1,2,-3])));p['points']=[{'id':'p','x_m':10,'y_m':-20,'z_m':40}];p['background_nT']=None
        body=calculate(p)['fields'][0];volume=2*length**3
        dipole=json.loads((ROOT/'test/data/magnetic_forward_example.json').read_text());dipole['sources']=[{'id':'dipole','kind':'dipole','x_m':0,'y_m':0,'z_m':0,'moment_x_A_m2':volume,'moment_y_A_m2':2*volume,'moment_z_up_A_m2':-3*volume}];dipole['points']=p['points'];dipole['background_nT']=None
        result=baselode.geophysics.calculate_magnetic_forward(dipole);assert result['state']=='ok'
        a=np.array([body[k] for k in VECTOR[:3]]);b=np.array([result['fields'][0][k] for k in VECTOR[:3]]);errors.append(np.linalg.norm(a-b)/np.linalg.norm(b))
    assert errors[0]/errors[1]==pytest.approx(4,rel=.03) and errors[1]/errors[2]==pytest.approx(4,rel=.03)
    assert errors[-1]<.002


@pytest.mark.parametrize('background',[None,{'x':20000,'y':-10000,'z_up':40000}])
def test_fixed_geometry_magnetisation_columns_match_finite_differences(background):
    p=request();p['background_nT']=background;p['sources'][0].update(dict(zip(PARAMETERS,[.4,-.7,1.2])))
    for zero in (False,True):
        if zero:p['sources'][0].update(dict.fromkeys(PARAMETERS,0))
        r=calculate(p)
        for j,key in enumerate(PARAMETERS):
            plus=copy.deepcopy(p);minus=copy.deepcopy(p);plus['sources'][0][key]+=1;minus['sources'][0][key]-=1
            a,b=calculate(plus)['fields'][0],calculate(minus)['fields'][0]
            for k in (*VECTOR,'tmi_linear'):
                if k=='tmi_linear' and background is None:assert r['sensitivities'][j]['fields'][0][k] is None
                else:assert (a[k]-b[k])/2==pytest.approx(r['sensitivities'][j]['fields'][0][k],rel=2e-13,abs=2e-13)


@pytest.mark.parametrize('amplitude',[1e-8,1,-100000/axis_coefficient()])
@pytest.mark.parametrize('transverse',[False,True])
def test_exact_tmi_high_precision_weak_and_reversing_fields(amplitude,transverse):
    p=request();p['sources'][0]['magnetization_z_up_A_m']=amplitude
    if transverse:p['background_nT']={'x':50000,'y':0,'z_up':0}
    f=calculate(p)['fields'][0]
    with mpmath.workdps(80):
        b=[mpmath.mpf(p['background_nT'][k]) for k in ('x','y','z_up')];v=[mpmath.mpf(f[k]) for k in VECTOR[:3]]
        expected=mpmath.sqrt(sum((x+y)**2 for x,y in zip(b,v)))-mpmath.sqrt(sum(x*x for x in b))
    assert f['tmi_exact']==pytest.approx(float(expected),rel=3e-13,abs=1e-15 if abs(float(expected))<1 else 2e-11)
    if transverse and amplitude==1e-8:assert f['tmi_linear']==0 and f['tmi_exact']>0


def test_superposition_is_vector_linear_but_exact_tmi_is_not_additive():
    p=request();p['background_nT']={'x':50000,'y':0,'z_up':0};one=calculate(p)['fields'][0]
    p['sources'].append(dict(p['sources'][0],id='second'));two=calculate(p)['fields'][0]
    assert two['bz_up']==pytest.approx(2*one['bz_up'])
    assert two['tmi_exact']!=pytest.approx(2*one['tmi_exact'],rel=1e-4)
    p['sources'][1]['magnetization_z_up_A_m']=-1;r=calculate(p)['fields'][0]
    assert all(r[k]==0 and math.copysign(1,r[k])==1 for k in FIELDS)


def test_partition_rotation_translation_and_compensated_cancellation():
    p=request();p['points'][0].update(x_m=30,y_m=-60,z_m=10);p['sources'][0].update(dict(zip(PARAMETERS,[.4,-.7,1.2])));whole=calculate(p)['fields'][0]
    parts=copy.deepcopy(p);parts['sources']=[dict(p['sources'][0],id='left',bounds_m=[-50,0,-50,50,-150,-50]),dict(p['sources'][0],id='right',bounds_m=[0,50,-50,50,-150,-50])]
    for k in FIELDS:assert calculate(parts)['fields'][0][k]==pytest.approx(whole[k],rel=3e-12,abs=1e-12)
    shifted=copy.deepcopy(p)
    for point in shifted['points']:
        for k,s in zip(COORDS,[1e12-1000,-1e12+1000,1e9]):point[k]+=s
    for source in shifted['sources']:
        source['bounds_m']=[v+[1e12-1000,1e12-1000,-1e12+1000,-1e12+1000,1e9,1e9][i] for i,v in enumerate(source['bounds_m'])]
    assert calculate(shifted)['fields'][0]==whole
    rotated=copy.deepcopy(p);rotated['points'][0].update(x_m=60,y_m=30)
    for source in rotated['sources']:source['magnetization_x_A_m'],source['magnetization_y_A_m']=-source['magnetization_y_A_m'],source['magnetization_x_A_m']
    r=calculate(rotated)['fields'][0];assert r['bx']==pytest.approx(-whole['by'],abs=1e-12) and r['by']==pytest.approx(whole['bx'],abs=1e-12)
    for k in ('bz_up','tmi_linear','tmi_exact'):assert r[k]==pytest.approx(whole[k],rel=3e-12,abs=1e-12)
    p=request();p['sources']=[dict(p['sources'][0],id=str(i),magnetization_z_up_A_m=v) for i,v in enumerate([1000,1e-12,-1000])]
    assert calculate(p)['fields']==calculate({**p,'sources':[p['sources'][1]]})['fields']


def negatives():
    cases=[]
    def add(path,value,state='rejected',code='contract'):
        p=request();target=p
        for k in path[:-1]:target=target[k]
        target[path[-1]]=value;cases.append((p,state,code))
    for key in ('schema','version','coordinate_frame','sources','points','include_sensitivities','background_nT','min_distance_m'):
        p=request();del p[key];cases.append((p,'needs_input','context'))
    add(['version'],True);add(['extra'],0);add(['coordinate_frame','units'],'ft');add(['coordinate_frame','height_datum'],None,'needs_input','context')
    for key in PARAMETERS:
        p=request();del p['sources'][0][key];cases.append((p,'needs_input','context'))
        add(['sources',0,key],True);add(['sources',0,key],1001)
    for value in (None,3,[],True):add(['sources',0],value)
    add(['sources',0,'density_contrast_kg_m3'],2000);add(['sources',0,'kind'],'dipole');add(['sources',0,'bounds_m'],[0,0,0,1,0,1]);add(['sources',0,'bounds_m'],[0,1,0,21,0,1],'needs_input','context')
    for xyz in ([0,0,-100],[50,0,-100],[50,50,-100],[50,50,-50],[50.5,0,-100]):
        p=request();p['points']=[dict(zip(('id',*COORDS),['excluded',*xyz]))];cases.append((p,'needs_input','context'))
    p=request();p['sources'][0].update(dict.fromkeys(PARAMETERS,0));p['points'][0]['z_m']=-100;cases.append((p,'needs_input','context'))
    add(['min_distance_m'],0);add(['min_distance_m'],None,'needs_input','context');add(['background_nT'],{},'needs_input','context');add(['background_nT'],{'x':0,'y':0,'z_up':0});add(['background_nT','x'],True);add(['background_nT','z_up'],None,'needs_input','context');add(['points',0,'x_m'],True);add(['points',0,'x_m'],float('inf'));add(['points',0,'x_m'],10**400);add(['points',0,'id'],'\ud800');add(['points',0,'z_m'],1951,'needs_input','context');add(['points',0,'z_m'],200001,'rejected','resource');add(['metadata'],{'text':'x'*131073},'rejected','resource')
    for key in ('sources','points'):
        p=request();p[key]*=2;cases.append((p,'rejected','contract'))
    for key,count in (('sources',65),('points',1025)):
        p=request();p[key]=[dict(p[key][0],id=str(i)) for i in range(count)];cases.append((p,'rejected','resource'))
    for sensitive,count in ((True,3),(False,33)):
        p=request();p['include_sensitivities']=sensitive;p['points']=[dict(p['points'][0],id=str(i)) for i in range(1024)];p['sources']=[dict(p['sources'][0],id=str(i)) for i in range(count)];cases.append((p,'rejected','resource'))
    return cases


@pytest.mark.parametrize('p,state,code',negatives())
def test_atomic_native_validation_and_calculation_before_kernels(p,state,code,monkeypatch):
    def forbidden(*args):raise AssertionError('invalid request reached backend')
    monkeypatch.setattr(baselode.geophysics.magnetic_prisms,'_backend_basis',forbidden)
    for function in (baselode.geophysics.validate_magnetic_prisms,baselode.geophysics.calculate_magnetic_prisms):
        r=function(p);assert (r['state'],r['issues'][0]['code'])==(state,code),r
        assert r['request'] is None and r.get('fields',[])==[] and r.get('sensitivities',[])==[]


@pytest.mark.parametrize('bad',[None,np.zeros((3,1)),(np.array([0.]),)*2,(np.array([float('nan')]),)*3,(np.zeros(1,dtype='float32'),)*3,(np.zeros(2),)*3])
def test_malformed_backend_response_fails_atomically(bad,monkeypatch):
    monkeypatch.setattr(baselode.geophysics.magnetic_prisms._harmonica,'prism_magnetic',lambda *a,**k:bad)
    r=baselode.geophysics.calculate_magnetic_prisms(request());assert r['state']=='failed' and r['issues'][0]['code']=='backend' and r['fields']==[] and r['sensitivities']==[] and r['request'] is None


@pytest.mark.parametrize('missing',['harmonica','choclo'])
def test_missing_distribution_metadata_is_structured_failure(missing,monkeypatch):
    module=baselode.geophysics.magnetic_prisms;actual=module.importlib.metadata.version
    def metadata(name):
        if name==missing:raise module.importlib.metadata.PackageNotFoundError(name)
        return actual(name)
    monkeypatch.setattr(module.importlib.metadata,'version',metadata)
    r=baselode.geophysics.calculate_magnetic_prisms(request());assert r['state']=='failed' and r['fields']==[] and r['request'] is None


def test_backend_version_permeability_and_warning_gates(monkeypatch):
    module=baselode.geophysics.magnetic_prisms;actual=module.importlib.metadata.version
    monkeypatch.setattr(module.importlib.metadata,'version',lambda name:'0.4.0' if name=='choclo' else actual(name));assert baselode.geophysics.calculate_magnetic_prisms(request())['state']=='failed';monkeypatch.setattr(module.importlib.metadata,'version',actual)
    original=module._choclo.constants.VACUUM_MAGNETIC_PERMEABILITY;monkeypatch.setattr(module._choclo.constants,'VACUUM_MAGNETIC_PERMEABILITY',1e-6);assert baselode.geophysics.calculate_magnetic_prisms(request())['state']=='failed';monkeypatch.setattr(module._choclo.constants,'VACUUM_MAGNETIC_PERMEABILITY',original)
    def noisy(*a,**k):warnings.warn('injected backend warning',RuntimeWarning)
    monkeypatch.setattr(module._harmonica,'prism_magnetic',noisy);r=baselode.geophysics.calculate_magnetic_prisms(request());assert r['state']=='failed' and r['fields']==[]


def test_core_only_depth_unicode_distance_boundary_and_full_sensitivity_budget(monkeypatch):
    p=request();p['points'][0]['z_m']=-49;p['sources'][0]['id']='磁気 🪨';p['points']=[dict(p['points'][0],id=str(i)) for i in range(1024)];p['sources']=[dict(p['sources'][0],id=str(i)) for i in range(2)];nested=0
    for _ in range(31):nested={'nested':nested}
    p['metadata']=nested;r=calculate(p);assert r['diagnostics']['min_point_to_prism_distance_m']==1 and len(r['sensitivities'])==6 and len(r['fields'])==1024
    p['metadata']={'nested':nested};assert baselode.geophysics.validate_magnetic_prisms(p)['state']=='rejected'
    monkeypatch.setattr(baselode.geophysics.magnetic_prisms,'_harmonica',None);assert baselode.geophysics.validate_magnetic_prisms(request())['state']=='ok'
    with pytest.raises(ImportError,match=r'baselode\[potential-fields\]'):baselode.geophysics.calculate_magnetic_prisms(request())
    p=request();p['metadata']['cycle']=p;assert baselode.geophysics.validate_magnetic_prisms(p)['state']=='rejected'


def test_live_python_js_request_validation_and_backend_replay(tmp_path):
    p=request();cases=[]
    for value,_,_ in negatives():
        try:text=json.dumps(value,ensure_ascii=False,allow_nan=False);text.encode('utf-8')
        except (ValueError,UnicodeError):continue
        if value.get('points') and type(value['points'][0]['x_m']) is int and abs(value['points'][0]['x_m'])>1e100:continue
        cases.append(value)
    a=tmp_path/'in.json';b=tmp_path/'out.json';a.write_text(json.dumps({'request':p,'negative':cases}))
    subprocess.run(['node',str(ROOT/'test/data/magnetic_prisms_parity.mjs'),str(a),str(b)],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True)
    js=json.loads(b.read_text());py=baselode.geophysics.validate_magnetic_prisms(p)
    assert js['descriptor']==baselode.geophysics.describe_magnetic_prisms() and js['result']['request']==p and js['result']['diagnostics']==py['diagnostics']
    assert calculate(js['result']['request'])['fields']==calculate(p)['fields']
    expected=[baselode.geophysics.validate_magnetic_prisms(v) for v in cases];assert js['negative']==[{'state':v['state'],'code':v['issues'][0]['code'],'request':v['request']} for v in expected]


@pytest.mark.parametrize('bounds', [[-.5,.5,-.5,.5,-.5,.5],[-.5,.5,-10,10,-.5,.5]])
def test_worst_supported_magnetic_conditioning_against_independent_volume(bounds):
    p=request();p['sources'][0]['bounds_m']=bounds;p['sources'][0].update(dict(zip(PARAMETERS,[.4,-.7,1.2])));p['points']=[{'id':'limit','x_m':20,'y_m':-20,'z_m':20}];p['background_nT']=None
    r=calculate(p);assert r['diagnostics']['max_point_offset_to_min_dimension']==20
    expected=volume_reference(p['sources'][0],p['points'][0]);np.testing.assert_allclose([r['fields'][0][k] for k in VECTOR[:3]],expected,rtol=2e-9,atol=1e-14)
