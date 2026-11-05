# Release Notes

## Unreleased

**Geophysics processing contracts (TRK-526, Milestone 0 first increment)**

- Derivatives and analytic signal now update per-band units (for example `nT/m`, `nT/m^2`); tilt is labelled `degree`. Unknown local distances use `coordinate_unit`.
- Scientific filters and enhancements now reject geographic/geocentric CRSs, angular units and conflicting CRS/unit metadata. Reproject geographic data first. Display and sampling remain available. Distances continue to use native linear coordinate units.
- JavaScript retains processing support for projected GeoTIFF CRSs outside the local proj4 registry when explicit linear coordinate units are available.
- GeoTIFF readers retain per-band units, including when selecting or decimating bands.
- Python and JavaScript share regression fixtures for derived units as well as numerical values.

---

## v0.1.71
**Saving and editing geophysics grids (TRK-520)**

- Write grids: Python `write_ers`, `write_geotiff` and `save_raster` (by extension), and JS `encodeErs` and `encodeGeoTiff` for saving from the browser.
  - ERS writing needs only NumPy and maps GDA94, GDA2020, AGD66/84 and WGS84 systems to ERS datums and projections.
  - JS writes its own float GeoTIFFs, because geotiff.js's writer stores only 8-bit samples.
  - Files from either language read back with `load_raster`, `readErs` / `loadGeoTiff` and GDAL. Committed JS-written fixtures are checked with GDAL in the Python tests.
- Edit grids:
  - `crop` to a box and `clip` to a polygon (with holes; GeoJSON or Shapely);
  - `combine` aligned grids or a grid and a number, for residuals (`combine(tmi, regional, "subtract")`) and scaling. It refuses grids on different cell layouts or CRSs;
  - `fill_gaps` fills dropouts with a smooth surface that honours the data, optionally only within `max_distance` cells of data.
  - JS: `cropGeophysicsRaster`, `clipGeophysicsRaster`, `combineGeophysicsRasters` and `fillGeophysicsGaps`, checked cell for cell against Python with the shared fixture.
- Each step is recorded in `metadata["processing"]`.

---

## v0.1.70
**Sampling geophysics grids at drill data (TRK-519)**

- New `sample_points`, `sample_table`, `sample_profile` and `profile_stations` in `baselode.geophysics`, and JS `sampleGeophysicsRaster`, `sampleGeophysicsRows`, `sampleGeophysicsProfile` and `geophysicsProfileStations`.  Read grid values at collars, surface samples, desurveyed trace stations or along a section line, by bilinear or nearest-cell interpolation.  Points off the grid or next to a gap give `NaN` / `null`, never an invented value.
- Points in a different CRS from the grid are reprojected first (pyproj in Python, proj4 in JS), so MGA collars can be sampled against a GDA94 lat/long grid.  A shared fixture checks Python and JS agree.
- JS CRS helpers move to a shared module that also registers GDA2020 / MGA2020, AGD66/84 / AMG and WGS84 UTM zones for proj4.  `transformCrsPoints` exposes the same reprojection, for laying out profile lines in a grid's own units.
- Docs: the Python desurvey pages referred to a `desurvey_holes` function that does not exist; they now show `minimum_curvature_desurvey` and the other per-method functions.  The JS tilt derivative is documented in degrees, as implemented.

---

## v0.1.68
**Geophysics enhancements (TRK-513)**

