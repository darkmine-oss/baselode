# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent affine-field mis-ties, topology and fixed-reference DC offsets."""
import copy
import json
import math
import pathlib
import subprocess

import jsonschema
import pytest

import baselode.geophysics
import baselode.geophysics.crossovers
import baselode.geophysics.provenance

ROOT = pathlib.Path(__file__).resolve().parents[1]
REFERENCE = json.loads((ROOT/'test/data/geophysics_crossovers_reference.json').read_text())


def fixture():
    return copy.deepcopy(REFERENCE)


def levelled():
    f = fixture(); r = baselode.geophysics.level_magnetic_lines(f['survey'],f['options'])
    assert r['state'] == 'ok',r['issues']
    return r['observations']


def geometry(lines):
    f = fixture()['survey']; f['records']=[]
    for line,points in lines:
        for i,point in enumerate(points):
            x,y=point[:2];value=point[2] if len(point)>2 else 100+2*x+3*y
            f['records'].append({'id':line+str(i),'line_id':line,'x':x,'y':y,'z':100,'values':{'mag':value}})
    return f


def test_independent_affine_crossing_locations_values_sign_and_no_mutation():
    f=fixture();before=copy.deepcopy(f)
    r=baselode.geophysics.analyze_crossovers(f['survey'],f['analysis'])
    assert r['state']=='ok',r['issues']
    assert [[c['x'],c['y']] for c in r['crossovers']]==f['expected_xy']
    assert [c['difference'] for c in r['crossovers']]==f['expected_differences']
    assert all(c['eligible'] and c['angle_degrees']==90 for c in r['crossovers'])
    assert r['summary']['rms_difference']==pytest.approx(math.sqrt(20.5))
    assert f==before
    jsonschema.validate(r,baselode.geophysics.describe_crossovers()['analysis_result'])


def test_independent_constant_offsets_restore_field_and_preserve_fixed_references():
    f=fixture();before=copy.deepcopy(f);r=baselode.geophysics.level_magnetic_lines(f['survey'],f['options'])
    assert r['state']=='ok',r['issues']
    out=r['observations'];assert r['ledger']['entries'][-1]['line_offsets']==f['expected_offsets']
    assert [row['values']['mag'] for row in out['records']]==f['expected_values']
    assert r['diagnostics']['rms_after']==0 and all(c['difference_after']==0 for c in r['crossovers'])
    assert f==before and out['channels']==f['survey']['channels']
    for source,row in zip(f['survey']['records'],out['records']):
        for key in ['id','line_id','x','y','z','time','extra']:assert row[key]==source[key]
        assert row['values']['other']==source['values']['other']
    assert r['states']['magnetic_levelling']=={'mag':'applied','other':'unapplied'}
    assert baselode.geophysics.inspect_corrections(out)['state']=='ok'
    jsonschema.validate(r['ledger'],baselode.geophysics.describe_corrections()['ledger_schema'])


def test_shared_vertices_deduplicate_both_sides_and_use_exact_endpoint_values():
    data=geometry([('A',[(0,0,None),(5,0,15),(10,0,None)]),('R',[(5,-5,None),(5,0,15),(5,5,None)])])
    r=baselode.geophysics.analyze_crossovers(data,fixture()['analysis'])
    assert r['state']=='ok' and len(r['crossovers'])==1
    assert r['diagnostics']['raw_crossovers']==4 and r['diagnostics']['vertex_duplicates']==3
    assert r['crossovers'][0]['eligible'] and r['crossovers'][0]['difference']==0


def test_distinct_repeat_path_measurements_at_same_xy_remain_distinct():
    data=geometry([('A',[(0,0,10),(10,0,20),(0,0,30)]),('R',[(5,-2,0),(5,2,0)])])
    r=baselode.geophysics.analyze_crossovers(data,fixture()['analysis'])
    assert r['state']=='ok' and len(r['crossovers'])==2
    assert [c['value_a'] for c in r['crossovers']]==[15,25]


