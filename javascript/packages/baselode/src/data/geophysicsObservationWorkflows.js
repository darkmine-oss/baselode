/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import descriptor from './geophysics_observation_workflow.json';
import recipe from './magnetic_observation_recipe.json';
import * as corrections from './geophysicsCorrections.js';
import { createGeophysicsObservations, qcGeophysicsObservations, unicodeStrings } from './geophysicsObservations.js';
import { gridGeophysicsObservations } from './geophysicsGridding.js';
import { jsonValue, encodeProvenance } from './geophysicsProvenance.js';
import { createGeophysicsRaster } from './geophysicsRaster.js';
import { runGeophysicsWorkflow } from './geophysicsWorkflows.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, names) => object(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value,name));
const identifier = (value) => typeof value === 'string' && value.trim()===value && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value);
const operations = new Map(descriptor.operations.map(item => [item.id,item]));
const limits = descriptor.resources;
const producer = () => ({library:'baselode',version:typeof __BASELODE_VERSION__==='undefined'?'unversioned':__BASELODE_VERSION__,algorithm_version:1});
class WorkflowError extends Error {
  constructor(state,code,path,message) { super(message); this.state=state; this.code=code; this.path=path; }
}
function requireValue(condition,message,code='contract',path='workflow',state='rejected') {
  if(!condition)throw new WorkflowError(state,code,path,message);
}
function bytes(value) { jsonValue(value); unicodeStrings(value); return new TextEncoder().encode(JSON.stringify(value)).length; }
/** Independent typed-port contracts, parameters, backend support and limits. */
export function describeGeophysicsObservationWorkflow() {return clone(descriptor);}
/** Synthetic QC/levelling/gridding/edge example; replace survey-specific parameters. */
export function magneticObservationRecipe() {return clone(recipe);}
function result() {
  return {schema:'baselode.geophysics.observation_workflow_result',version:1,state:'ok',issues:[],workflow:null,plan:[],completed_steps:[],artifacts:{},step_reports:{},input_bindings:{},producer:producer(),
    resource_estimate:{retained_records:0,retained_readings:0,retained_cell_values:0,limits:clone(limits)}};
}
function abort(report,error) {
  report.state=error instanceof WorkflowError?error.state:'rejected';
  report.issues.push({code:error instanceof WorkflowError?error.code:'contract',path:error instanceof WorkflowError?error.path:'workflow',message:error.message});report.artifacts={};return report;
}
function reference(ref,contexts) {
  let key;
  if(keys(ref,['input'])&&identifier(ref.input))key=`input:${ref.input}`;
  else if(keys(ref,['step','output'])&&identifier(ref.step)&&identifier(ref.output))key=`step:${ref.step}:${ref.output}`;
  else throw new WorkflowError('rejected','reference','workflow','references must be exact input or step/output objects');
  requireValue(contexts.has(key),'reference must name an available input or earlier typed output port','reference');return key;
}
function size(value,kind) {
  const records=kind==='observations'?value.records.length:0;
  return {kind,records,readings:kind==='observations'?records*Object.keys(value.channels).length:0,cells:kind==='raster'?value.width*value.height*value.bandCount:0};
}
function reserve(estimate,context) {
  for(const [key,field,limit] of [['retained_records','records','max_retained_records'],['retained_readings','readings','max_retained_readings'],['retained_cell_values','cells','max_retained_cell_values']]) {
    const total=estimate[key]+context[field];requireValue(total<=limits[limit],`retained workflow artifacts exceed ${limit}`,'resource');estimate[key]=total;
  }
}
async function prepare(workflow,inputs) {
  const report=result();const values=new Map();const contexts=new Map();
  try {
    requireValue(bytes(workflow)<=limits.max_workflow_json_bytes,'workflow JSON exceeds 1 MiB','resource');
    requireValue(keys(workflow,['schema','version','steps','outputs']),'require exactly schema/version/steps/outputs');
    requireValue(workflow.schema==='baselode.geophysics.observation_workflow'&&workflow.version===1,'unsupported observation workflow version','version');
    workflow=clone(workflow);
    const {steps,outputs}=workflow;
    requireValue(Array.isArray(steps)&&steps.length>=1&&steps.length<=limits.max_steps,'require 1..16 ordered steps','resource');
    requireValue(object(outputs)&&Object.keys(outputs).length>=1&&Object.keys(outputs).every(identifier),'require named output references');
    requireValue(Object.keys(outputs).length<=limits.max_outputs,'workflow exceeds 32 outputs','resource');
    requireValue(object(inputs)&&Object.keys(inputs).length>=1&&Object.keys(inputs).every(identifier),'require named observation inputs');
    requireValue(Object.keys(inputs).length<=limits.max_inputs,'workflow exceeds 8 inputs','resource');
    report.workflow=clone(workflow);let inputBytes=0;
    const preparedInputs=Object.entries(inputs).map(([name,payload])=>[name,createGeophysicsObservations(payload)]);
    for(const [name,data] of preparedInputs) {
      inputBytes+=bytes(data);requireValue(inputBytes<=limits.max_input_json_bytes,'aggregate observation input JSON exceeds 32 MiB','resource');
      const inspected=await corrections.inspectGeophysicsCorrections(data);requireValue(inspected.state==='ok',`invalid input correction history: ${JSON.stringify(inspected.issues)}`,'history',`inputs.${name}`);
      report.input_bindings[name]=inspected.ledger.current_binding;const key=`input:${name}`;values.set(key,data);contexts.set(key,size(data,'observations'));reserve(report.resource_estimate,contexts.get(key));
    }
    const ids=new Set(Object.keys(inputs));
    for(const [index,step] of steps.entries()) {
      const path=`steps.${index}`;requireValue(keys(step,['id','operation','version','inputs','parameters']),'steps require exactly id/operation/version/inputs/parameters','contract',path);
      const {id,operation,parameters:params}=step;
      requireValue(identifier(id)&&!ids.has(id),'step IDs must be unique and distinct from input names','contract',path);
      requireValue(typeof operation==='string'&&operations.has(operation),'unknown registered observation workflow operation','operation',path);
      requireValue(step.version===1,'unsupported operation version','version',path);const contract=operations.get(operation);
      requireValue(object(params)&&Object.keys(params).every(key=>Object.hasOwn(contract.parameters.properties,key)),'parameters must use registered keys','parameter',path);
      requireValue((contract.parameters.required??[]).every(key=>Object.hasOwn(params,key)),'supply required operation parameters','parameter',path,'needs_input');
      requireValue(Array.isArray(step.inputs)&&step.inputs.length===contract.inputs.length,'wrong operation input count','input',path);
      const sources=step.inputs.map(ref=>contexts.get(reference(ref,contexts)));requireValue(sources.every((item,i)=>item.kind===contract.inputs[i]),'input reference types do not match operation ports','input',path);
      requireValue(operation!=='remove_igrf','remove_igrf requires Python execution with baselode[magnetics]; JavaScript has no numerical IGRF backend','backend',path,'needs_input');
      for(const [port,kind] of Object.entries(contract.outputs)) {
        const context={kind,records:0,readings:0,cells:0};
        if(kind==='observations')Object.assign(context,sources[0]);
        else if(kind==='raster') {
          if(operation.startsWith('raster_'))context.cells=sources[0].cells;
          else if(Array.isArray(params.shape)&&params.shape.length===2&&params.shape.every(v=>Number.isInteger(v)&&v>0)&&Array.isArray(params.channels))context.cells=params.shape[0]*params.shape[1]*params.channels.length;
        }
        contexts.set(`step:${id}:${port}`,context);reserve(report.resource_estimate,context);
      }
      ids.add(id);report.plan.push(clone(step));
    }
    for(const ref of Object.values(outputs))reference(ref,contexts);
  } catch(error) {abort(report,error);}
  return {report,values};
}
/** Structural preflight only. Native stages check scientific values/context when run.
 * Known unavailable backends prevent every stage from starting. No numerical work.
 */
