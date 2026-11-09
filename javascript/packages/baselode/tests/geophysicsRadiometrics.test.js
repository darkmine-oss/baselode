/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createGeophysicsRaster} from '../src/data/geophysicsRaster.js';
import {describeGeophysicsRadiometrics,stackGeophysicsRadiometricGrids,calculateGeophysicsRadiometricRatios,createGeophysicsRadiometricTernary} from '../src/data/geophysicsRadiometrics.js';
import {runGeophysicsWorkflow,validateGeophysicsWorkflow} from '../src/data/geophysicsWorkflows.js';
import {encodeErs,encodeGeoTiff} from '../src/data/geophysicsWriters.js';
import {readErs} from '../src/data/ersLoader.js';
import {loadGeoTiff} from '../src/data/geophysicsRaster.js';
const fixture=()=>JSON.parse(readFileSync(new URL('../../../../test/data/radiometrics_reference.json',import.meta.url),'utf8'));
const grid=()=>{const f=fixture();return createGeophysicsRaster({...f,bandNames:f.band_names});};
const sources=()=>{const g=grid();return ['K','eU','eTh'].map((element,i)=>{const m=structuredClone(g.metadata);m.units=[m.units[i]];m.radiometric.element=element;m.radiometric.calibration_id=m.radiometric.calibration_ids[i];delete m.radiometric.calibration_ids;m.source=element+'.ers';return createGeophysicsRaster({...g,data:[g.data[i]],bandNames:[element],metadata:m});});};
const workflow=()=>{const f=fixture();return {schema:'baselode.geophysics.workflow',version:1,steps:[{id:'ratios',operation:'radiometric_ratios',version:1,inputs:['radio'],parameters:f.ratio_options},{id:'rgb',operation:'radiometric_ternary',version:1,inputs:['radio'],parameters:f.ternary_options}],outputs:['ratios','rgb']};};
describe('corrected radiometric products',()=>{
  it('matches shared descriptors and returns independent copies',()=>{
    const d=describeGeophysicsRadiometrics(),py=JSON.parse(readFileSync(new URL('../../../../python/src/baselode/geophysics/geophysics_radiometrics.json',import.meta.url),'utf8'));expect(d).toEqual(py);d.stack_units[0]='ppm';expect(describeGeophysicsRadiometrics()).toEqual(py);
  });
  it('recovers hand-computed quantitative ratios with independent masks and correct units',()=>{
    const g=grid(),before=structuredClone(g),f=fixture(),r=calculateGeophysicsRadiometricRatios(g,f.ratio_options);expect(r.data).toEqual(f.expected_ratios);expect(r.metadata.units).toEqual(['ppm/%','ppm/%','1']);expect(r.metadata.field_type).toBe('other');expect(r.metadata.processing.at(-1).diagnostics.valid_counts).toEqual([3,2,5]);expect(r.metadata.uncertainty).toBeUndefined();expect(r.metadata.input_lineage.at(-1).metadata.uncertainty).toEqual(g.metadata.uncertainty);expect(g).toEqual(before);
    r.metadata.input_lineage.at(-1).metadata.radiometric.calibration_ids[0]='changed';expect(g).toEqual(before);
  });
  it('uses fixed K red/eTh green/eU blue, a common mask, valid black and explicit gamma',()=>{
    const f=fixture(),r=createGeophysicsRadiometricTernary(grid(),f.ternary_options);expect(r.data).toEqual(f.expected_ternary);expect(r.bandNames).toEqual(['red','green','blue']);expect(r.metadata.processing.at(-1).diagnostics.valid_count).toBe(4);
    const gamma=createGeophysicsRadiometricTernary(grid(),{...f.ternary_options,gamma:2});expect(gamma.data[1][0][1]).toBe(.5);expect(gamma.data[2][0][1]).toBe(.5);
    const clipped=createGeophysicsRadiometricTernary(grid(),{...f.ternary_options,k_max:1,u_max:2,th_max:4});expect(clipped.data.map(b=>b[0][0])).toEqual([1,1,1]);expect(clipped.metadata.processing.at(-1).diagnostics.clipped).toEqual([{below:0,above:2},{below:0,above:2},{below:0,above:1}]);
  });
  it('accepts an exact denominator floor and masks sentinel/overflow without changing valid U/Th',()=>{
    const f=fixture(),g=grid();[.1,.25,.5].forEach((v,b)=>{g.data[b][0][0]=v;});let r=calculateGeophysicsRadiometricRatios(g,f.ratio_options);expect(r.data.map(b=>b[0][0])).toEqual([5,2.5,.5]);g.nodata=.1;r=calculateGeophysicsRadiometricRatios(g,f.ratio_options);expect(r.data[0][0][0]).toBeNull();expect(r.data[2][0][0]).toBe(.5);
    g.nodata=null;[1e-300,1e308,1].forEach((v,b)=>{g.data[b][0][0]=v;});r=calculateGeophysicsRadiometricRatios(g,{...f.ratio_options,potassium_floor:1e-300});expect(r.data[1][0][0]).toBeNull();expect(r.metadata.processing.at(-1).diagnostics.nonfinite_result_counts[1]).toBe(1);expect(createGeophysicsRadiometricTernary(g,{...f.ternary_options,k_max:1e-300}).data[2][0][0]).toBe(1);
  });
  it('stacks distinct aligned calibrated sources and retains their uncertainty/source records',()=>{
    const s=sources(),before=structuredClone(s),r=stackGeophysicsRadiometricGrids(...s,{reference_policy:'caller_verified',evidence:'checked'});expect(r.data).toEqual(grid().data);expect(r.metadata.radiometric.calibration_ids).toEqual(['K-cal','U-cal','Th-cal']);expect(r.metadata.input_lineage.map(n=>n.metadata.source).sort()).toEqual(['K.ers','eTh.ers','eU.ers']);expect(s).toEqual(before);
  });
  it.each(['transform','crs','unit','role','height','datum','calibration','state','frame'])('rejects source %s mismatch',change=>{
    const s=sources(),m=s[1].metadata,c=m.radiometric;if(change==='transform')s[1].transform[2]++;if(change==='crs')s[1].crs='EPSG:4283';if(change==='unit')s[0].metadata.units=['ppm'];if(change==='role')c.element='eTh';if(change==='height')c.reference_height_m=200;if(change==='datum')c.height_datum='ellipsoid';if(change==='calibration')delete c.calibration_id;if(change==='state')c.state='raw_counts';if(change==='frame')m.frame_id='other';expect(()=>stackGeophysicsRadiometricGrids(...s,{reference_policy:'caller_verified',evidence:'checked'})).toThrow();
  });
  it.each(['field','units','bands','calibration','height','state','crs','transform','floor_zero','floor_bool','floor_nan','policy','evidence','negative','negative_null','all_missing','all_negative','extra'])('rejects invalid %s before any workflow outputs',change=>{
    const g=grid(),p=fixture().ratio_options;if(change==='field')g.metadata.field_type='radiometric_counts';if(change==='units')g.metadata.units=['ppm','ppm','ppm'];if(change==='bands')g.bandNames=['K','eTh','eU'];if(change==='calibration')g.metadata.radiometric.calibration_ids[0]='unknown';if(change==='height')delete g.metadata.radiometric.height_datum;if(change==='state')g.metadata.radiometric.state='raw_counts';if(change==='crs')g.crs=null;if(change==='transform')g.transform=[1,0,0,0,0,0];if(change==='floor_zero')p.potassium_floor=0;if(change==='floor_bool')p.potassium_floor=true;if(change==='floor_nan')p.thorium_floor=NaN;if(change==='policy')p.reference_policy='automatic';if(change==='evidence')p.evidence='';if(change==='negative')p.negative_policy='clip';if(change==='negative_null')p.negative_policy=null;if(change==='all_missing')g.data=g.data.map(b=>b.map(row=>row.map(()=>null)));if(change==='all_negative')g.data=g.data.map(b=>b.map(row=>row.map(()=>-1)));if(change==='extra')p.extra=true;
    expect(()=>calculateGeophysicsRadiometricRatios(g,p)).toThrow();const w=workflow();w.steps=w.steps.slice(0,1);w.steps[0].parameters=p;w.outputs=['ratios'];const r=runGeophysicsWorkflow(w,{radio:g});expect(r.state).not.toBe('ok');expect(r.completed_steps).toEqual([]);expect(r.artifacts).toEqual({});
  });
  it.each(['equal','negative','infinite','gamma_zero','gamma_large','gamma_bool'])('rejects unsupported ternary %s',change=>{
    const p=fixture().ternary_options;if(change==='equal')p.k_min=p.k_max;if(change==='negative')p.th_min=-1;if(change==='infinite')p.u_max=Infinity;if(change==='gamma_zero')p.gamma=0;if(change==='gamma_large')p.gamma=11;if(change==='gamma_bool')p.gamma=true;expect(()=>createGeophysicsRadiometricTernary(grid(),p)).toThrow();
  });
  it('runs saved geographic or local sheared pointwise recipes without FFT assumptions',()=>{
    const g=grid(),w=workflow();expect(validateGeophysicsWorkflow(w,{radio:g}).resource_estimate.max_fft_cells_per_band).toBe(0);const r=runGeophysicsWorkflow(w,{radio:g});expect(r.state,r.issues).toBe('ok');expect(r.artifacts.ratios.data).toEqual(fixture().expected_ratios);expect(r.artifacts.rgb.data).toEqual(fixture().expected_ternary);g.crs=null;g.transform=[2,1,0,0,-2,10];g.metadata.frame_id='local';g.metadata.crs_units='m';expect(runGeophysicsWorkflow(w,{radio:g}).state).toBe('ok');
  });
  it('rejects oversized data before normalization',()=>{
    const g=grid();g.data=Array.from({length:3},()=>[Array(333334).fill(1)]);expect(()=>calculateGeophysicsRadiometricRatios(g,fixture().ratio_options)).toThrow(/1000000/);
  });
  it.each(['ratios','rgb'])('persists %s values, units and source calibration through ERS/GeoTIFF',async name=>{
    const r=runGeophysicsWorkflow(workflow(),{radio:grid()}).artifacts[name],ers=encodeErs(r,{dtype:'float64'});
    for(const back of [readErs(ers.header,ers.data),await loadGeoTiff(encodeGeoTiff(r,{dtype:'float64'}))]){expect(back.data).toEqual(r.data);expect(back.metadata.units).toEqual(r.metadata.units);expect(back.metadata.input_lineage).toEqual(r.metadata.input_lineage);expect(back.metadata.radiometric_product).toEqual(r.metadata.radiometric_product);}
  });
});

