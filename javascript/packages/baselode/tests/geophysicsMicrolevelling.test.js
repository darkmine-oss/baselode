/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createGeophysicsRaster,loadGeoTiff} from '../src/data/geophysicsRaster.js';
import {describeGeophysicsMicrolevelling,estimateGeophysicsMagneticMicrolevelling,microlevelGeophysicsMagneticGrid} from '../src/data/geophysicsMicrolevelling.js';
import {validateGeophysicsWorkflow,runGeophysicsWorkflow} from '../src/data/geophysicsWorkflows.js';
import {encodeErs,encodeGeoTiff} from '../src/data/geophysicsWriters.js';
import {readErs} from '../src/data/ersLoader.js';
const options=()=>({flight_azimuth:0,line_spacing:4,along_line_wavelength:64,across_line_wavelength:16,max_abs_correction:5,protected_bounds:[],edge_margin_cells:8,min_training_fraction:.5,reference_policy:'caller_verified',evidence:'Analytic levelled anomaly, verified geometry and four-metre flight spacing',geology_policy:'directional_overlap_acknowledged'});
const analytic=(row,col,noise=1,broad=10)=>noise*Math.cos(2*Math.PI*(col+.5)/8)+broad*Math.cos(2*Math.PI*(col+.5)/128)+5*Math.cos(2*Math.PI*(row+.5)/16)+100+.02*row+.03*col;
const grid=()=>createGeophysicsRaster({data:Array.from({length:128},(_,i)=>Array.from({length:128},(_,j)=>analytic(i,j))),transform:[1,0,0,0,-1,128],crs:'EPSG:32750',metadata:{field_type:'magnetic_anomaly',units:['nT'],crs_units:'m',grid_corrections:{magnetic_levelling:'applied',magnetic_microlevelling:'unapplied'},source:'analytic.ers',uncertainty:{sigma:1,model:'source-only'}}});
const workflow=(p=options())=>({schema:'baselode.geophysics.workflow',version:1,steps:[['noise','estimate_magnetic_microlevelling'],['corrected','microlevel_magnetic_grid']].map(([id,operation])=>({id,operation,version:1,inputs:['magnetic'],parameters:structuredClone(p)})),outputs:['noise','corrected']});
const maxDifference=(a,b)=>{let max=0;a.forEach((row,i)=>row.forEach((v,j)=>{if(v===null||b[i][j]===null)expect(v).toBe(b[i][j]);else max=Math.max(max,Math.abs(v-b[i][j]));}));return max;};

