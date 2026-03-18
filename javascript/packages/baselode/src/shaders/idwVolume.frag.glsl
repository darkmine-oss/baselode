/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * IDW volume renderer — fragment shader.
 *
 * Performs front-to-back ray marching through a unit-cube bounding box.
 * The scalar field is sampled from a Data3DTexture (sampler3D).  Each
 * sample is mapped to a colour and opacity via the display range uniforms.
 *
 * Voxel/block-mode appearance is achieved by snapping sample coordinates
 * to voxel centres (uBlockMode == 1) rather than using trilinear filtering.
 */

precision highp float;
precision highp sampler3D;

// ---------------------------------------------------------------------------
// Varyings
// ---------------------------------------------------------------------------

varying vec3 vLocalPos;

// ---------------------------------------------------------------------------
// Uniforms
// ---------------------------------------------------------------------------

// The 3D scalar texture (Red channel, float).
uniform sampler3D uVolumeTex;

// Number of voxels in each axis for block-mode snapping.
uniform vec3 uVolumeDims;

// World-space bounding box (used to convert cameraPosition to local space).
uniform vec3 uWorldMin;
uniform vec3 uWorldSize;

// Scalar range for display normalisation.
uniform float uDisplayMin;
uniform float uDisplayMax;

// Volume-level opacity multiplier.
uniform float uOpacity;

// Optional threshold: fragments with normalised value below this are discarded.
// Set to -1.0 to disable thresholding.
uniform float uThreshold;

// 1 = crisp voxel-block appearance (snap to voxel centres).
// 0 = smooth compositing.
uniform int uBlockMode;

// Colour transfer function: two-stop linear gradient.
// Default maps low values to blue and high values to red.
uniform vec3 uColorLow;
uniform vec3 uColorHigh;

// Ray-march step count; more steps = better quality but slower.
uniform int uSteps;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Intersect a ray with the unit AABB [0,1]^3.
// Returns tMin and tMax along the ray; a hit occurs when tMin < tMax.
vec2 intersectAABB(vec3 rayOrigin, vec3 rayDir) {
  vec3 invDir = 1.0 / rayDir;
  vec3 t0 = (vec3(0.0) - rayOrigin) * invDir;
  vec3 t1 = (vec3(1.0) - rayOrigin) * invDir;
  vec3 tMin3 = min(t0, t1);
  vec3 tMax3 = max(t0, t1);
  float tMin = max(max(tMin3.x, tMin3.y), tMin3.z);
  float tMax = min(min(tMax3.x, tMax3.y), tMax3.z);
  return vec2(tMin, tMax);
}

// Map a normalised scalar value [0,1] to an RGBA colour + alpha.
vec4 transferFunction(float t) {
  vec3 col   = mix(uColorLow, uColorHigh, clamp(t, 0.0, 1.0));
  float alpha = clamp(t, 0.0, 1.0) * uOpacity;
  return vec4(col, alpha);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

void main() {
  // Three.js provides cameraPosition as a built-in world-space uniform.
  // Convert to local [0,1]^3 box space using the bounds uniforms.
  vec3 camLocal = (cameraPosition - uWorldMin) / uWorldSize;
  vec3 fragPos  = vLocalPos;
  vec3 rayDir   = normalize(fragPos - camLocal);

  vec2 tRange = intersectAABB(camLocal, rayDir);
  if (tRange.x >= tRange.y) {
    discard;
  }

  float tStart   = max(tRange.x, 0.0);
  float tEnd     = tRange.y;
  float stepSize = (tEnd - tStart) / float(uSteps);

  // Front-to-back compositing
  vec4 accum = vec4(0.0);

  for (int i = 0; i < uSteps; i++) {
    if (accum.a >= 0.99) break;

    float t       = tStart + (float(i) + 0.5) * stepSize;
    vec3 pos      = camLocal + t * rayDir;

    if (any(lessThan(pos, vec3(0.0))) || any(greaterThan(pos, vec3(1.0)))) continue;

    // Block-mode: snap to voxel centres for crisp block-model appearance.
    vec3 uvw = pos;
    if (uBlockMode == 1) {
      uvw = (floor(pos * uVolumeDims) + 0.5) / uVolumeDims;
    }

    float raw = texture(uVolumeTex, uvw).r;

    // No-data sentinel: values below -1e29 are skipped.
    if (raw < -1.0e29) continue;

    float span       = uDisplayMax - uDisplayMin;
    float normalised = span > 0.0 ? (raw - uDisplayMin) / span : 0.5;

    if (uThreshold >= 0.0 && normalised < uThreshold) continue;

    vec4 col = transferFunction(normalised);
    // Front-to-back alpha compositing
    col.a   *= (1.0 - accum.a);
    accum.rgb += col.a * col.rgb;
    accum.a   += col.a;
  }

  if (accum.a < 0.001) discard;

  gl_FragColor = accum;
}
