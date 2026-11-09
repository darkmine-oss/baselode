/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {describeGeophysicsGravityForward,calculateGeophysicsGravityForward as calculate} from '../src/data/geophysicsGravityForward.js';
const fixture=()=>JSON.parse(readFileSync(new URL('../../../../test/data/gravity_forward_example.json',import.meta.url),'utf8'));
const keys=['gx','gy','gz_up','g_down','potential'],G=6.67430e-11;
const checked=p=>{const r=calculate(p);expect(r.state,r.issues).toBe('ok');return r;};
function sphere(z=200){const p=fixture();p.sources=[{id:'sphere',kind:'sphere',x_m:0,y_m:0,z_m:0,radius_m:100,density_contrast_kg_m3:2000}];p.points=[{id:'p',x_m:0,y_m:0,z_m:z}];delete p.point_mass_min_distance_m;return p;}
it('runs the portable example with signs, units, independent snapshots and replay',()=>{
 const p=fixture(),before=structuredClone(p),r=checked(p);expect(r.fields[0].g_down).toBeCloseTo(6.6743,12);expect(r.fields[0].potential).toBeCloseTo(-.066743,14);expect(r.fields[0].gz_up).toBe(-r.fields[0].g_down);expect(r.sensitivities[0].fields[0].g_down).toBeCloseTo(6.6743e-12,23);expect(r.sensitivities[0].field_units.g_down).toBe('(mGal)/(kg)');expect(checked(r.request).fields).toEqual(r.fields);expect(p).toEqual(before);
 r.request.sources[0].mass_contrast_kg=0;r.model.gravitational_constant=0;expect(checked(p).fields[0].g_down).toBeCloseTo(6.6743,12);const d=describeGeophysicsGravityForward();d.resources.max_sources=0;expect(describeGeophysicsGravityForward().resources.max_sources).toBe(128);
});
it.each([0,1,50,99,100,201,350,1000])('sphere follows independent Gauss-law values at radius %s',z=>{
 const p=sphere(z),r=checked(p),m=4*Math.PI*100**3/3*2000,acceleration=z<=100?-4*Math.PI*G*2000*z/3:-G*m/z**2,potential=z<=100?-2*Math.PI*G*2000/3*(30000-z*z):-G*m/z;
 expect(r.fields[0].gz_up).toBeCloseTo(acceleration*1e5,12);expect(r.fields[0].potential).toBeCloseTo(potential,14);expect(r.fields[0].gx).toBe(0);expect(r.sensitivities[0].field_units.potential).toBe('(m^2/s^2)/(kg/m^3)');
 if(z>100){p.sources=[{id:'mass',kind:'point_mass',x_m:0,y_m:0,z_m:0,mass_contrast_kg:m}];p.point_mass_min_distance_m=1;for(const k of keys)expect(checked(p).fields[0][k]).toBeCloseTo(r.fields[0][k],12);}
});
it.each([false,true])('matches negative potential gradients and amplitude sensitivities (sphere=%s)',isSphere=>{
 const p=isSphere?sphere():fixture();p.points[0].x_m=131;p.points[0].y_m=-57;p.points[0].z_m=166;const parameter=isSphere?'density_contrast_kg_m3':'mass_contrast_kg';
 for(const amplitude of [-2000,0,2000]){
  p.sources[0][parameter]=amplitude;const r=checked(p),basis=r.sensitivities[0].fields[0],plus=structuredClone(p);plus.sources[0][parameter]+=1;
  for(const k of keys){expect(Math.abs(r.fields[0][k]-basis[k]*amplitude)).toBeLessThan(1e-14);expect(Math.abs(checked(plus).fields[0][k]-r.fields[0][k]-basis[k])).toBeLessThan(1e-14);}
  for(const [axis,k]of [['x_m','gx'],['y_m','gy'],['z_m','gz_up']]){const a=structuredClone(p),b=structuredClone(p);a.points[0][axis]-=.01;b.points[0][axis]+=.01;const expected=-(checked(b).fields[0].potential-checked(a).fields[0].potential)/.02*1e5;expect(Math.abs(expected-r.fields[0][k])).toBeLessThan(1e-9);}
 }
});
it('preserves signed cancellation and translated or rotated vector geometry',()=>{
 const p=fixture();p.points[0].x_m=300;p.points[0].y_m=400;const original=checked(p).fields[0],shifted=structuredClone(p);
 for(const row of [...shifted.sources,...shifted.points]){row.x_m+=1e9;row.y_m-=2e9;row.z_m+=1e9;}expect(checked(shifted).fields[0]).toEqual(original);
 const rotated=structuredClone(p);for(const row of [...rotated.sources,...rotated.points])[row.x_m,row.y_m]=[-row.y_m,row.x_m];const f=checked(rotated).fields[0];expect(f.gx).toBeCloseTo(-original.gy,12);expect(f.gy).toBeCloseTo(original.gx,12);
 const source=p.sources[0];p.sources=[1e20,1,-1e20].map((mass_contrast_kg,i)=>({...source,id:String(i),mass_contrast_kg}));const r=checked(p),small=checked({...p,sources:[p.sources[1]]});for(const k of keys)expect(r.fields[0][k]).toBe(small.fields[0][k]);p.include_sensitivities=false;expect(checked(p).sensitivities).toEqual([]);
});
const cases=[];
function negative(path,value,state='rejected',code='contract'){const p=fixture();let target=p;for(const k of path.slice(0,-1))target=target[k];target[path.at(-1)]=value;cases.push([path.join('.'),p,state,code]);}
for(const k of ['schema','version','coordinate_frame','sources','points','include_sensitivities']){const p=fixture();delete p[k];cases.push(['missing '+k,p,'needs_input','context']);}
negative(['version'],true);negative(['version'],2);negative(['extra'],0);negative(['coordinate_frame','units'],'ft');negative(['coordinate_frame','axes'],'east_north_down');negative(['coordinate_frame','height_datum'],null,'needs_input','context');negative(['coordinate_frame','id'],'unknown');negative(['points',0,'x_m'],true);negative(['points',0,'z_m'],Infinity);negative(['points',0,'x_m'],'1');negative(['points',0,'id'],'\ud800');negative(['points',0,'id'],'x'.repeat(129));negative(['include_sensitivities'],0);for(const value of [null,5,[],true,'sphere'])negative(['sources',0],value);negative(['sources',0,'kind'],null,'needs_input','context');negative(['sources',0,'kind'],'prism');negative(['sources',0,'mass_contrast_kg'],1e22);negative(['sources',0,'radius_m'],1);negative(['point_mass_min_distance_m'],null,'needs_input','context');negative(['point_mass_min_distance_m'],0);negative(['points',0,'z_m'],-1000,'needs_input','context');negative(['points',0,'x_m'],200001,'rejected','resource');negative(['metadata'],{text:'x'.repeat(131073)},'rejected','resource');
{const p=fixture();p.metadata.cycle=p;cases.push(['cycle',p,'rejected','contract']);}
{const p=fixture();p.sources[0].mass_contrast_kg=0;p.points[0].z_m=-1000;cases.push(['zero singularity',p,'needs_input','context']);}
for(const k of ['sources','points']){const p=fixture();p[k].push({...p[k][0]});cases.push(['duplicate '+k,p,'rejected','contract']);}
for(const [k,value]of [['radius_m',0],['radius_m',100001],['density_contrast_kg_m3',100001]]){const p=sphere();p.sources[0][k]=value;cases.push([k,p,'rejected','contract']);}
{const p=sphere();p.point_mass_min_distance_m=1;cases.push(['unused exclusion',p,'rejected','contract']);}
for(const k of ['points','sources']){const p=fixture();p[k]=Array.from({length:k==='points'?4097:129},(_,i)=>({...p[k][0],id:String(i)}));cases.push(['count '+k,p,'rejected','resource']);}
{const p=fixture();p.points=Array.from({length:4096},(_,i)=>({...p.points[0],id:String(i)}));p.sources=Array.from({length:3},(_,i)=>({...p.sources[0],id:String(i)}));cases.push(['pairs',p,'rejected','resource']);}
it.each(cases)('fails atomically: %s',(_name,p,state,code)=>{const r=calculate(p);expect(r.state,r.issues).toBe(state);expect(r.issues[0].code).toBe(code);expect(r.fields).toEqual([]);expect(r.sensitivities).toEqual([]);expect(r.request).toBe(null);});
it('executes the maximum sensitivity budget, Unicode IDs and exact exclusion boundary',()=>{
 const p=fixture();p.sources[0].id='磁気 🧲';p.points[0].z_m=-999;p.point_mass_min_distance_m=1;expect(checked(p).fields).toHaveLength(1);p.points=Array.from({length:4096},(_,i)=>({...p.points[0],id:String(i)}));p.sources=Array.from({length:2},(_,i)=>({...p.sources[0],id:String(i)}));const r=checked(p);expect(r.sensitivities).toHaveLength(2);expect(r.fields).toHaveLength(4096);
});

it('normalizes zero signs in all field and sensitivity components',()=>{
 const r=checked(sphere(0));for(const f of [...r.fields,...r.sensitivities[0].fields])for(const k of keys)if(f[k]===0)expect(Object.is(f[k],0)).toBe(true);
});
it('accepts the deepest valid request echo and rejects deeper input atomically',()=>{
 const p=fixture();let nested=0;for(let i=0;i<31;i++)nested={nested};p.metadata=nested;
 expect(checked(p).request).toEqual(p);p.metadata={nested};const r=calculate(p);expect(r.state).toBe('rejected');expect(r.issues[0].code).toBe('resource');expect(r.fields).toEqual([]);
});
