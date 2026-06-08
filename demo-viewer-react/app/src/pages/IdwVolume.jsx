/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { IDWVolumeLayer } from 'baselode';
import { buildSyntheticIdwDataset } from '../data/syntheticIdwData.js';
import './IdwVolume.css';

const VOXEL_OPTIONS = [
  { label: '32³',  dim: 32 },
  { label: '48³',  dim: 48 },
  { label: '64³',  dim: 64 },
  { label: '96³',  dim: 96 },
];

/**
 * Demo page for the TRK-127 IDW volume feature.
 *
 * Builds a synthetic 3D scalar field (two Gaussian anomalies inside a
 * 1000 × 1000 × 300 m box), runs IDW interpolation on a configurable
 * voxel grid, and renders the result as a shader-side voxel volume in
 * a Three.js scene.  The sample points are also drawn as small spheres
 * coloured by their value so the user can verify the volume tracks
 * the inputs.
 */
function IdwVolumeDemo() {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const layerRef = useRef(null);
  const animationRef = useRef(0);

  const dataset = useMemo(() => buildSyntheticIdwDataset({ count: 250, seed: 42 }), []);

  const [voxelDim, setVoxelDim]         = useState(48);
  const [power, setPower]               = useState(2);
  const [searchRadius, setSearchRadius] = useState(200);
  const [maxNeighbors, setMaxNeighbors] = useState(8);
  const [opacity, setOpacity]           = useState(0.3);
  const [threshold, setThreshold]       = useState(0.15);
  const [blockMode, setBlockMode]       = useState(true);
  const [building, setBuilding]         = useState(false);

  // Initial scene + sample-point cloud — runs once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14141a);

    const camera = new THREE.PerspectiveCamera(50, 1, 1, 10000);
    camera.position.set(1600, 1600, 1100);
    camera.up.set(0, 0, 1);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(1, 1, 1);
    scene.add(dir);

    const axes = new THREE.AxesHelper(1200);
    scene.add(axes);

    // Bounding box outline so the user can see the volume's extent
    // even when the IDW volume is fully transparent.
    const bbox = new THREE.Box3(
      new THREE.Vector3(...dataset.bounds.min),
      new THREE.Vector3(...dataset.bounds.max),
    );
    const bboxHelper = new THREE.Box3Helper(bbox, 0x4444aa);
    scene.add(bboxHelper);

    // Render the synthetic sample points as instanced spheres so the
    // user can spot the relationship between sample positions and
    // the interpolated field.
    //
    // For per-instance colours via `setColorAt`, the material starts
    // with a neutral base colour and Three.js mixes in the instance
    // colour via the `instanceColor` attribute.  Setting
    // `vertexColors: true` is wrong here — that flag expects a
    // per-VERTEX colour attribute on the geometry, not per-instance,
    // and ends up suppressing the instance tinting altogether.
    const sphereGeo = new THREE.SphereGeometry(10, 16, 12);
    const inst = new THREE.InstancedMesh(
      sphereGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      dataset.samples.length,
    );
    const dummy = new THREE.Object3D();
    const tmpColor = new THREE.Color();
    const range = (dataset.maxValue - dataset.minValue) || 1;
    // Match the volume's blue→red transfer function so a high-value
    // sample reads the same way as a high-value voxel.
    const colorLow  = new THREE.Color(0.05, 0.10, 0.55);
    const colorHigh = new THREE.Color(1.00, 0.30, 0.10);
    dataset.samples.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      const t = Math.max(0, Math.min(1, (s.value - dataset.minValue) / range));
      tmpColor.copy(colorLow).lerp(colorHigh, t);
      inst.setColorAt(i, tmpColor);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    scene.add(inst);

    sceneRef.current = { scene, camera, renderer, inst, sphereGeo, bboxHelper };

    // Orbit-style controls — minimal hand-rolled implementation so the
    // demo doesn't drag in OrbitControls when the goal is just to look
    // around the volume.
    const target = new THREE.Vector3(
      (dataset.bounds.min[0] + dataset.bounds.max[0]) / 2,
      (dataset.bounds.min[1] + dataset.bounds.max[1]) / 2,
      (dataset.bounds.min[2] + dataset.bounds.max[2]) / 2,
    );
    let dragging = false;
    let lastX = 0; let lastY = 0;
    let azimuth = Math.atan2(camera.position.y - target.y, camera.position.x - target.x);
    let elevation = Math.atan2(
      camera.position.z - target.z,
      Math.hypot(camera.position.x - target.x, camera.position.y - target.y),
    );
    let radius = camera.position.distanceTo(target);

    const placeCamera = () => {
      const cosE = Math.cos(elevation);
      camera.position.set(
        target.x + radius * cosE * Math.cos(azimuth),
        target.y + radius * cosE * Math.sin(azimuth),
        target.z + radius * Math.sin(elevation),
      );
      camera.lookAt(target);
    };
    placeCamera();

    const onMouseDown = (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; };
    const onMouseUp = () => { dragging = false; };
    const onMouseMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      azimuth -= dx * 0.005;
      elevation = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, elevation + dy * 0.005));
      placeCamera();
    };
    const onWheel = (e) => {
      e.preventDefault();
      radius = Math.max(200, Math.min(8000, radius * (1 + e.deltaY * 0.001)));
      placeCamera();
    };
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('mouseup', onMouseUp);
    renderer.domElement.addEventListener('mouseleave', onMouseUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationRef.current);
      ro.disconnect();
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      renderer.domElement.removeEventListener('mousemove', onMouseMove);
      renderer.domElement.removeEventListener('mouseup', onMouseUp);
      renderer.domElement.removeEventListener('mouseleave', onMouseUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      if (layerRef.current) {
        scene.remove(layerRef.current.object3D);
        layerRef.current.dispose();
        layerRef.current = null;
      }
      sphereGeo.dispose();
      inst.material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [dataset]);

  // Build / rebuild the IDW volume whenever a build-time parameter
  // changes (voxel grid + IDW kernel).
  useEffect(() => {
    if (!sceneRef.current) return;
    const { scene } = sceneRef.current;

    let cancelled = false;
    setBuilding(true);
    (async () => {
      // Tear down the previous layer so disposal of GPU resources
      // happens deterministically rather than on GC.
      if (layerRef.current) {
        scene.remove(layerRef.current.object3D);
        layerRef.current.dispose();
        layerRef.current = null;
      }

      const layer = new IDWVolumeLayer({
        samples: dataset.samples,
        bounds: {
          min: dataset.bounds.min,
          max: dataset.bounds.max,
          size: [
            dataset.bounds.max[0] - dataset.bounds.min[0],
            dataset.bounds.max[1] - dataset.bounds.min[1],
            dataset.bounds.max[2] - dataset.bounds.min[2],
          ],
          center: [
            (dataset.bounds.min[0] + dataset.bounds.max[0]) / 2,
            (dataset.bounds.min[1] + dataset.bounds.max[1]) / 2,
            (dataset.bounds.min[2] + dataset.bounds.max[2]) / 2,
          ],
        },
        idw: { power, searchRadius, maxNeighbors },
        grid: { dims: [voxelDim, voxelDim, voxelDim] },
        displayMin: dataset.minValue,
        displayMax: dataset.maxValue,
        opacity,
        threshold,
        blockMode,
        steps: 96,
        colorLow:  [0.05, 0.10, 0.55],
        colorHigh: [1.00, 0.30, 0.10],
      });
      await layer.rebuild();
      if (cancelled) {
        layer.dispose();
        return;
      }
      scene.add(layer.object3D);
      layerRef.current = layer;
      setBuilding(false);
    })();
    return () => { cancelled = true; };
  }, [dataset, voxelDim, power, searchRadius, maxNeighbors]);

  // Display-only knobs — push straight through to the renderer without
  // rebuilding the voxel grid.
  useEffect(() => {
    if (!layerRef.current) return;
    layerRef.current.setOpacity(opacity);
    layerRef.current.setThreshold(threshold);
    layerRef.current.setBlockMode(blockMode);
  }, [opacity, threshold, blockMode]);

  return (
    <div className="idw-page">
      <header className="idw-page__header">
        <h1>3D IDW Interpolation</h1>
        <p>
          Synthetic Gaussian-anomaly dataset (TRK-127) rendered through
          baselode's <code>IDWVolumeLayer</code>.  Drag to orbit, scroll
          to zoom.  The bright cluster sits where the dataset's primary
          anomaly was placed; smaller secondary anomaly in the
          north-west lower corner.
        </p>
      </header>

      <div className="idw-page__body">
        <div ref={containerRef} className="idw-page__canvas" />

        <aside className="idw-page__controls">
          <label className="idw-control">
            <span>Voxel grid</span>
            <select value={voxelDim} onChange={(e) => setVoxelDim(Number(e.target.value))}>
              {VOXEL_OPTIONS.map((o) => (
                <option key={o.dim} value={o.dim}>{o.label}</option>
              ))}
            </select>
          </label>

          <label className="idw-control">
            <span>IDW power: {power.toFixed(1)}</span>
            <input
              type="range"
              min={1}
              max={5}
              step={0.5}
              value={power}
              onChange={(e) => setPower(Number(e.target.value))}
            />
          </label>

          <label className="idw-control">
            <span>Search radius: {searchRadius} m</span>
            <input
              type="range"
              min={50}
              max={500}
              step={25}
              value={searchRadius}
              onChange={(e) => setSearchRadius(Number(e.target.value))}
            />
          </label>

          <label className="idw-control">
            <span>Max neighbours: {maxNeighbors}</span>
            <input
              type="range"
              min={1}
              max={32}
              step={1}
              value={maxNeighbors}
              onChange={(e) => setMaxNeighbors(Number(e.target.value))}
            />
          </label>

          <label className="idw-control">
            <span>Opacity: {opacity.toFixed(2)}</span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
          </label>

          <label className="idw-control">
            <span>Threshold: {threshold.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={0.95}
              step={0.05}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </label>

          <label className="idw-control idw-control--checkbox">
            <input
              type="checkbox"
              checked={blockMode}
              onChange={(e) => setBlockMode(e.target.checked)}
            />
            <span>Block mode (crisp voxels)</span>
          </label>

          <div className="idw-control idw-control--info">
            <div><strong>Samples</strong>: {dataset.samples.length}</div>
            <div><strong>Box</strong>: 1000 × 1000 × 300 m</div>
            <div><strong>Value range</strong>: {dataset.minValue.toFixed(1)} – {dataset.maxValue.toFixed(1)}</div>
            {building && <div className="idw-building">Rebuilding voxel grid…</div>}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default IdwVolumeDemo;
