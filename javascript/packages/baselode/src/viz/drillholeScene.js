/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';
import { buildEqualRangeColorScale, getEqualRangeBinIndex, getEqualRangeColor } from './assayColorScale.js';
import { fitCameraToBounds } from './baselode3dCameraControls.js';
import { syncSelectables } from './sceneSelectables.js';
import { buildDrillholeTubeGeometry, defaultTubeRadius, updateTubeRadius } from './drillholeTubeGeometry.js';
import {
  NO_DATA_COLOR,
  buildDrillholeColorLayer,
  buildHoleTextureData,
  createHoleTexture,
  createIntervalTexture,
  createRampTexture,
  getCategoryHexColor,
  normalizeHoleKey,
  resolveColorMode,
  seededUnit,
} from './drillholeColorTexture.js';
import { createDrillholeTubeMaterial, createDrillholeUniforms, updateDrillholeCameraUniforms } from './drillholeMaterial.js';
import { buildCollarDropLines, buildCollarMarkers, buildHoleLabels, disposeAnnotationGroup, updateLabelSprites } from './drillholeAnnotations.js';
import { buildDrillholeLines, disposeDrillholeLines } from './drillholeLineLod.js';

export { getCategoryHexColor, seededUnit, normalizeHoleKey };

/** Default color for low or zero assay values */
const LOW_ASSAY_GREY = NO_DATA_COLOR;
const COLOR_CROSSFADE_MS = 380;

// ---------------------------------------------------------------------------
// Interval helpers (kept for API compatibility and reuse by other modules)
// ---------------------------------------------------------------------------

/**
 * Get measured depth range for a segment between two points
 */
export function getMeasuredDepthRange(p1, p2) {
  const md1 = Number(p1?.md);
  const md2 = Number(p2?.md);
  if (!Number.isFinite(md1) || !Number.isFinite(md2)) return null;
  const segStart = Math.min(md1, md2);
  const segEnd = Math.max(md1, md2);
  if (segEnd <= segStart) return null;
  return { segStart, segEnd };
}

/**
 * Split a physical trace segment at categorical interval boundaries.
 *
 * Survey traces are often sparse (for example, a vertical hole may have only
 * collar and end-of-hole stations) while geology is sampled at much finer
 * intervals.  Each returned slice has the interpolated physical endpoints and
 * its dominant category.
 */
export function splitCategoricalSegment(p1, p2, intervals) {
  const range = getMeasuredDepthRange(p1, p2);
  if (!range || !Array.isArray(intervals) || intervals.length === 0) return [];

  const boundaries = new Set([range.segStart, range.segEnd]);
  for (const interval of intervals) {
    const from = Number(interval?.from);
    const to = Number(interval?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    if (from > range.segStart && from < range.segEnd) boundaries.add(from);
    if (to > range.segStart && to < range.segEnd) boundaries.add(to);
  }

  const mdDelta = Number(p2.md) - Number(p1.md);
  if (!Number.isFinite(mdDelta) || mdDelta === 0) return [];
  const ordered = [...boundaries].sort((a, b) => a - b);
  if (mdDelta < 0) ordered.reverse();
  const pointAtDepth = (depth) => {
    const fraction = (depth - Number(p1.md)) / mdDelta;
    const point = p1.clone().lerp(p2, fraction);
    point.md = depth;
    return point;
  };

  const slices = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const segmentStart = ordered[index];
    const segmentEnd = ordered[index + 1];
    if (segmentEnd === segmentStart) continue;
    const segStart = Math.min(segmentStart, segmentEnd);
    const segEnd = Math.max(segmentStart, segmentEnd);
    const category = getDominantCategory(intervals, segStart, segEnd);
    const previous = slices[slices.length - 1];
    if (previous && previous.category === category) {
      previous.p2 = pointAtDepth(segmentEnd);
      continue;
    }
    slices.push({
      p1: pointAtDepth(segmentStart),
      p2: pointAtDepth(segmentEnd),
      category,
    });
  }
  return slices;
}

/**
 * Calculate weighted average assay value for a segment overlapping with assay intervals
 */
