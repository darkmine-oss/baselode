/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { applySelection } from './selectionGlow.js';
import { getBlockHighlightMesh } from './blockModelScene.js';

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

    // Ignore clicks inside the gizmo area
    if (sceneCtx.gizmo?.domElement) {
      const gizmoRect = sceneCtx.gizmo.domElement.getBoundingClientRect();
      if (
        event.clientX >= gizmoRect.left &&
        event.clientX <= gizmoRect.right &&
        event.clientY >= gizmoRect.top &&
        event.clientY <= gizmoRect.bottom
      ) {
        return;
      }
    }

    const rect = renderer.domElement.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;

    sceneCtx.pointer.x = ((localX / rect.width) * 2) - 1;
    sceneCtx.pointer.y = -((localY / rect.height) * 2) + 1;

    sceneCtx.raycaster.setFromCamera(sceneCtx.pointer, sceneCtx.camera);

    // Selection glow: raycast against registered selectables
    updateSelectionFromPointer(sceneCtx);

    // Check block clicks first (blocks take priority over drillholes)
    if (sceneCtx.blocks.length > 0) {
      const blockIntersects = sceneCtx.raycaster.intersectObjects(sceneCtx.blocks, false);
      if (blockIntersects.length > 0) {
        const hit = blockIntersects[0];
        const blockObj = hit.object;
        if (blockObj?.userData?._isMergedBlocks && sceneCtx.blockClickHandler) {
          const quadIndex = Math.floor(hit.faceIndex / 2);
          const blockData = blockObj.userData._quadToBlock[quadIndex];
          if (blockData) sceneCtx.blockClickHandler(blockData);
        }
        return;
      }
    }

    // Fall through to drillhole / structural click detection
    const drillHits = sceneCtx.raycaster.intersectObjects(sceneCtx.drillMeshes, true);
    const structHits = sceneCtx.raycaster.intersectObjects(sceneCtx.structuralMeshes, true);

    const drillDist = drillHits[0]?.distance ?? Infinity;
    const structDist = structHits[0]?.distance ?? Infinity;

    if (structDist < drillDist && structHits.length > 0) {
      const mesh = structHits[0].object;
      if (sceneCtx.drillholeClickHandler) {
        sceneCtx.drillholeClickHandler({ type: 'structure', ...mesh.userData });
      }
      return;
    }

    if (drillHits.length === 0) return;
    let obj = drillHits[0].object;
    while (obj && obj.parent && !obj.userData?.holeId) {
      obj = obj.parent;
    }
    const holeId = obj?.userData?.holeId;
    const project = obj?.userData?.project;
    if (holeId && sceneCtx.drillholeClickHandler) {
      sceneCtx.drillholeClickHandler({ holeId, project });
    }
  };

  renderer.domElement.addEventListener('click', sceneCtx.handleCanvasClick);
}
