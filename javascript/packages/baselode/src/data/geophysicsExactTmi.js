/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import forwardDescriptor from './geophysics_exact_tmi_operator.json';
import inverseDescriptor from './geophysics_exact_tmi_inversion.json';
import {boundedJSON,number,keys,object,NeedsInput,ResourceError} from './geophysicsForwardCommon.js';
import {_preparePotentialFieldOperator,_preparePotentialFieldGridInversion} from './geophysicsPotentialFieldOperator.js';
const clone=v=>JSON.parse(JSON.stringify(v));
function prepare(request,inverse){
 const p=boundedJSON(request,8388608,false,300000),required=['schema','version','operator_request','field_norm_floor_nT'];
 if(inverse)required.push('observed','parameters','regularization','solver','initial_values');
 keys(p,required,['metadata']);const kind=inverse?'exact_tmi_inversion':'exact_tmi_operator';
 if(p.schema!=='baselode.geophysics.'+kind+'_request'||p.version!==1)throw Error('unsupported exact-TMI schema/version');
 number(p.field_norm_floor_nT,1e-8,1e6);let info;
 if(inverse){const s=p.solver;keys(s,['method','tolerance','max_function_evaluations','lsmr_tolerance','max_inner_iterations','condition_limit']);if(s.method!=='trf_lsmr_exact_tmi')throw Error('exact TMI requires bounded trf_lsmr_exact_tmi');const base=Object.fromEntries(Object.entries(p).filter(([k])=>!['field_norm_floor_nT','initial_values'].includes(k)));base.schema='baselode.geophysics.potential_field_grid_inversion_request';base.solver=Object.fromEntries(Object.entries(s).filter(([k])=>!['method','max_function_evaluations'].includes(k)));Object.assign(base.solver,{method:'trf_lsmr',max_iterations:s.max_function_evaluations});info=_preparePotentialFieldGridInversion(base,true);if(!Array.isArray(p.initial_values)||p.initial_values.length!==p.parameters.length)throw Error('initial_values must follow every effective parameter');p.initial_values.forEach((v,i)=>number(v,p.parameters[i].lower,p.parameters[i].upper));}
 else info=_preparePotentialFieldOperator(p.operator_request,true);
 const op=p.operator_request;if(!['susceptibility','magnetic_vector'].includes(op.model_kind)||op.channels.length!==1||op.channels[0]!=='magnetic_tmi_anomaly')throw Error('exact TMI requires susceptibility or Cartesian-J and one TMI channel');
 if(Object.hasOwn(p,'metadata')){if(!object(p.metadata))throw Error('metadata must be object');boundedJSON(p.metadata,131072);}
 return {...info,request:p};
}
function validate(request,inverse){
 const kind=inverse?'exact_tmi_inversion':'exact_tmi_operator';const r={schema:'baselode.geophysics.'+kind+'_validation',version:1,state:'ok',issues:[],request:null,active_cell_ids:[],excluded:{},diagnostics:{},predicted:null,backend:null,linear_predicted:null,vector_fields:null,total_field_norms_nT:null,producer:{library:'baselode',version:typeof __BASELODE_VERSION__==='undefined'?'unversioned':__BASELODE_VERSION__,algorithm_version:1}};
 if(inverse)Object.assign(r,{parameters:[],fitted_forward_request:null,misfit:null,linear_misfit:null,objective:null,convergence:null,initial_predicted:null});
 try{const info=prepare(request,inverse);Object.assign(r,{request:info.request,active_cell_ids:info.indices.map(i=>info.request.operator_request.grid.cell_ids[i]),excluded:info.excluded,diagnostics:info.diagnostics});boundedJSON(r,16777216,true,1000000);}
 catch(error){const context=error instanceof NeedsInput,resource=error instanceof ResourceError;Object.assign(r,{state:context?'needs_input':'rejected',issues:[{code:context?'context':resource?'resource':'contract',message:error.message}],request:null,active_cell_ids:[],excluded:{},diagnostics:{}});}
 return r;
}
export function describeGeophysicsExactTmiOperator(){return clone(forwardDescriptor);}
export function validateGeophysicsExactTmiOperator(request){return validate(request,false);}
export function describeGeophysicsExactTmiInversion(){return clone(inverseDescriptor);}
export function validateGeophysicsExactTmiInversion(request){return validate(request,true);}
