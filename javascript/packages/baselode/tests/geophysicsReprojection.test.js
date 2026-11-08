/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it } from 'vitest';
import reference from '../../../../test/data/geophysics_crossovers_reference.json';
import limits from '../src/data/geophysics_corrections.json';
import { createGeophysicsObservations } from '../src/data/geophysicsObservations.js';
import { describeGeophysicsReprojection, reprojectGeophysicsObservations, inspectGeophysicsCorrections, levelGeophysicsMagneticLines, correctGeophysicsMagneticHeading, correctGeophysicsMagneticLag } from '../src/data/geophysicsCorrections.js';
import { gridGeophysicsObservations } from '../src/data/geophysicsGridding.js';
import { encodeErs, encodeGeoTiff } from '../src/data/geophysicsWriters.js';
import { readErs } from '../src/data/ersLoader.js';
import { loadGeoTiff } from '../src/data/geophysicsRaster.js';
const clone = (x) => JSON.parse(JSON.stringify(x));
const options = (target_crs='EPSG:32750',event_id='project') => ({target_crs,event_id,datum_policy:'backend',evidence:'Independent synthetic WGS84 check'});
function survey() {
  return {crs:'EPSG:4326',crs_units:'degrees',channels:{mag:{field_type:'magnetic_total_field',units:'nT'},other:{field_type:'magnetic_anomaly',units:'nT'}},metadata:{height_units:'m',height_datum:'WGS84_ellipsoid',z_positive:'up',corrections:{lag:'unapplied',igrf:'unapplied'},uncertainty:2},records:[{id:'point😀',x:117,y:-32,z:100,time:1735689600,line_id:'A',values:{mag:50000,other:null},extra:{azimuth:90}},{id:'missing',x:null,y:null,values:{mag:null,other:2}}]};
}
async function project(data=survey(),opts=options()) {const r=await reprojectGeophysicsObservations(data,opts);expect(r.state,JSON.stringify(r.issues)).toBe('ok');return r;}
function levelFixture() {const f=clone(reference);f.survey.crs='EPSG:32750';f.survey.records.forEach(row=>{row.x+=500000;row.y+=6500000;});return f;}
it.each([[1,false],[30,true],[50,true],[60,false]])('matches independent UTM central-meridian/equator anchor zone %s south %s',async(zone,south)=>{
 const d=survey();d.records=d.records.slice(0,1);Object.assign(d.records[0],{x:zone*6-183,y:0});const r=await project(d,options(`EPSG:${(south?32700:32600)+zone}`));expect(r.observations.records[0].x).toBeCloseTo(500000,7);expect(r.observations.records[0].y).toBeCloseTo(south?10000000:0,7);
});
it('roundtrips coordinates with measurements, null pairs, history and source lineage preserved',async()=>{
 const d=survey();const before=clone(d);const first=await project(d);expect(d).toEqual(before);const out=first.observations;
 expect(first.ledger.entries.at(-1).source).toEqual({crs:'EPSG:4326',crs_units:'degrees'});expect(first.states.magnetic_lag).toEqual({mag:'unapplied',other:'unapplied'});
 expect(first.diagnostics.transformed_records).toBe(1);expect(first.diagnostics.missing_xy_records).toBe(1);
 createGeophysicsObservations(d).records.forEach((row,i)=>{for(const key of Object.keys(row).filter(k=>!['x','y'].includes(k))) expect(out.records[i][key]).toEqual(row[key]);});expect(out.records[1].x).toBeNull();expect(out.records[1].y).toBeNull();
 expect(out.metadata.uncertainty_propagated).toBe(false);expect(out.metadata.uncertainty).toBeUndefined();expect(out.metadata.input_lineage.at(-1).metadata.uncertainty).toBe(2);
 const second=await project(out,options('EPSG:4326','back'));expect(second.ledger.entries.slice(0,-1)).toEqual(first.ledger.entries);expect(second.observations.records[0].x).toBeCloseTo(117,8);expect(second.observations.records[0].y).toBeCloseTo(-32,8);
 expect((await inspectGeophysicsCorrections(second.observations)).state).toBe('ok');expect((await project(second.observations,options('EPSG:32750','again'))).states).toEqual(first.states);
 const same=await project(out,options('EPSG:32750','identity'));expect(same.observations.records).toEqual(out.records);expect(same.ledger.entries.at(-1).backend.name).toBe('identity');
});
it.each(['partial','both_missing','longitude','latitude','zone','hemisphere','polar','unit','datum','local','unknown_option','ack','missing_option','zone0','zone61','xy_bound'])('rejects invalid %s atomically',async(change)=>{
 const d=survey();const o=options();
 if(change==='partial')d.records[0].y=null;if(change==='both_missing')Object.assign(d.records[0],{x:null,y:null});if(change==='longitude')d.records[0].x=181;if(change==='latitude')d.records[0].y=-91;if(change==='zone')d.records[0].x=111;if(change==='hemisphere')d.records[0].y=1;if(change==='polar')d.records[0].y=-81;if(change==='unit')d.crs_units='m';if(change==='datum')d.crs='EPSG:4283';if(change==='local')d.crs=null;if(change==='unknown_option')o.rotate_headings=true;if(change==='ack')o.datum_policy='automatic';if(change==='missing_option')delete o.target_crs;if(change==='zone0')o.target_crs='EPSG:32600';if(change==='zone61')o.target_crs='EPSG:32761';if(change==='xy_bound')d.records[0].x=1e13;
 const before=clone(d);const r=await reprojectGeophysicsObservations(d,o);expect(r.state).not.toBe('ok');expect(r.observations).toBeNull();expect(r.ledger).toBeNull();expect(d).toEqual(before);
});
it.each(['xy','source','target','params','count','backend','digest','id','producer','extra','chain','missing_ledger'])('rejects stale derivation %s',async(change)=>{
 const d=(await project()).observations;const e=d.metadata.correction_ledger.entries.at(-1);
 if(change==='xy')d.records[0].x+=1;if(change==='source')e.source.crs_units='degree';if(change==='target')e.target.crs='EPSG:32749';if(change==='params')e.parameters.datum_policy='automatic';if(change==='count')e.transformed_records+=1;if(change==='backend')e.backend.version='changed';if(change==='digest')e.transform_binding='0'.repeat(64);if(change==='id')e.id='different';if(change==='producer')e.producer.algorithm_version=true;if(change==='extra')e.allow=true;if(change==='chain')e.input_binding='0'.repeat(64);if(change==='missing_ledger')delete d.metadata.correction_ledger;
 expect((await inspectGeophysicsCorrections(d)).state).not.toBe('ok');expect((await reprojectGeophysicsObservations(d,options('EPSG:4326','back'))).observations).toBeNull();
});
it('validates earlier levelling in its original frame after geographic reprojection and return',async()=>{
 const f=levelFixture();const l=await levelGeophysicsMagneticLines(f.survey,f.options);expect(l.state).toBe('ok');const first=await project(l.observations,options('EPSG:4326'));expect(first.ledger.entries.slice(0,-1)).toEqual(l.ledger.entries);expect(first.states).toEqual(l.states);expect((await inspectGeophysicsCorrections(first.observations)).state).toBe('ok');
 const back=await project(first.observations,options('EPSG:32750','back'));expect((await levelGeophysicsMagneticLines(back.observations,{...f.options,event_id:'twice'})).state).toBe('rejected');const second=await levelGeophysicsMagneticLines(back.observations,{...f.options,channel:'other',event_id:'other',max_rms_residual:1e-6});expect(second.state,JSON.stringify(second.issues)).toBe('ok');expect((await inspectGeophysicsCorrections(second.observations)).state).toBe('ok');
});
it('retains grid-north acquisition headings and supports subsequent lag masks',async()=>{
 const f=levelFixture();const d=f.survey;Object.assign(d.metadata.corrections,{heading:'unapplied',lag:'unapplied'});d.metadata.heading={key:'azimuth',units:'degrees',reference:'grid_north',positive:'clockwise'};d.records.forEach((row,i)=>{row.extra.azimuth=90;row.time=i*10;});
 const heading=await correctGeophysicsMagneticHeading(d,{channel:'mag',heading_key:'azimuth',heading_reference:'grid_north',calibration_id:'test',calibration:[{heading_degrees:0,bias_nT:0},{heading_degrees:90,bias_nT:1},{heading_degrees:180,bias_nT:0},{heading_degrees:270,bias_nT:-1}],max_heading_gap:90,bias_convention:'observed_minus_reference',event_id:'heading',evidence:'synthetic'});expect(heading.state).toBe('ok');const out=(await project(heading.observations,options('EPSG:4326'))).observations;expect(out.metadata.heading).toEqual(d.metadata.heading);
 const lag=await correctGeophysicsMagneticLag(out,{channel:'mag',lag_seconds:1,max_gap:20,unsupported_policy:'mask',clock_policy:'synchronized',event_id:'lag',evidence:'synthetic'});expect(lag.state).toBe('ok');expect((await inspectGeophysicsCorrections(lag.observations)).state).toBe('ok');expect((await project(lag.observations,options('EPSG:32750','back'))).states.magnetic_heading.mag).toBe('applied');
});
it('guards limits, duplicate event IDs and descriptor ownership',async()=>{
 const d=(await project()).observations;expect((await reprojectGeophysicsObservations(d,options())).state).toBe('rejected');
 for(const key of ['max_events','max_output_json_bytes']) {const saved=limits.resources[key];limits.resources[key]=0;try{const r=await reprojectGeophysicsObservations(survey(),options());expect(r.state).toBe('rejected');expect(r.issues[0].code).toBe('resource');expect(r.observations).toBeNull();}finally{limits.resources[key]=saved;}}
 const descriptor=describeGeophysicsReprojection();descriptor.resources.max_records=0;expect(describeGeophysicsReprojection().resources.max_records).toBe(100000);
});
it('retains the derivation ledger through projected gridding and ERS/GeoTIFF',async()=>{
 const d=survey();d.records=d.records.slice(0,1);const p=await project(d);const {x,y}=p.observations.records[0];const g=gridGeophysicsObservations(p.observations,{channels:['mag'],radius:100,duplicate_policy:'mean',elevation_policy:'ignore',bounds:[x-10,y-10,x+10,y+10],shape:[2,2],extrapolation:'allow'});expect(g.state,JSON.stringify(g.issues)).toBe('ok');
 const raster=g.artifacts.grid;const ers=encodeErs(raster,{dtype:'float64'});for(const back of [readErs(ers.header,ers.data),await loadGeoTiff(encodeGeoTiff(raster,{dtype:'float64'}))])expect(back.metadata.observation_metadata.correction_ledger).toEqual(p.ledger);
});
it.each([[12,56,'EPSG:32632',687071.44,6210141.33],[174,-44,'EPSG:32759',740526.32,5123750.87]])('matches rounded published PROJ example at %s,%s',async(lon,lat,crs,x,y)=>{
 const d=survey();d.records=d.records.slice(0,1);Object.assign(d.records[0],{x:lon,y:lat});const row=(await project(d,options(crs))).observations.records[0];expect(Math.abs(row.x-x)).toBeLessThan(.01);expect(Math.abs(row.y-y)).toBeLessThan(.01);
});
it('checks source UTM area when returning to geographic coordinates',async()=>{
 const d=(await project()).observations;delete d.metadata.correction_ledger;delete d.metadata.processing;d.records[0].x=2000000;expect((await reprojectGeophysicsObservations(d,options('EPSG:4326'))).state).toBe('rejected');
});
it.each([[1,1],[60,1],[1,-1],[60,-1]])('accepts both antimeridian spellings at zone %s latitude %s and return paths',async(zone,lat)=>{
 const outputs=[];const crs=`EPSG:${(lat>0?32600:32700)+zone}`;
 for(const lon of [-180,180]) {
  const d=survey();d.records=d.records.slice(0,1);Object.assign(d.records[0],{x:lon,y:lat});const out=(await project(d,options(crs))).observations;outputs.push(out.records[0]);const back=(await project(out,options('EPSG:4326','back'))).observations;expect(Math.abs(back.records[0].x)).toBeCloseTo(180,8);expect(back.records[0].y).toBeCloseTo(lat,8);await project(back,options(crs,'again'));
 }
 for(const key of ['x','y'])expect(Math.abs(outputs[0][key]-outputs[1][key])).toBeLessThan(1e-6);
});
it.each(['missing','ack'])('rejects stored parameter %s without requesting input',async(change)=>{
 const d=(await project()).observations;const p=d.metadata.correction_ledger.entries.at(-1).parameters;if(change==='missing')delete p.target_crs;else p.datum_policy='automatic';
 for(const result of [await inspectGeophysicsCorrections(d),await reprojectGeophysicsObservations(d,options('EPSG:4326','back'))]){expect(result.state).toBe('rejected');expect(result.issues[0].code).toBe('contract');expect(result.observations).toBeNull();}
});
