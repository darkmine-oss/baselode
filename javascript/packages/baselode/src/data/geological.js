// Copyright (C) 2026 Darkmine Pty Ltd.

import geologicalSchema from './geological_schema.json';

/** Return an independent copy of the geological storage schema. */
export function getGeologicalSchema() {
  return JSON.parse(JSON.stringify(geologicalSchema));
}

/** Return a qualified table definition, or undefined for an unknown name. */
export function getGeologicalTable(name) {
  return getGeologicalSchema().tables[name];
}
