/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Rebuild `sceneCtx.selectables` from all renderable mesh lists.
 * Called after any data-type module adds or removes objects from the scene.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 */
export function syncSelectables(sceneCtx) {
  sceneCtx.selectables = [
    ...sceneCtx.blocks,
    ...sceneCtx.drillMeshes,
    ...sceneCtx.structuralMeshes,
  ];
}
