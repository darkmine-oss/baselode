/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import descriptor from './geophysics_spectrum.json';
import {createGeophysicsRaster} from './geophysicsRaster.js';
import {geophysicsAlignmentGeometry} from './geophysicsAlignment.js';
import {geophysicsCoordinateUnit,geophysicsFft2,geophysicsPlane,fftSize} from './geophysicsProcessing.js';
import {appendInput,encodeProvenance,jsonValue} from './geophysicsProvenance.js';
import {isObservationText,isObservationLabel,trimObservationText,unicodeStrings} from './geophysicsObservations.js';
const clone=v=>JSON.parse(JSON.stringify(v));
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const label=v=>isObservationLabel(v)&&!['unknown','unspecified'].includes(trimObservationText(v).toLowerCase());
class NeedsInput extends Error {}
class BackendError extends Error {}
/** Independent normalization, parameter schemas, directional conventions and budgets. */
export function describeGeophysicsSpectrum(){return clone(descriptor);}
function parameters(options){
  const schema=descriptor.parameters;
  if(!object(options)||Object.keys(options).some(k=>!Object.hasOwn(schema.properties,k)))throw Error('spectrum options must use only registered keys');
  if(schema.required.some(k=>!Object.hasOwn(options,k)))throw new NeedsInput('supply band, detrend, window, radial_bins, direction_bins and missing_policy');
  for(const [key,spec] of Object.entries(schema.properties)){
    const v=options[key];
    if(spec.type==='integer'){if(!Number.isInteger(v)||v<spec.minimum||v>spec.maximum)throw Error(key+' violates its bounded integer schema');}
    else if(typeof v!=='string'||!spec.enum.includes(v))throw Error(key+' requires an explicit supported policy');
  }return clone(options);
}
function prepare(value,options){
  const p=parameters(options),raw=value?.data;
  if(!Array.isArray(raw)||!raw.length)throw Error('expected raster data');
  const bands=Array.isArray(raw[0])&&!Array.isArray(raw[0][0])?[raw]:raw;
  const height=bands[0]?.length,width=bands[0]?.[0]?.length;
  if(!Number.isInteger(height)||!Number.isInteger(width)||Math.min(height,width)<8||height*width>262144||height*width*bands.length>1000000)throw Error('spectrum requires at least 8x8, <=262144 selected cells and <=1000000 total source values');
  if(p.band>bands.length)throw Error('band exceeds source band count');
  if(value.hasExplicitTransform===false||value.transform==null)throw new NeedsInput('declare affine geometry before spectral analysis');
  geophysicsAlignmentGeometry([height,width],value.transform);
  if(!Array.from(bands).every(b=>Array.isArray(b)&&b.length===height&&Array.from(b).every(row=>Array.isArray(row)&&row.length===width&&Array.from(row).every(v=>v===null||v===undefined||(typeof v==='number'&&(!Number.isFinite(v)||v===value.nodata||Math.abs(v)<=1e100))))))throw Error('source values must be real numeric scalars within +/-1e100 or missing');
  const r=createGeophysicsRaster(value);encodeProvenance(r.metadata,'GeoTIFF','float64');unicodeStrings(r.metadata);unicodeStrings(r.crs);
  if(new TextEncoder().encode(JSON.stringify(r.metadata)).length>524288)throw Error('source metadata exceeds 512 KiB spectrum budget');
  const frame=r.metadata.frame_id??null;
  if(frame!==null&&!label(frame))throw Error('frame_id must be a known bounded string or null');
  if(r.crs===null&&frame===null)throw new NeedsInput('declare a projected CRS or known local frame_id');
  if(r.crs!==null&&(!isObservationText(r.crs)||[...r.crs].length>4096||['unknown','unspecified'].includes(trimObservationText(r.crs).toLowerCase())))throw Error('CRS must be a bounded known label');
  if(!label(r.metadata.crs_units))throw new NeedsInput('declare linear coordinate units');
  const unit=geophysicsCoordinateUnit(r),[a,b,,d,e]=r.transform,area=Math.abs(a*e-b*d),dx=Math.hypot(a,d),dy=Math.hypot(b,e);
  if(![a/area,b/area,d/area,e/area,dx,dy].every(Number.isFinite)||Math.abs(a*b+d*e)>1e-9*dx*dy)throw Error('require finite rectangular affine frequency scaling');
  const units=r.metadata.units;
  if(!Array.isArray(units)||units.length!==r.bandCount||!label(units[p.band-1])||!label(r.metadata.field_type))throw new NeedsInput('declare a known scalar field_type and selected per-band units');
  if(!label(r.bandNames[p.band-1]))throw Error('selected band name must be a known bounded string');
  const values=new Float64Array(height*width);let max=0;
  for(let i=0;i<height;i++)for(let j=0;j<width;j++){
    const v=r.data[p.band-1][i][j];if(v===null||!Number.isFinite(v)||v===r.nodata)throw new NeedsInput('selected band has missing cells; crop/select a complete region explicitly, no spectral gap filling');
    values[i*width+j]=v;max=Math.max(max,Math.abs(v));
  }
  const shape=[fftSize(height),fftSize(width)],size=shape[0]*shape[1];
  if(size>1048576)throw Error('spectrum FFT exceeds 1048576 cells');
  const frequencyArea=1/(size*area),bound=64*values.length*max**2*area;
  if(!Number.isFinite(frequencyArea)||frequencyArea<=0||!Number.isFinite(bound))throw Error('value/cell-area scaling exceeds finite power-density range');
  return {r,p,values,shape,frequencyArea,limit:Math.min(1/(2*dx),1/(2*dy)),unit,max};
}
const bin=(scaled,count,axial=false)=>{
  const rounded=Math.round(scaled),value=Math.abs(scaled-rounded)<=1e-10?rounded:scaled,index=Math.floor(value);
  return axial?((index%count)+count)%count:Math.max(0,Math.min(count-1,index));
};
function calculate({r,p,values,shape,frequencyArea,limit,unit,max}){
  const {height,width}=r;let trend;
  if(p.detrend==='none')trend=()=>0;
  else if(p.detrend==='mean'){let sum=0;for(const v of values)sum+=v;const mean=sum/values.length;trend=()=>mean;}
  else{trend=geophysicsPlane(values,new Uint8Array(values.length).fill(1),height,width);if(!trend)throw new NeedsInput('selected region does not support a plane');}
  const size=shape[0]*shape[1],re=new Float64Array(size),im=new Float64Array(size);let energy=0,spatialSum=0;
  for(let row=0;row<height;row++)for(let col=0;col<width;col++){
    const w=p.window==='boxcar'?1:(.5-.5*Math.cos(2*Math.PI*row/height))*(.5-.5*Math.cos(2*Math.PI*col/width));
    const weighted=(values[row*width+col]-trend(row,col))*w;energy+=w*w;spatialSum+=weighted*weighted;re[row*shape[1]+col]=weighted;
  }
  try{geophysicsFft2(re,im,shape[0],shape[1],false);}catch(error){throw new BackendError(error.message);}
  const radial=Array.from({length:p.radial_bins},()=>({count:0,power_sum:0,mean_power_density:null})),directional=Array.from({length:p.direction_bins},()=>({count:0,power_sum:0,mean_power_density:null}));
  const [a,b,,d,e]=r.transform,determinant=a*e-b*d;let total=0,dc=0,outsidePower=0,outsideCount=0,includedPower=0,includedCount=0;
  for(let row=0;row<shape[0];row++)for(let col=0;col<shape[1];col++){
    const i=row*shape[1]+col,power=(re[i]**2+im[i]**2)/(size*energy);if(!Number.isFinite(power))throw new BackendError('nonfinite spectral power');total+=power;
    if(row===0&&col===0){dc=power;continue;}
    const pc=(col<shape[1]/2?col:col-shape[1])/shape[1],pr=(row<shape[0]/2?row:row-shape[0])/shape[0];
    const east=(e*pc-d*pr)/determinant,north=(a*pr-b*pc)/determinant,radius=Math.hypot(east,north);
    if(radius>limit*(1+1e-12)){outsidePower+=power;outsideCount++;continue;}
    includedPower+=power;includedCount++;
    const angle=((Math.atan2(east,north)*180/Math.PI)%180+180)%180;
    for(const target of [radial[bin(radius/limit*p.radial_bins,p.radial_bins)],directional[bin(angle/180*p.direction_bins,p.direction_bins,true)]]){target.count++;target.power_sum+=power;}
  }
  for(const item of [...radial,...directional])item.mean_power_density=item.count?item.power_sum/item.count/frequencyArea:null;
  radial.forEach((item,i)=>{const low=limit*i/p.radial_bins,high=limit*(i+1)/p.radial_bins;Object.assign(item,{frequency_low:low,frequency_high:high,wavelength_low:1/high,wavelength_high:low?1/low:null});});
  directional.forEach((item,i)=>Object.assign(item,{azimuth_low:180*i/p.direction_bins,azimuth_high:180*(i+1)/p.direction_bins}));
  const spatial=spatialSum/energy,tolerance=64*Number.EPSILON*Math.max(1,max),{nodes,operand}=appendInput({},r.metadata);
  const metadata={input_lineage:nodes,processing:[{operation:'analyze_grid_spectrum',version:1,parameters:clone(p),operand_lineage:operand}],uncertainty_propagated:false};encodeProvenance(metadata,'GeoTIFF','float64');
  const sourceUnit=r.metadata.units[p.band-1];
  return {parameters:p,source:{shape:[height,width],band:p.band,band_name:r.bandNames[p.band-1],crs:r.crs,transform:[...r.transform],field_type:r.metadata.field_type},units:{source:sourceUnit,power:'('+sourceUnit+')^2',density:'('+sourceUnit+')^2*'+unit+'^2',frequency:'1/'+unit,wavelength:unit},radial,directional,metadata,diagnostics:{fft_shape:shape,window_energy:energy,frequency_cell_area:frequencyArea,radial_frequency_limit:limit,spectral_total_power:total,windowed_mean_square:spatial,parseval_absolute_error:Math.abs(total-spatial),dc_power:dc,outside_circle_power:outsidePower,outside_circle_count:outsideCount,included_power:includedPower,included_count:includedCount,numerical_amplitude_floor:tolerance,below_numerical_floor:Math.sqrt(total)<=tolerance}};
}
/** Versioned JSON report: explicit spatial periodogram; no gap filling or inferred cutoffs. */
export function analyzeGeophysicsGridSpectrum(raster,options){
  const result={schema:'baselode.geophysics.spectrum_result',version:1,state:'ok',issues:[],radial:[],directional:[],producer:{library:'baselode',version:typeof __BASELODE_VERSION__==='undefined'?'unversioned':__BASELODE_VERSION__,algorithm_version:1,backend:'baselode-native'},assumptions:clone(descriptor.assumptions)};
  try{
    const content=calculate(prepare(raster,options));jsonValue(content);
    if(new TextEncoder().encode(JSON.stringify({...result,...content})).length>2097152)throw Error('spectrum report exceeds 2 MiB');
    Object.assign(result,content);
  }catch(error){result.state=error instanceof NeedsInput?'needs_input':error instanceof BackendError?'failed':'rejected';result.issues=[{code:'spectrum',message:error.message}];}
  return result;
}
