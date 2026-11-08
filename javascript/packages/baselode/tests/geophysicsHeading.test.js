/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it } from 'vitest';
import reference from '../../../../test/data/geophysics_heading_reference.json';
import { correctGeophysicsMagneticHeading, correctGeophysicsMagneticLag, inspectGeophysicsCorrections } from '../src/data/geophysicsCorrections.js';
import { appendInput, encodeProvenance } from '../src/data/geophysicsProvenance.js';
const fixture = () => JSON.parse(JSON.stringify(reference));
async function corrected() { const f = fixture(); const r = await correctGeophysicsMagneticHeading(f.survey,f.options); expect(r.state,JSON.stringify(r.issues)).toBe('ok'); return r.observations; }
it('recovers independent signed cardinal/midpoint/seam biases without modifying input', async () => {
  const f = fixture(); const before = JSON.stringify(f); const r = await correctGeophysicsMagneticHeading(f.survey,f.options);
  expect(r.state,JSON.stringify(r.issues)).toBe('ok'); expect(r.proposals.map((p) => p.bias_nT)).toEqual(f.expected_bias);
  expect(r.observations.records.map((row) => row.values.mag)).toEqual(f.expected_values); expect(r.proposals[7].calibration_headings).toEqual([270,0]);
  expect(r.parameters.calibration.map((n) => n.heading_degrees)).toEqual([0,90,180,270]); expect(JSON.stringify(f)).toBe(before);
  expect(r.states.magnetic_heading).toEqual({ mag:'applied',other:'unapplied' });
  for (const [i,row] of r.observations.records.entries()) { for (const key of ['id','time','x','y','z','line_id','extra']) expect(row[key]).toEqual(f.survey.records[i][key]); expect(row.values.other).toBe(f.survey.records[i].values.other); }
  expect((await inspectGeophysicsCorrections(r.observations)).state).toBe('ok');
});
it('interpolates the circular seam when no node is at zero',async () => {
  const f = fixture(); f.options.calibration = [{heading_degrees:350,bias_nT:-2},{heading_degrees:10,bias_nT:2}]; f.options.max_heading_gap = 20;
  const biases = [-2,-1,0,1,2,0]; f.survey.records = [350,355,0,5,10,360].map((h,i) => ({id:String(i),values:{mag:100+biases[i]},extra:{sensor_heading:h}}));
  const r = await correctGeophysicsMagneticHeading(f.survey,f.options); expect(r.state).toBe('ok'); expect(r.proposals.map((p) => p.bias_nT)).toEqual(biases); expect(r.observations.records.map((row) => row.values.mag)).toEqual([100,100,100,100,100,100]);
});
it('supports exact nodes even when adjacent interpolation gaps exceed the limit',async () => {
  const f = fixture(); f.survey.records = [f.survey.records[0],f.survey.records[4]]; f.options.calibration = [{heading_degrees:0,bias_nT:10},{heading_degrees:180,bias_nT:2}]; f.options.max_heading_gap = 1;
  expect((await correctGeophysicsMagneticHeading(f.survey,f.options)).state).toBe('ok');
});
it.each(['true_north','magnetic_north','grid_north'])('uses explicitly matched %s references',async (ref) => {
  const f = fixture(); f.options.heading_reference = ref; f.survey.metadata.heading.reference = ref; expect((await correctGeophysicsMagneticHeading(f.survey,f.options)).state).toBe('ok');
});
it.each(['missing_heading','missing_context','frame','units','positive','key','sparse','unknown','applied'])('refuses %s atomically',async (change) => {
  const f = fixture();
  if (change === 'missing_heading') delete f.survey.records[3].extra.sensor_heading;
  if (change === 'missing_context') delete f.survey.metadata.heading;
  if (change === 'frame') f.survey.metadata.heading.reference = 'grid_north';
  if (change === 'units') f.survey.metadata.heading.units = 'radians';
  if (change === 'positive') f.survey.metadata.heading.positive = 'counterclockwise';
  if (change === 'key') f.survey.metadata.heading.key = 'track';
  if (change === 'sparse') f.options.calibration = [{heading_degrees:0,bias_nT:10},{heading_degrees:90,bias_nT:-6}];
  if (change === 'unknown') f.survey.metadata.corrections = {};
  if (change === 'applied') f.survey.metadata.corrections.heading = 'applied';
  const before = JSON.stringify(f); const r = await correctGeophysicsMagneticHeading(f.survey,f.options);
  expect(['needs_input','rejected']).toContain(r.state); expect(r.observations).toBeNull(); expect(r.ledger).toBeNull(); expect(JSON.stringify(f)).toBe(before);
  if (change === 'missing_heading') expect(r.proposals[3].reason).toBe('missing_heading');
  if (change === 'sparse') expect(r.proposals.some((p) => p.reason === 'excessive_heading_gap')).toBe(true);
});
it.each([true,'45',-1,361,NaN])('rejects invalid heading %j even on null magnetic records',async (value) => {
  for (const index of [0,9]) { const f = fixture(); f.survey.records[index].extra.sensor_heading = value; const r = await correctGeophysicsMagneticHeading(f.survey,f.options); expect(r.state).toBe('rejected'); expect(r.observations).toBeNull(); }
});
it.each(['duplicate','node_360','bias_bool','empty','missing_bias','gap_zero','gap_large','sign','reference','field','units','extra_option'])('rejects malformed %s',async (change) => {
  const f = fixture(); const opts = f.options;
  if (change === 'duplicate') opts.calibration[1].heading_degrees = opts.calibration[0].heading_degrees;
  if (change === 'node_360') opts.calibration[0].heading_degrees = 360;
  if (change === 'bias_bool') opts.calibration[0].bias_nT = true;
  if (change === 'empty') opts.calibration = [];
  if (change === 'missing_bias') delete opts.calibration[0].bias_nT;
  if (change === 'gap_zero') opts.max_heading_gap = 0;
  if (change === 'gap_large') opts.max_heading_gap = 181;
  if (change === 'sign') opts.bias_convention = 'additive_correction';
  if (change === 'reference') opts.heading_reference = 'unknown';
  if (change === 'field') f.survey.channels.mag.field_type = 'gravity_anomaly';
  if (change === 'units') f.survey.channels.mag.units = 'T';
  if (change === 'extra_option') opts.auto_fit = true;
  expect((await correctGeophysicsMagneticHeading(f.survey,opts)).state).toBe('rejected');
});
it('requires all options and bounds input/model size',async () => {
  const f = fixture();
  for (const key of Object.keys(f.options)) { const opts = {...f.options}; delete opts[key]; expect((await correctGeophysicsMagneticHeading(f.survey,opts)).state).toBe('needs_input'); }
  const opts = {...f.options,calibration:Array.from({length:73},(_,i) => ({heading_degrees:i,bias_nT:1}))}; expect((await correctGeophysicsMagneticHeading(f.survey,opts)).issues[0].code).toBe('resource');
  f.survey.records = Array.from({length:4097},(_,i) => ({...f.survey.records[0],id:String(i)})); expect((await correctGeophysicsMagneticHeading(f.survey,f.options)).issues[0].code).toBe('resource');
});
it('detects edited heading/model/context bindings and guards repeat or stripped history',async () => {
  const out = await corrected(); expect((await correctGeophysicsMagneticHeading(out,{...fixture().options,event_id:'repeat'})).state).toBe('rejected');
  for (const change of ['heading','null_heading','context','model','calibration_id','gap','binding','drop','count']) {
    const bad = JSON.parse(JSON.stringify(out)); const entry = bad.metadata.correction_ledger.entries.at(-1);
    if (change === 'heading') bad.records[0].extra.sensor_heading = 1;
    if (change === 'null_heading') bad.records.at(-1).extra.sensor_heading = 1;
    if (change === 'context') bad.metadata.heading.reference = 'grid_north';
    if (change === 'model') entry.parameters.calibration[0].bias_nT += 1;
    if (change === 'calibration_id') entry.parameters.calibration_id = 'changed';
    if (change === 'gap') entry.parameters.max_heading_gap = 100;
    if (change === 'binding') entry.heading_binding = '0'.repeat(64);
    if (change === 'drop') delete bad.metadata.correction_ledger;
    if (change === 'count') entry.affected_records -= 1;
    expect((await inspectGeophysicsCorrections(bad)).state,change).toBe('rejected');
  }
});
it('preserves source uncertainty in remappable flat lineage',async () => {
  const out = await corrected(); const step = out.metadata.processing.at(-1);
  for (const name of ['uncertainty','variance','standard_deviation']) { expect(Object.hasOwn(out.metadata,name)).toBe(false); expect(out.metadata.input_lineage[step.operand_lineage].metadata[name]).toEqual(fixture().survey.metadata[name]); }
  const {nodes,operand} = appendInput({source:'foreign.xyz'},out.metadata); const moved = nodes[operand].metadata.processing.at(-1); expect(nodes[moved.operand_lineage].metadata.source).toBe('heading-test.xyz'); expect(encodeProvenance({input_lineage:nodes},'GeoTIFF','float64')).toBeTruthy();
});
it('retains original heading counts/bindings after a subsequent lag mask',async () => {
  const f = fixture(); f.survey.metadata.corrections.lag = 'unapplied'; const heading = await correctGeophysicsMagneticHeading(f.survey,f.options);
  const lag = await correctGeophysicsMagneticLag(heading.observations,{channel:'mag',lag_seconds:.5,max_gap:1,unsupported_policy:'mask',event_id:'lag-1',evidence:'synthetic',clock_policy:'synchronized'});
  expect(lag.state,JSON.stringify(lag.issues)).toBe('ok'); expect((await inspectGeophysicsCorrections(lag.observations)).state).toBe('ok'); expect(lag.ledger.entries.filter((e) => e.kind === 'application').map((e) => e.affected_records)).toEqual([9,9]);
});
