/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import {expect,it} from 'vitest';
import reference from '../../../../test/data/normal_gravity_ledger_reference.json';
import {describeGeophysicsNormalGravity} from '../src/data/geophysicsNormalGravity.js';
import {createGeophysicsObservations} from '../src/data/geophysicsObservations.js';
import {inspectGeophysicsCorrections,reprojectGeophysicsObservations} from '../src/data/geophysicsCorrections.js';
import {runGeophysicsObservationWorkflow} from '../src/data/geophysicsObservationWorkflows.js';
import {gridGeophysicsObservations} from '../src/data/geophysicsGridding.js';
import {runGeophysicsWorkflow} from '../src/data/geophysicsWorkflows.js';
import {encodeErs,encodeGeoTiff} from '../src/data/geophysicsWriters.js';
import {readErs} from '../src/data/ersLoader.js';
import {loadGeoTiff} from '../src/data/geophysicsRaster.js';
const clone=x=>JSON.parse(JSON.stringify(x));
it('exposes independent pinned model and Python execution contracts',()=>{
 const d=describeGeophysicsNormalGravity();expect(d.models.WGS84.backend_version).toBe('0.6.0');expect(d.models.GRS80.flattening).toBe(1/298.257222101);d.models.WGS84.semimajor_axis=0;expect(describeGeophysicsNormalGravity().models.WGS84.semimajor_axis).toBe(6378137);
});
it('accepts the honest disturbance field and replays independently validated Python history',async()=>{
 const f=clone(reference);expect(createGeophysicsObservations(f.observations).channels.g.field_type).toBe('gravity_disturbance');const r=await inspectGeophysicsCorrections(f.observations);expect(r.state,JSON.stringify(r.issues)).toBe('ok');expect(r.states.gravity_normal).toEqual({g:'applied',other:'unapplied'});expect(r.states.gravity_tide).toEqual({g:'unknown',other:'unknown'});expect(f.observations.records[0].values.g).toBeCloseTo(25,5);
});
it.each(['model','datum','tide','height','params','binding','count','value','drop','state'])('rejects stale normal history %s',async(change)=>{
 const d=clone(reference.observations);const e=d.metadata.correction_ledger.entries.at(-1);
 if(change==='model')e.model.flattening+=.001;if(change==='datum')d.metadata.gravity_datum='changed';if(change==='tide')d.metadata.tide_system='zero_tide';if(change==='height')d.metadata.height_datum='other';if(change==='params')e.parameters.reference_policy='automatic';if(change==='binding')e.normal_binding='0'.repeat(64);if(change==='count')e.affected_records=2;if(change==='value')d.records[0].values.g+=1;if(change==='drop')delete d.metadata.correction_ledger;if(change==='state')d.metadata.corrections.gravity_normal='unapplied';
 const r=await inspectGeophysicsCorrections(d);expect(r.state,JSON.stringify(r.issues)).toBe('rejected');
});
it('validates normal history in its original frame after native reprojection',async()=>{
 const d=clone(reference.observations);const p=await reprojectGeophysicsObservations(d,{target_crs:'EPSG:32750',datum_policy:'backend',event_id:'project',evidence:'checked'});expect(p.state,JSON.stringify(p.issues)).toBe('ok');expect((await inspectGeophysicsCorrections(p.observations)).state).toBe('ok');expect(p.ledger.entries.slice(0,-1)).toEqual(d.metadata.correction_ledger.entries);
});
it('blocks unavailable normal numerics before executing any workflow stage',async()=>{
 const w={schema:'baselode.geophysics.observation_workflow',version:1,steps:[{id:'inspect',operation:'inspect_corrections',version:1,inputs:[{input:'survey'}],parameters:{}},{id:'normal',operation:'remove_normal_gravity',version:1,inputs:[{input:'survey'}],parameters:reference.params}],outputs:{out:{step:'normal',output:'observations'}}};const r=await runGeophysicsObservationWorkflow(w,{survey:reference.survey});expect(r.state).toBe('needs_input');expect(r.completed_steps).toEqual([]);expect(r.artifacts).toEqual({});expect(r.issues.at(-1).code).toBe('backend');
});
it('grids and differentiates disturbances with preserved field semantics and export history',async()=>{
 const p=await reprojectGeophysicsObservations(reference.observations,{target_crs:'EPSG:32750',datum_policy:'backend',event_id:'project',evidence:'checked'});const g=gridGeophysicsObservations(p.observations,{channels:['g'],radius:100,method:'nearest',duplicate_policy:'mean',elevation_policy:'ignore',bounds:[499990,6459550,500010,6459570],shape:[2,2],extrapolation:'allow'});expect(g.state,JSON.stringify(g.issues)).toBe('ok');expect(g.artifacts.grid.metadata.field_type).toBe('gravity_disturbance');
 const edge=runGeophysicsWorkflow({schema:'baselode.geophysics.workflow',version:1,steps:[{id:'edge',operation:'total_horizontal_derivative',version:1,inputs:['g'],parameters:{}}],outputs:['edge']},{g:g.artifacts.grid});expect(edge.state,JSON.stringify(edge.issues)).toBe('ok');expect(edge.artifacts.edge.data).toEqual([[[0,0],[0,0]]]);
 const ers=encodeErs(g.artifacts.grid,{dtype:'float64'});for(const back of [readErs(ers.header,ers.data),await loadGeoTiff(encodeGeoTiff(g.artifacts.grid,{dtype:'float64'}))])expect(back.metadata.observation_metadata.correction_ledger).toEqual(p.ledger);
});
