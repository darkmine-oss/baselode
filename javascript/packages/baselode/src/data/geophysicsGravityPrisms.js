/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import descriptor from './geophysics_gravity_prisms.json';
import {NeedsInput,ResourceError} from './geophysicsForwardCommon.js';
import {preparePrismGeometry} from './geophysicsPrismGeometry.js';
const clone=v=>JSON.parse(JSON.stringify(v)),limits=descriptor.resources;
/** Shared prism schemas and explicit Python-backend/native-validation capabilities. */
export function describeGeophysicsGravityPrisms(){return clone(descriptor);}
function prepare(request){
 const {request:p,diagnostics}=preparePrismGeometry(request,'baselode.geophysics.gravity_prisms_request',{density_contrast_kg_m3:[-100000,100000]},limits);
 return {request:p,diagnostics};
}
/** Core-only portable validation. Numerical execution uses Python baselode[potential-fields]. */
export function validateGeophysicsGravityPrisms(request){
 const result={schema:'baselode.geophysics.gravity_prisms_validation',version:1,state:'ok',issues:[],request:null,diagnostics:{},producer:{library:'baselode',version:typeof __BASELODE_VERSION__==='undefined'?'unversioned':__BASELODE_VERSION__,algorithm_version:1}};
 try{Object.assign(result,prepare(request));}catch(error){const context=error instanceof NeedsInput,resource=error instanceof ResourceError;Object.assign(result,{state:context?'needs_input':'rejected',issues:[{code:context?'context':resource?'resource':'contract',message:error.message}],request:null,diagnostics:{}});}
 return result;
}
