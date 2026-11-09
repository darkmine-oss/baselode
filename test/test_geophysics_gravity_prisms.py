# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent volume physics, boundary integrals and portable prism validation."""
import copy
import itertools
import json
import math
import pathlib
import subprocess
import warnings

import jsonschema
import numpy as np
import pytest

import baselode.geophysics
import baselode.geophysics.gravity_prisms

ROOT=pathlib.Path(__file__).resolve().parents[1]
G=6.67430e-11
COORDS=('x_m','y_m','z_m')
FIELDS=('gx','gy','gz_up','g_down','potential')


def request():
    return json.loads((ROOT/'test/data/gravity_prisms_example.json').read_text())


def calculate(p):
    r=baselode.geophysics.calculate_gravity_prisms(p)
    assert r['state']=='ok',r['issues']
    return r


def direct_volume(bounds,point,density,order=24):
    nodes,weights=np.polynomial.legendre.leggauss(order);axes=[];ws=[]
    for i in range(3):
        a,b=bounds[2*i:2*i+2];axes.append(a+(nodes+1)*(b-a)/2);ws.append(weights*(b-a)/2)
    xyz=np.stack(np.meshgrid(*axes,indexing='ij'),axis=-1)
    volume_weights=np.einsum('i,j,k->ijk',*ws)
    delta=xyz-np.array([point[k] for k in COORDS]);r=np.linalg.norm(delta,axis=-1)
    acceleration=G*density*np.sum(volume_weights[...,None]*delta/r[...,None]**3,axis=(0,1,2))*1e5
    potential=-G*density*np.sum(volume_weights/r)
    return dict(zip(FIELDS,[*acceleration,-acceleration[2],potential]))


def boundary_volume(bounds,point,density):
    # Split at the point into octants. Each box is three Duffy pyramids:
    # d=t*base(u,v), jac=volume*t^2. Integrate t analytically, 2D Gauss u/v.
    # No prism corner/log formula or evaluation of 1/0 is used.
    nodes,weights=np.polynomial.legendre.leggauss(48);u,v=np.meshgrid((nodes+1)/2,(nodes+1)/2,indexing='ij');w=weights[:,None]*weights[None,:]/4
    pieces=[]
    for i,k in enumerate(COORDS):
        lo,hi=bounds[2*i:2*i+2];x=point[k];assert lo<=x<=hi
        pieces.append([(x-lo,-1),(hi-x,1)])
    acceleration=np.zeros(3);potential=0
    for orthant in itertools.product(*pieces):
        lengths=np.array([p[0] for p in orthant]);signs=np.array([p[1] for p in orthant]);volume=np.prod(lengths)
        if volume==0:continue
        for main in range(3):
            factors=[None]*3;factors[main]=np.ones(u.shape);others=[j for j in range(3) if j!=main];factors[others[0]]=u;factors[others[1]]=v
            base=np.stack(factors,axis=-1)*lengths*signs;r=np.linalg.norm(base,axis=-1)
            potential+=volume/2*np.sum(w/r)
            acceleration+=volume*np.sum(w[...,None]*base/r[...,None]**3,axis=(0,1))
    acceleration*=G*density*1e5;potential*=-G*density
    return dict(zip(FIELDS,[*acceleration,-acceleration[2],potential]))


def test_contract_example_native_validation_and_independent_cube_centre():
    p=request();before=copy.deepcopy(p);d=baselode.geophysics.describe_gravity_prisms();v=baselode.geophysics.validate_gravity_prisms(p);r=calculate(p)
    assert v['state']=='ok' and v['request']==p
    jsonschema.validate(p,d['request_schema']);jsonschema.validate(v,d['validation_schema']);jsonschema.validate(r,d['result_schema'])
    c=24*math.log((1+math.sqrt(3))/math.sqrt(2))-2*math.pi
    assert r['fields'][1]['potential']==pytest.approx(-G*2000*50**2*c,rel=2e-15)
    assert all(r['fields'][1][k]==0 for k in FIELDS[:-1]);assert r['fields'][0]['g_down']>0 and r['fields'][0]['potential']<0
    assert r['sensitivities'][0]['field_units']['g_down']=='(mGal)/(kg/m^3)'
    assert r['model']['kernel_backend_version']=='0.3.2' and p==before
    assert calculate(r['request'])['fields']==r['fields']
    r['request']['sources'][0]['density_contrast_kg_m3']=0;d['resources'].clear();assert calculate(p)['fields'][0]['g_down']>0
    assert baselode.geophysics.describe_gravity_prisms()['resources']['max_sources']==64
    assert (ROOT/'python/src/baselode/geophysics/geophysics_gravity_prisms.json').read_bytes()==(ROOT/'javascript/packages/baselode/src/data/geophysics_gravity_prisms.json').read_bytes()