export function getWeightedIntervalValue(assayIntervals, segStart, segEnd) {
  let weightedSum = 0;
  let weightTotal = 0;

  for (let i = 0; i < assayIntervals.length; i += 1) {
    const candidate = assayIntervals[i];
    const from = Number(candidate?.from);
    const to = Number(candidate?.to);
    const value = Number(candidate?.value);
    if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(value) || to <= from) continue;
    const overlapStart = Math.max(segStart, from);
    const overlapEnd = Math.min(segEnd, to);
    const overlap = overlapEnd - overlapStart;
    if (overlap <= 0) continue;
    weightedSum += value * overlap;
    weightTotal += overlap;
  }

  if (weightTotal <= 0) return null;
  const value = weightedSum / weightTotal;
  return Number.isFinite(value) ? value : null;
}

/**
 * Get THREE.Color for an assay value based on color scale
 */
export function getAssaySegmentColor(value, assayScale) {
  if (!Number.isFinite(value)) return new THREE.Color(LOW_ASSAY_GREY);
  const binIndex = getEqualRangeBinIndex(value, assayScale);
  if (binIndex < 0) return new THREE.Color(LOW_ASSAY_GREY);
  const colorHex = getEqualRangeColor(value, assayScale, LOW_ASSAY_GREY);
  return new THREE.Color(colorHex);
}

/**
 * Normalize drillhole rendering options with defaults.
 *
 * Colour options (may also be passed to setDrillholeColorBy):
 *   selectedAssayVariable, assayIntervalsByHole, isCategoricalVariable,
 *   categoryColorMap, categoryOrder, palette, scaleMode ('quantile'|'linear'|'log'),
 *   continuous, bins, depthTexels
 *
 * Geometry / presentation options:
 *   preserveView, radius, radialSegments, screenPixels (constant pixel width;
 *   0 disables), labels, collars, dropLines, lod ({ enabled, distanceFactor })
 */
export function normalizeDrillholeRenderOptions(options = {}) {
  const selectedAssayVariable = options.selectedAssayVariable || '';
  return {
    preserveView: Boolean(options.preserveView),
    assayIntervalsByHole: options.assayIntervalsByHole || null,
    selectedAssayVariable,
    isCategoricalVariable: Boolean(options.isCategoricalVariable)
      && selectedAssayVariable !== '__HAS_ASSAY__',
    categoryColorMap: options.categoryColorMap || null,
    categoryOrder: Array.isArray(options.categoryOrder) ? options.categoryOrder : null,
    palette: Array.isArray(options.palette) && options.palette.length ? options.palette : null,
    scaleMode: options.scaleMode || 'quantile',
    continuous: Boolean(options.continuous),
    bins: Number.isFinite(options.bins) ? options.bins : null,
    depthTexels: Number.isFinite(options.depthTexels) ? options.depthTexels : null,
    radius: Number.isFinite(options.radius) && options.radius > 0 ? options.radius : null,
    radialSegments: Number.isFinite(options.radialSegments) ? options.radialSegments : 8,
    screenPixels: Number.isFinite(options.screenPixels) ? options.screenPixels : 0,
    labels: options.labels !== false,
    collars: options.collars !== false,
    dropLines: Boolean(options.dropLines),
    lod: {
      enabled: options.lod?.enabled !== false,
      // Switch to lines when a tube would be thinner than this many pixels.
      pixelThreshold: Number.isFinite(options.lod?.pixelThreshold) ? options.lod.pixelThreshold : 1.1,
    },
  };
}

/**
 * Collect all numeric assay values from interval data
 */
export function collectAssayValues(assayIntervalsByHole, selectedAssayVariable) {
  if (!assayIntervalsByHole || !selectedAssayVariable) return [];
  const allAssayValues = [];
  Object.values(assayIntervalsByHole).forEach((intervals) => {
    (intervals || []).forEach((interval) => {
      const value = Number(interval?.value);
      if (Number.isFinite(value)) allAssayValues.push(value);
    });
  });
  return allAssayValues;
}

/**
 * Build user data object for drillhole mesh
 */
