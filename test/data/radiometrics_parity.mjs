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
  const api=await server.ssrLoadModule('/src/data/geophysicsRadiometrics.js');
  const workflows=await server.ssrLoadModule('/src/data/geophysicsWorkflows.js');
  const rasters=await server.ssrLoadModule('/src/data/geophysicsRaster.js');
  const f=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const grid=rasters.createGeophysicsRaster({...f,bandNames:f.band_names});
  const ratios=api.calculateGeophysicsRadiometricRatios(grid,f.ratio_options),rgb=api.createGeophysicsRadiometricTernary(grid,f.ternary_options),workflow=workflows.runGeophysicsWorkflow(f.workflow,{radio:grid});
  const text_results=f.text_cases.map(item=>{
    const source=structuredClone(grid),p=structuredClone(f.ratio_options);
    if(item.target==='evidence')p.evidence=item.value;if(item.target==='height_datum')source.metadata.radiometric.height_datum=item.value;if(item.target==='calibration_id')source.metadata.radiometric.calibration_ids[0]=item.value;if(item.target==='frame_id'){source.crs=null;source.metadata.frame_id=item.value;}if(item.target==='crs')source.crs=item.value;
    try{api.calculateGeophysicsRadiometricRatios(source,p);return true;}catch{return false;}
  });
  fs.writeFileSync(process.argv[3],JSON.stringify({ratios,rgb,workflow,text_results}));
} finally { await server.close(); }
