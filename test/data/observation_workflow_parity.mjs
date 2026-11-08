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
  const api = await server.ssrLoadModule('/src/data/geophysicsObservationWorkflows.js');
  const corrections = await server.ssrLoadModule('/src/data/geophysicsCorrections.js');
  const item = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  const r = await api.runGeophysicsObservationWorkflow(item.workflow,item.inputs);
  const inspected = await corrections.inspectGeophysicsCorrections(item.python_corrected);
  const igrf = await api.runGeophysicsObservationWorkflow(item.igrf_workflow,item.igrf_inputs);
  fs.writeFileSync(process.argv[3],JSON.stringify({state:r.state,issues:r.issues,inspected,igrf,corrected:r.artifacts.corrected,grid:r.artifacts.grid?.data,edges:r.artifacts.edges?.data}));
} finally { await server.close(); }
