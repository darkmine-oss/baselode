/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';

// Inline GLSL strings so the module is self-contained without a build plugin.
// A bundler with a glsl/raw-text loader could alternatively import the .glsl
// files directly.

// GLSL 300 ES (WebGL2).  The fragment shader needs `gl_FragDepth` for
// the per-fragment depth write at the first ray hit, and that only
// exists as a built-in in GLSL 3.  Setting `glslVersion: THREE.GLSL3`
// on the material (see below) tells Three.js to compile these as
// 300-es shaders.
const VERT_SHADER = /* glsl */`
out vec3 vLocalPos;

void main() {
  vLocalPos   = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG_SHADER = /* glsl */`
precision highp float;
precision highp sampler3D;

// Combined world-to-clip matrix uploaded from the JS side via
// onBeforeRender each frame.  Three.js auto-fills projectionMatrix /
// viewMatrix for the *vertex* shader under GLSL 300 ES but not for
// the *fragment* shader -- declaring them here is enough to make the
// compiler happy but the values stay at zero, so the depth write
// computed to NaN and the volume vanished.  Using our own uniform
// avoids the issue entirely.
uniform mat4 uWorldToClip;

in vec3 vLocalPos;
out vec4 outColor;

uniform sampler3D uVolumeTex;
uniform vec3      uVolumeDims;
uniform vec3      uWorldMin;
uniform vec3      uWorldSize;
uniform float     uDisplayMin;
uniform float     uDisplayMax;
uniform float     uOpacity;
uniform float     uThreshold;
uniform int       uBlockMode;
uniform vec3      uColorLow;
uniform vec3      uColorHigh;
uniform int       uSteps;

// Per-axis clip bounds in local [0,1] box space.  Defaults are
// (0,0,0) → (1,1,1) — the full volume.  Driving these moves the
// visible region in from each face, which is how the caller exposes
// axis-aligned slices through the interpolated field.
uniform vec3 uClipMin;
uniform vec3 uClipMax;

vec2 intersectAABB(vec3 ro, vec3 rd) {
  vec3 inv  = 1.0 / rd;
  vec3 t0   = (uClipMin - ro) * inv;
  vec3 t1   = (uClipMax - ro) * inv;
  vec3 tMin = min(t0, t1);
  vec3 tMax = max(t0, t1);
  return vec2(
    max(max(tMin.x, tMin.y), tMin.z),
    min(min(tMax.x, tMax.y), tMax.z)
  );
}

vec4 xfer(float t) {
  // Colour follows the value (low → blue, high → red).
  // Alpha is the user's opacity slider unchanged — value-modulating
  // alpha makes "opacity 1" still look see-through, which isn't
  // what users expect from a slider that maxes at 1.  Above-
  // threshold voxels now reach full opacity together; the value
  // taper is communicated through colour and through the threshold
  // filter, not through translucency.
  vec3 col = mix(uColorLow, uColorHigh, clamp(t, 0.0, 1.0));
  return vec4(col, uOpacity);
}

