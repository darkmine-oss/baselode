/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { NO_DATA_COLOR } from './drillholeColorTexture.js';

/**
 * Uniforms shared between the tube material and the scene.  Create once per
 * drillhole layer and mutate `.value` fields at runtime.
 */
export function createDrillholeUniforms() {
  return {
    uIntervalTex: { value: null },
    uIntervalTexPrev: { value: null },
    uRampTex: { value: null },
    uRampTexPrev: { value: null },
    uHoleTex: { value: null },
    uHoleCount: { value: 1 },
    uMode: { value: 0 },          // 0 = per-hole base colour, 1 = interval lookup
    uModePrev: { value: 0 },
    uMix: { value: 1 },           // crossfade 0 → 1 from previous to current layer
    uRadius: { value: 1 },
    uScreenRadius: { value: 0 },  // pixels; 0 disables constant-pixel mode
    uDepthScale: { value: 0 },
    uOrtho: { value: 0 },
    uSelected: { value: -1 },
    uNoDataColor: { value: new THREE.Color(NO_DATA_COLOR) },
    uGhostColor: { value: new THREE.Color(0xffffff) },
    uGhostMix: { value: 0.12 },
    uSelectedBoost: { value: 1.35 },
  };
}

/**
 * Create the merged-tube material.  A standard PBR material with a small
 * shader injection: the vertex stage rebuilds the tube surface from the
 * centreline + radial attributes (so radius is a uniform), and the fragment
 * stage looks the colour up from the interval texture by measured depth.
 *
 * @param {object} uniforms - from createDrillholeUniforms()
 * @param {object} [opts]
 * @param {number} [opts.roughness=0.42]
 * @param {number} [opts.metalness=0.08]
 * @param {number} [opts.envMapIntensity=0.7]
 * @returns {THREE.MeshStandardMaterial}
 */
export function createDrillholeTubeMaterial(uniforms, opts = {}) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: opts.roughness ?? 0.42,
    metalness: opts.metalness ?? 0.08,
    side: THREE.FrontSide,
  });
  material.envMapIntensity = opts.envMapIntensity ?? 0.7;
  material.userData.uniforms = uniforms;
  material.customProgramCacheKey = () => 'baselode-drillhole-tube-v1';

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aCentre;
        attribute vec3 aRadial;
        attribute float aHole;
        attribute float aMdNorm;
        uniform float uRadius;
        uniform float uScreenRadius;
        uniform float uDepthScale;
        uniform float uOrtho;
        uniform float uSelected;
        uniform float uSelectedBoost;
        varying float vHole;
        varying float vMdNorm;`)
      .replace('#include <begin_vertex>', `
        vHole = aHole;
        vMdNorm = aMdNorm;
        float baselodeRadius = uRadius;
        if (uScreenRadius > 0.0) {
          vec4 centreView = modelViewMatrix * vec4(aCentre, 1.0);
          float depth = max(-centreView.z, 1e-4);
          baselodeRadius = uScreenRadius * (uOrtho > 0.5 ? uDepthScale : depth * uDepthScale);
        }
        if (uSelected >= 0.0 && abs(aHole - uSelected) < 0.5) baselodeRadius *= uSelectedBoost;
        vec3 transformed = aCentre + aRadial * baselodeRadius;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uIntervalTex;
        uniform sampler2D uIntervalTexPrev;
        uniform sampler2D uRampTex;
        uniform sampler2D uRampTexPrev;
        uniform sampler2D uHoleTex;
        uniform float uHoleCount;
        uniform float uMode;
        uniform float uModePrev;
        uniform float uMix;
        uniform float uSelected;
        uniform vec3 uNoDataColor;
        uniform vec3 uGhostColor;
        uniform float uGhostMix;
        varying float vHole;
        varying float vMdNorm;

        vec3 baselodeLayerColor(sampler2D intervals, sampler2D ramp, float mode, vec3 base, vec2 uv) {
          if (mode < 0.5) return base;
          float t = texture2D(intervals, uv).r;
          if (t < 0.0) return uNoDataColor;
          return texture2D(ramp, vec2(t, 0.5)).rgb;
        }`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        float baselodeRow = (vHole + 0.5) / uHoleCount;
        vec4 baselodeHole = texture2D(uHoleTex, vec2(baselodeRow, 0.5));
        vec2 baselodeUv = vec2(clamp(vMdNorm, 0.0, 1.0), baselodeRow);
        vec3 baselodeColor = baselodeLayerColor(uIntervalTex, uRampTex, uMode, baselodeHole.rgb, baselodeUv);
        if (uMix < 0.999) {
          vec3 prev = baselodeLayerColor(uIntervalTexPrev, uRampTexPrev, uModePrev, baselodeHole.rgb, baselodeUv);
          baselodeColor = mix(prev, baselodeColor, uMix);
        }
        if (baselodeHole.a < 0.5) baselodeColor = mix(uGhostColor, baselodeColor, uGhostMix);
        if (uSelected >= 0.0 && abs(vHole - uSelected) > 0.5) {
          float lum = dot(baselodeColor, vec3(0.299, 0.587, 0.114));
          baselodeColor = mix(baselodeColor, vec3(lum), 0.7) * 0.85;
        }
        vec4 diffuseColor = vec4( baselodeColor * diffuse, opacity );`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uSelected >= 0.0 && abs(vHole - uSelected) < 0.5) totalEmissiveRadiance += baselodeColor * 0.22;`);
  };

  return material;
}

/**
 * Update the uniforms that depend on the camera / viewport each frame so the
 * constant-pixel-width mode stays correct.
 * @param {object} uniforms
 * @param {THREE.Camera} camera
 * @param {number} viewportHeight - CSS pixels
 */
export function updateDrillholeCameraUniforms(uniforms, camera, viewportHeight) {
  if (!uniforms || !camera || !(viewportHeight > 0)) return;
  if (camera.isOrthographicCamera) {
    uniforms.uOrtho.value = 1;
    uniforms.uDepthScale.value = ((camera.top - camera.bottom) / (camera.zoom || 1)) / viewportHeight;
  } else {
    uniforms.uOrtho.value = 0;
    const fov = THREE.MathUtils.degToRad(camera.fov || 28);
    uniforms.uDepthScale.value = (2 * Math.tan(fov / 2)) / viewportHeight;
  }
}
