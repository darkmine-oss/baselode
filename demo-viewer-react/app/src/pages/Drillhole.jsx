/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Baselode3DScene from '../lib/baselode3dScene.js';
import { loadCachedCollars, loadCachedDesurveyed, saveCachedDesurveyed, saveCachedSurvey, parseSurveyCSV, desurveyTraces } from '../lib/desurvey.js';
import proj4 from 'proj4';
import './Drillhole.css';
import Baselode3DControls from '../components/Baselode3DControls.jsx';
import { useDrillConfig } from '../context/DrillConfigContext.jsx';

function Drillhole() {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);

  const [holes, setHoles] = useState(null);
  const [selectedHole, setSelectedHole] = useState(null);
  const [controlMode, setControlMode] = useState('orbit');
  const [collars, setCollars] = useState([]);
  const [error, setError] = useState('');
  const { config: drillConfig } = useDrillConfig();

  const projectTo28350 = useMemo(() => {
    const def = '+proj=utm +zone=50 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
    proj4.defs('EPSG:28350', def);
    return (lat, lon) => {
      try {
        const [x, y] = proj4('EPSG:4326', 'EPSG:28350', [lon, lat]);
        return { x, y };
      } catch (e) {
        console.warn('Projection failed', e);
        return { x: 0, y: 0 };
      }
    };
  }, []);

  useEffect(() => {
    setCollars(loadCachedCollars());
    const cachedHoles = loadCachedDesurveyed();
    if (cachedHoles && cachedHoles.length) {
      setHoles(cachedHoles);
    }
  }, []);

  // Initialize shared 3D scene
  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new Baselode3DScene();
    scene.init(containerRef.current);
    scene.setDrillholeClickHandler((meta) => setSelectedHole(meta));
    scene.setControlMode(controlMode);
    sceneRef.current = scene;

    const handleResize = () => scene.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      scene.dispose();
    };
  }, []);

  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setControlMode(controlMode);
    }
  }, [controlMode]);

  useEffect(() => {
    if (sceneRef.current && holes && holes.length) {
      sceneRef.current.setDrillholes(holes);
    }
  }, [holes]);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setError('');

    parseSurveyCSV(file, drillConfig)
      .then((surveyRows) => {
        if (!collars.length) {
          throw new Error('No cached collars found. Load collars on Home first.');
        }
        const desurveyed = desurveyTraces(collars, surveyRows, drillConfig);
        if (!desurveyed.length) {
          throw new Error('No matching holes found between survey and cached collars.');
        }
        const renderable = desurveyed.filter((h) => (h.points || []).length >= 2);
        if (!renderable.length) {
          throw new Error('Desurveying produced no lines with 2+ points.');
        }
        saveCachedSurvey(surveyRows);
        const matchingIds = desurveyed.slice(0, 3).map((h) => h.id);
        const projectedCollars = collars.map((c) => ({
          id: c.holeId || c.hole_id || c.id,
          lat: c.lat,
          lng: c.lng,
          zone50: projectTo28350(c.lat, c.lng)
        }));

        const centroid = projectedCollars.reduce(
          (acc, c) => {
            acc.x += c.zone50.x;
            acc.y += c.zone50.y;
            return acc;
          },
          { x: 0, y: 0 }
        );
        centroid.x /= projectedCollars.length;
        centroid.y /= projectedCollars.length;

        const offsetCollars = projectedCollars.map((c) => ({
          ...c,
          offset: { x: c.zone50.x - centroid.x, y: c.zone50.y - centroid.y }
        }));

        const linestrings = desurveyed.map((h) => {
          const pts = h.points
            .map((p) => {
              const proj = projectTo28350(p.lat ?? 0, p.lng ?? 0);
              const offset = { x: proj.x - centroid.x, y: proj.y - centroid.y };
              if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y) || !Number.isFinite(p.z)) return null;
              return {
                ...p,
                zone50: proj,
                offset
              };
            })
            .filter(Boolean);
          return { id: h.id, project: h.project, points: pts };
        });

        const shiftedHoles = linestrings.map((h) => ({
          id: h.id,
          project: h.project,
          points: h.points.map((p) => ({ x: p.offset.x, y: p.offset.y, z: p.z }))
        }));

        const filteredHoles = shiftedHoles.filter((h) => (h.points || []).length >= 2);
        if (!filteredHoles.length) {
          throw new Error('No renderable drillholes after projection.');
        }

        const extent = filteredHoles.reduce(
          (acc, h) => {
            h.points.forEach((p) => {
              acc.minX = Math.min(acc.minX, p.x);
              acc.maxX = Math.max(acc.maxX, p.x);
              acc.minY = Math.min(acc.minY, p.y);
              acc.maxY = Math.max(acc.maxY, p.y);
              acc.minZ = Math.min(acc.minZ, p.z);
              acc.maxZ = Math.max(acc.maxZ, p.z);
            });
            acc.pointCounts.push(h.points.length);
            return acc;
          },
          {
            minX: Infinity,
            maxX: -Infinity,
            minY: Infinity,
            maxY: -Infinity,
            minZ: Infinity,
            maxZ: -Infinity,
            pointCounts: []
          }
        );

        const surveySample = surveyRows.slice(0, 5);

        console.info('Desurvey debug', {
          matchingHoleIds: matchingIds,
          collarsLatLon: projectedCollars.map((c) => ({ id: c.id, lat: c.lat, lng: c.lng })).slice(0, 5),
          collarsZone50: projectedCollars.slice(0, 5),
          collarsOffsetZone50: offsetCollars.slice(0, 5),
          surveySample,
          linestringsZone50Sample: linestrings.slice(0, 3),
          renderableHoles: filteredHoles.length,
          pointCounts: extent.pointCounts,
          extent: {
            minX: extent.minX,
            maxX: extent.maxX,
            minY: extent.minY,
            maxY: extent.maxY,
            minZ: extent.minZ,
            maxZ: extent.maxZ
          }
        });

        setHoles(filteredHoles);
        saveCachedDesurveyed(filteredHoles);
        if (sceneRef.current) {
          sceneRef.current.setDrillholes(filteredHoles);
        }
      })
      .catch((err) => {
        console.error('Error desurveying:', err);
        setError(err.message || 'Error processing survey file.');
      });
  };

  return (
    <div className="drillhole-container">
      <div className="drillhole-header">
        <h1>Drillhole Viewer</h1>
        <div className="drillhole-controls">
          <div className="file-input-wrapper">
            <label className="file-input-label">
              Upload Survey CSV
              <input type="file" accept=".csv" onChange={handleFileUpload} />
            </label>
          </div>

          {holes && (
            <span className="drillhole-info">
              {holes.length} drillholes loaded
            </span>
          )}
          {error && <span className="drillhole-info error">{error}</span>}
        </div>
      </div>

      <div className="canvas-container" ref={containerRef}>
        {!holes && (
          <div className="placeholder-message">
            <div className="icon">🔍</div>
            <p>Upload a CSV with columns: hole_id, x, y, z, order (optional)</p>
          </div>
        )}
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

export default Drillhole;

function collarsToHoles(collars) {
  if (!collars.length) return [];
  const def = '+proj=utm +zone=50 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
  proj4.defs('EPSG:28350', def);
  const project = (lat, lon) => {
    try {
      const [x, y] = proj4('EPSG:4326', 'EPSG:28350', [lon, lat]);
      return { x, y };
    } catch (e) {
      console.warn('Projection failed', e);
      return { x: 0, y: 0 };
    }
  };

  const projected = collars.map((c) => {
    const { x, y } = project(c.lat, c.lng);
    return { ...c, projX: x, projY: y };
  });

  const centroid = projected.reduce(
    (acc, c) => {
      acc.x += c.projX;
      acc.y += c.projY;
      return acc;
    },
    { x: 0, y: 0 }
  );
  centroid.x /= projected.length;
  centroid.y /= projected.length;

  return projected.map((c) => ({
    id: c.holeId || c.hole_id || c.id || 'unknown',
    points: [{ x: c.projX - centroid.x, y: c.projY - centroid.y, z: 0 }]
  }));
}
