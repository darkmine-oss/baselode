/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {describeGeophysicsMagneticPrisms,validateGeophysicsMagneticPrisms as validate} from '../src/data/geophysicsMagneticPrisms.js';
const fixture=()=>JSON.parse(readFileSync(new URL('../../../../test/data/magnetic_prisms_example.json',import.meta.url),'utf8'));
const parameters=['magnetization_x_A_m','magnetization_y_A_m','magnetization_z_up_A_m'];
it('validates immutable portable requests and declares Python-only execution/permeability normalization',()=>{
 const p=fixture(),before=structuredClone(p),r=validate(p);expect(r.state,r.issues).toBe('ok');expect(r.request).toEqual(p);expect(r.diagnostics.min_point_to_prism_distance_m).toBe(50);expect(validate(r.request).request).toEqual(p);expect(p).toEqual(before);
 r.request.sources[0].magnetization_z_up_A_m=0;expect(p.sources[0].magnetization_z_up_A_m).toBe(1);const d=describeGeophysicsMagneticPrisms();expect(d.execution.javascript).toBe('native_request_validation_only');expect(d.model.vacuum_magnetic_permeability).toBe(1.25663706127e-6);expect(d.model.backend_to_target_scale).toBe(1.25663706127e-6/1.25663706212e-6);d.resources.max_sources=0;expect(describeGeophysicsMagneticPrisms().resources.max_sources).toBe(64);
});
it('accepts signed independent J vectors, null background, exact external and conditioning boundaries',()=>{
 const p=fixture();p.background_nT=null;for(const value of [-1,0,1]){for(const k of parameters)p.sources[0][k]=value;p.points[0].z_m=-49;expect(validate(p).state).toBe('ok');}p.sources[0].bounds_m=[-.5,.5,-10,10,-.5,.5];p.points=[{id:'limit',x_m:20,y_m:-20,z_m:20}];const r=validate(p);expect(r.state).toBe('ok');expect(r.diagnostics.max_aspect_ratio).toBe(20);expect(r.diagnostics.max_point_offset_to_min_dimension).toBe(20);
});
it('enforces distance to every prism even at zero magnetization and for diagonal exterior points',()=>{
 const p=fixture();p.sources.push({...p.sources[0],id:'second',bounds_m:[-10,10,-10,10,-10,10],magnetization_z_up_A_m:0});expect(validate(p).state).toBe('needs_input');p.sources=p.sources.slice(1);p.points=[{id:'near',x_m:10.5,y_m:10.5,z_m:10.5}];expect(validate(p).state).toBe('needs_input');p.points[0].x_m=11;expect(validate(p).state).toBe('ok');
});
it('validates full work/sensitivity and depth budgets with scalar Unicode',()=>{
 const p=fixture();p.sources[0].id='磁気 🪨';p.points=Array.from({length:1024},(_,i)=>({...p.points[0],id:String(i)}));p.sources=Array.from({length:2},(_,i)=>({...p.sources[0],id:String(i)}));let nested=0;for(let i=0;i<31;i++)nested={nested};p.metadata=nested;expect(validate(p).state).toBe('ok');p.metadata={nested};expect(validate(p).issues[0].code).toBe('resource');p.metadata={};p.include_sensitivities=false;p.sources=Array.from({length:32},(_,i)=>({...p.sources[0],id:String(i)}));expect(validate(p).state).toBe('ok');p.sources.push({...p.sources[0],id:'extra'});expect(validate(p).issues[0].code).toBe('resource');
});
const cases=[];
function negative(path,value,state='rejected',code='contract'){const p=fixture();let d=p;for(const k of path.slice(0,-1))d=d[k];d[path.at(-1)]=value;cases.push([path.join('.'),p,state,code]);}
for(const k of ['schema','version','coordinate_frame','sources','points','include_sensitivities','background_nT','min_distance_m']){const p=fixture();delete p[k];cases.push(['missing '+k,p,'needs_input','context']);}
negative(['version'],true);negative(['extra'],0);negative(['coordinate_frame','units'],'ft');negative(['coordinate_frame','height_datum'],null,'needs_input','context');
for(const k of parameters){const p=fixture();delete p.sources[0][k];cases.push(['missing '+k,p,'needs_input','context']);negative(['sources',0,k],true);negative(['sources',0,k],1001);}
for(const v of [null,3,[],true])negative(['sources',0],v);
negative(['sources',0,'density_contrast_kg_m3'],2000);negative(['sources',0,'kind'],'dipole');negative(['sources',0,'bounds_m'],[0,0,0,1,0,1]);negative(['sources',0,'bounds_m'],[0,1,0,21,0,1],'needs_input','context');
for(const [x_m,y_m,z_m]of [[0,0,-100],[50,0,-100],[50,50,-100],[50,50,-50],[50.5,0,-100]]){const p=fixture();p.points=[{id:'excluded',x_m,y_m,z_m}];cases.push(['excluded geometry',p,'needs_input','context']);}
{const p=fixture();for(const k of parameters)p.sources[0][k]=0;p.points[0].z_m=-100;cases.push(['zero source inside',p,'needs_input','context']);}
negative(['min_distance_m'],0);negative(['min_distance_m'],null,'needs_input','context');negative(['background_nT'],{},'needs_input','context');negative(['background_nT'],{x:0,y:0,z_up:0});negative(['background_nT','x'],true);negative(['background_nT','z_up'],null,'needs_input','context');negative(['points',0,'x_m'],true);negative(['points',0,'x_m'],Infinity);negative(['points',0,'id'],'\ud800');negative(['points',0,'z_m'],1951,'needs_input','context');negative(['points',0,'z_m'],200001,'rejected','resource');negative(['metadata'],{text:'x'.repeat(131073)},'rejected','resource');
for(const k of ['sources','points']){const p=fixture();p[k].push({...p[k][0]});cases.push(['duplicate '+k,p,'rejected','contract']);}
for(const [key,count]of [['sources',65],['points',1025]]){const p=fixture();p[key]=Array.from({length:count},(_,i)=>({...p[key][0],id:String(i)}));cases.push(['count '+key,p,'rejected','resource']);}
for(const [sensitive,count]of [[true,3],[false,33]]){const p=fixture();p.include_sensitivities=sensitive;p.sources=Array.from({length:count},(_,i)=>({...p.sources[0],id:String(i)}));p.points=Array.from({length:1024},(_,i)=>({...p.points[0],id:String(i)}));cases.push(['pair budget '+sensitive,p,'rejected','resource']);}
it.each(cases)('withholds invalid request: %s',(_label,p,state,code)=>{const r=validate(p);expect(r.state,r.issues).toBe(state);expect(r.issues[0].code).toBe(code);expect(r.request).toBeNull();expect(r.diagnostics).toEqual({});});
it('rejects cyclic metadata without mutation',()=>{const p=fixture();p.metadata.cycle=p;expect(validate(p).state).toBe('rejected');expect(p.metadata.cycle).toBe(p);});
