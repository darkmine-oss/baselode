/* Copyright (C) 2026 Darkmine Pty Ltd — SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { registerMeshObject, unregisterMeshObject, clearMeshObjects, setMeshObjectColor, pickMeshObject, setMeshObjectVisibility, setMeshObjectOpacity,
  setMeshObjectWireframe, getMeshObjectStyle, getMeshObjectsBounds } from '../src/viz/meshObjects.js';
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

describe('mesh display controls', () => {
  it('hides and shows without unloading, clears the outline, and restores original visibility on removal', () => {
    const ctx = context(), root = group(); registerMeshObject(ctx, 'a', root);
    ctx._selectedObject = root; ctx._outlinePass.selectedObjects = [root];
    setMeshObjectVisibility(ctx, 'a', false);
    expect(pickScene(ctx)).toBe(null); expect(ctx.meshObjects.size).toBe(1);
    expect(ctx._outlinePass.selectedObjects).toEqual([]);
    expect(getMeshObjectsBounds(ctx)).toBe(null);
    setMeshObjectVisibility(ctx, 'a', true);
    expect(pickScene(ctx).id).toBe('a');
    setMeshObjectVisibility(ctx, 'a', false);
    unregisterMeshObject(ctx, 'a'); expect(root.visible).toBe(true);
  });
  it('updates opacity and depth writing without changing source materials', () => {
    const ctx = context(), root = group(), original = root.children[0].material;
    registerMeshObject(ctx, 'a', root);
    setMeshObjectOpacity(ctx, 'a', 0.25);
    expect(root.children[0].material).toMatchObject({ opacity: 0.25, transparent: true, depthWrite: false });
    expect(original.opacity).toBe(0.6);
    expect(getMeshObjectStyle(ctx, 'a')).toEqual({ visible: true, opacity: 0.25, wireframe: false });
    setMeshObjectOpacity(ctx, 'a', 1);
    expect(root.children[0].material).toMatchObject({ opacity: 1, transparent: false, depthWrite: true });
  });
  it('does not pick or bound fully transparent geometry', () => {
    const ctx = context(), root = group(); registerMeshObject(ctx, 'a', root);
    ctx._selectedObject = root; ctx._outlinePass.selectedObjects = [root];
    setMeshObjectOpacity(ctx, 'a', 0);
    expect(pickScene(ctx)).toBe(null); expect(getMeshObjectsBounds(ctx)).toBe(null);
    expect(getMeshObjectsBounds(ctx, { visibleOnly: false })).not.toBe(null);
    expect(ctx._outlinePass.selectedObjects).toEqual([]);
    setMeshObjectOpacity(ctx, 'a', 1); expect(pickScene(ctx).id).toBe('a');
  });
  it('rejects opacity outside [0, 1] without changing display state', () => {
    const ctx = context(), root = group(); registerMeshObject(ctx, 'a', root);
    for (const value of [-0.1, 1.1, NaN, Infinity, '0.5']) expect(() => setMeshObjectOpacity(ctx, 'a', value)).toThrow(/between 0 and 1/);
    expect(getMeshObjectStyle(ctx, 'a').opacity).toBe(0.6);
  });
  it.each([true, false])('includes the internal triangle edge for indexed=%s and retains the filled surface', indexed => {
    const ctx = context(), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 1,1,0, 0,1,0], 3));
    geometry.setIndex([0,1,2, 0,2,3]);
    const source = indexed ? geometry : geometry.toNonIndexed();
    const mesh = new THREE.Mesh(source, new THREE.MeshStandardMaterial());
    const before = Array.from(source.attributes.position.array);
    registerMeshObject(ctx, 'a', mesh);
    expect(mesh.children).toHaveLength(0);
    setMeshObjectWireframe(ctx, 'a', true);
    const lines = mesh.children[0];
    expect(lines.isLineSegments).toBe(true);
    expect(lines.geometry.attributes.position.count).toBe(10);
    expect(mesh.material.wireframe).toBe(false);
    expect(mesh.material.polygonOffset).toBe(true);
    expect(Array.from(source.attributes.position.array)).toEqual(before);
    setMeshObjectWireframe(ctx, 'a', false);
    expect(lines.visible).toBe(false); expect(mesh.material.polygonOffset).toBe(false);
    setMeshObjectWireframe(ctx, 'a', true);
    expect(mesh.children).toEqual([lines]); expect(lines.visible).toBe(true);
  });
  it('updates overlay colour and opacity and disposes only owned edge resources', () => {
    const ctx = context(), root = group(), mesh = root.children[0]; registerMeshObject(ctx, 'a', root);
    const sourceDispose = vi.spyOn(mesh.geometry, 'dispose');
    setMeshObjectWireframe(ctx, 'a', true);
    const lines = mesh.children[0];
    const edgeDispose = vi.spyOn(lines.geometry, 'dispose'), materialDispose = vi.spyOn(lines.material, 'dispose');
    setMeshObjectColor(ctx, 'a', '#66aaff');
    expect(lines.material.color.equals(new THREE.Color('#66aaff').multiplyScalar(0.45))).toBe(true);
    setMeshObjectOpacity(ctx, 'a', 0); expect(lines.visible).toBe(false);
    setMeshObjectOpacity(ctx, 'a', 0.3); expect(lines.visible).toBe(true); expect(lines.material.opacity).toBe(0.3);
    unregisterMeshObject(ctx, 'a');
    expect(mesh.children).toHaveLength(0); expect(edgeDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce(); expect(sourceDispose).not.toHaveBeenCalled();
  });
  it('uses world transforms and visible submeshes for bounds without including the overlay twice', () => {
    const ctx = context(), root = group(5); root.position.x = 10; root.position.y = 20;
    root.children[0].scale.set(2, 3, 4);
    registerMeshObject(ctx, 'a', root);
    const expected = { minX: 8, maxX: 12, minY: 17, maxY: 23, minZ: 1, maxZ: 9 };
    expect(getMeshObjectsBounds(ctx)).toEqual(expected);
    setMeshObjectWireframe(ctx, 'a', true); expect(getMeshObjectsBounds(ctx)).toEqual(expected);
    root.children[0].visible = false; expect(getMeshObjectsBounds(ctx)).toBe(null);
    expect(getMeshObjectsBounds(ctx, { visibleOnly: false })).toEqual(expected);
  });
});
