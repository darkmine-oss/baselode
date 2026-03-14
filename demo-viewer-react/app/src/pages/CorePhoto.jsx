/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useMemo, useState } from 'react';
import { CorePhotoTable, buildTrayPhotos } from 'baselode';
import './CorePhoto.css';

// ── Real NVCL data — hole 09RTD001 ────────────────────────────────────────
//
// Depth intervals extracted from mosaic_preview.html.
// Images are symlinked into public/data/nvcl/09RTD001/{thumb,full}/
//   thumb  400×135 px  ~18 KB each   (loaded at low zoom)
//   full  11298×4248 px  ~5.3 MB each (loaded when zoomed in)

const NVCL_09RTD001_TRAYS = [
  { fromDepth: 57.103,  toDepth: 60.603  },
  { fromDepth: 60.603,  toDepth: 64.003  },
  { fromDepth: 64.003,  toDepth: 67.403  },
  { fromDepth: 67.403,  toDepth: 70.903  },
  { fromDepth: 70.903,  toDepth: 74.103  },
  { fromDepth: 74.103,  toDepth: 78.403  },
  { fromDepth: 78.403,  toDepth: 81.803  },
  { fromDepth: 81.803,  toDepth: 86.403  },
  { fromDepth: 86.403,  toDepth: 90.503  },
  { fromDepth: 90.503,  toDepth: 94.803  },
  { fromDepth: 94.803,  toDepth: 98.903  },
  { fromDepth: 98.903,  toDepth: 103.303 },
  { fromDepth: 103.303, toDepth: 107.603 },
  { fromDepth: 107.603, toDepth: 111.703 },
  { fromDepth: 111.703, toDepth: 116.203 },
  { fromDepth: 116.203, toDepth: 120.404 },
  { fromDepth: 120.404, toDepth: 125.103 },
  { fromDepth: 125.103, toDepth: 129.504 },
  { fromDepth: 129.504, toDepth: 134.203 },
  { fromDepth: 134.203, toDepth: 138.703 },
  { fromDepth: 138.703, toDepth: 143.203 },
  { fromDepth: 143.203, toDepth: 147.804 },
  { fromDepth: 147.804, toDepth: 152.503 },
  { fromDepth: 152.503, toDepth: 156.803 },
  { fromDepth: 156.803, toDepth: 160.903 },
  { fromDepth: 160.903, toDepth: 164.803 },
  { fromDepth: 164.803, toDepth: 168.903 },
  { fromDepth: 168.903, toDepth: 173.203 },
  { fromDepth: 173.203, toDepth: 177.803 },
  { fromDepth: 177.803, toDepth: 182.403 },
  { fromDepth: 182.403, toDepth: 186.803 },
  { fromDepth: 186.803, toDepth: 191.203 },
  { fromDepth: 191.203, toDepth: 195.804 },
  { fromDepth: 195.804, toDepth: 200.504 },
  { fromDepth: 200.504, toDepth: 205.203 },
  { fromDepth: 205.203, toDepth: 209.703 },
  { fromDepth: 209.703, toDepth: 214.203 },
  { fromDepth: 214.203, toDepth: 218.703 },
  { fromDepth: 218.703, toDepth: 222.903 },
  { fromDepth: 222.903, toDepth: 227.503 },
  { fromDepth: 227.503, toDepth: 232.103 },
  { fromDepth: 232.103, toDepth: 236.603 },
  { fromDepth: 236.603, toDepth: 241.103 },
  { fromDepth: 241.103, toDepth: 245.703 },
  { fromDepth: 245.703, toDepth: 250.304 },
  { fromDepth: 250.304, toDepth: 255.004 },
  { fromDepth: 255.004, toDepth: 259.703 },
  { fromDepth: 259.703, toDepth: 264.203 },
  { fromDepth: 264.203, toDepth: 268.704 },
  { fromDepth: 268.704, toDepth: 273.403 },
  { fromDepth: 273.403, toDepth: 277.903 },
  { fromDepth: 277.903, toDepth: 282.404 },
  { fromDepth: 282.404, toDepth: 287.103 },
  { fromDepth: 287.103, toDepth: 291.503 },
  { fromDepth: 291.503, toDepth: 296.104 },
  { fromDepth: 296.104, toDepth: 300.803 },
  { fromDepth: 300.803, toDepth: 305.197 },
];

// ── Synthetic demo data ───────────────────────────────────────────────────
//
// SVG placeholders with depth-varying colours, demonstrating multi-set
// (Wet / Dry) side-by-side layout.  Built into the CorePhotoTable photos
// format directly since SVG data-URIs don't fit the CorePhotoViewer URL model.

const BOX_INTERVAL_M = 1;
const DEMO_HOLES = ['GSWA-001', 'GSWA-002', 'GSWA-003'];
const DEMO_HOLE_DEPTHS = { 'GSWA-001': 60, 'GSWA-002': 40, 'GSWA-003': 80 };

