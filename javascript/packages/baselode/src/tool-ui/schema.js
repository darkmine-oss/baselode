/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { z } from 'zod';

const PrimitiveJsonSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const JsonObjectSchema = z.record(z.string(), z.unknown());
const DepthRangeSchema = z.tuple([z.number(), z.number()]);

export const SerializableBaselodeStripLogTrackSchema = z.object({
  id: z.string().optional(),
  property: z.string().min(1),
  label: z.string().optional(),
  displayType: z.enum(['numeric', 'categorical']).default('numeric'),
  chartType: z.enum(['bar', 'markers', 'line', 'markers+line', 'categorical']).optional(),
  colourMap: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
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
