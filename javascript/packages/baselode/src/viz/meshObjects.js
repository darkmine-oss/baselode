/* Copyright (C) 2026 Darkmine Pty Ltd — SPDX-License-Identifier: GPL-3.0-or-later */
import * as THREE from 'three';
import { applySelection } from './selectionGlow.js';
import { syncSelectables } from './sceneSelectables.js';

function contains(root, child) {
  for (let node = child; node; node = node.parent) if (node === root) return true;
  return false;
}

/**
 * Register a caller-owned mesh/group for picking and colour changes.
 * Geometry and transforms stay untouched. Materials are cloned so changing
 * one registration cannot recolour another object sharing its source material.
 * Unregister before disposing the caller's geometry and original materials.
 */
export function registerMeshObject(scene, id, object, { name = object?.name || String(id) } = {}) {
  if (id == null || String(id).trim() === '') throw new Error('Mesh object ID is required');
  if (!object?.isObject3D) throw new Error('A Three.js object is required');
  scene.meshObjects ||= new Map();
  if (scene.meshObjects.has(id)) throw new Error(`Mesh object already registered: ${id}`);
  for (const entry of scene.meshObjects.values()) {
    if (contains(entry.object, object) || contains(object, entry.object)) throw new Error('Mesh object registrations must not overlap');
  }
  const assignments = [], clones = new Map();
  object.traverse(child => {
    if (!child.isMesh || !child.material) return;
    const original = child.material;
    const clone = material => {
      if (!clones.has(material)) clones.set(material, material.clone());
      return clones.get(material);
    };
    const material = Array.isArray(original) ? original.map(clone) : clone(original);
    assignments.push({ child, original, material });
    child.material = material;
  });
  if (!assignments.length) throw new Error('Object contains no mesh materials');
  scene.meshObjects.set(id, { id, name, object, assignments, clones });
  syncSelectables(scene);
  return object;
}

/** Restore borrowed materials and release only the registration's clones. */
export function unregisterMeshObject(scene, id) {
  const entry = scene.meshObjects?.get(id);
  if (!entry) return false;
  if (contains(entry.object, scene._selectedObject)) applySelection(scene, null);
  for (const { child, original, material } of entry.assignments) {
    if (child.material === material) child.material = original;
  }
  for (const material of entry.clones.values()) material.dispose();
  scene.meshObjects.delete(id);
  syncSelectables(scene);
  return true;
}

export function clearMeshObjects(scene) {
  for (const id of scene.meshObjects?.keys() || []) unregisterMeshObject(scene, id);
}

/** Set a uniform #rrggbb display colour, retaining opacity and geometry. */
export function setMeshObjectColor(scene, id, color) {
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Mesh colour must be #rrggbb');
  const entry = scene.meshObjects?.get(id);
  if (!entry) throw new Error(`Unknown mesh object: ${id}`);
  const value = new THREE.Color(color);
  for (const material of entry.clones.values()) {
    if (!material.color) continue;
    material.color.copy(value);
    material.vertexColors = false;
    material.needsUpdate = true;
  }
  return `#${value.getHexString()}`;
}

/** Nearest visible triangle, including visibility inherited from ancestors. */
export function pickMeshObject(scene, raycaster) {
  if (!scene.meshObjects?.size) return null;
  const entries = [...scene.meshObjects.values()];
  const roots = new Map(entries.map(entry => [entry.object, entry]));
  for (const hit of raycaster.intersectObjects([...roots.keys()], true)) {
    let entry = null, visible = true;
    for (let node = hit.object; node; node = node.parent) {
      if (!node.visible) visible = false;
      if (roots.has(node)) entry = roots.get(node);
    }
    if (entry && visible && hit.object.isMesh) {
      return { type: 'mesh', id: entry.id, name: entry.name, object: entry.object,
        mesh: hit.object, point: hit.point, distance: hit.distance };
    }
  }
  return null;
}
