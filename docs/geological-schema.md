# Geological schema

The geological storage schema defines scientific tables, column types, units,
identity and interpretation. It is available in Python through
`baselode.datamodel.geological.get_geological_schema()` and in JavaScript through
`getGeologicalSchema()` from `baselode/geological-schema`. Use
`get_geological_table('drill.petrophysics')` or
`getGeologicalTable('drill.petrophysics')` for one table. The npm resource is
also exported as `baselode/geological-schema.json`.

The schema's `version` identifies its contract. `storageType` describes column
storage, not a JSON serialization format. The dataframe-oriented JSON Schemas
returned by `getBaselodeSchema()` describe their own processing inputs; the
qualified geological table names belong to this storage contract.

## Tables and observations

| Table | Meaning |
| --- | --- |
| `drill.collar` | Hole identity, collar location and drilling orientation |
| `drill.survey` | Downhole orientation stations grouped into complete survey runs |
| `drill.geology` | Lithology, weathering and regolith observations distinguished by observation kind |
| `drill.alteration` | Alteration components, intensity and style |
| `drill.mineralogy` | Mineral observations and abundance with measurement context |
| `drill.veins` | Vein characteristics and occurrence |
| `drill.structure` | Structural observations and structural orientation |
| `drill.geophysics` | In-hole instrument and wireline measurements |
| `drill.petrophysics` | Rock and specimen properties, including measurements on core |
| `drill.geotechnical` | Rock quality, core recovery and geotechnical observations |
| `drill.hyperspectral` | Spectral measurements and interpreted spectral properties |
| `drill.hydrogeology` | Groundwater levels, inflows and hydraulic observations |
| `drill.operations` | Drilling, construction and operational activities |
| `drill.interval_observation` | Contextual interval observations requiring their recorded kind and attributes for interpretation |
| `drill.geochemistry_flat` | Selected drill-sample chemistry in numeric analyte columns |
| `drill.qa_qc` | Quality-control samples and determinations with their control context |
| `drill.sample_context` | Specimen, fraction, aliquot and parent-sample lineage |
| `surface.surface_sample` | Independent field samples, collection context, location and selected chemistry |
| `surface.lab_assay` | Independent certificate determinations and their analytical context |
| `surface.sample_context` | Surface specimen, fraction, aliquot and parent-sample lineage |
| `surface.petrophysics` | Physical properties of surface samples and specimens |

Magnetic susceptibility measured on core belongs to petrophysics; susceptibility
logged downhole belongs to geophysics. Unknown measurement context remains
explicitly unresolved. Specific gravity is dimensionless. Density requires its
bulk or grain basis, specimen condition and method. Core recovery and RQD are
different quantities. Portable XRF is chemistry with its method recorded.

Numeric observation identifiers establish identity. Hole and sample labels are
source-scoped labels, and matching depths do not establish duplicate records.
Serialize `bigint` identifiers as decimal strings to preserve precision across
languages. Parent references can identify reserved identities before a parent
observation or location is materialized; a missing location is not an invented
collar. Surface samples and their children have surface parents.

Sample contexts describe lineage without storing a second set of assay values.
Create a context when specimen, fraction or aliquot identity needs representation.
Independent laboratory determinations retain their own identity and method.

## Depth, orientation and survey selection

Common drill depths are metres measured along the hole from the collar. Point,
interval, composite and unresolved support remain distinct. Composite components
retain their support and occurrence context. Do not infer missing interval ends,
swap reversed intervals or merge independent logs merely because depths coincide.

Borehole azimuth is clockwise from true north in `[0,360)`. Normalize a reported
360 to 0 and preserve the original and normalization in `audit`. Other invalid
angles require resolution. Borehole dip is negative downward: -90 is vertical
down, 0 horizontal and +90 vertical up. Structural dip is a separate convention
in the range 0 to 90 degrees.

`survey_run_key` groups stations from one run. Every station in that run shares
its selection rank, basis and status. Source hierarchy takes precedence; where
none exists, the most recent eligible source run date determines preference.
Rank 1 identifies the preferred run; higher ranks are alternatives. Missing or
tied evidence leaves preference unresolved and `selection_rank` null. Selection
does not splice unrelated stations into a synthetic preferred run.

## Chemistry and qualification

Wide numeric analyte columns contain the value used by ordinary numeric queries.
For an eligible result reported as `<0.01`, the value is `0.005`. For `>10`, the
value is the reported lower bound, `10`. Neither is an exact measured value.
Unknown detection limits and ambiguous sentinel values remain unresolved;
already calculated values are not halved again.

Associated JSONB preserves original text, qualifier, bound, units, method and
calculation. A table's `requiredCompanionColumns` identifies metadata that must
accompany its numeric results in queries, APIs, exports and tools. Interfaces
must visibly identify qualified values. Aggregates must expose their treatment
of qualified values and associated counts and lineage. Bound-aware comparisons
must distinguish a reported bound from the stored calculation.

Additional source fields retain their original key identity, types, repeated
occurrences and context in JSONB. Flattening must handle key collisions explicitly
and must not multiply unrelated arrays into artificial observation combinations.

## Coordinates

The Australia spatial profile uses authoritative `geography(Point,7844)` in
GDA2020 longitude/latitude order. `geometry(Point)` is a derived two-dimensional
MGA2020 easting/northing point whose SRID identifies its zone. `projected_srid`
must match that geometry's SRID. Both columns can have spatial indexes.

Use geography for queries spanning zones. Projected geometry operations require
a common SRID or an explicit transformation; a per-row CRS does not cause an
automatic transformation. Map and API WGS84 coordinates are derived outputs.
The Australia profile does not admit coordinates from arbitrary foreign datums.

Elevation is separate from horizontal position, in metres with an explicit
vertical datum; the mainland common reference is AHD71. Unknown elevations stay
null. Original coordinates, CRS, units and any original Z component remain in
source and audit metadata. Assigning an SRID labels coordinates; transforming
coordinates requires a known source CRS and an appropriate coordinate operation.

Copyright (C) 2026 Darkmine Pty Ltd.
