/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import {expect,it,vi} from 'vitest';
import reference from '../../../../test/data/geophysics_crossovers_reference.json';
import descriptor from '../src/data/geophysics_observation_workflow.json';
import {describeGeophysicsObservationWorkflow,magneticObservationRecipe,runGeophysicsObservationWorkflow,validateGeophysicsObservationWorkflow} from '../src/data/geophysicsObservationWorkflows.js';
import {inspectGeophysicsCorrections,levelGeophysicsMagneticLines} from '../src/data/geophysicsCorrections.js';
import {encodeErs,encodeGeoTiff} from '../src/data/geophysicsWriters.js';
import {readErs} from '../src/data/ersLoader.js';
import {loadGeoTiff} from '../src/data/geophysicsRaster.js';
const clone=x=>JSON.parse(JSON.stringify(x));
const recipe=()=>magneticObservationRecipe();
const fixture=()=>clone(reference);
const run=(w=recipe(),inputs={survey:fixture().survey})=>runGeophysicsObservationWorkflow(w,inputs);
it('recovers independent biases, exact nearest grid and analytical grid gradient in a saved recipe',async()=>{
 const f=fixture();const w=recipe();const before=clone({f,w});const r=await run(w,{survey:f.survey});expect(r.state,JSON.stringify(r.issues)).toBe('ok');expect(r.completed_steps).toEqual(['qc','level','grid','edges']);
 expect(r.artifacts.corrected.records.map(row=>row.values.mag)).toEqual(f.expected_values);expect(r.artifacts.grid.data).toEqual([[[134,146],[104,116]]]);for(const row of r.artifacts.edges.data[0])for(const value of row)expect(value).toBeCloseTo(Math.hypot(2.4,6),12);expect(r.artifacts.support.data).toEqual([[[1,1],[1,1]]]);expect((await inspectGeophysicsCorrections(r.artifacts.corrected)).state).toBe('ok');expect(r.step_reports.level.ledger.entries.at(-1).line_offsets).toEqual(f.expected_offsets);expect(r.resource_estimate.retained_cell_values).toBe(24);expect(r.resource_usage.retained_records).toBe(16);expect({f,w}).toEqual(before);
 const replay=await run(clone(w),{survey:f.survey});expect(replay.input_bindings).toEqual(r.input_bindings);expect(replay.artifacts.corrected).toEqual(r.artifacts.corrected);expect(r.artifacts.grid.metadata.observation_metadata.correction_ledger).toEqual(r.artifacts.corrected.metadata.correction_ledger);
});
it.each(['schema','version','unknown','step_version','id','duplicate','collision','forward','cycle','port','type','output','extra','params','missing','empty','reference_shape'])('rejects structural %s before any stage and withholds requested raw input',async(change)=>{
 const w=recipe();w.outputs.raw={input:'survey'};
 if(change==='schema')w.schema='custom';if(change==='version')w.version=true;if(change==='unknown')w.steps.at(-1).operation='eval';if(change==='step_version')w.steps.at(-1).version=2;if(change==='id')w.steps[0].id='bad\n';if(change==='duplicate')w.steps[1].id='qc';if(change==='collision')w.steps[1].id='survey';if(change==='forward')w.steps[0].inputs=[{step:'level',output:'observations'}];if(change==='cycle')w.steps[1].inputs=[{step:'level',output:'observations'}];if(change==='port')w.steps[2].inputs[0].output='unknown';if(change==='type')w.steps[2].inputs=[{step:'qc',output:'report'}];if(change==='output')w.outputs.bad={step:'missing',output:'raster'};if(change==='extra')w.steps[1].code='print(1)';if(change==='params')w.steps[1].parameters.custom=1;if(change==='missing')delete w.steps[1].parameters.reference_lines;if(change==='empty')w.steps=[];if(change==='reference_shape')w.steps[1].inputs=[{input:'survey',step:'qc'}];
 const r=await run(w);expect(['needs_input','rejected']).toContain(r.state);expect(r.completed_steps).toEqual([]);expect(r.artifacts).toEqual({});
});
it('gates QC flags explicitly and retains review diagnostics without repairing data',async()=>{
 const f=fixture();f.survey.records[0].values.mag=null;let r=await run(recipe(),{survey:f.survey});expect(r.state).toBe('needs_input');expect(r.completed_steps).toEqual([]);expect(r.artifacts).toEqual({});expect(r.step_reports.qc.flags.length).toBeGreaterThan(0);
 const w=recipe();w.steps[0].parameters.max_flags=100;r=await run(w,{survey:f.survey});expect(r.state).toBe('needs_input');expect(r.completed_steps).toEqual(['qc']);expect(r.artifacts).toEqual({});
});
it.each(['quality','repeat','coordinates','qc_option'])('stops native %s failures with no final artifacts',async(which)=>{
 const w=recipe();const d=fixture().survey;w.outputs.raw={input:'survey'};if(which==='quality')w.steps[1].parameters.max_abs_correction=1;if(which==='repeat')d.metadata.corrections.levelling='applied';if(which==='coordinates'){d.crs='EPSG:4326';d.crs_units='degrees';}if(which==='qc_option')w.steps[0].parameters.qc=null;const r=await run(w,{survey:d});expect(r.state).not.toBe('ok');expect(r.artifacts).toEqual({});expect(r.completed_steps).not.toContain('grid');
});
it.each(['max_steps','max_inputs','max_outputs','max_workflow_json_bytes','max_input_json_bytes','max_retained_records','max_retained_readings','max_retained_cell_values','max_reports_json_bytes'])('bounds resource %s atomically',async(limit)=>{
 const saved=descriptor.resources[limit];descriptor.resources[limit]=0;try{const r=await run();expect(r.state).toBe('rejected');expect(r.artifacts).toEqual({});expect(r.issues.at(-1).code).toBe('resource');}finally{descriptor.resources[limit]=saved;}
});
it('statically accounts for all grid/support ports before kernels',async()=>{const w=recipe();w.steps[2].parameters.shape=[10000,10000];const r=await run(w);expect(r.state).toBe('rejected');expect(r.completed_steps).toEqual([]);expect(r.issues.at(-1).code).toBe('resource');});
it('rejects stale bound input history before executing',async()=>{const f=fixture();const d=(await levelGeophysicsMagneticLines(f.survey,f.options)).observations;d.records[0].values.mag+=1;const r=await run(recipe(),{survey:d});expect(r.state).toBe('rejected');expect(r.completed_steps).toEqual([]);expect(r.issues.at(-1).code).toBe('history');});
it('blocks Python-only IGRF before all preceding operations',async()=>{
 const w=recipe();w.steps.push({id:'igrf',operation:'remove_igrf',version:1,inputs:[{input:'survey'}],parameters:{channel:'mag',model:'IGRF14',event_id:'igrf',evidence:'checked'}});const r=await run(w);expect(r.state).toBe('needs_input');expect(r.issues.at(-1).code).toBe('backend');expect(r.completed_steps).toEqual([]);expect(r.artifacts).toEqual({});
});
it('keeps input and step namespaces distinct and descriptor ownership independent',async()=>{
 const w={schema:'baselode.geophysics.observation_workflow',version:1,steps:[{id:'input',operation:'declare_corrections',version:1,inputs:[{input:'observations'}],parameters:{declarations:[{id:'source',correction:'magnetic_heading',channels:['mag'],state:'unknown',evidence:'unknown is explicit'}]}}],outputs:{raw:{input:'observations'},derived:{step:'input',output:'observations'}}};const r=await run(w,{observations:fixture().survey});expect(r.state,JSON.stringify(r.issues)).toBe('ok');expect(r.artifacts.raw.metadata.correction_ledger).toBeUndefined();expect(r.artifacts.derived.metadata.correction_ledger).toBeDefined();const d=describeGeophysicsObservationWorkflow();d.resources.max_steps=0;expect(describeGeophysicsObservationWorkflow().resources.max_steps).toBe(16);
});
it('preserves bound correction history and workflow metadata in ERS/GeoTIFF',async()=>{
 const r=await run();const raster=r.artifacts.edges;const ers=encodeErs(raster,{dtype:'float64'});for(const back of [readErs(ers.header,ers.data),await loadGeoTiff(encodeGeoTiff(raster,{dtype:'float64'}))]){expect(back.metadata.observation_metadata.correction_ledger).toEqual(r.artifacts.corrected.metadata.correction_ledger);expect(back.metadata.processing.at(-1).registered_operation).toBe('raster_total_horizontal_derivative');}
});
it('returns structured failure if a backend throws unexpectedly',async()=>{
 // Raster backend error is injected after the successful observation/grid stages.
 const module=await import('../src/data/geophysicsWorkflows.js');const spy=vi.spyOn(module,'runGeophysicsWorkflow').mockImplementation(()=>{throw Error('injected backend failure');});try{const r=await run();expect(r.state).toBe('failed');expect(r.completed_steps).toEqual(['qc','level','grid']);expect(r.artifacts).toEqual({});}finally{spy.mockRestore();}
});
it('supports report-only crossover ports and two-input registered raster combination',async()=>{
 const w=recipe();w.steps.push({id:'ties',operation:'analyze_crossovers',version:1,inputs:[{step:'level',output:'observations'}],parameters:fixture().analysis},{id:'zero',operation:'raster_combine',version:1,inputs:[{step:'grid',output:'grid'},{step:'grid',output:'grid'}],parameters:{operation:'subtract'}});Object.assign(w.outputs,{ties:{step:'ties',output:'report'},zero:{step:'zero',output:'raster'}});const r=await run(w);expect(r.state,JSON.stringify(r.issues)).toBe('ok');expect(r.artifacts.ties.crossovers.every(row=>row.difference===0)).toBe(true);expect(r.artifacts.zero.data).toEqual([[[0,0],[0,0]]]);
});
it('rejects non-JSON and cyclic workflow documents',async()=>{let w=recipe();w.steps[0].parameters.bad=NaN;expect((await run(w)).state).toBe('rejected');w=recipe();w.steps[0].parameters.cycle=w;expect((await run(w)).state).toBe('rejected');});
it('snapshots workflow and every input before asynchronous hashing yields',async()=>{
 const w=recipe();const inputs={survey:fixture().survey,unused:fixture().survey};const pending=run(w,inputs);w.steps[1].parameters.max_abs_correction=0;w.outputs={bad:{input:'absent'}};inputs.survey.records[0].values.mag=999;inputs.unused.records[0].values.mag=999;
 const r=await pending;expect(r.state,JSON.stringify(r.issues)).toBe('ok');expect(r.artifacts.corrected.records.map(row=>row.values.mag)).toEqual(fixture().expected_values);expect(r.workflow.steps[1].parameters.max_abs_correction).toBe(10);
});
it('rejects overflowing shape estimates without emitting nonfinite report numbers',async()=>{
 const w=recipe();w.steps[2].parameters.shape=[1e308,1e308];const r=await run(w);expect(r.state).toBe('rejected');expect(r.issues.at(-1).code).toBe('resource');expect(Object.values(r.resource_estimate).filter(v=>typeof v==='number').every(Number.isFinite)).toBe(true);
});
