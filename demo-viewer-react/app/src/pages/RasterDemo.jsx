/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState } from 'react';
import { Baselode3DScene, Baselode3DControls, createRasterOverlay } from 'baselode';
import 'baselode/style.css';
import './Drillhole.css';

// GeoTIFF bounds in GDA94 / MGA zone 50 (EPSG:28350):
//   Upper Left:  (693545.806, 7675285.213)
//   Lower Right: (700469.331, 7667027.756)
//   Center:      (697007.569, 7671156.484)
// We centre the scene at the raster centroid so coordinates stay manageable.
const SCENE_ORIGIN_E = 697007.569;
const SCENE_ORIGIN_N = 7671156.484;
const SURFACE_Z = 350; // approximate terrain elevation (m)

const RASTER_BOUNDS = {
  minX: 693545.806 - SCENE_ORIGIN_E,  // ≈ -3461.8
  maxX: 700469.331 - SCENE_ORIGIN_E,  // ≈  3461.8
  minY: 7667027.756 - SCENE_ORIGIN_N, // ≈ -4128.7
  maxY: 7675285.213 - SCENE_ORIGIN_N, // ≈  4128.7
};

// Drill-hole trace generator.
// dip: degrees below horizontal (90 = straight down)
// azDeg: azimuth degrees clockwise from North
function makeHole(id, x0, y0, dip, azDeg, depth, nSteps = 20) {
  const dipRad = (dip * Math.PI) / 180;
  const azRad = (azDeg * Math.PI) / 180;
  const hComp = Math.cos(dipRad); // horizontal advance per unit length
  const vComp = Math.sin(dipRad); // vertical drop per unit length
  const dx = hComp * Math.sin(azRad); // east  component
  const dy = hComp * Math.cos(azRad); // north component
  const dz = -vComp;                   // elevation drops (negative)
  const points = [];
  for (let i = 0; i <= nSteps; i++) {
    const md = (depth * i) / nSteps;
    points.push({ x: x0 + dx * md, y: y0 + dy * md, z: SURFACE_Z + dz * md, md });
  }
  return { id, project: 'M45/1256', points };
}

// Six synthetic RC drillholes scattered across the raster
const DEMO_HOLES = [
  makeHole('MRC001', -500,  800, 90,   0, 200),
  makeHole('MRC002',  300,  500, 80,  90, 250),
  makeHole('MRC003',  700, -300, 85, 180, 180),
  makeHole('MRC004', -200, -600, 90,   0, 300),
  makeHole('MRC005', 1000,  200, 75, 315, 220),
  makeHole('MRC006', -800, -200, 85,  45, 260),
];

const FOV_STEPS = [1, 4, 8, 14, 21, 28];
const RASTER_OVERLAY_ID = 'geology-map';

export default function RasterDemo() {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);

  const [selectedHole, setSelectedHole] = useState(null);
  const [controlMode, setControlMode] = useState('orbit');
  const [perspectiveLevel, setPerspectiveLevel] = useState(FOV_STEPS.length - 1);
  const [rasterOpacity, setRasterOpacity] = useState(0.85);
  const [rasterVisible, setRasterVisible] = useState(true);
  const [rasterLoaded, setRasterLoaded] = useState(false);
  const [rasterError, setRasterError] = useState('');

  // Initialise scene once
  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new Baselode3DScene();
    scene.init(containerRef.current);
    scene.setDrillholeClickHandler((meta) => setSelectedHole(meta));
    sceneRef.current = scene;

    // Load drillholes
    scene.setDrillholes(DEMO_HOLES, { preserveView: false });

    // Load raster overlay
    createRasterOverlay({
      id: RASTER_OVERLAY_ID,
      name: 'M45/1256 Geology',
      source: { type: 'url', url: '/data/raster/m45_1256_geology.png' },
      bounds: RASTER_BOUNDS,
      elevation: SURFACE_Z,
      opacity: 0.85,
    })
      .then((layer) => {
        scene.addRasterOverlay(layer);
        setRasterLoaded(true);
      })
      .catch((err) => {
        console.error('Raster overlay load failed:', err);
        setRasterError(err.message);
      });

    const handleResize = () => scene.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      scene.dispose();
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setControlMode(controlMode);
  }, [controlMode]);

  useEffect(() => {
    sceneRef.current?.setCameraFov(FOV_STEPS[perspectiveLevel]);
  }, [perspectiveLevel]);

  useEffect(() => {
    if (!rasterLoaded) return;
    sceneRef.current?.setRasterOverlayOpacity(RASTER_OVERLAY_ID, rasterOpacity);
  }, [rasterOpacity, rasterLoaded]);

  useEffect(() => {
    if (!rasterLoaded) return;
    sceneRef.current?.setRasterOverlayVisibility(RASTER_OVERLAY_ID, rasterVisible);
  }, [rasterVisible, rasterLoaded]);

  return (
    <div className="drillhole-container">
      <div className="drillhole-header">
        <h1>Raster Overlay Demo</h1>
        <div className="drillhole-controls">
          <label className="drillhole-color-control">
            <input
              type="checkbox"
              checked={rasterVisible}
              onChange={(e) => setRasterVisible(e.target.checked)}
            />
            Geology map
          </label>
          <label className="drillhole-color-control">
            Opacity
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={rasterOpacity}
              style={{ width: 90, cursor: 'pointer', accentColor: '#2563eb' }}
              onChange={(e) => setRasterOpacity(Number(e.target.value))}
            />
            {Math.round(rasterOpacity * 100)}%
          </label>
          <label className="drillhole-projection-slider">
            Ortho
            <input
              type="range"
              min={0}
              max={FOV_STEPS.length - 1}
              step={1}
              value={perspectiveLevel}
              onChange={(e) => setPerspectiveLevel(Number(e.target.value))}
            />
            Persp
          </label>
          <span className="drillhole-info">{DEMO_HOLES.length} synthetic drillholes</span>
          {rasterLoaded && <span className="drillhole-info">M45/1256 geology loaded</span>}
          {rasterError && <span className="drillhole-info error">{rasterError}</span>}
        </div>
      </div>

      <div className="canvas-container" ref={containerRef}>
        <Baselode3DControls
          controlMode={controlMode}
          onToggleFly={() => setControlMode((m) => (m === 'orbit' ? 'fly' : 'orbit'))}
          onRecenter={() => sceneRef.current?.recenterCameraToOrigin(2000)}
          onLookDown={() => sceneRef.current?.lookDown(3000)}
          onFit={() => sceneRef.current?.focusOnLastBounds(1.2)}
        />
        {selectedHole && (
          <div className="selection-popup">
            <div className="selection-header">Drillhole selected</div>
            <div className="selection-body">
              <div><strong>Hole ID:</strong> {selectedHole.holeId}</div>
              <div><strong>Project:</strong> {selectedHole.project || 'N/A'}</div>
            </div>
            <button className="ghost-button" type="button" onClick={() => setSelectedHole(null)}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
