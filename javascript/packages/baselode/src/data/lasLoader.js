/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { GEOPHYSICS_NULL_SENTINEL } from './datamodel.js';

/**
 * Parse a single LAS header mnemonic line.
 *
 * LAS header lines have the format:
 *   MNEM.UNIT  value : description
 *
 * @private
 * @param {string} line
 * @returns {{ mnem: string, unit: string, value: string, description: string } | null}
 */
function parseMnemonicLine(line) {
  const dotIdx = line.indexOf('.');
  if (dotIdx < 0) return null;

  const mnem = line.slice(0, dotIdx).trim().toUpperCase();
  const afterDot = line.slice(dotIdx + 1);

  // Unit is the first non-whitespace token after the dot
  const unitMatch = afterDot.match(/^(\S*)\s*(.*)/s);
  const unit = unitMatch ? unitMatch[1] : '';
  const valueAndDesc = unitMatch ? unitMatch[2] : afterDot;

  // Description follows the last colon
  const lastColon = valueAndDesc.lastIndexOf(':');
  const value = lastColon >= 0 ? valueAndDesc.slice(0, lastColon).trim() : valueAndDesc.trim();
  const description = lastColon >= 0 ? valueAndDesc.slice(lastColon + 1).trim() : '';

  return { mnem, unit, value, description };
}

/**
 * Split a LAS text into named sections.
 *
 * @private
 * @param {string} lasText
 * @returns {Array<{ type: string, lines: string[] }>}
 */
function splitSections(lasText) {
  const sections = [];
  let current = null;

  for (const raw of lasText.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith('~')) {
      // Section type is the first letter after ~, uppercased
      const type = line.slice(1, 2).toUpperCase();
      current = { type, lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }

  return sections;
}

/**
 * Parse a LAS header section into a map of mnemonic → parsed entry.
 *
 * @private
 * @param {string[] | undefined} lines
 * @returns {Record<string, { mnem: string, unit: string, value: string, description: string }>}
 */
function parseHeaderSection(lines = []) {
  const map = {};
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parsed = parseMnemonicLine(line);
    if (parsed) map[parsed.mnem] = parsed;
  }
  return map;
}

/**
 * Parse a LAS 1.2 or 2.0 file into the same per-hole channel format returned
 * by {@link parseGeophysicsCSV}.
 *
 * LAS (Log ASCII Standard) is the industry-standard format for wireline log
 * data.  Measurements are point-based — one row per sample depth — so the
 * returned channel objects use a ``depth`` axis rather than from/to intervals.
 *
 * ### LAS → baselode mapping
 *
 * | LAS section | Field        | Baselode field   |
 * |-------------|--------------|------------------|
 * | `~WELL`     | WELL/UWI/API | `holeId`         |
 * | `~WELL`     | NULL         | null sentinel    |
 * | `~CURVE`    | first curve  | depth axis       |
 * | `~CURVE`    | other curves | channel names    |
 * | `~A`        | data rows    | depths + values  |
 *
 * ### Return value
 *
 * Returns an array with a single element (LAS files describe one hole):
 * ```js
 * [
 *   {
 *     holeId: 'MKC435',
 *     units: { gamma: 'GAPI', density: 'G/CC' },
 *     channels: {
 *       gamma:   { depths: [0.1, 0.2, ...], values: [45, 52, ...] },
 *       density: { depths: [1.1, 1.2, ...], values: [2.3, 2.4, ...] },
 *     }
 *   }
 * ]
 * ```
 *
 * The `units` object contains the LAS unit string for each channel (lowercased
 * mnemonic key).  Channels with fewer than 2 valid samples are omitted.
 *
 * ### Limitations
 *
 * `WRAP YES` (multi-line data rows) is not supported; a console warning is
 * emitted and parsing continues on a best-effort basis.
 *
 * @param {string} lasText - Raw LAS file text
 * @param {object} [options]
 * @param {string} [options.holeId] - Override the hole identifier
 * @param {number} [options.nullSentinel] - Override the null sentinel value
 * @returns {Array<{ holeId: string, units: object, channels: object }>}
 */
export function parseLasFile(lasText, options = {}) {
  const sections = splitSections(lasText);

  const versionSection = sections.find((s) => s.type === 'V');
  const wellSection = sections.find((s) => s.type === 'W');
  const curveSection = sections.find((s) => s.type === 'C');
  const dataSection = sections.find((s) => s.type === 'A');

  if (!dataSection) return [];

  const version = parseHeaderSection(versionSection?.lines);
  const well = parseHeaderSection(wellSection?.lines);
  const curveEntries = [];
  for (const line of (curveSection?.lines ?? [])) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parsed = parseMnemonicLine(line);
    if (parsed) curveEntries.push(parsed);
  }

  // Warn on unsupported WRAP YES
  const wrap = version.WRAP?.value?.trim().toUpperCase() ?? 'NO';
  if (wrap === 'YES') {
    console.warn(
      'parseLasFile: WRAP YES is not supported. Data rows may be read incorrectly.'
    );
  }

  // Resolve hole_id
  const holeId =
    options.holeId ??
    (well.WELL?.value?.trim() || null) ??
    (well.UWI?.value?.trim() || null) ??
    (well.API?.value?.trim() || null) ??
    'unknown';

  // Resolve null sentinel (LAS file value takes precedence over default)
  let nullSentinel = GEOPHYSICS_NULL_SENTINEL;
  if (well.NULL?.value) {
    const v = Number(well.NULL.value);
    if (Number.isFinite(v)) nullSentinel = v;
  }
  if (options.nullSentinel !== undefined) {
    nullSentinel = options.nullSentinel;
  }

  if (curveEntries.length === 0) return [];

  // First curve is always depth
  const valueCurves = curveEntries.slice(1); // skip depth curve

  // Collect units for each value channel
  const units = {};
  for (const { mnem, unit } of valueCurves) {
    units[mnem.toLowerCase()] = unit;
  }

  // Accumulate channel data
  const channelData = {};
  for (const { mnem } of valueCurves) {
    channelData[mnem.toLowerCase()] = { depths: [], values: [] };
  }

  for (const line of dataSection.lines) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const tokens = trimmed.split(/\s+/);
    if (tokens.length < 2) continue;

    const depth = Number(tokens[0]);
    if (!Number.isFinite(depth) || depth === nullSentinel) continue;

    for (let i = 0; i < valueCurves.length; i++) {
      const key = valueCurves[i].mnem.toLowerCase();
      const v = Number(tokens[i + 1]);
      if (Number.isFinite(v) && v !== nullSentinel) {
        channelData[key].depths.push(depth);
        channelData[key].values.push(v);
      }
    }
  }

  // Drop channels with fewer than 2 valid samples
  const channels = {};
  for (const [key, data] of Object.entries(channelData)) {
    if (data.depths.length >= 2) channels[key] = data;
  }

  if (Object.keys(channels).length === 0) return [];

  return [{ holeId, units, channels }];
}
