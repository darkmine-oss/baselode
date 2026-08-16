# Release Notes

---

## Unreleased
**JavaScript desurvey API consolidation (breaking)**

- Removed `desurveyTraces`. Use `minimumCurvatureDesurvey` with canonical
  projected collar fields (`easting`, `northing`, `elevation`) and survey
  `depth` rows. The canonical API emits east/north coordinates and
  elevation-positive-up Z, matching the Python desurvey contract.
- The React demo and committed GSWA precomputed trace fixture now use that
  canonical path, removing the old visualization-only trajectory maths.

**Drillhole QA: auto-fix interval overlaps + numeric-negative BDL handling**

- New `baselode.drill.validate.fix_overlaps` resolves three classes of interval overlap automatically — touching (snap `A.to` down to `B.from` within `touching_tol`), exact duplicate (drop), resampled superset (drop the coarser interval when finer rows fully cover it and their length-weighted mean ≈ the coarse value within `merge_tol`) — and leaves genuine value-conflicts in a `conflicts` frame for human review.  Pass `return_diagnostics=True` to also get a per-row audit log of every snap / drop / kept-conflict.  Overlaps are the load-bearing failure mode for compositing, intercepts, and IDW — auto-resolving the safe cases shrinks the surgical-review list to true conflicts only.
- `replace_below_detection_limit` now handles two BDL conventions in a single call: the historical `<X` string sentinels (unchanged) **plus** the GSWA / WAMEX numeric-negative encoding where a value `V < 0` means below detection at MDL = `abs(V)`.  New `strategy` kwarg switches the replacement rule — `half-mdl` (default), `mdl`, `zero`, or `nan` — without breaking the existing `sentinel_factor` API.  Opt out of the numeric-negative path with `numeric_negative_sentinels=False` when negatives are real signed values.

**Desurvey: traces emit RL elevation (breaking)**

- `_direction_cosines` had a sign flip that produced trace `elevation` as TVD (positive going down) rather than RL (positive going up).  Every `*_desurvey` function and `attach_assay_positions` now emit elevation following the standard right-handed +Z = up convention — a vertical hole from a 0 m collar lands at –100 m elevation at 100 m depth.  OMF / Leapfrog / Surpac and any standard +Z-up 3D scene now render holes correctly.
- Downstream consumers that were reading the trace `elevation` field will see a sign flip.  Code paths that compared `trace.elevation - collar.elevation == TVD` should switch to `collar.elevation - trace.elevation == TVD`.

**3D scene polish**

- `parseDrillholesCSV` (JS) standardises the source `md` / `survey_depth` / `measured_depth` column to the canonical `depth` field and now also copies it onto an `md` field on each output point.  Scene renderers reading `point.md` (rather than `point.depth`) get a finite value, which fixes a silent grey-on-grey colour-by failure that affected every consumer of the standardised trace.
- Default `ASSAY_COLOR_PALETTE_10` swapped from a diverging blue↔red ramp (poor shape for grade data) to a magma-style sequential palette — low values fade into a dark scene background and high-grade samples pop as bright cream/gold.  Both `buildEqualRangeColorScale` and the 3D scene's internal colour pipeline share this export so the legend and rendered geometry stay in lockstep.

**3D IDW interpolation volumes**

- New JavaScript primitives `IDWSampler` (pure scalar-field sampler backed by a `SpatialHash3D`), `buildVoxelGrid` (async voxel-grid evaluator with progress + cancellation), `IDWVolumeRenderer` (Three.js shader-based ray-march of a `Data3DTexture`), and `IDWVolumeLayer` (one-call wrapper that does the whole pipeline and returns a `THREE.Object3D` for the scene).
- Fragment shader writes `gl_FragDepth` at the first significant ray hit so opaque objects placed inside the volume (sample-point markers, drillhole traces) get correctly occluded behind the visible voxel surface and stay visible in front of it.  Built on GLSL 300 ES with a manually-uploaded world-to-clip matrix so the depth value is always correct regardless of Three.js's GLSL3 fragment-stage uniform injection quirks.
- Axis-aligned slice planes via `layer.setClipBounds(min, max)` in normalised `[0, 1]` box-local space; cheap uniform-only update, no voxel-grid rebuild.
- Live display knobs (`setOpacity`, `setThreshold`, `setBlockMode`) that push straight through to the GPU.  IDW kernel parameters (`power`, `searchRadius`, `maxNeighbors`) trigger a rebuild with progress + cancellation.
- Demo viewer page at `/idw-volume` exercising the feature against a synthetic five-Gaussian-anomaly dataset.  Sample points are drawn as instanced spheres colour-matched to the volume's transfer function so the rendered field can be sanity-checked against the inputs.
- New "3D Interpolation Volumes" sections in the JavaScript guide + API reference.

**Compositing extensions: hard-boundary + true-thickness**

- `composite_intervals` (Python + JavaScript) grows three new kwargs that preserve the existing soft-mode call signature:
  - `mode="soft"` (default) — the prior length-weighted overlap behaviour, now documented and named explicitly (matches the dhcomp / Leapfrog convention)
  - `mode="hard"` + `boundary_col` — composites reset at every change in the boundary column within a hole; no composite straddles a coded contact
  - `residual={"discard","add_to_previous","distribute"}` — how to handle a sub-`length` tail at the end of a hard-mode domain
- New Python primitive `composite_true_thickness(intervals, traces, value_col, ref_dip, ref_dip_azimuth, ...)` for economic compositing: composites span equal *true thickness* perpendicular to a reference plane, with downhole bounds recovered from the inverse cumulative map.  Reports `length_md` + `length_true` per composite.  Python-only — depends on a desurveyed trace.
- JavaScript `compositeIntervals` mirrors the soft/hard modes (no JS true-thickness).
- Both implementations validate `method ∈ {average, sum}` and `length > 0` up front to fail loudly instead of producing nonsense (JS soft mode would have looped forever on `length === 0`).
- Updated docs: new "Compositing" sections in the Python + JavaScript guides, full API references for both, and a comparison table against `dhcomp` and `PyGSLIB` — true-thickness, all three residual rules, and a JS implementation are all features that don't exist in any other OSS compositor we could find.

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
