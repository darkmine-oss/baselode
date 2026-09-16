// Copyright (C) 2026 Darkmine Pty Ltd.

// SPDX-License-Identifier: GPL-3.0-or-later

export interface GeologicalColumn {
  storageType: string;
  nullable: boolean;
  description: string;
  unit?: string;
  encoding?: string;
  reference?: { table: string; column: string; resolution: string };
}

export interface GeologicalTable {
  description: string;
  primaryKey: string[];
  columns: Record<string, GeologicalColumn>;
  requiredCompanionColumns?: string[];
}

export interface GeologicalSchema {
  copyright: string;
  version: string;
  spatialProfile: {
    name: string;
    geographySrid: number;
    geometry: string;
    axisOrder: { geography: string[]; geometry: string[] };
    verticalReference: string;
    deliverySrid: number;
    locationStatuses: { resolved: string; approximate: string; unresolved: string };
    qualification: string;
  };
  semantics: Record<string, string>;
  tables: Record<string, GeologicalTable>;
}

export function getGeologicalSchema(): GeologicalSchema;
export function getGeologicalTable(name: string): GeologicalTable | undefined;