- Standard potential-field enhancements in `baselode.geophysics` (Python) and JavaScript: `vertical_derivative` (1VD / 2VD via `order`), `horizontal_derivative`, `total_horizontal_derivative`, `tilt_derivative`, `analytic_signal`, `upward_continuation` and `reduce_to_pole` (induced magnetisation; rejected within 15° of the magnetic equator).  JS mirrors them as `geophysicsVerticalDerivative`, `geophysicsHorizontalDerivative`, `geophysicsTotalHorizontalDerivative`, `geophysicsTiltDerivative`, `geophysicsAnalyticSignal`, `geophysicsUpwardContinuation` and `geophysicsReduceToPole`.
- JavaScript gains a radix-2 FFT port of the wavelength filters too (`geophysicsLowPass`, `geophysicsHighPass`, `geophysicsBandPass`) plus `processGeophysicsRaster`, so every operation runs in the browser.  A cross-language reference fixture checks Python and JS agree cell for cell.
- Shared Fourier core now derives map-axis wavenumbers from the affine transform, fits the detrend plane in centred cell indices, and mirror-pads evenly around the grid to a power-of-two size (previously all padding went after the grid, making isotropic operations slightly directional).
- New DOM-free `baselode/geophysics` package entry (with type declarations) exporting the raster, ERS / GeoTIFF and processing functions without React, Plotly or the DOM — for running Fourier processing of large grids in a Web Worker.
- Raster metadata records coordinate units in `metadata.crs_units` (degrees vs metres) for ERS and GeoTIFF sources.
- Fix: ER Mapper grids with `CoordinateType = LATLONG` (e.g. GSWA ERMapper_grids releases) are now georeferenced; both readers previously only recognised `LL`.
- `loadGeoTiff` accepts typed arrays, as its type declarations already stated.

---

## v0.1.67
**ERS reader hardening (TRK-393)**

- Python and JS ERS readers parse multi-line `Key = { ... }` brace lists (e.g. region `SubRegion` vertices) as newline-joined strings instead of failing.
- Translated ER Mapper datasets, which point at an image in another format rather than raw grid values, are rejected with a clear message; ECW-compressed images say so explicitly.

---

## v0.1.66
**JavaScript ERS reader and raster decimation (TRK-393)**

- New `readErs` / `loadErs` (plus `parseErsHeader`, `ersCrs`) port Python's `read_ers` to JavaScript: BIL, all cell types, both byte orders, `NullCellValue`, registration cell, datum/projection → EPSG.  `loadErs` fetches string header URLs.
- New `decimateGeophysicsRaster` and a `maxCells` option on `loadGeoTiff` / `loadErs` match Python's `GeophysicsRaster.decimate` (area-weighted).  ERS grids decimate straight from the file bytes and GeoTIFFs stream from tile-aligned chunks, so large grids never materialise at full resolution.
- New `geophysicsRasterFromBands` helper; rasters built from typed bands keep source-precision nodata.

---

## v0.1.65
**Geophysics rasters (TRK-393)**

- New `baselode.geophysics` package (Python): `GeophysicsRaster` and `load_raster`.  `.ers` paths use a native NumPy ER Mapper reader (`read_ers`) — no GDAL needed — supporting BIL, all integer/real cell types, both byte orders, `RegistrationCoord` / `RegistrationCell`, and Australian / WGS84 datum-projection → EPSG.  Other formats use rasterio via the new `raster` extra (`pip install baselode[raster]`).
- Gaussian / Butterworth `low_pass`, `high_pass` and `band_pass` filters by wavelength, nodata-safe, with processing provenance recorded in metadata.
- `hillshade` with azimuth, altitude and automatic vertical exaggeration (`hillshade_z_factor`); gradients follow the affine transform, so sun azimuth stays geographic on south-up, west-up and rotated grids.
- Shared colour scales (viridis, magma, inferno, plasma, cividis, turbo, diverging, rainbow, magnetic, terrain, grayscale) with relative, absolute and histogram-equalised stretches, plus RGBA `colourize`.
- `GeophysicsRaster.decimate()` (area-weighted, memory bounded by input size) and `to_tool_ui_payload()` for chat-sized viewer results; nodata is compared in the source dtype so float32 sentinels such as `-1e32` never become measurements.
- JavaScript: `createGeophysicsRaster`, `loadGeoTiff` (GDAL nodata, full ModelTransformation, PixelIsPoint, tie-point offsets), `renderGeophysicsRaster`, `geophysicsHillshade`, `GEOPHYSICS_COLOR_SCALES` and stretch helpers matching Python's output (shared reference fixture).  `geotiff` is now a package dependency.
- New `GeophysicsRasterViewer` component and `BaselodeGeophysicsRasterToolUI` (static, chat-sized by default) with colour bar, raster summary, cursor read-out, reverse palette, stretch and vertical-exaggeration controls; the Tool UI schema accepts `band`, `units`, `stretch`, `reversePalette` and `zFactor`.  Demo viewer gains a geophysics raster page.

---

## v0.1.64
**GSWA structural observations (TRK-471)**

