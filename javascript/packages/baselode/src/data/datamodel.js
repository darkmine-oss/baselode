/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Baselode Open Data Model for JavaScript/TypeScript
 *
 * Provides a consistent schema for data handling throughout the library.
 *
 * Individual data loaders apply common column mapping, but also accept
 * user-provided column maps to handle variations in source data.
 *
 * Mirrors the Python module ``baselode.datamodel`` — keep the two in sync.
 */

// --- Drilling and sampling primitives ---
export const DATASOURCE = "datasource";

export const HOLE_ID = "hole_id";
// Internal join key used by some sources (e.g. raw_gswa); leading underscore
// marks it as internal and signals downstream code to drop or hide it.
export const COLLAR_ID = "_collar_id";
export const DATASOURCE_HOLE_ID = "datasource_hole_id";
export const HOLE_TYPE = "hole_type";
export const MAX_DEPTH = "max_depth";

export const SURFACE_SAMPLE_ID = "surface_sample_id";
export const SURFACE_SAMPLE_TYPE = "surface_sample_type";
export const DATASOURCE_SURFACE_SAMPLE_ID = "datasource_surface_sample_id";

export const PROJECT_ID = "project_id";
export const REPORT_NUMBER = "report_number";

// --- Collar and surface-sample locations ---
export const LATITUDE = "latitude";
export const LONGITUDE = "longitude";
export const ELEVATION = "elevation";
export const EASTING = "easting";
export const NORTHING = "northing";
export const CRS = "crs";
export const DATE_START = "date_start";
export const DATE_END = "date_end";

// --- Drilling survey primitives ---
export const AZIMUTH = "azimuth";
export const DIP = "dip";
export const SURVEY_TYPE = "survey_type";

// --- Sampling primitives ---
export const SAMPLE_ID = "sample_id";
export const DATASOURCE_SAMPLE_ID = "datasource_sample_id";
export const FROM = "from";
export const TO = "to";
export const MID = "mid";
export const DEPTH = "depth";

// --- Structural geology primitives ---
export const STRIKE = "strike";
export const ALPHA = "alpha";
export const BETA = "beta";
export const GEOLOGY_CODE = "geology_code";
export const GEOLOGY_DESCRIPTION = "geology_description";

// --- Generics ---
export const COMMENTS = "comments";
/**
 * Catch-all column on every baselode-model object/row. Holds a per-row
 * dict of source-specific fields that don't map to the canonical schema.
 * Keeps the top-level columns predictable while preserving everything the
 * source provided. JS type marker is "object" (a plain JS object / Map).
 */
export const EXTRA = "extra";

// --- Constants and defaults ---
/** Standard null sentinel value in LAS-derived geophysics data. */
export const GEOPHYSICS_NULL_SENTINEL = -999.25;
// Python alias for the same value, kept for naming parity.
export const GEOPHYSICS_NULL = -999.25;


/**
 * Minimum expected columns for drillhole collars
 * The collar forms the basis for hole_id and spatial location, so it is
 * expected to exist in all datasets and be standardized as much as possible.
 */
export const BASELODE_DATA_MODEL_DRILL_COLLAR = {
  // A unique hole identifier across the entire dataset and all future data sets
  [HOLE_ID]: "string",
  // The hole ID from the original collar source
  [DATASOURCE_HOLE_ID]: "string",
  // The project ID or project code from the original collar source, if available
  [PROJECT_ID]: "string",
  // The latitude of the collar, in decimal degrees (WGS84)
  [LATITUDE]: "number",
  // The longitude of the collar, in decimal degrees (WGS84)
  [LONGITUDE]: "number",
  // The elevation of the collar, in meters above sea level (WGS84)
  [ELEVATION]: "number",
  // The easting coordinate of the collar, in meters (projected CRS)
  [EASTING]: "number",
  // The northing coordinate of the collar, in meters (projected CRS)
  [NORTHING]: "number",
  // The coordinate reference system of the collar coordinates for easting/northing,
  // as an EPSG code or proj string
  [CRS]: "string",
  // Internal join key used by source schemas (e.g. raw_gswa) — distinct from
  // the public hole_id.
  [COLLAR_ID]: "string",
  // Per-row dict of source-specific fields outside the canonical schema
  // (populated by `bundleExtras`; empty object when the source had nothing extra).
  [EXTRA]: "object"
};

export const BASELODE_DATA_MODEL_DRILL_SURVEY = {
  // The unique hole id that maps to the collar and any other data tables
  [HOLE_ID]: "string",
  // The depth along the hole where the survey measurement was taken / started
  [DEPTH]: "number",
  // The depth along the hole where the survey measurement ended, if applicable
  // (some surveys are point measurements and may not have a 'to' depth)
  [TO]: "number",
  // The azimuth of the hole at the survey depth, in degrees from north
  [AZIMUTH]: "number",
  // The dip of the hole at the survey depth, in degrees from horizontal
  // (negative values indicate downward inclination)
  [DIP]: "number",
  // Per-row dict of source-specific fields outside the canonical schema.
  [EXTRA]: "object"
};

export const BASELODE_DATA_MODEL_DRILL_ASSAY = {
  // The unique hole id that maps to the collar and any other data tables
  [HOLE_ID]: "string",
  // The depth along the hole where the assay interval starts
  [FROM]: "number",
  // The depth along the hole where the assay interval ends
  [TO]: "number",
  // The midpoint depth of the assay interval
  [MID]: "number",
  // assay value columns are variable and not standardized here.
  // Assays may be flattened (one column per assay type) or long
  // (one row per assay type with an additional 'assay_type' column).
  // Per-row dict of source-specific fields outside the canonical schema
  // (sample identifiers, lab metadata, detection-limit flags, etc.).
  [EXTRA]: "object"
};