function makeSvgPhoto(fromDepth, toDepth, set, size = 'full') {
  const hue = Math.round(((fromDepth * 4) % 360 + 360) % 360);
  const saturation = set === 'Wet' ? 55 : 30;
  const lightness = size === 'thumb' ? 82 : 65;
  const bandCount = size === 'thumb' ? 2 : 8;
  let bands = '';
  for (let i = 0; i < bandCount; i++) {
    const y = Math.round((i / bandCount) * 100);
    const h = Math.round(100 / bandCount);
    const bHue = (hue + i * 15) % 360;
    const bLight = lightness + (i % 2 === 0 ? 0 : 8);
    bands += `<rect x="0" y="${y}" width="200" height="${h + 1}" fill="hsl(${bHue},${saturation}%,${bLight}%)"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
  ${bands}
  <rect x="0" y="0" width="200" height="100" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>
  <text x="4" y="13" font-family="monospace" font-size="10" fill="rgba(0,0,0,0.7)">${fromDepth}–${toDepth} m</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function generateDemoPhotos(holeId, maxDepth) {
  const photos = [];
  for (let d = 0; d < maxDepth; d += BOX_INTERVAL_M) {
    const from = d;
    const to = Math.min(d + BOX_INTERVAL_M, maxDepth);
    for (const set of ['Wet', 'Dry']) {
      photos.push({
        hole_id: holeId, from_depth: from, to_depth: to, photo_set: set,
        image_url: makeSvgPhoto(from, to, set, 'full'),
        lod_urls: {
          thumb: makeSvgPhoto(from, to, set, 'thumb'),
          full:  makeSvgPhoto(from, to, set, 'full'),
        },
      });
    }
  }
  return photos;
}

const DEMO_DATA = Object.fromEntries(
  DEMO_HOLES.map((id) => [id, generateDemoPhotos(id, DEMO_HOLE_DEPTHS[id])]),
);

// ── Real NVCL data — hole 12CADD001 ───────────────────────────────────────
//
// Two consecutive datasets covering the full hole depth (0–537 m).
// Each dataset lives in its own directory because filenames overlap
// (both start at mosaic_000.jpg), so we build explicit per-tray URLs.
//
//   DS1  0bf137d9  93 trays  0.004 – 324.188 m
//   DS2  43057f8c  58 trays  324.204 – 537.1 m
//
// Symlinked into:
//   public/data/nvcl/12CADD001/ds1/{thumb,full}
//   public/data/nvcl/12CADD001/ds2/{thumb,full}

// NVCL mosaic filenames are mosaic_NNN.jpg rather than the default tray_NNN.jpg
const nvclFilename = (i) => `mosaic_${String(i).padStart(3, '0')}.jpg`;

const NVCL_12CADD001_DS1_TRAYS = [
  { fromDepth: 0.004,   toDepth: 3.903   },
  { fromDepth: 3.903,   toDepth: 7.303   },
  { fromDepth: 7.303,   toDepth: 10.703  },
  { fromDepth: 10.703,  toDepth: 13.903  },
  { fromDepth: 13.903,  toDepth: 16.902  },
  { fromDepth: 16.902,  toDepth: 19.503  },
  { fromDepth: 19.503,  toDepth: 23.103  },
  { fromDepth: 23.103,  toDepth: 26.603  },
  { fromDepth: 26.603,  toDepth: 30.303  },
  { fromDepth: 30.303,  toDepth: 33.603  },
  { fromDepth: 33.603,  toDepth: 36.903  },
  { fromDepth: 36.903,  toDepth: 40.303  },
  { fromDepth: 40.303,  toDepth: 43.403  },
  { fromDepth: 43.403,  toDepth: 46.803  },
  { fromDepth: 46.803,  toDepth: 50.103  },
  { fromDepth: 50.103,  toDepth: 53.103  },
  { fromDepth: 53.103,  toDepth: 56.703  },
  { fromDepth: 56.703,  toDepth: 60.103  },
  { fromDepth: 60.103,  toDepth: 63.403  },
  { fromDepth: 63.403,  toDepth: 66.803  },
  { fromDepth: 66.803,  toDepth: 70.503  },
  { fromDepth: 70.503,  toDepth: 74.103  },
  { fromDepth: 74.103,  toDepth: 77.603  },
  { fromDepth: 77.603,  toDepth: 81.003  },
  { fromDepth: 81.003,  toDepth: 84.203  },
  { fromDepth: 84.203,  toDepth: 87.803  },
  { fromDepth: 87.803,  toDepth: 91.203  },
  { fromDepth: 91.203,  toDepth: 94.903  },
  { fromDepth: 94.903,  toDepth: 98.303  },
  { fromDepth: 98.303,  toDepth: 101.004 },
  { fromDepth: 101.004, toDepth: 105.303 },
  { fromDepth: 105.303, toDepth: 109.003 },
  { fromDepth: 109.003, toDepth: 112.603 },
  { fromDepth: 112.603, toDepth: 116.003 },
  { fromDepth: 116.003, toDepth: 119.403 },
  { fromDepth: 119.403, toDepth: 122.803 },
  { fromDepth: 122.803, toDepth: 126.403 },
  { fromDepth: 126.403, toDepth: 129.903 },
  { fromDepth: 129.903, toDepth: 133.503 },
  { fromDepth: 133.503, toDepth: 137.003 },
  { fromDepth: 137.003, toDepth: 140.503 },
  { fromDepth: 140.503, toDepth: 144.103 },
  { fromDepth: 144.103, toDepth: 147.703 },
  { fromDepth: 147.703, toDepth: 151.203 },
  { fromDepth: 151.203, toDepth: 154.703 },
  { fromDepth: 154.703, toDepth: 158.203 },
  { fromDepth: 158.203, toDepth: 161.803 },
  { fromDepth: 161.803, toDepth: 165.104 },
  { fromDepth: 165.104, toDepth: 168.803 },
  { fromDepth: 168.803, toDepth: 172.403 },
  { fromDepth: 172.403, toDepth: 176.103 },
  { fromDepth: 176.103, toDepth: 179.604 },
  { fromDepth: 179.604, toDepth: 183.303 },
  { fromDepth: 183.303, toDepth: 187.003 },
  { fromDepth: 187.003, toDepth: 190.703 },
  { fromDepth: 190.703, toDepth: 194.403 },
  { fromDepth: 194.403, toDepth: 198.104 },
  { fromDepth: 198.104, toDepth: 201.803 },
  { fromDepth: 201.803, toDepth: 205.403 },
  { fromDepth: 205.403, toDepth: 209.003 },
  { fromDepth: 209.003, toDepth: 212.303 },
  { fromDepth: 212.303, toDepth: 215.603 },
  { fromDepth: 215.603, toDepth: 219.103 },
  { fromDepth: 219.103, toDepth: 222.603 },
  { fromDepth: 222.603, toDepth: 226.204 },
  { fromDepth: 226.204, toDepth: 230.003 },
  { fromDepth: 230.003, toDepth: 233.703 },
  { fromDepth: 233.703, toDepth: 237.403 },
  { fromDepth: 237.403, toDepth: 240.803 },
  { fromDepth: 240.803, toDepth: 244.403 },
  { fromDepth: 244.403, toDepth: 248.003 },
  { fromDepth: 248.003, toDepth: 251.503 },
  { fromDepth: 251.503, toDepth: 255.103 },
  { fromDepth: 255.103, toDepth: 258.403 },
  { fromDepth: 258.403, toDepth: 262.003 },
  { fromDepth: 262.003, toDepth: 265.303 },
  { fromDepth: 265.303, toDepth: 268.703 },
  { fromDepth: 268.703, toDepth: 272.203 },
  { fromDepth: 272.203, toDepth: 275.603 },
  { fromDepth: 275.603, toDepth: 279.003 },
  { fromDepth: 279.003, toDepth: 282.503 },
  { fromDepth: 282.503, toDepth: 286.003 },
  { fromDepth: 286.003, toDepth: 289.703 },
  { fromDepth: 289.703, toDepth: 293.103 },
  { fromDepth: 293.103, toDepth: 296.703 },
  { fromDepth: 296.703, toDepth: 300.103 },
  { fromDepth: 300.103, toDepth: 303.703 },
  { fromDepth: 303.703, toDepth: 307.403 },
  { fromDepth: 307.403, toDepth: 311.003 },
  { fromDepth: 311.003, toDepth: 314.603 },
  { fromDepth: 314.603, toDepth: 318.303 },
  { fromDepth: 318.303, toDepth: 321.702 },
  { fromDepth: 321.702, toDepth: 324.188 },
];

const NVCL_12CADD001_DS2_TRAYS = [
  { fromDepth: 324.204, toDepth: 327.987 },
  { fromDepth: 327.987, toDepth: 331.798 },
  { fromDepth: 331.798, toDepth: 335.541 },
  { fromDepth: 335.541, toDepth: 339.181 },
  { fromDepth: 339.203, toDepth: 342.783 },
  { fromDepth: 342.803, toDepth: 346.383 },
  { fromDepth: 346.403, toDepth: 350.024 },
  { fromDepth: 350.024, toDepth: 353.783 },
  { fromDepth: 353.803, toDepth: 356.985 },
  { fromDepth: 357.003, toDepth: 360.583 },
  { fromDepth: 360.603, toDepth: 364.26  },
  { fromDepth: 364.26,  toDepth: 367.944 },
  { fromDepth: 367.944, toDepth: 371.677 },
  { fromDepth: 371.677, toDepth: 375.447 },
  { fromDepth: 375.447, toDepth: 379.182 },
  { fromDepth: 379.203, toDepth: 382.888 },
  { fromDepth: 382.888, toDepth: 386.569 },
  { fromDepth: 386.569, toDepth: 390.339 },
  { fromDepth: 390.339, toDepth: 394.077 },
  { fromDepth: 394.077, toDepth: 397.843 },
  { fromDepth: 397.843, toDepth: 401.569 },
  { fromDepth: 401.569, toDepth: 405.345 },
  { fromDepth: 405.345, toDepth: 409.075 },
  { fromDepth: 409.075, toDepth: 412.861 },
  { fromDepth: 412.861, toDepth: 416.518 },
  { fromDepth: 416.518, toDepth: 420.166 },
  { fromDepth: 420.166, toDepth: 424.025 },
  { fromDepth: 424.025, toDepth: 427.724 },
  { fromDepth: 427.724, toDepth: 431.501 },
  { fromDepth: 431.501, toDepth: 435.224 },
  { fromDepth: 435.224, toDepth: 438.886 },
  { fromDepth: 438.886, toDepth: 442.663 },
  { fromDepth: 442.663, toDepth: 446.469 },
  { fromDepth: 446.469, toDepth: 450.199 },
  { fromDepth: 450.199, toDepth: 453.941 },
  { fromDepth: 453.941, toDepth: 457.799 },
  { fromDepth: 457.799, toDepth: 461.527 },
  { fromDepth: 461.527, toDepth: 465.198 },
  { fromDepth: 465.198, toDepth: 469.026 },
  { fromDepth: 469.026, toDepth: 472.718 },
  { fromDepth: 472.718, toDepth: 476.482 },
  { fromDepth: 476.503, toDepth: 480.183 },
  { fromDepth: 480.204, toDepth: 483.982 },
  { fromDepth: 484.004, toDepth: 487.732 },
  { fromDepth: 487.732, toDepth: 491.483 },
  { fromDepth: 491.503, toDepth: 495.183 },
  { fromDepth: 495.203, toDepth: 498.783 },
  { fromDepth: 498.803, toDepth: 502.428 },
  { fromDepth: 502.428, toDepth: 506.241 },
  { fromDepth: 506.241, toDepth: 510.092 },
  { fromDepth: 510.092, toDepth: 513.782 },
  { fromDepth: 513.804, toDepth: 517.534 },
  { fromDepth: 517.534, toDepth: 521.283 },
  { fromDepth: 521.303, toDepth: 524.983 },
  { fromDepth: 525.004, toDepth: 528.802 },
  { fromDepth: 528.802, toDepth: 532.553 },
  { fromDepth: 532.553, toDepth: 536.244 },
  { fromDepth: 536.244, toDepth: 537.1   },
];

// Combine both sections into one continuous photo array
const NVCL_12CADD001_PHOTOS = [
  ...buildTrayPhotos('12CADD001', NVCL_12CADD001_DS1_TRAYS,
    '/data/nvcl/12CADD001/ds1/thumb', '/data/nvcl/12CADD001/ds1/full', 'Dataset 1', nvclFilename),
  ...buildTrayPhotos('12CADD001', NVCL_12CADD001_DS2_TRAYS,
    '/data/nvcl/12CADD001/ds2/thumb', '/data/nvcl/12CADD001/ds2/full', 'Dataset 2', nvclFilename),
];

// ── Per-hole photo builders ────────────────────────────────────────────────
//
// Each returns a photos array with photo_set = holeId (one column per hole).
// Demo holes suffix each set so Wet/Dry columns stay distinct per hole.

function getHolePhotos(holeId) {
  if (!holeId) return [];
  if (holeId === '09RTD001') {
    return buildTrayPhotos(
      holeId, NVCL_09RTD001_TRAYS,
      '/data/nvcl/09RTD001/thumb', '/data/nvcl/09RTD001/full',
      holeId, nvclFilename,
    );
  }
  if (holeId === '12CADD001') {
    return [
      ...buildTrayPhotos(holeId, NVCL_12CADD001_DS1_TRAYS,
        '/data/nvcl/12CADD001/ds1/thumb', '/data/nvcl/12CADD001/ds1/full', holeId, nvclFilename),
      ...buildTrayPhotos(holeId, NVCL_12CADD001_DS2_TRAYS,
        '/data/nvcl/12CADD001/ds2/thumb', '/data/nvcl/12CADD001/ds2/full', holeId, nvclFilename),
    ];
  }
  // Demo: keep Wet/Dry as separate columns, prefixed with hole ID
  return (DEMO_DATA[holeId] ?? []).map((p) => ({
    ...p,
    photo_set: `${holeId} — ${p.photo_set}`,
  }));
}

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
