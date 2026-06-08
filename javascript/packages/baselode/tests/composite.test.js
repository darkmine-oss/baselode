/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { compositeIntervals } from '../src/data/composite.js';

function intervals(holeId, edges, values, domains) {
  const out = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const row = { hole_id: holeId, from: edges[i], to: edges[i + 1], value: values[i] };
    if (domains) row.domain = domains[i];
    out.push(row);
  }
  return out;
}

describe('compositeIntervals — soft mode', () => {
  it('defaults to soft mode', () => {
    const data = intervals('A', [0, 1, 2, 3], [1, 2, 3]);
    const a = compositeIntervals(data, 'value', { length: 1.5 });
    const b = compositeIntervals(data, 'value', { length: 1.5, mode: 'soft' });
    expect(a).toEqual(b);
  });

  it('length-weighted average per bin', () => {
    const data = intervals('A', [0, 1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    const out = compositeIntervals(data, 'value', { length: 2 });
    expect(out[0].value).toBeCloseTo(1.5, 9);
    expect(out[1].value).toBeCloseTo(3.5, 9);
    expect(out[2].value).toBeCloseTo(5.0, 9);
  });

  it('method=sum preserves total value*length', () => {
    const data = intervals('A', [0, 1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    const out = compositeIntervals(data, 'value', { length: 2, method: 'sum' });
    const total = out.reduce((s, r) => s + r.value, 0);
    expect(total).toBeCloseTo(15, 9);
  });

  it('returns empty for empty input', () => {
    expect(compositeIntervals([], 'value')).toEqual([]);
  });
});

describe('compositeIntervals — hard mode', () => {
  it('requires boundaryCol', () => {
    const data = intervals('A', [0, 1, 2], [1, 2]);
    expect(() => compositeIntervals(data, 'value', { mode: 'hard' })).toThrow(/boundaryCol/);
  });

  it('never straddles a coded contact', () => {
    const data = intervals(
      'A',
      [0, 1, 2, 3, 4, 5, 6],
      [1, 1, 1, 9, 9, 9],
      ['G', 'G', 'G', 'S', 'S', 'S'],
    );
    const out = compositeIntervals(data, 'value', {
      length: 2, mode: 'hard', boundaryCol: 'domain',
    });
    for (const row of out) {
      expect(row.from < 3 && row.to > 3).toBe(false);
    }
    expect(new Set(out.map((r) => r.domain))).toEqual(new Set(['G', 'S']));
  });

  it('residual=discard drops a short tail', () => {
    const data = intervals('A', [0, 1, 2, 3], [1, 1, 5], ['G', 'G', 'G']);
    const out = compositeIntervals(data, 'value', {
      length: 2, mode: 'hard', boundaryCol: 'domain', residual: 'discard',
    });
    expect(out).toHaveLength(1);
    expect(out[0].to).toBeCloseTo(2, 9);
  });

  it('residual=add_to_previous extends the last bin', () => {
    const data = intervals('A', [0, 1, 2, 3], [1, 1, 5], ['G', 'G', 'G']);
    const out = compositeIntervals(data, 'value', {
      length: 2, mode: 'hard', boundaryCol: 'domain', residual: 'add_to_previous',
    });
    expect(out).toHaveLength(1);
    expect(out[0].to).toBeCloseTo(3, 9);
    expect(out[0].value).toBeCloseTo(7 / 3, 9);
  });

  it('residual=distribute uses round(D/length) equal bins', () => {
    const data = intervals('A', [0, 1, 2, 3], [2, 4, 6], ['G', 'G', 'G']);
    const out = compositeIntervals(data, 'value', {
      length: 2, mode: 'hard', boundaryCol: 'domain', residual: 'distribute',
    });
    expect(out).toHaveLength(2);
    expect(out[0].from).toBeCloseTo(0, 9);
    expect(out[0].to).toBeCloseTo(1.5, 9);
    expect(out[1].from).toBeCloseTo(1.5, 9);
    expect(out[1].to).toBeCloseTo(3, 9);
  });

  it('non-abutting same-domain rows form separate runs', () => {
    const data = [
      { hole_id: 'A', from: 0, to: 1, value: 1, domain: 'G' },
      { hole_id: 'A', from: 1, to: 2, value: 1, domain: 'G' },
      // 3 m gap
      { hole_id: 'A', from: 5, to: 6, value: 9, domain: 'G' },
      { hole_id: 'A', from: 6, to: 7, value: 9, domain: 'G' },
    ];
    const out = compositeIntervals(data, 'value', {
      length: 2, mode: 'hard', boundaryCol: 'domain',
    });
    const froms = out.map((r) => r.from).sort((a, b) => a - b);
    expect(froms).toEqual([0, 5]);
  });
});
