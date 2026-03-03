/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';

/** Glow colour for the selection outline (#ffffbb) */
const GLOW_COLOR = '#ffffbb';

/** OutlinePass tuning: produces a soft ~3 px diffuse halo */
const EDGE_STRENGTH = 2.0;
const EDGE_THICKNESS = 1.5;
const EDGE_GLOW = 1.0;

/**
 * Initialise an EffectComposer with a RenderPass and OutlinePass for
 * click-select glow.  Attaches `_composer` and `_outlinePass` to sceneCtx.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 */
export function initSelectionGlow(sceneCtx) {
  const { renderer, scene, camera, container } = sceneCtx;
  if (!renderer || !scene || !camera) return;

  const width = container?.clientWidth || renderer.domElement.clientWidth || 1;
  const height = container?.clientHeight || renderer.domElement.clientHeight || 1;

  const composer = new EffectComposer(renderer);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const resolution = new THREE.Vector2(width, height);
  const outlinePass = new OutlinePass(resolution, scene, camera);
  outlinePass.visibleEdgeColor.set(GLOW_COLOR);
  outlinePass.hiddenEdgeColor.set(GLOW_COLOR);
  outlinePass.edgeStrength = EDGE_STRENGTH;
  outlinePass.edgeThickness = EDGE_THICKNESS;
  outlinePass.edgeGlow = EDGE_GLOW;
  outlinePass.pulsePeriod = 0;
  outlinePass.selectedObjects = [];
  composer.addPass(outlinePass);

  composer.setSize(width, height);

  sceneCtx._composer = composer;
  sceneCtx._outlinePass = outlinePass;
}

/**
 * Resize the effect composer and outline pass to match the new viewport
 * dimensions.  Call this whenever the renderer is resized.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {number} width - New viewport pixel width
 * @param {number} height - New viewport pixel height
 */
export function resizeGlow(sceneCtx, width, height) {
  if (!sceneCtx._composer || !sceneCtx._outlinePass) return;
  sceneCtx._composer.setSize(width, height);
  sceneCtx._outlinePass.resolution.set(width, height);
}

/**
 * Apply or clear the glow selection highlight.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {THREE.Object3D|null} object - Object to highlight, or null to clear
 */
export function applySelection(sceneCtx, object) {
  if (!sceneCtx._outlinePass) return;
  sceneCtx._outlinePass.selectedObjects = object ? [object] : [];
  sceneCtx._selectedObject = object || null;
}

/**
 * Dispose the effect composer and free all GPU resources associated with the
 * selection glow.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 */
export function disposeSelectionGlow(sceneCtx) {
  if (sceneCtx._composer) {
    sceneCtx._composer.dispose();
    sceneCtx._composer = null;
  }
  sceneCtx._outlinePass = null;
  sceneCtx._selectedObject = null;
  sceneCtx.selectables = [];
}
