/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import descriptor from './geophysics_gravity_forward.json';
import {isObservationLabel,trimObservationText,unicodeStrings} from './geophysicsObservations.js';
const clone=v=>JSON.parse(JSON.stringify(v));
const limits=descriptor.resources,coords=['x_m','y_m','z_m'],G=descriptor.model.gravitational_constant;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
class NeedsInput extends Error{}
class ResourceError extends Error{}
class BackendError extends Error{}
/** Independent synthetic-response schemas, model constants, conventions and budgets. */
export function describeGeophysicsGravityForward(){return clone(descriptor);}
function boundedJSON(value,limit,result=false){
  const active=new Set();let count=0,textBytes=0;const encoder=new TextEncoder();
  function visit(v,depth){
    if(++count>(result?limits.max_result_json_nodes:limits.max_json_nodes)||depth>(result?limits.max_result_json_depth:limits.max_json_depth))throw new ResourceError('JSON node/depth budget exceeded');
    if(v===null||typeof v==='boolean')return;
    if(typeof v==='number'){if(!Number.isFinite(v)||Math.abs(v)>1e100)throw Error('require finite portable binary64 JSON numbers within +/-1e100');return;}
    if(typeof v==='string'){unicodeStrings(v);textBytes+=encoder.encode(v).length;if(textBytes>limit)throw new ResourceError('JSON string byte budget exceeded');return;}
    if(!Array.isArray(v)&&!object(v))throw Error('require plain scalar JSON objects/arrays');
    if(active.has(v))throw Error('cyclic JSON is invalid');active.add(v);
    if(Array.isArray(v)){
      if(Object.keys(v).length!==v.length)throw Error('JSON arrays must be dense without extra properties');
      for(let i=0;i<v.length;i++)visit(v[i],depth+1);
    }else{
      if(Reflect.ownKeys(v).some(k=>typeof k!=='string'))throw Error('JSON object keys must be strings');
      for(const [k,d] of Object.entries(Object.getOwnPropertyDescriptors(v))){if(!d.enumerable||!Object.hasOwn(d,'value'))throw Error('JSON objects require enumerable data fields');visit(k,depth+1);visit(d.value,depth+1);}
    }
    active.delete(v);
  }
  visit(value,0);const encoded=JSON.stringify(value);if(encoder.encode(encoded).length>limit)throw new ResourceError('JSON byte budget exceeded');return JSON.parse(encoded);
}
function keys(value,required,optional=[]){
  if(!object(value)||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))throw Error('unknown fields or invalid object');
  if(required.some(k=>!Object.hasOwn(value,k)||value[k]===null))throw new NeedsInput('supply every required request/frame/source/point field');
}
function number(v,low,high){if(typeof v!=='number'||!Number.isFinite(v)||v<low||v>high)throw Error('numeric value violates explicit finite range');}
function label(v){if(!isObservationLabel(v)||['unknown','unspecified'].includes(trimObservationText(v).toLowerCase()))throw Error('IDs and height datum must be known nonblank labels of <=128 characters');}
function prepare(request){
  const p=boundedJSON(request,limits.max_input_bytes);
  keys(p,['schema','version','coordinate_frame','sources','points','include_sensitivities'],['point_mass_min_distance_m','metadata']);
  if(p.schema!=='baselode.geophysics.gravity_forward_request'||p.version!==1)throw Error('unsupported gravity forward request schema/version');
  if(typeof p.include_sensitivities!=='boolean')throw Error('include_sensitivities must be boolean');
  const frame=p.coordinate_frame;keys(frame,['id','kind','axes','units','height_datum']);label(frame.id);label(frame.height_datum);
  if(frame.kind!=='local_cartesian'||frame.axes!=='x_y_up'||frame.units!=='m')throw Error('declare local_cartesian, x_y_up axes and metre units; transform upstream');
  for(const [key,max]of [['sources',limits.max_sources],['points',limits.max_points]]){
    if(!Array.isArray(p[key])||!p[key].length)throw Error(key+' must be a nonempty array');
    if(p[key].length>max)throw new ResourceError(key+' count exceeds budget');
  }
  const pairs=p.sources.length*p.points.length;
  if(pairs>limits.max_pairs||(p.include_sensitivities&&pairs>limits.max_sensitivity_pairs))throw new ResourceError('source-point pair budget exceeded');
  if(Object.hasOwn(p,'metadata')){if(!object(p.metadata))throw Error('metadata must be an object');boundedJSON(p.metadata,limits.max_metadata_bytes);}
  const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];let hasPoint=false;
  for(const collection of ['sources','points']){
    const ids=new Set();
    for(const row of p[collection]){
      let extra=[];
      if(collection==='sources'){
        if(!object(row))throw Error('source must be a plain JSON object');
        if(row.kind==null)throw new NeedsInput('declare source kind');
        if(!['sphere','point_mass'].includes(row.kind))throw Error('source kind must be sphere or point_mass');
        extra=row.kind==='sphere'?['kind','radius_m','density_contrast_kg_m3']:['kind','mass_contrast_kg'];
      }
      keys(row,['id',...coords,...extra]);label(row.id);
      if(ids.has(row.id))throw Error('source/point IDs must be unique within their collection');ids.add(row.id);
      let radius=0;
      if(collection==='sources'){
        if(row.kind==='sphere'){radius=row.radius_m;number(radius,.001,100000);number(row.density_contrast_kg_m3,-100000,100000);}
        else{hasPoint=true;number(row.mass_contrast_kg,-1e21,1e21);}
      }
      coords.forEach((k,axis)=>{const v=row[k];number(v,-1e12,1e12);low[axis]=Math.min(low[axis],v-radius);high[axis]=Math.max(high[axis],v+radius);});
    }
  }
  if(low.some((v,i)=>high[i]-v>limits.max_axis_span_m))throw new ResourceError('local frame span including sphere extents exceeds 200 km per axis');
  if(hasPoint){
    if(p.point_mass_min_distance_m==null)throw new NeedsInput('point masses require explicit point_mass_min_distance_m');
    number(p.point_mass_min_distance_m,.001,100000);
    for(const source of p.sources)if(source.kind==='point_mass')for(const point of p.points)if(Math.hypot(...coords.map(k=>source[k]-point[k]))<p.point_mass_min_distance_m)throw new NeedsInput('point-mass exclusion distance violated; change geometry or use a physical solid sphere');
  }else if(Object.hasOwn(p,'point_mass_min_distance_m'))throw Error('point_mass_min_distance_m is forbidden without point masses');
  return p;
}
function kernel(source,point){
  const delta=coords.map(k=>source[k]-point[k]),distance=Math.hypot(...delta),sphere=source.kind==='sphere';let factor,potential;
  if(sphere&&distance<=source.radius_m){const radius=source.radius_m;factor=4*Math.PI*G/3;potential=-2*Math.PI*G/3*(3*radius*radius-distance*distance);}
  else{const gm=G*(sphere?4*Math.PI*source.radius_m**3/3:1);factor=gm/distance**3;potential=-gm/distance;}
  return [...delta.map(v=>factor*v*1e5),potential];
}
function add(total,correction,i,value){const next=total[i]+value;correction[i]+=Math.abs(total[i])>=Math.abs(value)?(total[i]-next)+value:(value-next)+total[i];total[i]=next;}
function field(id,v){
  const values=[v[0],v[1],v[2],-v[2],v[3]];
  return {id,...Object.fromEntries(['gx','gy','gz_up','g_down','potential'].map((k,i)=>[k,values[i]===0?0:values[i]]))};
}
/** Synthetic local-Cartesian gravity and fixed-geometry amplitude derivatives.
 * Inputs are copied. Every failure withholds fields/sensitivities/request.
 * See describeGeophysicsGravityForward() for required geometry, units and budgets.
 */
