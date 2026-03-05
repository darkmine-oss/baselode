/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import Plotly from 'plotly.js-dist-min';
import 'maplibre-gl/dist/maplibre-gl.css';
import './Home.css';
import { useZoomContext } from '../context/ZoomContext.jsx';
import { useDemoData } from '../context/DemoDataContext.jsx';
import {
  buildIntervalPoints,
  buildPlotConfig,
  getChartOptions,
  defaultChartType,
  HOLE_ID
} from 'baselode';


function Home() {
  const defaultPosition = useMemo(() => [-24.5, 122.0], []);
  const mapViewCacheKey = 'baselode-map-view-v1';
  const assayPreferenceKey = 'baselode-map-open-mode';
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchError, setSearchError] = useState('');
  const [filteredCollars, setFilteredCollars] = useState(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [popupHoleId, setPopupHoleId] = useState('');
  const [popupProperty, setPopupProperty] = useState('');
  const [popupChartType, setPopupChartType] = useState('line');
  const navigate = useNavigate();
  const { zoomLevel, setZoomLevel } = useZoomContext();
  const { collars, assayState } = useDemoData();
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const popupRef = useRef(null);
  const popupPlotRef = useRef(null);
  const handleHoleClickRef = useRef(null);
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

  useEffect(() => {
    try {
      const pref = localStorage.getItem(assayPreferenceKey);
      if (pref === 'page') {
        setOpenInPopup(false);
      }
    } catch (e) {
      console.warn('Failed to read map open preference', e);
    }
  }, [assayPreferenceKey]);


  const runSearch = (term, sourceCollars = collars) => {
    const query = term.trim().toLowerCase();
    if (!query) {
      setSearchError('');
      setFilteredCollars(null);
      return;
    }

    const matches = sourceCollars.filter((c) => (c.holeId || '').toLowerCase().includes(query));

    if (!matches.length) {
      setSearchError('No matching Hole ID');
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
    setPopupHoleId(holeId);
  };

  useEffect(() => {
    handleHoleClickRef.current = handleHoleClick;
  }, [handleHoleClick]);

  useEffect(() => {
    if (searchTerm) {
      runSearch(searchTerm, collars);
    }
  }, [collars, searchTerm]);

  const mapCenter = useMemo(() => {
    if (!collars.length) return defaultPosition;
    const [first] = collars;
    return [first.lat, first.lng];
  }, [collars, defaultPosition]);

  const renderedCollars = useMemo(() => filteredCollars || collars, [filteredCollars, collars]);

  const propertyOptions = useMemo(() => {
    if (!assayState) return [];
    return [...assayState.numericProps, ...assayState.categoricalProps];
  }, [assayState]);

  const popupHole = useMemo(() => {
    if (!popupHoleId || !assayState?.holes) return null;
    const searchId = `${popupHoleId}`.toLowerCase();
    return assayState.holes.find((h) => {
      const hId = h.id || h.holeId;
      return hId && `${hId}`.toLowerCase() === searchId;
    }) || null;
  }, [assayState, popupHoleId]);

  const geojsonData = useMemo(() => ({
    type: 'FeatureCollection',
    features: renderedCollars.map((c, idx) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
      properties: {
        id: idx,
        [HOLE_ID]: c.holeId || '',
        project: c.project || '',
        holeId: c.holeId || ''
      }
    }))
  }), [renderedCollars]);

  useEffect(() => {
    if (!popupHoleId || !assayState) return;
    const candidate = popupProperty || assayState.defaultProp || propertyOptions[0] || '';
    if (!popupProperty && candidate) {
      setPopupProperty(candidate);
      setPopupChartType(defaultChartType(assayState?.columnMeta?.byType?.[candidate]));
      return;
    }
    if (popupHole && candidate && !holeHasProperty(popupHole, candidate)) {
      const fallback = propertyOptions.find((p) => holeHasProperty(popupHole, p));
      if (fallback && fallback !== popupProperty) {
        setPopupProperty(fallback);
        setPopupChartType(defaultChartType(assayState?.columnMeta?.byType?.[fallback]));
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
    const { data, layout: baseLayout } = buildPlotConfig({
      points,
      isCategorical,
      property: popupProperty,
      chartType: popupChartType
    });
    const layout = { ...baseLayout, margin: { l: 38, r: 8, t: 8, b: 38, pad: 6 } };
    const config = {
      displayModeBar: true,
      responsive: true,
      useResizeHandler: true,
      modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d']
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
  }, [popupHoleId, popupHole, popupProperty, popupChartType, assayState]);

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
        const holeId = feature?.properties?.[HOLE_ID] || feature?.properties?.holeId;
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
        const holeIdValue = props[HOLE_ID] || props.holeId || '—';
        const html = `
          <div class="collar-tooltip">
            <div><strong>Hole ID:</strong> ${holeIdValue}</div>
            <div><strong>Project:</strong> ${props.project || '—'}</div>
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
          placeholder="Search Hole ID"
          value={searchTerm}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
      </form>
      {searchError && <div className="error-banner inline small">{searchError}</div>}

{error && <div className="error-banner small">{error}</div>}
    </div>
  );

  const dataSourceInfo = (
    <div className="data-source-text">
      {(collars.length > 0 || assayState?.holes?.length) && (
        <div>
          demo_gswa
          {collars.length > 0 && ` (${collars.length} collars`}
          {assayState?.holes?.length > 0 && `${collars.length > 0 ? ', ' : ' ('}${assayState.holes.length} assays`}
          {(collars.length > 0 || assayState?.holes?.length) && ')'}
        </div>
      )}
    </div>
  );

  const controlsTarget = typeof document !== 'undefined' ? document.getElementById('map-controls-slot') : null;
  const dataSourceTarget = typeof document !== 'undefined' ? document.getElementById('data-source-slot') : null;

  return (
    <div className="home-container">
      <div className="map-wrapper">
        <div ref={mapContainerRef} className="maplibre-container" />
      </div>
      {controlsTarget ? createPortal(controls, controlsTarget) : controls}
      {dataSourceTarget && createPortal(dataSourceInfo, dataSourceTarget)}
      {popupHoleId && (
        <div className="hole-popup-overlay" role="dialog" aria-modal="true">
          <div className="hole-popup-card">
            <div className="hole-popup-header">
              <div>
                <div className="hole-popup-title">Hole {popupHoleId}</div>
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
                  className="popup-close-btn"
                  onClick={() => setPopupHoleId('')}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>

            {popupHole ? (
              <div className="hole-popup-body">
                <div className="popup-row">
                  <label className="file-input-label inline">
                    Property
                    <select
                      className="popup-select"
                      value={popupProperty}
                      onChange={(e) => {
                        const p = e.target.value;
                        setPopupProperty(p);
                        setPopupChartType(defaultChartType(assayState?.columnMeta?.byType?.[p]));
                      }}
                    >
                      {propertyOptions.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {getChartOptions(assayState?.columnMeta?.byType?.[popupProperty]).length > 1 && (
                  <div className="popup-row">
                    <label className="file-input-label inline">
                      <select
                        className="popup-select"
                        value={popupChartType}
                        onChange={(e) => setPopupChartType(e.target.value)}
                      >
                        {getChartOptions(assayState?.columnMeta?.byType?.[popupProperty]).map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                <div ref={popupPlotRef} className="hole-popup-plot" />
              </div>
            ) : (
              <div className="hole-popup-placeholder">
                No assay data found for hole {popupHoleId}.
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
