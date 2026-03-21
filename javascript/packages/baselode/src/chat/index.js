/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Baselode chat attachment schema.
 *
 * Provides a minimal, stable envelope for data attachments sent alongside chat
 * messages. Clients consume attachments by switching on `type` and reading the
 * `payload` without any app-specific translation layer.
 *
 * @module chat
 */

// ---------------------------------------------------------------------------
// JSDoc types (no runtime cost — documentation and IDE completion only)
// ---------------------------------------------------------------------------

/**
 * Base envelope shared by every attachment type.
 *
 * @template {unknown} [TPayload=unknown]
 * @typedef {Object} ChatDataAttachment
 * @property {string} type - Discriminant string identifying the attachment type.
 * @property {TPayload} payload - Type-specific payload object.
 */

/**
 * @typedef {Object} CollarListPayload
 * @property {Record<string, unknown>[]} collars - Flat array of collar row objects.
 *   Table columns are derived from the keys of the first row.
 *   An empty array should render an empty state.
 * @property {number} [total_count] - Total number of collars in the dataset (may exceed `collars.length`).
 */

/**
 * @typedef {Object} CollarMapCollar
 * @property {string} [hole_id]
 * @property {number} [latitude]
 * @property {number} [longitude]
 * @property {unknown} [key: string]  Additional properties used for labels/tooltips.
 */

/**
 * @typedef {Object} CollarMapPayload
 * @property {CollarMapCollar[]} collars - Collar points to plot on the map.
 *   `latitude` and `longitude` are optional but required for plotting.
 * @property {number} [total_count] - Total number of collars in the dataset.
 */

/**
 * @typedef {Object} StripLogPayload
 * @property {string} hole_id - ID of the hole to display.
 * @property {'assay'|'geology'|string} data_type - Dataset type hint. 'geology' forces categorical rendering.
 * @property {Record<string, unknown>[]} rows - Raw interval rows (from/to or depth fields).
 * @property {string[]} properties - Columns available for plotting (shown in the property dropdown).
 * @property {string|null} default_property - Seeds the initial property selection; may be null.
 */

/**
 * @typedef {ChatDataAttachment<CollarListPayload> & { type: 'collar_list' }} CollarListAttachment
 */

/**
 * @typedef {ChatDataAttachment<CollarMapPayload> & { type: 'collar_map' }} CollarMapAttachment
 */

/**
 * @typedef {ChatDataAttachment<StripLogPayload> & { type: 'strip_log' }} StripLogAttachment
 */

/**
 * Union of all standard Baselode chat attachment types.
 *
 * @typedef {CollarListAttachment | CollarMapAttachment | StripLogAttachment} BaselodeChatAttachment
 */

// ---------------------------------------------------------------------------
// Known attachment type strings
// ---------------------------------------------------------------------------

/** @type {'collar_list'} */
export const ATTACHMENT_TYPE_COLLAR_LIST = 'collar_list';

/** @type {'collar_map'} */
export const ATTACHMENT_TYPE_COLLAR_MAP = 'collar_map';

/** @type {'strip_log'} */
export const ATTACHMENT_TYPE_STRIP_LOG = 'strip_log';

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

/**
 * Build a collar-list attachment.
 *
 * @param {Record<string, unknown>[]} collars - Flat array of collar row objects.
 * @param {number} [totalCount] - Total collar count if paginated.
 * @returns {CollarListAttachment}
 */
export function buildCollarListAttachment(collars, totalCount) {
  /** @type {CollarListPayload} */
  const payload = { collars: collars ?? [] };
  if (totalCount !== undefined) payload.total_count = totalCount;
  return { type: ATTACHMENT_TYPE_COLLAR_LIST, payload };
}

/**
 * Build a collar-map attachment.
 *
 * @param {CollarMapCollar[]} collars - Collar points with optional latitude/longitude.
 * @param {number} [totalCount] - Total collar count if paginated.
 * @returns {CollarMapAttachment}
 */
export function buildCollarMapAttachment(collars, totalCount) {
  /** @type {CollarMapPayload} */
  const payload = { collars: collars ?? [] };
  if (totalCount !== undefined) payload.total_count = totalCount;
  return { type: ATTACHMENT_TYPE_COLLAR_MAP, payload };
}

/**
 * Build a strip-log attachment.
 *
 * @param {StripLogPayload} stripLogPayload
 * @param {string} stripLogPayload.hole_id
 * @param {'assay'|'geology'|string} stripLogPayload.data_type
 * @param {Record<string, unknown>[]} stripLogPayload.rows
 * @param {string[]} stripLogPayload.properties
 * @param {string|null} stripLogPayload.default_property
 * @returns {StripLogAttachment}
 */
export function buildStripLogAttachment({ hole_id, data_type, rows, properties, default_property }) {
  return {
    type: ATTACHMENT_TYPE_STRIP_LOG,
    payload: {
      hole_id,
      data_type,
      rows: rows ?? [],
      properties: properties ?? [],
      default_property: default_property ?? null,
    },
  };
}

/**
 * Type-guard: returns true if the value looks like a valid ChatDataAttachment.
 *
 * @param {unknown} value
 * @returns {value is ChatDataAttachment}
 */
export function isChatAttachment(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (/** @type {any} */ (value).type) === 'string' &&
    'payload' in (/** @type {any} */ (value))
  );
}
