/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import {readFileSync,writeFileSync} from 'node:fs';
import {createServer} from '../../javascript/packages/baselode/node_modules/vite/dist/node/index.js';
const server=await createServer({server:{middlewareMode:true}});
try{
  const api=await server.ssrLoadModule('/src/data/geophysicsGravityForward.js');
  const input=JSON.parse(readFileSync(process.argv[2],'utf8'));
  const result=api.calculateGeophysicsGravityForward(input.request);
  const negative=input.negative.map(p=>{const r=api.calculateGeophysicsGravityForward(p);return {state:r.state,code:r.issues[0]?.code,fields:r.fields,sensitivities:r.sensitivities};});
  writeFileSync(process.argv[3],JSON.stringify({result,negative}));
}finally{await server.close();}
