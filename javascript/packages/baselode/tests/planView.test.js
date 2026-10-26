/* Copyright (C) 2026 Darkmine Pty Ltd — SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from 'vitest';
import { fitPlanView, planToScreen, screenToPlan, zoomPlanView, panPlanView } from '../src/viz/planView.js';

describe('local plan-view coordinate contract', () => {
  const points = [{x:-1000,y:-500},{x:1000,y:500}];
  it('fits the full local extent without interpreting it as longitude/latitude', () => {
    const view = fitPlanView(points, 800, 400, 40);
    for (const p of points) {
      const s = planToScreen(view,p.x,p.y);
      expect(s.x).toBeGreaterThanOrEqual(40); expect(s.x).toBeLessThanOrEqual(760);
      expect(s.y).toBeGreaterThanOrEqual(40); expect(s.y).toBeLessThanOrEqual(360);
    }
    expect(view.x).toBe(0); expect(view.y).toBe(0);
  });
  it('preserves equal X/Y scale and positive Y upward', () => {
    const view=fitPlanView(points,800,400);
    const origin=planToScreen(view,0,0), east=planToScreen(view,10,0), up=planToScreen(view,0,10);
    expect(east.x-origin.x).toBeCloseTo(origin.y-up.y);
    expect(up.y).toBeLessThan(origin.y);
  });
  it('round trips local coordinates without modifying the observations', () => {
    const original=JSON.stringify(points), view=fitPlanView(points,850,420);
    for(const p of points) {const s=planToScreen(view,p.x,p.y), back=screenToPlan(view,s.x,s.y); expect(back.x).toBeCloseTo(p.x);expect(back.y).toBeCloseTo(p.y);}
    expect(JSON.stringify(points)).toBe(original);
  });
  it('keeps the point under the cursor fixed during zoom', () => {
    const view=fitPlanView(points,800,400), before=screenToPlan(view,180,110);
    const zoomed=zoomPlanView(view,2,180,110), after=screenToPlan(zoomed,180,110);
    expect(after.x).toBeCloseTo(before.x);expect(after.y).toBeCloseTo(before.y);
    expect(zoomed.scale).toBe(view.scale*2);
  });
  it('pans by the requested screen distance without changing scale or source state', () => {
    const view=fitPlanView(points,800,400), saved={...view}, before=planToScreen(view,0,0);
    const panned=panPlanView(view,60,25), after=planToScreen(panned,0,0);
    expect(after.x-before.x).toBeCloseTo(60);expect(after.y-before.y).toBeCloseTo(25);
    expect(panned.scale).toBe(view.scale);expect(view).toEqual(saved);
  });
  it('handles empty, constant and one-axis extents with a finite scale', () => {
    for(const p of [[],[{x:10,y:20}],[{x:1,y:0},{x:1,y:100}]]) {
      const view=fitPlanView(p,400,300);expect(Number.isFinite(view.scale)).toBe(true);expect(view.scale).toBeGreaterThan(0);
    }
  });
  it('excludes nonfinite coordinates from extent fitting', () => {
    expect(fitPlanView([...points,{x:Infinity,y:0},{x:0,y:NaN}],800,400)).toEqual(fitPlanView(points,800,400));
  });
  it('rejects invalid dimensions and zoom factors', () => {
    expect(()=>fitPlanView(points,0,400)).toThrow();const view=fitPlanView(points,800,400);
    for(const factor of [0,-1,Infinity,NaN])expect(()=>zoomPlanView(view,factor)).toThrow();
  });
});
