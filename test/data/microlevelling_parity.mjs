/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const require=createRequire(path.join(process.cwd(),'package.json'));
const location=require.resolve('vite/package.json'),meta=JSON.parse(fs.readFileSync(location,'utf8'));
const {createServer}=await import(pathToFileURL(path.resolve(path.dirname(location),meta.exports['.'].import.default)));
const server=await createServer({configFile:false,root:process.cwd(),server:{middlewareMode:true,hmr:false}});
try{
  const api=await server.ssrLoadModule('/src/data/geophysicsMicrolevelling.js'),rasters=await server.ssrLoadModule('/src/data/geophysicsRaster.js'),workflows=await server.ssrLoadModule('/src/data/geophysicsWorkflows.js');
  const f=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),r=rasters.createGeophysicsRaster(f.raster);
  fs.writeFileSync(process.argv[3],JSON.stringify({noise:api.estimateGeophysicsMagneticMicrolevelling(r,f.options),corrected:api.microlevelGeophysicsMagneticGrid(r,f.options),workflow:workflows.runGeophysicsWorkflow(f.workflow,{magnetic:r})}));
}finally{await server.close();}
