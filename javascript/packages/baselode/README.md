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
