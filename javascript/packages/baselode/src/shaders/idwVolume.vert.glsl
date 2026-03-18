/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * IDW volume renderer — vertex shader.
 *
 * Renders the bounding box and passes the fragment local-space position
 * (in [0,1]^3) to the fragment shader for ray-marching.
 */

varying vec3 vLocalPos;

void main() {
  // position attribute is in local [0,1] box space (see geometry setup)
  vLocalPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