@pytest.mark.parametrize('xyz',[[0,0,0],[80,-70,-20],[-120,30,100]])
def test_exterior_newtonian_volume_integral(xyz):
    p=request();p['points']=[dict(zip(('id',*COORDS),['external',*xyz]))];r=calculate(p)['fields'][0]
    expected=direct_volume(p['sources'][0]['bounds_m'],p['points'][0],2000)
    for key in FIELDS:assert r[key]==pytest.approx(expected[key],rel=2e-11,abs=1e-14)


@pytest.mark.parametrize('xyz',[[0,0,-100],[17,-11,-90],[50,0,-100],[50,50,-100],[50,50,-50],[-50,-50,-150]])
def test_independent_singularity_free_boundary_interior_integral(xyz):
    p=request();p['points']=[dict(zip(('id',*COORDS),['boundary',*xyz]))];r=calculate(p)['fields'][0]
    expected=boundary_volume(p['sources'][0]['bounds_m'],p['points'][0],2000)
    for key in FIELDS:assert r[key]==pytest.approx(expected[key],rel=2e-12,abs=1e-13)
    if xyz==[50,50,-50]:
        factor=2*math.log(1+math.sqrt(2))-2*math.log((1+math.sqrt(3))/math.sqrt(2))+math.pi/6
        assert r['gx']==pytest.approx(-G*2000*100*factor*1e5,rel=1e-14)


@pytest.mark.parametrize('bounds,xyz',[[[-.5,.5,-.5,.5,-.5,.5],[20,20,20]],[[-.5,.5,-10,10,-.5,.5],[20,-20,20]]])
def test_worst_supported_conditioning_against_volume_integral(bounds,xyz):
    p=request();p['sources'][0]['bounds_m']=bounds;p['points']=[dict(zip(('id',*COORDS),['limit',*xyz]))]
    r=calculate(p);assert r['diagnostics']['max_point_offset_to_min_dimension']==20
    expected=direct_volume(bounds,p['points'][0],2000,32)
    for key in FIELDS:assert r['fields'][0][key]==pytest.approx(expected[key],rel=2e-9,abs=1e-16)


@pytest.mark.parametrize('density',[-2000,0,2000])
def test_density_sensitivity_fixed_geometry_and_potential_gradient(density):
    p=request();p['sources'][0]['density_contrast_kg_m3']=density;p['points']=[{'id':'p','x_m':17,'y_m':-11,'z_m':30}];r=calculate(p)
    plus=copy.deepcopy(p);minus=copy.deepcopy(p);plus['sources'][0]['density_contrast_kg_m3']+=1;minus['sources'][0]['density_contrast_kg_m3']-=1
    a,b=calculate(plus)['fields'][0],calculate(minus)['fields'][0]
    for key in FIELDS:
        derivative=r['sensitivities'][0]['fields'][0][key]
        assert r['fields'][0][key]==pytest.approx(derivative*density,abs=1e-15)
        assert (a[key]-b[key])/2==pytest.approx(derivative,rel=5e-12,abs=1e-17)
    for axis,key in zip(COORDS,('gx','gy','gz_up')):
        a=copy.deepcopy(p);b=copy.deepcopy(p);a['points'][0][axis]-=.01;b['points'][0][axis]+=.01
        expected=-(calculate(b)['fields'][0]['potential']-calculate(a)['fields'][0]['potential'])/.02*1e5
        assert r['fields'][0][key]==pytest.approx(expected,rel=2e-7,abs=1e-12)


def test_partition_additivity_translation_rotation_cancellation_and_source_zero():
    p=request();whole=calculate(p);parts=copy.deepcopy(p);parts['sources']=[{**p['sources'][0],'id':'left','bounds_m':[-50,0,-50,50,-150,-50]},{**p['sources'][0],'id':'right','bounds_m':[0,50,-50,50,-150,-50]}]
    split=calculate(parts)
    for a,b in zip(whole['fields'],split['fields']):
        for k in FIELDS:assert a[k]==pytest.approx(b[k],rel=1e-13,abs=1e-14)
    translated=copy.deepcopy(p)
    for row in translated['points']:
        for k,shift in zip(COORDS,[1e12-1000,-1e12+1000,1e9]):row[k]+=shift
    for row in translated['sources']:
        row['bounds_m']=[v+[1e12-1000,1e12-1000,-1e12+1000,-1e12+1000,1e9,1e9][i] for i,v in enumerate(row['bounds_m'])]
    assert calculate(translated)['fields']==whole['fields']
    p['sources']=[{**p['sources'][0],'id':str(i),'density_contrast_kg_m3':rho} for i,rho in enumerate([100000,1e-12,-100000])]
    assert calculate(p)['fields']==calculate({**p,'sources':[p['sources'][1]]})['fields']
    p['include_sensitivities']=False;assert calculate(p)['sensitivities']==[]


