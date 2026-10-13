# Attribute promotion and expansion

`baselode.datamodel.attributes.promote_attributes` adds explicitly mapped text fields to unique parent records without changing existing columns or row order. Long-form attribute records must supply `parent_id`, `attribute_id`, `name` and `value`; an optional `modified_date` supports ranking. Additional scalar record metadata is retained.

Mapping entries declare `name`, `target` and integer `priority`. Names normalize camel boundaries and punctuation to lowercase snake_case. Lower priority wins, then newest modification date and lowest attribute ID. Null or blank values cannot win a promotion, but remain in source evidence. Unknown targets and normalized mapping collisions are errors.

`attributes_extra` is UTF-8 JSON text, suitable for Parquet and JSONB ingestion. Unmapped normalized keys contain an original scalar value or distinct-value array. Null values and normalization collisions remain represented. `_attribute_records` retains every source attribute record, including original names, values and metadata. `_conflicts` contains ranked candidates for mapped fields with differing names or usable values, with the selected candidate identified. Alias differences count as clashes even when values agree. `attribute_clash_count` counts clashing output fields.

Null/duplicate parent keys, null/duplicate attribute IDs and orphan attributes are rejected. No interval correction, scientific code translation or numerical imputation is performed. Mapping policies belong to the caller; the primitive does not infer synonyms from prevalence.