def test_oblique_crossing_angle_and_height_support():
    data=geometry([('A',[(0,0),(10,10)]),('R',[(0,5),(10,5)])]); opts=fixture()['analysis']
    r=baselode.geophysics.analyze_crossovers(data,{**opts,'min_crossing_angle':60})
    assert len(r['crossovers'])==1 and r['crossovers'][0]['reason']=='shallow_angle'
    data['records'][1]['z']=110
    r=baselode.geophysics.analyze_crossovers(data,{**opts,'max_height_difference':4})
    assert r['crossovers'][0]['height_difference']==5 and r['crossovers'][0]['reason']=='height_difference'
    assert baselode.geophysics.analyze_crossovers(data,{**opts,'max_height_difference':5})['crossovers'][0]['eligible']
    data['records'][1]['z']=None
    assert baselode.geophysics.analyze_crossovers(data,opts)['crossovers'][0]['reason']=='missing_height'
    assert baselode.geophysics.analyze_crossovers(data,{**opts,'elevation_policy':'ignore','max_height_difference':None})['crossovers'][0]['eligible']


def test_long_gaps_and_parallel_overlaps_do_not_create_false_crossovers():
    f=fixture();r=baselode.geophysics.analyze_crossovers(f['survey'],{**f['analysis'],'max_segment_length':5})
    assert r['state']=='ok' and not r['crossovers'] and r['diagnostics']['long_segments_excluded']==4
    data=geometry([('A',[(0,0),(10,0)]),('R',[(1,0),(9,0)])])
    r=baselode.geophysics.analyze_crossovers(data,f['analysis'])
    assert not r['crossovers'] and r['diagnostics']['parallel_candidates_excluded']==1


def test_endpoint_tolerance_is_explicit_without_extrapolating_values():
    opts=fixture()['analysis'];tol=opts['intersection_tolerance']
    data=geometry([('A',[(0,0,10),(10,0,20)]),('R',[(10+tol/2,-1,30),(10+tol/2,1,30)])])
    r=baselode.geophysics.analyze_crossovers(data,opts)
    assert len(r['crossovers'])==1 and r['crossovers'][0]['fraction_a']==1 and r['crossovers'][0]['value_a']==20
    for row in data['records'][2:]:row['x']=10+2*tol
    assert not baselode.geophysics.analyze_crossovers(data,opts)['crossovers']


def test_large_translated_projected_coordinates_preserve_offsets():
    f=fixture()
    for row in f['survey']['records']:row['x']+=1e9;row['y']+=1e9
    r=baselode.geophysics.level_magnetic_lines(f['survey'],f['options'])
    assert r['state']=='ok',r['issues']
    assert r['ledger']['entries'][-1]['line_offsets']==f['expected_offsets']


@pytest.mark.parametrize('change',['xy','line','repeat_line','coincident','large_xy','geographic','units','height_units','datum','positive','units_proto','height_constructor'])
def test_geometry_and_coordinate_context_failures_are_atomic(change):
    f=fixture();data=f['survey']
    if change=='xy':data['records'][0]['x']=None
    elif change=='line':data['records'][0]['line_id']=None
    elif change=='repeat_line':data['records'].append({**copy.deepcopy(data['records'][0]),'id':'repeated'})
    elif change=='coincident':data['records'][1]['x']=data['records'][0]['x'];data['records'][1]['y']=data['records'][0]['y']
    elif change=='large_xy':data['records'][0]['x']=1e13
    elif change=='geographic':data.update(crs='EPSG:4326',crs_units='degrees')
    elif change=='units':data['crs_units']='degrees'
    elif change=='units_proto':data.update(crs='LOCAL',crs_units='__proto__')
    elif change=='height_constructor':data['metadata']['height_units']='constructor'
    elif change in ['height_units','positive','datum']:data['metadata'].pop({'height_units':'height_units','positive':'z_positive','datum':'height_datum'}[change])
    before=copy.deepcopy(data)
    for operation,options in [(baselode.geophysics.analyze_crossovers,f['analysis']),(baselode.geophysics.level_magnetic_lines,f['options'])]:
        r=operation(data,options);assert r['state'] in ['needs_input','rejected']
        if operation==baselode.geophysics.analyze_crossovers:assert r['crossovers']==[]
        else:assert r['observations'] is None and r['ledger'] is None
    assert data==before


