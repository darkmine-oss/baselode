/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { applySelection } from './selectionGlow.js';
import { getBlockHighlightMesh } from './blockModelScene.js';
import { pickDrillhole, setSelectedDrillhole } from './drillholeScene.js';

/**
 * Raycast against `selectables` using the current pointer position and apply
 * the glow to the nearest hit object (or clear if nothing is hit).
 * For merged block meshes, redirects the glow to an invisible ghost box
 * sized and positioned to match only the hovered block.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 */
export function updateSelectionFromPointer(sceneCtx) {
  if (!sceneCtx._outlinePass || sceneCtx.selectables.length === 0) {
    if (sceneCtx._outlinePass) applySelection(sceneCtx, null);
    return;
  }
  const hits = sceneCtx.raycaster.intersectObjects(sceneCtx.selectables, true);
  if (hits.length === 0) {
    applySelection(sceneCtx, null);
    return;
  }
  const hit = hits[0];
  const obj = hit.object;
  if (obj?.userData?._isMergedBlocks) {
    const quadIndex = Math.floor(hit.faceIndex / 2);
    const blockRow = obj.userData._quadToBlock?.[quadIndex];
    if (blockRow) {
      applySelection(sceneCtx, getBlockHighlightMesh(sceneCtx, blockRow, obj.userData._offset));
      return;
    }
  }
  applySelection(sceneCtx, obj);
}

/**
 * Convert a pointer event to normalised device coordinates on the canvas and
 * prime the scene raycaster.  Returns false when the event is inside the
 * gizmo widget (which handles its own input).
 * @param {object} sceneCtx
 * @param {{clientX: number, clientY: number}} event
 * @returns {boolean}
 */
export function primeRaycasterFromEvent(sceneCtx, event) {
  const renderer = sceneCtx.renderer;
  if (!renderer || !sceneCtx.camera) return false;
  if (sceneCtx.gizmo?.domElement) {
    const gizmoRect = sceneCtx.gizmo.domElement.getBoundingClientRect();
    if (
      event.clientX >= gizmoRect.left && event.clientX <= gizmoRect.right &&
      event.clientY >= gizmoRect.top && event.clientY <= gizmoRect.bottom
    ) {
      return false;
    }
  }
  const rect = renderer.domElement.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return false;
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  sceneCtx.pointer.x = ((localX / rect.width) * 2) - 1;
  sceneCtx.pointer.y = -((localY / rect.height) * 2) + 1;
  sceneCtx.raycaster.setFromCamera(sceneCtx.pointer, sceneCtx.camera);
  return true;
}

/**
 * Nearest hit across every pickable layer: blocks, structural discs,
 * drillholes, terrain and raster overlays.
 * @param {object} sceneCtx
 * @returns {{type: string, point: THREE.Vector3, distance: number, [key: string]: any}|null}
 */
export function pickScene(sceneCtx) {
  const candidates = [];
  const raycaster = sceneCtx.raycaster;

  if (sceneCtx.blocks.length > 0) {
    const hit = raycaster.intersectObjects(sceneCtx.blocks, false)[0];
    if (hit) {
      const quadIndex = Math.floor(hit.faceIndex / 2);
      const blockData = hit.object?.userData?._isMergedBlocks ? hit.object.userData._quadToBlock?.[quadIndex] : null;
      candidates.push({ type: 'block', point: hit.point, distance: hit.distance, object: hit.object, block: blockData, faceIndex: hit.faceIndex });
    }
  }
  if (sceneCtx.structuralMeshes.length > 0) {
    const hit = raycaster.intersectObjects(sceneCtx.structuralMeshes, true)[0];
    if (hit) candidates.push({ type: 'structure', point: hit.point, distance: hit.distance, object: hit.object, ...hit.object.userData });
  }
  const drill = pickDrillhole(sceneCtx, raycaster);
  if (drill) candidates.push({ type: 'drillhole', ...drill });

  const terrainMesh = sceneCtx.terrain?.mesh;
  if (terrainMesh?.visible) {
    const hit = raycaster.intersectObject(terrainMesh, false)[0];
    if (hit) candidates.push({ type: 'terrain', point: hit.point, distance: hit.distance, object: hit.object });
  }
  if (sceneCtx.rasterOverlays?.size) {
    const meshes = [...sceneCtx.rasterOverlays.values()].map((l) => l?.mesh).filter((m) => m?.visible);
    if (meshes.length) {
      const hit = raycaster.intersectObjects(meshes, false)[0];
      if (hit) candidates.push({ type: 'raster', point: hit.point, distance: hit.distance, object: hit.object });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0];
}

/**
 * Register a click listener on the renderer canvas. Handles block →
 * structural → drillhole priority. Stores the listener reference in
 * `sceneCtx.handleCanvasClick` for later removal in `dispose()`.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 */
export function attachCanvasClickHandler(sceneCtx) {
  const renderer = sceneCtx.renderer;
  if (!renderer) return;

  sceneCtx.handleCanvasClick = (event) => {
    if (event.button !== 0) return; // left click only
    if (sceneCtx._suppressClick) { sceneCtx._suppressClick = false; return; }
    if (!primeRaycasterFromEvent(sceneCtx, event)) return;

    // Outline glow for blocks / structures
    updateSelectionFromPointer(sceneCtx);

    const hit = pickScene(sceneCtx);
    if (!hit) {
      setSelectedDrillhole(sceneCtx, null);
      sceneCtx.emptyClickHandler?.();
      return;
    }

    if (hit.type === 'block') {
      setSelectedDrillhole(sceneCtx, null);
      if (hit.block && sceneCtx.blockClickHandler) sceneCtx.blockClickHandler(hit.block);
      return;
    }

    if (hit.type === 'structure') {
      setSelectedDrillhole(sceneCtx, null);
      if (sceneCtx.drillholeClickHandler) {
        const { object, point, distance, type, ...userData } = hit;
        sceneCtx.drillholeClickHandler({ type: 'structure', ...userData });
      }
      return;
    }

    if (hit.type === 'drillhole') {
      setSelectedDrillhole(sceneCtx, hit.holeId);
      if (sceneCtx.drillholeClickHandler) {
        sceneCtx.drillholeClickHandler({
          holeId: hit.holeId,
          project: hit.project,
          md: hit.md,
          point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
        });
      }
    }
  };

  renderer.domElement.addEventListener('click', sceneCtx.handleCanvasClick);
}
