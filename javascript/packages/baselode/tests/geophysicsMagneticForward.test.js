/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {describeGeophysicsMagneticForward,calculateGeophysicsMagneticForward as calculate} from '../src/data/geophysicsMagneticForward.js';
const fixture=()=>JSON.parse(readFileSync(new URL('../../../../test/data/magnetic_forward_example.json',import.meta.url),'utf8'));
const coords=['x_m','y_m','z_m'],moments=['moment_x_A_m2','moment_y_A_m2','moment_z_up_A_m2'],vectors=['bx','by','bz_up','b_down'];
const factor=1.25663706127e-6/(4*Math.PI)*1e9;
const checked=p=>{const r=calculate(p);expect(r.state,r.issues).toBe('ok');return r;};
it('executes the portable example and isolates model/request/descriptor snapshots',()=>{
 const p=fixture(),before=structuredClone(p),r=checked(p);expect(r.fields[0].bz_up).toBeCloseTo(2*factor*.001,14);expect(r.fields[0].b_down).toBe(-r.fields[0].bz_up);expect(r.fields[0].tmi_exact).toBeCloseTo(r.fields[0].tmi_linear,14);expect(r.sensitivities).toHaveLength(3);expect(r.sensitivities[0].field_units.bx).toBe('nT/(A*m^2)');expect(r.sensitivities[0].fields[0].tmi_exact).toBeUndefined();expect(checked(r.request).fields).toEqual(r.fields);expect(p).toEqual(before);
 r.request.sources[0].moment_z_up_A_m2=0;r.model.vacuum_magnetic_permeability=0;const d=describeGeophysicsMagneticForward();d.resources.max_sources=0;expect(checked(p).fields[0].bz_up).toBeCloseTo(.2,9);expect(describeGeophysicsMagneticForward().resources.max_sources).toBe(128);
});
it.each([0,1,2])('matches axial/equatorial/inverse-cube and antipodal fields, moment axis %s',axis=>{
 for(const sign of [-1,1])for(const direction of [axis,(axis+1)%3])for(const distance of [100,-100,200]){
  const p=fixture();for(const k of coords){p.sources[0][k]=0;p.points[0][k]=0;}for(const k of moments)p.sources[0][k]=0;p.sources[0][moments[axis]]=sign*2000;p.points[0][coords[direction]]=distance;p.background_nT=null;
  const r=checked(p),expected=sign*2000*factor/Math.abs(distance)**3*(direction===axis?2:-1);['bx','by','bz_up'].forEach((k,i)=>expect(r.fields[0][k]).toBeCloseTo(i===axis?expected:0,14));expect(r.fields[0].tmi_exact).toBeNull();expect(r.fields[0].tmi_linear).toBeNull();expect(r.diagnostics.max_response_to_background_ratio).toBeNull();
 }
});
it.each([null,{x:20000,y:-10000,z_up:40000}])('moment-component derivatives agree with finite differences, background=%s',background=>{
 const p=fixture();p.background_nT=background;p.points[0].x_m=31;p.points[0].y_m=-24;p.points[0].z_m=6;
 for(const amplitude of [0,1000]){p.sources[0].moment_x_A_m2=amplitude;p.sources[0].moment_y_A_m2=-amplitude;p.sources[0].moment_z_up_A_m2=amplitude;const r=checked(p);
  moments.forEach((k,j)=>{const a=structuredClone(p),b=structuredClone(p);a.sources[0][k]+=1;b.sources[0][k]-=1;const x=checked(a).fields[0],y=checked(b).fields[0];for(const field of [...vectors,'tmi_linear']){if(field==='tmi_linear'&&background===null)expect(r.sensitivities[j].fields[0][field]).toBeNull();else expect(Math.abs((x[field]-y[field])/2-r.sensitivities[j].fields[0][field])).toBeLessThan(1e-16);}});
 }
});
it('retains tiny transverse exact TMI and applies nonlinear magnitude only after summation',()=>{
 const p=fixture();p.background_nT={x:50000,y:0,z_up:0};p.sources[0].moment_z_up_A_m2=1e-8;const tiny=checked(p).fields[0];expect(tiny.tmi_linear).toBe(0);expect(tiny.tmi_exact).toBeGreaterThan(0);expect(Math.hypot(50000,tiny.bz_up)-50000).toBe(0);expect(tiny.tmi_exact/(tiny.bz_up**2/100000)).toBeCloseTo(1,14);
 p.sources[0].moment_z_up_A_m2=1000;const one=checked(p).fields[0];p.sources.push({...p.sources[0],id:'second'});const two=checked(p).fields[0];expect(two.tmi_exact/one.tmi_exact).toBeCloseTo(4,9);p.sources[1].moment_z_up_A_m2=-1000;const zero=checked(p).fields[0];for(const k of [...vectors,'tmi_linear','tmi_exact','linearization_difference'])expect(Object.is(zero[k],0)).toBe(true);
});
it('strong and reversing anomaly cases distinguish exact and linear TMI',()=>{
 const p=fixture(),coefficient=2*factor/1e6;
 for(const value of [-50000,-100000,100000]){p.sources[0].moment_z_up_A_m2=value/coefficient;const f=checked(p).fields[0];expect(f.tmi_linear).toBeCloseTo(value,8);expect(f.tmi_exact).toBeCloseTo(Math.abs(50000+value)-50000,8);expect(f.linearization_difference).toBe(f.tmi_exact-f.tmi_linear);}
});
it('preserves translation, vector rotation, cancellation and vectors-only mode',()=>{
 const p=fixture();p.sources[0].moment_x_A_m2=100;p.sources[0].moment_y_A_m2=-200;p.points[0].x_m=30;p.points[0].y_m=40;const original=checked(p),shifted=structuredClone(p);
 for(const row of [...shifted.points,...shifted.sources]){row.x_m+=1e9;row.y_m-=2e9;row.z_m+=3e9;}expect(checked(shifted).fields).toEqual(original.fields);
 const rotated=structuredClone(p);for(const row of [...rotated.points,...rotated.sources])[row.x_m,row.y_m]=[-row.y_m,row.x_m];for(const row of rotated.sources)[row.moment_x_A_m2,row.moment_y_A_m2]=[-row.moment_y_A_m2,row.moment_x_A_m2];const f=checked(rotated).fields[0];expect(f.bx).toBeCloseTo(-original.fields[0].by,14);expect(f.by).toBeCloseTo(original.fields[0].bx,14);expect(f.tmi_exact).toBeCloseTo(original.fields[0].tmi_exact,14);
 const q=fixture(),source=q.sources[0];q.sources=[1e15,1e-10,-1e15].map((m,i)=>({...source,id:String(i),moment_z_up_A_m2:m}));expect(checked(q).fields).toEqual(checked({...q,sources:[q.sources[1]]}).fields);q.include_sensitivities=false;q.background_nT=null;expect(checked(q).sensitivities).toEqual([]);
});
const cases=[];
function negative(path,value,state='rejected',code='contract'){const p=fixture();let target=p;for(const k of path.slice(0,-1))target=target[k];target[path.at(-1)]=value;cases.push([path.join('.'),p,state,code]);}
for(const k of ['schema','version','coordinate_frame','sources','points','include_sensitivities','background_nT','min_distance_m']){const p=fixture();delete p[k];cases.push(['missing '+k,p,'needs_input','context']);}
negative(['version'],true);negative(['version'],2);negative(['extra'],0);negative(['coordinate_frame','units'],'ft');negative(['coordinate_frame','axes'],'east_north_down');negative(['coordinate_frame','height_datum'],null,'needs_input','context');negative(['coordinate_frame','height_datum'],'unknown');
for(const k of moments){const p=fixture();delete p.sources[0][k];cases.push(['missing '+k,p,'needs_input','context']);negative(['sources',0,k],true);negative(['sources',0,k],1e16);}
for(const v of [null,5,[],true,'dipole'])negative(['sources',0],v);
negative(['sources',0,'kind'],'sphere');negative(['points',0,'x_m'],true);negative(['points',0,'z_m'],NaN);negative(['points',0,'x_m'],'1');negative(['points',0,'id'],'\ud800');negative(['points',0,'id'],'x'.repeat(129));negative(['min_distance_m'],0);negative(['min_distance_m'],null,'needs_input','context');negative(['points',0,'z_m'],-100,'needs_input','context');negative(['points',0,'x_m'],200001,'rejected','resource');negative(['background_nT'],{},'needs_input','context');negative(['background_nT'],{x:0,y:0,z_up:0});negative(['background_nT'],{x:1e6,y:1e6,z_up:0});negative(['background_nT','x'],true);negative(['background_nT','z_up'],null,'needs_input','context');negative(['metadata'],{text:'x'.repeat(131073)},'rejected','resource');
for(const k of ['sources','points']){const p=fixture();p[k].push({...p[k][0]});cases.push(['duplicate '+k,p,'rejected','contract']);}
{const p=fixture();for(const k of moments)p.sources[0][k]=0;p.points[0].z_m=-100;cases.push(['zero singularity',p,'needs_input','context']);}
for(const [k,count]of [['points',4097],['sources',129]]){const p=fixture();p[k]=Array.from({length:count},(_,i)=>({...p[k][0],id:String(i)}));cases.push(['count '+k,p,'rejected','resource']);}
for(const sensitivity of [true,false]){const p=fixture();p.include_sensitivities=sensitivity;p.points=Array.from({length:4096},(_,i)=>({...p.points[0],id:String(i)}));p.sources=Array.from({length:sensitivity?2:65},(_,i)=>({...p.sources[0],id:String(i)}));cases.push(['pair budget '+sensitivity,p,'rejected','resource']);}
it.each(cases)('fails atomically: %s',(_label,p,state,code)=>{const r=calculate(p);expect(r.state,r.issues).toBe(state);expect(r.issues[0].code).toBe(code);expect(r.fields).toEqual([]);expect(r.sensitivities).toEqual([]);expect(r.request).toBeNull();});
it('executes full sensitivity budget and exact depth/geometry boundaries with Unicode',()=>{
 const p=fixture();p.sources[0].id='磁気 🧲';p.points[0].z_m=-99;let nested=0;for(let i=0;i<31;i++)nested={nested};p.metadata=nested;p.points=Array.from({length:4096},(_,i)=>({...p.points[0],id:String(i)}));const r=checked(p);expect(r.sensitivities).toHaveLength(3);expect(r.fields).toHaveLength(4096);p.metadata={nested};const invalid=calculate(p);expect(invalid.state).toBe('rejected');expect(invalid.fields).toEqual([]);expect(invalid.issues[0].code).toBe('resource');
});
it('rejects cyclic JSON without partial fields',()=>{const p=fixture();p.metadata.cycle=p;expect(calculate(p).state).toBe('rejected');expect(calculate(p).fields).toEqual([]);});
