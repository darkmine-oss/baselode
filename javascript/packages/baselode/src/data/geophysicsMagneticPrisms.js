/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import descriptor from './geophysics_magnetic_prisms.json';
import {keys,number,NeedsInput,ResourceError} from './geophysicsForwardCommon.js';
import {preparePrismGeometry} from './geophysicsPrismGeometry.js';
const clone=v=>JSON.parse(JSON.stringify(v)),limits=descriptor.resources,coords=['x_m','y_m','z_m'];
const parameters=['magnetization_x_A_m','magnetization_y_A_m','magnetization_z_up_A_m'];
/** Shared external-only magnetic-prism schema and Python numerical capabilities. */
export function describeGeophysicsMagneticPrisms(){return clone(descriptor);}
// Fixed axis order avoids runtime-specific hypot rounding at boundaries.
function squaredNorm3([x,y,z]){return (x*x+y*y)+z*z;}
function prepare(request){
 const {request:p,geometries,diagnostics}=preparePrismGeometry(request,'baselode.geophysics.magnetic_prisms_request',Object.fromEntries(parameters.map(k=>[k,[-1000,1000]])),limits,['min_distance_m','background_nT']);
 if(p.min_distance_m==null||!Object.hasOwn(p,'background_nT'))throw new NeedsInput('supply min_distance_m and explicit background_nT vector or null');
 number(p.min_distance_m,.001,100000);
 if(p.background_nT!==null){keys(p.background_nT,['x','y','z_up']);for(const v of Object.values(p.background_nT))number(v,-1e6,1e6);const squaredMagnitude=squaredNorm3(['x','y','z_up'].map(k=>p.background_nT[k]));if(squaredMagnitude<1||squaredMagnitude>1e12)throw Error('background magnitude must be between 1 and 1000000 nT');}
 let minimum=Infinity;
 for(const {d,origins}of geometries)for(const point of p.points){const squaredDistance=squaredNorm3(coords.map((k,i)=>{const x=point[k]-origins[i];return Math.max(-x,x-d[i],0);}));const distance=Math.sqrt(squaredDistance);minimum=Math.min(minimum,distance);if(squaredDistance<p.min_distance_m*p.min_distance_m)throw new NeedsInput('every point must be external to every closed prism by min_distance_m; interiors/boundaries and zero-source geometry are excluded');}
 return {request:p,diagnostics:{...diagnostics,min_point_to_prism_distance_m:minimum}};
}
/** Core-only request preparation. Execute numerically with Python baselode[potential-fields]. */
export function validateGeophysicsMagneticPrisms(request){
 const report={schema:'baselode.geophysics.magnetic_prisms_validation',version:1,state:'ok',issues:[],request:null,diagnostics:{},producer:{library:'baselode',version:typeof __BASELODE_VERSION__==='undefined'?'unversioned':__BASELODE_VERSION__,algorithm_version:1}};
 try{Object.assign(report,prepare(request));}catch(error){const context=error instanceof NeedsInput,resource=error instanceof ResourceError;Object.assign(report,{state:context?'needs_input':'rejected',request:null,diagnostics:{},issues:[{code:context?'context':resource?'resource':'contract',message:error.message}]});}
 return report;
}
