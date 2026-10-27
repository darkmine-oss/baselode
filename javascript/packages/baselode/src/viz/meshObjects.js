/* Copyright (C) 2026 Darkmine Pty Ltd — SPDX-License-Identifier: GPL-3.0-or-later */
import * as THREE from 'three';
import { applySelection } from './selectionGlow.js';
import { syncSelectables } from './sceneSelectables.js';

function contains(root, child) {
  for (let node = child; node; node = node.parent) if (node === root) return true;
  return false;
}

/**
 * Register a caller-owned mesh/group for picking and display controls.
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
  scene.meshObjects.set(id, { id, name, object, assignments, clones,
    originalVisible: object.visible, wireframe: false, edges: [] });
  syncSelectables(scene);
  return object;
}

/** Restore borrowed materials and release only the registration's clones. */
export function unregisterMeshObject(scene, id) {
  const entry = scene.meshObjects?.get(id);
  if (!entry) return false;
  if (contains(entry.object, scene._selectedObject)) applySelection(scene, null);
  disposeWireframes(entry);
  entry.object.visible = entry.originalVisible;
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
  updateWireframes(entry);
  return `#${value.getHexString()}`;
}

function requireMeshObject(scene, id) {
  const entry = scene.meshObjects?.get(id);
  if (!entry) throw new Error(`Unknown mesh object: ${id}`);
  return entry;
}

function materialsOf(mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function visibleMaterial(material) {
  return material && material.visible !== false && material.opacity > 0;
}

function visibleInHierarchy(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

/** Hide without unloading. Hidden groups remain editable by ID. */
export function setMeshObjectVisibility(scene, id, visible) {
  const entry = requireMeshObject(scene, id);
  entry.object.visible = Boolean(visible);
  if (!entry.object.visible && contains(entry.object, scene._selectedObject)) applySelection(scene, null);
}

/** Set uniform opacity in [0, 1]. Fully transparent surfaces are not pickable. */
export function setMeshObjectOpacity(scene, id, opacity) {
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error('Mesh opacity must be between 0 and 1');
  const entry = requireMeshObject(scene, id);
  for (const material of entry.clones.values()) {
    material.opacity = opacity;
    material.transparent = opacity < 1;
    material.depthWrite = opacity === 1;
    material.needsUpdate = true;
  }
  updateWireframes(entry);
  if (opacity === 0 && contains(entry.object, scene._selectedObject)) applySelection(scene, null);
}

/** Lazily add triangle edges over the filled surface, with no geometry limit. */
export function setMeshObjectWireframe(scene, id, enabled) {
  const entry = requireMeshObject(scene, id);
  const visible = Boolean(enabled);
  if (visible && !entry.edges.length) {
    try {
      for (const { child } of entry.assignments) {
        if (!child.geometry?.getAttribute('position')) continue;
        const geometry = new THREE.WireframeGeometry(child.geometry);
        const material = new THREE.LineBasicMaterial({ depthWrite: false, toneMapped: false });
        const lines = new THREE.LineSegments(geometry, material);
        lines.name = 'baselode-mesh-wireframe';
        // Picking uses surface triangles, not the overlay's line threshold.
        lines.raycast = () => {};
        lines.renderOrder = child.renderOrder + 1;
        child.add(lines);
        entry.edges.push({ child, lines });
      }
    } catch (error) { disposeWireframes(entry); throw error; }
    entry.surfaceOffsets = new Map([...entry.clones.values()].map(material => [material, {
      polygonOffset: material.polygonOffset, polygonOffsetFactor: material.polygonOffsetFactor,
      polygonOffsetUnits: material.polygonOffsetUnits,
    }]));
  }
  entry.wireframe = visible;
  for (const [material, original] of entry.surfaceOffsets || []) {
    Object.assign(material, visible ? { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } : original);
  }
  updateWireframes(entry);
}

function updateWireframes(entry) {
  for (const { child, lines } of entry.edges) {
    const materials = materialsOf(child).filter(visibleMaterial);
    lines.visible = entry.wireframe && materials.length > 0;
    lines.material.color.copy(materials.find(material => material.color)?.color || new THREE.Color('#333333')).multiplyScalar(0.45);
    lines.material.opacity = materials.reduce((opacity, material) => Math.max(opacity, material.opacity), 0);
    const transparent = lines.material.opacity < 1;
    if (lines.material.transparent !== transparent) {
      lines.material.transparent = transparent;
      lines.material.needsUpdate = true;
    }
  }
}

function disposeWireframes(entry) {
  for (const { lines } of entry.edges) {
    lines.removeFromParent(); lines.geometry.dispose(); lines.material.dispose();
  }
  entry.edges = [];
}

export function getMeshObjectStyle(scene, id) {
  const entry = requireMeshObject(scene, id);
  const opacities = new Set([...entry.clones.values()].map(material => material.opacity));
  return { visible: entry.object.visible, opacity: opacities.size === 1 ? [...opacities][0] : null, wireframe: entry.wireframe };
}

/** World bounds of registered surfaces; hidden/transparent geometry is excluded by default. */
export function getMeshObjectsBounds(scene, { visibleOnly = true } = {}) {
  const bounds = new THREE.Box3();
  for (const entry of scene.meshObjects?.values() || []) {
    entry.object.updateWorldMatrix(true, true);
    for (const { child } of entry.assignments) {
      if (visibleOnly && (!visibleInHierarchy(child) || !materialsOf(child).some(visibleMaterial))) continue;
      const geometry = child.geometry;
      if (!geometry?.getAttribute('position')) continue;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const box = geometry.boundingBox.clone().applyMatrix4(child.matrixWorld);
      if (![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)) continue;
      bounds.union(box);
    }
  }
  return bounds.isEmpty() ? null : { minX: bounds.min.x, maxX: bounds.max.x, minY: bounds.min.y,
    maxY: bounds.max.y, minZ: bounds.min.z, maxZ: bounds.max.z };
}

/** Nearest visible triangle, including visibility inherited from ancestors. */
export function pickMeshObject(scene, raycaster) {
  if (!scene.meshObjects?.size) return null;
  const roots = new Map([...scene.meshObjects.values()].map(entry => [entry.object, entry]));
  for (const hit of raycaster.intersectObjects([...roots.keys()], true)) {
    if (!hit.object.isMesh || !visibleInHierarchy(hit.object)) continue;
    const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face?.materialIndex ?? 0] : hit.object.material;
    if (!visibleMaterial(material)) continue;
    let entry = null;
    for (let node = hit.object; node; node = node.parent) if (roots.has(node)) entry = roots.get(node);
    if (entry) return { type: 'mesh', id: entry.id, name: entry.name, object: entry.object,
      mesh: hit.object, point: hit.point, distance: hit.distance };
  }
  return null;
}
