/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import density from './geophysics_density_inversion.json';
import {boundedJSON,keys,number,object,NeedsInput,ResourceError} from './geophysicsForwardCommon.js';
import {prepareGeophysicsBlockForward} from './geophysicsBlockForward.js';
import {calculateGeophysicsMisfit} from './geophysicsMisfit.js';
const descriptors={density},clone=v=>JSON.parse(JSON.stringify(v));
export function describeGeophysicsDensityInversion(){return clone(density);}
function raiseValidation(report){if(report.state==='ok')return;const {code,message}=report.issues[0];if(code==='context')throw new NeedsInput(message);if(code==='resource')throw new ResourceError(message);throw Error(message);}
function prepare(request,kind){
 const p=boundedJSON(request,2097152);keys(p,['schema','version','forward_request','observed','parameters','regularization','solver'],['metadata']);if(p.schema!=='baselode.geophysics.'+kind+'_inversion_request'||p.version!==1)throw Error('unsupported inversion schema/version');
 if(Object.hasOwn(p,'metadata')){if(!object(p.metadata))throw Error('metadata must be object');boundedJSON(p.metadata,131072);}
 const f=p.forward_request,prepared=prepareGeophysicsBlockForward(f);raiseValidation(prepared);if(f.physics!=='gravity'||f.include_sensitivities!==true)throw Error('density inversion requires gravity template with include_sensitivities=true');
 const propertyColumn=f.properties.density_contrast_kg_m3.column;if(['i','j','k','ni','nj','nk','x','y','z','dx','dy','dz','fill_fraction',f.cell_id_column,f.active_column].includes(propertyColumn))throw Error('fitted property column must not overwrite geometry, ID or active policy');
 const ids=prepared.cell_ids,n=ids.length,m=f.points.length;if(n>16||m>128)throw new ResourceError('inversion limit16 active cells and128 observations');
 for(const batch of prepared.batches)for(const source of batch.sources)if(source.density_contrast_kg_m3!==0)throw Error('all active template densities must be zero; declare reference in parameters');
 const observed=p.observed;if(!object(observed)||!object(observed.context))throw Error('observed dataset/context required');const context=observed.context;if(context.quantity!=='gravity_g_down')throw Error('density objective requires gravity_g_down');
 const predicted={context:{...context,coordinate_frame:f.coordinate_frame},records:f.points.map(point=>({...point,value:0}))};raiseValidation(calculateGeophysicsMisfit({schema:'baselode.geophysics.misfit_request',version:1,observed,predicted,options:{coverage_policy:'complete',weighting:'standard_deviation',coordinate_tolerance_m:0,residual_convention:'observed_minus_predicted'}}));
 for(const row of observed.records){number(row.value,-1e8,1e8);number(row.standard_deviation,1e-8,1e8);}
 if(!Array.isArray(p.parameters)||p.parameters.length!==n)throw Error('one ordered density parameter per active cell required');
 p.parameters.forEach((param,i)=>{keys(param,['cell_id','parameter','lower','upper','reference','scale']);if(param.cell_id!==ids[i]||param.parameter!=='density_contrast_kg_m3')throw Error('parameters must follow active cell order and density_contrast_kg_m3');for(const k of ['lower','upper','reference'])number(param[k],-100000,100000);number(param.scale,1e-6,100000);if(!(param.lower<param.upper)||param.reference<param.lower||param.reference>param.upper)throw Error('strict lower<upper and reference inside bounds required');number((param.upper-param.lower)/param.scale,1e-8,1e8);});
 const r=p.regularization;keys(r,['reference_weight','smoothness_weight','edges']);for(const k of ['reference_weight','smoothness_weight'])number(r[k],0,1e12);if(!Array.isArray(r.edges))throw Error('edges must be an array');if(r.edges.length>128)throw new ResourceError('at most128 explicit smoothing edges');
 const seen=new Set();let positive=false;for(const edge of r.edges){keys(edge,['cell_a','cell_b','weight']);if(!ids.includes(edge.cell_a)||!ids.includes(edge.cell_b)||edge.cell_a===edge.cell_b)throw Error('edges require distinct known active cells');const pair=[ids.indexOf(edge.cell_a),ids.indexOf(edge.cell_b)].sort((a,b)=>a-b).join(',');if(seen.has(pair))throw Error('duplicate undirected edge');seen.add(pair);number(edge.weight,0,1e6);positive=positive||edge.weight>0;}
 if(r.smoothness_weight>0&&!positive)throw new NeedsInput('positive smoothness requires positive explicit edges');const solver=p.solver;keys(solver,['method','tolerance','max_iterations','condition_limit']);if(solver.method!=='bvls')throw Error('only bounded dense bvls supported');number(solver.tolerance,1e-12,1e-6);number(solver.max_iterations,1,1000);number(solver.condition_limit,100,1e12);if(!Number.isInteger(solver.max_iterations))throw Error('max_iterations must be integer');
 return {request:p,diagnostics:{active_cells:n,observations:m,parameters:n,pair_count:n*m,edge_count:r.edges.length}};
}
function validate(request,kind){
 const report={schema:'baselode.geophysics.'+kind+'_inversion_validation',version:1,state:'ok',issues:[],request:null,diagnostics:{},producer:{library:'baselode',version:typeof __BASELODE_VERSION__==='undefined'?'unversioned':__BASELODE_VERSION__,algorithm_version:1}};
 try{Object.assign(report,prepare(request,kind));boundedJSON(report,descriptors[kind].resources.max_result_bytes,true);}catch(error){const context=error instanceof NeedsInput,resource=error instanceof ResourceError;Object.assign(report,{state:context?'needs_input':'rejected',issues:[{code:context?'context':resource?'resource':'contract',message:error.message}],request:null,diagnostics:{}});}return report;
}
/** Core-only contract validation; Python baselode[inversion] performs numerical fitting. */
export function validateGeophysicsDensityInversion(request){return validate(request,'density');}
