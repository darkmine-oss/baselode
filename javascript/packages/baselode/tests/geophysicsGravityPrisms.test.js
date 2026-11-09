/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {describeGeophysicsGravityPrisms,validateGeophysicsGravityPrisms as validate} from '../src/data/geophysicsGravityPrisms.js';
const fixture=()=>JSON.parse(readFileSync(new URL('../../../../test/data/gravity_prisms_example.json',import.meta.url),'utf8'));
it('validates portable replay snapshots and declares Python-only numerical execution',()=>{
 const p=fixture(),before=structuredClone(p),r=validate(p);expect(r.state,r.issues).toBe('ok');expect(r.request).toEqual(p);expect(r.diagnostics).toEqual({source_count:1,point_count:2,pair_count:2,max_aspect_ratio:1,max_point_offset_to_min_dimension:1});expect(validate(r.request).request).toEqual(p);expect(p).toEqual(before);
 r.request.sources[0].density_contrast_kg_m3=0;expect(p.sources[0].density_contrast_kg_m3).toBe(2000);const d=describeGeophysicsGravityPrisms();expect(d.execution.javascript).toBe('native_request_validation_only');expect(d.execution.kernel_backend_version).toBe('0.3.2');d.resources.max_sources=0;expect(describeGeophysicsGravityPrisms().resources.max_sources).toBe(64);
});
it('validates all gravity-finite centre/face/edge/corner locations, signed and zero density',()=>{
 const p=fixture();p.points=[[0,0,-100],[50,0,-100],[50,50,-100],[50,50,-50]].map(([x_m,y_m,z_m],i)=>({id:String(i),x_m,y_m,z_m}));for(const rho of [-2000,0,2000]){p.sources[0].density_contrast_kg_m3=rho;expect(validate(p).state).toBe('ok');}
});
it('accepts the exact aspect/offset domain and rejects unsupported geometry explicitly',()=>{
 const p=fixture();p.sources[0].bounds_m=[-.5,.5,-10,10,-.5,.5];p.points=[{id:'limit',x_m:20,y_m:-20,z_m:20}];const r=validate(p);expect(r.state).toBe('ok');expect(r.diagnostics.max_aspect_ratio).toBe(20);expect(r.diagnostics.max_point_offset_to_min_dimension).toBe(20);p.points[0].x_m=20.001;expect(validate(p).state).toBe('needs_input');
});
it('supports full input/work limits and preserves depth and Unicode at validation',()=>{
 const p=fixture();p.sources[0].id='重力 🪨';p.points=Array.from({length:1024},(_,i)=>({...p.points[0],id:String(i)}));p.sources=Array.from({length:4},(_,i)=>({...p.sources[0],id:String(i)}));let nested=0;for(let i=0;i<31;i++)nested={nested};p.metadata=nested;expect(validate(p).state).toBe('ok');p.metadata={nested};expect(validate(p).issues[0].code).toBe('resource');
 p.metadata={};p.include_sensitivities=false;p.sources=Array.from({length:32},(_,i)=>({...p.sources[0],id:String(i)}));expect(validate(p).state).toBe('ok');p.sources.push({...p.sources[0],id:'excess'});expect(validate(p).issues[0].code).toBe('resource');
});
const cases=[];
function negative(path,value,state='rejected',code='contract'){const p=fixture();let d=p;for(const k of path.slice(0,-1))d=d[k];d[path.at(-1)]=value;cases.push([path.join('.'),p,state,code]);}
for(const key of ['schema','version','coordinate_frame','sources','points','include_sensitivities']){const p=fixture();delete p[key];cases.push(['missing '+key,p,'needs_input','context']);}
negative(['version'],true);negative(['version'],2);negative(['extra'],0);negative(['coordinate_frame','units'],'ft');negative(['coordinate_frame','axes'],'x_y_down');negative(['coordinate_frame','height_datum'],null,'needs_input','context');negative(['coordinate_frame','id'],'unknown');
for(const v of [null,1,[],true,'prism'])negative(['sources',0],v);
negative(['sources',0,'kind'],'point_mass');for(const bounds of [[1,2,3],[1,1,0,1,0,1],[1,0,0,1,0,1],[0,.0001,0,1,0,1],[0,100001,0,1,0,1]])negative(['sources',0,'bounds_m'],bounds);negative(['sources',0,'density_contrast_kg_m3'],true);negative(['sources',0,'density_contrast_kg_m3'],100001);negative(['sources',0,'bounds_m'],[0,1,0,21,0,1],'needs_input','context');negative(['points',0,'z_m'],1951,'needs_input','context');negative(['points',0,'z_m'],200001,'rejected','resource');negative(['points',0,'x_m'],true);negative(['points',0,'x_m'],Infinity);negative(['points',0,'id'],'\ud800');negative(['points',0,'id'],'x'.repeat(129));negative(['metadata'],{text:'x'.repeat(131073)},'rejected','resource');
for(const key of ['sources','points']){const p=fixture();p[key].push({...p[key][0]});cases.push(['duplicate '+key,p,'rejected','contract']);}
for(const [key,count]of [['sources',65],['points',1025]]){const p=fixture();p[key]=Array.from({length:count},(_,i)=>({...p[key][0],id:String(i)}));cases.push(['count '+key,p,'rejected','resource']);}
for(const [sensitive,count]of [[true,5],[false,33]]){const p=fixture();p.include_sensitivities=sensitive;p.sources=Array.from({length:count},(_,i)=>({...p.sources[0],id:String(i)}));p.points=Array.from({length:1024},(_,i)=>({...p.points[0],id:String(i)}));cases.push(['pairs '+sensitive,p,'rejected','resource']);}
it.each(cases)('withholds invalid portable request: %s',(_label,p,state,code)=>{const r=validate(p);expect(r.state,r.issues).toBe(state);expect(r.issues[0].code).toBe(code);expect(r.request).toBeNull();expect(r.diagnostics).toEqual({});});
it('rejects cyclic metadata without mutating inputs',()=>{const p=fixture();p.metadata.cycle=p;expect(validate(p).state).toBe('rejected');expect(p.metadata.cycle).toBe(p);});
