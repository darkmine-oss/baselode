/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  BASE_PIXELS_PER_METRE,
  buildDepthMarkers,
  depthMarkerInterval,
  groupPhotosBySet,
  selectPhotoLodUrl,
  sortPhotosByDepth,
} from './corePhotoViz.js';
import './CorePhotoTable.css';

const BASE_ZOOM = 5;          // fixed layout zoom (no reflow on pan/zoom)
const ZOOM_FACTOR = 1.12;     // scale multiplier per wheel tick
const SCALE_MIN = 0.05;
const SCALE_MAX = 40;

/**
 * CorePhotoTable
 *
 * Renders a pannable/zoomable core photograph table with:
 *
 * - Depth-ordered images stacked from shallow → deep
 * - Multiple photo sets displayed side-by-side (one column per set)
 * - A depth ruler for spatial orientation
 * - Mouse-wheel zoom centred on cursor (Leaflet-style)
 * - Left-click drag to pan
 *
 * @param {Object} props
 * @param {Array<CorePhoto>} [props.photos=[]] - Photo entries to display.
 *   Each entry should have: ``hole_id`` (string), ``from_depth`` (number),
 *   ``to_depth`` (number), ``image_url`` (string), ``photo_set`` (string,
 *   optional), ``lod_urls`` (object, optional).
 * @param {string} [props.holeId=''] - Hole identifier shown in the control bar.
 * @param {number} [props.initialZoom=5] - Starting zoom level (1–10) for LOD.
 */
