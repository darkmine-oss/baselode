// Copyright (C) 2026 Darkmine Pty Ltd.

// SPDX-License-Identifier: GPL-3.0-or-later

import geologicalSchema from './geological_schema.json';

/** Return an independent copy of the geological storage schema. */
export function getGeologicalSchema() {
  return JSON.parse(JSON.stringify(geologicalSchema));
}

/** Return a qualified table definition, or undefined for an unknown name. */
export function getGeologicalTable(name) {
  if (!Object.hasOwn(geologicalSchema.tables, name)) return undefined;
  return JSON.parse(JSON.stringify(geologicalSchema.tables[name]));
}
