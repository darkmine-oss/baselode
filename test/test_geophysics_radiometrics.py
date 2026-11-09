# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Hand-computed concentrations, independent masks/units, display and replay."""
import copy
import json
import pathlib
import subprocess

import jsonschema
import numpy as np
import pytest

import baselode.geophysics
import baselode.geophysics.radiometrics

ROOT=pathlib.Path(__file__).resolve().parents[1]


def fixture():
    return json.loads((ROOT/'test/data/radiometrics_reference.json').read_text())


def grid():
    f=fixture();return baselode.geophysics.GeophysicsRaster(f['data'],crs=f['crs'],transform=f['transform'],band_names=f['band_names'],metadata=f['metadata'])


def encoded(data):
    return np.where(np.isfinite(data),data,None).tolist()


def sources():
    g=grid();result=[]
    for i,element in enumerate(['K','eU','eTh']):
        m=copy.deepcopy(g.metadata);m['units']=[m['units'][i]];m['radiometric'].update(element=element,calibration_id=m['radiometric'].pop('calibration_ids')[i]);m['source']=element+'.ers'
        result.append(g.copy_with(g.data[i],metadata=m,band_names=[element]))
    return result


def workflow():
    f=fixture();return {'schema':'baselode.geophysics.workflow','version':1,'steps':[{'id':'ratios','operation':'radiometric_ratios','version':1,'inputs':['radio'],'parameters':f['ratio_options']},{'id':'rgb','operation':'radiometric_ternary','version':1,'inputs':['radio'],'parameters':f['ternary_options']}],'outputs':['ratios','rgb']}


def test_hand_computed_ratios_independent_masks_units_and_source_lineage():
    g=grid();before=copy.deepcopy(g.metadata);data=g.data.copy();f=fixture();r=baselode.geophysics.radiometric_ratios(g,**f['ratio_options'])
    assert encoded(r.data)==f['expected_ratios'];assert r.band_names==('eTh_K','eU_K','eU_eTh');assert r.metadata['units']==['ppm/%','ppm/%','1']
    assert r.metadata['field_type']=='other' and r.nodata is None
    d=r.metadata['processing'][-1]['diagnostics'];assert d['valid_counts']==[3,2,5];assert d['nonfinite_result_counts']==[0,0,0]
    assert 'radiometric' not in r.metadata and 'uncertainty' not in r.metadata and r.metadata['uncertainty_propagated'] is False
    assert r.metadata['input_lineage'][-1]['metadata']['uncertainty']==g.metadata['uncertainty'];assert r.metadata['input_lineage'][-1]['metadata']['radiometric']==g.metadata['radiometric']
    assert g.metadata==before;np.testing.assert_array_equal(g.data,data)
    r.metadata['input_lineage'][-1]['metadata']['radiometric']['calibration_ids'][0]='changed';assert g.metadata==before


def test_fixed_ternary_mapping_black_common_mask_gamma_and_clipping():
    f=fixture();g=grid();r=baselode.geophysics.radiometric_ternary(g,**f['ternary_options']);assert encoded(r.data)==f['expected_ternary'];assert r.band_names==('red','green','blue');assert r.metadata['units']==['fraction']*3
    assert r.metadata['processing'][-1]['diagnostics']['valid_count']==4
    assert np.all(r.data[:,1,3]==0) # Valid zero concentrations are black, not missing.
    p={**f['ternary_options'],'gamma':2};r=baselode.geophysics.radiometric_ternary(g,**p);assert r.data[1,0,1]==.5 and r.data[2,0,1]==.5
    p={**f['ternary_options'],'k_max':1,'u_max':2,'th_max':4};r=baselode.geophysics.radiometric_ternary(g,**p);assert np.all(r.data[:,0,0]==1)
    assert r.metadata['processing'][-1]['diagnostics']['clipped']==[{'below':0,'above':2},{'below':0,'above':2},{'below':0,'above':1}]


def test_exact_floor_boundary_nodata_overflow_and_extreme_display_are_explicit():
    f=fixture();g=grid();g.data[:,0,0]=[.1,.25,.5];r=baselode.geophysics.radiometric_ratios(g,**f['ratio_options']);np.testing.assert_allclose(r.data[:,0,0],[5,2.5,.5],rtol=0,atol=0)
    g.nodata=.1;r=baselode.geophysics.radiometric_ratios(g,**f['ratio_options']);assert np.isnan(r.data[0,0,0]) and r.data[2,0,0]==.5
    g=grid();g.data[:,0,0]=[1e-300,1e308,1];p={**f['ratio_options'],'potassium_floor':1e-300};r=baselode.geophysics.radiometric_ratios(g,**p);assert r.data[0,0,0]==pytest.approx(1e300,rel=1e-15) and np.isnan(r.data[1,0,0]);assert r.metadata['processing'][-1]['diagnostics']['nonfinite_result_counts'][1]==1
    p={**f['ternary_options'],'k_max':1e-300};r=baselode.geophysics.radiometric_ternary(g,**p);assert r.data[2,0,0]==1