export function CorePhotoTable({
  photos = [],
  holeId = '',
  initialZoom = 5,
  transform: controlledTransform,
  onTransformChange,
}) {
  // ── Pan / zoom transform ────────────────────────────────────────────────
  // Supports both uncontrolled (internal state) and controlled modes.
  // Pass transform + onTransformChange to share state across multiple tables.
  const [internalTransform, setInternalTransform] = useState({ scale: 1, tx: 0, ty: 0 });
  const transform = controlledTransform ?? internalTransform;
  const transformRef = useRef(transform);
  transformRef.current = transform;

  // Always resolves functional updaters to a plain object before dispatching,
  // so onTransformChange is always called with a transform object, never a function.
  const setTransform = useCallback(
    (updater) => {
      const next = typeof updater === 'function' ? updater(transformRef.current) : updater;
      if (onTransformChange) {
        onTransformChange(next);
      } else {
        setInternalTransform(next);
      }
    },
    [onTransformChange],
  );

  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef(null);

  const viewportRef = useRef(null);

  // ── Derived layout values (fixed at BASE_ZOOM, no reflow on pan/zoom) ──

  const sorted = useMemo(() => sortPhotosByDepth(photos), [photos]);
  const grouped = useMemo(() => groupPhotosBySet(sorted), [sorted]);

  // Derive column order from the original (unsorted) photos so that callers
  // control left-to-right ordering by the sequence they pass photos in.
  const setNames = useMemo(() => {
    const seen = new Set();
    for (const p of photos) {
      const key = p.photo_set != null && p.photo_set !== '' ? String(p.photo_set) : 'default';
      seen.add(key);
    }
    return [...seen];
  }, [photos]);

  const { minDepth, maxDepth } = useMemo(() => {
    if (!sorted.length) return { minDepth: 0, maxDepth: 0 };
    const allTo = sorted.map((p) => p.to_depth ?? p.from_depth ?? 0);
    return {
      minDepth: sorted[0].from_depth ?? 0,
      maxDepth: Math.max(...allTo),
    };
  }, [sorted]);

  const pixelsPerMetre = (BASE_PIXELS_PER_METRE * BASE_ZOOM) / 5;

  const totalHeight = useMemo(
    () => Math.max(1, Math.round((maxDepth - minDepth) * pixelsPerMetre)),
    [minDepth, maxDepth, pixelsPerMetre],
  );

  const markers = useMemo(() => {
    const interval = depthMarkerInterval(BASE_ZOOM);
    return buildDepthMarkers(minDepth, maxDepth, interval);
  }, [minDepth, maxDepth]);

  const imageWidth = (540 * BASE_ZOOM) / 5; // fixed 540 px at base zoom

  // Effective LOD zoom derived from visual scale so thumbnails swap to full
  // resolution when the user zooms in close enough.
  const lodZoom = useMemo(
    () => Math.max(1, Math.min(10, Math.round(initialZoom * transform.scale))),
    [initialZoom, transform.scale],
  );

  // ── Wheel zoom (non-passive, centred on cursor) ─────────────────────────

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    const rect = viewportRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    setTransform((prev) => {
      const newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, prev.scale * factor));
      const ratio = newScale / prev.scale;
      return {
        scale: newScale,
        tx: cx - (cx - prev.tx) * ratio,
        ty: cy - (cy - prev.ty) * ratio,
      };
    });
  }, [setTransform]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // ── Left-drag pan ───────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragOrigin.current = {
      x: e.clientX,
      y: e.clientY,
      tx: transformRef.current.tx,
      ty: transformRef.current.ty,
    };
    setDragging(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!dragOrigin.current) return;
      // Snapshot ref values before entering the async updater — the ref may
      // be nulled by handleMouseUp before React executes the updater.
      const { tx, ty, x, y } = dragOrigin.current;
      setTransform((prev) => ({
        ...prev,
        tx: tx + (e.clientX - x),
        ty: ty + (e.clientY - y),
      }));
    };
    const handleMouseUp = () => {
      dragOrigin.current = null;
      setDragging(false);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [setTransform]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="core-photo-table">
      {/* Controls */}
      <div className="core-photo-controls">
        {holeId && <span className="core-photo-hole-id">{holeId}</span>}
        <span className="core-photo-zoom-label">
          {Math.round(transform.scale * 100)}%
        </span>
        <button
          className="core-photo-zoom-btn"
          onClick={() => setTransform({ scale: 1, tx: 0, ty: 0 })}
          aria-label="Reset view"
          title="Reset view"
        >
          ⌂
        </button>
      </div>

      {/* Column label strip */}
      {photos.length > 0 && (
        <div className="core-photo-col-headers">
          <div className="core-photo-ruler-spacer" />
          {setNames.map((name) => (
            <div
              key={name}
              className="core-photo-set-header"
              style={{ width: imageWidth }}
            >
              {name}
            </div>
          ))}
        </div>
      )}

      {/* Body */}
      {photos.length === 0 ? (
        <div className="core-photo-empty">No photos to display.</div>
      ) : (
        <div
          className={`core-photo-scroll${dragging ? ' is-dragging' : ''}`}
          ref={viewportRef}
          onMouseDown={handleMouseDown}
        >
          <div
            className="core-photo-inner"
            style={{
              height: totalHeight,
              transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
              transformOrigin: '0 0',
            }}
          >
            {/* Depth ruler */}
            <div
              className="core-photo-depth-ruler"
              style={{ height: totalHeight }}
            >
              {markers.map(({ depth, label }) => (
                <div
                  key={depth}
                  className="core-photo-depth-marker"
                  style={{
                    top: Math.round((depth - minDepth) * pixelsPerMetre),
                  }}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Photo set columns */}
            {setNames.map((setName) => (
              <div
                key={setName}
                className="core-photo-col-body"
                style={{ height: totalHeight, width: imageWidth }}
              >
                {grouped[setName].map((photo) => {
                  const fromDepth = photo.from_depth ?? 0;
                  const toDepth = photo.to_depth ?? fromDepth;
                  const top = Math.round(
                    (fromDepth - minDepth) * pixelsPerMetre,
                  );
                  const height = Math.max(
                    2,
                    Math.round((toDepth - fromDepth) * pixelsPerMetre),
                  );
                  const src = selectPhotoLodUrl(photo, lodZoom);

                  return (
                    <div
                      key={`${photo.hole_id ?? ''}-${fromDepth}-${toDepth}-${setName}`}
                      className="core-photo-item"
                      style={{ top, height, width: imageWidth }}
                      title={`${fromDepth}–${toDepth} m`}
                    >
                      {src ? (
                        <img
                          src={src}
                          alt={`Core ${fromDepth}–${toDepth} m`}
                          loading="lazy"
                        />
                      ) : (
                        <div className="core-photo-no-image" />
                      )}
                      {height >= 18 && (
                        <span className="core-photo-item-label">
                          {fromDepth}–{toDepth} m
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default CorePhotoTable;