export async function validateGeophysicsObservationWorkflow(workflow,inputs) {return (await prepare(workflow,inputs)).report;}
const kernels=new Map([
  ['correct_magnetic_base',corrections.correctGeophysicsMagneticBase],['correct_magnetic_lag',corrections.correctGeophysicsMagneticLag],
  ['correct_magnetic_heading',corrections.correctGeophysicsMagneticHeading],['reproject_observations',corrections.reprojectGeophysicsObservations],
  ['analyze_crossovers',corrections.analyzeGeophysicsCrossovers],['level_magnetic_lines',corrections.levelGeophysicsMagneticLines],
]);
async function execute(step,sources) {
  const {operation,parameters:params}=step;let report;let ports;
  if(operation.startsWith('raster_')) {
    const names=['left','right'].slice(0,sources.length);
    report=runGeophysicsWorkflow({schema:'baselode.geophysics.workflow',version:1,steps:[{id:'product',operation:operation.slice(7),version:1,inputs:names,parameters:params}],outputs:['product']},Object.fromEntries(names.map((name,i)=>[name,sources[i]])));
    ports=report.state==='ok'?{raster:report.artifacts.product}:{};
  } else if(operation==='qc_observations') {
    requireValue(object(params.qc),'qc must be an explicit options object','parameter');
    requireValue(Number.isInteger(params.max_flags)&&params.max_flags>=0&&params.max_flags<=10000,'max_flags must be integer 0..10000','parameter');
    report=qcGeophysicsObservations(sources[0],params.qc);
    if(report.state==='ok'&&report.flags.length>params.max_flags){report.state='needs_input';report.issues.push({code:'qc_gate',message:'QC flag count exceeds explicit max_flags; review observations'});}
    if(report.flags_truncated)report.state='rejected';ports={};
  } else if(operation==='declare_corrections') {report=await corrections.declareGeophysicsCorrections(sources[0],params.declarations);ports={observations:report.observations};}
  else if(operation==='inspect_corrections') {report=await corrections.inspectGeophysicsCorrections(sources[0]);ports={};}
  else if(operation==='grid_observations') {report=gridGeophysicsObservations(sources[0],params);ports=report.artifacts;}
  else {report=await kernels.get(operation)(...sources,params);ports=Object.hasOwn(operations.get(operation).outputs,'observations')?{observations:report.observations}:{};}
  const summary=Object.fromEntries(Object.entries(report).filter(([key])=>!['observations','artifacts','plan','workflow'].includes(key)));
  return {report,ports:{...ports,report:summary}};
}
/** Registered in-memory stages; full-resolution named artifacts only on total success.
 * First non-ok stage stops execution; bounded reports/completed IDs remain for audit.
 * Caller choices/calibrations are never inferred; inputs/history are preserved.
 */