void main() {
  vec3 camLocal = (cameraPosition - uWorldMin) / uWorldSize;
  vec3 rayDir   = normalize(vLocalPos - camLocal);

  vec2 tr = intersectAABB(camLocal, rayDir);
  if (tr.x >= tr.y) { discard; }

  float tStart = max(tr.x, 0.0);
  float tEnd   = tr.y;
  float step   = (tEnd - tStart) / float(uSteps);

  vec4 accum         = vec4(0.0);
  vec3 firstHitPos   = vec3(0.0);
  bool haveFirstHit  = false;

  for (int i = 0; i < uSteps; i++) {
    if (accum.a >= 0.99) break;

    float t   = tStart + (float(i) + 0.5) * step;
    vec3  pos = camLocal + t * rayDir;

    // Discard samples outside the clipped sub-box.  The AABB
    // intersection above already trimmed the ray to this range,
    // but step-sampling can land slightly outside due to floating-
    // point drift, so re-check per sample.
    if (any(lessThan(pos, uClipMin)) || any(greaterThan(pos, uClipMax))) continue;

    vec3 uvw = pos;
    if (uBlockMode == 1) {
      uvw = (floor(pos * uVolumeDims) + 0.5) / uVolumeDims;
    }

    float raw = texture(uVolumeTex, uvw).r;
    if (raw < -1.0e29) continue;

    float span  = uDisplayMax - uDisplayMin;
    float norm  = span > 0.0 ? (raw - uDisplayMin) / span : 0.5;

    if (uThreshold >= 0.0 && norm < uThreshold) continue;

    if (!haveFirstHit) {
      firstHitPos = pos;
      haveFirstHit = true;
    }

    vec4 col  = xfer(norm);
    col.a    *= (1.0 - accum.a);
    accum.rgb += col.a * col.rgb;
    accum.a   += col.a;
  }

  if (accum.a < 0.001) discard;

  // Write per-fragment depth at the first significant ray hit so
  // opaque geometry rendered alongside the volume (e.g. the sample
  // point spheres in the demo) composites correctly: spheres in
  // front of the visible voxel surface stay visible, spheres
  // behind it are occluded by the volume.  Without this, the
  // fragment depth would be the bounding-box back-wall depth,
  // which makes the GL depth test useless for the actual volume
  // content.
  vec3  worldHit  = firstHitPos * uWorldSize + uWorldMin;
  vec4  clipPos   = uWorldToClip * vec4(worldHit, 1.0);
  gl_FragDepth    = (clipPos.z / clipPos.w) * 0.5 + 0.5;

  outColor = accum;
}
`;

/** Sentinel value written to the texture for no-data voxels. */
const NODATA_SENTINEL = -1e30;

/**
 * Three.js volume renderer for an IDW scalar field.
 *
 * Uploads a {@link VoxelGrid} as a {@link THREE.Data3DTexture} and renders
 * the bounded volume using a shader-based ray-march approach.
 *
 * The rendered bounding box geometry occupies [0,1]^3 in local space and is
 * positioned/scaled in the scene to match the provided world bounds.
 *
 * @example
 * const renderer = new IDWVolumeRenderer();
 * renderer.setGrid(grid, { displayMin: 0, displayMax: 500, opacity: 0.4 });
 * scene.add(renderer.object3D);
 * // ...later...
 * renderer.dispose();
 */
export class IDWVolumeRenderer {
  constructor() {
    /** @type {THREE.Mesh|null} */
    this._mesh     = null;
    /** @type {THREE.Data3DTexture|null} */
    this._texture  = null;
    /** @type {THREE.ShaderMaterial|null} */
    this._material = null;

    /**
     * The Three.js Object3D to add to the scene.
     * @type {THREE.Mesh}
     */
    this.object3D = this._buildMesh();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Upload a voxel grid and configure display parameters.
   *
   * @param {import('../interpolation/buildVoxelGrid.js').VoxelGrid} grid
   * @param {object} [options]
   * @param {number}  [options.displayMin=0]
   * @param {number}  [options.displayMax=1]
   * @param {number}  [options.opacity=0.4]
   * @param {number|null} [options.threshold=null] - Normalised [0,1] cutoff, or null to disable
   * @param {boolean} [options.blockMode=true]    - Crisp block appearance vs smooth blend
   * @param {number}  [options.steps=64]           - Ray-march steps
   * @param {[number,number,number]} [options.colorLow=[0,0,1]]  - RGB low colour
   * @param {[number,number,number]} [options.colorHigh=[1,0,0]] - RGB high colour
   */
  setGrid(grid, options = {}) {
    if (!grid) return;

    this._uploadTexture(grid);
    this._positionMesh(grid.bounds);
    this._updateUniforms(grid, options);
  }

  /**
   * Update display parameters without re-uploading the scalar field.
   *
   * @param {object} options - Same keys as {@link setGrid} options
   */
  setDisplayOptions(options = {}) {
    if (!this._material) return;
    const u = this._material.uniforms;
    const {
      displayMin = u.uDisplayMin.value,
      displayMax = u.uDisplayMax.value,
      opacity    = u.uOpacity.value,
      threshold,
      blockMode,
      steps,
      colorLow,
      colorHigh,
    } = options;

    u.uDisplayMin.value = displayMin;
    u.uDisplayMax.value = displayMax;
    u.uOpacity.value    = Math.max(0, Math.min(1, Number(opacity)));

    if (threshold != null) {
      u.uThreshold.value = threshold;
    }
    if (blockMode != null) {
      u.uBlockMode.value = blockMode ? 1 : 0;
    }
    if (steps != null) {
      u.uSteps.value = Math.max(1, Math.round(steps));
    }
    if (Array.isArray(colorLow) && colorLow.length === 3) {
      u.uColorLow.value.setRGB(colorLow[0], colorLow[1], colorLow[2]);
    }
    if (Array.isArray(colorHigh) && colorHigh.length === 3) {
      u.uColorHigh.value.setRGB(colorHigh[0], colorHigh[1], colorHigh[2]);
    }
  }

  /**
   * Restrict the rendered region to an axis-aligned sub-box of the
   * volume.  Both bounds are in local [0, 1] box space.  Use this
   * to expose axis-aligned slices — e.g. set `max.x = 0.5` to show
   * only the half-volume on the low-X side of the box.
   *
   * Cheap: just two uniform updates, no rebuild required.
   *
   * @param {[number, number, number]} min - Per-axis lower bound in [0, 1]
   * @param {[number, number, number]} max - Per-axis upper bound in [0, 1]
   */
  setClipBounds(min, max) {
    if (!this._material) return;
    const u = this._material.uniforms;
    const clamp01 = (v) => Math.max(0, Math.min(1, Number(v)));
    if (Array.isArray(min) && min.length === 3) {
      u.uClipMin.value.set(clamp01(min[0]), clamp01(min[1]), clamp01(min[2]));
    }
    if (Array.isArray(max) && max.length === 3) {
      u.uClipMax.value.set(clamp01(max[0]), clamp01(max[1]), clamp01(max[2]));
    }
  }

  /**
   * Show or hide the volume render object.
   * @param {boolean} visible
   */
  setVisible(visible) {
    if (this.object3D) this.object3D.visible = !!visible;
  }

  /**
   * Free all GPU resources.  The object3D must be removed from the scene
   * by the caller before calling dispose().
   */
  dispose() {
    if (this._texture) {
      this._texture.dispose();
      this._texture = null;
    }
    if (this._material) {
      this._material.dispose();
      this._material = null;
    }
    if (this._mesh) {
      this._mesh.geometry.dispose();
      this._mesh = null;
    }
    this.object3D = null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** @private */
  _buildMesh() {
    // Unit-cube geometry in [0,1]^3; positioning is done via mesh transform.
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    // Shift geometry so it occupies [0,1] rather than [-0.5, 0.5]
    geometry.translate(0.5, 0.5, 0.5);

    this._material = new THREE.ShaderMaterial({
      vertexShader:   VERT_SHADER,
      fragmentShader: FRAG_SHADER,
      // Force GLSL 300 ES so the fragment shader's `gl_FragDepth`
      // write (and `out vec4 outColor`, `in vec3 vLocalPos`) actually
      // compile.  Without this Three.js falls back to GLSL 100 where
      // `gl_FragDepth` doesn't exist, and the volume silently fails
      // to render anywhere — the symptom is "no voxels visible".
      glslVersion: THREE.GLSL3,
      // The fragment shader writes `gl_FragDepth` at the first ray
      // hit, so the volume's effective depth is the visible voxel
      // surface (not the bbox back wall).  With proper per-fragment
      // depth in place, the GL depth test and depth write both
      // work normally — opaque geometry inside the bounding box
      // (e.g. sample-point spheres) gets correctly occluded when
      // it sits behind the visible voxel surface, and stays visible
      // when it sits in front.
      depthTest:  true,
      depthWrite: true,
      uniforms: {
        uVolumeTex:  { value: null },
        uVolumeDims: { value: new THREE.Vector3(1, 1, 1) },
        uWorldMin:   { value: new THREE.Vector3(0, 0, 0) },
        uWorldSize:  { value: new THREE.Vector3(1, 1, 1) },
        uDisplayMin: { value: 0 },
        uDisplayMax: { value: 1 },
        uOpacity:    { value: 0.4 },
        uThreshold:  { value: -1.0 },
        uBlockMode:  { value: 1 },
        uColorLow:   { value: new THREE.Color(0, 0, 1) },  // blue
        uColorHigh:  { value: new THREE.Color(1, 0, 0) },  // red
        uSteps:      { value: 64 },
        uClipMin:    { value: new THREE.Vector3(0, 0, 0) },
        uClipMax:    { value: new THREE.Vector3(1, 1, 1) },
        // World-space → clip-space matrix used to compute the
        // per-fragment depth at the first ray hit.  Updated each
        // frame in the mesh's onBeforeRender below.
        uWorldToClip: { value: new THREE.Matrix4() },
      },
      transparent: true,
      // BackSide so the box still renders when the camera is inside
      // it (front faces would get culled).  The shader's per-fragment
      // `gl_FragDepth` write at the first ray hit gives the correct
      // depth regardless of which face the fragment lives on.
      side: THREE.BackSide,
    });

    this._mesh = new THREE.Mesh(geometry, this._material);
    this._mesh.userData._isIDWVolume = true;
    // Render after every other object in the scene so the front-to-
    // back compositing inside the shader always sees the final
    // colour buffer underneath.
    this._mesh.renderOrder = 999;

    // Refresh the world→clip matrix every frame so the per-fragment
    // depth write in the shader stays consistent with whatever
    // camera the scene is rendered through.  Three.js's
    // matrixWorldInverse is the view matrix (camera.matrixWorld
    // inverted), and `projectionMatrix * viewMatrix` is the
    // standard transform we need.
    const tmpMat = new THREE.Matrix4();
    this._mesh.onBeforeRender = (_renderer, _scene, camera) => {
      if (!this._material) return;
      tmpMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this._material.uniforms.uWorldToClip.value.copy(tmpMat);
    };
    return this._mesh;
  }

  /** @private */
  _uploadTexture(grid) {
    const { dims, values, nodataMask } = grid;
    const [nx, ny, nz] = dims;
    const total = nx * ny * nz;

    // Build a Float32Array for the texture data.
    // Three.js Data3DTexture with RedFormat + FloatType uses one float per voxel.
    const data = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      data[i] = nodataMask[i] ? NODATA_SENTINEL : values[i];
    }

    // Dispose old texture before creating a new one.
    if (this._texture) {
      this._texture.dispose();
      this._texture = null;
    }

    const tex = new THREE.Data3DTexture(data, nx, ny, nz);
    tex.format    = THREE.RedFormat;
    tex.type      = THREE.FloatType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;

    this._texture = tex;
    if (this._material) {
      this._material.uniforms.uVolumeTex.value = tex;
      this._material.uniforms.uVolumeDims.value.set(nx, ny, nz);
    }
  }

  /** @private */
  _positionMesh(bounds) {
    const [minX, minY, minZ] = bounds.min;
    const [sx,   sy,   sz  ] = bounds.size;

    // The geometry is a unit cube [0,1]^3; scale it to match world bounds.
    if (this._mesh) {
      this._mesh.position.set(minX, minY, minZ);
      this._mesh.scale.set(sx, sy, sz);
      this._mesh.updateMatrixWorld(true);
    }

    if (this._material) {
      this._material.uniforms.uWorldMin.value.set(minX, minY, minZ);
      this._material.uniforms.uWorldSize.value.set(sx, sy, sz);
    }
  }

  /** @private */
  _updateUniforms(grid, options = {}) {
    if (!this._material) return;
    const u = this._material.uniforms;

    const {
      displayMin = 0,
      displayMax = 1,
      opacity    = 0.4,
      threshold  = null,
      blockMode  = true,
      steps      = 64,
      colorLow   = [0, 0, 1],
      colorHigh  = [1, 0, 0],
    } = options;

    u.uDisplayMin.value = Number(displayMin);
    u.uDisplayMax.value = Number(displayMax);
    u.uOpacity.value    = Math.max(0, Math.min(1, Number(opacity)));
    u.uThreshold.value  = threshold != null ? Number(threshold) : -1.0;
    u.uBlockMode.value  = blockMode ? 1 : 0;
    u.uSteps.value      = Math.max(1, Math.round(Number(steps)));

    if (Array.isArray(colorLow) && colorLow.length === 3) {
      u.uColorLow.value.setRGB(colorLow[0], colorLow[1], colorLow[2]);
    }
    if (Array.isArray(colorHigh) && colorHigh.length === 3) {
      u.uColorHigh.value.setRGB(colorHigh[0], colorHigh[1], colorHigh[2]);
    }
  }
}
