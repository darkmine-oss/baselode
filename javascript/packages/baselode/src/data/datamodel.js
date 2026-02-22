/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Baselode Open Data Model for JavaScript/TypeScript
 *
 * Provides a consistent schema for data handling throughout the library.
 *
 * Individual data loaders apply common column mapping, but also accept user-provided column maps to handle variations in source data.
 */

// Standard field names
export const HOLE_ID = "hole_id";
export const LATITUDE = "latitude";
export const LONGITUDE = "longitude";
export const ELEVATION = "elevation";
export const AZIMUTH = "azimuth";
export const DIP = "dip";
export const FROM = "from";
export const TO = "to";
export const MID = "mid";
export const PROJECT_ID = "project_id";
export const EASTING = "easting";
export const NORTHING = "northing";
export const CRS = "crs";
export const DEPTH = "depth";
export const GEOLOGY_CODE = "geology_code";
export const GEOLOGY_DESCRIPTION = "geology_description";

/**
 * Minimum expected columns for drillhole collars
 * The collar forms the basis for hole_id and spatial location, so it is expected to exist in all datasets and be standardized as much as possible.
 */
export const BASELODE_DATA_MODEL_DRILL_COLLAR = {
  // A unique hole identifier across the entire dataset and all future data sets
  [HOLE_ID]: "string",
  // The hole ID from the original collar source
  "datasource_hole_id": "string",
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
  // The coordinate reference system of the collar coordinates for easting/northing, as an EPSG code or proj string
  [CRS]: "string"
};

export const BASELODE_DATA_MODEL_DRILL_SURVEY = {
  // The unique hole id that maps to the collar and any other data tables
  [HOLE_ID]: "string",
  // The depth along the hole where the survey measurement was taken / started
  [DEPTH]: "number",
  // The depth along the hole where the survey measurement ended, if applicable (some surveys are point measurements and may not have a 'to' depth)
  [TO]: "number",
  // The azimuth of the hole at the survey depth, in degrees from north
  [AZIMUTH]: "number",
  // The dip of the hole at the survey depth, in degrees from horizontal (negative values indicate downward inclination)
  [DIP]: "number"
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
  // Assays may be flattened (one column per assay type) or long (one row per assay type with an additional 'assay_type' column)
};

export const BASELODE_DATA_MODEL_DRILL_GEOLOGY = {
  [HOLE_ID]: "string",
  [FROM]: "number",
  [TO]: "number",
  [MID]: "number",
  [GEOLOGY_CODE]: "string",
  [GEOLOGY_DESCRIPTION]: "string"
};

/**
 * This column map is used to make a 'best guess' for mapping common variations in source column names to the baselode data model.
 * It is applied in the standardizeColumns function, but users can also provide their own column map to override or extend this mapping as needed.
 * The keys from the input source are normalized to lowercase and stripped of whitespace for more robust matching.
 * This dictionary is stored for human readability, then pivoted to make lookup quicker in code.
 * Be cautious of not mapping a source column to multiple baselode columns, as this can lead to unpredictable results.
 */
export const DEFAULT_COLUMN_MAP = {
  [HOLE_ID]: ["hole_id", "holeid", "hole id", "hole-id"],
  "datasource_hole_id": ["datasource_hole_id", "datasourceholeid", "datasource hole id", "datasource-hole-id", "company_hole_id", "companyholeid", "company hole id", "company-hole-id"],
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
  [AZIMUTH]: ["azimuth", "az", "dipdir", "dip_direction"],
  [DIP]: ["dip"],
  "declination": ["declination", "dec"],
  [DEPTH]: ["depth", "survey_depth", "surveydepth"]
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
