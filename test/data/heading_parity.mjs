/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const require = createRequire(path.join(process.cwd(), 'package.json'));
const metadataPath = require.resolve('vite/package.json');
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const { createServer } = await import(pathToFileURL(path.resolve(path.dirname(metadataPath), metadata.exports['.'].import.default)));
const server = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true } });
try {
  const api = await server.ssrLoadModule('/src/data/geophysicsCorrections.js');
  const item = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const inspected = await api.inspectGeophysicsCorrections(item.python_output);
  const first = await api.correctGeophysicsMagneticHeading(item.survey,item.options);
  const second = await api.correctGeophysicsMagneticHeading(item.python_output,{...item.options,channel:'other',event_id:'js-other'});
  const bad = JSON.parse(JSON.stringify(second.observations)); bad.records[0].extra.sensor_heading = 1;
  const tampered = await api.inspectGeophysicsCorrections(bad);
  fs.writeFileSync(process.argv[3],JSON.stringify({inspected,first,second,tampered}));
} finally { await server.close(); }
