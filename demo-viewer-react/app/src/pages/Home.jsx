/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import Papa from 'papaparse';
import Plotly from 'plotly.js-dist-min';
import 'maplibre-gl/dist/maplibre-gl.css';
import './Home.css';
import { useZoomContext } from '../context/ZoomContext.jsx';
import { useDrillConfig } from '../context/DrillConfigContext.jsx';
import {
  clearAssayCache,
  loadAssayFile,
  loadCachedAssayMeta,
  loadCachedAssayState,
  saveAssayCache,
  buildIntervalPoints,
  buildPlotConfig,
  resolvePrimaryId
} from 'baselode';


function Home() {
  const defaultPosition = useMemo(() => [-24.5, 122.0], []);
  const mapViewCacheKey = 'baselode-map-view-v1';
  const assayPreferenceKey = 'baselode-map-open-mode';
  const [collars, setCollars] = useState([]);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchError, setSearchError] = useState('');
  const [filteredCollars, setFilteredCollars] = useState(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [openInPopup, setOpenInPopup] = useState(true);
  const [popupHoleId, setPopupHoleId] = useState('');
  const [popupProperty, setPopupProperty] = useState('');
  const [assayState, setAssayState] = useState(null);
  const [assayMeta, setAssayMeta] = useState(null);
  const [assayError, setAssayError] = useState('');
  const [assayLoading, setAssayLoading] = useState(false);
  const navigate = useNavigate();
  const { zoomLevel, setZoomLevel } = useZoomContext();
  const { config: drillConfig, primaryField } = useDrillConfig();

  const primaryLabel = useMemo(() => {
    if (drillConfig.primaryKey === 'holeId') return 'Hole ID';
    if (drillConfig.primaryKey === 'collarId') return 'Collar ID';
    if (drillConfig.primaryKey === 'anumber') return 'Anumber';
    if (drillConfig.primaryKey === 'custom') return drillConfig.customKey || 'Custom key';
    return 'Company Hole ID';
  }, [drillConfig]);

  const cacheKey = 'baselode-collars-cache-v1';
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const popupRef = useRef(null);
  const popupPlotRef = useRef(null);
  const handleHoleClickRef = useRef(null);
  const primaryLabelRef = useRef(primaryLabel);

  useEffect(() => {
    primaryLabelRef.current = primaryLabel;
  }, [primaryLabel]);
  const initialView = useMemo(() => {
    const fallback = {
      center: [defaultPosition[1], defaultPosition[0]],
      zoom: 5,
      fromStorage: false
    };

    if (typeof localStorage === 'undefined') return fallback;
    try {
      const raw = localStorage.getItem(mapViewCacheKey);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      const center = parsed?.center;
      const zoom = parsed?.zoom;
      const validCenter = Array.isArray(center) && center.length === 2 && center.every((n) => Number.isFinite(n));
      const validZoom = Number.isFinite(zoom);
      if (validCenter && validZoom) {
        return { center, zoom, fromStorage: true };
      }
    } catch (e) {
      console.warn('Failed to load map view from storage', e);
    }
    return fallback;
  }, [defaultPosition, mapViewCacheKey]);

  const hasCenteredRef = useRef(initialView.fromStorage);

  // Helper to parse collar CSV text (shared between file upload and auto-load)
  const parseCollarCSV = (csvText, sourceName) => {
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed = [];
        const detectedColumns = new Set();
        const totalRows = results.data.length;
        let skippedInvalidCoords = 0;
        let skippedMissingKey = 0;

        const pick = (normalized, keys) => {
          for (const key of keys) {
            if (normalized[key] !== undefined && normalized[key] !== null && `${normalized[key]}`.trim() !== '') {
              return normalized[key];
            }
          }
          return undefined;
        };

        results.data.forEach((row) => {
          const normalized = {};
          Object.entries(row).forEach(([key, value]) => {
            normalized[key.trim().toLowerCase()] = value;
            detectedColumns.add(key.trim().toLowerCase());
          });

          const lat = parseFloat(pick(normalized, ['latitude', 'lat']));
          const lng = parseFloat(pick(normalized, ['longitude', 'lon', 'lng']));
          const project = (pick(normalized, ['project_code', 'project', 'projectcode']) ?? '').toString().trim();
          const collarId = (pick(normalized, ['collarid', 'collar_id']) ?? '').toString().trim();
          const companyHoleId = (pick(normalized, ['companyholeid', 'company_hole_id']) ?? '').toString().trim();
          const holeId = (pick(normalized, [
            'hole_id',
            'holeid',
            'hole id'
          ]) ?? '').toString().trim();
          const primaryId = resolvePrimaryId(normalized, primaryField);

          const hasValidLatLng = Number.isFinite(lat) && Number.isFinite(lng);
          const latLngInRange = hasValidLatLng && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

          if (!primaryId) {
            skippedMissingKey += 1;
            return;
          }

          if (hasValidLatLng && latLngInRange && project && holeId) {
            parsed.push({ lat, lng, project, holeId, companyHoleId, collarId, primaryId });
          } else if (!latLngInRange || !hasValidLatLng) {
            skippedInvalidCoords += 1;
          }
        });

        if (!parsed.length) {
          setCollars([]);
          setError('No valid rows found. Ensure columns include latitude, longitude, project_code, and hole_id. Lat/Lon must be in degrees.');
          console.warn('Collar CSV parsed with zero valid rows.', {
            source: sourceName,
            totalRows,
            detectedColumns: Array.from(detectedColumns),
            skippedInvalidCoords
          });
          return;
        }

        console.info('Collar CSV loaded', {
          source: sourceName,
          totalRows,
          parsedRows: parsed.length,
          detectedColumns: Array.from(detectedColumns),
          skippedInvalidCoords,
          skippedMissingKey,
          sample: parsed.slice(0, 3)
        });
        setCollars(parsed);
        try {
          localStorage.setItem(cacheKey, JSON.stringify(parsed));
        } catch (e) {
          console.warn('Failed to cache collars', e);
        }
      },
      error: (err) => {
        setError(`Failed to read ${sourceName}: ${err.message}`);
        console.error('Collar CSV failed to parse', err);
      }
    });
  };

  // Load collars from cache on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        const valid = parsed.filter((p) =>
          Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.project && p.holeId
        );
        if (valid.length) {
          setCollars(valid);
          console.info('Loaded collars from cache', { cachedRows: valid.length });
        }
      }
    } catch (e) {
      console.warn('Failed to load collars cache', e);
    }
  }, [cacheKey]);

  // Auto-load canonical GSWA collars if cache is empty
  useEffect(() => {
    if (collars.length > 0) return;
    fetch('/data/gswa/demo_gswa_sample_collars.csv')
      .then((res) => {
        if (!res.ok) return null;
        return res.text();
      })
      .then((csvText) => {
        if (!csvText) return;
        parseCollarCSV(csvText, 'demo_gswa_sample_collars.csv (auto)');
      })
      .catch((err) => {
        console.info('Auto-load of GSWA collars skipped:', err.message);
      });
  }, [collars.length]);

  useEffect(() => {
    setCollars((prev) => prev.map((c) => {
      if (c.primaryId) return c;
      const normalized = {};
      Object.entries(c || {}).forEach(([key, value]) => {
        if (!key) return;
        normalized[key.toString().trim().toLowerCase()] = value;
      });
      const primaryId = resolvePrimaryId(normalized, primaryField);
      return primaryId ? { ...c, primaryId } : c;
    }));
  }, [primaryField]);

  useEffect(() => {
    try {
      const pref = localStorage.getItem(assayPreferenceKey);
      if (pref === 'page') {
        setOpenInPopup(false);
      }
    } catch (e) {
      console.warn('Failed to read map open preference', e);
    }

    const cachedState = loadCachedAssayState();
    if (cachedState) {
      setAssayState(cachedState);
      setPopupProperty((prev) => prev || cachedState.defaultProp || '');
    } else {
      const meta = loadCachedAssayMeta();
      if (meta) setAssayMeta(meta);
    }
  }, [assayPreferenceKey]);

  useEffect(() => {
    try {
      localStorage.setItem(assayPreferenceKey, openInPopup ? 'popup' : 'page');
    } catch (e) {
      console.warn('Failed to persist map open preference', e);
    }
  }, [assayPreferenceKey, openInPopup]);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError('');
    console.info('Starting collar CSV parse', { fileName: file.name, size: file.size });
    file.text().then((csvText) => parseCollarCSV(csvText, file.name));
  };

  const handleClearCache = () => {
    localStorage.removeItem(cacheKey);
    setCollars([]);
    setError('');
    setSearchError('');
    setSearchTerm('');
    setFilteredCollars(null);
    hasCenteredRef.current = false;
  };

  const handleAssayFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setAssayLoading(true);
    setAssayError('');
    loadAssayFile(file, '', drillConfig)
      .then((state) => {
        setAssayState(state);
        setAssayMeta({
          numericProps: state.numericProps,
          categoricalProps: state.categoricalProps,
          defaultProp: state.defaultProp,
          holeCount: state.holes.length,
          updatedAt: Date.now()
        });
        setPopupProperty((prev) => prev || state.defaultProp || '');
        saveAssayCache(state.holes, state, { fallbackToMetaOnly: true });
      })
      .catch((err) => {
        console.error('Assay load failed', err);
        setAssayError(err?.message || 'Failed to load assays CSV.');
      })
      .finally(() => setAssayLoading(false));
  };

  const handleClearAssays = () => {
    clearAssayCache();
    setAssayState(null);
    setAssayMeta(null);
    setPopupProperty('');
    setAssayError('');
  };

  const runSearch = (term, sourceCollars = collars) => {
    const query = term.trim().toLowerCase();
    if (!query) {
      setSearchError('');
      setFilteredCollars(null);
      return;
    }

    const matches = sourceCollars.filter((c) => (c.primaryId || '').toLowerCase().includes(query));

    if (!matches.length) {
      setSearchError(`No matching ${primaryLabel}`);
      setFilteredCollars(null);
      return;
    }

    setSearchError('');
    setFilteredCollars(matches);

    const target = matches[0];
    if (mapRef.current) {
      mapRef.current.flyTo({ center: [target.lng, target.lat], zoom: Math.max(zoomLevel || 5, 12) });
    }
  };

  const handleSearchChange = (value) => {
    setSearchTerm(value);
    runSearch(value);
  };

  const handleHoleClick = (holeId) => {
    if (!holeId) return;
    if (openInPopup) {
      setPopupHoleId(holeId);
      if (!assayState?.holes?.some((h) => (h.id || h.holeId) === holeId)) {
        setAssayError((prev) => prev || 'Load assays CSV to view this hole in the popup viewer.');
      }
    } else {
      navigate('/drillhole-2d', { state: { holeId } });
    }
  };

  useEffect(() => {
    handleHoleClickRef.current = handleHoleClick;
  }, [handleHoleClick]);

  useEffect(() => {
    if (searchTerm) {
      runSearch(searchTerm, collars);
    }
  }, [collars, primaryField]);

  const mapCenter = useMemo(() => {
    if (!collars.length) return defaultPosition;
    const [first] = collars;
    return [first.lat, first.lng];
  }, [collars, defaultPosition]);

  const renderedCollars = useMemo(() => filteredCollars || collars, [filteredCollars, collars]);

  const propertyOptions = useMemo(() => {
    if (assayState) {
      return [...assayState.numericProps, ...assayState.categoricalProps];
    }
    if (assayMeta) {
      return [...(assayMeta.numericProps || []), ...(assayMeta.categoricalProps || [])];
    }
    return [];
  }, [assayState, assayMeta]);

  const popupHole = useMemo(() => {
    if (!popupHoleId || !assayState?.holes) return null;
    return assayState.holes.find((h) => (h.id || h.holeId) === popupHoleId) || null;
  }, [assayState, popupHoleId]);

  useEffect(() => {
    if (!assayState) return;
    setAssayMeta({
      numericProps: assayState.numericProps || [],
      categoricalProps: assayState.categoricalProps || [],
      defaultProp: assayState.defaultProp || '',
      holeCount: assayState.holes?.length || 0,
      updatedAt: Date.now()
    });
  }, [assayState]);

  const geojsonData = useMemo(() => ({
    type: 'FeatureCollection',
    features: renderedCollars.map((c, idx) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
      properties: {
        id: idx,
        primaryId: c.primaryId || c.holeId || '',
        project: c.project || '',
        holeId: c.holeId || '',
        companyHoleId: c.companyHoleId || '',
        collarId: c.collarId || ''
      }
    }))
  }), [renderedCollars]);

  useEffect(() => {
    if (!popupHoleId || !assayState) return;
    const candidate = popupProperty || assayState.defaultProp || propertyOptions[0] || '';
    if (!popupProperty && candidate) {
      setPopupProperty(candidate);
      return;
    }
    if (popupHole && candidate && !holeHasProperty(popupHole, candidate)) {
      const fallback = propertyOptions.find((p) => holeHasProperty(popupHole, p));
      if (fallback && fallback !== popupProperty) {
        setPopupProperty(fallback);
      }
    }
  }, [assayState, popupHoleId, popupHole, popupProperty, propertyOptions]);

  useEffect(() => {
    if (!popupHoleId || !popupHole || !popupProperty) return;
    const target = popupPlotRef.current;
    if (!target) return;
    const isCategorical = assayState?.categoricalProps?.includes(popupProperty);
    const points = buildIntervalPoints(popupHole, popupProperty, isCategorical);
    if (!points.length) return;
    const { data, layout } = buildPlotConfig({
      points,
      isCategorical,
      property: popupProperty,
      chartType: isCategorical ? 'categorical' : 'line'
    });
    const config = {
      displayModeBar: true,
      responsive: true,
      useResizeHandler: true,
      modeBarButtonsToRemove: ['select2d', 'lasso2d']
    };
    try {
      Plotly.react(target, data, layout, config);
    } catch (err) {
      console.warn('Popup plot render failed', err);
    }

    return () => {
      try {
        Plotly.purge(target);
      } catch (err) {
        console.warn('Popup plot purge failed', err);
      }
    };
  }, [popupHoleId, popupHole, popupProperty, assayState]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors'
          }
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm'
          }
        ]
      },
      center: initialView.center,
      zoom: initialView.zoom
    });

    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), 'top-right');

    const persistView = () => {
      try {
        const center = map.getCenter();
        const nextZoom = map.getZoom();
        localStorage.setItem(
          mapViewCacheKey,
          JSON.stringify({ center: [center.lng, center.lat], zoom: nextZoom })
        );
      } catch (e) {
        console.warn('Failed to persist map view', e);
      }
    };

    map.on('zoomend', () => {
      const nextZoom = map.getZoom();
      if (nextZoom !== zoomLevel) {
        setZoomLevel(nextZoom);
      }
      persistView();
    });

    map.on('moveend', () => {
      persistView();
    });

    map.on('load', () => {
      popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 6 });

      map.resize();
      requestAnimationFrame(() => map.resize());

      const initialZoom = map.getZoom();
      if (initialZoom !== zoomLevel) {
        setZoomLevel(initialZoom);
      }

      map.addSource('collars', {
        type: 'geojson',
        data: geojsonData,
        cluster: true,
        clusterRadius: 60,
        clusterMaxZoom: 12
      });

      map.addLayer({
        id: 'collars-clusters',
        type: 'circle',
        source: 'collars',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#8b1e3f',
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            14,
            10, 16,
            25, 18
          ],
          'circle-opacity': 0.75
        }
      });

      map.addLayer({
        id: 'collars-cluster-count',
        type: 'symbol',
        source: 'collars',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-size': 12
        },
        paint: {
          'text-color': '#ffffff'
        }
      });

      map.addLayer({
        id: 'collars-unclustered',
        type: 'circle',
        source: 'collars',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': '#8b1e3f',
          'circle-radius': 4,
          'circle-opacity': 0.9
        }
      });

      map.on('click', 'collars-unclustered', (e) => {
        const feature = e.features && e.features[0];
        const holeId = feature?.properties?.primaryId || feature?.properties?.holeId;
        if (holeId) {
          handleHoleClickRef.current?.(holeId);
        }
      });

      map.on('mouseenter', 'collars-unclustered', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        const feature = e.features && e.features[0];
        if (!feature || !popupRef.current) return;
        const coords = feature.geometry.coordinates.slice();
        const props = feature.properties || {};
        const primaryValue = props.primaryId || props.companyHoleId || props.holeId || props.collarId || '—';
        const html = `
          <div class="collar-tooltip">
            <div><strong>${primaryLabelRef.current}:</strong> ${primaryValue}</div>
            <div><strong>Project:</strong> ${props.project || '—'}</div>
            <div><strong>Company Hole ID:</strong> ${props.companyHoleId || '—'}</div>
            <div><strong>Hole ID:</strong> ${props.holeId || '—'}</div>
            <div><strong>Collar ID:</strong> ${props.collarId || '—'}</div>
          </div>`;
        popupRef.current.setLngLat(coords).setHTML(html).addTo(map);
      });

      map.on('mouseleave', 'collars-unclustered', () => {
        map.getCanvas().style.cursor = '';
        popupRef.current?.remove();
      });

      map.on('click', 'collars-clusters', (e) => {
        const feature = e.features && e.features[0];
        const source = map.getSource('collars');
        if (!feature || !source || !source.getClusterExpansionZoom) return;
        source.getClusterExpansionZoom(feature.id, (err, zoom) => {
          if (err) return;
          map.easeTo({ center: feature.geometry.coordinates, zoom });
        });
      });

      setMapLoaded(true);
    });

    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [initialView.center, initialView.zoom, mapViewCacheKey, navigate, setZoomLevel]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const source = mapRef.current.getSource('collars');
    if (source) {
      source.setData(geojsonData);
    }
  }, [geojsonData, mapLoaded]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    if (!collars.length) {
      hasCenteredRef.current = false;
      return;
    }
    if (hasCenteredRef.current) return;
    mapRef.current.flyTo({ center: [mapCenter[1], mapCenter[0]], zoom: Math.max(zoomLevel || 5, 5) });
    hasCenteredRef.current = true;
  }, [mapLoaded, collars.length, mapCenter, zoomLevel]);

  const controls = (
    <div className="map-controls compact">
      <div className="controls-title">Map Controls</div>
      <form onSubmit={(e) => e.preventDefault()} className="search-form">
        <input
          className="search-input"
          type="text"
          placeholder={`Search ${primaryLabel}`}
          value={searchTerm}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
      </form>
      {searchError && <div className="error-banner inline small">{searchError}</div>}
      <div className="status-banner small">
        Primary key: <strong>{primaryLabel}</strong> — <Link to="/config">edit in Config</Link>
      </div>

      <label className="file-input small">
        <span>Load collars CSV</span>
        <input type="file" accept=".csv" onChange={handleFileChange} />
      </label>
      <button className="ghost-button small" type="button" onClick={handleClearCache}>
        Clear cached collars
      </button>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={openInPopup}
          onChange={(e) => setOpenInPopup(e.target.checked)}
        />
        <span>Open hole in popup viewer</span>
      </label>

      <label className="file-input small">
        <span>{assayLoading ? 'Loading assays...' : 'Load assays CSV (for popup)'}</span>
        <input type="file" accept=".csv" onChange={handleAssayFileChange} />
      </label>
      <button className="ghost-button small" type="button" onClick={handleClearAssays}>
        Clear cached assays
      </button>
      {assayError && <div className="error-banner small">{assayError}</div>}
      {!assayError && (assayState || assayMeta) && (
        <div className="status-banner small">
          Assays cached for {assayState?.holes?.length || assayMeta?.holeCount || 0} holes
        </div>
      )}
      {error && <div className="error-banner small">{error}</div>}
      {!error && collars.length > 0 && (
        <div className="status-banner small">Loaded {collars.length} collars</div>
      )}
    </div>
  );

  const controlsTarget = typeof document !== 'undefined' ? document.getElementById('map-controls-slot') : null;

  return (
    <div className="home-container">
      <div className="map-wrapper">
        <div ref={mapContainerRef} className="maplibre-container" />
      </div>
      {controlsTarget ? createPortal(controls, controlsTarget) : controls}
      {popupHoleId && (
        <div className="hole-popup-overlay" role="dialog" aria-modal="true">
          <div className="hole-popup-card">
            <div className="hole-popup-header">
              <div>
                <div className="hole-popup-title">Hole {popupHoleId}</div>
                <div className="hole-popup-subtitle">2D assay preview</div>
              </div>
              <div className="hole-popup-actions">
                <button
                  type="button"
                  className="ghost-button small"
                  onClick={() => navigate('/drillhole-2d', { state: { holeId: popupHoleId } })}
                >
                  Open page
                </button>
                <button
                  type="button"
                  className="ghost-button small"
                  onClick={() => setPopupHoleId('')}
                >
                  Close
                </button>
              </div>
            </div>

            {assayError && <div className="error-banner small">{assayError}</div>}

            {popupHole ? (
              <div className="hole-popup-body">
                <div className="popup-row">
                  <label className="file-input-label inline">
                    Property
                    <select
                      className="popup-select"
                      value={popupProperty}
                      onChange={(e) => setPopupProperty(e.target.value)}
                    >
                      {propertyOptions.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                  <span className="popup-meta">{assayState?.holes?.length || 0} holes cached</span>
                </div>
                <div ref={popupPlotRef} className="hole-popup-plot" />
              </div>
            ) : (
              <div className="hole-popup-placeholder">
                Load assays CSV to view this hole in the popup viewer.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
export default Home;

function holeHasProperty(hole, property) {
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
