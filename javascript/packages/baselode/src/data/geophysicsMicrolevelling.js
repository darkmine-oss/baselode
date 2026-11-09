/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import descriptor from './geophysics_microlevelling.json';
import {createGeophysicsRaster} from './geophysicsRaster.js';
import {geophysicsAlignmentGeometry} from './geophysicsAlignment.js';
import {geophysicsCoordinateUnit,geophysicsFourierBands,fftSize} from './geophysicsProcessing.js';
import {appendInput,encodeProvenance,jsonValue} from './geophysicsProvenance.js';
import {isObservationText,isObservationLabel,trimObservationText,unicodeStrings} from './geophysicsObservations.js';
const clone=value=>JSON.parse(JSON.stringify(value));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const number=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e100;
const label=value=>isObservationLabel(value)&&!['unknown','unspecified'].includes(trimObservationText(value).toLowerCase());
const valid=(value,nodata)=>typeof value==='number'&&Number.isFinite(value)&&value!==nodata;
export class MicrolevellingNeedsInput extends Error {}
/** Independent directional residual model, explicit parameters and resource limits. */
export function describeGeophysicsMicrolevelling(){return clone(descriptor);}

function parameters(options){
  const schema=descriptor.parameters;
  if(!object(options)||Object.keys(options).some(key=>!Object.hasOwn(schema.properties,key)))throw Error('unknown microlevelling options');
  if(schema.required.some(key=>!Object.hasOwn(options,key)))throw new MicrolevellingNeedsInput('supply every explicit microlevelling parameter, including protected_bounds');
  for(const [key,spec] of Object.entries(schema.properties)){
    const value=options[key];
    if(['number','integer'].includes(spec.type)){
      if(!number(value)||(spec.type==='integer'&&!Number.isInteger(value)))throw Error(key+' must be a finite numeric scalar/integer within +/-1e100');
      if((spec.minimum!==undefined&&value<spec.minimum)||(spec.maximum!==undefined&&value>spec.maximum)||(spec.exclusiveMinimum!==undefined&&value<=spec.exclusiveMinimum))throw Error(key+' violates its declared range');
    }else if(spec.type==='string'){
      if(typeof value!=='string'||[...value].length<(spec.minLength??0)||[...value].length>(spec.maxLength??4096))throw Error(key+' must be a bounded string');
      if(spec.enum&&!spec.enum.includes(value))throw Error(key+' requires an explicit supported policy');
    }else if(!Array.isArray(value)||value.length>16||Array.from(value).some(box=>!Array.isArray(box)||box.length!==4||!Array.from(box).every(number)||!(box[0]<box[2]&&box[1]<box[3])))throw Error('protected_bounds requires at most 16 finite positive-area [xmin,ymin,xmax,ymax] boxes');
  }
  jsonValue(options);unicodeStrings(options);
  if(new TextEncoder().encode(JSON.stringify(options)).length>262144)throw Error('microlevelling options exceed 256 KiB');
  if(!isObservationText(options.evidence))throw new MicrolevellingNeedsInput('declare supporting survey/levelling/geometry evidence');
  if(options.along_line_wavelength<2*options.across_line_wavelength||options.across_line_wavelength<2*options.line_spacing)throw Error('require along wavelength >= 2*across wavelength >= 4*line spacing');
  return clone(options);
}

