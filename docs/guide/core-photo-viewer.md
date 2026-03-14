# Core Photo Viewer

The `CorePhotoViewer` component renders a depth-aligned, pannable, and zoomable core box photograph table directly in any React application.

Given a folder of tray images and a small metadata file describing the depth interval each image covers, the viewer displays them proportionally along a depth axis — like a digital core tray rack you can freely zoom and pan.

**Key features**

- Depth-proportional layout — each tray occupies vertical space proportional to its physical length
- Mouse-wheel zoom centred on the cursor (Leaflet-style)
- Left-click drag to pan
- Automatic LOD switching — thumbnails at low zoom, full-resolution images when zoomed in
- Multiple photo sets side-by-side (different scan types, or different holes)
- Depth ruler with auto-scaling tick interval
- Linked pan/zoom across multiple independent viewers

---

## How it works

The component needs two things from you:

1. **Image files** — one image per core tray, accessible by URL
2. **Depth metadata** — a list recording the from/to depth (in metres) that each image covers

Everything else — layout, zooming, panning, LOD switching — is handled automatically.

---

## Preparing your data

### Step 1 — Organise your images

Place your tray images in one or two directories:

```
images/
  thumb/          ← low-resolution copies (optional but recommended)
    tray_000.jpg
    tray_001.jpg
    …
  full/           ← original full-resolution images
    tray_000.jpg
    tray_001.jpg
    …
```

- **Full-resolution** images are loaded only when the user zooms in past the LOD threshold, so even very large files (5–10 MB each) don't hurt initial load performance.
- **Thumbnails** are loaded at all zoom levels. If you don't have a separate thumbnail set, point both `thumbBaseUrl` and `fullBaseUrl` at the same directory.
- Filenames can be anything as long as they are consistent. Sequential zero-padded names (`tray_000.jpg`, `tray_001.jpg`, …) are the default pattern.

**Multiple scan datasets for the same hole**

If a hole was scanned in multiple sessions (e.g. two HyLogger runs covering different depth ranges), each session typically produces its own directory with filenames starting again from `tray_000.jpg`. Keep each session in its own subdirectory:

```
images/
  session1/
    thumb/   full/
  session2/
    thumb/   full/
```