def test_stack_preserves_distinct_source_calibrations_uncertainty_and_nodata():
    src=sources();before=[copy.deepcopy(s.metadata) for s in src];src[0].data[0,0,0]=-999;src[0].nodata=-999
    r=baselode.geophysics.stack_radiometric_grids(*src,reference_policy='caller_verified',evidence='verified independent source corrections')
    assert r.band_names==('K','eU','eTh') and r.metadata['units']==['%','ppm','ppm'];assert np.isnan(r.data[0,0,0]);assert r.metadata['radiometric']['calibration_ids']==['K-cal','U-cal','Th-cal']
    assert {n['metadata']['source'] for n in r.metadata['input_lineage']}=={'K.ers','eU.ers','eTh.ers'}
    assert all('uncertainty' in n['metadata'] for n in r.metadata['input_lineage']);assert [s.metadata for s in src]==before
    assert baselode.geophysics.radiometric_ratios(r,**fixture()['ratio_options']).metadata['field_type']=='other'


@pytest.mark.parametrize('change',['shape','transform','crs','units','role','height','datum','calibration','state','frame'])
def test_stack_context_and_alignment_guards(change):
    s=sources()
    if change=='shape':s[1]=s[1].copy_with(s[1].data[:,:,:3])
    if change=='transform':s[1].transform=(.01,0,118,0,-.01,-32)
    if change=='crs':s[1].crs='EPSG:4283'
    if change=='units':s[0].metadata['units']=['ppm']
    if change=='role':s[1].metadata['radiometric']['element']='eTh'
    if change=='height':s[1].metadata['radiometric']['reference_height_m']=200
    if change=='datum':s[1].metadata['radiometric']['height_datum']='ellipsoid'
    if change=='calibration':s[1].metadata['radiometric'].pop('calibration_id')
    if change=='state':s[1].metadata['radiometric']['state']='raw_counts'
    if change=='frame':s[1].metadata['frame_id']='other'
    with pytest.raises(ValueError):baselode.geophysics.stack_radiometric_grids(*s,reference_policy='caller_verified',evidence='checked')


@pytest.mark.parametrize('change',['field','units','bands','calibration','height','state','crs','transform','floor_zero','floor_bool','floor_nan','policy','evidence','negative','all_missing','all_negative'])
def test_ratios_fail_with_actionable_context_and_parameter_guards(change):
    g=grid();p=fixture()['ratio_options']
    if change=='field':g.metadata['field_type']='radiometric_counts'
    if change=='units':g.metadata['units']=['ppm']*3
    if change=='bands':g.band_names=('K','eTh','eU')
    if change=='calibration':g.metadata['radiometric']['calibration_ids'][0]='unknown'
    if change=='height':g.metadata['radiometric'].pop('height_datum')
    if change=='state':g.metadata['radiometric']['state']='raw_counts'
    if change=='crs':g.crs=None
    if change=='transform':g.transform=(1,0,0,0,0,0)
    if change=='floor_zero':p['potassium_floor']=0
    if change=='floor_bool':p['potassium_floor']=True
    if change=='floor_nan':p['thorium_floor']=float('nan')
    if change=='policy':p['reference_policy']='automatic'
    if change=='evidence':p['evidence']=''
    if change=='negative':p['negative_policy']='clip'
    if change=='all_missing':g.data[:]=np.nan
    if change=='all_negative':g.data[:]=-1
    with pytest.raises(ValueError):baselode.geophysics.radiometric_ratios(g,**p)
    w=workflow();w['steps']=w['steps'][:1];w['steps'][0]['parameters']=p;w['outputs']=['ratios'];r=baselode.geophysics.run_workflow(w,{'radio':g});assert r['state']!='ok' and not r['completed_steps'] and not r['artifacts']


@pytest.mark.parametrize('change',['equal','negative','infinite','gamma_zero','gamma_large','gamma_bool'])
def test_ternary_stretches_are_explicit(change):
    p=fixture()['ternary_options']
    if change=='equal':p['k_min']=p['k_max']
    if change=='negative':p['th_min']=-1
    if change=='infinite':p['u_max']=float('inf')
    if change=='gamma_zero':p['gamma']=0
    if change=='gamma_large':p['gamma']=11
    if change=='gamma_bool':p['gamma']=True
    with pytest.raises(ValueError):baselode.geophysics.radiometric_ternary(grid(),**p)


