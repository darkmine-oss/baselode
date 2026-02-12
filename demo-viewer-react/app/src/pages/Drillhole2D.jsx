/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Plotly from 'plotly.js-dist-min';
import {
  deriveAssayProps,
  loadAssayHole,
  loadAssayMetadata,
  loadCachedAssayState,
  reorderHoleIds,
  saveAssayCache
} from '../lib/assayDataLoader.js';
import { buildIntervalPoints, buildPlotConfig } from '../lib/drillholeViz.js';
import './Drillhole2D.css';
import { useDrillConfig } from '../context/DrillConfigContext.jsx';

function Drillhole2D() {
  const location = useLocation();
  const [holes, setHoles] = useState([]);
  const [holeIds, setHoleIds] = useState([]); // [{ holeId, collarId, companyHoleId }]
  const [numericProps, setNumericProps] = useState([]);
  const [categoricalProps, setCategoricalProps] = useState([]);
  const [defaultProp, setDefaultProp] = useState('');
  const [traceConfigs, setTraceConfigs] = useState([]); // { holeId, property, chartType }
  const [error, setError] = useState('');
  const [focusedHoleId, setFocusedHoleId] = useState(() => location.state?.holeId || '');
  const [fileRef, setFileRef] = useState(null);
  const [loadingHoles, setLoadingHoles] = useState([]);
  const fileInputRef = useRef(null);
  const { config: drillConfig } = useDrillConfig();
  const applyAssayState = (state) => {
    if (!state) return;
    setError('');
    setHoles(state.holes || []);
    setHoleIds((state.holes || []).map((h) => ({
      holeId: h.id || h.holeId || h.primaryId,
      primaryId: h.id || h.holeId || h.primaryId,
      collarId: h.collarId,
      companyHoleId: h.companyHoleId
    })).filter((h) => h.holeId));
    setNumericProps(state.numericProps || []);
    setCategoricalProps(state.categoricalProps || []);
    setDefaultProp(state.defaultProp || '');
    setTraceConfigs(state.traceConfigs || []);
  };

  useEffect(() => {
    const cachedState = loadCachedAssayState(focusedHoleId);
    if (cachedState) {
      applyAssayState(cachedState);
    }
  }, [focusedHoleId]);

  useEffect(() => {
    const holeIdFromNav = location.state?.holeId;
    if (holeIdFromNav) {
      setFocusedHoleId(holeIdFromNav);
      if (!holes.length) {
        setError((prev) => prev || `Load assays CSV to view hole ${holeIdFromNav}.`);
      }
    }
  }, [location.state, holes.length]);

  useEffect(() => {
    setError((prev) => (prev && prev.startsWith('Load assays CSV') ? prev : ''));
  }, [traceConfigs]);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setFileRef(file);
    setError('');
    setHoles([]);
    setHoleIds([]);
    setNumericProps([]);
    setCategoricalProps([]);
    setDefaultProp('');
    setTraceConfigs([]);

    loadAssayMetadata(file, drillConfig)
      .then((ids) => {
        const uniqueIds = Array.from(new Map(ids.map((h) => [h.holeId, h])).values());
        setHoleIds(uniqueIds);
        const ordered = reorderHoleIds(uniqueIds.map((h) => h.holeId), focusedHoleId);
        setTraceConfigs(Array.from({ length: 4 }).map((_, idx) => ({
          holeId: ordered[idx] || uniqueIds[idx]?.holeId || '',
          property: '',
          chartType: 'markers+line'
        })));
      })
      .catch((err) => {
        console.error(err);
        setError(err.message || 'Error processing assay file.');
      });
  };

  useEffect(() => {
    if (!holeIds.length) {
      setTraceConfigs([]);
      return;
    }
    const orderedHoleIds = reorderHoleIds(holeIds.map((h) => h.holeId), focusedHoleId);
    setTraceConfigs((prev) => {
      const next = Array.from({ length: 4 }).map((_, idx) => {
        const existing = prev[idx] || {};
        const holeId = holeIds.some((h) => h.holeId === existing.holeId) ? existing.holeId : orderedHoleIds[idx] || holeIds[idx]?.holeId || '';
        const property = existing.property || defaultProp;
        const chartType = existing.chartType || (property && categoricalProps.includes(property) ? 'categorical' : 'markers+line');
        return { holeId, property, chartType };
      });
      return next;
    });
  }, [holeIds, focusedHoleId, defaultProp, categoricalProps]);

  // Lazy-load holes only when selected in trace configs.
  useEffect(() => {
    if (!fileRef) return;
    const needed = traceConfigs.map((c) => c.holeId).filter(Boolean);
    needed.forEach((hid) => {
      const already = holes.some((h) => (h.id || h.holeId) === hid);
      const loading = loadingHoles.includes(hid);
      if (already || loading) return;
      setLoadingHoles((prev) => [...prev, hid]);
      loadAssayHole(fileRef, hid, drillConfig)
        .then((hole) => {
          setLoadingHoles((prev) => prev.filter((id) => id !== hid));
          if (!hole) return;
          setHoles((prev) => {
            const next = [...prev.filter((h) => (h.id || h.holeId) !== hid), hole];
            const props = deriveAssayProps(next);
            setNumericProps(props.numericProps);
            setCategoricalProps(props.categoricalProps);
            if (!defaultProp && props.defaultProp) {
              setDefaultProp(props.defaultProp);
              setTraceConfigs((cfgs) => cfgs.map((cfg) => ({
                ...cfg,
                property: cfg.property || props.defaultProp,
                chartType: props.categoricalProps.includes(props.defaultProp) ? 'categorical' : cfg.chartType || 'markers+line'
              })));
            }
            const cached = saveAssayCache(next, {
              holes: next,
              numericProps: props.numericProps,
              categoricalProps: props.categoricalProps,
              defaultProp: props.defaultProp
            }, { fallbackToMetaOnly: true });
            if (!cached) {
              console.info('Proceeding without cached assays (quota exceeded).');
            }
            return next;
          });
        })
        .catch((err) => {
          console.error(err);
          setLoadingHoles((prev) => prev.filter((id) => id !== hid));
          setError(err.message || `Error loading hole ${hid}`);
        });
    });
  }, [traceConfigs, fileRef, holes, loadingHoles, defaultProp, drillConfig]);

  const propertyOptions = useMemo(() => [...numericProps, ...categoricalProps], [numericProps, categoricalProps]);

  const labelForHole = (hid) => {
    const meta = holeIds.find((h) => h.holeId === hid);
    if (!meta) return hid;
    if (meta.primaryId) return meta.primaryId;
    if (drillConfig.primaryKey === 'collarId' && meta.collarId) return meta.collarId;
    if (drillConfig.primaryKey === 'companyHoleId' && meta.companyHoleId) return meta.companyHoleId;
    if (drillConfig.primaryKey === 'holeId' && meta.holeId) return meta.holeId;
    return meta.holeId || meta.companyHoleId || meta.collarId || hid;
  };

  const labeledHoleOptions = useMemo(
    () => holeIds.map((h) => ({ holeId: h.holeId, label: labelForHole(h.holeId) })),
    [holeIds, drillConfig.primaryKey]
  );

  const traceGraphs = useMemo(() => {
    return Array.from({ length: 4 }).map((_, idx) => {
      const cfg = traceConfigs[idx] || {};
      const hole = holes.find((h) => (h.id || h.holeId) === cfg.holeId) || null;
      let property = cfg.property || defaultProp;
      if (hole && (!property || !holeHasData(hole, property))) {
        const fallback = [...numericProps, ...categoricalProps].find((p) => holeHasData(hole, p));
        if (fallback) property = fallback;
      }
      const chartType = cfg.chartType || (property && categoricalProps.includes(property) ? 'categorical' : 'markers+line');
      const holeId = cfg.holeId || hole?.id || hole?.holeId || '';
      const isCategorical = categoricalProps.includes(property);
      const points = buildIntervalPoints(hole, property, isCategorical);
      return {
        config: { holeId, property, chartType },
        hole,
        loading: loadingHoles.includes(cfg.holeId),
        isCategorical,
        points,
        label: labelForHole(holeId)
      };
    });
  }, [traceConfigs, holes, defaultProp, categoricalProps, loadingHoles, holeIds, drillConfig.primaryKey]);

  const handleConfigChange = (idx, patch) => {
    setTraceConfigs((prev) => {
      const next = [...prev];
      const base = next[idx] || {};
      const merged = { ...base, ...patch };
      if (patch.property) {
        const isCat = categoricalProps.includes(patch.property);
        if (isCat && merged.chartType !== 'categorical') {
          merged.chartType = 'categorical';
        }
        if (!isCat && merged.chartType === 'categorical') {
          merged.chartType = 'markers+line';
        }
      }
      next[idx] = merged;
      return next;
    });
  };

  return (
    <div className="drillhole2d-container">
      <div className="drillhole2d-header">
        <h1>Drillhole 2D Traces</h1>
        <div className="drillhole2d-controls">
          <div className="file-input-wrapper">
            <label className="file-input-label">
              Upload Assays CSV
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
              />
            </label>
          </div>

          {holeIds.length > 0 && (
            <span className="drillhole-info">{holeIds.length} collars with assays</span>
          )}

          {error && <span className="error-text">{error}</span>}
        </div>
      </div>

      <div className="plots-grid">
        {Array.from({ length: 4 }).map((_, idx) => (
          <TracePlot
            key={idx}
            config={traceGraphs[idx]?.config || { holeId: '', property: '', chartType: 'markers+line' }}
            graph={traceGraphs[idx]}
            holeOptions={labeledHoleOptions}
            propertyOptions={propertyOptions}
            numericProps={numericProps}
            categoricalProps={categoricalProps}
            onConfigChange={(patch) => handleConfigChange(idx, patch)}
          />
        ))}
      </div>
    </div>
  );
}