it('matches the independent analytic noise/geology amplitudes, preserves plane/edges and source uncertainty',()=>{
  const g=grid(),before=structuredClone(g),noise=estimateGeophysicsMagneticMicrolevelling(g,options()),product=microlevelGeophysicsMagneticGrid(g,options());
  let error=0;
  for(let row=16;row<112;row++)for(let col=16;col<112;col++)error=Math.max(error,Math.abs(product.data[0][row][col]-analytic(row,col,.0625,9.892280131939755)));
  expect(error).toBeLessThan(2e-10);
  expect(maxDifference(product.data[0],g.data[0].map((row,i)=>row.map((v,j)=>v-noise.data[0][i][j])))).toBeLessThan(1e-12);
  expect(product.data[0].slice(0,8)).toEqual(g.data[0].slice(0,8));expect(product.data[0].map(row=>row.slice(-8))).toEqual(g.data[0].map(row=>row.slice(-8)));
  expect(product.metadata.grid_corrections.magnetic_microlevelling).toBe('applied');expect(noise.metadata.field_type).toBe('other');expect(product.metadata.field_type).toBe('magnetic_anomaly');expect(product.metadata.uncertainty).toBeUndefined();expect(product.metadata.uncertainty_propagated).toBe(false);expect(product.metadata.input_lineage.at(-1).metadata.uncertainty).toEqual(g.metadata.uncertainty);expect(g).toEqual(before);expect(()=>microlevelGeophysicsMagneticGrid(product,options())).toThrow();
});
it('excludes protected geological values from training and rejects over-cap applications without clipping',()=>{
  const background=grid(),feature=grid(),p={...options(),protected_bounds:[[48,0,80,128]]};feature.data[0].forEach(row=>{for(let j=48;j<80;j++)row[j]+=200;});
  const a=estimateGeophysicsMagneticMicrolevelling(background,p),b=estimateGeophysicsMagneticMicrolevelling(feature,p);expect(b.data).toEqual(a.data);
  const product=microlevelGeophysicsMagneticGrid(feature,p);expect(product.data[0].map(row=>row.slice(48,80))).toEqual(feature.data[0].map(row=>row.slice(48,80)));
  const candidate=estimateGeophysicsMagneticMicrolevelling(feature,options());expect(candidate.metadata.microlevelling.diagnostics.application_supported).toBe(false);expect(candidate.metadata.microlevelling.diagnostics.max_abs_correction).toBeGreaterThan(5);expect(()=>microlevelGeophysicsMagneticGrid(feature,options())).toThrow(/exceeds max_abs_correction/);
  const report=runGeophysicsWorkflow(workflow(),{magnetic:feature});expect(report.state).toBe('failed');expect(report.artifacts).toEqual({});
});
it.each(['constant','plane','gaps','sentinel'])('preserves %s and native missing values',kind=>{
  const g=grid();if(kind==='constant')g.data[0]=g.data[0].map(row=>row.map(()=>10));if(kind==='plane')g.data[0]=g.data[0].map((row,i)=>row.map((_,j)=>100+.02*i+.03*j));
  if(['gaps','sentinel'].includes(kind)){g.nodata=kind==='sentinel'?-999:null;for(let i=32;i<36;i++)for(let j=20;j<23;j++)g.data[0][i][j]=g.nodata;}
  const r=microlevelGeophysicsMagneticGrid(g,options());if(['constant','plane'].includes(kind))expect(r.data).toEqual(g.data);else{expect(r.data[0][32].slice(20,23)).toEqual([null,null,null]);expect(Number.isFinite(r.data[0][50][50])).toBe(true);}
});
it.each(['rotated','km'])('uses map wavevectors and declared %s units',geometry=>{
  const g=grid(),p=options();if(geometry==='rotated'){const t=Math.PI/6;g.transform=[Math.cos(t),Math.sin(t),0,Math.sin(t),-Math.cos(t),128];p.flight_azimuth=330;}else{g.crs=null;Object.assign(g.metadata,{frame_id:'local',crs_units:'km'});g.transform=[.001,0,0,0,-.001,.128];for(const key of ['line_spacing','along_line_wavelength','across_line_wavelength'])p[key]*=.001;}
  expect(maxDifference(estimateGeophysicsMagneticMicrolevelling(g,p).data[0],estimateGeophysicsMagneticMicrolevelling(grid(),options()).data[0])).toBeLessThan(1e-11);
});
it.each(['field','units','geographic','shear','missing_transform','undeclared','frame_object','unknown_crs','unknown_frame','unicode','levelling','microlevelled','unknown_state','archived_state','history','all_missing','small','source_cap','fft_cap','big_values','boolean_value'])('rejects input %s before workflow execution',change=>{
  const g=grid(),p=options();
  if(change==='field')g.metadata.field_type='magnetic_total_field';if(change==='units')g.metadata.units=['T'];if(change==='geographic')g.crs='EPSG:4326';if(change==='shear')g.transform=[1,.2,0,0,-1,128];if(change==='missing_transform')delete g.transform;if(change==='undeclared')g.hasExplicitTransform=false;if(change==='frame_object')g.metadata.frame_id={id:'local'};if(change==='unknown_crs')g.crs='unknown';if(change==='unknown_frame'){g.crs=null;g.metadata.frame_id='unknown';}if(change==='unicode')g.metadata.extension='\ud800';if(change==='levelling')g.metadata.grid_corrections.magnetic_levelling='unapplied';if(change==='microlevelled')g.metadata.grid_corrections.magnetic_microlevelling='applied';if(change==='unknown_state')g.metadata.grid_corrections.magnetic_microlevelling='unknown';if(change==='archived_state'){g.metadata.observation_metadata={grid_corrections:g.metadata.grid_corrections};delete g.metadata.grid_corrections;}if(change==='history')g.metadata.processing=[{operation:'microlevel_magnetic_grid'}];if(change==='all_missing')g.data[0]=g.data[0].map(row=>row.map(()=>null));if(change==='small'){g.data[0]=g.data[0].slice(0,15);g.height=15;}if(change==='source_cap'){g.data=[Array.from({length:513},()=>Array(512).fill(1))];g.width=512;g.height=513;}if(change==='fft_cap'){g.data=[Array.from({length:342},()=>Array(766).fill(1))];g.width=766;g.height=342;Object.assign(p,{flight_azimuth:45,along_line_wavelength:780});}if(change==='big_values')g.data[0][0][0]=1e101;if(change==='boolean_value')g.data[0][0][0]=true;
  expect(()=>estimateGeophysicsMagneticMicrolevelling(g,p)).toThrow();const report=runGeophysicsWorkflow(workflow(p),{magnetic:g});expect(['needs_input','rejected']).toContain(report.state);expect(report.artifacts).toEqual({});expect(report.completed_steps).toEqual([]);
});
it.each([['flight_azimuth',true],['flight_azimuth',-1],['line_spacing',0],['line_spacing',1],['along_line_wavelength',20],['along_line_wavelength',1000],['across_line_wavelength',7],['max_abs_correction',0],['max_abs_correction',NaN],['protected_bounds',null],['protected_bounds',[[0,0,1]]],['protected_bounds',[[1,0,0,1]]],['protected_bounds',[[1000,0,2000,128]]],['protected_bounds',[[0,0,128,128]]],['protected_bounds',Array.from({length:17},()=>[0,0,1,1])],['edge_margin_cells',0],['edge_margin_cells',64],['edge_margin_cells',1.5],['min_training_fraction',.2],['min_training_fraction',2],['reference_policy','automatic'],['geology_policy','ignored'],['evidence',''],['evidence','\x85\ufeff'],['evidence','\ud800'],['evidence','😀'.repeat(4097)]])('rejects invalid %s controls', (key,value)=>{
  const p={...options(),[key]:value};expect(()=>estimateGeophysicsMagneticMicrolevelling(grid(),p)).toThrow();const report=runGeophysicsWorkflow(workflow(p),{magnetic:grid()});expect(['rejected','needs_input']).toContain(report.state);expect(report.artifacts).toEqual({});expect(report.completed_steps).toEqual([]);
});
it('shares independent contracts, preflights exact FFT budget and guards verified raw-input boundary',()=>{
  const descriptor=describeGeophysicsMicrolevelling();expect(descriptor).toEqual(JSON.parse(readFileSync(new URL('../../../../python/src/baselode/geophysics/geophysics_microlevelling.json',import.meta.url),'utf8')));descriptor.parameters.required.length=0;expect(describeGeophysicsMicrolevelling().parameters.required.length).toBe(11);
  const report=validateGeophysicsWorkflow(workflow(),{magnetic:grid()});expect(report.state,report.issues).toBe('ok');expect(report.resource_estimate.max_fft_cells_per_band).toBe(256**2);
  const w=workflow();w.steps.unshift({id:'upstream',operation:'low_pass',version:1,inputs:['magnetic'],parameters:{wavelength:16}});w.steps[1].inputs=['upstream'];expect(runGeophysicsWorkflow(w,{magnetic:grid()}).state).toBe('rejected');const p=options();delete p.evidence;expect(validateGeophysicsWorkflow(workflow(p),{magnetic:grid()}).state).toBe('needs_input');
});
it('preserves products and applied state through ERS and GeoTIFF',async()=>{
  const product=microlevelGeophysicsMagneticGrid(grid(),options()),ers=encodeErs(product,{dtype:'float64'});
  for(const back of [readErs(ers.header,ers.data),await loadGeoTiff(encodeGeoTiff(product,{dtype:'float64'}))]){expect(back.data).toEqual(product.data);expect(back.metadata.microlevelling).toEqual(product.metadata.microlevelling);expect(back.metadata.input_lineage).toEqual(product.metadata.input_lineage);expect(()=>microlevelGeophysicsMagneticGrid(back,options())).toThrow();}
});