- Documented the start-depth plotting contract for structural observations: `plot_tadpole_log` and `structural_to_tadpole` use the supplied depth column as-is (preserving GSWA conversion sets `depth = from`) and never infer a midpoint; only rows with depth, dip and azimuth are drawn.
- `structural_point` JSON schema now describes `dip` / `azimuth` as structural-plane dip and dip direction (not hole orientation).  New "Structural observations" docs page.

---

## v0.1.63
**Attribute promotion and JSON expansion (TRK-468)**

- New `baselode.datamodel.attributes.promote_attributes` promotes explicitly mapped long-form attribute records (`parent_id`, `attribute_id`, `name`, `value`, optional `modified_date`) onto unique parent rows, ranked by mapping `priority`, then newest date, then lowest attribute ID.
- Unmapped attributes go to an `attributes_extra` UTF-8 JSON column; `_attribute_records` keeps every source record and `_conflicts` / `attribute_clash_count` make every promotion decision auditable.  Strict validation of keys, priorities and ISO dates.  Helpers `normalize_attribute_name` and `json_scalar`.

---

## v0.1.62
**zod 4.6.6+ required (breaking)**

- The `zod` peer dependency is now `^4.6.6` (was `>=3.0.0`).  zod 3.x and 4.x before 4.6.6 are affected by GHSA-mrhx-c7xc-m3w5, and the Tool UI schemas already target the zod 4 API.  Upgrade zod before upgrading baselode.

---

## v0.1.60 – v0.1.61
**Local-grid plan view**

- New `createPlanView(container, options)`: a Canvas plan view for points in a local X/Y frame — no CRS, basemap or plotting-library dependency.  Equal-scale axes, pan / zoom-to-cursor / fit, hover read-out, scale bar and group legend.  Math helpers `fitPlanView`, `planToScreen`, `screenToPlan`, `zoomPlanView` and `panPlanView` are exported too.

**Contributing**

- Added `CONTRIBUTING.md` with contribution guidelines and a contributor licence agreement.

---

## v0.1.59
**GSWA flat SQL queries (TRK-446)**

- `build_assay_flat_query` and `build_surface_sample_assay_flat_query` in `baselode.adaptors.raw_gswa.queries` take `source_release="2025-10"` (default) or `"2026-05"` to match either GSWA database snapshot shape.
- The drill builder resolves the stable `HoleId` through a left join to `dbo_collar`, including when `HoleId` is explicitly projected.

---

## v0.1.58
**Licensing**

- The PyPI and npm packages now ship the root `LICENSE` including the Darkmine Section 7 additional permission (the PyPI package previously bundled plain GPLv3; the npm package had no licence file).

---

## v0.1.57
**3D viewer overhaul**

- All drillholes render as one merged tube mesh (single draw call) with seamless joints and end caps, optional constant-pixel width, and a screen-width line level of detail when tubes would be sub-pixel.
- Colour is resolved in the shader from a per-hole interval texture indexed by measured depth: narrow intervals survive sparse surveys, and changing attribute, palette or binning (quantile / linear / log, stepped or smooth) via `setDrillholeColorBy` never rebuilds geometry.
- Navigation: damped orbit with zoom-to-cursor and pivot-under-cursor, double-click focus, animated fit / presets, perspective ↔ orthographic toggle, Z-up first-person walk mode (replaces FlyControls), Blender-style keyboard map.
- Cube viewport gizmo with Z-up face layout, faces-only targets and hover feedback (new `gizmoSize` scene option); ground grid, extent box, depth-cue fog, collar markers and fading hole-id labels.
- New `Baselode3DHud` component: north arrow, scale bar, plan mini-map with camera footprint, cursor coordinates and key cheat-sheet.
- Geometry is stored relative to the bounds centre so projected coordinates keep float32 precision.

---

## v0.1.56
**Block models as a primitive (TRK-417)**