@pytest.mark.parametrize('change',['coverage','references','correction','residual','unknown','applied','role_overlap','role_missing'])
def test_fit_quality_and_history_gates_commit_nothing(change):
    f=fixture();opts=f['options'];data=f['survey']
    if change=='coverage':opts['min_crossovers']=3
    elif change=='references':opts['reference_lines']=['R1'];opts['target_lines']=['A😀','B','R2'];opts['min_reference_lines']=1
    elif change=='correction':opts['max_abs_correction']=4
    elif change=='residual':
        for row in data['records']:
            if row['line_id']=='R2':row['values']['mag']+=2
        opts['max_rms_residual']=.5
    elif change=='unknown':data['metadata']['corrections']={}
    elif change=='applied':data['metadata']['corrections']['levelling']='applied'
    elif change=='role_overlap':opts['target_lines'].append('R1')
    elif change=='role_missing':opts['target_lines']=['A😀']
    before=copy.deepcopy(f);r=baselode.geophysics.level_magnetic_lines(data,opts)
    assert r['state'] in ['needs_input','rejected'] and r['observations'] is None and r['ledger'] is None
    assert f==before
    if change in ['coverage','correction','residual']:assert r['proposals']
    if change=='residual':assert [p['bias_nT'] for p in r['proposals']]==[4,-5] and all(p['rms_after']==1 for p in r['proposals'])


def test_missing_readings_remain_visible_as_unsupported_crossovers():
    f=fixture();f['survey']['records'][0]['values']['mag']=None
    a=baselode.geophysics.analyze_crossovers(f['survey'],f['analysis'])
    assert a['state']=='ok' and [c['eligible'] for c in a['crossovers']]==[False,False,True,True]
    r=baselode.geophysics.level_magnetic_lines(f['survey'],f['options'])
    assert r['state']=='needs_input' and r['observations'] is None


def test_resource_failures_never_expose_partial_tables(monkeypatch):
    for key in ['max_pair_tests','max_raw_crossovers','max_crossovers']:
        monkeypatch.setitem(baselode.geophysics.crossovers._LIMITS,key,0)
        f=fixture()
        for op,opts in [(baselode.geophysics.analyze_crossovers,f['analysis']),(baselode.geophysics.level_magnetic_lines,f['options'])]:
            r=op(f['survey'],opts);assert r['state']=='rejected' and r['issues'][0]['code']=='resource' and r['crossovers']==[]
        monkeypatch.undo()


def test_model_and_height_context_binding_guard_and_repeat_history():
    out=levelled()
    for change in ['offset','reference_offset','role','bound','context','drop','data']:
        bad=copy.deepcopy(out);entry=bad['metadata']['correction_ledger']['entries'][-1]
        if change=='offset':entry['line_offsets'][-1]['bias_nT']+=1
        elif change=='reference_offset':entry['line_offsets'][0]['bias_nT']=1
        elif change=='role':entry['parameters']['reference_lines'].reverse()
        elif change=='bound':entry['parameters']['max_rms_residual']=1
        elif change=='context':bad['metadata']['height_datum']='another'
        elif change=='drop':del bad['metadata']['correction_ledger']
        elif change=='data':bad['records'][0]['values']['mag']+=1
        assert baselode.geophysics.inspect_corrections(bad)['state']=='rejected',change
    assert baselode.geophysics.level_magnetic_lines(out,{**fixture()['options'],'event_id':'repeat'})['state']=='rejected'


def test_source_lineage_and_shared_contracts():
    output=levelled();metadata=output['metadata'];step=metadata['processing'][-1]
    for name in ['uncertainty','variance','standard_deviation']:
        assert name not in metadata
        assert metadata['input_lineage'][step['operand_lineage']]['metadata'][name]==fixture()['survey']['metadata'][name]
    nodes,operand=baselode.geophysics.provenance.append_input({'source':'foreign.xyz'},metadata)
    moved=nodes[operand]['metadata']['processing'][-1];assert nodes[moved['operand_lineage']]['metadata']['source']=='crossover-fixture.xyz'
    baselode.geophysics.provenance.encode({'input_lineage':nodes},'GeoTIFF','float64')
    descriptor=baselode.geophysics.describe_crossovers()
    assert descriptor==json.loads((ROOT/'javascript/packages/baselode/src/data/geophysics_crossovers.json').read_text())
    for name in ['analysis_parameters','levelling_parameters','analysis_result']:jsonschema.Draft202012Validator.check_schema(descriptor[name])


def test_reference_first_acquisition_preserves_fitted_signs():
    f=fixture();f['survey']['records']=f['survey']['records'][4:]+f['survey']['records'][:4]
    r=baselode.geophysics.level_magnetic_lines(f['survey'],f['options'])
    assert r['state']=='ok' and r['ledger']['entries'][-1]['line_offsets']==f['expected_offsets']


def test_null_targets_outside_tie_locations_are_preserved():
    f=fixture();row={'id':'nullA','line_id':'A😀','x':2,'y':15,'z':100,'values':{'mag':None,'other':None}}
    f['survey']['records'].insert(2,row)
    r=baselode.geophysics.level_magnetic_lines(f['survey'],f['options'])
    assert r['state']=='ok',r['issues']
    assert r['observations']['records'][2]['values']['mag'] is None and r['ledger']['entries'][-1]['affected_records']==8


