/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
  SerializableBaselode3DSceneSchema,
  SerializableBaselodeBoxPlotSchema,
  SerializableBaselodeHistogramPlotSchema,
  SerializableBaselodeScatterPlotSchema,
  SerializableBaselodeStripLogSchema,
  SerializableBaselodeTernaryPlotSchema,
  SerializableBaselodeViolinPlotSchema,
} from './schema.js';

export const BASELODE_TOOL_UI_KINDS = Object.freeze({
  STRIP_LOG: 'strip-log',
  SCENE_3D: '3d-scene',
  SCATTER_PLOT: 'scatter-plot',
  HISTOGRAM_PLOT: 'histogram-plot',
  BOX_PLOT: 'box-plot',
  VIOLIN_PLOT: 'violin-plot',
  TERNARY_PLOT: 'ternary-plot',
});

export const BASELODE_TOOL_UI_TOOL_NAMES = Object.freeze({
  [BASELODE_TOOL_UI_KINDS.STRIP_LOG]: 'baselode_strip_log',
  [BASELODE_TOOL_UI_KINDS.SCENE_3D]: 'baselode_3d_scene',
  [BASELODE_TOOL_UI_KINDS.SCATTER_PLOT]: 'baselode_scatter_plot',
  [BASELODE_TOOL_UI_KINDS.HISTOGRAM_PLOT]: 'baselode_histogram_plot',
  [BASELODE_TOOL_UI_KINDS.BOX_PLOT]: 'baselode_box_plot',
  [BASELODE_TOOL_UI_KINDS.VIOLIN_PLOT]: 'baselode_violin_plot',
  [BASELODE_TOOL_UI_KINDS.TERNARY_PLOT]: 'baselode_ternary_plot',
});

const TOOL_UI_STYLES = Object.freeze(['baselode/tool-ui/style.css']);
const PLOT_PEERS = Object.freeze(['react', 'plotly.js-dist-min', 'zod']);
const SCENE_PEERS = Object.freeze([
  'react',
  'three',
  'three-viewport-gizmo',
  'zod',
]);

function schemaContract(kind, schema, options = {}) {
  return Object.freeze({
    kind,
    toolName: BASELODE_TOOL_UI_TOOL_NAMES[kind],
    schema,
    callbacks: Object.freeze(options.callbacks || []),
    styles: TOOL_UI_STYLES,
    peerDependencies: options.peerDependencies || PLOT_PEERS,
  });
}
export const BASELODE_TOOL_UI_SCHEMA_CONTRACTS = Object.freeze({
  [BASELODE_TOOL_UI_KINDS.STRIP_LOG]: schemaContract(
    BASELODE_TOOL_UI_KINDS.STRIP_LOG,
    SerializableBaselodeStripLogSchema,
    {
      callbacks: [
        'onPropertyChange',
        'onTrackChange',
        'onIntervalClick',
        'onDepthRangeChange',
      ],
    },
  ),
  [BASELODE_TOOL_UI_KINDS.SCENE_3D]: schemaContract(
    BASELODE_TOOL_UI_KINDS.SCENE_3D,
    SerializableBaselode3DSceneSchema,
    { peerDependencies: SCENE_PEERS },
  ),
  [BASELODE_TOOL_UI_KINDS.SCATTER_PLOT]: schemaContract(
    BASELODE_TOOL_UI_KINDS.SCATTER_PLOT,
    SerializableBaselodeScatterPlotSchema,
  ),
  [BASELODE_TOOL_UI_KINDS.HISTOGRAM_PLOT]: schemaContract(
    BASELODE_TOOL_UI_KINDS.HISTOGRAM_PLOT,
    SerializableBaselodeHistogramPlotSchema,
  ),
  [BASELODE_TOOL_UI_KINDS.BOX_PLOT]: schemaContract(
    BASELODE_TOOL_UI_KINDS.BOX_PLOT,
    SerializableBaselodeBoxPlotSchema,
  ),
  [BASELODE_TOOL_UI_KINDS.VIOLIN_PLOT]: schemaContract(
    BASELODE_TOOL_UI_KINDS.VIOLIN_PLOT,
    SerializableBaselodeViolinPlotSchema,
  ),
  [BASELODE_TOOL_UI_KINDS.TERNARY_PLOT]: schemaContract(
    BASELODE_TOOL_UI_KINDS.TERNARY_PLOT,
    SerializableBaselodeTernaryPlotSchema,
  ),
});

export function getBaselodeToolUiSchemaContract(kind) {
  return BASELODE_TOOL_UI_SCHEMA_CONTRACTS[kind] || null;
}

export function getBaselodeToolUiSchemaContractByToolName(toolName, toolNames = {}) {
  const names = { ...BASELODE_TOOL_UI_TOOL_NAMES, ...toolNames };
  const kind = Object.keys(names).find((candidate) => names[candidate] === toolName);
  return kind ? BASELODE_TOOL_UI_SCHEMA_CONTRACTS[kind] || null : null;
}

export function parseBaselodeToolUiResult(kind, value) {
  const resolved = getBaselodeToolUiSchemaContract(kind);
  if (!resolved) {
    throw new TypeError(`Unknown Baselode Tool UI kind: ${String(kind)}`);
  }
  return resolved.schema.safeParse(value);
}

export function isBaselodeToolUiResultEmpty(kind, value) {
  switch (kind) {
    case BASELODE_TOOL_UI_KINDS.STRIP_LOG:
      return !value?.hole?.points?.length;
    case BASELODE_TOOL_UI_KINDS.SCENE_3D:
      return !(
        value?.drillholes?.holes?.length
        || value?.stripLogs?.length
        || value?.structuralDiscs?.structures?.length
        || value?.blocks?.data?.length
        || value?.rasterOverlays?.length
      );
    case BASELODE_TOOL_UI_KINDS.SCATTER_PLOT:
    case BASELODE_TOOL_UI_KINDS.HISTOGRAM_PLOT:
    case BASELODE_TOOL_UI_KINDS.BOX_PLOT:
    case BASELODE_TOOL_UI_KINDS.VIOLIN_PLOT:
    case BASELODE_TOOL_UI_KINDS.TERNARY_PLOT:
      return !value?.rows?.length;
    default:
      throw new TypeError(`Unknown Baselode Tool UI kind: ${String(kind)}`);
  }
}
