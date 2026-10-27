/* Copyright (C) 2026 Darkmine Pty Ltd — SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { registerMeshObject, unregisterMeshObject, clearMeshObjects, setMeshObjectColor, pickMeshObject } from '../src/viz/meshObjects.js';
import { syncSelectables } from '../src/viz/sceneSelectables.js';
import { attachCanvasClickHandler, pickScene } from '../src/viz/sceneClickHandler.js';

function context() {
  return { meshObjects: new Map(), blocks: [], drillMeshes: [], structuralMeshes: [],
    drillholeLayer: null, _outlinePass: { selectedObjects: [] }, _selectedObject: null,
    raycaster: new THREE.Raycaster(new THREE.Vector3(0, 0, 20), new THREE.Vector3(0, 0, -1)) };
}
function group(z = 0, material = new THREE.MeshStandardMaterial({ color: '#ccaa00', opacity: 0.6, transparent: true })) {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material));
  root.position.z = z;
  root.updateMatrixWorld(true);
  return root;
}

describe('registered mesh objects', () => {
  it('picks the nearest mesh and returns the entire registered group', () => {
    const ctx = context(), far = group(), near = group(5);
    registerMeshObject(ctx, 'far', far);
    registerMeshObject(ctx, 'near', near, { name: 'Near solid' });
    expect(pickScene(ctx)).toMatchObject({ type: 'mesh', id: 'near', name: 'Near solid', object: near });
  });
  it('ignores hidden children and hidden ancestors', () => {
    const ctx = context(), near = group(5), far = group();
    registerMeshObject(ctx, 'near', near); registerMeshObject(ctx, 'far', far);
    near.children[0].visible = false;
    expect(pickMeshObject(ctx, ctx.raycaster).id).toBe('far');
    near.children[0].visible = true;
    const parent = new THREE.Group(); parent.add(near); parent.visible = false;
    expect(pickMeshObject(ctx, ctx.raycaster).id).toBe('far');
  });
  it('preserves mesh registration when drillhole selectables are rebuilt', () => {
    const ctx = context(), root = group(); registerMeshObject(ctx, 'mesh', root);
    ctx.drillMeshes = [{ userData: { isDrillholeTubes: true } }];
    syncSelectables(ctx);
    expect(ctx.selectables).toEqual([root]);
  });
  it('changes all child materials without recolouring shared source material or changing geometry', () => {
    const ctx = context(), material = new THREE.MeshStandardMaterial({ color: '#112233', opacity: 0.4, vertexColors: true });
    const root = group(0, [material, material]), other = group(0, material);
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    const geometry = root.children[0].geometry;
    const positions = Array.from(geometry.attributes.position.array);
    registerMeshObject(ctx, 'mesh', root); registerMeshObject(ctx, 'other', other);
    setMeshObjectColor(ctx, 'mesh', '#3366ff');
    expect(root.children[0].material[0].color.getHexString()).toBe('3366ff');
    expect(root.children[1].material.color.getHexString()).toBe('3366ff');
    expect(root.children[1].material.opacity).toBe(0.4);
    expect(root.children[1].material.vertexColors).toBe(false);
    expect(other.children[0].material.color.getHexString()).toBe('112233');
    expect(material.color.getHexString()).toBe('112233');
    expect(root.children[0].geometry).toBe(geometry);
    expect(Array.from(geometry.attributes.position.array)).toEqual(positions);
  });
  it('restores originals, clears selection and disposes cloned materials only', () => {
    const ctx = context(), root = group(), original = root.children[0].material;
    const sourceDispose = vi.spyOn(original, 'dispose');
    const geometryDispose = vi.spyOn(root.children[0].geometry, 'dispose');
    registerMeshObject(ctx, 'mesh', root);
    const cloneDispose = vi.spyOn(root.children[0].material, 'dispose');
    ctx._selectedObject = root; ctx._outlinePass.selectedObjects = [root];
    expect(unregisterMeshObject(ctx, 'mesh')).toBe(true);
    expect(ctx._selectedObject).toBe(null);
    expect(ctx._outlinePass.selectedObjects).toEqual([]);
    expect(root.children[0].material).toBe(original);
    expect(cloneDispose).toHaveBeenCalledOnce();
    expect(sourceDispose).not.toHaveBeenCalled(); expect(geometryDispose).not.toHaveBeenCalled();
    expect(pickScene(ctx)).toBe(null);
    expect(unregisterMeshObject(ctx, 'mesh')).toBe(false);
  });
  it('rejects duplicate IDs, overlapping roots, empty groups and invalid colours', () => {
    const ctx = context(), root = group(); registerMeshObject(ctx, 'a', root);
    expect(() => registerMeshObject(ctx, 'a', group())).toThrow(/already registered/);
    expect(() => registerMeshObject(ctx, 'b', root.children[0])).toThrow(/overlap/);
    expect(() => registerMeshObject(ctx, 'empty', new THREE.Group())).toThrow(/no mesh/);
    expect(() => setMeshObjectColor(ctx, 'a', 'not-a-colour')).toThrow(/#rrggbb/);
    expect(() => setMeshObjectColor(ctx, 'missing', '#000000')).toThrow(/Unknown/);
    clearMeshObjects(ctx); expect(ctx.selectables).toEqual([]);
  });
  it('dispatches canvas clicks to the mesh callback, and clears on empty space', () => {
    const ctx = context(), root = group(); registerMeshObject(ctx, 'a', root);
    ctx.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    ctx.camera.position.set(0, 0, 20); ctx.camera.lookAt(0, 0, 0); ctx.camera.updateMatrixWorld(true);
    ctx.pointer = new THREE.Vector2();
    ctx.renderer = { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), addEventListener: vi.fn() } };
    ctx.meshClickHandler = vi.fn(); ctx.emptyClickHandler = vi.fn();
    attachCanvasClickHandler(ctx);
    ctx.handleCanvasClick({ button: 0, clientX: 50, clientY: 50 });
    expect(ctx.meshClickHandler).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', object: root }));
    expect(ctx._outlinePass.selectedObjects).toEqual([root]);
    ctx.handleCanvasClick({ button: 0, clientX: 0, clientY: 0 });
    expect(ctx.emptyClickHandler).toHaveBeenCalledOnce();
    expect(ctx._outlinePass.selectedObjects).toEqual([]);
  });
});
