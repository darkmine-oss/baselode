import type { ComponentType } from 'react';
import type { ZodType } from 'zod';

export type BaselodeJsonObject = Record<string, unknown>;
export type BaselodeToolUiKind =
  | 'strip-log'
  | '3d-scene'
  | 'scatter-plot'
  | 'histogram-plot'
  | 'box-plot'
  | 'violin-plot'
  | 'ternary-plot';

export interface BaselodePropertyMeta {
  label?: string;
  unit?: string | null;
  sourceAttribute?: string | null;
}

export type BaselodeStripLogChartType =
  | 'bar'
  | 'markers'
  | 'line'
  | 'markers+line'
  | 'categorical'
  | 'colored-line'
  | 'multi-line'
  | 'multi-stacked'
  | 'filled-line'
  | 'step-line'
  | 'heat-strip'
  | 'two-curve'
  | 'composition'
  | 'point-log';

export interface BaselodeStripLogTrack {
  id?: string;
  property: string;
  label?: string;
  displayType?: 'numeric' | 'categorical';
  chartType?: BaselodeStripLogChartType;
  colourMap?: string | Record<string, string>;
  colorBy?: string;
  logScale?: boolean;
  usePatterns?: boolean;
  stepped?: boolean;
  fillArea?: boolean;
  startFromZero?: boolean;
  multiProps?: string[];
  propertyOptions?: string[];
  allowPropertySelection?: boolean;
  allowChartTypeSelection?: boolean;
  showLegend?: boolean;
}

export interface BaselodeStripLogResult {
  id: string;
  title?: string;
  subtitle?: string;
  hole: {
    id: string;
    points: BaselodeJsonObject[];
    metadata?: Record<string, string | number | boolean | null>;
  };
  tracks: BaselodeStripLogTrack[];
  height?: number;
  template?: 'baselode' | 'baselode-dark' | 'plotly-default';
  showModeBar?: boolean;
  propertyOptions?: string[];
  propertyMeta?: Record<string, BaselodePropertyMeta>;
  deriveMetaFromRows?: boolean;
  allowPropertySelection?: boolean;
  allowChartTypeSelection?: boolean;
  showLegend?: boolean;
  depthRange?: [number, number];
  defaultDepthRange?: [number, number];
}

export interface BaselodePropertyChangeEvent {
  trackId: string;
  property: string;
  displayType: 'numeric' | 'categorical';
  chartType: BaselodeStripLogChartType;
}

export interface BaselodeIntervalClickEvent {
  trackId: string;
  property: string;
  value: unknown;
  from: number;
  to: number;
  pointIndex?: number;
}

export interface BaselodeDepthRangeChangeEvent {
  trackId: string;
  depthRange: [number, number];
}

export interface BaselodeStripLogCallbacks {
  onPropertyChange?: (event: BaselodePropertyChangeEvent) => void;
  onTrackChange?: (track: BaselodeStripLogTrack) => void;
  onIntervalClick?: (event: BaselodeIntervalClickEvent) => void;
  onDepthRangeChange?: (event: BaselodeDepthRangeChangeEvent) => void;
}

export type BaselodeStripLogToolUiProps = BaselodeStripLogResult & BaselodeStripLogCallbacks;

export interface Baselode3DSceneResult {
  id: string;
  title?: string;
  subtitle?: string;
  height?: number;
  background?: 'white' | 'black';
  controlMode?: 'orbit' | 'fly';
  drillholes?: { holes: BaselodeJsonObject[]; options?: BaselodeJsonObject };
  stripLogs?: BaselodeJsonObject[];
  structuralDiscs?: {
    structures: BaselodeJsonObject[];
    options?: BaselodeJsonObject;
    visible?: boolean;
  };
  blocks?: {
    data: BaselodeJsonObject[];
    selectedProperty: string;
    stats?: BaselodeJsonObject;
    options?: BaselodeJsonObject;
  };
  rasterOverlays?: Array<{
    id?: string;
    name?: string;
    source: { type: 'url'; url: string };
    bounds: BaselodeJsonObject;
    elevation?: number;
    opacity?: number;
    visible?: boolean;
    renderOrder?: number;
  }>;
  camera?: {
    viewState?: BaselodeJsonObject;
    fitToBounds?: boolean;
    focusPadding?: number;
  };
}