export function buildHoleUserData(hole) {
  return {
    holeId: hole.id,
    project: hole.project
  };
}

/**
 * Generate a deterministic per-segment color based on hole ID and segment index
 */
export function randomSegmentColor(holeId, segmentIndex) {
  const seed = `${holeId ?? ''}:${segmentIndex ?? 0}`;
  const base = seededUnit(seed);
  const band = ((segmentIndex ?? 0) % 14) / 14;
  const hue = (base * 0.15 + band * 0.85) % 1;
  const color = new THREE.Color();
  color.setHSL(hue, 1.0, 0.5);
  return color;
}

function getDominantCategory(intervals, segStart, segEnd) {
  let best = null;
  let bestOverlap = 0;
  for (const iv of intervals) {
    const from = Number(iv?.from);
    const to = Number(iv?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const overlap = Math.min(segEnd, to) - Math.max(segStart, from);
    if (overlap > bestOverlap) { bestOverlap = overlap; best = iv?.value; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Public scene functions
// ---------------------------------------------------------------------------

/**
 * Build one merged tube mesh for all drillholes and add it to the scene.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 * @param {Array} holes - Array of desurveyed hole objects with `points`
 * @param {object} [options] - see normalizeDrillholeRenderOptions
 */
export function setDrillholes(sceneCtx, holes, options = {}) {
  if (!sceneCtx.scene) return;

  clearDrillholes(sceneCtx);
  if (!holes || holes.length === 0) return;

  const opts = normalizeDrillholeRenderOptions(options);
  const radiusSeed = opts.radius || 1;
  const built = buildDrillholeTubeGeometry(holes, { radialSegments: opts.radialSegments, radius: radiusSeed });
  const bounds = built.bounds;
  const typicalLength = medianOf(built.holes.map((h) => h.length));
  const radius = opts.radius || defaultTubeRadius(bounds, typicalLength);
  if (built.geometry && radius !== radiusSeed) updateTubeRadius(built.geometry, radius);

  const group = new THREE.Group();
  group.name = 'baselode-drillholes';
  const uniforms = createDrillholeUniforms();
  uniforms.uRadius.value = radius;
  uniforms.uScreenRadius.value = opts.screenPixels;
  uniforms.uHoleCount.value = Math.max(1, built.holes.length);
  if (sceneCtx._ghostColor) uniforms.uGhostColor.value.copy(sceneCtx._ghostColor);

  const holeTexData = buildHoleTextureData(built.holes, {});
  const holeTexture = createHoleTexture(holeTexData, built.holes.length);
  uniforms.uHoleTex.value = holeTexture;

  const material = createDrillholeTubeMaterial(uniforms);
  let mesh = null;
  const spheres = built.holes.map((h) => new THREE.Sphere(h.sphere.center.clone(), h.sphere.radius + radius * 2));
  if (built.geometry) {
    mesh = new THREE.Mesh(built.geometry, material);
    mesh.name = 'baselode-drillhole-tubes';
    mesh.frustumCulled = true;
    mesh.userData.isDrillholeTubes = true;
    mesh.raycast = makePerHoleRaycast(built.holes, spheres);
    group.add(mesh);
  }

  const layer = {
    mesh,
    geometry: built.geometry,
    material,
    uniforms,
    holes: built.holes,
    singlePointHoles: built.singlePointHoles,
    holeIndexById: buildHoleIndex(built.holes),
    bounds,
    radius,
    screenPixels: opts.screenPixels,
    spheres,
    group,
    colorLayer: null,
    colorOptions: null,
    textures: { interval: null, ramp: null, prevInterval: null, prevRamp: null, hole: holeTexture },
    holeTexData,
    visibleIds: null,
    selectedIndex: -1,
    crossfade: null,
    markers: null,
    labels: null,
    dropLines: null,
    lines: null,
    linesDirty: true,
    lod: { ...opts.lod, active: false },
    typicalLength,
    pixelRadius: Infinity,
    show: { labels: opts.labels, collars: opts.collars, dropLines: opts.dropLines },
    datumZ: bounds ? bounds.maxZ : 0,
  };
  sceneCtx.drillholeLayer = layer;
  sceneCtx.scene.add(group);

  // Compatibility with modules that expect these arrays.
  sceneCtx.drillMeshes = mesh ? [mesh] : [];
  sceneCtx.drillLines = [group];

  applyColorOptions(sceneCtx, opts, { crossfade: false });
  rebuildDrillholeAnnotations(sceneCtx);

  if (sceneCtx.camera && sceneCtx.controls && bounds) {
    sceneCtx.lastBounds = { ...bounds };
    if (!opts.preserveView) {
      fitCameraToBounds(sceneCtx, bounds, { animate: false });
    }
  }
  syncSelectables(sceneCtx);
}

/**
 * Remove the drillhole layer from the scene and dispose GPU resources.
 *
 * @param {object} sceneCtx - Baselode3DScene instance
 */
export function clearDrillholes(sceneCtx) {
  const layer = sceneCtx.drillholeLayer;
  if (layer) {
    if (sceneCtx.scene) sceneCtx.scene.remove(layer.group);
    layer.geometry?.dispose?.();
    layer.material?.dispose?.();
    Object.values(layer.textures).forEach((t) => t?.dispose?.());
    disposeAnnotationGroup(layer.markers);
    disposeAnnotationGroup(layer.labels);
    disposeAnnotationGroup(layer.dropLines);
    disposeDrillholeLines(layer.lines);
    sceneCtx.drillholeLayer = null;
  }
  // Legacy per-segment objects (if any consumer pushed its own meshes).
  (sceneCtx.drillLines || []).forEach((obj) => {
    if (layer && obj === layer.group) return;
    sceneCtx.scene?.remove(obj);
    obj.traverse?.((child) => {
      if (child.isMesh) {
        child.geometry?.dispose?.();
        child.material?.dispose?.();
      }
    });
  });
  sceneCtx.drillLines = [];
  sceneCtx.drillMeshes = [];
  syncSelectables(sceneCtx);
}

/**
 * Change the attribute the drillholes are coloured by without rebuilding
 * geometry.  Accepts the same colour options as setDrillholes.
 * @param {object} sceneCtx
 * @param {object} options
 * @returns {object|null} legend for the new colouring
 */
export function setDrillholeColorBy(sceneCtx, options = {}) {
  const layer = sceneCtx.drillholeLayer;
  if (!layer) return null;
  const opts = normalizeDrillholeRenderOptions({ ...(layer.colorOptions || {}), ...options, preserveView: true });
  applyColorOptions(sceneCtx, opts, { crossfade: true });
  return getDrillholeLegend(sceneCtx);
}

/**
 * Set the tube radius.  Pass a number for a world-unit radius, or an object
 * `{ radius, screenPixels }` to switch to constant-pixel width.
 * @param {object} sceneCtx
 * @param {number|{radius?: number, screenPixels?: number}} value
 */
export function setDrillholeRadius(sceneCtx, value) {
  const layer = sceneCtx.drillholeLayer;
  if (!layer) return;
  const radius = typeof value === 'number' ? value : value?.radius;
  const screenPixels = typeof value === 'object' && value !== null && Number.isFinite(value.screenPixels) ? value.screenPixels : layer.screenPixels;
  if (Number.isFinite(radius) && radius > 0 && radius !== layer.radius) {
    layer.radius = radius;
    layer.uniforms.uRadius.value = radius;
    if (layer.geometry) updateTubeRadius(layer.geometry, radius);
    layer.holes.forEach((h, i) => { layer.spheres[i].radius = h.sphere.radius + radius * 2; });
  }
  layer.screenPixels = screenPixels;
  layer.uniforms.uScreenRadius.value = screenPixels;
}

/**
 * Ghost every hole not in `visibleIds` (null shows everything).
 * @param {object} sceneCtx
 * @param {Iterable<string>|null} visibleIds
 */
export function setDrillholeFilter(sceneCtx, visibleIds) {
  const layer = sceneCtx.drillholeLayer;
  if (!layer) return;
  const set = visibleIds ? new Set([...visibleIds].map((id) => normalizeHoleKey(id))) : null;
  layer.visibleIds = set;
  const data = layer.holeTexData;
  layer.holes.forEach((h, i) => {
    data[i * 4 + 3] = set === null || set.has(normalizeHoleKey(h.id)) ? 1 : 0;
  });
  layer.textures.hole.needsUpdate = true;
}

/**
 * Highlight a hole (and quieten the rest).  Pass null to clear.
 * @param {object} sceneCtx
 * @param {string|null} holeId
 * @returns {boolean} true when a hole was selected
 */
export function setSelectedDrillhole(sceneCtx, holeId) {
  const layer = sceneCtx.drillholeLayer;
  if (!layer) return false;
  const index = holeId == null ? -1 : (layer.holeIndexById.get(normalizeHoleKey(holeId)) ?? -1);
  layer.selectedIndex = index;
  layer.uniforms.uSelected.value = index;
  return index >= 0;
}

/**
 * Currently highlighted hole id, or null.
 */
export function getSelectedDrillhole(sceneCtx) {
  const layer = sceneCtx.drillholeLayer;
  if (!layer || layer.selectedIndex < 0) return null;
  return layer.holes[layer.selectedIndex]?.id ?? null;
}

/**
 * Legend entries for the current colouring.
 * @returns {{mode: string, variable: string, entries: Array<{color: string, label: string}>}|null}
 */
export function getDrillholeLegend(sceneCtx) {
  const layer = sceneCtx.drillholeLayer;
  if (!layer?.colorLayer) return null;
  return layer.colorLayer.legend;
}

/**
 * Metadata for the rendered holes (id, collar, length, bounds sphere).
 */
export function getDrillholeMeta(sceneCtx) {
  const layer = sceneCtx.drillholeLayer;
  if (!layer) return [];
  return layer.holes.map((h) => ({
    id: h.id,
    project: h.project,
    index: h.index,
    collar: { x: h.collar.x, y: h.collar.y, z: h.collar.z },
    eoh: { x: h.eoh.x, y: h.eoh.y, z: h.eoh.z },
    length: h.length,
    mdMin: h.mdMin,
    mdMax: h.mdMax,
  }));
}

/**
 * Show / hide hole-id labels, collar markers and collar drop lines.
 * @param {object} sceneCtx
 * @param {{labels?: boolean, collars?: boolean, dropLines?: boolean}} flags
 */
export function setDrillholeAnnotations(sceneCtx, flags = {}) {
  const layer = sceneCtx.drillholeLayer;
  if (!layer) return;
  if (flags.labels !== undefined) layer.show.labels = Boolean(flags.labels);
  if (flags.collars !== undefined) layer.show.collars = Boolean(flags.collars);
  if (flags.dropLines !== undefined) layer.show.dropLines = Boolean(flags.dropLines);
  if (layer.markers) layer.markers.visible = layer.show.collars;
  if (layer.dropLines) layer.dropLines.visible = layer.show.dropLines;
}

/**
 * Configure the far level of detail (screen-width lines instead of tubes).
 * @param {object} sceneCtx
 * @param {{enabled?: boolean, pixelThreshold?: number}} opts
 */
export function setDrillholeLod(sceneCtx, opts = {}) {
  const layer = sceneCtx.drillholeLayer;
  if (!layer) return;
  if (opts.enabled !== undefined) layer.lod.enabled = Boolean(opts.enabled);
  if (Number.isFinite(opts.pixelThreshold)) layer.lod.pixelThreshold = opts.pixelThreshold;
}

/**
 * Change the datum elevation used for collar drop lines.
 */
export function setDrillholeDatum(sceneCtx, datumZ) {
  const layer = sceneCtx.drillholeLayer;
  if (!layer || !Number.isFinite(datumZ)) return;
  layer.datumZ = datumZ;
  rebuildDrillholeAnnotations(sceneCtx);
}

/**
 * Rebuild collar markers / labels / drop lines (call after a theme change).
 */
export function rebuildDrillholeAnnotations(sceneCtx) {
  const layer = sceneCtx.drillholeLayer;
  if (!layer) return;
  const dark = Boolean(sceneCtx.isDarkBackground);
  if (layer.markers) { layer.group.remove(layer.markers); disposeAnnotationGroup(layer.markers); }
  if (layer.labels) { layer.group.remove(layer.labels); disposeAnnotationGroup(layer.labels); }
  if (layer.dropLines) { layer.group.remove(layer.dropLines); disposeAnnotationGroup(layer.dropLines); }
  layer.markers = buildCollarMarkers(layer.holes, layer.singlePointHoles, { radius: layer.radius * 2.6, dark });
  layer.markers.visible = layer.show.collars;
  layer.labels = buildHoleLabels(layer.holes, layer.singlePointHoles, { lift: layer.radius * 5, dark });
  layer.labels.visible = layer.show.labels;
  layer.dropLines = buildCollarDropLines(layer.holes, layer.singlePointHoles, layer.datumZ, { dark });
  if (layer.dropLines) layer.dropLines.visible = layer.show.dropLines;
  layer.group.add(layer.markers, layer.labels);
  if (layer.dropLines) layer.group.add(layer.dropLines);
}

/**
 * Background-dependent tint used for ghosted holes.
 */
export function setDrillholeGhostColor(sceneCtx, color) {
  sceneCtx._ghostColor = new THREE.Color(color);
  const layer = sceneCtx.drillholeLayer;
  if (layer) layer.uniforms.uGhostColor.value.copy(sceneCtx._ghostColor);
}

/**
 * Raycast the drillhole layer (tubes or the line LOD, whichever is showing).
 * @param {object} sceneCtx
 * @param {THREE.Raycaster} raycaster
 * @returns {{holeId: string, holeIndex: number, project: any, point: THREE.Vector3, distance: number, md: number}|null}
 */
export function pickDrillhole(sceneCtx, raycaster) {
  const layer = sceneCtx.drillholeLayer;
  if (!layer || !raycaster) return null;
  const hits = [];
  if (layer.mesh?.visible) layer.mesh.raycast(raycaster, hits);
  if (layer.lines?.visible) {
    const saved = raycaster.params.Line2?.threshold;
    raycaster.params.Line2 = { threshold: Math.max(saved || 0, 6) };
    layer.lines.raycast(raycaster, hits);
    if (saved !== undefined) raycaster.params.Line2.threshold = saved;
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.distance - b.distance);
  const hit = hits[0];
  let holeIndex = -1;
  if (hit.object === layer.mesh && hit.face) {
    holeIndex = layer.geometry.getAttribute('aHole').getX(hit.face.a);
  } else if (hit.object === layer.lines) {
    holeIndex = layer.lines.userData.segmentToHole[hit.faceIndex] ?? -1;
  }
  if (holeIndex < 0) return null;
  const hole = layer.holes[holeIndex];
  const md = measuredDepthAtPoint(hole, hit.point);
  return { holeId: hole.id, holeIndex, project: hole.project, point: hit.point.clone(), distance: hit.distance, md };
}

/**
 * Per-frame update.  Keeps uniforms, colour crossfades, level-of-detail and
 * label sizing in step with the camera.
 * @param {object} sceneCtx
 * @param {{dt: number, viewportHeight: number}} frame
 */
export function updateDrillholeFrame(sceneCtx, { dt = 0.016, viewportHeight = 1 } = {}) {
  const layer = sceneCtx.drillholeLayer;
  if (!layer || !sceneCtx.camera) return;
  const camera = sceneCtx.camera;
  updateDrillholeCameraUniforms(layer.uniforms, camera, viewportHeight);

  if (layer.crossfade) {
    const now = nowMs();
    const t = Math.min(1, (now - layer.crossfade.start) / layer.crossfade.duration);
    layer.uniforms.uMix.value = t;
    if (t >= 1) {
      disposePrevTextures(layer);
      layer.crossfade = null;
    }
  }

  // How many pixels wide a tube is at the orbit pivot.  Drives both the far
  // level of detail (lines when tubes would be sub-pixel) and label density.
  const pixelRadius = tubePixelRadius(sceneCtx, layer, camera, viewportHeight);
  layer.pixelRadius = pixelRadius;

  // Level of detail: when tubes would be thinner than a pixel, draw
  // screen-width lines instead.  Hysteresis stops it flickering.
  let useLines = false;
  if (layer.lod.enabled && layer.mesh && layer.screenPixels <= 0) {
    const threshold = layer.lod.pixelThreshold ?? 1.1;
    useLines = layer.lod.active ? pixelRadius < threshold * 1.5 : pixelRadius < threshold;
  }
  if (useLines) {
    if (!layer.lines || layer.linesDirty) rebuildLines(sceneCtx);
    if (layer.lines) {
      layer.lines.visible = true;
      layer.lines.material.resolution.set(
        sceneCtx.renderer?.domElement?.clientWidth || 1,
        sceneCtx.renderer?.domElement?.clientHeight || viewportHeight,
      );
    }
    // Keep the selected hole as a (boosted) tube so it still stands out
    // among the lines; everything else is drawn by the line layer.
    const selected = layer.selectedIndex >= 0 ? layer.holes[layer.selectedIndex] : null;
    if (layer.mesh) {
      if (selected) {
        layer.geometry.setDrawRange(selected.indexStart, selected.indexCount);
        layer.mesh.visible = true;
      } else {
        layer.mesh.visible = false;
      }
    }
  } else {
    if (layer.mesh) {
      layer.geometry.setDrawRange(0, Infinity);
      layer.mesh.visible = true;
    }
    if (layer.lines) layer.lines.visible = false;
  }
  layer.lod.active = useLines;

  // Labels: only once the holes themselves are legible, and faded with
  // distance relative to the typical hole length so a regional dataset does
  // not become a wall of text.
  if (layer.labels) {
    const allowed = layer.show.labels && (pixelRadius >= 0.9 || layer.screenPixels > 0);
    layer.labels.visible = allowed;
    if (allowed) {
      const L = Math.max(layer.typicalLength || 100, 10);
      updateLabelSprites(layer.labels, camera, viewportHeight, { pixelHeight: 18, fadeStart: L * 18, fadeEnd: L * 32 });
    }
  }
}

function tubePixelRadius(sceneCtx, layer, camera, viewportHeight) {
  if (layer.screenPixels > 0) return layer.screenPixels;
  let upp;
  if (camera.isOrthographicCamera) {
    upp = ((camera.top - camera.bottom) / (camera.zoom || 1)) / Math.max(viewportHeight, 1);
  } else {
    const target = sceneCtx.controls?.target;
    let dist;
    if (target) {
      dist = camera.position.distanceTo(target);
    } else if (layer.bounds) {
      const b = layer.bounds;
      dist = camera.position.distanceTo(new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2));
    } else {
      dist = 100;
    }
    const fov = THREE.MathUtils.degToRad(camera.fov || 28);
    upp = (2 * Math.max(dist, 1e-6) * Math.tan(fov / 2)) / Math.max(viewportHeight, 1);
  }
  return upp > 0 ? layer.radius / upp : Infinity;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function medianOf(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return 0;
  return v[Math.floor(v.length / 2)];
}

function buildHoleIndex(holes) {
  const map = new Map();
  holes.forEach((h) => {
    map.set(normalizeHoleKey(h.id), h.index);
    map.set(String(h.id), h.index);
  });
  return map;
}

function applyColorOptions(sceneCtx, opts, { crossfade }) {
  const layer = sceneCtx.drillholeLayer;
  if (!layer) return;
  const mode = resolveColorMode(opts);
  const colorLayer = buildDrillholeColorLayer(layer.holes, {
    mode,
    variable: opts.selectedAssayVariable,
    intervalsByHole: opts.assayIntervalsByHole,
    palette: opts.palette || undefined,
    scaleMode: opts.scaleMode,
    continuous: opts.continuous,
    bins: opts.bins || undefined,
    categoryColorMap: opts.categoryColorMap,
    categoryOrder: opts.categoryOrder || undefined,
    depthTexels: opts.depthTexels || undefined,
  });

  const u = layer.uniforms;
  const t = layer.textures;
  if (crossfade && (t.interval || u.uMode.value !== 0)) {
    disposePrevTextures(layer);
    t.prevInterval = t.interval;
    t.prevRamp = t.ramp;
    u.uIntervalTexPrev.value = t.prevInterval;
    u.uRampTexPrev.value = t.prevRamp;
    u.uModePrev.value = u.uMode.value;
    u.uMix.value = 0;
    layer.crossfade = { start: nowMs(), duration: COLOR_CROSSFADE_MS };
  } else {
    t.interval?.dispose?.();
    t.ramp?.dispose?.();
    u.uMix.value = 1;
    layer.crossfade = null;
  }
  t.interval = createIntervalTexture(colorLayer);
  t.ramp = createRampTexture(colorLayer);
  u.uIntervalTex.value = t.interval;
  u.uRampTex.value = t.ramp;
  u.uMode.value = mode === 'none' ? 0 : 1;
  layer.colorLayer = colorLayer;
  layer.colorOptions = { ...opts };
  layer.linesDirty = true;
}

function disposePrevTextures(layer) {
  const t = layer.textures;
  const u = layer.uniforms;
  t.prevInterval?.dispose?.();
  t.prevRamp?.dispose?.();
  t.prevInterval = null;
  t.prevRamp = null;
  u.uIntervalTexPrev.value = null;
  u.uRampTexPrev.value = null;
  u.uMix.value = 1;
}

function rebuildLines(sceneCtx) {
  const layer = sceneCtx.drillholeLayer;
  if (!layer) return;
  if (layer.lines) {
    layer.group.remove(layer.lines);
    disposeDrillholeLines(layer.lines);
    layer.lines = null;
  }
  const resolution = new THREE.Vector2(
    sceneCtx.renderer?.domElement?.clientWidth || 1,
    sceneCtx.renderer?.domElement?.clientHeight || 1,
  );
  layer.lines = buildDrillholeLines(layer.holes, layer.colorLayer, { lineWidth: 2.5, resolution });
  layer.lines.visible = false;
  layer.group.add(layer.lines);
  layer.linesDirty = false;
}

const _inverseMatrix = new THREE.Matrix4();
const _localRay = new THREE.Ray();

function makePerHoleRaycast(holes, spheres) {
  const meshRaycast = THREE.Mesh.prototype.raycast;
  return function perHoleRaycast(raycaster, intersects) {
    const geometry = this.geometry;
    if (!geometry?.index) return;
    _inverseMatrix.copy(this.matrixWorld).invert();
    _localRay.copy(raycaster.ray).applyMatrix4(_inverseMatrix);
    if (geometry.boundingSphere && !_localRay.intersectsSphere(geometry.boundingSphere)) return;
    const saved = { start: geometry.drawRange.start, count: geometry.drawRange.count };
    for (let i = 0; i < holes.length; i += 1) {
      if (!_localRay.intersectsSphere(spheres[i])) continue;
      geometry.setDrawRange(holes[i].indexStart, holes[i].indexCount);
      meshRaycast.call(this, raycaster, intersects);
    }
    geometry.setDrawRange(saved.start, saved.count);
  };
}

const _segA = new THREE.Vector3();
const _segB = new THREE.Vector3();
const _closest = new THREE.Vector3();

function measuredDepthAtPoint(hole, point) {
  let bestDist = Infinity;
  let bestMd = hole.mdMin;
  const pts = hole.points;
  for (let i = 0; i < pts.length - 1; i += 1) {
    _segA.copy(pts[i]);
    _segB.copy(pts[i + 1]);
    const ab = _segB.clone().sub(_segA);
    const len2 = ab.lengthSq();
    const t = len2 > 0 ? Math.min(1, Math.max(0, point.clone().sub(_segA).dot(ab) / len2)) : 0;
    _closest.copy(_segA).addScaledVector(ab, t);
    const d = _closest.distanceToSquared(point);
    if (d < bestDist) {
      bestDist = d;
      bestMd = hole.mds[i] + (hole.mds[i + 1] - hole.mds[i]) * t;
    }
  }
  return bestMd;
}