def negatives():
    cases=[]
    def add(path,value,state='rejected',code='contract'):
        p=request();d=p
        for k in path[:-1]:d=d[k]
        d[path[-1]]=value;cases.append((p,state,code))
    for key in ('schema','version','coordinate_frame','sources','points','include_sensitivities'):
        p=request();del p[key];cases.append((p,'needs_input','context'))
    add(['version'],True);add(['version'],2);add(['extra'],0);add(['coordinate_frame','units'],'ft');add(['coordinate_frame','axes'],'x_y_down');add(['coordinate_frame','height_datum'],None,'needs_input','context');add(['coordinate_frame','id'],'unknown')
    for v in (None,1,[],True,'prism'):add(['sources',0],v)
    add(['sources',0,'kind'],'point_mass');add(['sources',0,'bounds_m'],[1,2,3]);add(['sources',0,'bounds_m'],[1,1,0,1,0,1]);add(['sources',0,'bounds_m'],[1,0,0,1,0,1]);add(['sources',0,'bounds_m'],[0,.0001,0,1,0,1]);add(['sources',0,'bounds_m'],[0,100001,0,1,0,1]);add(['sources',0,'density_contrast_kg_m3'],True);add(['sources',0,'density_contrast_kg_m3'],100001)
    add(['sources',0,'bounds_m'],[0,1,0,21,0,1],'needs_input','context');add(['points',0,'z_m'],1951,'needs_input','context');add(['points',0,'z_m'],200001,'rejected','resource')
    add(['points',0,'x_m'],True);add(['points',0,'x_m'],float('inf'));add(['points',0,'x_m'],10**400);add(['points',0,'id'],'\ud800');add(['points',0,'id'],'x'*129);add(['metadata'],{'text':'x'*131073},'rejected','resource')
    for key in ('sources','points'):
        p=request();p[key]*=2;cases.append((p,'rejected','contract'))
    for key,count in (('sources',65),('points',1025)):
        p=request();p[key]=[dict(p[key][0],id=str(i)) for i in range(count)];cases.append((p,'rejected','resource'))
    for sensitive,count in ((True,5),(False,33)):
        p=request();p['include_sensitivities']=sensitive;p['sources']=[dict(p['sources'][0],id=str(i)) for i in range(count)];p['points']=[dict(p['points'][0],id=str(i)) for i in range(1024)];cases.append((p,'rejected','resource'))
    return cases


@pytest.mark.parametrize('p,state,code',negatives())
def test_identical_atomic_validation_and_calculation_before_kernels(p,state,code,monkeypatch):
    def forbidden(*args):raise AssertionError('invalid request reached backend')
    monkeypatch.setattr(baselode.geophysics.gravity_prisms,'_backend_fields',forbidden)
    for function in (baselode.geophysics.validate_gravity_prisms,baselode.geophysics.calculate_gravity_prisms):
        r=function(p);assert (r['state'],r['issues'][0]['code'])==(state,code),r
        assert r['request'] is None and r.get('fields',[])==[] and r.get('sensitivities',[])==[]


@pytest.mark.parametrize('bad',[np.array([0.]),np.zeros((2,2)),np.array([float('nan'),0]),np.zeros(2,dtype='float32'),np.array([1j,0])])
def test_malformed_backend_failure_is_atomic(bad,monkeypatch):
    monkeypatch.setattr(baselode.geophysics.gravity_prisms._harmonica,'prism_gravity',lambda *args,**kwargs:bad)
    r=baselode.geophysics.calculate_gravity_prisms(request());assert r['state']=='failed' and r['issues'][0]['code']=='backend' and r['fields']==[] and r['sensitivities']==[] and r['request'] is None


