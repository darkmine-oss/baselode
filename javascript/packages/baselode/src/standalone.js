/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Standalone bundle entry for baselode-module.js.
// three.js and three-viewport-gizmo are bundled in; React/Plotly/PapaParse are excluded.
// Used by the Python/Dash demo viewer (demo-viewer-dash/assets/baselode-module.js).
export { default as Baselode3DScene } from './viz/baselode3dScene.js';
