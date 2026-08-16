/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SectionHelper, SliceHelper } from '../src/viz/sectionSliceHelpers.js';

function makeContext() {
  const camera = new THREE.PerspectiveCamera(40, 2, 0.1, 10000);
  camera.position.set(100, 100, 100);
  const externalPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 5);
  return {
    camera,
    container: { clientWidth: 800, clientHeight: 400 },
    renderer: { clippingPlanes: [externalPlane], localClippingEnabled: false },
    controls: { object: camera, target: new THREE.Vector3(), enableRotate: true, enabled: true, update() {} },
    flyControls: { object: camera, enabled: false },
    gizmo: { camera },
    _composer: { passes: [{ camera }] },
    controlMode: 'orbit',
    externalPlane,
  };
}

describe('section and slab helpers', () => {
  it('uses an orthographic camera for an X section and restores the host view', () => {
    const ctx = makeContext();
    const helper = new SectionHelper(ctx).enable('x', 25);

    expect(ctx.camera.isOrthographicCamera).toBe(true);
    expect(ctx.controls.enableRotate).toBe(false);
    expect(ctx.renderer.clippingPlanes).toHaveLength(2);
    helper.setPosition(30);
    expect(helper.plane.constant).toBe(30);

    helper.disable();
    expect(ctx.camera.isPerspectiveCamera).toBe(true);
    expect(ctx.controls.enableRotate).toBe(true);
    expect(ctx.renderer.clippingPlanes).toEqual([ctx.externalPlane]);
    expect(ctx.renderer.localClippingEnabled).toBe(true);
  });

  it('keeps only the finite X/Y slab and mutates its existing planes', () => {
    const ctx = makeContext();
    const helper = new SliceHelper(ctx).enable('y', 20, 10);
    const [lower, upper] = helper.planes;

    expect(ctx.renderer.clippingPlanes).toHaveLength(3);
    expect(lower.distanceToPoint(new THREE.Vector3(0, 14, 0))).toBeLessThan(0);
    expect(upper.distanceToPoint(new THREE.Vector3(0, 26, 0))).toBeLessThan(0);
    expect(lower.distanceToPoint(new THREE.Vector3(0, 20, 0))).toBeGreaterThanOrEqual(0);
    expect(upper.distanceToPoint(new THREE.Vector3(0, 20, 0))).toBeGreaterThanOrEqual(0);
    helper.setPosition(40).setWidth(20);
    expect(helper.planes[0]).toBe(lower);
    expect(helper.planes[1]).toBe(upper);
    expect(lower.distanceToPoint(new THREE.Vector3(0, 30, 0))).toBe(0);
    expect(upper.distanceToPoint(new THREE.Vector3(0, 50, 0))).toBe(0);
  });

  it('makes a section and a slab mutually exclusive', () => {
    const ctx = makeContext();
    const section = new SectionHelper(ctx).enable('x', 0);
    const slab = new SliceHelper(ctx).enable('x', 0, 10);

    expect(section.active).toBe(false);
    expect(slab.active).toBe(true);
    expect(ctx.camera.isPerspectiveCamera).toBe(true);
  });
});
