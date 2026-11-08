/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import descriptor from './geophysics_crossovers.json';
const limits = descriptor.resources;
export class CrossoverResourceError extends Error {}
export function describeGeophysicsCrossovers() { return JSON.parse(JSON.stringify(descriptor)); }
export function crossoverSum(values) {
  let total = 0; let correction = 0;
  for (const value of values) { const updated = total + value; correction += Math.abs(total) >= Math.abs(value) ? (total - updated) + value : (value - updated) + total; total = updated; }
  return total + correction;
}
export function crossoverRms(values) {
  if (!values.length) return null;
  const scale = Math.max(...values.map(Math.abs));
  return scale ? Math.sqrt(crossoverSum(values.map((v) => (v / scale) ** 2)) / values.length) * scale : 0;
}
const linear = (left, right, t) => t === 0 ? left : (t === 1 ? right : (left === null || right === null ? null : left + (right - left) * t));
const number = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e100;
export function computeCrossovers(data, params) {
  const records = data.records; const channel = params.channel; const tol = params.intersection_tolerance;
  const lines = []; const segments = []; let longSegments = 0; let previous = null;
  records.forEach((row, index) => {
    const line = row.line_id;
    if (!previous || previous.line_id !== line) {
      if (lines.includes(line)) throw Error('each line_id must form one contiguous acquisition run; relabel repeated runs explicitly');
      lines.push(line); if (lines.length > limits.max_lines) throw new CrossoverResourceError('crossovers accept at most 128 lines');
    } else {
      const rx = row.x - previous.x; const ry = row.y - previous.y; const length = Math.hypot(rx, ry);
      if (length <= 2 * tol) throw Error('coincident/tiny consecutive geometry requires QC or a smaller declared tolerance');
      if (length > params.max_segment_length) longSegments += 1;
      else segments.push({ index:index-1, line, line_index:lines.length-1, left:previous, right:row, rx, ry, length, minx:Math.min(previous.x,row.x), maxx:Math.max(previous.x,row.x), miny:Math.min(previous.y,row.y), maxy:Math.max(previous.y,row.y) });
    }
    previous = row;
  });
  if (segments.length > limits.max_segments) throw new CrossoverResourceError('too many crossover segments');
  let active = []; const unique = new Map(); let pairTests = 0; let rawCount = 0; let parallel = 0; let duplicates = 0;
  for (const current of [...segments].sort((a,b) => a.minx - b.minx || a.index - b.index)) {
    active = active.filter((s) => s.maxx + tol >= current.minx);
    for (const old of active) {
      pairTests += 1; if (pairTests > limits.max_pair_tests) throw new CrossoverResourceError('crossover sweep exceeds 1000000 active pair tests; partition by complete lines and retain required references');
      if (old.line === current.line || old.maxy + tol < current.miny || current.maxy + tol < old.miny) continue;
      const [a,b] = old.line_index < current.line_index ? [old,current] : [current,old];
      const rs = Math.max(Math.abs(a.rx),Math.abs(a.ry)); const ss = Math.max(Math.abs(b.rx),Math.abs(b.ry));
      const rx = a.rx / rs; const ry = a.ry / rs; const sx = b.rx / ss; const sy = b.ry / ss; const denominator = rx * sy - ry * sx;
      if (Math.abs(denominator) <= limits.parallel_threshold) { parallel += 1; continue; }
      const qx = b.left.x - a.left.x; const qy = b.left.y - a.left.y;
      let t = ((qx / rs) * sy - (qy / rs) * sx) / denominator; let u = ((qx / ss) * ry - (qy / ss) * rx) / denominator;
      if (t < -tol/a.length || t > 1+tol/a.length || u < -tol/b.length || u > 1+tol/b.length) continue;
      const snap = (v,l) => v <= tol/l ? 0 : (v >= 1-tol/l ? 1 : v);
      t = snap(t,a.length); u = snap(u,b.length);
      const pax = a.rx*t; const pay = a.ry*t; const pbx = qx+b.rx*u; const pby = qy+b.ry*u;
      if (Math.hypot(pax-pbx,pay-pby) > tol) continue;
      rawCount += 1; if (rawCount > limits.max_raw_crossovers) throw new CrossoverResourceError('too many raw crossover candidates');
      const angle = Math.atan2(Math.abs(denominator),Math.abs(rx*sx+ry*sy))*(180/Math.PI);
      const va = linear(a.left.values[channel],a.right.values[channel],t); const vb = linear(b.left.values[channel],b.right.values[channel],u);
      const za = linear(a.left.z,a.right.z,t); const zb = linear(b.left.z,b.right.z,u);
      const dz = za === null || zb === null ? null : Math.abs(za-zb); const difference = va === null || vb === null ? null : va-vb;
      if ([va,vb,za,zb,dz,difference].some((v) => v !== null && !number(v))) throw Error('interpolated crossover values exceed portable numeric range');
      let reason = null;
      if (va === null || vb === null) reason = 'missing_reading';
      else if (angle < params.min_crossing_angle) reason = 'shallow_angle';
      else if (params.elevation_policy === 'limit') { if (za === null || zb === null) reason = 'missing_height'; else if (dz > params.max_height_difference) reason = 'height_difference'; }
      const location = (s,f) => f === 0 || f === 1 ? ['v',f === 0 ? s.left.id : s.right.id] : ['s',s.index];
      const key = JSON.stringify([a.line_index,b.line_index,location(a,t),location(b,u)]);
      const row = { line_a:a.line, line_b:b.line, x:a.left.x+(pax+pbx)/2, y:a.left.y+(pay+pby)/2, segment_a:[a.left.id,a.right.id], segment_b:[b.left.id,b.right.id], fraction_a:t, fraction_b:u, angle_degrees:angle, value_a:va, value_b:vb, height_a:za, height_b:zb, height_difference:dz, difference, eligible:reason === null, reason };
      const candidate = {row, ai:a.index, bi:b.index};
      if (unique.has(key)) {
        duplicates += 1; const prior = unique.get(key);
        const rank = [Number(row.eligible),angle,-a.index,-b.index]; const oldRank = [Number(prior.row.eligible),prior.row.angle_degrees,-prior.ai,-prior.bi];
        let better = false; for (let i=0;i<rank.length;i+=1) { if (rank[i] !== oldRank[i]) { better = rank[i] > oldRank[i]; break; } }
        if (better) unique.set(key,candidate);
      } else { unique.set(key,candidate); if (unique.size > limits.max_crossovers) throw new CrossoverResourceError('too many unique crossovers'); }
    }
    active.push(current);
  }
  const crossings = [...unique.values()].sort((a,b) => a.ai-b.ai || a.bi-b.bi).map((item,index) => ({id:`x${index}`,...item.row}));
  const eligible = crossings.filter((row) => row.eligible).map((row) => row.difference);
  return {crossovers:crossings,lines,diagnostics:{records:records.length,lines:lines.length,segments:segments.length,long_segments_excluded:longSegments,pair_tests:pairTests,raw_crossovers:rawCount,vertex_duplicates:duplicates,parallel_candidates_excluded:parallel},summary:{crossovers:crossings.length,eligible:eligible.length,rms_difference:crossoverRms(eligible)}};
}