function holeHasData(hole, property) {
  if (!hole || !property) return false;
  const pts = hole.points || [];
  for (let i = 0; i < pts.length; i += 1) {
    const v = pts[i]?.[property];
    if (v === undefined || v === null) continue;
    if (typeof v === 'number' && Number.isFinite(v)) return true;
    if (typeof v === 'string' && v.trim() !== '') return true;
  }
  return false;
}

function TracePlot({ config, graph, holeOptions = [], propertyOptions = [], numericProps = [], categoricalProps = [], onConfigChange }) {
  const containerRef = useRef(null);
  const hole = graph?.hole;
  const points = graph?.points || [];
  const property = config?.property || '';
  const chartType = config?.chartType || 'markers+line';
  const selectedHoleId = config?.holeId || '';
  const isCategorical = graph?.isCategorical || false;

  const chartOptions = isCategorical
    ? [{ value: 'categorical', label: 'Categorical bands' }]
    : [
        { value: 'bar', label: 'Bars' },
        { value: 'markers', label: 'Markers' },
        { value: 'markers+line', label: 'Markers + Line' },
        { value: 'line', label: 'Line only' }
      ];

  const effectiveChartType = chartOptions.some((opt) => opt.value === chartType)
    ? chartType
    : chartOptions[0]?.value || 'markers+line';

  const [renderError, setRenderError] = useState('');

  useEffect(() => {
    if (!hole || !property || points.length === 0) return;
    const target = containerRef.current;
    if (!target) return;
    const { data, layout } = buildPlotConfig({ points, isCategorical, property, chartType: effectiveChartType });
    if (!data || data.length === 0) return;
    const config = {
      displayModeBar: true,
      responsive: true,
      useResizeHandler: true,
      modeBarButtonsToRemove: ['select2d', 'lasso2d', 'zoom2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d']
    };
    try {
      setRenderError('');
      Plotly.react(target, data, layout, config);
      // Nudge Plotly to measure after layout for initial load.
      requestAnimationFrame(() => {
        if (target && target.parentElement) {
          Plotly.Plots.resize(target);
        }
      });
    } catch (err) {
      console.error('Plot render error', err);
      setRenderError(err?.message || 'Plot render error');
    }

    return () => {
      if (target) {
        try {
          Plotly.purge(target);
        } catch (err) {
          console.warn('Plot purge error', err);
        }
      }
    };
  }, [hole, property, effectiveChartType, isCategorical, points]);

  useEffect(() => {
    const target = containerRef.current;
    if (!target || typeof ResizeObserver === 'undefined') return undefined;
    const resizeObserver = new ResizeObserver(() => {
      try {
        if (target && target.data) {
          Plotly.Plots.resize(target);
        }
      } catch (err) {
        console.warn('Plot resize error', err);
      }
    });
    resizeObserver.observe(target);
    return () => resizeObserver.disconnect();
  }, []);

  if (!hole || !property) {
    return (
      <div className="plot-card empty">
        <div className="placeholder">{config?.holeId ? (graph?.loading ? `Loading ${config.holeId}...` : 'Select a property') : 'Upload data to see a trace'}</div>
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="plot-card empty">
        <div className="placeholder">No numeric data for {property}</div>
      </div>
    );
  }

  if (renderError) {
    return (
      <div className="plot-card empty">
        <div className="placeholder">Plot error: {renderError}</div>
      </div>
    );
  }

  return (
    <div className="plot-card">
      <div className="plot-title">
        <select
          className="plot-select"
          value={selectedHoleId}
          onChange={(e) => onConfigChange && onConfigChange({ holeId: e.target.value })}
        >
          {holeOptions.map((h) => {
            const hid = typeof h === 'string' ? h : h.holeId;
            const label = typeof h === 'string' ? h : h.label || h.holeId;
            return (
              <option key={hid} value={hid}>{label}</option>
            );
          })}
        </select>
      </div>
      <div className="plot-controls column">
        {propertyOptions.length > 0 && (
          <select
            className="plot-select"
            value={property}
            onChange={(e) => onConfigChange && onConfigChange({ property: e.target.value })}
          >
            {propertyOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}
        <select
          className="plot-select"
          value={chartType}
          onChange={(e) => onConfigChange && onConfigChange({ chartType: e.target.value })}
        >
          {chartOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div className="plotly-chart" ref={containerRef} />
    </div>
  );
}

export default Drillhole2D;