export function calculateGeophysicsGravityForward(request){
  const report={schema:'baselode.geophysics.gravity_forward_result',version:1,state:'ok',issues:[],model:clone(descriptor.model),request:null,fields:[],sensitivities:[],field_units:clone(descriptor.field_units),diagnostics:{},producer:{library:'baselode',version:typeof __BASELODE_VERSION__==='undefined'?'unversioned':__BASELODE_VERSION__,algorithm_version:1},assumptions:clone(descriptor.assumptions)};
  try{
    const p=prepare(request),totals=p.points.map(()=>[0,0,0,0]),corrections=p.points.map(()=>[0,0,0,0]);
    for(const source of p.sources){
      const parameter=source.kind==='point_mass'?'mass_contrast_kg':'density_contrast_kg_m3',unit=source.kind==='point_mass'?'kg':'kg/m^3',fields=[];
      p.points.forEach((point,i)=>{const basis=kernel(source,point);basis.forEach((v,k)=>add(totals[i],corrections[i],k,v*source[parameter]));if(p.include_sensitivities)fields.push(field(point.id,basis));});
      if(p.include_sensitivities)report.sensitivities.push({source_id:source.id,parameter,parameter_units:unit,field_units:Object.fromEntries(Object.entries(report.field_units).map(([k,v])=>[k,`(${v})/(${unit})`])),fields});
    }
    p.points.forEach((point,i)=>{const v=totals[i].map((x,k)=>x+corrections[i][k]);if(v.some(x=>!Number.isFinite(x)))throw new BackendError('nonfinite gravity response');report.fields.push(field(point.id,v));});
    report.request=p;report.diagnostics={source_count:p.sources.length,point_count:p.points.length,pair_count:p.sources.length*p.points.length,synthetic:true,uncertainty_propagated:false};
    boundedJSON(report,limits.max_result_bytes,true);
  }catch(error){
    const context=error instanceof NeedsInput,resource=error instanceof ResourceError,failed=error instanceof BackendError;
    Object.assign(report,{state:context?'needs_input':failed?'failed':'rejected',fields:[],sensitivities:[],request:null,diagnostics:{},issues:[{code:context?'context':resource?'resource':failed?'backend':'contract',message:error.message}]});
  }
  return report;
}
