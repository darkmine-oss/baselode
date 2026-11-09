/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import descriptor from './geophysics_magnetic_forward.json';
import {boundedJSON,keys,number,label,add,object,NeedsInput,ResourceError,BackendError} from './geophysicsForwardCommon.js';
const clone=v=>JSON.parse(JSON.stringify(v)),limits=descriptor.resources,coords=['x_m','y_m','z_m'],moments=['moment_x_A_m2','moment_y_A_m2','moment_z_up_A_m2'];
const factor=descriptor.model.vacuum_magnetic_permeability/(4*Math.PI)*1e9;
const zero=v=>v===0?0:v;
function sum(values){const t=[0],c=[0];for(const v of values)add(t,c,0,v);return t[0]+c[0];}
/** Independent native dipole, nullable-background and moment-derivative contracts. */
export function describeGeophysicsMagneticForward(){return clone(descriptor);}
function prepare(request){
 const p=boundedJSON(request,limits.max_input_bytes);
 keys(p,['schema','version','coordinate_frame','sources','points','include_sensitivities','min_distance_m'],['background_nT','metadata']);
 if(!Object.hasOwn(p,'background_nT'))throw new NeedsInput('supply background_nT vector or explicit null for vectors only');
 if(p.schema!=='baselode.geophysics.magnetic_forward_request'||p.version!==1)throw Error('unsupported magnetic forward schema/version');
 if(typeof p.include_sensitivities!=='boolean')throw Error('include_sensitivities must be boolean');
 const f=p.coordinate_frame;keys(f,['id','kind','axes','units','height_datum']);label(f.id);label(f.height_datum);
 if(f.kind!=='local_cartesian'||f.axes!=='x_y_up'||f.units!=='m')throw Error('declare local_cartesian, x_y_up axes and metre units; transform upstream');
 number(p.min_distance_m,.001,100000);
 if(p.background_nT!==null){keys(p.background_nT,['x','y','z_up']);for(const v of Object.values(p.background_nT))number(v,-1e6,1e6);const magnitude=Math.hypot(...['x','y','z_up'].map(k=>p.background_nT[k]));if(magnitude<1||magnitude>1e6)throw Error('background magnitude must be between 1 and 1000000 nT');}
 for(const [key,max]of [['sources',limits.max_sources],['points',limits.max_points]]){if(!Array.isArray(p[key])||!p[key].length)throw Error(key+' must be a nonempty array');if(p[key].length>max)throw new ResourceError(key+' count exceeds budget');}
 const pairs=p.sources.length*p.points.length;if(pairs>limits.max_pairs||(p.include_sensitivities&&pairs>limits.max_sensitivity_pairs))throw new ResourceError('source-point pair budget exceeded');
 if(Object.hasOwn(p,'metadata')){if(!object(p.metadata))throw Error('metadata must be an object');boundedJSON(p.metadata,limits.max_metadata_bytes);}
 const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
 for(const collection of ['sources','points']){
  const ids=new Set();for(const row of p[collection]){
   keys(row,['id',...coords,...(collection==='sources'?['kind',...moments]:[])]);label(row.id);if(ids.has(row.id))throw Error('source/point IDs must be unique within their collection');ids.add(row.id);
   if(collection==='sources'){if(row.kind!=='dipole')throw Error('source kind must be dipole');for(const key of moments)number(row[key],-1e15,1e15);}
   coords.forEach((k,i)=>{number(row[k],-1e12,1e12);low[i]=Math.min(low[i],row[k]);high[i]=Math.max(high[i],row[k]);});
  }
 }
 if(low.some((v,i)=>high[i]-v>limits.max_axis_span_m))throw new ResourceError('local frame span exceeds 200 km per axis');
 for(const source of p.sources)for(const point of p.points)if(Math.hypot(...coords.map(k=>point[k]-source[k]))<p.min_distance_m)throw new NeedsInput('dipole exclusion distance violated; change geometry or use a finite-body model');
 return p;
}
function kernel(source,point){const d=coords.map(k=>point[k]-source[k]),r=Math.hypot(...d),n=d.map(v=>v/r),scale=factor/r**3;return n.map((_,i)=>n.map((_,j)=>scale*(3*n[i]*n[j]-(i===j?1:0))));}
function field(id,v,background){return {id,bx:zero(v[0]),by:zero(v[1]),bz_up:zero(v[2]),b_down:zero(-v[2]),tmi_linear:background===null?null:zero(sum(v.map((x,i)=>x*(background[i]/Math.hypot(...background)))))};}
function totalField(v,b){return zero(sum(v.map((x,i)=>x*(2*b[i]+x)))/(Math.hypot(...v.map((x,i)=>x+b[i]))+Math.hypot(...b)));}
/** Synthetic nT dipole vectors and linear/exact TMI; fixed-geometry moment sensitivities.
 * Background is required (vector or explicit null). Every failure withholds all results.
 */
export function calculateGeophysicsMagneticForward(request){
 const report={schema:'baselode.geophysics.magnetic_forward_result',version:1,state:'ok',issues:[],model:clone(descriptor.model),request:null,fields:[],sensitivities:[],field_units:clone(descriptor.field_units),diagnostics:{},producer:{library:'baselode',version:typeof __BASELODE_VERSION__==='undefined'?'unversioned':__BASELODE_VERSION__,algorithm_version:1},assumptions:clone(descriptor.assumptions)};
 try{
  const p=prepare(request),background=p.background_nT===null?null:['x','y','z_up'].map(k=>p.background_nT[k]),totals=p.points.map(()=>[0,0,0]),corrections=p.points.map(()=>[0,0,0]);
  for(const source of p.sources){
   const derivatives=[[],[],[]];p.points.forEach((point,i)=>{const matrix=kernel(source,point);matrix.forEach((row,j)=>add(totals[i],corrections[i],j,sum(row.map((v,k)=>v*source[moments[k]]))));if(p.include_sensitivities)for(let k=0;k<3;k++)derivatives[k].push(field(point.id,matrix.map(row=>row[k]),background));});
   if(p.include_sensitivities)moments.forEach((parameter,i)=>report.sensitivities.push({source_id:source.id,parameter,parameter_units:'A*m^2',field_units:clone(descriptor.sensitivity_field_units),fields:derivatives[i]}));
  }
  const ratios=[];p.points.forEach((point,i)=>{const v=totals[i].map((x,k)=>x+corrections[i][k]),f=field(point.id,v,background),exact=background===null?null:totalField(v,background);Object.assign(f,{tmi_exact:exact,linearization_difference:exact===null?null:zero(exact-f.tmi_linear)});if(Object.entries(f).some(([k,x])=>k!=='id'&&x!==null&&!Number.isFinite(x)))throw new BackendError('nonfinite magnetic response');report.fields.push(f);if(background!==null)ratios.push(Math.hypot(...v)/Math.hypot(...background));});
  report.request=p;report.diagnostics={source_count:p.sources.length,point_count:p.points.length,pair_count:p.sources.length*p.points.length,synthetic:true,uncertainty_propagated:false,max_response_to_background_ratio:ratios.length?Math.max(...ratios):null};boundedJSON(report,limits.max_result_bytes,true);
 }catch(error){const context=error instanceof NeedsInput,resource=error instanceof ResourceError,failed=error instanceof BackendError;Object.assign(report,{state:context?'needs_input':failed?'failed':'rejected',fields:[],sensitivities:[],request:null,diagnostics:{},issues:[{code:context?'context':resource?'resource':failed?'backend':'contract',message:error.message}]});}
 return report;
}
