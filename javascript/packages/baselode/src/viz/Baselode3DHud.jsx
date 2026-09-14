/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useState } from 'react';
import './Baselode3DHud.css';
import { formatMetres, niceNumber } from './sceneAnchors.js';

const KEY_HELP = [
  ['1 · 3 · 7', 'Look north · east · down (Ctrl inverts)'],
  ['5', 'Perspective / orthographic'],
  ['F', 'Frame selected hole'],
  ['Home', 'Frame everything'],
  ['.', 'Pivot on selected hole'],
  ['[ · ]', 'Step section or slab'],
  ['G', 'Ground grid and extent box'],
  ['L', 'Hole labels'],
  ['Esc', 'Clear selection / exit mode'],
  ['Dbl-click', 'Focus on point (empty space frames all)'],
  ['Right-drag', 'Orbit around what you grab'],
  ['Walk mode', 'W A S D move · Q E down / up · Shift sprint · wheel speed'],
];

function fmtCoord(v) {
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function useHudState(scene, hz = 10) {
  const [state, setState] = useState(null);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    if (!scene) return undefined;
    let frame = 0;
    let last = 0;
    const interval = 1000 / hz;
    const tick = (t) => {
      frame = requestAnimationFrame(tick);
      if (t - last < interval) return;
      last = t;
      const next = typeof scene.getHudState === 'function' ? scene.getHudState() : null;
      if (next) setState(next);
      const h = typeof scene.getHover === 'function' ? scene.getHover() : null;
      setHover(h);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [scene, hz]);
  return { state, hover };
}

function ScaleBar({ unitsPerPixel }) {
  if (!(unitsPerPixel > 0)) return null;
  const targetPx = 120;
  const nice = niceNumber(targetPx * unitsPerPixel);
  const px = Math.max(24, Math.min(220, nice / unitsPerPixel));
  return (
    <div className="baselode-hud-scale" aria-label={`Scale bar: ${formatMetres(nice)}`}>
      <div className="baselode-hud-scale-bar" style={{ width: `${px}px` }} />
      <span>{formatMetres(nice)}</span>
    </div>
  );
}

function Compass({ azimuthDeg, pitchDeg }) {
  const rotation = -(azimuthDeg || 0);
  return (
    <div className="baselode-hud-compass" title={`Heading ${Math.round(azimuthDeg)}° · pitch ${Math.round(pitchDeg)}°`}>
      <svg viewBox="0 0 48 48" width="48" height="48" role="img" aria-label={`North arrow, heading ${Math.round(azimuthDeg)} degrees`}>
        <circle cx="24" cy="24" r="22" className="baselode-hud-compass-ring" />
        <g style={{ transform: `rotate(${rotation}deg)`, transformOrigin: '24px 24px' }}>
          <path d="M24 5 L30 26 L24 22 L18 26 Z" className="baselode-hud-compass-north" />
          <path d="M24 43 L18 22 L24 26 L30 22 Z" className="baselode-hud-compass-south" />
          <text x="24" y="15" className="baselode-hud-compass-label">N</text>
        </g>
      </svg>
      <div className="baselode-hud-compass-readout">{Math.round(azimuthDeg)}°</div>
    </div>
  );
}

function MiniMap({ state, paths, collars, onClick }) {
  const bounds = state?.bounds;
  const geometry = useMemo(() => {
    if (!bounds) return null;
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    if (!(w > 0) || !(h > 0)) return null;
    const size = 128;
    const pad = 10;
    const scale = Math.min((size - pad * 2) / w, (size - pad * 2) / h);
    const ox = pad + ((size - pad * 2) - w * scale) / 2;
    const oy = pad + ((size - pad * 2) - h * scale) / 2;
    const toX = (x) => ox + (x - bounds.minX) * scale;
    const toY = (y) => size - (oy + (y - bounds.minY) * scale);
    const fromXY = (px, py) => ({ x: bounds.minX + (px - ox) / scale, y: bounds.minY + ((size - py) - oy) / scale });
    return { size, toX, toY, fromXY, scale, w, h };
  }, [bounds]);
  if (!geometry || !state) return null;
  const { size, toX, toY, fromXY } = geometry;
  const clamp = (v) => Math.max(-size, Math.min(size * 2, v));
  const footprint = (state.footprint || []).filter(Boolean);
  const camX = clamp(toX(state.camera.x));
  const camY = clamp(toY(state.camera.y));
  const az = ((state.azimuthDeg || 0) * Math.PI) / 180;
  const headingLen = 14;
  const handleClick = (e) => {
    if (!onClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * size;
    const py = ((e.clientY - rect.top) / rect.height) * size;
    onClick(fromXY(px, py));
  };
  return (
    <div className="baselode-hud-minimap" aria-label="Plan view mini-map">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Plan view of the scene extent and camera" onClick={handleClick}>
        <rect x={toX(bounds.minX)} y={toY(bounds.maxY)} width={(bounds.maxX - bounds.minX) * geometry.scale} height={(bounds.maxY - bounds.minY) * geometry.scale} className="baselode-hud-minimap-bounds" />
        {footprint.length >= 3 && (
          <polygon points={footprint.map((p) => `${clamp(toX(p.x))},${clamp(toY(p.y))}`).join(' ')} className="baselode-hud-minimap-footprint" />
        )}
        {(paths || []).map((path, i) => {
          const pts = path.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => `${toX(p.x)},${toY(p.y)}`).join(' ');
          return pts ? <polyline key={i} points={pts} className="baselode-hud-minimap-trace" /> : null;
        })}
        {(collars || []).map((c, i) => (
          <circle key={i} cx={toX(c.x)} cy={toY(c.y)} r="1.4" className="baselode-hud-minimap-collar" />
        ))}
        <g className="baselode-hud-minimap-target" transform={`translate(${clamp(toX(state.target.x))} ${clamp(toY(state.target.y))})`}>
          <line x1="-4" x2="4" y1="0" y2="0" /><line x1="0" x2="0" y1="-4" y2="4" />
        </g>
        <line x1={camX} y1={camY} x2={camX + Math.sin(az) * headingLen} y2={camY - Math.cos(az) * headingLen} className="baselode-hud-minimap-heading" />
        <circle cx={camX} cy={camY} r="3" className="baselode-hud-minimap-camera" />
      </svg>
      <span className="baselode-hud-minimap-caption">Plan · N up · click to move pivot</span>
    </div>
  );
}

/**
 * Heads-up display for a Baselode3DScene: north arrow and heading, scale
 * bar, projection / mode badges, plan-view mini-map, cursor coordinates and
 * a keyboard cheat-sheet.
 *
 * @param {object} props
 * @param {object} props.scene - Baselode3DScene instance (after init)
 * @param {boolean} [props.dark=false] - dark chrome
 * @param {Array<Array<{x:number,y:number}>>} [props.paths] - plan-view traces for the mini-map
 * @param {boolean} [props.showMinimap=true]
 * @param {boolean} [props.showCoordinates=true]
 * @param {boolean} [props.showHelp=true]
 * @param {Function} [props.onMinimapClick] - ({x, y}) => void; defaults to moving the pivot
 */
function Baselode3DHud({ scene, dark = false, paths = [], showMinimap = true, showCoordinates = true, showHelp = true, onMinimapClick }) {
  const { state, hover } = useHudState(scene);
  const [helpOpen, setHelpOpen] = useState(false);
  const collars = useMemo(() => {
    if (!scene || typeof scene.getDrillholeMeta !== 'function') return [];
    return scene.getDrillholeMeta().map((h) => h.collar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, state?.bounds?.minX, state?.bounds?.maxX, state?.bounds?.minY, state?.bounds?.maxY]);

  if (!scene || !state) return null;

  const handleMinimapClick = (p) => {
    if (onMinimapClick) { onMinimapClick(p); return; }
    const z = state.gridElevation ?? state.target.z;
    scene.focusOnPoint?.({ x: p.x, y: p.y, z }, { animate: true });
  };

  const badges = [
    state.projection === 'orthographic' ? 'Ortho' : 'Persp',
    state.controlMode === 'fly' ? 'Walk' : 'Orbit',
    state.lodActive ? 'Lines' : null,
  ].filter(Boolean);

  return (
    <div className={`baselode-hud${dark ? ' baselode-hud--dark' : ''}`} data-baselode-scroll>
      <div className="baselode-hud-top">
        <Compass azimuthDeg={state.azimuthDeg} pitchDeg={state.pitchDeg} />
        <div className="baselode-hud-stack">
          <ScaleBar unitsPerPixel={state.unitsPerPixel} />
          <div className="baselode-hud-badges">
            {badges.map((b) => <span key={b} className="baselode-hud-badge">{b}</span>)}
            {state.gridSpacing != null && <span className="baselode-hud-badge baselode-hud-badge--quiet">grid {formatMetres(state.gridSpacing)}</span>}
          </div>
        </div>
      </div>
      {showMinimap && <MiniMap state={state} paths={paths} collars={collars} onClick={handleMinimapClick} />}
      {showCoordinates && (
        <div className="baselode-hud-coords" aria-live="off">
          {hover ? (
            <>
              <span><b>E</b> {fmtCoord(hover.x)}</span>
              <span><b>N</b> {fmtCoord(hover.y)}</span>
              <span><b>RL</b> {fmtCoord(hover.z)}</span>
              {hover.holeId != null && <span className="baselode-hud-coords-hole"><b>{hover.holeId}</b> {Number.isFinite(hover.md) ? `${hover.md.toFixed(1)} m` : ''}</span>}
              {hover.type === 'ground' && <span className="baselode-hud-coords-note">on grid</span>}
            </>
          ) : (
            <>
              <span><b>Pivot</b></span>
              <span><b>E</b> {fmtCoord(state.target.x)}</span>
              <span><b>N</b> {fmtCoord(state.target.y)}</span>
              <span><b>RL</b> {fmtCoord(state.target.z)}</span>
            </>
          )}
        </div>
      )}
      {showHelp && (
        <div className="baselode-hud-help">
          <button type="button" className="baselode-hud-help-toggle" aria-expanded={helpOpen} onClick={() => setHelpOpen((v) => !v)} title="Keyboard and mouse help">?</button>
          {helpOpen && (
            <dl className="baselode-hud-help-list">
              {KEY_HELP.map(([k, v]) => (
                <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

export default Baselode3DHud;
