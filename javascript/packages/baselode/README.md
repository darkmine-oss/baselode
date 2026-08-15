# Baselode (JavaScript)

Baselode is an open-source JavaScript toolkit providing structured data models for exploration and mining applications.

Version 0.1.0 focuses on domain-aware data models and validation utilities for drillhole-style data. The goal is to provide a consistent foundation for analytics, visualization, and AI workflows.

---

## Installation

```bash
npm install baselode
```

**Requires:** Node.js 20+, React 18+

---

- **Data Loading:** Efficiently import and manage your exploration and mining data (drillholes, assays, geology/lithology, block models, structural measurements).
- **Data Models:** Utilize predefined models to normalize and interpret your data (40+ column name variants, minimum-curvature desurveying).
- **Data Visualization:** Create insightful 2D strip logs (Plotly) and interactive 3D scenes (Three.js) with orbit/fly controls, assay coloring, structural disc rendering, and click-select glow.
- **Common Algorithms:** Access a range of algorithms designed to solve common problems in the industry.

## Example

```javascript
import { parseDrillholesCSV } from 'baselode';

// Example: file is a File object from an <input type="file" />
const file = /* your File object */;
file.text().then(csvText => {
  const { holes } = parseDrillholesCSV(csvText);
  // holes is an array of collar objects
  console.log(holes);
});
```

## Spatial extents

Use the lightweight `baselode/extent` entry point for CRS-aware bounds and
GeoJSON study areas:

```javascript
import { Extent } from 'baselode/extent';

const area = Extent.fromBbox([120, -32, 120.5, -31.5], 'EPSG:4326');
const mga = area.toCrs('EPSG:28351');
const feature = mga.toFeature({ id: 'study-area' });
```

The class accepts EPSG numbers/strings and proj4-compatible proj/WKT
definitions. WGS84, Web Mercator, GDA94, and MGA zones 49–58 work out of the
box. See the [JavaScript guide](../../../docs/guide/javascript.md#spatial-extents)
for the full API.

## Parsed row inputs

Specialized data loaders publish synchronous `*FromRows` entry points for
Parquet, Arrow, database, and other decoders that already produce row objects:

```javascript
import { parseUnifiedDatasetFromRows } from 'baselode';

const dataset = parseUnifiedDatasetFromRows({
  assayRows,
  structuralRows,
  geologyRows,
});
```

This preserves typed values and avoids serializing rows to CSV only to parse
them again. Existing CSV APIs remain backward compatible.

## Tool UI for assistant-ui

Baselode publishes schemas, React renderers, and a ready-made assistant-ui
toolkit for seven geoscience visualisation results: strip logs, 3D scenes,
scatter plots, histograms, box plots, violin plots, and ternary plots.

```bash
npm install baselode @assistant-ui/react zod
```

Register the renderer toolkit under the same names used by your backend tools:

```jsx
'use client';

import {
  AssistantRuntimeProvider,
  Tools,
  useAui,
} from '@assistant-ui/react';
import { createBaselodeAssistantUiToolkit } from 'baselode/assistant-ui';
import 'baselode/tool-ui/style.css';

const baselodeToolkit = createBaselodeAssistantUiToolkit({
  toolNames: {
    'strip-log': 'show_strip_log',
    'scatter-plot': 'plot_assays',
  },
});

export function BaselodeChat({ runtime, children }) {
  const aui = useAui({ tools: Tools({ toolkit: baselodeToolkit }) });
  return (
    <AssistantRuntimeProvider runtime={runtime} aui={aui}>
      {children}
    </AssistantRuntimeProvider>
  );
}
```

The backend returns a JSON result matching the selected primitive's published
Zod schema. Backend or server-only code can import those contracts without
loading React, Plotly, or Three.js:

```js
import {
  BASELODE_TOOL_UI_SCHEMA_CONTRACTS,
  parseBaselodeToolUiResult,
} from 'baselode/tool-ui/contracts';

const result = parseBaselodeToolUiResult('scatter-plot', toolResult);
if (!result.success) throw result.error;
```

See the [JavaScript guide](../../../docs/guide/javascript.md#tool-ui) for the
full result contract, loading/error behaviour, callbacks, and direct component
integration.

---

## Included in 0.1.0

- Drillhole collar, survey, assay, and geology/lithology models
- Downhole interval structures
- Basic validation utilities
- Strip log visualisations (numeric, categorical, geology)
- Map visualisations
- 3D visualisations

---

## Design Principles

- Explicit domain models (not generic tables)
- Minimal dependencies
- Visualisation tooling as key to data analysis
- Designed for integration with analytics, GIS, and AI systems

---

## Roadmap

Future releases may include:

- Geospatial helpers
- Interoperability with common mining formats
- Visualization adapters

---

## 3D Scene Architecture

`Baselode3DScene` is a thin orchestrator; rendering is handled by domain modules:

| Module | Responsibility |
|---|---|
| `drillholeScene.js` | Cylinder mesh building, assay coloring, camera fit |
| `blockModelScene.js` | Merged exterior-face block geometry, vertex colors |
| `structuralScene.js` | Structural disc meshes (dip/azimuth orientation) |
| `sceneClickHandler.js` | Canvas click/hover raycasting |
| `selectionGlow.js` | EffectComposer + OutlinePass per-object glow |
| `baselode3dCameraControls.js` | Orbit, fly, FOV, pan, dolly |

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later).

See the `LICENSE` file in this repository for full details.

---

## Contributing

Contributions and issue reports are welcome via GitHub.