function prepare(value,options){
  const p=parameters(options),raw=value?.data;
  if(value?.hasExplicitTransform===false||!Array.isArray(value?.transform))throw Error('require an explicit affine transform');
  if(!Array.isArray(raw)||!raw.length)throw Error('expected raster data');
  const bands=Array.isArray(raw[0])&&!Array.isArray(raw[0][0])?[raw]:raw;
  const height=bands[0]?.length,width=bands[0]?.[0]?.length;
  if(bands.length!==1||!Number.isInteger(height)||!Number.isInteger(width)||Math.min(height,width)<16||height*width>262144)throw Error('require one band, at least 16x16 and at most 262144 source cells');
  geophysicsAlignmentGeometry([height,width],value.transform);
  if(!bands[0].every(row=>Array.isArray(row)&&row.length===width&&Array.from(row).every(v=>v===null||v===undefined||(typeof v==='number'&&(!Number.isFinite(v)||v===value.nodata||Math.abs(v)<=1e100)))))throw Error('source values must be real numeric scalars within +/-1e100 or missing');
  const r=createGeophysicsRaster(value);
  encodeProvenance(r.metadata,'GeoTIFF','float64');unicodeStrings(r.metadata);unicodeStrings(r.crs);
  const frame=r.metadata.frame_id??null;
  if(frame!==null&&!label(frame))throw Error('frame_id must be a known bounded string or null');
  if(r.crs===null&&frame===null)throw new MicrolevellingNeedsInput('declare a projected CRS or known local frame_id');
  if(r.crs!==null&&(!isObservationText(r.crs)||[...r.crs].length>4096||['unknown','unspecified'].includes(trimObservationText(r.crs).toLowerCase())))throw Error('declare a bounded known CRS label');
  if(!isObservationLabel(r.metadata.crs_units))throw new MicrolevellingNeedsInput('declare linear coordinate units explicitly');
  geophysicsCoordinateUnit(r);
  const [a,b,c,d,e,f]=r.transform,determinant=a*e-b*d;
  if(![a,b,d,e].every(v=>Number.isFinite(v/determinant)))throw Error('inverse affine exceeds backend frequency range');
  const cellX=Math.hypot(a,d),cellY=Math.hypot(b,e);
  if(![cellX,cellY].every(v=>Number.isFinite(v)&&v>0)||Math.abs(a*b+d*e)>1e-9*cellX*cellY)throw Error('require finite positive rectangular cell spacing');
  if(Math.max(cellX,cellY)>p.line_spacing/2)throw Error('cell spacing must be <= half the measured line spacing');
  if(r.metadata.field_type!=='magnetic_anomaly'||JSON.stringify(r.metadata.units)!=='["nT"]')throw Error('require a one-band magnetic_anomaly grid with units [nT]');
  const state=r.metadata.grid_corrections;
  if(!object(state)||state.magnetic_levelling!=='applied'||state.magnetic_microlevelling!=='unapplied')throw new MicrolevellingNeedsInput('verify current metadata.grid_corrections: magnetic_levelling applied, magnetic_microlevelling unapplied');
  if((r.metadata.processing??[]).some(step=>object(step)&&step.operation==='microlevel_magnetic_grid'))throw Error('microlevelling already appears in current-grid history; repeated application is unsupported');
  const azimuth=p.flight_azimuth*Math.PI/180,along=[Math.sin(azimuth),Math.cos(azimuth)],across=[along[1],-along[0]];
  const extent=direction=>Math.abs(a*direction[0]+d*direction[1])*width+Math.abs(b*direction[0]+e*direction[1])*height;
  if(extent(along)<p.along_line_wavelength||extent(across)<4*p.line_spacing)throw Error('grid needs one along cutoff wavelength and at least four measured line spacings across');
  if(![cellX,cellY].every(spacing=>Number.isFinite(p.along_line_wavelength/spacing)))throw Error('wavelength/cell ratio exceeds backend range');
  const padded=(size,spacing)=>fftSize(size+2*Math.min(Math.max(8,Math.ceil(p.along_line_wavelength/spacing)),size));
  const shape=[padded(height,cellY),padded(width,cellX)];
  if(shape[0]*shape[1]>4194304)throw Error('padded FFT exceeds 4194304 cells');
  const training=Array.from({length:height},()=>Array(width).fill(false)),eligible=Array.from({length:height},()=>Array(width).fill(false));
  const hits=p.protected_bounds.map(()=>0);let count=0,protectedCount=0,trainingCount=0,applicationCount=0,maxTraining=0;
  for(let row=0;row<height;row++)for(let col=0;col<width;col++){
    const v=r.data[0][row][col];if(!valid(v,r.nodata))continue;count++;
    const x=a*(col+.5)+b*(row+.5)+c,y=d*(col+.5)+e*(row+.5)+f;
    let protectedCell=false;
    p.protected_bounds.forEach(([xmin,ymin,xmax,ymax],i)=>{if(x>=xmin&&x<=xmax&&y>=ymin&&y<=ymax){hits[i]++;protectedCell=true;}});
    if(protectedCell){protectedCount++;continue;}
    training[row][col]=true;trainingCount++;maxTraining=Math.max(maxTraining,Math.abs(v));
    if(row>=p.edge_margin_cells&&col>=p.edge_margin_cells&&row<height-p.edge_margin_cells&&col<width-p.edge_margin_cells){eligible[row][col]=true;applicationCount++;}
  }
  if(hits.some(n=>n===0))throw Error('every protection box must contain a valid input cell centre');
  const fraction=trainingCount/(height*width);
  if(trainingCount<64||fraction<p.min_training_fraction)throw new MicrolevellingNeedsInput('insufficient unprotected training coverage');
  if(applicationCount===0)throw new MicrolevellingNeedsInput('no supported unprotected interior application cells');
  const diagnostics={input_valid_cells:count,training_cells:trainingCount,training_fraction:fraction,protected_valid_cells:protectedCount,application_cells:applicationCount,padded_fft_shape:shape,uncertainty_propagated:false};
  return {r,p,training,eligible,along,across,diagnostics,maxTraining};
}
/** Internal geometry/support/resource preflight; performs no FFT. */
export function preflightMagneticMicrolevelling(raster,options){return prepare(raster,options).diagnostics;}
function calculate(raster,options,apply){
  const {r,p,training,eligible,along,across,diagnostics:d,maxTraining}=prepare(raster,options);
  const source={...r,nodata:null,data:[r.data[0].map((row,i)=>row.map((v,j)=>training[i][j]?v:null))]};
  const response=(east,north)=>{
    const low=Math.min(32,Math.abs((east*along[0]+north*along[1])*p.along_line_wavelength));
    const high=Math.min(32,Math.abs((east*across[0]+north*across[1])*p.across_line_wavelength));
    return Math.exp(-Math.LN2*low**2)*-Math.expm1(-Math.LN2*high**2);
  };
  const candidate=geophysicsFourierBands(source,response,{keepTrend:false,padLength:p.along_line_wavelength})[0];
  const tolerance=64*Number.EPSILON*Math.max(1,maxTraining);let peak=0,squares=0;
  const correction=r.data[0].map((row,i)=>row.map((v,j)=>{
    if(!valid(v,r.nodata))return null;
    if(!eligible[i][j])return 0;
    const value=candidate[i][j];if(typeof value!=='number'||!Number.isFinite(value))throw Error('nonfinite FFT correction; no product returned');
    const result=Math.abs(value)<=tolerance?0:value;peak=Math.max(peak,Math.abs(result));squares+=result**2;return result;
  }));
  Object.assign(d,{max_abs_correction:peak,correction_rms:Math.sqrt(squares/d.application_cells),application_supported:peak<=p.max_abs_correction,numerical_zero_tolerance:tolerance,response_at_line_spacing:1-2**(-(Math.min(32,p.across_line_wavelength/p.line_spacing)**2))});
  if(apply&&!d.application_supported)throw Error('estimated correction exceeds max_abs_correction; inspect candidate and geology, no clipping/application');
  const operation=apply?'microlevel_magnetic_grid':'estimate_magnetic_microlevelling',m={};
  for(const key of ['crs_units','frame_id'])if(Object.hasOwn(r.metadata,key))m[key]=clone(r.metadata[key]);
  const {nodes,operand}=appendInput({},r.metadata);
  Object.assign(m,{field_type:apply?'magnetic_anomaly':'other',units:['nT'],uncertainty_propagated:false,input_lineage:nodes,processing:[{operation,version:1,parameters:clone(p),operand_lineage:operand}],microlevelling:{kind:apply?'applied':'estimated_correction',model:clone(descriptor.model),parameters:clone(p),diagnostics:d}});
  if(apply)m.grid_corrections={...clone(r.metadata.grid_corrections),magnetic_microlevelling:'applied'};
  encodeProvenance(m,'GeoTIFF','float64');
  const data=apply?[r.data[0].map((row,i)=>row.map((v,j)=>correction[i][j]===null?null:v-correction[i][j]))]:[correction];
  return createGeophysicsRaster({...r,data,nodata:null,bandNames:apply?r.bandNames:['microlevelling_correction'],metadata:m});
}
/** Estimate a correction (other/nT), retaining masks/protection/edges and cap diagnostics. */
export function estimateGeophysicsMagneticMicrolevelling(raster,options){return calculate(raster,options,false);}
/** Subtract from the original verified grid; reject caps/repetition, never clip. */
export function microlevelGeophysicsMagneticGrid(raster,options){return calculate(raster,options,true);}
