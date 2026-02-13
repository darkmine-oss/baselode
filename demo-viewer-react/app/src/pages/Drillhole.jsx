/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Baselode3DScene,
  Baselode3DControls,
  loadAssayFile,
  loadCachedCollars,
  loadCachedSurvey,
  loadCachedDesurveyed,
  parseDrillholesCSV,
  saveCachedDesurveyed,
  saveCachedSurvey,
  parseSurveyCSV,
  desurveyTraces
} from 'baselode';
import 'baselode/style.css';
import proj4 from 'proj4';
import './Drillhole.css';
import { useDrillConfig } from '../context/DrillConfigContext.jsx';
import {
  loadDemoGswaAssayFile,
  loadDemoPrecomputedDesurveyFile,
  loadDemoSurveyCsvText
} from '../data/demoGswaData.js';

const ASSAY_COLOR_PALETTE_10 = [
  '#313695',
  '#4575b4',
  '#74add1',
  '#abd9e9',
  '#e0f3f8',
  '#fee090',
  '#fdae61',
  '#f46d43',
  '#d73027',
  '#a50026'
];
const MAX_SCENE_HOLES = 100;
const CAMERA_CACHE_KEY = 'baselode-drillhole-camera-v1';

function Drillhole() {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const renderedHolesRef = useRef(null);
  const restoredCameraRef = useRef(false);

  const [holes, setHoles] = useState(null);
  const [selectedHole, setSelectedHole] = useState(null);
  const [controlMode, setControlMode] = useState('orbit');
  const [collars, setCollars] = useState([]);
  const [error, setError] = useState('');
  const [desurveyMs, setDesurveyMs] = useState(null);
  const [desurveyCsvUrl, setDesurveyCsvUrl] = useState('');
  const [assayVariables, setAssayVariables] = useState([]);
  const [assayIntervalsByHole, setAssayIntervalsByHole] = useState({});
  const [colorByVariable, setColorByVariable] = useState('None');
  const [precomputedAttempted, setPrecomputedAttempted] = useState(false);
  const [usingPrecomputed, setUsingPrecomputed] = useState(false);
  const { config: drillConfig } = useDrillConfig();

  const selectedAssayIntervalsByHole = useMemo(() => {
    if (colorByVariable === 'None') return null;
    return mapIntervalsForVariable(assayIntervalsByHole, colorByVariable);
  }, [assayIntervalsByHole, colorByVariable]);

  const legendScale = useMemo(() => {
    if (!selectedAssayIntervalsByHole) return null;
    const values = Object.values(selectedAssayIntervalsByHole)
      .flatMap((intervals) => (intervals || []).map((interval) => Number(interval?.value)))
      .filter((value) => Number.isFinite(value));
    const scale = buildEqualRangeColorScale(values, ASSAY_COLOR_PALETTE_10);
    return scale?.bins?.length ? scale : null;
  }, [selectedAssayIntervalsByHole]);

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
      const limited = cachedHoles
        .filter((hole) => isFfCompanyHole(hole))
        .slice(0, MAX_SCENE_HOLES);
      setHoles(limited);
      setDesurveyCsvUrl(makeDesurveyCsvUrl(limited));
      setPrecomputedAttempted(true);
    }
  }, []);

  useEffect(() => {
    if (holes && holes.length) {
      setPrecomputedAttempted(true);
      return;
    }
    loadDemoPrecomputedDesurveyFile()
      .then((precomputedFile) => parseDrillholesCSV(precomputedFile))
      .then((parsed) => {
        const renderable = (parsed?.holes || []).filter((hole) => (hole.points || []).length >= 2);
        if (!renderable.length) return;
        const normalized = renderable.map((hole) => ({
          id: hole.id,
          companyHoleId: hole.points?.[0]?.company_hole_id || hole.points?.[0]?.companyholeid || hole.id,
          project: hole.points?.[0]?.project || '',
          points: (hole.points || []).map((point) => ({
            x: Number(point.x),
            y: Number(point.y),
            z: Number(point.z),
            md: Number(point.md)
          })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z))
        })).filter((hole) => (hole.points || []).length >= 2 && isFfCompanyHole(hole));
        if (!normalized.length) return;
        const limited = normalized.slice(0, MAX_SCENE_HOLES);
        setHoles(limited);
        saveCachedDesurveyed(limited);
        setDesurveyCsvUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return makeDesurveyCsvUrl(limited);
        });
        setUsingPrecomputed(true);
      })
      .catch((err) => {
        console.info('Precomputed desurvey load skipped:', err.message);
      })
      .finally(() => setPrecomputedAttempted(true));
  }, [holes]);

  useEffect(() => {
    return () => {
      if (desurveyCsvUrl) {
        URL.revokeObjectURL(desurveyCsvUrl);
      }
    };
  }, [desurveyCsvUrl]);

  useEffect(() => {
    loadDemoGswaAssayFile()
      .then((demoGswaAssayFile) => loadAssayFile(demoGswaAssayFile, '', drillConfig))
      .then((state) => {
        const numeric = (state?.numericProps || []).filter(Boolean);
        setAssayVariables(numeric);
        setAssayIntervalsByHole(buildAssayIntervalsByHole(state?.holes || []));
      })
      .catch((err) => {
        console.info('Auto-load of GSWA assays for 3D coloring skipped:', err.message);
      });
  }, [drillConfig]);

  // Auto-load canonical GSWA survey if no cached data
  useEffect(() => {
    if (!precomputedAttempted) return;
    if (usingPrecomputed) return;
    if (!collars.length) return;
    if (holes && holes.length >= MAX_SCENE_HOLES) return;
    const cachedSurvey = loadCachedSurvey();
    if (cachedSurvey.length) {
      processAndSetHoles(cachedSurvey);
      return;
    }

    loadDemoSurveyCsvText()
      .then((csvText) => parseSurveyCSV(csvText, drillConfig))
      .then((surveyRows) => {
        if (!surveyRows || !surveyRows.length) return;
        processAndSetHoles(surveyRows);
      })
      .catch((err) => {
        console.info('Auto-load of GSWA survey skipped:', err.message);
      });
  }, [holes, collars, drillConfig, precomputedAttempted, usingPrecomputed]);

  // Initialize shared 3D scene
  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new Baselode3DScene();
    let viewSaveInterval = null;
    scene.init(containerRef.current);
    scene.setDrillholeClickHandler((meta) => setSelectedHole(meta));
    scene.setControlMode(controlMode);
    if (typeof scene.setViewChangeHandler === 'function') {
      scene.setViewChangeHandler((viewState) => {
        saveCachedCameraView(viewState);
      });
    } else {
      viewSaveInterval = window.setInterval(() => {
        const viewState = getSceneViewState(scene);
        if (viewState) saveCachedCameraView(viewState);
      }, 300);
    }
    const cachedView = loadCachedCameraView();
    if (cachedView) {
      restoredCameraRef.current = setSceneViewState(scene, cachedView);
    }
    sceneRef.current = scene;

    const handleResize = () => scene.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      if (viewSaveInterval) window.clearInterval(viewSaveInterval);
      const viewState = getSceneViewState(scene);
      if (viewState) saveCachedCameraView(viewState);
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
      const preserveView = renderedHolesRef.current === holes || restoredCameraRef.current;
      sceneRef.current.setDrillholes(holes, {
        selectedAssayVariable: colorByVariable === 'None' ? '' : colorByVariable,
        assayIntervalsByHole: selectedAssayIntervalsByHole,
        preserveView
      });
      renderedHolesRef.current = holes;
      restoredCameraRef.current = false;
    }
  }, [holes, colorByVariable, selectedAssayIntervalsByHole]);

  const processAndSetHoles = (surveyRows) => {
    if (!collars.length) {
      setError('No cached collars found. Load collars on Home first.');
      return;
    }
    const start = performance.now();
    const desurveyed = desurveyTraces(collars, surveyRows, drillConfig);
    const elapsedMs = performance.now() - start;
    setDesurveyMs(elapsedMs);
    console.info('Desurvey profiling', {
      elapsedMs,
      collarCount: collars.length,
      surveyRowCount: surveyRows.length,
      desurveyedHoleCount: desurveyed.length
    });

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
      return {
        id: h.id,
        companyHoleId: h.collar?.companyHoleId || h.id,
        project: h.project,
        points: pts
      };
    });

    const shiftedHoles = linestrings.map((h) => ({
      id: h.id,
      companyHoleId: h.companyHoleId || h.id,
      project: h.project,
      points: h.points.map((p) => ({ x: p.offset.x, y: p.offset.y, z: p.z, md: p.md }))
    }));

    const filteredHoles = shiftedHoles.filter((h) => (h.points || []).length >= 2 && isFfCompanyHole(h));
    if (!filteredHoles.length) {
      setError('No renderable FF* company holes after projection.');
      return;
    }

    const limitedHoles = filteredHoles.slice(0, MAX_SCENE_HOLES);

    setHoles(limitedHoles);
    saveCachedDesurveyed(limitedHoles);
    setDesurveyCsvUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return makeDesurveyCsvUrl(limitedHoles);
    });
  };

  return (
    <div className="drillhole-container">
      <div className="drillhole-header">
        <h1>Drillhole Viewer</h1>
        <div className="drillhole-controls">
          <span className="drillhole-info">
            Data source: {usingPrecomputed ? 'demo_gswa_precomputed_desurveyed.csv' : 'demo_gswa_sample_survey.csv (fallback desurvey)'}
          </span>
          <label className="drillhole-color-control">
            Color by
            <select
              className="drillhole-select"
              value={colorByVariable}
              onChange={(e) => setColorByVariable(e.target.value)}
            >
              <option value="None">None</option>
              {assayVariables.map((variable) => (
                <option key={variable} value={variable}>{variable}</option>
              ))}
            </select>
          </label>
          {holes && (
            <span className="drillhole-info">
              {holes.length} drillholes loaded
            </span>
          )}
          {desurveyMs !== null && (
            <span className="drillhole-info">Desurveyed in {desurveyMs.toFixed(1)} ms</span>
          )}
          {desurveyCsvUrl && (
            <a
              className="ghost-button"
              href={desurveyCsvUrl}
              download="demo_gswa_desurveyed.csv"
            >
              Download desurveyed CSV
            </a>
          )}
          {error && <span className="drillhole-info error">{error}</span>}
          {colorByVariable !== 'None' && legendScale && (
            <div className="drillhole-legend" aria-label={`Color legend for ${colorByVariable}`}>
              <div className="drillhole-legend-title">Legend ({colorByVariable})</div>
              <div className="drillhole-legend-grid">
                {legendScale.bins.map((bin, index) => (
                  <div key={`${bin.index}-${index}`} className="drillhole-legend-item">
                    <span className="drillhole-legend-swatch" style={{ background: legendScale.colors[index] }} />
                    <span className="drillhole-legend-label">{formatLegendRange(bin.min, bin.max)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="canvas-container" ref={containerRef}>
        {!holes && (
          <div className="placeholder-message">
            <div className="icon">🔍</div>
            <p>Loading demo survey and cached collars...</p>
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
              <div><strong>Company Hole ID:</strong> {selectedHole.companyHoleId || selectedHole.holeId || 'N/A'}</div>
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

function makeDesurveyCsvUrl(holes) {
  const lines = ['hole_id,point_index,x,y,z'];
  (holes || []).forEach((hole) => {
    const hid = escapeCsv(hole.id || '');
    (hole.points || []).forEach((point, index) => {
      const x = Number.isFinite(point.x) ? point.x : '';
      const y = Number.isFinite(point.y) ? point.y : '';
      const z = Number.isFinite(point.z) ? point.z : '';
      lines.push(`${hid},${index},${x},${y},${z}`);
    });
  });
  const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
  return URL.createObjectURL(blob);
}

function escapeCsv(value) {
  const str = String(value ?? '');
  if (/[,"\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildAssayIntervalsByHole(assayHoles) {
  const byHole = {};
  (assayHoles || []).forEach((hole) => {
    const holeId = hole?.id;
    if (!holeId) return;
    const seen = new Set();
    const intervals = [];
    (hole.points || []).forEach((point) => {
      const from = Number(point?.from ?? point?.samp_from ?? point?.fromdepth ?? point?.from_depth ?? point?.depth_from);
      const to = Number(point?.to ?? point?.samp_to ?? point?.todepth ?? point?.to_depth ?? point?.depth_to);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
      const key = `${from}:${to}`;
      if (seen.has(key)) return;
      seen.add(key);
      intervals.push({ from, to, values: { ...point } });
    });
    if (intervals.length) {
      const sorted = intervals.sort((a, b) => a.from - b.from);
      const aliases = new Set([
        normalizeHoleKey(holeId),
        normalizeHoleKey(sorted[0]?.values?.hole_id),
        normalizeHoleKey(sorted[0]?.values?.holeid),
        normalizeHoleKey(sorted[0]?.values?.collarid),
        normalizeHoleKey(sorted[0]?.values?.collar_id),
        normalizeHoleKey(sorted[0]?.values?.companyholeid),
        normalizeHoleKey(sorted[0]?.values?.company_hole_id),
        normalizeHoleKey(sorted[0]?.values?.anumber),
        normalizeHoleKey(sorted[0]?.values?.id)
      ]);
      aliases.forEach((alias) => {
        if (!alias) return;
        byHole[alias] = sorted;
      });
    }
  });
  return byHole;
}

function mapIntervalsForVariable(intervalsByHole, variable) {
  if (!variable) return null;
  const mapped = {};
  Object.entries(intervalsByHole || {}).forEach(([holeId, intervals]) => {
    const normalizedHoleId = normalizeHoleKey(holeId);
    const entries = (intervals || []).map((interval) => ({
      from: interval.from,
      to: interval.to,
      value: Number(interval?.values?.[variable])
    })).filter((entry) => Number.isFinite(entry.value));
    if (entries.length) {
      mapped[normalizedHoleId] = entries;
    }
  });
  return mapped;
}

function formatLegendRange(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 'n/a';
  return `${formatLegendValue(min)} – ${formatLegendValue(max)}`;
}

function formatLegendValue(value) {
  if (!Number.isFinite(value)) return 'n/a';
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(3);
}

function buildEqualRangeColorScale(values = [], colors = ASSAY_COLOR_PALETTE_10) {
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
    count += 1;
  }

  if (!count) {
    return {
      min: null,
      max: null,
      step: null,
      bins: [],
      colors
    };
  }

  const binCount = colors.length;

  if (max === min) {
    const bins = colors.map((_, index) => ({
      index,
      min,
      max,
      label: `${min}`
    }));
    return {
      min,
      max,
      step: 0,
      bins,
      colors
    };
  }

  const step = (max - min) / binCount;
  const bins = colors.map((_, index) => {
    const lower = min + (step * index);
    const upper = index === binCount - 1 ? max : min + (step * (index + 1));
    return {
      index,
      min: lower,
      max: upper,
      label: `${lower.toFixed(3)} - ${upper.toFixed(3)}`
    };
  });

  return {
    min,
    max,
    step,
    bins,
    colors
  };
}

function normalizeHoleKey(value) {
  return `${value ?? ''}`.trim().toLowerCase();
}

function isFfCompanyHole(hole) {
  const candidate = `${hole?.companyHoleId || hole?.id || ''}`.trim().toUpperCase();
  return candidate.startsWith('FF');
}

function loadCachedCameraView() {
  try {
    const raw = localStorage.getItem(CAMERA_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    console.warn('Failed to load cached drillhole camera view', e);
    return null;
  }
}

function saveCachedCameraView(viewState) {
  try {
    localStorage.setItem(CAMERA_CACHE_KEY, JSON.stringify(viewState));
  } catch (e) {
    console.warn('Failed to cache drillhole camera view', e);
  }
}

function getSceneViewState(scene) {
  if (!scene) return null;
  if (typeof scene.getViewState === 'function') {
    return scene.getViewState();
  }
  const camera = scene.camera;
  const target = scene.controls?.target;
  if (!camera || !target) return null;
  return {
    camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: target.x, y: target.y, z: target.z },
    up: { x: camera.up.x, y: camera.up.y, z: camera.up.z }
  };
}

function setSceneViewState(scene, viewState) {
  if (!scene || !viewState) return false;
  if (typeof scene.setViewState === 'function') {
    return scene.setViewState(viewState);
  }
  const camera = scene.camera;
  const controls = scene.controls;
  if (!camera || !controls) return false;
  const cam = viewState.camera || {};
  const tgt = viewState.target || {};
  const up = viewState.up || {};
  const values = [cam.x, cam.y, cam.z, tgt.x, tgt.y, tgt.z, up.x, up.y, up.z];
  if (!values.every(Number.isFinite)) return false;
  camera.position.set(cam.x, cam.y, cam.z);
  controls.target.set(tgt.x, tgt.y, tgt.z);
  camera.up.set(up.x, up.y, up.z);
  camera.lookAt(tgt.x, tgt.y, tgt.z);
  controls.update();
  return true;
}
