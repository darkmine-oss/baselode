/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import descriptor from './geophysics_sparse_potential_field_inversion.json';
import {boundedJSON,number,keys,NeedsInput,ResourceError} from './geophysicsForwardCommon.js';
import {_preparePotentialFieldGridInversion} from './geophysicsPotentialFieldOperator.js';
const clone=v=>JSON.parse(JSON.stringify(v));
function prepare(request){
 const p=boundedJSON(request,8388608,false,300000);keys(p,['schema','version','operator_request','observed','parameters','regularization','solver','initial_values','penalty','execution'],['metadata']);if(p.schema!=='baselode.geophysics.sparse_potential_field_inversion_request'||p.version!==1)throw Error('unsupported sparse inversion schema/version');
 const execution=p.execution;keys(execution,['max_operator_calls','max_kernel_evaluations']);for(const [key,lo,hi]of [['max_operator_calls',4,16384],['max_kernel_evaluations',1,1000000000]]){number(execution[key],lo,hi);if(!Number.isInteger(execution[key]))throw Error('total execution budgets must be integers');}
 const controls=p.solver;keys(controls,['method','tolerance','max_iterations','lsmr_tolerance','max_inner_iterations','condition_limit','outer_tolerance','max_outer_iterations','max_polish_iterations','max_backtracking_steps']);if(controls.method!=='irls_trf_lsmr')throw Error('sparse inversion requires irls_trf_lsmr');number(controls.outer_tolerance,1e-8,1e-3);number(controls.max_outer_iterations,1,100);if(!Number.isInteger(controls.max_outer_iterations))throw Error('outer iteration budget must be integer');
 number(controls.max_polish_iterations,0,64);if(!Number.isInteger(controls.max_polish_iterations))throw Error('polish iteration budget must be integer');
 number(controls.max_backtracking_steps,0,16);if(!Number.isInteger(controls.max_backtracking_steps))throw Error('backtracking budget must be integer');
 const base=Object.fromEntries(Object.entries(p).filter(([k])=>!['initial_values','penalty','execution'].includes(k)));base.schema='baselode.geophysics.potential_field_grid_inversion_request';base.solver=Object.fromEntries(Object.entries(controls).filter(([k])=>!['outer_tolerance','max_outer_iterations','max_polish_iterations','max_backtracking_steps'].includes(k)));base.solver.method='trf_lsmr';const info=_preparePotentialFieldGridInversion(base);
 const op=p.operator_request,diag=info.diagnostics,dimension=op.model_kind==='magnetic_vector'?3:1,replayCalls=op.channels.includes('magnetic_tmi_anomaly')?6:3;let replayTerms=3*diag.active_cells*diag.observations*dimension;if(replayCalls===6)replayTerms+=9*diag.active_cells*diag.points*dimension;if(op.execution.max_operator_calls<replayCalls||op.execution.max_kernel_evaluations<replayTerms)throw new ResourceError('nested operator budget must cover its standalone fitted forward replay');
 if(!Array.isArray(p.initial_values)||p.initial_values.length!==p.parameters.length)throw Error('initial_values must follow every effective parameter');p.initial_values.forEach((v,i)=>number(v,p.parameters[i].lower,p.parameters[i].upper));
 const penalty=p.penalty;keys(penalty,['model_p','gradient_p','stages']);number(penalty.model_p,0,2);number(penalty.gradient_p,0,2);if(!Array.isArray(penalty.stages)||penalty.stages.length<1||penalty.stages.length>8)throw Error('declare one to eight explicit epsilon stages');let previous=null;
 for(const stage of penalty.stages){keys(stage,['model_epsilon','gradient_epsilon']);for(const value of Object.values(stage))number(value,1e-6,10);const current=[stage.model_epsilon,stage.gradient_epsilon];if(previous&&(current.some((v,i)=>v>previous[i])||current.every((v,i)=>v===previous[i])))throw Error('epsilon stages must be nonincreasing, with at least one strict decrease');previous=current;}
 return {...info,request:p};
}
export function describeGeophysicsSparsePotentialFieldInversion(){return clone(descriptor);}
export function validateGeophysicsSparsePotentialFieldInversion(request){
 const r={schema:'baselode.geophysics.sparse_potential_field_inversion_validation',version:1,state:'ok',issues:[],request:null,active_cell_ids:[],excluded:{},diagnostics:{},predicted:null,backend:null,parameters:[],fitted_operator_request:null,misfit:null,objective:null,convergence:null,penalty_weights:null,history:[],path:[],initial_predicted:null,producer:{library:'baselode',version:typeof __BASELODE_VERSION__==='undefined'?'unversioned':__BASELODE_VERSION__,algorithm_version:1}};
 try{const info=prepare(request);Object.assign(r,{request:info.request,active_cell_ids:info.indices.map(i=>info.request.operator_request.grid.cell_ids[i]),excluded:info.excluded,diagnostics:info.diagnostics});boundedJSON(r,16777216,true,1000000);}
 catch(error){const context=error instanceof NeedsInput,resource=error instanceof ResourceError;Object.assign(r,{state:context?'needs_input':'rejected',issues:[{code:context?'context':resource?'resource':'contract',message:error.message}],request:null,active_cell_ids:[],excluded:{},diagnostics:{}});}
 return r;
}
