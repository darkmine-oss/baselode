/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Baselode3DSceneToolUI } from './Baselode3DSceneToolUI.jsx';
import { BaselodeBoxPlotToolUI } from './BaselodeBoxPlotToolUI.jsx';
import { BaselodeHistogramPlotToolUI } from './BaselodeHistogramPlotToolUI.jsx';
import { BaselodeScatterPlotToolUI } from './BaselodeScatterPlotToolUI.jsx';
import { BaselodeStripLogToolUI } from './BaselodeStripLogToolUI.jsx';
import { BaselodeTernaryPlotToolUI } from './BaselodeTernaryPlotToolUI.jsx';
import { BaselodeViolinPlotToolUI } from './BaselodeViolinPlotToolUI.jsx';
import {
  BASELODE_TOOL_UI_KINDS,
  BASELODE_TOOL_UI_SCHEMA_CONTRACTS,
  BASELODE_TOOL_UI_TOOL_NAMES,
  getBaselodeToolUiSchemaContractByToolName,
  isBaselodeToolUiResultEmpty,
  parseBaselodeToolUiResult,
  resolveBaselodeToolUiToolNames,
} from './contractCore.js';

function contract(kind, Component) {
  return Object.freeze({
    ...BASELODE_TOOL_UI_SCHEMA_CONTRACTS[kind],
    Component,
  });
}

export const BASELODE_TOOL_UI_CONTRACTS = Object.freeze({
  [BASELODE_TOOL_UI_KINDS.STRIP_LOG]: contract(
    BASELODE_TOOL_UI_KINDS.STRIP_LOG,
    BaselodeStripLogToolUI,
  ),
  [BASELODE_TOOL_UI_KINDS.SCENE_3D]: contract(
    BASELODE_TOOL_UI_KINDS.SCENE_3D,
    Baselode3DSceneToolUI,
  ),
  [BASELODE_TOOL_UI_KINDS.SCATTER_PLOT]: contract(
    BASELODE_TOOL_UI_KINDS.SCATTER_PLOT,
    BaselodeScatterPlotToolUI,
  ),
  [BASELODE_TOOL_UI_KINDS.HISTOGRAM_PLOT]: contract(
    BASELODE_TOOL_UI_KINDS.HISTOGRAM_PLOT,
    BaselodeHistogramPlotToolUI,
  ),
  [BASELODE_TOOL_UI_KINDS.BOX_PLOT]: contract(
    BASELODE_TOOL_UI_KINDS.BOX_PLOT,
    BaselodeBoxPlotToolUI,
  ),
  [BASELODE_TOOL_UI_KINDS.VIOLIN_PLOT]: contract(
    BASELODE_TOOL_UI_KINDS.VIOLIN_PLOT,
    BaselodeViolinPlotToolUI,
  ),
  [BASELODE_TOOL_UI_KINDS.TERNARY_PLOT]: contract(
    BASELODE_TOOL_UI_KINDS.TERNARY_PLOT,
    BaselodeTernaryPlotToolUI,
  ),
});

export function getBaselodeToolUiContract(kind) {
  return BASELODE_TOOL_UI_CONTRACTS[kind] || null;
}

export function getBaselodeToolUiContractByToolName(toolName, toolNames = {}) {
  const schemaContract = getBaselodeToolUiSchemaContractByToolName(toolName, toolNames);
  return schemaContract ? BASELODE_TOOL_UI_CONTRACTS[schemaContract.kind] : null;
}

export {
  BASELODE_TOOL_UI_KINDS,
  BASELODE_TOOL_UI_TOOL_NAMES,
  isBaselodeToolUiResultEmpty,
  parseBaselodeToolUiResult,
  resolveBaselodeToolUiToolNames,
};
