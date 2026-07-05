/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { z } from 'zod';

const PrimitiveJsonSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const JsonObjectSchema = z.record(z.string(), z.unknown());
const DepthRangeSchema = z.tuple([z.number(), z.number()]);

const PropertyMetaSchema = z.object({
  label: z.string().optional(),
  unit: z.string().nullish(),
  sourceAttribute: z.string().nullish(),
});

export const SerializableBaselodeStripLogTrackSchema = z.object({
  id: z.string().optional(),
  property: z.string().min(1),
  label: z.string().optional(),
  displayType: z.enum(['numeric', 'categorical']).default('numeric'),
  chartType: z.enum([
    'bar', 'markers', 'line', 'markers+line', 'categorical',
    'colored-line', 'multi-line', 'multi-stacked',
    'filled-line', 'step-line', 'heat-strip',
  ]).optional(),
  colourMap: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
  // Colour a single numeric track by a separate categorical column (joined per
  // interval at its mid-depth). Ignored for multi-assay / categorical tracks.
  colorBy: z.string().min(1).optional(),
  // Log-scale the numeric value axis (bar / markers / markers+line / line /
  // filled-line / step-line chart types; ignored otherwise).
  logScale: z.boolean().optional(),
  // Hatch categorical bands with the built-in lithology pattern map.
  usePatterns: z.boolean().optional(),
  // Assays plotted together in a `multi-line` / `multi-stacked` track. When
  // omitted the component seeds from the track property + other numeric columns.
  multiProps: z.array(z.string().min(1)).optional(),
  propertyOptions: z.array(z.string().min(1)).optional(),
  allowPropertySelection: z.boolean().optional(),
  allowChartTypeSelection: z.boolean().optional(),
  showLegend: z.boolean().optional(),
});

export const SerializableBaselodeStripLogSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  hole: z.object({
    id: z.string().min(1),
    points: z.array(JsonObjectSchema),
    metadata: z.record(z.string(), PrimitiveJsonSchema).optional(),
  }),
  tracks: z.array(SerializableBaselodeStripLogTrackSchema).min(1),
  height: z.number().positive().max(1200).optional(),
  template: z.enum(['baselode', 'baselode-dark', 'plotly-default']).optional(),
  showModeBar: z.boolean().optional(),
  propertyOptions: z.array(z.string().min(1)).optional(),
  propertyMeta: z.record(z.string(), PropertyMetaSchema).optional(),
  deriveMetaFromRows: z.boolean().optional(),
  allowPropertySelection: z.boolean().optional(),
  allowChartTypeSelection: z.boolean().optional(),
  showLegend: z.boolean().optional(),
  depthRange: DepthRangeSchema.optional(),
  defaultDepthRange: DepthRangeSchema.optional(),
});

export function safeParseSerializableBaselodeStripLog(value) {
  const parsed = SerializableBaselodeStripLogSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const SerializableBaselode3DSceneSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  height: z.number().positive().max(1400).optional(),
  background: z.enum(['white', 'black']).optional(),
  controlMode: z.enum(['orbit', 'fly']).optional(),
  drillholes: z.object({
    holes: z.array(JsonObjectSchema),
    options: JsonObjectSchema.optional(),
  }).optional(),
  stripLogs: z.array(JsonObjectSchema).optional(),
  structuralDiscs: z.object({
    structures: z.array(JsonObjectSchema),
    options: JsonObjectSchema.optional(),
    visible: z.boolean().optional(),
  }).optional(),
  blocks: z.object({
    data: z.array(JsonObjectSchema),
    selectedProperty: z.string().min(1),
    stats: JsonObjectSchema.optional(),
    options: JsonObjectSchema.optional(),
  }).optional(),
  rasterOverlays: z.array(z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    source: z.object({
      type: z.literal('url'),
      url: z.string().min(1),
    }),
    bounds: JsonObjectSchema,
    elevation: z.number().optional(),
    opacity: z.number().optional(),
    visible: z.boolean().optional(),
    renderOrder: z.number().optional(),
  })).optional(),
  camera: z.object({
    viewState: JsonObjectSchema.optional(),
    fitToBounds: z.boolean().optional(),
    focusPadding: z.number().positive().optional(),
  }).optional(),
});

export function safeParseSerializableBaselode3DScene(value) {
  const parsed = SerializableBaselode3DSceneSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// --- Analytics plots (TRK-52) ------------------------------------------

const AnalyticsTemplateEnum = z.enum(['baselode', 'baselode-dark', 'plotly-default']);
const CategoricalColourMap = z.union([z.string(), z.record(z.string(), z.string())]);

const BaseAnalyticsSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  rows: z.array(JsonObjectSchema),
  template: AnalyticsTemplateEnum.optional(),
  height: z.number().positive().max(1200).optional(),
  showModeBar: z.boolean().optional(),
});

export const SerializableBaselodeScatterPlotSchema = BaseAnalyticsSchema.extend({
  xProp: z.string().min(1),
  yProp: z.string().min(1),
  colorBy: z.string().min(1).optional(),
  colourMap: CategoricalColourMap.optional(),
  markerColor: z.string().optional(),
  markerSize: z.number().positive().optional(),
  markerOpacity: z.number().min(0).max(1).optional(),
  log: z.object({ x: z.boolean().optional(), y: z.boolean().optional() }).optional(),
});

export function safeParseSerializableBaselodeScatterPlot(value) {
  const parsed = SerializableBaselodeScatterPlotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const SerializableBaselodeHistogramPlotSchema = BaseAnalyticsSchema.extend({
  prop: z.string().min(1),
  groupBy: z.string().min(1).optional(),
  colourMap: CategoricalColourMap.optional(),
  markerColor: z.string().optional(),
  bins: z.number().int().positive().optional(),
  opacity: z.number().min(0).max(1).optional(),
  log: z.boolean().optional(),
});

export function safeParseSerializableBaselodeHistogramPlot(value) {
  const parsed = SerializableBaselodeHistogramPlotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const SerializableBaselodeBoxPlotSchema = BaseAnalyticsSchema.extend({
  prop: z.string().min(1),
  groupBy: z.string().min(1).optional(),
  colourMap: CategoricalColourMap.optional(),
  markerColor: z.string().optional(),
  showOutliers: z.boolean().optional(),
  log: z.boolean().optional(),
});

export function safeParseSerializableBaselodeBoxPlot(value) {
  const parsed = SerializableBaselodeBoxPlotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const SerializableBaselodeViolinPlotSchema = BaseAnalyticsSchema.extend({
  prop: z.string().min(1),
  groupBy: z.string().min(1).optional(),
  colourMap: CategoricalColourMap.optional(),
  markerColor: z.string().optional(),
  showBox: z.boolean().optional(),
  showMeanLine: z.boolean().optional(),
  log: z.boolean().optional(),
});

export function safeParseSerializableBaselodeViolinPlot(value) {
  const parsed = SerializableBaselodeViolinPlotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const SerializableBaselodeTernaryPlotSchema = BaseAnalyticsSchema.extend({
  aProp: z.string().min(1),
  bProp: z.string().min(1),
  cProp: z.string().min(1),
  colorBy: z.string().min(1).optional(),
  colourMap: CategoricalColourMap.optional(),
  markerColor: z.string().optional(),
  markerSize: z.number().positive().optional(),
  markerOpacity: z.number().min(0).max(1).optional(),
});

export function safeParseSerializableBaselodeTernaryPlot(value) {
  const parsed = SerializableBaselodeTernaryPlotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