def test_backend_versions_constants_and_warnings_fail_clearly(monkeypatch):
    actual=baselode.geophysics.gravity_prisms.importlib.metadata.version
    monkeypatch.setattr(baselode.geophysics.gravity_prisms.importlib.metadata,'version',lambda name:'0.4.0' if name=='choclo' else actual(name))
    assert baselode.geophysics.calculate_gravity_prisms(request())['state']=='failed'
    monkeypatch.setattr(baselode.geophysics.gravity_prisms.importlib.metadata,'version',actual)
    def noisy(*args,**kwargs):warnings.warn('injected warning',RuntimeWarning)
    monkeypatch.setattr(baselode.geophysics.gravity_prisms._harmonica,'prism_gravity',noisy)
    r=baselode.geophysics.calculate_gravity_prisms(request());assert r['state']=='failed' and r['fields']==[]


def test_core_validation_survives_missing_extra_and_limits_depth_cycles(monkeypatch):
    monkeypatch.setattr(baselode.geophysics.gravity_prisms,'_harmonica',None)
    assert baselode.geophysics.validate_gravity_prisms(request())['state']=='ok'
    with pytest.raises(ImportError,match=r'baselode\[potential-fields\]'):baselode.geophysics.calculate_gravity_prisms(request())
    p=request();nested=0
    for _ in range(31):nested={'nested':nested}
    p['metadata']=nested;assert baselode.geophysics.validate_gravity_prisms(p)['state']=='ok'
    p['metadata']={'nested':nested};assert baselode.geophysics.validate_gravity_prisms(p)['state']=='rejected'
    p=request();p['metadata']['cycle']=p;assert baselode.geophysics.validate_gravity_prisms(p)['state']=='rejected'


def test_live_python_js_contract_validation_and_backend_replay(tmp_path):
    p=request();p['sources'][0]['id']='重力 🪨';cases=[]
    for value,_,_ in negatives():
        try:text=json.dumps(value,ensure_ascii=False,allow_nan=False);text.encode('utf-8')
        except (ValueError,UnicodeError):continue
        if value.get('points') and type(value['points'][0]['x_m']) is int and abs(value['points'][0]['x_m'])>1e100:continue
        cases.append(value)
    a=tmp_path/'in.json';b=tmp_path/'out.json';a.write_text(json.dumps({'request':p,'negative':cases}))
    subprocess.run(['node',str(ROOT/'test/data/gravity_prisms_parity.mjs'),str(a),str(b)],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True)
    js=json.loads(b.read_text());py=baselode.geophysics.validate_gravity_prisms(p)
    assert js['descriptor']==baselode.geophysics.describe_gravity_prisms() and js['result']['request']==p and js['result']['diagnostics']==py['diagnostics']
    assert calculate(js['result']['request'])['fields']==calculate(p)['fields']
    expected=[baselode.geophysics.validate_gravity_prisms(v) for v in cases]
    assert js['negative']==[{'state':v['state'],'code':v['issues'][0]['code'],'request':v['request']} for v in expected]


def test_rotated_rectangular_body_preserves_vector_and_potential():
    p=request();p['sources'][0]['bounds_m']=[-50,50,-100,100,-150,-50];p['points']=[{'id':'p','x_m':30,'y_m':-60,'z_m':10}]
    original=calculate(p)['fields'][0];p['sources'][0]['bounds_m']=[-100,100,-50,50,-150,-50];p['points'][0].update(x_m=60,y_m=30)
    rotated=calculate(p)['fields'][0]
    assert rotated['gx']==pytest.approx(-original['gy'],rel=1e-12,abs=1e-14)
    assert rotated['gy']==pytest.approx(original['gx'],rel=1e-12,abs=1e-14)
    for key in ('gz_up','g_down','potential'):assert rotated[key]==pytest.approx(original[key],rel=1e-12,abs=1e-14)


@pytest.mark.parametrize('missing',['harmonica','choclo'])
def test_importable_backend_without_distribution_metadata_fails_atomically(missing,monkeypatch):
    actual=baselode.geophysics.gravity_prisms.importlib.metadata.version
    def missing_metadata(name):
        if name==missing:
            raise baselode.geophysics.gravity_prisms.importlib.metadata.PackageNotFoundError(name)
        return actual(name)
    monkeypatch.setattr(baselode.geophysics.gravity_prisms.importlib.metadata,'version',missing_metadata)
    r=baselode.geophysics.calculate_gravity_prisms(request())
    assert r['state']=='failed' and r['issues'][0]['code']=='backend'
    assert 'distribution metadata' in r['issues'][0]['message'] and missing in r['issues'][0]['message']
    assert r['fields']==[] and r['sensitivities']==[] and r['request'] is None
