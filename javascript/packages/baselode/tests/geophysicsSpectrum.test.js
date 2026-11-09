/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import {it,expect,vi} from 'vitest';
import * as processing from '../src/data/geophysicsProcessing.js';
import {readFileSync} from 'node:fs';
import {createGeophysicsRaster} from '../src/data/geophysicsRaster.js';
import {describeGeophysicsSpectrum,analyzeGeophysicsGridSpectrum} from '../src/data/geophysicsSpectrum.js';
import {runGeophysicsObservationWorkflow,validateGeophysicsObservationWorkflow} from '../src/data/geophysicsObservationWorkflows.js';
const fixture=()=>JSON.parse(readFileSync(new URL('../../../../test/data/spectrum_example.json',import.meta.url),'utf8'));
const grid=()=>createGeophysicsRaster(fixture().raster);
const options=()=>fixture().options;
it('recovers known cosine power/direction once with DC accounted separately',()=>{
  const g=grid(),before=structuredClone(g),r=analyzeGeophysicsGridSpectrum(g,options());expect(r.state,r.issues).toBe('ok');expect(r.diagnostics.spectral_total_power).toBeCloseTo(6.5,12);expect(r.radial[4].power_sum).toBeCloseTo(4.5,12);expect(r.radial[8].power_sum).toBeCloseTo(2,12);expect(r.directional[0].power_sum).toBeCloseTo(4.5,12);expect(r.directional[6].power_sum).toBeCloseTo(2,12);expect(r.diagnostics.parseval_absolute_error).toBeLessThan(1e-12);expect(r.units).toEqual({source:'nT',power:'(nT)^2',density:'(nT)^2*m^2',frequency:'1/m',wavelength:'m'});expect(r.metadata.input_lineage.at(-1).metadata.uncertainty).toEqual({sigma:1});expect(g).toEqual(before);expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  const raw=analyzeGeophysicsGridSpectrum(g,{...options(),detrend:'none'});expect(raw.diagnostics.dc_power).toBeCloseTo(100,12);expect(raw.diagnostics.spectral_total_power).toBeCloseTo(106.5,12);
});
it.each(['boxcar','hann_periodic'])('matches a naive independent complex DFT for %s with zero padding',window=>{
  const g=grid();g.data[0]=g.data[0].map((row,i)=>[...row,1+i,2-i]);g.width=10;
  const r=analyzeGeophysicsGridSpectrum(g,{...options(),window});expect(r.state,r.issues).toBe('ok');expect(r.diagnostics.fft_shape).toEqual([8,16]);
  const mean=g.data[0].flat().reduce((s,v)=>s+v,0)/80;let energy=0,spatial=0;const values=[];
  for(let i=0;i<8;i++)for(let j=0;j<10;j++){const w=window==='boxcar'?1:(.5-.5*Math.cos(2*Math.PI*i/8))*(.5-.5*Math.cos(2*Math.PI*j/10)),v=(g.data[0][i][j]-mean)*w;values.push([i,j,v]);energy+=w*w;spatial+=v*v;}
  let direct=0;for(let ki=0;ki<8;ki++)for(let kj=0;kj<16;kj++){let re=0,im=0;for(const [i,j,v]of values){const phase=-2*Math.PI*(ki*i/8+kj*j/16);re+=v*Math.cos(phase);im+=v*Math.sin(phase);}direct+=(re*re+im*im)/(128*energy);}
  expect(r.diagnostics.spectral_total_power).toBeCloseTo(direct,10);expect(r.diagnostics.windowed_mean_square).toBeCloseTo(spatial/energy,10);expect(r.diagnostics.frequency_cell_area).toBe(1/128);
  for(const b of r.radial){if(b.count===0)expect(b.mean_power_density).toBeNull();else expect(b.mean_power_density).toBeCloseTo(b.power_sum/b.count*128,10);}
});
it.each(['constant','plane','nyquist','corners','rotated','km','anisotropic','selected_band'])('handles %s sampling and reference conventions',kind=>{
  const g=grid(),p=options();if(kind==='constant')g.data[0]=g.data[0].map(row=>row.map(()=>7));if(kind==='plane'){g.data[0]=g.data[0].map((row,i)=>row.map((_,j)=>7+.1*i+.2*j));p.detrend='plane';}if(kind==='nyquist')g.data[0]=g.data[0].map(row=>row.map((_,j)=>(-1)**j));if(kind==='corners')g.data[0]=g.data[0].map((row,i)=>row.map((_,j)=>(-1)**(i+j)));if(kind==='rotated'){g.data[0]=g.data[0].map(row=>row.map((_,j)=>2*Math.cos(2*Math.PI*j/4)));const t=Math.PI/6;g.transform=[Math.cos(t),Math.sin(t),0,Math.sin(t),-Math.cos(t),0];}if(kind==='km'){g.crs=null;g.metadata.frame_id='local';g.metadata.crs_units='km';g.transform=[.001,0,0,0,-.001,0];}if(kind==='anisotropic')g.transform=[2,0,0,0,-1,0];if(kind==='selected_band'){g.data=[g.data[0].map(row=>row.map(()=>null)),g.data[0]];g.bandNames=['missing','selected'];g.metadata.units=['ppm','nT'];g.bandCount=2;p.band=2;}
  const r=analyzeGeophysicsGridSpectrum(g,p);expect(r.state,r.issues).toBe('ok');const d=r.diagnostics;
  if(['constant','plane'].includes(kind)){expect(d.below_numerical_floor).toBe(true);expect(d.spectral_total_power).toBeLessThan(1e-24);}if(kind==='nyquist')expect(d.included_power).toBeCloseTo(1,12);if(kind==='corners'){expect(d.outside_circle_power).toBeCloseTo(1,12);expect(d.included_power).toBeLessThan(1e-24);}if(kind==='rotated')expect(r.directional[4].power_sum).toBeCloseTo(2,12);if(kind==='km'){expect(d.radial_frequency_limit).toBe(500);expect(d.spectral_total_power).toBeCloseTo(6.5,12);}if(kind==='anisotropic')expect(d.radial_frequency_limit).toBe(.25);if(kind==='selected_band'){expect(d.spectral_total_power).toBeCloseTo(6.5,12);expect(r.source.band).toBe(2);}
});
it.each(['none','bool','missing','sentinel','geographic','shear','transform','undeclared','frame','units','field','unicode','history','metadata_cap','source_cap','small','unit_conflict'])('rejects or requests context for %s without scientific arrays',change=>{
  let g=grid();if(change==='none')g=null;if(change==='bool')g.data[0][0][0]=true;if(change==='missing')g.data[0][0][0]=null;if(change==='sentinel'){g.nodata=-999;g.data[0][0][0]=-999;}if(change==='geographic')g.crs='EPSG:4326';if(change==='shear')g.transform=[1,.2,0,0,-1,0];if(change==='transform')delete g.transform;if(change==='undeclared')g.hasExplicitTransform=false;if(change==='frame')g.crs=null;if(change==='units')delete g.metadata.units;if(change==='field')g.metadata.field_type='unknown';if(change==='unicode')g.metadata.extension='\ud800';if(change==='history')g.metadata.processing=null;if(change==='metadata_cap')g.metadata.extension='x'.repeat(524288);if(change==='source_cap')g.data=[Array.from({length:513},()=>Array(512).fill(1))];if(change==='small')g.data[0]=g.data[0].slice(0,7);if(change==='unit_conflict')g.metadata.crs_units='km';
  const r=analyzeGeophysicsGridSpectrum(g,options());expect(['rejected','needs_input']).toContain(r.state);expect(r.radial).toEqual([]);expect(r.directional).toEqual([]);expect(r.metadata).toBeUndefined();
});
it.each([['band',true],['band',2],['band',0],['detrend','auto'],['window','hann'],['radial_bins',129],['direction_bins',3],['radial_bins',NaN],['missing_policy','fill'],['extra',true]])('guards %s options', (key,value)=>{
  expect(analyzeGeophysicsGridSpectrum(grid(),{...options(),[key]:value}).state).toBe('rejected');const p=options();delete p.window;expect(analyzeGeophysicsGridSpectrum(grid(),p).state).toBe('needs_input');
});
it('discovers independent schemas, runs the typed recipe and withholds partial grid on failure',async()=>{
  const d=describeGeophysicsSpectrum(),py=JSON.parse(readFileSync(new URL('../../../../python/src/baselode/geophysics/geophysics_spectrum.json',import.meta.url),'utf8'));expect(d).toEqual(py);d.parameters.required.length=0;expect(describeGeophysicsSpectrum()).toEqual(py);
  const f=fixture(),before=structuredClone(f);expect((await validateGeophysicsObservationWorkflow(f.workflow,{survey:f.survey})).state).toBe('ok');const r=await runGeophysicsObservationWorkflow(f.workflow,{survey:f.survey});expect(r.state,r.issues).toBe('ok');expect(r.artifacts.spectrum.diagnostics.spectral_total_power).toBeCloseTo(6.5,12);expect(f).toEqual(before);f.survey.records.pop();const failed=await runGeophysicsObservationWorkflow(f.workflow,{survey:f.survey});expect(failed.state,failed.issues).toBe('needs_input');expect(failed.artifacts).toEqual({});expect(failed.completed_steps).toEqual(['grid']);
});

