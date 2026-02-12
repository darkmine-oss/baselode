/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Baselode3DScene,
  Baselode3DControls,
  loadCachedCollars,
  loadCachedDesurveyed,
  saveCachedDesurveyed,
  saveCachedSurvey,
  parseSurveyCSV,
  desurveyTraces
} from 'baselode';
import 'baselode/style.css';
import proj4 from 'proj4';
import './Drillhole.css';
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

  // Auto-load canonical GSWA survey if no cached data
  useEffect(() => {
    if (holes || !collars.length) return;
    fetch('/data/gswa/demo_gswa_sample_survey.csv')
      .then((res) => {
        if (!res.ok) return null;
        return res.text();
      })
      .then((csvText) => {
        if (!csvText) return;
        return parseSurveyCSV(csvText, drillConfig);
      })
      .then((surveyRows) => {
        if (!surveyRows || !surveyRows.length) return;
        processAndSetHoles(surveyRows);
      })
      .catch((err) => {
        console.info('Auto-load of GSWA survey skipped:', err.message);
      });
  }, [holes, collars]);

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

  const processAndSetHoles = (surveyRows) => {
    if (!collars.length) {
      setError('No cached collars found. Load collars on Home first.');
      return;
    }
    const desurveyed = desurveyTraces(collars, surveyRows, drillConfig);
    if (!desurveyed.length) {
      setError('No matching holes found between survey and cached collars.');
      return;
    }
    const renderable = desurveyed.filter((h) => (h.points || []).length >= 2);
    if (!renderable.length) {
      setError('Desurveying produced no lines with 2+ points.');
      return;
    }
    saveCachedSurvey(surveyRows);

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
      setError('No renderable drillholes after projection.');
      return;
    }

    setHoles(filteredHoles);
    saveCachedDesurveyed(filteredHoles);
    if (sceneRef.current) {
      sceneRef.current.setDrillholes(filteredHoles);
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setError('');

    parseSurveyCSV(file, drillConfig)
      .then((surveyRows) => {
        processAndSetHoles(surveyRows);
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