def test_saved_geographic_pointwise_workflow_native_ports_and_schemas():
    g=grid();w=workflow();v=baselode.geophysics.validate_workflow(w,{'radio':g});assert v['state']=='ok',v['issues'];assert v['resource_estimate']['max_fft_cells_per_band']==0
    r=baselode.geophysics.run_workflow(w,{'radio':g});assert r['state']=='ok',r['issues'];assert encoded(r['artifacts']['ratios'].data)==fixture()['expected_ratios']
    assert r['artifacts']['ratios'].metadata['units']==['ppm/%','ppm/%','1']
    d=baselode.geophysics.describe_radiometrics()
    for key in ['ratio_parameters','ternary_parameters']:jsonschema.Draft202012Validator.check_schema(d[key])
    jsonschema.validate(w,baselode.geophysics.workflow_schema())


def test_local_rotated_sheared_pointwise_and_missing_context():
    g=grid();g.crs=None;g.metadata['frame_id']='local-grid';g.transform=(2,1,0,0,-2,10);g.metadata['crs_units']='m'
    assert baselode.geophysics.run_workflow(workflow(),{'radio':g})['state']=='ok'
    g.metadata.pop('frame_id')
    with pytest.raises(ValueError):baselode.geophysics.radiometric_ratios(g,**fixture()['ratio_options'])


def test_resource_caps_before_transform_or_provenance():
    g=grid().copy_with(np.zeros((3,1,333334)),band_names=['K','eU','eTh'])
    with pytest.raises(ValueError,match='1000000'):baselode.geophysics.radiometric_ratios(g,**fixture()['ratio_options'])
    s=sources();s=[v.copy_with(np.ones((1,1,333334))) for v in s]
    with pytest.raises(ValueError,match='1000000'):baselode.geophysics.stack_radiometric_grids(*s,reference_policy='caller_verified',evidence='checked')


@pytest.mark.parametrize('operation',['ratios','rgb'])
@pytest.mark.parametrize('extension',['ers','tif'])
def test_quantitative_product_and_calibration_lineage_survive_export(tmp_path,operation,extension):
    r=baselode.geophysics.run_workflow(workflow(),{'radio':grid()})['artifacts'][operation];path=tmp_path/('radio.'+extension);baselode.geophysics.save_raster(r,path,dtype='float64');back=baselode.geophysics.load_raster(path)
    np.testing.assert_array_equal(back.data,r.data);assert back.metadata['units']==r.metadata['units'] and back.metadata['input_lineage']==r.metadata['input_lineage'];assert back.metadata['radiometric_product']==r.metadata['radiometric_product']


def test_live_native_python_javascript_masks_values_workflows_and_lineage(tmp_path):
    source=tmp_path/'in.json';target=tmp_path/'out.json';f=fixture();source.write_text(json.dumps({**f,'workflow':workflow(),'text_cases':json.loads((ROOT/'test/data/radiometrics_text_reference.json').read_text())}))
    subprocess.run(['node',str(ROOT/'test/data/radiometrics_parity.mjs'),str(source),str(target)],cwd=ROOT/'javascript/packages/baselode',check=True,capture_output=True,text=True)
    js=json.loads(target.read_text());assert js['ratios']['data']==f['expected_ratios'] and js['rgb']['data']==f['expected_ternary'];assert js['workflow']['state']=='ok',js['workflow']['issues']
    for key in ['ratios','rgb']:assert js[key]['metadata']['units']==baselode.geophysics.run_workflow(workflow(),{'radio':grid()})['artifacts'][key].metadata['units']
    for key in ['ratios','rgb']:baselode.geophysics.provenance.encode(js[key]['metadata'],'GeoTIFF','float64')
    assert js['text_results']==[c['accepted'] for c in json.loads((ROOT/'test/data/radiometrics_text_reference.json').read_text())]


