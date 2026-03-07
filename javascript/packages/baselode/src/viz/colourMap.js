/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Semantic colour mapping system for Baselode graphs.
 *
 * This module provides the **semantic colour mapping** layer of Baselode graph
 * styling.  Plotly templates handle overall chart appearance (fonts, layout,
 * backgrounds); this module maps *domain values* (commodities, lithologies,
 * categorical logging data) to specific colours.
 *
 * Built-in maps ship sensible defaults.  Users can supply their own
 * dictionaries or override individual entries via {@link resolveColourMap}.
 *
 * @module colourMap
 */

/**
 * Fallback colour used when a value is absent from any colour map.
 * @type {string}
 */
export const FALLBACK_COLOUR = '#7f7f7f';

/**
 * Built-in semantic colours for common commodity / assay elements.
 * @type {Object.<string, string>}
 */
export const COMMODITY_COLOURS = {
  Au:  '#FFD700', // gold
  Ag:  '#C0C0C0', // silver
  Cu:  '#B87333', // copper / orange-brown
  Fe:  '#8B4513', // iron / rusty brown
  Ni:  '#4CAF50', // nickel / green
  Zn:  '#78909C', // zinc / blue-grey
  Pb:  '#607D8B', // lead / slate
  Mo:  '#9C27B0', // molybdenite / purple
  Co:  '#2196F3', // cobalt / blue
  Li:  '#FF5722', // lithium / deep orange
  Mn:  '#795548', // manganese / brown
  Cr:  '#009688', // chromium / teal
  V:   '#673AB7', // vanadium / deep purple
  W:   '#FF9800', // tungsten / amber
  Sn:  '#9E9E9E', // tin / medium grey
  Ti:  '#00BCD4', // titanium / cyan
  Al:  '#FFEB3B', // aluminium / yellow
  U:   '#8BC34A', // uranium / lime green
};

/**
 * Built-in semantic colours for common lithology categories.
 * @type {Object.<string, string>}
 */
export const LITHOLOGY_COLOURS = {
  // Sedimentary
  shale:        '#607D8B',
  mudstone:     '#78909C',
  siltstone:    '#90A4AE',
  sandstone:    '#F5CBA7',
  limestone:    '#B0BEC5',
  dolomite:     '#CFD8DC',
  conglomerate: '#D7CCC8',
  coal:         '#212121',
  // Iron-formation
  BIF:          '#8B4513',
  ironstone:    '#A0522D',
  // Igneous – intrusive
  granite:      '#EF9A9A',
  granodiorite: '#F48FB1',
  diorite:      '#CE93D8',
  gabbro:       '#546E7A',
  peridotite:   '#33691E',
  pegmatite:    '#FFF9C4',
  // Igneous – extrusive / volcanic
  basalt:       '#37474F',
  andesite:     '#78909C',
  rhyolite:     '#FFCCBC',
  dacite:       '#FFAB91',
  tuff:         '#D7CCC8',
  breccia:      '#BCAAA4',
  // Metamorphic
  schist:       '#80CBC4',
  gneiss:       '#4DB6AC',
  quartzite:    '#E0F7FA',
  marble:       '#F5F5F5',
  slate:        '#455A64',
  phyllite:     '#80DEEA',
  // Other
  quartz:       '#ECEFF1',
  calcite:      '#F9FBE7',
  vein:         '#FFFFFF',
  unknown:      '#9E9E9E',
};

/**
 * Registry of all built-in colour maps, keyed by lower-case name.
 * @type {Object.<string, Object.<string, string>>}
 */
export const BUILTIN_COLOUR_MAPS = {
  commodity: COMMODITY_COLOURS,
  lithology: LITHOLOGY_COLOURS,
};

/**
 * Return the colour for *value* from *colourMap*, or *fallback* if absent.
 *
 * The lookup is case-insensitive: both *value* and map keys are trimmed and
 * lower-cased before comparison.
 *
 * @param {string} value - Domain value to look up (e.g. `"Cu"`, `"granite"`).
 * @param {Object.<string, string>} colourMap - Mapping of domain values to CSS colour strings.
 * @param {string} [fallback=FALLBACK_COLOUR] - Colour to return when *value* is not found.
 * @returns {string} A CSS colour string.
 */
export function getColour(value, colourMap, fallback = FALLBACK_COLOUR) {
  if (!colourMap || value == null) return fallback;
  const key = String(value).trim();
  // Exact match first
  if (Object.prototype.hasOwnProperty.call(colourMap, key)) return colourMap[key];
  // Case-insensitive match
  const keyLower = key.toLowerCase();
  for (const [mapKey, mapColour] of Object.entries(colourMap)) {
    if (String(mapKey).trim().toLowerCase() === keyLower) return mapColour;
  }
  return fallback;
}

/**
 * Return a colour map object from a name or pass through a user-supplied object.
 *
 * @param {string|Object.<string, string>|null|undefined} nameOrMap
 *   - `null` / `undefined`: returns an empty object.
 *   - A `string`: looked up in {@link BUILTIN_COLOUR_MAPS}.  Unknown names
 *     throw a `RangeError`.
 *   - An `object`: returned as-is (user-supplied mapping).
 * @returns {Object.<string, string>} Colour map object.
 * @throws {RangeError} If *nameOrMap* is a string that does not match any built-in map.
 * @throws {TypeError} If *nameOrMap* is not `null`, a string, or a plain object.
 */
export function resolveColourMap(nameOrMap) {
  if (nameOrMap == null) return {};
  if (typeof nameOrMap === 'string') {
    const key = nameOrMap.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(BUILTIN_COLOUR_MAPS, key)) {
      return BUILTIN_COLOUR_MAPS[key];
    }
    const available = Object.keys(BUILTIN_COLOUR_MAPS).sort().join(', ');
    throw new RangeError(
      `Unknown built-in colour map '${nameOrMap}'. Available maps: ${available}`
    );
  }
  if (typeof nameOrMap === 'object') return nameOrMap;
  throw new TypeError(
    `colourMap must be null, a string, or a plain object; got ${typeof nameOrMap}`
  );
}
