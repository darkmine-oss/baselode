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
  const api=await server.ssrLoadModule('/src/data/geophysicsRegional.js'),rasters=await server.ssrLoadModule('/src/data/geophysicsRaster.js'),workflows=await server.ssrLoadModule('/src/data/geophysicsObservationWorkflows.js');
  const f=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),r=rasters.createGeophysicsRaster(f.raster);
  const noThreshold={...f.options};delete noThreshold.huber_threshold;
  const missingUnits=structuredClone(r);delete missingUnits.metadata.units;
  const cases={condition:api.fitGeophysicsRegionalTrend(r,{...f.options,max_condition:1}),nonconvergence:api.fitGeophysicsRegionalTrend(r,{...f.options,max_iterations:1}),missing_threshold:api.fitGeophysicsRegionalTrend(r,noThreshold),invalid_threshold:api.fitGeophysicsRegionalTrend(r,{...f.options,huber_threshold:0}),missing_units:api.fitGeophysicsRegionalTrend(missingUnits,f.options)};
  const negative=Object.fromEntries(Object.entries(cases).map(([key,v])=>[key,{state:v.state,code:v.issues[0].code}]));
  const badWorkflow=structuredClone(f.example.workflow);badWorkflow.steps[1].parameters.max_iterations=1;
  const failedWorkflow=await workflows.runGeophysicsObservationWorkflow(badWorkflow,{survey:f.example.survey});
  fs.writeFileSync(process.argv[3],JSON.stringify({fit:api.fitGeophysicsRegionalTrend(r,f.options),workflow:await workflows.runGeophysicsObservationWorkflow(f.example.workflow,{survey:f.example.survey}),negative,failed_workflow:{state:failedWorkflow.state,code:failedWorkflow.step_reports.fit.issues[0].code,artifacts:failedWorkflow.artifacts}}));
}finally{await server.close();}
