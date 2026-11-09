/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import {trimObservationText,isObservationText,isObservationLabel,unicodeStrings} from './geophysicsObservations.js';
import descriptor from './geophysics_radiometrics.json';
import {createGeophysicsRaster} from './geophysicsRaster.js';
import {appendInput,encodeProvenance,jsonValue} from './geophysicsProvenance.js';
const clone=v=>JSON.parse(JSON.stringify(v));
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const label=v=>isObservationLabel(v)&&!['unknown','unspecified'].includes(trimObservationText(v).toLowerCase());
const number=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e100;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const valid=(v,nodata)=>v!==null&&v!==undefined&&Number.isFinite(v)&&v!==nodata;
export class RadiometricNeedsInput extends Error {}
/** Independent corrected-concentration/ratio/ternary contracts and limits. */
export function describeGeophysicsRadiometrics(){return clone(descriptor);}
function asRaster(value){
  if(!Array.isArray(value?.transform)||value.transform.length!==6)throw Error('require an explicit affine transform');
  const raw=value?.data;if(!Array.isArray(raw)||!raw.length)throw Error('expected raster data');
  const bands=Array.isArray(raw[0])&&!Array.isArray(raw[0][0])?[raw]:raw;
  if(!Array.isArray(bands[0])||!Array.isArray(bands[0][0])||bands.length*bands[0].length*bands[0][0].length>1000000)throw Error('radiometrics accepts at most 1000000 input cell values');
  return createGeophysicsRaster(value);
}
function policy(reference,evidence,negative='mask'){
  if(reference!=='caller_verified'||!isObservationText(evidence)||[...evidence].length>4096)throw new RadiometricNeedsInput('declare caller_verified corrected concentrations and bounded supporting evidence');
  unicodeStrings(evidence);
  if(negative!=='mask')throw Error('negative_policy must be mask; no clipping or pseudocounts');
}
function context(r,stack){
  unicodeStrings(r.metadata);unicodeStrings(r.crs);encodeProvenance(r.metadata,'GeoTIFF','float64');const t=r.transform;
  if(!Array.isArray(t)||t.length!==6||!t.every(Number.isFinite)||!Number.isFinite(t[0]*t[4]-t[1]*t[3])||t[0]*t[4]-t[1]*t[3]===0)throw Error('require a finite invertible affine transform');
  for(const col of [0,r.width])for(const row of [0,r.height])if(!Number.isFinite(t[0]*col+t[1]*row+t[2])||!Number.isFinite(t[3]*col+t[4]*row+t[5]))throw Error('affine grid coordinates exceed finite range');
  if(r.crs===null&&!label(r.metadata.frame_id))throw new RadiometricNeedsInput('declare a raster CRS or local metadata.frame_id');
  if(r.crs!==null&&(!isObservationText(r.crs)||[...r.crs].length>4096||['unknown','unspecified'].includes(trimObservationText(r.crs).toLowerCase())))throw Error('CRS must be a bounded known label');
  if(!label(r.metadata.crs_units))throw new RadiometricNeedsInput('declare shared coordinate units; pointwise products allow degrees');
  const c=r.metadata.radiometric;
  if(r.metadata.field_type!=='radiometric'||!object(c)||c.state!=='corrected_concentration')throw new RadiometricNeedsInput('declare field_type radiometric and corrected_concentration context, not raw counts');
  if(!number(c.reference_height_m)||!label(c.height_datum))throw new RadiometricNeedsInput('declare common reference_height_m and height_datum');
  if(stack){
    if(r.bandCount!==3||!equal(r.bandNames,['K','eU','eTh'])||!equal(r.metadata.units,['%','ppm','ppm']))throw Error('canonical stack must be K(%), eU(ppm), eTh(ppm) in that order');
    if(!Array.isArray(c.calibration_ids)||c.calibration_ids.length!==3||!c.calibration_ids.every(label))throw new RadiometricNeedsInput('declare all three calibration_ids in K/eU/eTh order');
  }else{
    if(r.bandCount!==1||!['K','eU','eTh'].includes(c.element)||!equal(r.metadata.units,[c.element==='K'?'%':'ppm']))throw Error('single-band source must identify K(%), eU(ppm) or eTh(ppm)');
    if(!label(c.calibration_id))throw new RadiometricNeedsInput('declare each source calibration_id');
  }return c;
}
function metadata(sources,operation,params,units,diagnostics){
  const first=sources[0],m={field_type:operation==='stack_radiometric_grids'?'radiometric':'other',units,uncertainty_propagated:false,input_lineage:[],processing:[]};
  for(const k of ['crs_units','frame_id'])if(Object.hasOwn(first.metadata,k))m[k]=clone(first.metadata[k]);
  sources.forEach((s,i)=>{const {nodes,operand}=appendInput(m,s.metadata);m.input_lineage=nodes;m.processing.push({operation:operation+'_input',version:1,input_index:i,operand_lineage:operand});});
  m.processing.push({operation,version:1,parameters:clone(params),diagnostics:clone(diagnostics)});
  if(operation!=='stack_radiometric_grids')m.radiometric_product={kind:operation,source_order:['K','eU','eTh'],version:1};
  encodeProvenance(m,'GeoTIFF','float64');return m;
}
/** Stack exactly aligned corrected K(%), eU(ppm), eTh(ppm) grids; no implicit alignment. */
export function stackGeophysicsRadiometricGrids(potassium,uranium,thorium,options){
  if(!object(options)||Object.keys(options).sort().join(',')!=='evidence,reference_policy')throw Error('supply exactly reference_policy and evidence');policy(options.reference_policy,options.evidence);
  const sources=[potassium,uranium,thorium].map(asRaster),contexts=sources.map(s=>context(s,false)),first=sources[0];
  if(sources.reduce((n,s)=>n+s.bandCount*s.width*s.height,0)>1000000)throw Error('stack exceeds 1000000 total input cell values');
  sources.forEach((s,i)=>{
    const c=contexts[i];if(c.element!==['K','eU','eTh'][i])throw Error('source roles must be potassium, uranium, thorium');
    if(s.width!==first.width||s.height!==first.height||!equal(s.transform,first.transform)||s.crs!==first.crs||s.metadata.crs_units!==first.metadata.crs_units||(s.metadata.frame_id??null)!==(first.metadata.frame_id??null))throw Error('source grids require exactly matching geometry/CRS/frame/coordinate units; align explicitly first');
    if(c.reference_height_m!==contexts[0].reference_height_m||c.height_datum!==contexts[0].height_datum)throw Error('source concentration reference height/datum must match');
  });
  const data=sources.map(s=>s.data[0].map(row=>row.map(v=>valid(v,s.nodata)?v:null)));
  const m=metadata(sources,'stack_radiometric_grids',options,['%','ppm','ppm'],{});m.radiometric={state:contexts[0].state,reference_height_m:contexts[0].reference_height_m,height_datum:contexts[0].height_datum,calibration_ids:contexts.map(c=>c.calibration_id)};
  encodeProvenance(m,'GeoTIFF','float64');
  return createGeophysicsRaster({...first,data,metadata:m,bandNames:['K','eU','eTh'],nodata:null});
}
function parameters(operation,options){
  const schema=descriptor[operation==='radiometric_ratios'?'ratio_parameters':'ternary_parameters'];
  if(!object(options)||Object.keys(options).some(k=>!Object.hasOwn(schema.properties,k)))throw Error('unknown radiometric parameter');jsonValue(options);unicodeStrings(options);const p=clone(options);if(!Object.hasOwn(p,'negative_policy'))p.negative_policy='mask';
  if(schema.required.some(k=>!Object.hasOwn(p,k)))throw new RadiometricNeedsInput('supply every explicit floor/stretch/gamma/reference/evidence parameter');
  if(new TextEncoder().encode(JSON.stringify(p)).length>262144)throw Error('radiometric parameters exceed 256 KiB');policy(p.reference_policy,p.evidence,p.negative_policy);
  const names=operation==='radiometric_ratios'?['potassium_floor','thorium_floor']:['k_min','k_max','u_min','u_max','th_min','th_max','gamma'];if(names.some(k=>!number(p[k])))throw Error('radiometric parameters require finite numeric values');
  if(operation==='radiometric_ratios'){if(names.some(k=>!(p[k]>0&&p[k]<=1000000)))throw Error('explicit positive concentration floors <=1000000 required');}
  else if(!(p.gamma>=.1&&p.gamma<=10)||[['k_min','k_max'],['u_min','u_max'],['th_min','th_max']].some(([lo,hi])=>!(p[lo]>=0&&p[lo]<p[hi]&&p[hi]<=1e100)))throw Error('require finite nonnegative low < high stretches and gamma in [0.1,10]');
  return p;
}
/** Internal shared workflow preflight; checks support without retaining products. */
export function preflightRadiometricProduct(raster,operation,options){return calculate(raster,operation,options,true);}
function calculate(raster,operation,options,preflight=false){
  const r=asRaster(raster);context(r,true);const p=parameters(operation,options),ratio=operation==='radiometric_ratios';
  const out=Array.from({length:3},()=>Array.from({length:r.height},()=>Array(r.width).fill(null)));
  const d={input_missing_or_negative:[0,0,0]};if(ratio)Object.assign(d,{valid_counts:[0,0,0],unsupported_counts:[0,0,0],nonfinite_result_counts:[0,0,0]});else Object.assign(d,{valid_count:0,unsupported_count:0,clipped:Array.from({length:3},()=>({below:0,above:0}))});
  for(let i=0;i<r.height;i++)for(let j=0;j<r.width;j++){
    const v=r.data.map(b=>b[i][j]),ok=v.map(x=>valid(x,r.nodata)&&x>=0);ok.forEach((x,b)=>{if(!x)d.input_missing_or_negative[b]++;});
    if(ratio){[[2,0,p.potassium_floor],[1,0,p.potassium_floor],[1,2,p.thorium_floor]].forEach(([num,den,floor],b)=>{
      if(ok[num]&&ok[den]&&v[den]>=floor){const result=v[num]/v[den];if(Number.isFinite(result)){out[b][i][j]=result;d.valid_counts[b]++;}else d.nonfinite_result_counts[b]++;}
    });}else if(ok.every(Boolean)){
      d.valid_count++;[[0,'k_min','k_max'],[2,'th_min','th_max'],[1,'u_min','u_max']].forEach(([source,lo,hi],b)=>{
        if(v[source]<p[lo])d.clipped[b].below++;if(v[source]>p[hi])d.clipped[b].above++;
        const bounded=Math.min(p[hi],Math.max(p[lo],v[source]));out[b][i][j]=Math.min(1,Math.max(0,(bounded-p[lo])/(p[hi]-p[lo])))**(1/p.gamma);
      });
    }
  }
  if(ratio)d.unsupported_counts=d.valid_counts.map(n=>r.width*r.height-n);else d.unsupported_count=r.width*r.height-d.valid_count;
  if(ratio?!d.valid_counts.some(n=>n>0):d.valid_count===0)throw new RadiometricNeedsInput('no supported radiometric product cells; review data, masks and explicit thresholds');
  if(preflight)return d;const spec=descriptor[ratio?'ratio_outputs':'ternary_outputs'];
  return createGeophysicsRaster({...r,data:out,bandNames:spec.bands,nodata:null,metadata:metadata([r],operation,p,spec.units,d)});
}
/** Quantitative eTh/K and eU/K in ppm/%, eU/eTh in 1, independent dependency masks. */
export function calculateGeophysicsRadiometricRatios(raster,options){return calculate(raster,'radiometric_ratios',options);}
/** Fixed nonnegative linear stretches and gamma; normalized K red/eTh green/eU blue. */
export function createGeophysicsRadiometricTernary(raster,options){return calculate(raster,'radiometric_ternary',options);}