it('returns an atomic failed report on FFT backend errors',()=>{
  const spy=vi.spyOn(processing,'geophysicsFft2').mockImplementation(()=>{throw Error('injected FFT failure');});try{const r=analyzeGeophysicsGridSpectrum(grid(),options());expect(r.state).toBe('failed');expect(r.radial).toEqual([]);expect(r.directional).toEqual([]);expect(r.metadata).toBeUndefined();}finally{spy.mockRestore();}
});
it('keeps parameters/source/lineage and separate reports independent',()=>{
  const p=options(),g=grid(),a=analyzeGeophysicsGridSpectrum(g,p),b=analyzeGeophysicsGridSpectrum(g,p);a.parameters.band=2;a.metadata.input_lineage.at(-1).metadata.uncertainty.sigma=99;expect(p).toEqual(options());expect(b.parameters).toEqual(p);expect(g.metadata.uncertainty).toEqual({sigma:1});
});

it('retains energy below the numerical diagnostic floor and accounts all frequencies',()=>{
  const g=grid();g.data[0]=g.data[0].map(row=>row.map((_,j)=>1e-15*Math.cos(2*Math.PI*j/4)));const r=analyzeGeophysicsGridSpectrum(g,options()),d=r.diagnostics;expect(r.state).toBe('ok');expect(d.below_numerical_floor).toBe(true);expect(Math.abs(d.spectral_total_power/5e-31-1)).toBeLessThan(1e-12);expect(Math.abs((d.dc_power+d.included_power+d.outside_circle_power)/d.spectral_total_power-1)).toBeLessThan(1e-12);expect(1+d.included_count+d.outside_circle_count).toBe(64);
});