export async function runGeophysicsObservationWorkflow(workflow,inputs) {
  const {report:result,values}=await prepare(workflow,inputs);if(result.state!=='ok')return result;
  const actual={retained_records:0,retained_readings:0,retained_cell_values:0,limits:clone(limits)};result.resource_usage=actual;
  try {
    for(const value of values.values())reserve(actual,size(value,'observations'));
    for(const step of result.plan) {
      const sources=step.inputs.map(ref=>values.get(reference(ref,values)));const {report,ports}=await execute(step,sources);
      const candidate={...result.step_reports,[step.id]:ports.report};requireValue(bytes(candidate)<=limits.max_reports_json_bytes,'native workflow reports exceed 8 MiB','resource',step.id);result.step_reports=candidate;
      if(report.state!=='ok')throw new WorkflowError(report.state,'step',step.id,'native operation did not pass; inspect step_reports');
      const marker={operation:'observation_workflow_step',version:1,id:step.id,registered_operation:step.operation,operation_version:1,inputs:clone(step.inputs),workflow_version:1,parameters:clone(step.parameters),library_version:producer().version};
      for(const [port,kind] of Object.entries(operations.get(step.operation).outputs)) {
        let product=ports[port];
        if(kind==='observations') {product.metadata.processing=[...(product.metadata.processing??[]),clone(marker)];product=createGeophysicsObservations(product);encodeProvenance(product.metadata,'GeoTIFF','float64');}
        else if(kind==='raster') {product=createGeophysicsRaster({...product,metadata:clone(product.metadata)});product.metadata.processing=[...(product.metadata.processing??[]),clone(marker)];encodeProvenance(product.metadata,'GeoTIFF','float64');}
        reserve(actual,size(product,kind));values.set(`step:${step.id}:${port}`,product);
      }
      result.completed_steps.push(step.id);
    }
    result.artifacts=Object.fromEntries(Object.entries(result.workflow.outputs).map(([name,ref])=>[name,values.get(reference(ref,values))]));
  } catch(error) {abort(result,error instanceof WorkflowError?error:new WorkflowError('failed','execution','execution',error.message));}
  return result;
}