- New `BlockModelDefinition` (Python) / `createBlockModelDefinition` (JS): origin, base block size, extent, optional parent size, azimuth/dip/plunge rotation, CRS — with `local_to_world` / `world_to_local`, `index_to_world` / `world_to_index`, bounds / corners, and a JSON round-trip that also reads the legacy `*_meta.json` shape.
- Sub-blocking built in: blocks carry `i, j, k, ni, nj, nk` (base-cell index + extent) alongside `x, y, z, dx, dy, dz`; either encoding loads and the other is derived.  New `block` table in `baselode.datamodel` and the JSON schemas.
- `BlockModel` gains `validate()` (alignment, extent, overlap via cell walk, duplicate index, index consistency, parent containment), `regularize()`, `to_parent_blocks()` (mass-weighted means, majority categoricals, `fill_fraction`), `block_at()` / `sample_at()`, `select()` / `clip()`, `tonnage()` / `grade_tonnage()`, `diff()` (first cut at GH #16) and `save()`.  JS mirrors every operation as functions over `{ definition, blocks }`; a shared sub-blocked fixture with Python-computed expectations pins parity.
- Existing loader / stats / filter APIs and the legacy metadata fields are unchanged; `BlockModel(blocks, metadata)` keeps its positional signature (`definition` is keyword-only).

---

## v0.1.53
**Terrain surfaces in the 3D scene (TRK-395)**

- New `createTerrainSurface` and scene methods `setTerrain` / `clearTerrain` / `setTerrainOpacity` / `setTerrainVisible` / `getTerrain`: builds a height-grid mesh from an elevation grid + bounds in scene units, leaves NoData quads as holes, optional perimeter skirt, decimates to a `vertexBudget`, and never applies vertical exaggeration silently.  Malformed grids (ragged, degenerate, fractional dimensions) throw instead of rendering an empty surface.

---

## v0.1.52
**Desurvey and survey QA fixes (GH-96)**

- Every desurveyed trace now starts at the collar: when the first station is below 0 m its orientation is extended straight up, so a single deep station no longer gives a zero-length trace.
- New `midpoint_tangential` desurvey method (Python `midpoint_tangential_desurvey` + JS), registered on `DrillholeSet` in both languages.
- `validate_drillhole_db` gains `survey_null_orientation` (error) and `survey_no_usable_stations` (warning) checks; new fix helpers `drop_unusable_survey_rows` and `synthesise_collar_station` (Python + JS).  `fix_single_station_surveys` accepts `azimuth_col` / `dip_col`.
- `fix_overlaps` gains `precedence_col` / `precedence` to resolve interleaved sampling campaigns by dataset rank.
- Python support widened to `requires-python >= 3.10`.  `load_geophysics` no longer turns a blank `hole_id` into `"nan"` on pandas 2.x.

---

## v0.1.51
**3D sections and slabs (TRK-384)**

- New `SectionHelper` (orthographic vertical cross-section aligned to X or Y) and `SliceHelper` (movable finite slab, `setWidth` / `step`) for `Baselode3DScene`.  They preserve host clipping planes and are mutually exclusive.
- `Baselode3DControls` gains section / slice controls with a position overview map showing scene objects; the section camera follows the clipping plane and keeps pan and zoom.

---

## v0.1.50
**JavaScript desurvey API consolidation (breaking)**

- Removed `desurveyTraces`. Use `minimumCurvatureDesurvey` with canonical
  projected collar fields (`easting`, `northing`, `elevation`) and survey
  `depth` rows. The canonical API emits east/north coordinates and
  elevation-positive-up Z, matching the Python desurvey contract.
- Hole-ID joins between collars and surveys preserve the original case.
- The React demo and committed GSWA precomputed trace fixture now use that
  canonical path, removing the old visualization-only trajectory maths.

---

## v0.1.49
**3D categorical colouring (TRK-317)**

- Categorical attributes (e.g. geology) split each survey segment at interval boundaries, so sparse surveys no longer paint a whole segment with its dominant category.
- The assay-presence colour mode always renders as presence, even when the categorical flag is set.

---

## v0.1.46 – v0.1.48
**Row-object loaders (JS)**

- New `*FromRows` entry points accept already-parsed row objects (Parquet, Arrow, LAS, database results) without a CSV round trip — e.g. `parseAssaysFromRows`, `parseStructuralFromRows`, `parseDrillholesFromRows`, `parseGeologyFromRows`, `parseGeophysicsFromRows`, `parseBlockModelFromRows` and `parseUnifiedDatasetFromRows`.  `loadTable`, `loadCollars`, `loadSurveys`, `loadAssays` and `loadGeology` also accept row arrays.  Existing CSV functions are unchanged.

**Canonical export layer (Python)**

- New `baselode.export` (`write_project`, `normalize_table`): atomically writes matching CSV / Parquet tables plus a manifest.  Canonical identifiers (`hole_id`, `sample_id`, `project_id`, …) are exported as nullable strings, keeping integer spelling (`1001`, not `1001.0`); nested values are JSON-encoded.

**Desurvey robustness**

- Python desurvey ignores rows missing a hole ID, usable collar coordinates or usable survey measurements instead of failing; missing collar elevation defaults to zero.

---

## v0.1.45
**JavaScript `Extent`**

- New `Extent` class (also via the lightweight `baselode/extent` entry) mirroring Python: `fromBbox`, `toCrs` reprojection, `setCrs`, `center`, and deterministic GeoJSON via `toPolygon` / `toFeature` / `toFeatureCollection`.  Built-in definitions for WGS84, Web Mercator, GDA94 and MGA zones 49–58.
- Python `Extent.to_crs` now transforms all four corners, so projected envelopes are no longer clipped.

---

## v0.1.44
**assistant-ui integration (TRK-300)**

- New `baselode/assistant-ui` entry: `createBaselodeAssistantUiToolkit` registers Baselode's Tool UI renderers (strip log, 3D scene, scatter, histogram, box, violin, ternary) with assistant-ui under your backend tool names.  `@assistant-ui/react` is an optional peer dependency.
- New `baselode/tool-ui/contracts` entry exposes the Zod result contracts (`BASELODE_TOOL_UI_SCHEMA_CONTRACTS`, `parseBaselodeToolUiResult`) for server code without loading React, Plotly or Three.js.
- TypeScript declarations for the Tool UI, contracts and assistant-ui entries.

---

## v0.1.40 – v0.1.43
**Strip-log fixes and options**

- Fixed a Plotly draw / cleanup race in `TracePlot`, the Tool UI and panel wrappers when charts unmount or re-render quickly.
- Shared categorical colour maps: `TracePlot` point logs, structural plots (`colourMap`) and the 3D drillhole scene (`categoryColorMap`) honour a caller-supplied category → colour map.
- New `TracePlot` `config.depthRange` (`[from, to]`) pins a shared measured-depth axis across all display types.

---

## v0.1.38
**Strip-log track types and patterns (TRK-241)**

- New numeric chart geometries in Python and JS: heat-strip, plus stepped and filled line options (combinable), and per-track log scale (`log_scale` / `logScale`).  Legacy `colored-line` / `filled-line` / `step-line` strings still render.
- New tracks: two-curve fill, percent-composition, depth annotations, point log and split dip / azimuth (`plot_two_curve_fill`, `plot_composition_log`, `plot_depth_annotations`, `plot_dip_azimuth_log` / `buildTwoCurveFillConfig`, `buildCompositionConfig`, `buildDepthAnnotationsConfig`, `buildPointLogConfig`, `buildDipAzimuthConfig`), available as first-class chart types.
- Lithology hatch patterns on categorical bands (`LITHOLOGY_PATTERNS`, `resolve_pattern_map` / `resolvePatternMap`).
- `alpha_beta_to_dip_azimuth` / `alphaBetaToDipAzimuth` oriented-core conversion, validated against a shared reference fixture.
- Every track pins an identically padded depth axis so tracks of a hole line up; new "Start at 0" option (`start_from_zero` / `startFromZero`).
- Redesigned comments track (theming, text budget, hover); below-detection negatives floored at zero on area / colour geometries (raw value kept in hover); dark-template-safe structural palettes.
- `TracePlot` moves chart type, colour-by and toggles into a settings popover.
- Fix: `parseSurveyCSV` treats blank dip / azimuth cells as missing instead of fabricating 0° stations.

---

## v0.1.37
**Strip-log graded line, colour-by and multi-assay (TRK-224)**

- Graded (value-coloured) line chart type on the magma ramp; colour a numeric track by a separate categorical column (`color_by` / `colorBy`); multi-assay stacked line and bar tracks (`multi-line`, `multi-stacked`; Python `plot_multi_assay`).  Python, JS and Tool UI at parity.
- Bar tracks size each bar to its interval; hover is depth-unified (`y unified`).
- 3D drillhole camera stays in a Z-up orbit; legacy Y-up saved views are converted on restore.

---

## v0.1.35
**Drillhole QA: auto-fix interval overlaps + numeric-negative BDL handling**

- New `baselode.drill.validate.fix_overlaps` resolves three classes of interval overlap automatically — touching (snap `A.to` down to `B.from` within `touching_tol`), exact duplicate (drop), resampled superset (drop the coarser interval when finer rows fully cover it and their length-weighted mean ≈ the coarse value within `merge_tol`) — and leaves genuine value-conflicts in a `conflicts` frame for human review.  Pass `return_diagnostics=True` to also get a per-row audit log of every snap / drop / kept-conflict.
- `replace_below_detection_limit` now handles two BDL conventions in a single call: the historical `<X` string sentinels (unchanged) **plus** the GSWA / WAMEX numeric-negative encoding where a value `V < 0` means below detection at MDL = `abs(V)`.  New `strategy` kwarg switches the replacement rule — `half-mdl` (default), `mdl`, `zero`, or `nan` — without breaking the existing `sentinel_factor` API.  Opt out of the numeric-negative path with `numeric_negative_sentinels=False` when negatives are real signed values.

**Desurvey: traces emit RL elevation (breaking)**

- `_direction_cosines` had a sign flip that produced trace `elevation` as TVD (positive going down) rather than RL (positive going up).  Every `*_desurvey` function and `attach_assay_positions` now emit elevation following the standard right-handed +Z = up convention — a vertical hole from a 0 m collar lands at –100 m elevation at 100 m depth.  OMF / Leapfrog / Surpac and any standard +Z-up 3D scene now render holes correctly.
- Downstream consumers that were reading the trace `elevation` field will see a sign flip.  Code paths that compared `trace.elevation - collar.elevation == TVD` should switch to `collar.elevation - trace.elevation == TVD`.

**3D scene polish**

- `parseDrillholesCSV` (JS) standardises the source `md` / `survey_depth` / `measured_depth` column to the canonical `depth` field and now also copies it onto an `md` field on each output point, fixing a silent grey-on-grey colour-by failure for renderers reading `point.md`.
- Default `ASSAY_COLOR_PALETTE_10` swapped from a diverging blue↔red ramp to a magma-style sequential palette — low values fade into a dark scene background and high-grade samples pop as bright cream/gold.  `buildEqualRangeColorScale` and the 3D scene share this export so legend and geometry stay in lockstep.

---

## v0.1.34
**3D IDW interpolation volumes**

- New JavaScript primitives `IDWSampler` (pure scalar-field sampler backed by a `SpatialHash3D`), `buildVoxelGrid` (async voxel-grid evaluator with progress + cancellation), `IDWVolumeRenderer` (Three.js shader-based ray-march of a `Data3DTexture`), and `IDWVolumeLayer` (one-call wrapper that does the whole pipeline and returns a `THREE.Object3D` for the scene).
- Fragment shader writes `gl_FragDepth` at the first significant ray hit so opaque objects inside the volume (sample markers, drillhole traces) are correctly occluded behind the visible voxel surface and stay visible in front of it.
- Axis-aligned slice planes via `layer.setClipBounds(min, max)` in normalised `[0, 1]` box-local space; cheap uniform-only update, no voxel-grid rebuild.
- Live display knobs (`setOpacity`, `setThreshold`, `setBlockMode`) push straight through to the GPU.  IDW kernel parameters (`power`, `searchRadius`, `maxNeighbors`) trigger a rebuild with progress + cancellation.
- Demo viewer page at `/idw-volume` exercising the feature against a synthetic five-Gaussian-anomaly dataset.
- New "3D Interpolation Volumes" sections in the JavaScript guide + API reference.

---

## v0.1.33
**Interactive plot panels (TRK-119)**

- New React wrappers that bundle each analytics plot with its own pickers and toggles: `BaselodeScatterPanel`, `BaselodeHistogramPanel`, `BaselodeBoxPanel`, `BaselodeViolinPanel`, `BaselodeTernaryPanel`, `BaselodeStripLogPanel` and the N-up `BaselodeStripLogGrid`.  Each works uncontrolled or controlled (`value` + `onChange`) and is themeable via `--baselode-*` CSS custom properties.
- Exported helpers `detectNumericColumns`, `detectCategoricalColumns`, `defaultColorByColumn`.
- `TracePlot` controls use a fixed row layout so long hole IDs no longer overflow strip-log grids.

---

## v0.1.32
**JSON Schemas for the data model (TRK-112)**

- `baselode.datamodel` is now a package (existing imports unchanged) with `to_json_schema` / `to_json_schema_all`, generating Draft 2020-12 schemas (primary / foreign keys, units, descriptions, nullability) for every canonical table.
- JS ships the same document as `BASELODE_DATA_MODEL_SCHEMAS` with `getBaselodeSchema(name)`.

---

## v0.1.31
**Compositing extensions: hard-boundary + true-thickness**

- `composite_intervals` (Python + JavaScript) grows three new kwargs that preserve the existing soft-mode call signature:
  - `mode="soft"` (default) — the prior length-weighted overlap behaviour, now documented and named explicitly (matches the dhcomp / Leapfrog convention)
  - `mode="hard"` + `boundary_col` — composites reset at every change in the boundary column within a hole; no composite straddles a coded contact
  - `residual={"discard","add_to_previous","distribute"}` — how to handle a sub-`length` tail at the end of a hard-mode domain
- New Python primitive `composite_true_thickness(intervals, traces, value_col, ref_dip, ref_dip_azimuth, ...)` for economic compositing: composites span equal *true thickness* perpendicular to a reference plane.  Reports `length_md` + `length_true` per composite.  Python-only — depends on a desurveyed trace.
- JavaScript `compositeIntervals` mirrors the soft/hard modes (no JS true-thickness).
- Both implementations validate `method ∈ {average, sum}` and `length > 0` up front to fail loudly instead of producing nonsense (JS soft mode would have looped forever on `length === 0`).
- New "Compositing" sections in the Python + JavaScript guides and API references, with a comparison table against `dhcomp` and `PyGSLIB`.

---

## v0.1.30
**Analytics plots (TRK-52)**

- New JS config builders returning Plotly `{data, layout}`: `buildScatterPlotConfig`, `buildHistogramPlotConfig` (per-axis `log: { x, y }`, `barmode` overlay / stack / group, shared bin edges), `buildBoxPlotConfig`, `buildViolinPlotConfig` and `buildTernaryPlotConfig`, with categorical colouring that cycles `BASELODE_COLORWAY` for groups the colour map doesn't cover.
- Matching Tool UI components (`BaselodeScatterPlotToolUI`, `BaselodeHistogramPlotToolUI`, `BaselodeBoxPlotToolUI`, `BaselodeViolinPlotToolUI`, `BaselodeTernaryPlotToolUI`) and Zod schemas.  Demo viewer gains an Analytics page.

---

## v0.1.29
**Trajectory interpolation (TRK-108)**

- New `baselode.drill.desurvey.interpolate_trajectory(traces, depths)` / JS `interpolateTrajectory`: easting / northing / elevation (and azimuth / dip when present) at any downhole depth; out-of-range depths and unknown holes give NaN rows.
- `attach_assay_positions`, `attach_structure_positions`, `intervals_to_omf_lines` and JS `attachAssayPositions` now use linear interpolation instead of nearest-sample lookup (positions shift slightly, more accurately, at coarse trace steps).

---

## v0.1.28
**Desurvey cross-validation (TRK-117 / TRK-118)**

- Desurvey methods are now cross-validated against wellpathpy to ≤ 1 cm.
- `balanced_tangential` (Python + JS) now uses the canonical Walstrom form (average of direction cosines).  Behaviour change: positions on strongly doglegged holes can shift by centimetres to metres.

---

## v0.1.27
**`DrillholeSet` container (TRK-113)**

- New `DrillholeSet` (Python + JS) bundles collar, survey and named interval tables, delegating to the existing APIs: `validate()`, `desurvey()` (cached traces), and in Python `composite()` and `to_omf()`.

---

## v0.1.25
**OMF interop (TRK-111)**

- New `baselode.drill.omf` round-trips drilling data through Open Mining Format v1 (Leapfrog, Deswik, Micromine, …): `collars_to_omf_points`, `traces_to_omf_lines`, `intervals_to_omf_lines`, `build_omf_project`, `write_omf`, `read_omf`.  Requires the new `omf` extra (`pip install baselode[omf]`).  Python-only.

---

## v0.1.24
**Drillhole database validation (TRK-110)**

- New `validate_drillhole_db(collar, survey, interval_tables=None, ...)` / JS `validateDrillholeDb` returns a structured `{summary, issues}` report (never raises) covering duplicate hole IDs, single-station surveys, azimuth / dip range (`allow_full_circle` option), orphan intervals, negative lengths, intervals beyond max depth, gaps, overlaps and below-detection sentinels.
- Fix helpers in both languages: `fix_single_station_surveys`, `replace_below_detection_limit`, `normalize_azimuth`, `drop_orphan_intervals`, `swap_inverted_intervals`.

---

## v0.1.23
**Interval algebra (TRK-106)**

- New `baselode.drill.intervals` / JS equivalents: `interval_length`, `from_to_midpoints`, `detect_gaps`, `detect_overlaps`, `split_at`, `clip` and `merge_tables` (`intervalLength`, `fromToMidpoints`, `detectGaps`, `detectOverlaps`, `splitAt`, `clip`, `mergeTables`).

---

## v0.1.21 – v0.1.22
**Strip-log units and selector options**

- Strip logs show value units in the axis title, track header, selector and hover.  `BaselodeStripLogToolUI` accepts a `propertyMeta` map (`unit`, `sourceAttribute`); helpers `formatPropertyLabel`, `resolvePropertyLabelParts`, `derivePropertyMeta`.
- `TracePlot` gains `holeSelector` (hole, group + hole, or custom field), `showHoleSelect` / `showPropertySelect` / `showChartTypeSelect`, and keeps dropdowns visible when a hole has no data.  Dark-mode styling aligned with light mode.

---

## v0.1.20
**Raw GSWA adaptor**

- New `baselode.adaptors.raw_gswa` (columns, `convert`, `queries`, and `RawGswaApiClient` via the new `api` extra) converts raw GSWA data to the canonical baselode model.
- New canonical data-model fields (e.g. `datasource`, `hole_type`, `max_depth`, `surface_sample_id`, `project_id`, `crs`) in Python and JS, and a per-row `extra` dict column with `baselode.drill.data.bundle_extras`.

---

## v0.1.19
**Tool UI components**

- New `baselode/tool-ui` entry with `BaselodeStripLogToolUI` and `Baselode3DSceneToolUI`, Zod schemas (`SerializableBaselodeStripLogSchema`, `SerializableBaselode3DSceneSchema` and `safeParse…` helpers) and `baselode/tool-ui/style.css`.  Adds `zod` as a peer dependency.

---

## v0.1.18
**Licensing**

- Added GPLv3 Section 7 additional permissions for copyright holder Darkmine Pty Ltd.

---

## v0.1.17
**Geophysics logs and 3D strip logs**

- Downhole geophysics data model and loaders: Python `load_geophysics`, LAS via `baselode.drill.las.load_geophysics_las` (new `las` extra); JS `parseGeophysicsCSV`, `parseLasFile`, `geophysicsToStripLogs`.
- Floating 2D strip-log panels beside drillholes in the 3D scene (`setStripLogs` / `clearStripLogs`), background colour toggle and adjustable zoom sensitivity.

---

## v0.1.16
**Significant intercepts**

- New `significant_intercepts` (Python `baselode.drill.intercepts`) / `significantIntercepts` (JS) for drillhole assay intercept calculation.

---

## v0.1.15
**3D raster overlays**

- Georeferenced image overlays in the 3D scene: `createRasterOverlay`, `addRasterOverlay`, `removeRasterOverlay`, `setRasterOverlayOpacity` / `Visibility` / `Elevation`, `listRasterOverlays`, `clearRasterOverlays`.

---

## v0.1.14
**Core photo viewer**

- New `CorePhotoTable` / `CorePhotoViewer` React components (zoom / pan, thumbnail → full-res level of detail, side-by-side linked or unlinked holes) with `corePhotoViz` helpers, and Python `plot_core_photo_log`.  New "Core photo viewer" guide page.

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
