# Release Notes

---

## v0.1.12
**Demo viewer Vercel deployment**

- Demo viewer now deploys to Vercel via GitHub Apps; `vercel.json` configures the build command, output directory, and SPA rewrites
- Build script (`scripts/vercel-build.sh`) builds the baselode library from source before building the demo app, resolving the local `file:` dependency
- GSWA sample data copied from `test/data/gswa/` at build time so it is served by the deployed app without committing large CSV files to the demo app directory
- Added Data Attribution page listing the GSWA Geochemistry dataset source, CC BY 4.0 licence, and required credit lines

---

## v0.1.11
**Plotly template system**

- Added `BASELODE_TEMPLATE` (Light) and `BASELODE_DARK_TEMPLATE` named Plotly templates for both Python and JavaScript
- Light template consolidates all default chart styling (axis lines, grid, tick sizes, trace defaults for scatter/bar/box/heatmap/contour) into a single object
- Dark template (`#1b1b1f` background, warm grid, yellow accent) matches the docs site dark mode; available as `"baselode-dark"` in the Plotly template registry
- `template` parameter added to all strip-log helpers (`buildPlotConfig`, `buildCategoricalStripLogConfig`, `TracePlot`, `plot_drillhole_trace`, etc.)
- Updated documentation with theming and colour mapping guide sections

---

## v0.1.10
**Semantic colour mapping**

- Added built-in colour maps: `'commodity'` (18 elements — Au, Ag, Cu, …) and `'lithology'` (~30 rock types)
- Numeric strip-log traces auto-detect commodity elements in column names (e.g. `Au_ppm`, `cu_pct`) and apply the matching colour without configuration
- `colourMap` parameter added to categorical strip-log helpers in both JS and Python
- `getColour` / `get_colour` and `resolveColourMap` / `resolve_colour_map` exported for direct use

---

## v0.1.9
**CI fix**

- Fixed GitHub Actions release workflow: corrected tag detection in the publish pipeline (two follow-up patches)

---

## v0.1.8
**GitHub Actions CI/CD**

- Added automated release workflow: on tag push, runs tests, builds Python and JS packages, publishes to PyPI and npm
- Added separate test-build workflow for inspecting build artefacts without publishing

---

## v0.1.7
**Polygonal grade block viewer**

- New `grade_blocks` module (Python + JS) for loading and rendering closed polyhedral meshes (grade shells, geologic domains)
- JSON schema v1.0 for grade block datasets (vertices, triangles, attributes, material colour/opacity)
- 3D selection glow and edge-highlight on click; `addGradeBlocksToScene` integrates with the existing `Baselode3DScene`
- New Polygon Blocks demo page in the demo viewer

---

## v0.1.6
**Geology / lithology strip logs**

- Added geology interval loading (`load_geology` / `loadGeology`) and `buildCategoricalStripLogConfig` for rendering banded colour strip logs directly from interval rows
- Improved strip log rendering performance; faster demo app data loading

---

## v0.1.5
**3D selection glow + documentation site**

- Outline selection shader (`OutlinePass` via `EffectComposer`) applied to drillholes, structural discs, and block model blocks on click
- VitePress documentation site launched and deployed to Vercel
- 3D scene code refactored; screenshots added to docs

---

## v0.1.4
**Block model viewer**

- New `blockmodel` subpackage: CSV loading, column normalisation, validation, property stats, and block filtering (Python + JS)
- `BlockModelWidget` React component for interactive 3D voxel rendering with property-based colour mapping

---

## v0.1.3
**3D structural discs**

- Structural measurements rendered as oriented discs in the 3D scene
- `buildStructuralDiscs` + `setStructuralDiscs` pipeline: interpolates trace positions, converts dip/azimuth to disc normals, renders via Three.js

---

## v0.1.2
**Structural geology data support**

- Alpha/beta and dip/azimuth structural point measurements: data loading, column normalisation, tadpole strip-log rendering
- `load_structures` (Python), `parseStructuralPointsCSV` (JS), `buildTadpoleConfig` and `buildStructuralStripConfig` visualisation helpers
- Library clean-up and expanded column name normalisation

---

## v0.1.1
**Packaging fix**

- Fixed npm package configuration for local release

---

## v0.1.0
**Initial release**

- Python package: drillhole data loading (`load_collars`, `load_surveys`, `load_assays`), minimum curvature desurveying, Plotly 2D strip logs and collar map
- JavaScript/React library: CSV parsing, column normalisation, desurveying, Plotly strip logs (`buildPlotConfig`, `TracePlot`), Three.js 3D scene with orbit controls, drillhole cylinder rendering
- Demo viewer React app with GSWA sample data