it.each([['low_pass',{wavelength:20}],['vertical_derivative',{order:1}],['combine',{operation:'multiply'}]])('rejects %s output as a product source before checking cached raw support',(operation,parameters)=>{
  const g=grid();g.crs='EPSG:32750';g.metadata.crs_units='m';g.transform=[10,0,500000,0,-10,6500000];const w=workflow();w.steps=[{id:'upstream',operation,version:1,inputs:operation==='combine'?['radio','radio']:['radio'],parameters},w.steps[0]];w.steps[1].inputs=['upstream'];w.outputs=['ratios'];const v=validateGeophysicsWorkflow(w,{radio:g});expect(v.state).toBe('rejected');expect(v.issues.some(i=>i.message.includes('named verified input stack'))).toBe(true);const r=runGeophysicsWorkflow(w,{radio:g});expect(r.completed_steps).toEqual([]);expect(r.artifacts).toEqual({});
});

it.each(['geographic','sheared'])('keeps an unrelated spatial branch independent of %s radiometric geometry',geometry=>{
  const radio=grid();if(geometry==='sheared'){radio.crs='EPSG:32750';radio.metadata.crs_units='m';radio.transform=[2,1,500000,0,-2,6500000];}
  const magnetic=createGeophysicsRaster({data:Array.from({length:8},()=>Array(8).fill(1)),crs:'EPSG:32750',transform:[10,0,500000,0,-10,6500000],metadata:{field_type:'magnetic_anomaly',units:['nT'],crs_units:'m'}});
  const w=workflow();w.steps.push({id:'filtered',operation:'low_pass',version:1,inputs:['magnetic'],parameters:{wavelength:20}});w.outputs.push('filtered');const v=validateGeophysicsWorkflow(w,{radio,magnetic});expect(v.state,v.issues).toBe('ok');const r=runGeophysicsWorkflow(w,{radio,magnetic});expect(r.state,r.issues).toBe('ok');expect(r.artifacts.ratios.data).toEqual(fixture().expected_ratios);
});
it('propagates a spatial descendant requirement back to its angular concentration input',()=>{
  const w=workflow();w.steps=[w.steps[0],{id:'filtered',operation:'low_pass',version:1,inputs:['ratios'],parameters:{wavelength:20}}];w.outputs=['filtered'];const r=runGeophysicsWorkflow(w,{radio:grid()});expect(r.state).toBe('rejected');expect(r.completed_steps).toEqual([]);expect(r.artifacts).toEqual({});
});
