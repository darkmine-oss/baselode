# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent residual/coverage/sigma arithmetic and native request replay."""
import copy,json,math,pathlib,subprocess
import jsonschema
import pytest
import baselode.geophysics
ROOT=pathlib.Path(__file__).resolve().parents[1]

def request():return json.loads((ROOT/'test/data/misfit_example.json').read_text())
def run(p):
    r=baselode.geophysics.calculate_misfit(p);assert r['state']=='ok',r['issues'];return r

def test_independent_example_statistics_groups_sign_immutable_and_schema():
    p=request();before=copy.deepcopy(p);r=run(p);s=r['summary']['statistics'];assert [x['residual'] for x in r['rows']]==[1,2,-4]
    assert s==pytest.approx({'count':3,'bias':-1/3,'mae':7/3,'rmse':math.sqrt(7),'max_abs':4,'sse':21,'chi_squared':3,'normalized_rmse':1})
    assert [g['statistics']['bias'] for g in r['groups']]==[1.5,-4]
    d=baselode.geophysics.describe_misfit();jsonschema.validate(p,d['request_schema']);jsonschema.validate(r,d['result_schema']);assert p==before and run(r['request'])['rows']==r['rows']
    r['request']['observed']['records'][0]['value']=99;d['resources'].clear();assert run(p)['rows'][0]['observed']==10

def test_permuted_ids_missing_and_extra_predictions_coverage_all_exceptions():
    p=request();p['options'].update(coverage_policy='paired_only',weighting='none');p['observed']['records'][1]['value']=None;p['observed']['records'][2]['group_id']=None;p['predicted']['records']=p['predicted']['records'][:2];p['predicted']['records'].append({'id':'extra','x_m':10,'y_m':0,'z_m':0,'value':100});p['predicted']['records'].reverse()
    r=run(p);assert [x['reason'] for x in r['rows']]==['paired','missing_observed','unmatched_observed'];assert r['unmatched_predicted_ids']==['extra'];assert r['summary']['observed_coverage']==1/3 and r['summary']['predicted_coverage']==1/3;assert r['groups'][1]['group_id'] is None and r['groups'][1]['statistics'] is None
    assert r['summary']['statistics']['chi_squared'] is None

@pytest.mark.parametrize('value',[1e-200,-1e-200,1e20])
def test_scaled_rms_retains_small_signals_and_extremes(value):
    p=request();p['options']['weighting']='none'
    for o,t in zip(p['observed']['records'],p['predicted']['records']):o['value']=value;t['value']=0
    assert run(p)['summary']['statistics']['rmse']==pytest.approx(abs(value),rel=1e-15,abs=0)

def test_compensated_bias_and_coordinate_underflow_are_correct():
    p=request();p['options']['weighting']='none'
    for o,t,v in zip(p['observed']['records'],p['predicted']['records'],[1e20,1,-1e20]):o['value']=v;t['value']=0
    assert run(p)['summary']['statistics']['bias']==1/3
    p=request();p['predicted']['records'][0]['y_m']=1e-200;r=baselode.geophysics.calculate_misfit(p);assert r['state']=='needs_input' and r['rows']==[]
    p['options']['coordinate_tolerance_m']=1e-199;r=run(p);assert r['rows'][0]['coordinate_distance_m']==1e-200

def cases():
    out=[]
    def add(path,value,state='rejected'):
        p=request();v=p
        for k in path[:-1]:v=v[k]
        v[path[-1]]=value;out.append((p,state))
    for k in ('schema','version','observed','predicted','options'):
        p=request();del p[k];out.append((p,'needs_input'))
    add(['version'],True);add(['extra'],1);add(['observed','context','field_type'],'gravity_observed');add(['observed','context','units'],'nT');add(['predicted','context','field_type'],'gravity_disturbance','needs_input');add(['predicted','context','reference_id'],'other','needs_input');add(['predicted','context','coordinate_frame','height_datum'],'other','needs_input');add(['predicted','context','coordinate_frame','units'],'ft');add(['options','residual_convention'],'predicted_minus_observed');add(['options','weighting'],'automatic');add(['observed','records',0,'standard_deviation'],0);add(['observed','records',0,'standard_deviation'],None,'needs_input');add(['observed','records',0,'value'],None,'needs_input');add(['observed','records',0,'id'],'\ud800');add(['observed','records',0,'x_m'],True);add(['predicted','records',0,'x_m'],1,'needs_input');add(['observed','records',0,'value'],float('inf'));add(['observed','records',0,'value'],10**400)
    for role in ('observed','predicted'):
        p=request();p[role]['records']*=2;out.append((p,'rejected'))
        p=request();p[role]['records']=[dict(p[role]['records'][0],id=str(i)) for i in range(2049)];out.append((p,'rejected'))
    p=request();p['predicted']['records']=p['predicted']['records'][:2];out.append((p,'needs_input'))
    p=request();p['options']['coverage_policy']='paired_only'
    for row in p['predicted']['records']:row['value']=None
    out.append((p,'needs_input'));add(['metadata'],{'x':'x'*131073})
    return out

@pytest.mark.parametrize('p,state',cases())
def test_atomic_bad_context_contract_or_coverage(p,state):
    r=baselode.geophysics.calculate_misfit(p);assert r['state']==state,r;assert r['rows']==[] and r['groups']==[] and r['summary'] is None and r['request'] is None

def test_limits_depth_cycles_and_deterministic_group_order():
    p=request();p['options']['weighting']='none';p['observed']['records']=[dict(p['observed']['records'][0],id=str(i),group_id='__proto__') for i in range(2048)];p['predicted']['records']=[dict(p['predicted']['records'][0],id=str(i)) for i in range(2048)];assert run(p)['summary']['paired_count']==2048
    nested=0
    for _ in range(31):nested={'a':nested}
    p['metadata']=nested;assert run(p)['summary']['paired_count']==2048
    p['metadata']={'a':nested};assert baselode.geophysics.calculate_misfit(p)['state']=='rejected'
    p=request();p['metadata']={'cycle':p};assert baselode.geophysics.calculate_misfit(p)['state']=='rejected'

def test_live_python_js_metrics_context_failures_and_request_replay(tmp_path):
    p=request();negative=[]
    for c,_ in cases():
        try:text=json.dumps(c,ensure_ascii=False,allow_nan=False);text.encode('utf-8')
        except (ValueError,UnicodeError):continue
        if c.get('observed') and type(c['observed']['records'][0]['value']) is int and abs(c['observed']['records'][0]['value'])>1e100:continue
        negative.append(c)
    a=tmp_path/'in.json';b=tmp_path/'out.json';a.write_text(json.dumps({'request':p,'negative':negative}));subprocess.run(['node',str(ROOT/'test/data/misfit_parity.mjs'),str(a),str(b)],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True);js=json.loads(b.read_text());py=run(p)
    assert js['descriptor']==baselode.geophysics.describe_misfit();assert js['result']['rows']==py['rows'] and js['result']['groups']==py['groups'] and js['result']['summary']==py['summary'];assert run(js['result']['request'])['summary']==py['summary']
    expected=[baselode.geophysics.calculate_misfit(x) for x in negative];assert js['negative']==[{'state':r['state'],'code':r['issues'][0]['code'],'rows':r['rows']} for r in expected]
