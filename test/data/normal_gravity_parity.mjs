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
  const inspect = await corrections.inspectGeophysicsCorrections(item.observations);
  const project = await corrections.reprojectGeophysicsObservations(item.observations,{target_crs:'EPSG:32750',datum_policy:'backend',event_id:'js-project',evidence:'checked'});
  const edit=structuredClone(item.observations);edit.metadata.gravity_datum='changed';const tampered=await corrections.inspectGeophysicsCorrections(edit);
  const workflow=await api.runGeophysicsObservationWorkflow({schema:'baselode.geophysics.observation_workflow',version:1,steps:[{id:'n',operation:'remove_normal_gravity',version:1,inputs:[{input:'survey'}],parameters:item.params}],outputs:{out:{step:'n',output:'observations'}}},{survey:item.observations});
  fs.writeFileSync(process.argv[3],JSON.stringify({inspect,project,tampered,workflow}));
} finally { await server.close(); }
