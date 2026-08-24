import type {
  ToolCallMessagePartComponent,
  ToolCallMessagePartProps,
  Toolkit,
} from '@assistant-ui/react';
import type { ComponentType, ReactNode } from 'react';
import type {
  BaselodeGeophysicsRasterCallbacks,
  BaselodeStripLogCallbacks,
  BaselodeToolUiKind,
  BaselodeToolUiResultMap,
} from 'baselode/tool-ui';

export type BaselodeAssistantToolStateName =
  | 'running'
  | 'requires-action'
  | 'incomplete'
  | 'empty'
  | 'invalid'
  | 'error';

export interface BaselodeAssistantToolStateInfo {
  state: BaselodeAssistantToolStateName;
  message?: string;
  issues: ReadonlyArray<{ path?: PropertyKey[]; message: string }>;
  error?: unknown;
  part?: ToolCallMessagePartProps<Record<string, unknown>, unknown>;
}

export interface BaselodeAssistantToolEvent<K extends BaselodeToolUiKind = BaselodeToolUiKind> {
  type: 'property-change' | 'track-change' | 'interval-click' | 'depth-range-change' | string;
  kind: K;
  toolName: string;
  toolCallId: string;
  payload: unknown;
}

export interface BaselodeAssistantUiToolkitOptions {
  toolNames?: Partial<Record<BaselodeToolUiKind, string>>;
  payloadSource?: 'result' | 'args';
  display?: 'inline' | 'standalone';
  callbacks?: Partial<Record<BaselodeToolUiKind, BaselodeStripLogCallbacks | BaselodeGeophysicsRasterCallbacks>>;
  onEvent?: (event: BaselodeAssistantToolEvent) => void;
  onRenderError?: (error: unknown, info: unknown) => void;
  renderState?: (state: BaselodeAssistantToolStateInfo) => ReactNode;
}

export const BASELODE_TOOL_UI_KINDS: Readonly<{
  STRIP_LOG: 'strip-log';
  SCENE_3D: '3d-scene';
  GEOPHYSICS_RASTER: 'geophysics-raster';
  SCATTER_PLOT: 'scatter-plot';
  HISTOGRAM_PLOT: 'histogram-plot';
  BOX_PLOT: 'box-plot';
  VIOLIN_PLOT: 'violin-plot';
  TERNARY_PLOT: 'ternary-plot';
}>;
export const BASELODE_TOOL_UI_TOOL_NAMES: Readonly<Record<BaselodeToolUiKind, string>>;

export const BaselodeAssistantToolState: ComponentType<{
  state: BaselodeAssistantToolStateName;
  message?: string;
  issues?: ReadonlyArray<{ path?: PropertyKey[]; message: string }>;
}>;

export function createBaselodeAssistantToolRenderer<K extends BaselodeToolUiKind>(
  kind: K,
  options?: BaselodeAssistantUiToolkitOptions,
): ToolCallMessagePartComponent<Record<string, unknown>, BaselodeToolUiResultMap[K]>;

export function createBaselodeAssistantUiToolkit(
  options?: BaselodeAssistantUiToolkitOptions,
): Toolkit;
