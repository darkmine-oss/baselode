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
  const inspect=await corrections.inspectGeophysicsCorrections(item.python_drift);
  const tide=await corrections.applyGeophysicsGravityTide(item.survey,item.tide_options);
  const drift=await corrections.correctGeophysicsGravityDrift(tide.observations,item.drift_options);
  const continued=await corrections.correctGeophysicsGravityDrift(item.python_tide,item.drift_options);
  const workflow=await api.runGeophysicsObservationWorkflow(item.workflow,{survey:item.survey});
  const project=await corrections.reprojectGeophysicsObservations(item.python_drift,{target_crs:'EPSG:32750',datum_policy:'backend',event_id:'js-project',evidence:'checked'});
  fs.writeFileSync(process.argv[3],JSON.stringify({inspect,tide,drift,continued,workflow,project}));
} finally { await server.close(); }
