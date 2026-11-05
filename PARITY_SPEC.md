# Baselode JS/Python Parity Spec

## Goal

Keep the JavaScript module and Python package aligned in capability and naming intent, while allowing language-native return types and runtime differences.

## Scope

The two implementations should remain aligned for:

1. Data loading + column normalization for collar, survey, assay tables
2. Desurveying workflows
3. 1D strip/trace plotting helpers
4. 2D plan/section mapping helpers
5. 3D drillhole payload/scene helpers
6. Spatial extent bounds, CRS normalisation, reprojection, and center helpers
7. Block model primitive: grid definition + transforms, sub-block operations, validation, tonnage, diff
8. Geophysics raster filters and enhancements: numerical results, coordinate validation, derived band units, processing records and embedded version 1 provenance

## Runtime differences (intentional)

- JavaScript favors browser/runtime-native structures (arrays/objects, interactive scene APIs).
- Python favors DataFrame-centric workflows and figure/dataframe utilities.
- JS `loadTable` supports CSV/array sources in-browser; SQL/Parquet are out of runtime scope and should fail clearly.
- JavaScript specialized loaders expose synchronous `*FromRows` cores so
  external format decoders can supply structured rows without a CSV round
  trip; CSV functions remain adapters over the same domain transformations.
- 3D parity target is payload-level parity in both languages; interactive renderer remains JS-first.
- JavaScript `Extent` adds GeoJSON Polygon/Feature helpers; Python callers can
  use the existing Shapely `bbox` geometry for equivalent geometry workflows.
- Scientific processing of unresolved CRS identifiers/definitions requires explicit
  linear `metadata.crs_units`. The Python CRS database can resolve identifiers
  that the JavaScript proj4 registry cannot; JS requires that metadata in those
  cases rather than guessing a physical unit.
- CRS engines are runtime-native (`proj4` in JavaScript, `pyproj` in Python),
  with shared EPSG behavior and tolerance-based numeric parity checks.

### Python-first (no JS counterpart yet)

These belong in JS eventually but aren't there today. Listed here so the gap is intentional and tracked, not silent:

- **`baselode.adaptors.raw_gswa`** — HTTP client + SQL builders + DataFrame
  converters for the GSWA raw schema. Python-only. JS callers wanting GSWA
  data should hit the HTTP API directly through their own client and feed
  the results to JS loaders manually until a JS adaptor exists.
- **`baselode.drill.data.bundle_extras`** — folds non-canonical columns
  into a per-row `extra` dict matching the canonical
  `BASELODE_DATA_MODEL_*` schemas. JS publishes the matching `EXTRA`
  constant and includes the field in every schema, but does not yet have
  a JS `bundleExtras` helper to populate it.

When a JS counterpart lands, move the entry into the appropriate parity
contract capability and remove it from this list.

## Canonical parity contract

Machine-readable contract lives at:

- [test/data/parity_contract.json](test/data/parity_contract.json)

This file is the primary checklist for symbol-level parity and should be updated alongside API changes.

## Parity checks

Automated checks live at:

- [test/test_parity_contract.py](test/test_parity_contract.py)

Checks include:

- Python symbols listed in the contract are importable and present.
- JS barrel export file declares all contracted symbols.

## Change process

When adding/removing parity APIs:

1. Implement API change in both languages (or document intentional divergence).
2. Update [test/data/parity_contract.json](test/data/parity_contract.json).
3. Ensure [test/test_parity_contract.py](test/test_parity_contract.py) passes.
4. If divergence is intentional, add rationale under "Runtime differences" in this file.

## Geophysics operation catalogue and workflow v1

Python `baselode.geophysics.{list_operations,describe_operation,workflow_schema,magnetic_grid_recipe,validate_workflow,run_workflow}` corresponds to JavaScript `{listGeophysicsOperations,describeGeophysicsOperation,geophysicsWorkflowSchema,magneticGridRecipe,validateGeophysicsWorkflow,runGeophysicsWorkflow}` (main and `baselode/geophysics` entries). Both use the packaged operation catalogue, workflow schema and magnetic-grid recipe; a Python test checks the JSON copies match. Snake_case parameter names, graph semantics, structured states and resource bounds are shared. The workflow reference fixture checks numerical replay at 1e-10 tolerance; analytical plane tests independently check gradient and regional/residual wiring.

Execution uses existing kernels. Backend/library version strings intentionally differ by runtime. Python artifacts are GeophysicsRaster instances; JS artifacts use its portable raster shape. In workflow v1, arithmetic is restricted to add/subtract with exactly aligned, equally banded grids and matching unit strings/field types, although direct arithmetic APIs support additional cases. Direct APIs retain their existing metadata/context contracts. Sampling, display products, file I/O, gap filling/cropping, observation corrections, hashes, correction ledgers and arbitrary plugin registration are not workflow v1 operations. Later increments extend the allowlist/contracts explicitly.