@pytest.mark.parametrize('operation,parameters',[('low_pass',{'wavelength':20}),('vertical_derivative',{'order':1}),('combine',{'operation':'multiply'})])
def test_transformed_sources_are_rejected_instead_of_preflighting_cached_raw_values(operation,parameters):
    g=grid();g.crs='EPSG:32750';g.metadata['crs_units']='m';g.transform=(10,0,500000,0,-10,6500000)
    w=workflow();w['steps']=[{'id':'upstream','operation':operation,'version':1,'inputs':['radio','radio'] if operation=='combine' else ['radio'],'parameters':parameters},w['steps'][0]];w['steps'][1]['inputs']=['upstream'];w['outputs']=['ratios']
    v=baselode.geophysics.validate_workflow(w,{'radio':g});assert v['state']=='rejected' and any('named verified input stack' in i['message'] for i in v['issues'])
    r=baselode.geophysics.run_workflow(w,{'radio':g});assert r['completed_steps']==[] and r['artifacts']=={}


@pytest.mark.parametrize('geometry',['geographic','sheared'])
def test_unrelated_spatial_branch_does_not_constrain_pointwise_input_geometry(geometry):
    radio=grid()
    if geometry=='sheared':radio.crs='EPSG:32750';radio.metadata['crs_units']='m';radio.transform=(2,1,500000,0,-2,6500000)
    magnetic=baselode.geophysics.GeophysicsRaster(np.ones((8,8)),crs='EPSG:32750',transform=(10,0,500000,0,-10,6500000),metadata={'field_type':'magnetic_anomaly','units':['nT'],'crs_units':'m'})
    w=workflow();w['steps'].append({'id':'filtered','operation':'low_pass','version':1,'inputs':['magnetic'],'parameters':{'wavelength':20}});w['outputs'].append('filtered')
    v=baselode.geophysics.validate_workflow(w,{'radio':radio,'magnetic':magnetic});assert v['state']=='ok',v['issues']
    r=baselode.geophysics.run_workflow(w,{'radio':radio,'magnetic':magnetic});assert r['state']=='ok',r['issues'];assert encoded(r['artifacts']['ratios'].data)==fixture()['expected_ratios']


def test_spatial_descendant_keeps_angular_input_rejection():
    w=workflow();w['steps']=w['steps'][:1]+[{'id':'filtered','operation':'low_pass','version':1,'inputs':['ratios'],'parameters':{'wavelength':20}}];w['outputs']=['filtered']
    r=baselode.geophysics.run_workflow(w,{'radio':grid()});assert r['state']=='rejected' and r['completed_steps']==[] and r['artifacts']=={}


@pytest.mark.parametrize('case',json.loads((ROOT/'test/data/radiometrics_text_reference.json').read_text()))
def test_shared_unicode_whitespace_labels_and_scalar_string_contract(case):
    g=grid();p=fixture()['ratio_options'];target,value=case['target'],case['value']
    if target=='evidence':p['evidence']=value
    if target=='height_datum':g.metadata['radiometric']['height_datum']=value
    if target=='calibration_id':g.metadata['radiometric']['calibration_ids'][0]=value
    if target=='frame_id':g.crs=None;g.metadata['frame_id']=value
    if target=='crs':g.crs=value
    if target=='crs_units':g.metadata['crs_units']=value
    if target=='extension':g.metadata['extension']={'note':value}
    if case['accepted']:assert baselode.geophysics.radiometric_ratios(g,**p).band_count==3
    else:
        with pytest.raises(ValueError):baselode.geophysics.radiometric_ratios(g,**p)
    w=workflow();w['steps']=w['steps'][:1];w['steps'][0]['parameters']=p;w['outputs']=['ratios'];r=baselode.geophysics.run_workflow(w,{'radio':g});assert (r['state']=='ok')==case['accepted']


@pytest.mark.parametrize('operation',['ratios','ternary'])
def test_product_units_are_independent_of_global_contract_and_other_outputs(operation):
    f=fixture();d=baselode.geophysics.describe_radiometrics();calculate=baselode.geophysics.radiometric_ratios if operation=='ratios' else baselode.geophysics.radiometric_ternary;p=f['ratio_options' if operation=='ratios' else 'ternary_options']
    a=calculate(grid(),**p);b=calculate(grid(),**p);expected=list(b.metadata['units']);a.metadata['units'][0]='changed'
    assert b.metadata['units']==expected;assert calculate(grid(),**p).metadata['units']==expected;assert baselode.geophysics.describe_radiometrics()==d


def test_stack_rejects_invalid_unicode_evidence_and_source_metadata():
    with pytest.raises(ValueError):baselode.geophysics.stack_radiometric_grids(*sources(),reference_policy='caller_verified',evidence='\ud800')
    s=sources();s[0].metadata['radiometric']['calibration_id']='\ud800'
    with pytest.raises(ValueError):baselode.geophysics.stack_radiometric_grids(*s,reference_policy='caller_verified',evidence='checked')
