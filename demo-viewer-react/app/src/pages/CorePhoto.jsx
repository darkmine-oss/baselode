/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useMemo, useState } from 'react';
import { CorePhotoTable } from 'baselode';
import { DEMO_HOLES, getHolePhotos } from '../data/photoTestData.js';
import './CorePhoto.css';

// ── Page component ────────────────────────────────────────────────────────

const ALL_HOLES = ['09RTD001', '12CADD001', ...DEMO_HOLES];
const NONE = '—';

function HoleSelector({ id, label, value, onChange }) {
  return (
    <div className="core-photo-page-controls">
      <label htmlFor={id} className="core-photo-page-label">{label}</label>
      <select
        id={id}
        className="core-photo-page-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {ALL_HOLES.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
        <option value={NONE}>{NONE}</option>
      </select>
    </div>
  );
}

function CorePhoto() {
  const [leftHole, setLeftHole]   = useState('GSWA-001');
  const [rightHole, setRightHole] = useState('GSWA-003');
  const [linked, setLinked]       = useState(true);

  const leftPhotos  = useMemo(() => getHolePhotos(leftHole  === NONE ? null : leftHole),  [leftHole]);
  const rightPhotos = useMemo(() => getHolePhotos(rightHole === NONE ? null : rightHole), [rightHole]);

  const combinedPhotos = useMemo(() => [...leftPhotos, ...rightPhotos], [leftPhotos, rightPhotos]);
  const combinedHoleId = [leftHole, rightHole].filter((h) => h !== NONE).join(' / ');

  const showRight = rightHole !== NONE;

  return (
    <div className="core-photo-page">
      <div className="core-photo-page-notice">
        See the <a href="https://docs.baselode.net/guide/core-photo-viewer" target="_blank" rel="noreferrer">docs</a> for how to test this locally with real NVCL examples.
      </div>
      <div className="core-photo-page-header">
        <h2>Core Photo Table</h2>
        <HoleSelector id="left-hole-select"  label="Left"  value={leftHole}  onChange={setLeftHole}  />
        <HoleSelector id="right-hole-select" label="Right" value={rightHole} onChange={setRightHole} />
        <label className="core-photo-page-link-label">
          <input
            type="checkbox"
            checked={linked}
            onChange={(e) => setLinked(e.target.checked)}
          />
          Link
        </label>
      </div>

      {linked ? (
        <div className="core-photo-page-viewer">
          <CorePhotoTable photos={combinedPhotos} holeId={combinedHoleId} initialZoom={5} />
        </div>
      ) : (
        <div className="core-photo-page-panels">
          <div className="core-photo-page-panel">
            <CorePhotoTable photos={leftPhotos}  holeId={leftHole}  initialZoom={5} />
          </div>
          {showRight && (
            <div className="core-photo-page-panel">
              <CorePhotoTable photos={rightPhotos} holeId={rightHole} initialZoom={5} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default CorePhoto;
