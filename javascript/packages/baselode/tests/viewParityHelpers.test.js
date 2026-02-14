import { describe, expect, it } from 'vitest';

import {
  planView,
  projectTraceToSection,
  sectionView,
  sectionWindow
} from '../src/viz/view2d.js';
import {
  annotationsFromIntervals,
  intervalsAsTubes,
  tracesAsSegments
} from '../src/viz/view3dPayload.js';


describe('view2d parity helpers', () => {
  const traces = [
    { hole_id: 'H1', x: 0, y: 0, z: 10, grade: 1.0 },
    { hole_id: 'H1', x: 10, y: 0, z: 5, grade: 1.5 },
    { hole_id: 'H2', x: 0, y: 10, z: -5, grade: 2.0 }
  ];

  it('projects traces to section with along/across columns', () => {
    const projected = projectTraceToSection(traces, [0, 0], 0);
    expect(projected).toHaveLength(3);
    expect(projected[0]).toHaveProperty('along');
    expect(projected[0]).toHaveProperty('across');
    expect(projected[1].along).toBeCloseTo(0, 12);
    expect(projected[1].across).toBeCloseTo(10, 12);
  });

  it('filters section window by width around section line', () => {
    const windowed = sectionWindow(traces, [0, 0], 0, 8);
    expect(windowed).toHaveLength(2);
    windowed.forEach((row) => {
      expect(Math.abs(row.across)).toBeLessThanOrEqual(4);
    });
  });

  it('creates plan and section views with color_value when requested', () => {
    const plan = planView(traces, [10, 0], 'grade');
    expect(plan).toHaveLength(2);
    expect(plan[0]).toHaveProperty('color_value');

    const section = sectionView(traces, [0, 0], 0, 20, 'grade');
    expect(section).toHaveLength(3);
    expect(section[1]).toHaveProperty('color_value');
  });
});


describe('view3d payload parity helpers', () => {
  const traceRows = [
    { hole_id: 'H1', md: 10, x: 1, y: 2, z: 3, grade: 1.1 },
    { hole_id: 'H1', md: 0, x: 0, y: 0, z: 0, grade: 1.0 },
    { hole_id: 'H2', md: 5, x: 5, y: 6, z: 7, grade: 2.0 }
  ];

  const intervals = [
    { hole_id: 'H1', from: 0, to: 10, grade: 1.2, lith: 'A' },
    { hole_id: 'H2', from: 10, to: 20, grade: 2.3, lith: 'B' }
  ];

  it('groups trace rows into segment payloads sorted by md', () => {
    const segments = tracesAsSegments(traceRows, 'grade');
    expect(segments).toHaveLength(2);
    const h1 = segments.find((s) => s.hole_id === 'H1');
    expect(h1.x).toEqual([0, 1]);
    expect(h1.color).toEqual([1.0, 1.1]);
  });

  it('converts intervals to tube payloads', () => {
    const tubes = intervalsAsTubes(intervals, 2.5, 'grade');
    expect(tubes).toHaveLength(2);
    expect(tubes[0]).toMatchObject({
      hole_id: 'H1',
      from: 0,
      to: 10,
      radius: 2.5,
      color: 1.2,
      value: 1.2
    });
  });

  it('creates interval annotations from label column', () => {
    const annotations = annotationsFromIntervals(intervals, 'lith');
    expect(annotations).toHaveLength(2);
    expect(annotations[0]).toMatchObject({
      hole_id: 'H1',
      label: 'A',
      depth: 5
    });
  });
});
