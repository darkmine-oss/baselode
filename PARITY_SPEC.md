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

## Runtime differences (intentional)

- JavaScript favors browser/runtime-native structures (arrays/objects, interactive scene APIs).
- Python favors DataFrame-centric workflows and figure/dataframe utilities.
- JS `loadTable` supports CSV/array sources in-browser; SQL/Parquet are out of runtime scope and should fail clearly.
- 3D parity target is payload-level parity in both languages; interactive renderer remains JS-first.

### Python-first (no JS counterpart yet)

These belong in JS eventually but aren't there today. Listed here so the gap is intentional and tracked, not silent:

- **`baselode.adaptors.raw_gswa`** — HTTP client + SQL builders + DataFrame
  converters for the GSWA raw schema. Python-only. JS callers wanting GSWA
  data should hit the HTTP API directly through their own client and feed
  the results to JS loaders manually until a JS adaptor exists.
- **`baselode.extent.Extent`** — axis-aligned bbox + CRS class with
  `set_crs` / `to_crs` reprojection (via `pyproj`). JS has no equivalent
  spatial primitive yet; the JS spatial helpers operate on raw bounds
  arrays.
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
