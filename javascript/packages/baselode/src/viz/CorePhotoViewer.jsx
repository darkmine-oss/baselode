/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useMemo } from 'react';
import CorePhotoTable from './CorePhotoTable.jsx';
import { buildTrayPhotos, defaultTrayFilename } from './corePhotoViz.js';

/**
 * CorePhotoViewer
 * ===============
 *
 * A self-contained, pannable/zoomable core box photograph viewer for use in
 * any React application.  Point it at a sequence of tray images (e.g. from an
 * NVCL HyLogger dataset) and it renders them depth-aligned with a ruler,
 * mouse-wheel zoom, and left-drag panning.
 *
 *
 * ## Minimal usage
 *
 * ```jsx
 * import { CorePhotoViewer } from 'baselode';
 * import 'baselode/style.css';            // required
 *
 * <div style={{ width: '100%', height: '80vh' }}>
 *   <CorePhotoViewer
 *     holeId="09RTD001"
 *     trays={[
 *       { fromDepth: 57.103, toDepth: 60.603 },
 *       { fromDepth: 60.603, toDepth: 64.003 },
 *       // … one entry per image, in ascending depth order
 *     ]}
 *     thumbBaseUrl="/data/09RTD001/thumb"
 *     fullBaseUrl="/data/09RTD001/full"
 *   />
 * </div>
 * ```
 *
 *
 * ## What you must supply
 *
 * ### 1 · Tray depth intervals (`trays`)
 *
 * An array of objects, one per image file, each containing the downhole depth
 * range (metres) that the tray covers:
 *
 * ```js
 * [
 *   { fromDepth: 57.103, toDepth: 60.603 },
 *   { fromDepth: 60.603, toDepth: 64.003 },
 * ]
 * ```
 *
 * **Where to get these values:**
 * - Core scanning system export (HyLogger, Corescan, etc.) — usually a CSV
 *   with from/to depths per tray.
 * - LIMS or core database — query from/to depths for the hole ordered by depth.
 * - Manual entry or calculation from known tray length and start depth.
 *
 *
 * ### 2 · Image directories (`thumbBaseUrl` / `fullBaseUrl`)
 *
 * Two URL prefixes pointing to directories that contain the image files:
 *
 * | Prop           | Purpose                                   | Typical size   |
 * |----------------|-------------------------------------------|----------------|
 * | `thumbBaseUrl` | Low-resolution thumbnails — always loaded | ~10–50 KB each |
 * | `fullBaseUrl`  | High-resolution originals — loaded on zoom| 1–10 MB each   |
 *
 * If you only have one resolution pass the same URL for both props.
 *
 * The directories must be **browser-accessible** — e.g.:
 * - Served from your web server's `public/` folder
 * - An S3 bucket / CDN with CORS enabled (`Access-Control-Allow-Origin: *`)
 * - A Vercel / Netlify static asset path
 *
 * The viewer never loads all full-res images at once; it swaps to full
 * resolution only when the user zooms in past a threshold.
 *
 *
 * ### 3 · Container size
 *
 * The component fills 100 % of its parent's width and height.  Wrap it in a
 * `<div>` with an explicit height (e.g. `height: '80vh'`).
 *
 *
 * ## Filename conventions
 *
 * By default filenames are generated as `tray_000.jpg`, `tray_001.jpg`, …
 * (zero-padded three-digit index, 0-based).
 *
 * Override per-tray via `tray.filename`:
 * ```js
 * { fromDepth: 3.4, toDepth: 6.8, filename: 'DDH001_box002.jpg' }
 * ```
 *
 * Or supply a custom generator for the whole dataset:
 * ```jsx
 * <CorePhotoViewer
 *   getFilename={(index) => `box_${String(index + 1).padStart(4, '0')}.jpg`}
 *   // …
 * />
 * ```
 *
 *
 * ## Multiple photo sets (columns)
 *
 * If you have parallel image sets (e.g. "Wet" and "Dry") for the same hole,
 * interleave the trays and tag each with `photoSet`:
 *
 * ```js
 * trays={[
 *   { fromDepth: 0, toDepth: 3.4, photoSet: 'Wet', filename: 'wet_000.jpg' },
 *   { fromDepth: 0, toDepth: 3.4, photoSet: 'Dry', filename: 'dry_000.jpg' },
 *   { fromDepth: 3.4, toDepth: 6.8, photoSet: 'Wet', filename: 'wet_001.jpg' },
 *   { fromDepth: 3.4, toDepth: 6.8, photoSet: 'Dry', filename: 'dry_001.jpg' },
 * ]}
 * ```
 *
 *
 * ## Interaction
 *
 * | Input                  | Action                              |
 * |------------------------|-------------------------------------|
 * | Mouse wheel            | Zoom in / out (centred on cursor)   |
 * | Left-click drag        | Pan                                 |
 * | ⌂ button in header     | Reset to default view               |
 *
 *
 * @param {Object}   props
 * @param {string}   [props.holeId='']
 *   Drillhole identifier — shown in the header bar.
 *
 * @param {Array<{
 *   fromDepth: number,
 *   toDepth:   number,
 *   filename?: string,
 *   photoSet?: string
 * }>} [props.trays=[]]
 *   Tray depth intervals.  `fromDepth` / `toDepth` in metres downhole.
 *   Optional `filename` overrides the auto-generated name for that tray.
 *   Optional `photoSet` overrides the column label for that tray.
 *
 * @param {string}   [props.thumbBaseUrl='']
 *   URL prefix for thumbnail images (no trailing slash needed).
 *   Example: `'https://cdn.example.com/holes/09RTD001/thumb'`
 *
 * @param {string}   [props.fullBaseUrl='']
 *   URL prefix for full-resolution images.
 *   Example: `'https://cdn.example.com/holes/09RTD001/full'`
 *
 * @param {string}   [props.photoSet='Tray Images']
 *   Default column label used when `tray.photoSet` is absent.
 *
 * @param {function} [props.getFilename]
 *   `(index: number) => string` — custom filename generator.
 *   `index` is 0-based.  Defaults to `tray_NNN.jpg`.
 *
 * @param {number}   [props.initialZoom=5]
 *   Starting LOD level (1–10).  Controls when the viewer switches from
 *   thumbnails to full-res as the user zooms in.  5 is a sensible default.
 */
export function CorePhotoViewer({
  holeId = '',
  trays = [],
  thumbBaseUrl = '',
  fullBaseUrl = '',
  photoSet: defaultPhotoSet = 'Tray Images',
  getFilename = defaultTrayFilename,
  initialZoom = 5,
  transform,
  onTransformChange,
}) {
  const photos = useMemo(
    () => buildTrayPhotos(holeId, trays, thumbBaseUrl, fullBaseUrl, defaultPhotoSet, getFilename),
    [holeId, trays, thumbBaseUrl, fullBaseUrl, defaultPhotoSet, getFilename],
  );

  return (
    <CorePhotoTable
      photos={photos}
      holeId={holeId}
      initialZoom={initialZoom}
      transform={transform}
      onTransformChange={onTransformChange}
    />
  );
}

export default CorePhotoViewer;