export interface BaselodeAnalyticsResultBase {
  id: string;
  title?: string;
  rows: BaselodeJsonObject[];
  template?: 'baselode' | 'baselode-dark' | 'plotly-default';
  height?: number;
  showModeBar?: boolean;
}

export interface BaselodeScatterPlotResult extends BaselodeAnalyticsResultBase {
  xProp: string;
  yProp: string;
  colorBy?: string;
  colourMap?: string | Record<string, string>;
  markerColor?: string;
  markerSize?: number;
  markerOpacity?: number;
  log?: { x?: boolean; y?: boolean };
}

export interface BaselodeHistogramPlotResult extends BaselodeAnalyticsResultBase {
  prop: string;
  groupBy?: string;
  colourMap?: string | Record<string, string>;
  markerColor?: string;
  bins?: number;
  opacity?: number;
  log?: boolean;
}

export interface BaselodeBoxPlotResult extends BaselodeAnalyticsResultBase {
  prop: string;
  groupBy?: string;
  colourMap?: string | Record<string, string>;
  markerColor?: string;
  showOutliers?: boolean;
  log?: boolean;
}

export interface BaselodeViolinPlotResult extends BaselodeAnalyticsResultBase {
  prop: string;
  groupBy?: string;
  colourMap?: string | Record<string, string>;
  markerColor?: string;
  showBox?: boolean;
  showMeanLine?: boolean;
  log?: boolean;
}

export interface BaselodeTernaryPlotResult extends BaselodeAnalyticsResultBase {
  aProp: string;
  bProp: string;
  cProp: string;
  colorBy?: string;
  colourMap?: string | Record<string, string>;
  markerColor?: string;
  markerSize?: number;
  markerOpacity?: number;
}

export interface BaselodeToolUiResultMap {
  'strip-log': BaselodeStripLogResult;
  '3d-scene': Baselode3DSceneResult;
  'scatter-plot': BaselodeScatterPlotResult;
  'histogram-plot': BaselodeHistogramPlotResult;
  'box-plot': BaselodeBoxPlotResult;
  'violin-plot': BaselodeViolinPlotResult;
  'ternary-plot': BaselodeTernaryPlotResult;
}

export interface BaselodeToolUiPropsMap extends BaselodeToolUiResultMap {
  'strip-log': BaselodeStripLogToolUiProps;
}

export interface BaselodeToolUiValidationIssue {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
  readonly code?: string;
}

export interface BaselodeToolUiValidationError {
  readonly issues: ReadonlyArray<BaselodeToolUiValidationIssue>;
  readonly message: string;
}

export type BaselodeToolUiParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: BaselodeToolUiValidationError };

export interface BaselodeToolUiContract<K extends BaselodeToolUiKind = BaselodeToolUiKind> {
  readonly kind: K;
  readonly toolName: string;
  readonly schema: ZodType<BaselodeToolUiResultMap[K]>;
  readonly Component: ComponentType<BaselodeToolUiPropsMap[K]>;
  readonly callbacks: readonly string[];
  readonly styles: readonly string[];
  readonly peerDependencies: readonly string[];
}

export type BaselodeToolUiSchemaContract<K extends BaselodeToolUiKind = BaselodeToolUiKind> =
  Omit<BaselodeToolUiContract<K>, 'Component'>;

export const BASELODE_TOOL_UI_KINDS: Readonly<{
  STRIP_LOG: 'strip-log';
  SCENE_3D: '3d-scene';
  SCATTER_PLOT: 'scatter-plot';
  HISTOGRAM_PLOT: 'histogram-plot';
  BOX_PLOT: 'box-plot';
  VIOLIN_PLOT: 'violin-plot';
  TERNARY_PLOT: 'ternary-plot';
}>;

export const BASELODE_TOOL_UI_TOOL_NAMES: Readonly<Record<BaselodeToolUiKind, string>>;
export const BASELODE_TOOL_UI_CONTRACTS: {
  readonly [K in BaselodeToolUiKind]: BaselodeToolUiContract<K>;
};
export const BASELODE_TOOL_UI_SCHEMA_CONTRACTS: {
  readonly [K in BaselodeToolUiKind]: BaselodeToolUiSchemaContract<K>;
};

