# Attribute expansion

Add a generic long-form attribute promotion function with explicit mappings and deterministic candidate ranking. Existing parent rows and columns remain unchanged. Emit text fields and JSON text containing unmapped values, complete source records and conflicting candidates. Reject unknown output targets, ambiguous mapping names and unresolvable source relationships.

JSON text supports portable CSV/Parquet exports and database JSON ingestion without introducing a database dependency. Null and blank source values remain in evidence; they cannot mask usable promotion candidates. Source-specific aliases remain the caller's responsibility. The API adds no global schema or default loader behavior changes.

Verification covers source preservation, ranking, normalization collisions, unmapped nulls, invalid mappings, orphan relationships and Parquet roundtrip.