def test_previous_heading_and_base_history_and_subsequent_lag_masks():
    f=fixture();data=f['survey'];data['metadata']['heading']={'key':'heading','units':'degrees','reference':'true_north','positive':'clockwise'};data['metadata']['corrections'].update(heading='unapplied',diurnal='unapplied',lag='unapplied')
    for row in data['records']:row['extra']['heading']=0
    head=baselode.geophysics.correct_magnetic_heading(data,{'channel':'mag','heading_key':'heading','heading_reference':'true_north','calibration_id':'constant','calibration':[{'heading_degrees':0,'bias_nT':1},{'heading_degrees':180,'bias_nT':1}],'max_heading_gap':180,'bias_convention':'observed_minus_reference','event_id':'head','evidence':'synthetic'})
    base={'channels':{'base':{'field_type':'magnetic_total_field','units':'nT'}},'records':[{'id':str(i),'time':i,'station_id':'BASE','values':{'base':101}} for i in range(8)],'metadata':{'corrections':{'diurnal':'unapplied'}}}
    corrected=baselode.geophysics.correct_magnetic_base(head['observations'],base,{'channel':'mag','base_channel':'base','reference':100,'max_gap':1,'event_id':'base','evidence':'synthetic','clock_policy':'synchronized'})
    level=baselode.geophysics.level_magnetic_lines(corrected['observations'],f['options'])
    assert level['state']=='ok',level['issues']
    assert [row['values']['mag'] for row in level['observations']['records']]==[v-2 for v in f['expected_values']]
    lag=baselode.geophysics.correct_magnetic_lag(level['observations'],{'channel':'mag','lag_seconds':.5,'max_gap':1,'unsupported_policy':'mask','event_id':'lag','evidence':'synthetic','clock_policy':'synchronized'})
    assert lag['state']=='ok',lag['issues']
    assert baselode.geophysics.inspect_corrections(lag['observations'])['state']=='ok'
    assert [e['affected_records'] for e in lag['ledger']['entries'] if e['kind']=='application']==[8,8,8,8]
    assert sum(row['values']['mag'] is not None for row in lag['observations']['records'])==4


def test_live_python_javascript_crossover_and_model_binding_parity(tmp_path):
    f=fixture();f['python_output']=levelled();source=tmp_path/'in.json';target=tmp_path/'out.json';source.write_text(json.dumps(f))
    subprocess.run(['node',str(ROOT/'test/data/crossover_parity.mjs'),str(source),str(target)],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True)
    result=json.loads(target.read_text())
    for name in ['analysis','inspected','first','second']:assert result[name]['state']=='ok',result[name]['issues']
    assert [[c['x'],c['y']] for c in result['analysis']['crossovers']]==f['expected_xy']
    py=f['python_output']['metadata']['correction_ledger'];js=result['first']['ledger']
    assert js['current_binding']==py['current_binding'] and js['entries'][-1]['levelling_binding']==py['entries'][-1]['levelling_binding']
    assert result['second']['ledger']['entries'][-1]['line_offsets']==f['expected_other_offsets']
    assert baselode.geophysics.inspect_corrections(result['second']['observations'])['state']=='ok'
    second=baselode.geophysics.level_magnetic_lines(result['first']['observations'],{**f['options'],'channel':'other','event_id':'py-other'})
    assert second['state']=='ok',second['issues']
    assert second['ledger']['current_binding']==result['second']['ledger']['current_binding']
    assert second['ledger']['entries'][-1]['levelling_binding']==result['second']['ledger']['entries'][-1]['levelling_binding']


@pytest.mark.parametrize('extension',['ers','tif'])
def test_model_and_source_lineage_persist_through_grid_exports(tmp_path,extension):
    output=levelled();grid=baselode.geophysics.grid_observations(output,{'channels':['mag'],'radius':20,'duplicate_policy':'mean','elevation_policy':'ignore','bounds':[0,0,10,10],'shape':[2,2],'extrapolation':'allow'})
    assert grid['state']=='ok',grid['issues']
    path=tmp_path/('level.'+extension);baselode.geophysics.save_raster(grid['artifacts']['grid'],path,dtype='float64');back=baselode.geophysics.load_raster(path)
    assert back.metadata['observation_metadata']['correction_ledger']==output['metadata']['correction_ledger']