export const SerializableBaselodeStripLogTrackSchema: ZodType<BaselodeStripLogTrack>;
export const SerializableBaselodeStripLogSchema: ZodType<BaselodeStripLogResult>;
export const SerializableBaselode3DSceneSchema: ZodType<Baselode3DSceneResult>;
export const SerializableBaselodeScatterPlotSchema: ZodType<BaselodeScatterPlotResult>;
export const SerializableBaselodeHistogramPlotSchema: ZodType<BaselodeHistogramPlotResult>;
export const SerializableBaselodeBoxPlotSchema: ZodType<BaselodeBoxPlotResult>;
export const SerializableBaselodeViolinPlotSchema: ZodType<BaselodeViolinPlotResult>;
export const SerializableBaselodeTernaryPlotSchema: ZodType<BaselodeTernaryPlotResult>;

export function safeParseSerializableBaselodeStripLog(value: unknown): BaselodeStripLogResult | null;
export function safeParseSerializableBaselode3DScene(value: unknown): Baselode3DSceneResult | null;
export function safeParseSerializableBaselodeScatterPlot(value: unknown): BaselodeScatterPlotResult | null;
export function safeParseSerializableBaselodeHistogramPlot(value: unknown): BaselodeHistogramPlotResult | null;
export function safeParseSerializableBaselodeBoxPlot(value: unknown): BaselodeBoxPlotResult | null;
export function safeParseSerializableBaselodeViolinPlot(value: unknown): BaselodeViolinPlotResult | null;
export function safeParseSerializableBaselodeTernaryPlot(value: unknown): BaselodeTernaryPlotResult | null;

export function getBaselodeToolUiContract<K extends BaselodeToolUiKind>(kind: K): BaselodeToolUiContract<K>;
export function getBaselodeToolUiContract(kind: string): BaselodeToolUiContract | null;
export function getBaselodeToolUiContractByToolName(
  toolName: string,
  toolNames?: Partial<Record<BaselodeToolUiKind, string>>,
): BaselodeToolUiContract | null;
export function getBaselodeToolUiSchemaContract<K extends BaselodeToolUiKind>(
  kind: K,
): BaselodeToolUiSchemaContract<K>;
export function getBaselodeToolUiSchemaContract(kind: string): BaselodeToolUiSchemaContract | null;
export function getBaselodeToolUiSchemaContractByToolName(
  toolName: string,
  toolNames?: Partial<Record<BaselodeToolUiKind, string>>,
): BaselodeToolUiSchemaContract | null;
export function resolveBaselodeToolUiToolNames(
  toolNames?: Partial<Record<BaselodeToolUiKind, string>>,
): Readonly<Record<BaselodeToolUiKind, string>>;
export function parseBaselodeToolUiResult<K extends BaselodeToolUiKind>(
  kind: K,
  value: unknown,
): BaselodeToolUiParseResult<BaselodeToolUiResultMap[K]>;
export function isBaselodeToolUiResultEmpty<K extends BaselodeToolUiKind>(
  kind: K,
  value: BaselodeToolUiResultMap[K],
): boolean;

export const BaselodeStripLogToolUI: ComponentType<BaselodeStripLogToolUiProps>;
export const Baselode3DSceneToolUI: ComponentType<Baselode3DSceneResult>;
export const BaselodeScatterPlotToolUI: ComponentType<BaselodeScatterPlotResult>;
export const BaselodeHistogramPlotToolUI: ComponentType<BaselodeHistogramPlotResult>;
export const BaselodeBoxPlotToolUI: ComponentType<BaselodeBoxPlotResult>;
export const BaselodeViolinPlotToolUI: ComponentType<BaselodeViolinPlotResult>;
export const BaselodeTernaryPlotToolUI: ComponentType<BaselodeTernaryPlotResult>;
export const PlotlyChart: ComponentType<{
  data: BaselodeJsonObject[];
  layout: BaselodeJsonObject;
  height?: number;
  showModeBar?: boolean;
  style?: Record<string, string | number>;
}>;