export const BASELODE_DATA_MODEL_DRILL_GEOLOGY = {
  [HOLE_ID]: "string",
  [FROM]: "number",
  [TO]: "number",
  [MID]: "number",
  [GEOLOGY_CODE]: "string",
  [GEOLOGY_DESCRIPTION]: "string",
  // Per-row dict of source-specific fields outside the canonical schema.
  [EXTRA]: "object"
};

/**
 * Structural point data model schema
 */
export const BASELODE_DATA_MODEL_STRUCTURAL_POINT = {
  [HOLE_ID]: "string",
  [DEPTH]: "number",
  [DIP]: "number",
  [AZIMUTH]: "number",
  [ALPHA]: "number",
  [BETA]: "number",
  [COMMENTS]: "string",
  // Per-row dict of source-specific fields outside the canonical schema.
  [EXTRA]: "object"
};

/**
 * Geophysics interval data model schema.
 * Value columns (gamma, density, resistivity, etc.) are variable and not standardized.
 * Null sentinels (e.g. -999.25 from LAS-derived sources) are replaced with null on load.
 */
export const BASELODE_DATA_MODEL_GEOPHYSICS = {
  [HOLE_ID]: "string",
  [FROM]: "number",
  [TO]: "number",
  [MID]: "number",
  // value columns are variable — not standardized here
  // Per-row dict of source-specific fields outside the canonical schema.
  [EXTRA]: "object"
};

/**
 * Surface-sample data model schema (point samples — soil, rock chip, stream
 * sediment, etc.). Mirrors the Python ``BASELODE_DATA_MODEL_SURFACE_SAMPLE``.
 */
export const BASELODE_DATA_MODEL_SURFACE_SAMPLE = {
  [SAMPLE_ID]: "string",
  [DATASOURCE_SURFACE_SAMPLE_ID]: "string",
  [REPORT_NUMBER]: "string",
  [LATITUDE]: "number",
  [LONGITUDE]: "number",
  [ELEVATION]: "number",
  [EASTING]: "number",
  [NORTHING]: "number",
  [CRS]: "string",
  [SURFACE_SAMPLE_TYPE]: "string",
  // Per-row dict of source-specific fields outside the canonical schema
  // (analyte values, lab metadata, detection-limit flags, anumber, ...).
  [EXTRA]: "object"
};

/**
 * This column map is used to make a 'best guess' for mapping common variations
 * in source column names to the baselode data model.
 * It is applied in the standardizeColumns function, but users can also provide
 * their own column map to override or extend this mapping as needed.
 * The keys from the input source are normalized to lowercase and stripped of
 * whitespace for more robust matching.
 * This dictionary is stored for human readability, then pivoted to make lookup
 * quicker in code.
 * Be cautious of not mapping a source column to multiple baselode columns,
 * as this can lead to unpredictable results.
 */
export const DEFAULT_COLUMN_MAP = {
  [HOLE_ID]: ["hole_id", "holeid", "hole id", "hole-id"],
  [DATASOURCE_HOLE_ID]: ["datasource_hole_id", "datasourceholeid", "datasource hole id", "datasource-hole-id", "company_hole_id", "companyholeid", "company hole id", "company-hole-id"],
  [PROJECT_ID]: ["project_id", "projectid", "project id", "project-id", "project_code", "projectcode", "project code", "project-code", "companyId", "company_id", "companyid", "company id", "company-id", "dataset", "project"],
  [LATITUDE]: ["latitude", "lat"],
  [LONGITUDE]: ["longitude", "lon"],
  [ELEVATION]: ["elevation", "rl", "elev", "z"],
  [EASTING]: ["easting", "x"],
  [NORTHING]: ["northing", "y"],
  [CRS]: ["crs", "epsg", "projection"],
  [FROM]: ["from", "depth_from", "from_depth", "samp_from", "sample_from", "sampfrom", "fromdepth"],
  [TO]: ["to", "depth_to", "to_depth", "samp_to", "sample_to", "sampto", "todepth"],
  [GEOLOGY_CODE]: [
    "geology_code",
    "geologycode",
    "lith1",
    "lith1code",
    "lith1_code",
    "lithology",
    "plot_lithology",
    "rock1"
  ],
  [GEOLOGY_DESCRIPTION]: [
    "geology_description",
    "geologydescription",
    "geology_comment",
    "geologycomment",
    "geology comment",
    "lithology_comment",
    "lithology comment",
    "description",
    "comments"
  ],
  [AZIMUTH]: ["azimuth", "az", "dip_direction", "dipdir", "dip direction", "dipdrn", "dipdirection", "dip_dir", "computed_plane_azimuth", "calc_dipdir", "calc_dipdir_deg", "dipdir_calc", "dipdirect_calc"],
  [DIP]: ["dip", "computed_plane_dip", "calc_dip", "calc_dip_deg", "dip_calc"],
  [ALPHA]: ["alpha", "alpha_angle", "alpha_angle_deg", "alpha_2"],
  [BETA]: ["beta", "beta_angle", "beta_angle_deg", "beta_2"],
  "declination": ["declination", "dec"],
  [DEPTH]: ["depth", "survey_depth", "surveydepth", "md", "measured_depth", "dept"],
  [STRIKE]: ["strike", "str"]
};

/**
 * Pivot the DEFAULT_COLUMN_MAP for efficient reverse lookup
 * Maps normalized column names -> standardized baselode column names
 * @private
 */
export const _COLUMN_LOOKUP = {};
for (const [standardCol, variations] of Object.entries(DEFAULT_COLUMN_MAP)) {
  for (const variation of variations) {
    const normalized = variation.toLowerCase().trim();
    _COLUMN_LOOKUP[normalized] = standardCol;
  }
}