See [Multiple datasets for one hole](#multiple-datasets-for-one-hole) for how to combine them.

To generate thumbnails from your originals with `sips` (macOS):

```bash
mkdir -p images/thumb
for f in images/full/*.jpg; do
  sips -Z 400 "$f" --out "images/thumb/$(basename "$f")"
done
```

Or with ImageMagick:

```bash
mkdir -p images/thumb
for f in images/full/*.jpg; do
  convert "$f" -resize 400x images/thumb/$(basename "$f")
done
```

---

### Step 2 — Create a depth metadata file

The viewer needs to know the downhole depth range (from/to in metres) that each image covers. Produce a JSON or CSV file alongside your images — one row per tray, in ascending depth order.

**JSON format (recommended):**

```json
[
  { "fromDepth": 0.0,   "toDepth": 3.4  },
  { "fromDepth": 3.4,   "toDepth": 6.8  },
  { "fromDepth": 6.8,   "toDepth": 10.2 }
]
```

**CSV format (also fine):**

```csv
from_depth,to_depth
0.0,3.4
3.4,6.8
6.8,10.2
```

The entries must be in the same order as your image files. Index 0 in the metadata corresponds to the first image file, index 1 to the second, and so on.

**Where do the depth values come from?**

| Scenario | Source |
|---|---|
| Core scanning system (HyLogger, Corescan, etc.) | Export or log file produced by the scanner — usually a CSV with from/to depths per tray |
| LIMS / core database | Query `from_depth`, `to_depth` for the hole ordered by depth |
| Manual entry | Measure tray lengths physically and record start depth + cumulative length |
| Known tray length | If every tray is the same length (e.g. 1 m), generate programmatically (see below) |

**Generating metadata for uniform-length trays (Python):**

```python
import json

start_depth  = 0.0     # depth of first tray top (m)
tray_length  = 1.0     # metres per tray
image_count  = 57      # number of image files

trays = [
    {
        "fromDepth": round(start_depth + i * tray_length, 3),
        "toDepth":   round(start_depth + (i + 1) * tray_length, 3),
    }
    for i in range(image_count)
]

with open("tray_depths.json", "w") as f:
    json.dump(trays, f, indent=2)
```

---

### Step 3 — Serve the images

The image directories must be accessible by the browser via URL. Common options:

| Method | How |
|---|---|
| **Local dev** | Symlink directories into your project's `public/` folder (see [Local development](#local-development)) |
| **Static host** | Copy files to Vercel, Netlify, GitHub Pages, or any web server |
| **Object storage** | Upload to AWS S3, GCS, Azure Blob, or Cloudflare R2 with CORS enabled |
| **CDN** | Serve via CloudFront, Cloudflare, or similar in front of object storage |

::: tip CORS
If your images are on a different origin from your app (e.g. S3), the bucket must send `Access-Control-Allow-Origin: *` (or your app's origin). Without CORS, the browser will refuse to load the images.
:::

---

## Installation

```bash
npm install baselode
```

Peer dependencies (must be installed in your app):

```bash
npm install react react-dom
```

---

## Usage

### Single hole

The simplest case: one hole, one scan directory, filenames follow the default pattern.

```jsx
import { CorePhotoViewer } from 'baselode';
import 'baselode/style.css';

const trays = [
  { fromDepth: 0.0,  toDepth: 3.4  },
  { fromDepth: 3.4,  toDepth: 6.8  },
  { fromDepth: 6.8,  toDepth: 10.2 },
  // …
];

<div style={{ width: '100%', height: '80vh' }}>
  <CorePhotoViewer
    holeId="DDH-001"
    trays={trays}
    thumbBaseUrl="/images/thumb"
    fullBaseUrl="/images/full"
  />
</div>
```

::: warning Container height
`CorePhotoViewer` fills 100% of its parent's width and height. Always give the parent container an explicit height — otherwise the viewer will collapse to zero.
:::

---

### Multiple photo sets

If you have parallel scans of the same hole (e.g. Wet and Dry, or visible-light and SWIR), tag each tray with a `photoSet` string. Trays sharing the same `photoSet` are grouped into one column; columns appear left-to-right in the order they are first encountered.

```js
const trays = [
  { fromDepth: 0,   toDepth: 3.4, photoSet: 'Wet', filename: 'wet_000.jpg' },
  { fromDepth: 0,   toDepth: 3.4, photoSet: 'Dry', filename: 'dry_000.jpg' },
  { fromDepth: 3.4, toDepth: 6.8, photoSet: 'Wet', filename: 'wet_001.jpg' },
  { fromDepth: 3.4, toDepth: 6.8, photoSet: 'Dry', filename: 'dry_001.jpg' },
];
```

Because both sets share the same base URLs here, pass the same directory for both and use per-tray `filename` overrides. Alternatively, if Wet and Dry images live in separate directories, use `CorePhotoTable` directly (see below).

---

### Multiple datasets for one hole

If a single hole was scanned in multiple sessions — producing separate directories with overlapping filenames (e.g. both starting at `tray_000.jpg`) — use `buildTrayPhotos` to build each dataset's photo array explicitly, then merge them before passing to `CorePhotoTable`:

```jsx
import { CorePhotoTable, buildTrayPhotos } from 'baselode';
import 'baselode/style.css';

// Each session has its own depth range and its own directory.
const session1Trays = [
  { fromDepth: 0.0,   toDepth: 3.4  },
  { fromDepth: 3.4,   toDepth: 6.8  },
  // … 93 trays, 0–324 m
];

const session2Trays = [
  { fromDepth: 324.2, toDepth: 328.0 },
  // … 58 trays, 324–537 m
];

// Build separate photo arrays — filenames start at tray_000 in each directory.
const photos = [
  ...buildTrayPhotos('DDH-001', session1Trays, '/images/s1/thumb', '/images/s1/full'),
  ...buildTrayPhotos('DDH-001', session2Trays, '/images/s2/thumb', '/images/s2/full'),
];

// CorePhotoTable renders both as a single continuous depth column.
<div style={{ width: '100%', height: '80vh' }}>
  <CorePhotoTable photos={photos} holeId="DDH-001" initialZoom={5} />
</div>
```

`buildTrayPhotos` accepts the same arguments as `CorePhotoViewer` but returns the photos array instead of rendering anything. The arrays can be freely merged, filtered, or reordered before passing to `CorePhotoTable`.

To display the two sessions as separate side-by-side columns instead of a single merged column, give each a distinct `photoSet` label:

```js
const photos = [
  ...buildTrayPhotos('DDH-001', session1Trays, '/images/s1/thumb', '/images/s1/full', 'Session 1'),
  ...buildTrayPhotos('DDH-001', session2Trays, '/images/s2/thumb', '/images/s2/full', 'Session 2'),
];
```

---

### Comparing multiple holes

To compare two holes side by side in a single scene with a shared depth ruler, build each hole's photo array and concatenate them. Use the hole ID (or any distinct string) as the `photo_set` to get one column per hole.

```jsx
import { CorePhotoTable, buildTrayPhotos } from 'baselode';

const photosA = buildTrayPhotos('DDH-001', traysA, '/data/DDH-001/thumb', '/data/DDH-001/full', 'DDH-001');
const photosB = buildTrayPhotos('DDH-002', traysB, '/data/DDH-002/thumb', '/data/DDH-002/full', 'DDH-002');

<div style={{ width: '100%', height: '80vh' }}>
  <CorePhotoTable
    photos={[...photosA, ...photosB]}
    holeId="DDH-001 / DDH-002"
    initialZoom={5}
  />
</div>
```

Column order in the scene matches the order photos appear in the array — the first distinct `photo_set` seen becomes the leftmost column.

---

### Linked pan/zoom across independent viewers

When displaying two `CorePhotoTable` instances in separate DOM containers (e.g. side-by-side panels), pass shared `transform` state and an `onTransformChange` callback so that panning or zooming in either panel moves both simultaneously:

```jsx
import { useState } from 'react';
import { CorePhotoTable } from 'baselode';

function LinkedViewer({ photosA, photosB }) {
  const [transform, setTransform] = useState({ scale: 1, tx: 0, ty: 0 });

  return (
    <div style={{ display: 'flex', height: '80vh' }}>
      <div style={{ flex: 1 }}>
        <CorePhotoTable
          photos={photosA}
          holeId="DDH-001"
          transform={transform}
          onTransformChange={setTransform}
        />
      </div>
      <div style={{ flex: 1 }}>
        <CorePhotoTable
          photos={photosB}
          holeId="DDH-002"
          transform={transform}
          onTransformChange={setTransform}
        />
      </div>
    </div>
  );
}
```

When `transform` and `onTransformChange` are omitted, each `CorePhotoTable` manages its own independent pan/zoom state.

---

## Filename conventions

By default, filenames are generated as `tray_000.jpg`, `tray_001.jpg`, … — a zero-padded three-digit index starting at 0.

**Override per tray** using the `filename` field:

```js
{ fromDepth: 3.4, toDepth: 6.8, filename: 'DDH001_box002.jpg' }
```

**Override for the whole dataset** with a `getFilename` callback:

```jsx
<CorePhotoViewer
  getFilename={(index) => `box_${String(index + 1).padStart(4, '0')}.jpg`}
  // …
/>
```

The same `getFilename` parameter is accepted by `buildTrayPhotos`:

```js
const nvclFilename = (i) => `mosaic_${String(i).padStart(3, '0')}.jpg`;

buildTrayPhotos('DDH-001', trays, thumbUrl, fullUrl, 'Tray Images', nvclFilename);
```

---

## Interaction

| Input | Action |
|---|---|
| Mouse wheel | Zoom in / out, centred on the cursor |
| Left-click drag | Pan in any direction |
| ⌂ button in header | Reset to the default view |

The percentage readout in the header shows the current zoom scale relative to the default view.

---

## LOD (Level of Detail)

| Tier | When loaded |
|---|---|
| `thumb` | Always — used at all zoom levels until the threshold is crossed |
| `full` | When the user zooms in past the LOD threshold |

The threshold is controlled by `initialZoom` (default `5`, range 1–10). Higher values load full-resolution sooner. If you only have one image resolution, pass the same directory for both `thumbBaseUrl` and `fullBaseUrl`.

---

## Local development

Symlink your image directories into the project's `public/` folder so Vite can serve them:

```bash
mkdir -p public/images/my-hole

ln -s /path/to/images/thumb  public/images/my-hole/thumb
ln -s /path/to/images/full   public/images/my-hole/full
```

If the images live outside the project root (e.g. on an external drive), tell Vite to allow access in `vite.config.js`:

```js
export default defineConfig({
  server: {
    fs: {
      allow: ['..', '/Volumes'],   // add any external root paths here
    },
  },
});
```

Then pass the public-relative URLs:

```jsx
<CorePhotoViewer
  thumbBaseUrl="/images/my-hole/thumb"
  fullBaseUrl="/images/my-hole/full"
  // …
/>
```

---

## Full API reference

### `CorePhotoViewer` props

| Prop | Type | Default | Description |
|---|---|---|---|
| `holeId` | `string` | `''` | Drillhole identifier shown in the header bar |
| `trays` | `Tray[]` | `[]` | Array of tray depth intervals — one per image |
| `thumbBaseUrl` | `string` | `''` | URL prefix for thumbnail images |
| `fullBaseUrl` | `string` | `''` | URL prefix for full-resolution images |
| `photoSet` | `string` | `'Tray Images'` | Default column label (overridden per-tray by `tray.photoSet`) |
| `getFilename` | `(index: number) => string` | `tray_NNN.jpg` pattern | Custom filename generator |
| `initialZoom` | `number` | `5` | LOD threshold (1–10); higher = full-res loads sooner |
| `transform` | `{scale, tx, ty}` | — | Controlled pan/zoom state (shared across viewers) |
| `onTransformChange` | `(t) => void` | — | Called whenever the transform changes |

### `Tray` object

| Field | Type | Required | Description |
|---|---|---|---|
| `fromDepth` | `number` | ✓ | Top of tray, metres downhole |
| `toDepth` | `number` | ✓ | Base of tray, metres downhole |
| `filename` | `string` | — | Override auto-generated filename for this tray |
| `photoSet` | `string` | — | Column label for this tray (groups trays into columns) |

---

### `buildTrayPhotos`

```js
buildTrayPhotos(holeId, trays, thumbBaseUrl, fullBaseUrl, photoSet?, getFilename?)
```

Converts a tray depth array into a `CorePhotoTable`-compatible photos array. Use this instead of `CorePhotoViewer` when you need to combine or transform multiple datasets before rendering.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `holeId` | `string` | | Stored on every photo entry |
| `trays` | `Tray[]` | | Same format as `CorePhotoViewer.trays` |
| `thumbBaseUrl` | `string` | | URL prefix for thumbnail images |
| `fullBaseUrl` | `string` | | URL prefix for full-resolution images |
| `photoSet` | `string` | `'Tray Images'` | Column label for all trays in this call |
| `getFilename` | `(i) => string` | `tray_NNN.jpg` | Custom filename generator |

Returns `Photo[]` — the same format accepted by `CorePhotoTable.photos`.

---

### `CorePhotoTable` props

Use `CorePhotoTable` directly when you need full control over the photos array — e.g. three LOD tiers, SVG/data-URI images, or URLs that don't fit a base-URL pattern.

| Prop | Type | Default | Description |
|---|---|---|---|
| `photos` | `Photo[]` | `[]` | Fully assembled photo entries (see `Photo` object below) |
| `holeId` | `string` | `''` | Displayed in the header bar |
| `initialZoom` | `number` | `5` | LOD threshold (1–10) |
| `transform` | `{scale, tx, ty}` | — | Controlled pan/zoom state |
| `onTransformChange` | `(t) => void` | — | Called whenever the transform changes |

### `Photo` object

| Field | Type | Required | Description |
|---|---|---|---|
| `hole_id` | `string` | — | Hole identifier |
| `from_depth` | `number` | ✓ | Top of tray, metres downhole |
| `to_depth` | `number` | ✓ | Base of tray, metres downhole |
| `photo_set` | `string` | — | Column label — photos sharing this value are grouped into one column |
| `image_url` | `string` | — | Fallback URL used when `lod_urls` is absent or a key is missing |
| `lod_urls` | `object` | — | Map of `lodKey → URL` (e.g. `{ thumb, medium, full }`) |

LOD breakpoints:

| Zoom range | Tier loaded |
|---|---|
| 1 – 3 | `thumb` |
| 4 – 6 | `medium` (falls back to `image_url` if absent) |
| 7 – 10 | `full` |

```jsx
import { CorePhotoTable } from 'baselode';
import 'baselode/style.css';

const photos = [
  {
    hole_id:    'DDH-001',
    from_depth: 0.0,
    to_depth:   3.4,
    photo_set:  'Tray Images',
    image_url:  '/images/thumb/tray_000.jpg',
    lod_urls: {
      thumb:  '/images/thumb/tray_000.jpg',
      medium: '/images/medium/tray_000.jpg',   // optional
      full:   '/images/full/tray_000.jpg',
    },
  },
  // …
];

<div style={{ width: '100%', height: '80vh' }}>
  <CorePhotoTable photos={photos} holeId="DDH-001" initialZoom={5} />
</div>
```
