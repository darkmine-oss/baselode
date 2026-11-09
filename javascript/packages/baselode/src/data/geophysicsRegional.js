/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import descriptor from './geophysics_regional.json';
import {createGeophysicsRaster} from './geophysicsRaster.js';
import {geophysicsAlignmentGeometry} from './geophysicsAlignment.js';
import {geophysicsCoordinateUnit} from './geophysicsProcessing.js';
import {appendInput,encodeProvenance} from './geophysicsProvenance.js';
import {isObservationText,isObservationLabel,trimObservationText,unicodeStrings} from './geophysicsObservations.js';
const clone=v=>JSON.parse(JSON.stringify(v));
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const number=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e100;
const label=v=>isObservationLabel(v)&&!['unknown','unspecified'].includes(trimObservationText(v).toLowerCase());
const terms=[['1'],['1','u','v'],['1','u','v','u^2','u*v','v^2']];
const huber=['huber_threshold','max_iterations','convergence_tolerance'];
class NeedsInput extends Error{constructor(message,diagnostics={}){super(message);this.diagnostics=diagnostics;}}
class BackendError extends Error{}
/** Independent polynomial/estimator, source-domain/training and resource contracts. */
export function describeGeophysicsRegionalTrend(){return clone(descriptor);}
function parameters(options){
  const schema=descriptor.parameters;
  if(!object(options)||Object.keys(options).some(k=>!Object.hasOwn(schema.properties,k)))throw Error('regional options must use registered keys');
  if(schema.required.some(k=>!Object.hasOwn(options,k)))throw new NeedsInput('supply every explicit band/degree/estimator/training/condition/domain option');
  const robust=options.estimator==='huber';
  if(robust&&huber.some(k=>!Object.hasOwn(options,k)))throw new NeedsInput('Huber requires threshold, iteration limit and convergence tolerance');
  if(!robust&&huber.some(k=>Object.hasOwn(options,k)))throw Error('least_squares forbids unused Huber controls');
  for(const [key,v]of Object.entries(options)){
    const spec=schema.properties[key];
    if(['number','integer'].includes(spec.type)){
      if(!number(v)||(spec.minimum!==undefined&&v<spec.minimum)||(spec.maximum!==undefined&&v>spec.maximum)||(spec.exclusiveMinimum!==undefined&&v<=spec.exclusiveMinimum)||(spec.type==='integer'&&!Number.isInteger(v)))throw Error(key+' violates its finite numeric range/integer schema');
    }else if(spec.type==='string'){if(typeof v!=='string'||!spec.enum.includes(v))throw Error(key+' requires an explicit supported policy');}
    else if(!Array.isArray(v)||v.length>16||Array.from(v).some(box=>!Array.isArray(box)||box.length!==4||!Array.from(box).every(number)||!(box[0]<box[2]&&box[1]<box[3])))throw Error('exclude_bounds requires <=16 finite positive-area [xmin,ymin,xmax,ymax] boxes');
  }
  if(robust&&options.convergence_tolerance>.01*options.huber_threshold)throw Error('convergence_tolerance must be <=0.01*huber_threshold, in field units');
  return clone(options);
}
function prepare(value,options){
  const p=parameters(options),raw=value?.data;
  if(!Array.isArray(raw)||!raw.length)throw Error('expected raster data');
  const bands=Array.isArray(raw[0])&&!Array.isArray(raw[0][0])?[raw]:raw,height=bands[0]?.length,width=bands[0]?.[0]?.length;
  if(!Number.isInteger(height)||!Number.isInteger(width)||Math.min(height,width)<8||height*width>262144||height*width*bands.length>1000000)throw Error('require >=8x8, <=262144 selected cells and <=1000000 source values');
  if(p.band>bands.length)throw Error('band exceeds source band count');
  if(value.hasExplicitTransform===false||value.transform==null)throw new NeedsInput('declare affine geometry');
  geophysicsAlignmentGeometry([height,width],value.transform);
  if(!Array.from(bands).every(b=>Array.isArray(b)&&b.length===height&&Array.from(b).every(row=>Array.isArray(row)&&row.length===width&&Array.from(row).every(v=>v===null||v===undefined||(typeof v==='number'&&(!Number.isFinite(v)||v===value.nodata||Math.abs(v)<=1e100))))))throw Error('source cells must be real numeric scalars within +/-1e100 or missing');
  if(value.bandNames!=null){const name=value.bandNames[p.band-1];if(!label(name))throw Error('selected band name must be known and bounded');unicodeStrings(name);}
  const r=createGeophysicsRaster(value);encodeProvenance(r.metadata,'GeoTIFF','float64');unicodeStrings(r.metadata);unicodeStrings(r.crs);
  if(new TextEncoder().encode(JSON.stringify(r.metadata)).length>524288)throw Error('regional source metadata exceeds 512 KiB');
  const frame=r.metadata.frame_id??null;if(frame!==null&&!label(frame))throw Error('frame_id must be a known bounded string or null');
  if(r.crs===null&&frame===null)throw new NeedsInput('declare projected CRS or known local frame_id');
  if(r.crs!==null&&(!isObservationText(r.crs)||[...r.crs].length>4096||['unknown','unspecified'].includes(trimObservationText(r.crs).toLowerCase())))throw Error('CRS must be a bounded known label');
  if(!label(r.metadata.crs_units))throw new NeedsInput('declare linear coordinate units');geophysicsCoordinateUnit(r);
  const [a,b,c,d,e,f]=r.transform,dx=Math.hypot(a,d),dy=Math.hypot(b,e);
  if(Math.abs(a*b+d*e)>1e-9*dx*dy)throw Error('require rectangular affine geometry');
  if(!Array.isArray(r.metadata.units)||r.metadata.units.length!==r.bandCount||!label(r.metadata.units[p.band-1])||!label(r.metadata.field_type))throw new NeedsInput('declare scalar field_type and selected per-band units');
  if(!label(r.bandNames[p.band-1]))throw Error('selected band name must be known and bounded');unicodeStrings(r.bandNames[p.band-1]);
  const size=height*width,values=new Float64Array(size),valid=new Uint8Array(size),training=new Uint8Array(size),hits=p.exclude_bounds.map(()=>0);
  let validCount=0,count=0,excludedCount=0;const bounds=[width,height,-1,-1];
  for(let row=0;row<height;row++)for(let col=0;col<width;col++){
    const v=r.data[p.band-1][row][col],index=row*width+col;if(v===null||!Number.isFinite(v)||v===r.nodata)continue;valid[index]=1;values[index]=v;validCount++;
    const x=a*(col+.5)+b*(row+.5)+c,y=d*(col+.5)+e*(row+.5)+f;let excluded=false;
    p.exclude_bounds.forEach(([xmin,ymin,xmax,ymax],i)=>{if(x>=xmin&&x<=xmax&&y>=ymin&&y<=ymax){hits[i]++;excluded=true;}});
    if(excluded){excludedCount++;continue;}training[index]=1;count++;bounds[0]=Math.min(bounds[0],col);bounds[1]=Math.min(bounds[1],row);bounds[2]=Math.max(bounds[2],col);bounds[3]=Math.max(bounds[3],row);
  }
  if(hits.some(n=>n===0))throw Error('each exclusion box must contain a valid source cell centre');
  const fraction=count/size;if(count<64||fraction<p.min_training_fraction)throw new NeedsInput('insufficient non-excluded training coverage');
  const n=terms[p.degree].length,solves=p.estimator==='huber'?1+p.max_iterations:1,work=(count*n*n+validCount*n)*solves;
  if(work>100000000)throw Error('regional fit work exceeds 100000000; reduce region/degree/iteration limit explicitly');
  const design=new Float64Array(size*n),indices=[];let outside=0;
  for(let row=0;row<height;row++)for(let col=0;col<width;col++){
    const i=row*width+col,u=(col-(width-1)/2)/((width-1)/2),v=(row-(height-1)/2)/((height-1)/2),features=p.degree===0?[1]:p.degree===1?[1,u,v]:[1,u,v,u*u,u*v,v*v];design.set(features,i*n);if(training[i])indices.push(i);if(valid[i]&&(col<bounds[0]||row<bounds[1]||col>bounds[2]||row>bounds[3]))outside++;
  }
  return {r,p,values,valid,training,design,indices,n,diagnostics:{valid_cells:validCount,training_cells:count,training_fraction:fraction,excluded_valid_cells:excludedCount,training_index_bounds:bounds,valid_cells_outside_training_bounds:outside,fit_work_estimate:work}};
}
function solve(design,values,indices,n,weights,maximum){
  const gram=Array.from({length:n},()=>Array(n).fill(0)),rhs=Array(n).fill(0);
  indices.forEach((i,k)=>{for(let j=0;j<n;j++){const x=design[i*n+j];rhs[j]+=weights[k]*x*values[i];for(let q=0;q<n;q++)gram[j][q]+=weights[k]*x*design[i*n+q];}});
  const norm=Math.max(...gram.map(row=>row.reduce((s,v)=>s+Math.abs(v),0))),scale=Math.max(...gram.flat().map(Math.abs));
  const aug=gram.map((row,i)=>[...row,...Array.from({length:n},(_,j)=>i===j?1:0),rhs[i]]);
  for(let j=0;j<n;j++){
    let pivot=j;for(let i=j+1;i<n;i++)if(Math.abs(aug[i][j])>Math.abs(aug[pivot][j]))pivot=i;
    if(!Number.isFinite(aug[pivot][j])||Math.abs(aug[pivot][j])<=1e-14*scale)throw new NeedsInput('training is rank deficient; change coverage or polynomial degree');
    [aug[j],aug[pivot]]=[aug[pivot],aug[j]];const divisor=aug[j][j];for(let k=0;k<=2*n;k++)aug[j][k]/=divisor;
    for(let i=0;i<n;i++){if(i===j)continue;const factor=aug[i][j];for(let k=0;k<=2*n;k++)aug[i][k]-=factor*aug[j][k];}
  }
  const inverseNorm=Math.max(...aug.map(row=>row.slice(n,2*n).reduce((s,v)=>s+Math.abs(v),0))),condition=norm*inverseNorm;
  if(!Number.isFinite(condition)||condition>maximum)throw new NeedsInput('weighted normal matrix exceeds max_condition',{normal_condition:Number.isFinite(condition)?condition:null});
  const coefficients=aug.map(row=>row[2*n]);if(!coefficients.every(Number.isFinite))throw new NeedsInput('fit coefficients exceed numerical range');return {coefficients,condition};
}
const predict=(design,n,i,coefficients)=>{let sum=0;for(let j=0;j<n;j++)sum+=design[i*n+j]*coefficients[j];return sum;};
function fit(ctx){
  const {p,design,values,valid,indices,n,diagnostics:d}=ctx,weights=new Float64Array(indices.length).fill(1);
  let {coefficients,condition}=solve(design,values,indices,n,weights,p.max_condition),iteration=0,change=0,converged=p.estimator!=='huber';
  if(p.estimator==='huber')for(iteration=1;iteration<=p.max_iterations;iteration++){
    indices.forEach((i,k)=>{const residual=Math.abs(values[i]-predict(design,n,i,coefficients));weights[k]=residual>p.huber_threshold?p.huber_threshold/residual:1;});
    const proposed=solve(design,values,indices,n,weights,p.max_condition);condition=proposed.condition;const delta=proposed.coefficients.map((v,j)=>v-coefficients[j]);change=0;
    for(let i=0;i<values.length;i++)if(valid[i])change=Math.max(change,Math.abs(predict(design,n,i,delta)));coefficients=proposed.coefficients;
    if(change<=p.convergence_tolerance){converged=true;break;}
  }
  if(!converged)throw new NeedsInput('Huber IRLS did not converge; no artifacts returned',{...d,iterations:p.max_iterations,converged:false,last_max_change:change,normal_condition:condition});
  const surface=new Float64Array(values.length);let down=0,squares=0,peak=0;
  for(let i=0;i<values.length;i++){surface[i]=predict(design,n,i,coefficients);if(valid[i]&&!Number.isFinite(surface[i]))throw new NeedsInput('regional prediction exceeds numerical range');}
  for(const i of indices){const residual=values[i]-surface[i];squares+=residual*residual;peak=Math.max(peak,Math.abs(residual));if(p.estimator==='huber'&&Math.abs(residual)>p.huber_threshold)down++;}
  Object.assign(d,{normal_condition:condition,iterations:p.estimator==='huber'?iteration:1,converged:true,last_max_change:change,downweighted_training_cells:down,training_residual_rms:Math.sqrt(squares/indices.length),max_abs_training_residual:peak});
  return {coefficients,surface};
}
/** Native regional/residual/training-mask report; explicit source-footprint model, no automatic geology interpretation. */
export function fitGeophysicsRegionalTrend(raster,options){
  const result={schema:'baselode.geophysics.regional_result',version:1,state:'ok',issues:[],artifacts:{},diagnostics:{},producer:{library:'baselode',version:typeof __BASELODE_VERSION__==='undefined'?'unversioned':__BASELODE_VERSION__,algorithm_version:1,backend:'baselode-native'},assumptions:clone(descriptor.assumptions)};
  try{
    const ctx=prepare(raster,options),{r,p,values,valid,training,diagnostics:d}=ctx;Object.assign(result,{parameters:clone(p),diagnostics:clone(d)});
    let fitted;try{fitted=fit(ctx);}catch(error){if(error instanceof NeedsInput)throw error;throw new BackendError(error.message);}
    const {coefficients,surface}=fitted,model={algorithm:'polynomial_regional_v1',degree:p.degree,terms:[...terms[p.degree]],coefficients:[...coefficients],index_origin:[(r.width-1)/2,(r.height-1)/2],index_scale:[(r.width-1)/2,(r.height-1)/2],source_geometry:{shape:[r.height,r.width],transform:[...r.transform],crs:r.crs},source_band:p.band,source_band_name:r.bandNames[p.band-1],estimator:p.estimator};
    const artifacts={};
    for(const kind of ['regional','residual','training_mask']){
      const isMask=kind==='training_mask',{nodes,operand}=appendInput({},r.metadata),m={};for(const key of ['crs_units','frame_id'])if(Object.hasOwn(r.metadata,key))m[key]=clone(r.metadata[key]);
      Object.assign(m,{field_type:isMask?'other':r.metadata.field_type,units:[isMask?'1':r.metadata.units[p.band-1]],uncertainty_propagated:false,input_lineage:nodes,processing:[{operation:'fit_regional_trend',version:1,parameters:clone(p),operand_lineage:operand}],regional_trend:{kind,model:clone(model),parameters:clone(p),diagnostics:clone(d)}});encodeProvenance(m,'GeoTIFF','float64');
      const data=[Array.from({length:r.height},(_,row)=>Array.from({length:r.width},(_,col)=>{const i=row*r.width+col;return !valid[i]?null:isMask?training[i]:kind==='regional'?surface[i]:values[i]-surface[i];}))];artifacts[kind]=createGeophysicsRaster({...r,data,nodata:null,bandNames:[kind],metadata:m});
    }Object.assign(result,{parameters:p,model,diagnostics:d,artifacts});
  }catch(error){result.state=error instanceof NeedsInput?'needs_input':error instanceof BackendError?'failed':'rejected';result.issues=[{code:result.state==='failed'?'backend':'regional',message:error.message}];if(error instanceof NeedsInput)result.diagnostics={...result.diagnostics,...clone(error.diagnostics)};}
  return result;
}
