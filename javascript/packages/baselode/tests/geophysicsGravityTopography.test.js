/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {describeGeophysicsGravityTopography} from '../src/data/geophysicsGravityTopography.js';
import {inspectGeophysicsCorrections,reprojectGeophysicsObservations} from '../src/data/geophysicsCorrections.js';
import {runGeophysicsObservationWorkflow} from '../src/data/geophysicsObservationWorkflows.js';
const fixture=()=>JSON.parse(readFileSync(new URL('../../../../test/data/gravity_topography_ledger_reference.json',import.meta.url),'utf8'));
const raw=()=>JSON.parse(readFileSync(new URL('../../../../test/data/gravity_topography_reference.json',import.meta.url),'utf8'));
describe('gravity land topography contracts and native history replay',()=>{
  it('shares Python descriptors and returns independent copies',()=>{
    const d=describeGeophysicsGravityTopography();const py=JSON.parse(readFileSync(new URL('../../../../python/src/baselode/geophysics/geophysics_gravity_topography.json',import.meta.url),'utf8'));
    expect(d).toEqual(py);d.models.gravity_bouguer.G_SI=1;expect(describeGeophysicsGravityTopography()).toEqual(py);
  });
  it('inspects native plate/terrain ledgers and independent recovered disturbances',async()=>{
    const f=fixture(),source=raw();for(const data of [f.plate_observations,f.terrain_observations])expect((await inspectGeophysicsCorrections(data)).state).toBe('ok');
    source.expected.forEach((v,i)=>expect(f.terrain_observations.records[i].values.g).toBeCloseTo(v.truth_mGal,10));
    const e=f.terrain_observations.metadata.correction_ledger.entries.at(-1);e.model=Object.fromEntries(Object.entries(e.model).reverse());expect((await inspectGeophysicsCorrections(f.terrain_observations)).state).toBe('ok');
  });
  it.each(['datum','height','tide','density','dem','model','count','binding','drop','value','xy','history'])('rejects altered %s',async(change)=>{
    const data=fixture().terrain_observations,m=data.metadata,e=m.correction_ledger.entries.at(-1);
    if(change==='datum')m.gravity_datum='other';if(change==='height')m.height_datum='other';if(change==='tide')m.tide_system='zero_tide';if(change==='density')e.parameters.density_kg_m3=2600;if(change==='dem')e.parameters.dem.heights[0][0]=120;if(change==='model')e.model.G_SI=1;if(change==='count')e.affected_records++;if(change==='binding')e.topography_binding='0'.repeat(64);if(change==='drop')delete m.correction_ledger;if(change==='value')data.records[0].values.g++;if(change==='xy')data.records[0].x++;if(change==='history')m.corrections.gravity_bouguer='unapplied';
    expect((await inspectGeophysicsCorrections(data)).state).toBe('rejected');
  });
  it('preserves historical metre frame after horizontal reprojection',async()=>{
    const p=await reprojectGeophysicsObservations(fixture().terrain_observations,{target_crs:'EPSG:4326',datum_policy:'backend',event_id:'js-project',evidence:'checked'});expect(p.state,p.issues).toBe('ok');expect((await inspectGeophysicsCorrections(p.observations)).state).toBe('ok');
  });
  it('preflights Python-only execution before retaining any outputs',async()=>{
    const f=raw();for(const [operation,parameters] of [['apply_bouguer_plate',f.plate_options],['correct_gravity_terrain',f.terrain_options]]){
      const w={schema:'baselode.geophysics.observation_workflow',version:1,steps:[{id:'p',operation,version:1,inputs:[{input:'survey'}],parameters}],outputs:{out:{step:'p',output:'observations'}}};const r=await runGeophysicsObservationWorkflow(w,{survey:f.survey});expect(r.state).toBe('needs_input');expect(r.completed_steps).toEqual([]);expect(r.artifacts).toEqual({});
    }
  });
});
