/* Copyright (C) 2026 Darkmine Pty Ltd — SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildDrillholeColorLayer, createIntervalTexture, createHoleTexture, drillholeTextureLayout } from '../src/viz/drillholeColorTexture.js';
import { setDrillholes, clearDrillholes, setDrillholeAnnotations, setDrillholeColorBy, setDrillholeFilter } from '../src/viz/drillholeScene.js';
import { buildCollarMarkers, disposeAnnotationGroup } from '../src/viz/drillholeAnnotations.js';
import { createDrillholeTubeMaterial, createDrillholeUniforms } from '../src/viz/drillholeMaterial.js';
import Baselode3DScene from '../src/viz/baselode3dScene.js';

const holes = count => Array.from({ length: count }, (_, i) => ({ id: `H${i}`, points: [
  { x: i * 10, y: 0, z: 100, md: 0 }, { x: i * 10, y: 0, z: 90, md: 10 },
] }));
const context = maxTextureSize => ({ scene: new THREE.Scene(), renderer: { capabilities: { maxTextureSize } }, blocks: [], structuralMeshes: [], drillMeshes: [], drillLines: [] });

describe('large drillhole colour textures', () => {
  it('fits 43,000 base colours into the hardware limit without dropping data', () => {
    const data = new Float32Array(43000 * 4);
    for (let i = 0; i < 43000; i++) data[i * 4] = i;
    const texture = createHoleTexture(data, 43000, 8192);
    expect(texture.image.width).toBeLessThanOrEqual(8192);
    expect(texture.image.height).toBeLessThanOrEqual(8192);
    for (let i = 0; i < 43000; i++) expect(texture.image.data[i * 4]).toBe(i);
    expect(texture.image.data.length).toBe(texture.image.width * texture.image.height * 4);
    texture.dispose();
  });
  it.each([8192, 16384])('fits 43,000 rows of 1,024 depth samples into %i-pixel hardware', limit => {
    const layout = drillholeTextureLayout(1024, 43000, limit);
    expect(layout.width).toBeLessThanOrEqual(limit); expect(layout.height).toBeLessThanOrEqual(limit);
    expect(layout.width * layout.height).toBeGreaterThanOrEqual(43000 * 1024);
    // Shader addressing keeps integer operations below the texture dimensions;
    // no 44-million-element float index is used, so end samples stay distinct.
    for (const hole of [0, 2, 3, 8191, 16384, 42999]) {
      for (const depth of [0, 1, 511, 512, 1022, 1023]) {
        const x = (hole % layout.columns) * 1024 + depth;
        const y = Math.floor(hole / layout.columns);
        const u = Math.fround((x + 0.5) / layout.width), v = Math.fround((y + 0.5) / layout.height);
        expect(Math.floor(u * layout.width)).toBe(x); expect(Math.floor(v * layout.height)).toBe(y);
        expect(y * layout.width + x).toBe(hole * 1024 + depth);
      }
    }
  });
  it('retains every value through GPU packing and shares the padded CPU allocation', () => {
    const meta = Array.from({ length: 43000 }, (_, index) => ({ id: `H${index}`, index, mdMin: 0, length: 16 }));
    const layer = buildDrillholeColorLayer(meta, { mode: 'presence', depthTexels: 16, maxTextureSize: 8192,
      intervalsByHole: { H0: [{ from: 0, to: 1 }], H42999: [{ from: 15, to: 16 }] } });
    const texture = createIntervalTexture(layer, 8192);
    expect(texture.image.data).toBe(layer.intervalData);
    expect(texture.image.data[0]).toBe(1);
    expect(texture.image.data[1]).toBe(-1);
    expect(texture.image.data[42999 * 16 + 15]).toBe(1);
    expect(texture.image.data[42999 * 16 + 14]).toBe(-1);
    expect(texture.image.width).toBeLessThanOrEqual(8192); expect(texture.image.height).toBeLessThanOrEqual(8192);
    texture.dispose();
  });
  it('reports insufficient device capacity without silently reducing samples', () => {
    expect(() => drillholeTextureLayout(1024, 43000, 4096)).toThrow(/texture limit/);
    expect(() => createHoleTexture(new Float32Array(68), 17, 4)).toThrow(/capacity/);
  });
  it('retains separate layouts during colour transitions and updates packed filter flags', () => {
    const ctx = context(128);
    setDrillholes(ctx, holes(260), { labels: false, depthTexels: 16, selectedAssayVariable: '__HAS_ASSAY__' });
    const layer = ctx.drillholeLayer;
    expect(layer.uniforms.uIntervalLayout.value.toArray()).toEqual([3, 87, 16]);
    expect(layer.holeTexData).toBe(layer.textures.hole.image.data);
    setDrillholeFilter(ctx, ['H259']);
    expect(layer.textures.hole.image.data[3]).toBe(0); expect(layer.textures.hole.image.data[259 * 4 + 3]).toBe(1);
    setDrillholeColorBy(ctx, { depthTexels: 32 });
    expect(layer.uniforms.uIntervalLayoutPrev.value.toArray()).toEqual([3, 87, 16]);
    expect(layer.uniforms.uIntervalLayout.value.toArray()).toEqual([3, 87, 32]);
    const texture = layer.textures.interval;
    expect(() => setDrillholeColorBy(ctx, { depthTexels: 1024 })).toThrow(/texture limit/);
    expect(layer.textures.interval).toBe(texture);
    clearDrillholes(ctx);
  });
  it('injects packed addresses into the material with distinct previous/current layouts', () => {
    const material = createDrillholeTubeMaterial(createDrillholeUniforms());
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    material.onBeforeCompile(shader);
    expect(shader.fragmentShader).toContain('mod(vHole, uHoleTexSize.x)');
    expect(shader.fragmentShader).toContain('uModePrev, baselodeHole.rgb, uIntervalLayoutPrev');
    expect(shader.fragmentShader).not.toContain('baselodeRow');
    material.dispose();
  });
});

describe('annotation and pointer work', () => {
  it('does not create labels or drop lines until enabled, and disposes them when disabled', () => {
    const ctx = context(4096); setDrillholes(ctx, holes(3), { labels: false, dropLines: false });
    const layer = ctx.drillholeLayer;
    expect(layer.labels).toBe(null); expect(layer.dropLines).toBe(null);
    layer.datumZ = 0;
    setDrillholeAnnotations(ctx, { labels: true, dropLines: true });
    expect(layer.labels).not.toBe(null); expect(layer.dropLines).not.toBe(null);
    const geometry = layer.dropLines.geometry, dispose = vi.spyOn(geometry, 'dispose');
    setDrillholeAnnotations(ctx, { labels: false, dropLines: false });
    expect(layer.labels).toBe(null); expect(layer.dropLines).toBe(null); expect(dispose).toHaveBeenCalledOnce();
    clearDrillholes(ctx);
  });
  it('can disable hover picking without disabling click or orbit handlers', () => {
    const scene = new Baselode3DScene({ hoverPicking: false });
    const handlers = {};
    scene.renderer = { domElement: { addEventListener: (type, handler) => { handlers[type] = handler; } } };
    scene.container = { addEventListener: () => {} };
    scene._setHover = vi.fn(); scene._attachPointerHandlers();
    handlers.pointermove({ clientX: 0, clientY: 0 });
    expect(scene._setHover).not.toHaveBeenCalled(); expect(handlers.pointerdown).toBeTypeOf('function');
  });
});

describe('collar picking', () => {
  it('matches standard instanced triangle picking with transformed parents and near/far clipping', () => {
    const entries = Array.from({ length: 400 }, (_, i) => ({ id: `H${i}`, index: i, collar: new THREE.Vector3(i % 20 * 10, Math.floor(i / 20) * 10, i % 3), mdMin: 0 }));
    const group = buildCollarMarkers(entries, [], { radius: 2 });
    group.rotation.x = 0.3; group.scale.set(1.2, 1.5, 0.8); group.position.set(5, -10, 100); group.updateMatrixWorld(true);
    const disc = group.children.find(child => child.userData.isCollarDiscs);
    const inverse = new THREE.Matrix3().getNormalMatrix(group.matrixWorld);
    const direction = new THREE.Vector3(0, 0, -1).applyMatrix3(inverse).normalize();
    const normalise = hits => hits.map(hit => [hit.instanceId, hit.distance]).sort((a, b) => a[1] - b[1]);
    for (const i of [0, 19, 200, 399]) {
      const target = entries[i].collar.clone().add(new THREE.Vector3(0.5, 0.3, 0.1)).applyMatrix4(group.matrixWorld);
      const ray = new THREE.Raycaster(target.clone().addScaledVector(direction, -30), direction, 0, 100);
      for (const far of [100, 1]) {
        ray.far = far; const actual = [], expected = [];
        disc.raycast(ray, actual); THREE.InstancedMesh.prototype.raycast.call(disc, ray, expected);
        expect(normalise(actual)).toEqual(normalise(expected));
      }
    }
    disposeAnnotationGroup(group);
  });
});
