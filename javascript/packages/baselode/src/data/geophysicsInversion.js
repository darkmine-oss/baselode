/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import density from './geophysics_density_inversion.json';
import susceptibility from './geophysics_susceptibility_inversion.json';
import magneticVector from './geophysics_magnetic_vector_inversion.json';
import {boundedJSON,keys,number,label,object,NeedsInput,ResourceError} from './geophysicsForwardCommon.js';
import {prepareGeophysicsBlockForward} from './geophysicsBlockForward.js';
import {calculateGeophysicsMisfit} from './geophysicsMisfit.js';
const descriptors={density,susceptibility,magnetic_vector:magneticVector},clone=v=>JSON.parse(JSON.stringify(v));
export function describeGeophysicsDensityInversion(){return clone(density);}
function raiseValidation(report){if(report.state==='ok')return;const {code,message}=report.issues[0];if(code==='context')throw new NeedsInput(message);if(code==='resource')throw new ResourceError(message);throw Error(message);}
const J=['magnetization_x_A_m','magnetization_y_A_m','magnetization_z_up_A_m'];
function configuration(kind){
 if(kind==='density')return {physics:'gravity',parameters:['density_contrast_kg_m3'],properties:['density_contrast_kg_m3'],bounds:[-100000,100000],scale:[1e-6,100000],quantities:['gravity_g_down']};
 if(kind==='susceptibility')return {physics:'magnetic',parameters:['susceptibility_SI'],properties:J,bounds:[-.1,.1],scale:[1e-8,.1],quantities:['magnetic_tmi_anomaly']};
 return {physics:'magnetic',parameters:J,properties:J,bounds:[-1000,1000],scale:[1e-6,1000],quantities:['magnetic_tmi_anomaly','magnetic_bx','magnetic_by','magnetic_bz_up','magnetic_b_down']};
}
function datasets(p,kind){if(kind!=='magnetic_vector')return [p.observed];if(!Array.isArray(p.observed))throw Error('MVI observed must be an array of datasets');if(!p.observed.length)throw new NeedsInput('supply at least one observed channel');if(p.observed.length>3)throw new ResourceError('at most3 nonredundant observed datasets');return p.observed;}
function magneticContext(p,observations,kind){
 const a=p.magnetic_assumptions,vector=kind==='magnetic_vector',required=['model','objective','background_reference_id',...(vector?['error_model']:['max_response_to_background_ratio'])];keys(a,required,vector?['max_response_to_background_ratio']:[]);
 if(a.model!==(vector?'uniform_cartesian_magnetization':'induced_only_no_demagnetization')||!(vector?['linear_tmi','vector_components']:['linear_tmi']).includes(a.objective))throw Error('declare supported magnetisation model and objective');
 label(a.background_reference_id);if(observations.some(o=>o.context.reference_id!==a.background_reference_id))throw new NeedsInput('observation reference must match the declared fixed background');
 if(vector){if(a.error_model!=='independent_standard_deviations')throw Error('declare independent supplied standard deviations; correlated errors require another model');if(!Object.hasOwn(a,'max_response_to_background_ratio'))throw new NeedsInput('declare weak-response cap or explicit null for vector objective');}
 const quantities=observations.map(o=>o.context.quantity);
 if(a.objective==='vector_components'){const canonical=quantities.map(q=>q==='magnetic_b_down'?'magnetic_bz_up':q);if(quantities.some(q=>!['magnetic_bx','magnetic_by','magnetic_bz_up','magnetic_b_down'].includes(q))||new Set(canonical).size!==canonical.length)throw Error('vector objective requires distinct nonredundant Cartesian component channels');if(a.max_response_to_background_ratio!==null)throw Error('vector objective requires explicit null weak-response cap; no TMI linearisation is used');return;}
 if(quantities.length!==1||quantities[0]!=='magnetic_tmi_anomaly')throw Error('linear TMI requires exactly one TMI anomaly channel');number(a.max_response_to_background_ratio,1e-12,.05);const bg=p.forward_request.background_nT;if(bg===null)throw new NeedsInput('linear-TMI inversion requires a fixed nonnull background field');const {x,y,z_up:z}=bg,magnitude=Math.sqrt((x*x+y*y)+z*z);if(observations.some(o=>o.records.some(row=>Math.abs(row.value)/magnitude>a.max_response_to_background_ratio)))throw new NeedsInput('observed anomaly exceeds declared weak-response/background policy');
}
function prepare(request,kind){
 const cfg=configuration(kind);
 const p=boundedJSON(request,2097152);keys(p,['schema','version','forward_request','observed','parameters','regularization','solver',...(kind==='density'?[]:['magnetic_assumptions'])],['metadata']);if(p.schema!=='baselode.geophysics.'+kind+'_inversion_request'||p.version!==1)throw Error('unsupported inversion schema/version');
 if(Object.hasOwn(p,'metadata')){if(!object(p.metadata))throw Error('metadata must be object');boundedJSON(p.metadata,131072);}
 const f=p.forward_request,prepared=prepareGeophysicsBlockForward(f);raiseValidation(prepared);if(f.physics!==cfg.physics||f.include_sensitivities!==true)throw Error('inversion requires the matching physics template and include_sensitivities=true');
 const columns=cfg.properties.map(parameter=>f.properties[parameter].column);if(new Set(columns).size!==columns.length)throw Error('fitted Cartesian property columns must be distinct');if(columns.some(column=>['i','j','k','ni','nj','nk','x','y','z','dx','dy','dz','fill_fraction',f.cell_id_column,f.active_column].includes(column)))throw Error('fitted property column must not overwrite geometry, ID or active policy');
 const ids=prepared.cell_ids,n=ids.length,m=f.points.length;if(n>16||m>128)throw new ResourceError('inversion limit16 active cells and128 observations');
 for(const batch of prepared.batches)for(const source of batch.sources)if(cfg.properties.some(parameter=>source[parameter]!==0))throw Error('all active template properties must be zero; declare reference in parameters');
 const observations=datasets(p,kind);let total=0;
 for(const observed of observations){if(!object(observed)||!object(observed.context))throw Error('observed dataset/context required');const context=observed.context;if(!cfg.quantities.includes(context.quantity))throw Error('declare a supported inversion quantity');
 const predicted={context:{...context,coordinate_frame:f.coordinate_frame},records:f.points.map(point=>({...point,value:0}))};raiseValidation(calculateGeophysicsMisfit({schema:'baselode.geophysics.misfit_request',version:1,observed,predicted,options:{coverage_policy:'complete',weighting:'standard_deviation',coordinate_tolerance_m:0,residual_convention:'observed_minus_predicted'}}));total+=observed.records.length;for(const row of observed.records){number(row.value,-1e8,1e8);number(row.standard_deviation,1e-8,1e8);}}
 if(total>128)throw new ResourceError('at most128 total observations across channels');if(kind!=='density')magneticContext(p,observations,kind);
 const expected=ids.flatMap(id=>cfg.parameters.map(parameter=>[id,parameter]));if(!Array.isArray(p.parameters)||p.parameters.length!==expected.length)throw Error('one ordered parameter per active cell/component required');
 p.parameters.forEach((param,i)=>{keys(param,['cell_id','parameter','lower','upper','reference','scale']);if(param.cell_id!==expected[i][0]||param.parameter!==expected[i][1])throw Error('parameters must follow active cell then component order');for(const k of ['lower','upper','reference'])number(param[k],...cfg.bounds);number(param.scale,...cfg.scale);if(!(param.lower<param.upper)||param.reference<param.lower||param.reference>param.upper)throw Error('strict lower<upper and reference inside bounds required');number((param.upper-param.lower)/param.scale,1e-8,1e8);});
 const r=p.regularization;keys(r,['reference_weight','smoothness_weight','edges']);for(const k of ['reference_weight','smoothness_weight'])number(r[k],0,1e12);if(!Array.isArray(r.edges))throw Error('edges must be an array');if(r.edges.length>128)throw new ResourceError('at most128 explicit smoothing edges');
 const seen=new Set();let positive=false;for(const edge of r.edges){keys(edge,['cell_a','cell_b','weight']);if(!ids.includes(edge.cell_a)||!ids.includes(edge.cell_b)||edge.cell_a===edge.cell_b)throw Error('edges require distinct known active cells');const pair=[ids.indexOf(edge.cell_a),ids.indexOf(edge.cell_b)].sort((a,b)=>a-b).join(',');if(seen.has(pair))throw Error('duplicate undirected edge');seen.add(pair);number(edge.weight,0,1e6);positive=positive||edge.weight>0;}
 if(r.smoothness_weight>0&&!positive)throw new NeedsInput('positive smoothness requires positive explicit edges');const solver=p.solver;keys(solver,['method','tolerance','max_iterations','condition_limit']);if(solver.method!=='bvls')throw Error('only bounded dense bvls supported');number(solver.tolerance,1e-12,1e-6);number(solver.max_iterations,1,1000);number(solver.condition_limit,100,1e12);if(!Number.isInteger(solver.max_iterations))throw Error('max_iterations must be integer');
 const diagnostics={active_cells:n,observations:total,parameters:expected.length,pair_count:n*m,edge_count:r.edges.length};if(kind==='magnetic_vector')Object.assign(diagnostics,{dataset_count:observations.length,prediction_points:m});return {request:p,diagnostics};
}
function validate(request,kind){
 const report={schema:'baselode.geophysics.'+kind+'_inversion_validation',version:1,state:'ok',issues:[],request:null,diagnostics:{},producer:{library:'baselode',version:typeof __BASELODE_VERSION__==='undefined'?'unversioned':__BASELODE_VERSION__,algorithm_version:1}};
 try{Object.assign(report,prepare(request,kind));boundedJSON(report,descriptors[kind].resources.max_result_bytes,true);}catch(error){const context=error instanceof NeedsInput,resource=error instanceof ResourceError;Object.assign(report,{state:context?'needs_input':'rejected',issues:[{code:context?'context':resource?'resource':'contract',message:error.message}],request:null,diagnostics:{}});}return report;
}
/** Core-only contract validation; Python baselode[inversion] performs numerical fitting. */
export function validateGeophysicsDensityInversion(request){return validate(request,'density');}

export function describeGeophysicsSusceptibilityInversion(){return clone(susceptibility);}
/** Native induced-only SI/linear-TMI contract; numerical fitting uses Python. */
export function validateGeophysicsSusceptibilityInversion(request){return validate(request,'susceptibility');}

export function describeGeophysicsMagneticVectorInversion(){return clone(magneticVector);}
/** Native bounded independent-Cartesian-J contract; Python executes the numerical solver. */
export function validateGeophysicsMagneticVectorInversion(request){return validate(request,'magnetic_vector');}
