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
const server = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true, hmr: false } });
try {
  const api = await server.ssrLoadModule('/src/data/geophysicsCorrections.js');
  const item = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  const inspected = await api.inspectGeophysicsCorrections(item.python_output);
  const first = await api.reprojectGeophysicsObservations(item.survey,item.options);
  const levelled = await api.reprojectGeophysicsObservations(item.levelled,{...item.options,target_crs:'EPSG:4326'});
  const back = await api.reprojectGeophysicsObservations(item.python_output,{...item.options,event_id:'js-back'});
  fs.writeFileSync(process.argv[3],JSON.stringify({inspected,first,levelled,back}));
} finally { await server.close(); }
